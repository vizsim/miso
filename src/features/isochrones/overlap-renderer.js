// ==== Overlap-Renderer: Überlappung + Systemoptimale Einzugsgebiete ====
// Benötigt Turf.js (intersect, union, difference)
const OVERLAP_COLOR = '#1a1a2e';
const OVERLAP_FILL_OPACITY = 0.35;
const OVERLAP_WEIGHT = 2;
const DEFAULT_CATCHMENT_COLOR = '#3388ff';
const CATCHMENT_FILL_OPACITY = 0.25;
const CATCHMENT_WEIGHT = 2;

const OverlapRenderer = {
  /**
   * Holt ein Polygon-Feature (GeoJSON) aus einem Isochrone-Polygon-Eintrag.
   * @param {Object} feature - Feature mit geometry oder coordinates
   * @returns {Object|null} - GeoJSON Feature (Polygon oder MultiPolygon)
   */
  _toTurfFeature(feature) {
    const geom = feature.geometry || feature;
    if (!geom) return null;

    // Direktes GeoJSON (bevorzugt)
    if (geom.type === 'Polygon' && Array.isArray(geom.coordinates)) {
      return { type: 'Feature', geometry: { type: 'Polygon', coordinates: geom.coordinates }, properties: {} };
    }
    if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
      return { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: geom.coordinates }, properties: {} };
    }

    // Fallback: nur Koordinaten ohne type (Polygon)
    let coords = geom.coordinates || geom;
    if (!coords || !coords.length) return null;
    if (Array.isArray(coords[0]) && Array.isArray(coords[0][0]) && typeof coords[0][0][0] === 'number') {
      // Polygon-Format [[[lon,lat],...]]
      return { type: 'Feature', geometry: { type: 'Polygon', coordinates: coords }, properties: {} };
    }
    if (Array.isArray(coords[0]) && typeof coords[0][0] === 'number') {
      // Ring-Format [[lon,lat],...] -> Polygon
      return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} };
    }
    return null;
  },

  /**
   * Berechnet die Schnittmenge mehrerer Polygone (pro Bucket).
   * @param {Array} savedIsochrones - [{ polygons, time_limit, buckets }, ...]
   * @returns {Array} - [{ bucket, timeLabel, feature }, ...] (Feature = GeoJSON Polygon/MultiPolygon)
   */
  computeOverlapPerBucket(savedIsochrones) {
    const intersectFn = typeof turf !== 'undefined' && (turf.intersect || turf.intersection);
    if (!intersectFn) {
      console.warn('[OverlapRenderer] Turf.js nicht geladen oder intersect fehlt.');
      return [];
    }
    if (!savedIsochrones || savedIsochrones.length < 2) return [];

    const first = savedIsochrones[0];
    const buckets = first.buckets != null ? first.buckets : 5;
    const timeLimit = first.time_limit != null ? first.time_limit : 600;
    const results = [];

    for (let bucketIndex = 0; bucketIndex < buckets; bucketIndex++) {
      const features = [];
      for (const item of savedIsochrones) {
        const polygons = item.polygons || [];
        const feat = polygons.find(f => (f.properties?.bucket ?? f.bucket) === bucketIndex);
        if (!feat) continue;
        const turfFeat = this._toTurfFeature(feat);
        if (turfFeat) features.push(turfFeat);
      }
      if (features.length < 2) continue;

      let intersection = features[0];
      for (let i = 1; i < features.length; i++) {
        try {
          intersection = intersectFn(intersection, features[i]);
          if (!intersection || !intersection.geometry) break;
        } catch (e) {
          intersection = null;
          break;
        }
      }
      if (!intersection || !intersection.geometry) continue;
      const geom = intersection.geometry;
      if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') continue;
      const timeLabel = IsochroneRenderer.getTimeBucketLabel(bucketIndex, timeLimit, buckets);
      results.push({ bucket: bucketIndex, timeLabel, feature: intersection });
    }
    return results;
  },

  /**
   * Zeichnet die Überlappungs-Polygone auf der Karte.
   * @param {Array} overlapResults - Ergebnis von computeOverlapPerBucket
   * @returns {L.Layer[]} - Gezeichnete Layer
   */
  drawOverlaps(overlapResults) {
    const layerGroup = State.getLayerGroup();
    if (!layerGroup || !overlapResults || overlapResults.length === 0) return [];

    const layers = [];
    // Größte Überlappung (längste Zeit) zuerst zeichnen → unten; kleinste (kürzeste Zeit) zuletzt → oben
    const sorted = [...overlapResults].sort((a, b) => b.bucket - a.bucket);
    sorted.forEach(({ feature, timeLabel }) => {
      const geom = feature.geometry;
      if (geom.type === 'Polygon' && geom.coordinates && geom.coordinates[0]) {
        const latlngs = geom.coordinates[0].map(c => [c[1], c[0]]);
        const poly = L.polygon(latlngs, {
          color: OVERLAP_COLOR,
          fillColor: OVERLAP_COLOR,
          fillOpacity: OVERLAP_FILL_OPACITY,
          weight: OVERLAP_WEIGHT,
          dashArray: '6,4'
        });
        poly._isOverlapLayer = true;
        poly.bindTooltip('Von allen erreichbar: ' + timeLabel, {
          permanent: false,
          direction: 'top',
          className: 'isochrone-tooltip overlap-tooltip'
        });
        poly.addTo(layerGroup);
        layers.push(poly);
      } else if (geom.type === 'MultiPolygon' && geom.coordinates) {
        geom.coordinates.forEach(ring => {
          if (ring && ring[0]) {
            const latlngs = ring[0].map(c => [c[1], c[0]]);
            const poly = L.polygon(latlngs, {
              color: OVERLAP_COLOR,
              fillColor: OVERLAP_COLOR,
              fillOpacity: OVERLAP_FILL_OPACITY,
              weight: OVERLAP_WEIGHT,
              dashArray: '6,4'
            });
            poly._isOverlapLayer = true;
            poly.bindTooltip('Von allen erreichbar: ' + timeLabel, {
              permanent: false,
              direction: 'top',
              className: 'isochrone-tooltip overlap-tooltip'
            });
            poly.addTo(layerGroup);
            layers.push(poly);
          }
        });
      }
    });
    return layers;
  },

  /**
   * Mittlere Zeit eines Buckets in Sekunden (für Vergleich „schneller“).
   * @param {number} bucketIndex - 0..buckets-1
   * @param {number} timeLimit - Zeitlimit Sekunden
   * @param {number} buckets - Anzahl Buckets
   * @returns {number}
   */
  _bucketMidpointSec(bucketIndex, timeLimit, buckets) {
    const n = Math.max(1, buckets);
    return (bucketIndex + 0.5) * (timeLimit / n);
  },

  _isH3HexIsochroneFeature(feature) {
    const props = feature?.properties || {};
    return props._hex_snapped === true && props._hex_method === 'h3' && typeof props._hex_res === 'number';
  },

  _getH3CellsForFeature(feature, targetRes) {
    if (typeof h3 === 'undefined') return null;
    const res = feature?.__h3Res ?? feature?.properties?._hex_res;
    let cells = feature?.__h3Cells;
    if (!Array.isArray(cells) || cells.length === 0) return null;
    if (typeof targetRes === 'number' && typeof res === 'number' && res > targetRes) {
      // auf gemeinsame gröbere Auflösung runterziehen
      const set = new Set();
      for (const c of cells) {
        try { set.add(h3.cellToParent(c, targetRes)); } catch (_) {}
      }
      cells = Array.from(set);
    }
    return cells;
  },

  _intersectionSets(aSet, bSet) {
    // iteriere über kleineres Set
    const out = new Set();
    if (!aSet || !bSet) return out;
    const [small, large] = aSet.size <= bSet.size ? [aSet, bSet] : [bSet, aSet];
    for (const v of small) if (large.has(v)) out.add(v);
    return out;
  },

  /**
   * Fast-Path für Hex-Modus: partitioniert die gemeinsame Fläche über H3-Zellmengen
   * (kein Turf intersect/difference).
   */
  computeSystemOptimalCatchmentsH3(savedIsochrones, options = {}) {
    if (typeof h3 === 'undefined' || !h3.cellsToMultiPolygon) {
      console.warn('[OverlapRenderer] H3 nicht geladen.');
      return [];
    }
    if (!savedIsochrones || savedIsochrones.length < 2) return [];

    const first = savedIsochrones[0];
    const buckets = first.buckets != null ? first.buckets : 5;
    const timeLimit = first.time_limit != null ? first.time_limit : 600;
    const maxBucketByIndex = Array.isArray(options.maxBucketByIndex) ? options.maxBucketByIndex : null;

    // gemeinsame (gröbste) H3-Resolution wählen, damit Starts kompatibel sind
    const resList = [];
    for (const item of savedIsochrones) {
      const feat0 = (item.polygons || []).find(f => this._isH3HexIsochroneFeature(f));
      const r = feat0?.properties?._hex_res;
      if (typeof r === 'number') resList.push(r);
    }
    if (resList.length < savedIsochrones.length) return [];
    const commonRes = Math.min(...resList);

    // pro Start: kumulative Sets C_b (bis maxBucket) und daraus Ring-Sets R_b + cell->bucket Map
    const perStart = savedIsochrones.map((item, idx) => {
      const polygons = item.polygons || [];
      const maxBucket = Math.max(0, Math.min(buckets - 1, (maxBucketByIndex?.[idx] ?? (buckets - 1))));
      const cumulativeSets = new Array(maxBucket + 1).fill(null);
      for (let b = 0; b <= maxBucket; b++) {
        const feat = polygons.find(f => (f.properties?.bucket ?? f.bucket) === b);
        if (!feat || !this._isH3HexIsochroneFeature(feat)) return null;
        const cells = this._getH3CellsForFeature(feat, commonRes);
        if (!cells) return null;
        cumulativeSets[b] = new Set(cells);
      }
      const ringSets = new Array(maxBucket + 1).fill(null);
      const cellToBucket = new Map();
      let prev = new Set();
      for (let b = 0; b <= maxBucket; b++) {
        const cur = cumulativeSets[b];
        const ring = new Set();
        for (const c of cur) {
          if (!prev.has(c)) {
            ring.add(c);
            cellToBucket.set(c, b);
          }
        }
        ringSets[b] = ring;
        prev = cur;
      }
      return { maxBucket, cumulativeSets, ringSets, cellToBucket };
    });

    if (perStart.some(x => !x)) return [];

    // gemeinsame Fläche: Intersection der äußeren kumulativen Sets
    let common = null;
    for (let s = 0; s < perStart.length; s++) {
      const outer = perStart[s].cumulativeSets[perStart[s].maxBucket];
      common = common ? this._intersectionSets(common, outer) : new Set(outer);
      if (common.size === 0) return [];
    }

    // Zellen nach Bucket-Tuple gruppieren (diskret) -> 1 MultiPolygon pro Gruppe
    const groups = new Map(); // key -> { bucketIndices, cells: [] }
    for (const cell of common) {
      const bucketIndices = perStart.map(ps => ps.cellToBucket.get(cell));
      if (bucketIndices.some(v => typeof v !== 'number')) continue;
      const key = bucketIndices.join(',');
      let g = groups.get(key);
      if (!g) {
        g = { bucketIndices, cells: [] };
        groups.set(key, g);
      }
      g.cells.push(cell);
    }

    const results = [];
    for (const g of groups.values()) {
      if (!g.cells.length) continue;
      let mpCoords = null;
      try {
        mpCoords = h3.cellsToMultiPolygon(g.cells, true);
      } catch (_) {
        mpCoords = null;
      }
      if (!mpCoords || !mpCoords.length) continue;

      const sumSec = g.bucketIndices.reduce((acc, b) => acc + this._bucketMidpointSec(b, timeLimit, buckets), 0);
      const avgSec = sumSec / Math.max(1, g.bucketIndices.length);
      const timeLabels = g.bucketIndices.map(b => IsochroneRenderer.getTimeBucketLabel(b, timeLimit, buckets));
      results.push({
        feature: { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: mpCoords }, properties: {} },
        bucketIndices: g.bucketIndices,
        timeLabels,
        sumSec,
        avgSec
      });
    }

    return results;
  },

  /**
   * Systemoptimale Einzugsgebiete: Pro (Start, Bucket) die Fläche, die dieser Start
   * am schnellsten erreicht (ohne Flächen, die ein anderer Start schneller erreicht).
   * @param {Array} savedIsochrones - [{ polygons, time_limit, buckets, color }, ...]
   * @returns {Array} - [{ startIndex, bucket, timeLabel, feature, color }, ...] (feature kann Polygon/MultiPolygon sein)
   */
  computeSystemOptimalCatchments(savedIsochrones, options = {}) {
    // Fast path: Hex/H3 vorhanden -> Set-basierte Partitionierung
    try {
      const allHaveH3 = Array.isArray(savedIsochrones) && savedIsochrones.length >= 2 && savedIsochrones.every(item => {
        const p = item.polygons || [];
        const any = p.find(f => (f.properties?.bucket ?? f.bucket) === 0);
        return any && this._isH3HexIsochroneFeature(any) && typeof h3 !== 'undefined';
      });
      if (allHaveH3) return this.computeSystemOptimalCatchmentsH3(savedIsochrones, options);
    } catch (_) {
      // fallback below
    }

    if (typeof turf === 'undefined' || !turf.difference || !(turf.intersect || turf.intersection)) {
      console.warn('[OverlapRenderer] Turf.js (difference/intersect) nicht geladen.');
      return [];
    }
    if (!savedIsochrones || savedIsochrones.length < 2) return [];

    const intersectFn = turf.intersect || turf.intersection;
    const differenceFn = turf.difference;

    const first = savedIsochrones[0];
    const buckets = first.buckets != null ? first.buckets : 5;
    const timeLimit = first.time_limit != null ? first.time_limit : 600;
    const maxBucketByIndex = Array.isArray(options.maxBucketByIndex) ? options.maxBucketByIndex : null;

    const safeDifference = (a, b) => {
      try { return differenceFn(a, b); } catch (_) { return null; }
    };
    const safeIntersect = (a, b) => {
      try { return intersectFn(a, b); } catch (_) { return null; }
    };

    // 1) Pro Start Bucket-Ringe bilden: ring_k = P_k \ P_{k-1}
    // Damit ist die Zeitklasse eindeutig (keine kumulativen Flächen).
    const ringsByStart = savedIsochrones.map((item, idx) => {
      const polygons = item.polygons || [];
      const maxBucket = Math.max(0, Math.min(buckets - 1, (maxBucketByIndex?.[idx] ?? (buckets - 1))));
      const cumulative = [];
      for (let b = 0; b < buckets; b++) {
        if (b > maxBucket) { cumulative[b] = null; continue; }
        const feat = polygons.find(f => (f.properties?.bucket ?? f.bucket) === b);
        cumulative[b] = feat ? this._toTurfFeature(feat) : null;
      }
      const rings = [];
      for (let b = 0; b < buckets; b++) {
        if (b > maxBucket) { rings[b] = null; continue; }
        const curr = cumulative[b];
        if (!curr || !curr.geometry) { rings[b] = null; continue; }
        if (b === 0) {
          rings[b] = curr;
        } else {
          const prev = cumulative[b - 1];
          rings[b] = (prev && prev.geometry) ? safeDifference(curr, prev) : curr;
        }
        if (!rings[b] || !rings[b].geometry) rings[b] = null;
      }
      return rings;
    });

    // Wenn ein Start gar keine Ringe hat, gibt es keine gemeinsame Überlappung.
    if (ringsByStart.some(rings => !rings || rings.every(r => !r))) return [];

    // 2) Überlappungsflächen (wo alle hinkommen) als Kreuzprodukt der Ringe schneiden.
    // Ergebnis ist eine Partition der gemeinsamen Fläche nach (bucket pro Start).
    let partial = [];
    const rings0 = ringsByStart[0];
    for (let b0 = 0; b0 < buckets; b0++) {
      const ring = rings0[b0];
      if (ring && ring.geometry) partial.push({ feature: ring, bucketIndices: [b0] });
    }
    for (let s = 1; s < ringsByStart.length; s++) {
      const next = [];
      const rings = ringsByStart[s];
      for (const p of partial) {
        for (let b = 0; b < buckets; b++) {
          const ring = rings[b];
          if (!ring || !ring.geometry) continue;
          const inter = safeIntersect(p.feature, ring);
          if (!inter || !inter.geometry) continue;
          const gt = inter.geometry.type;
          if (gt !== 'Polygon' && gt !== 'MultiPolygon') continue;
          next.push({ feature: inter, bucketIndices: [...p.bucketIndices, b] });
        }
      }
      partial = next;
      if (partial.length === 0) break;
    }

    if (partial.length === 0) return [];

    // 3) Kosten berechnen: Summe & Durchschnitt (Bucket-Midpoints)
    return partial.map(p => {
      const sumSec = p.bucketIndices.reduce((acc, b) => acc + this._bucketMidpointSec(b, timeLimit, buckets), 0);
      const avgSec = sumSec / Math.max(1, p.bucketIndices.length);
      const timeLabels = p.bucketIndices.map(b => IsochroneRenderer.getTimeBucketLabel(b, timeLimit, buckets));
      return {
        feature: p.feature,
        bucketIndices: p.bucketIndices,
        timeLabels,
        sumSec,
        avgSec
      };
    });
  },

  _escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  },

  /**
   * Zeichnet systemoptimale Einzugsgebiete (pro Start/Bucket mit Startfarbe).
   * @param {Array} catchmentResults - Ergebnis von computeSystemOptimalCatchments
   * @param {Array} savedIsochrones - für Start-Labels
   * @returns {L.Layer[]}
   */
  drawSystemOptimalCatchments(catchmentResults, savedIsochrones) {
    const layerGroup = State.getLayerGroup();
    if (!layerGroup || !catchmentResults || catchmentResults.length === 0) return [];

    const layers = [];
    const sums = catchmentResults.map(r => r.sumSec);
    const minSum = Math.min(...sums);
    const maxSum = Math.max(...sums);
    const denom = Math.max(1e-9, (maxSum - minSum));

    const lerp = (a, b, t) => Math.round(a + (b - a) * t);
    const colorFor = (t) => {
      // t: 0 = gut (grün), 1 = schlecht (rot)
      const g = { r: 46, g: 204, b: 113 };
      const r = { r: 231, g: 76, b: 60 };
      return `rgb(${lerp(g.r, r.r, t)},${lerp(g.g, r.g, t)},${lerp(g.b, r.b, t)})`;
    };

    // Gute Bereiche oben zeichnen (kleinere Summe zuletzt → oben)
    const sorted = [...catchmentResults].sort((a, b) => b.sumSec - a.sumSec);

    sorted.forEach((res) => {
      const { feature, sumSec, avgSec, timeLabels } = res;
      const geom = feature.geometry;

      const t = (sumSec - minSum) / denom;
      const fill = colorFor(t);
      const sumMin = Math.round(sumSec / 60);
      const avgMin = Math.round((avgSec / 60) * 10) / 10;

      // "Besonders gut": Top 10% (niedrigste Summe)
      const isVeryGood = t <= 0.10;

      const header = `<div><strong>Summe:</strong> ${this._escapeHtml(sumMin)} min &nbsp; <strong>Ø:</strong> ${this._escapeHtml(avgMin)} min</div>`;
      const perStart = (savedIsochrones || []).map((_, i) => {
        const lbl = timeLabels?.[i] ?? '';
        return `<div>Start ${i + 1}: ${this._escapeHtml(lbl)}</div>`;
      }).join('');
      const tooltipHtml = header + `<div style="margin-top:6px;">${perStart}</div>`;

      const opts = {
        color: isVeryGood ? '#111' : fill,
        fillColor: fill,
        fillOpacity: isVeryGood ? 0.55 : 0.45,
        weight: isVeryGood ? 3 : 2,
        opacity: 0.9
      };
      if (geom.type === 'Polygon' && geom.coordinates && geom.coordinates[0]) {
        const latlngs = geom.coordinates[0].map(c => [c[1], c[0]]);
        const poly = L.polygon(latlngs, opts);
        poly._isOverlapLayer = true;
        poly.bindTooltip(tooltipHtml, {
          permanent: false,
          direction: 'top',
          sticky: true,
          offset: [0, -8],
          className: 'isochrone-tooltip overlap-tooltip'
        });
        // Tooltip zuerst, dann (leicht) Rand highlighten – ohne Extra-Layer
        const _origHoverStyle = {
          weight: poly.options.weight,
          opacity: poly.options.opacity,
          color: poly.options.color
        };
        poly._hoverTimer = null;
        const clearHover = () => {
          if (poly._hoverTimer) { clearTimeout(poly._hoverTimer); poly._hoverTimer = null; }
          try {
            poly.setStyle({
              weight: _origHoverStyle.weight,
              opacity: _origHoverStyle.opacity,
              color: _origHoverStyle.color
            });
          } catch (_) {}
        };
        poly.on('mouseover', () => {
          if (poly.openTooltip) poly.openTooltip();
          if (poly._hoverTimer) clearTimeout(poly._hoverTimer);
          poly._hoverTimer = setTimeout(() => {
            try {
              poly.setStyle({
                weight: (_origHoverStyle.weight || 2) + 1,
                opacity: 1,
                color: '#444'
              });
            } catch (_) {}
            poly._hoverTimer = null;
          }, 60);
        });
        poly.on('mouseout', clearHover);
        poly.on('tooltipclose', clearHover);
        poly.on('remove', clearHover);
        poly.addTo(layerGroup);
        layers.push(poly);
      } else if (geom.type === 'MultiPolygon' && geom.coordinates) {
        geom.coordinates.forEach(ring => {
          if (ring && ring[0]) {
            const latlngs = ring[0].map(c => [c[1], c[0]]);
            const poly = L.polygon(latlngs, opts);
            poly._isOverlapLayer = true;
            poly.bindTooltip(tooltipHtml, {
              permanent: false,
              direction: 'top',
              sticky: true,
              offset: [0, -8],
              className: 'isochrone-tooltip overlap-tooltip'
            });
            const _origHoverStyle = {
              weight: poly.options.weight,
              opacity: poly.options.opacity,
              color: poly.options.color
            };
            poly._hoverTimer = null;
            const clearHover = () => {
              if (poly._hoverTimer) { clearTimeout(poly._hoverTimer); poly._hoverTimer = null; }
              try {
                poly.setStyle({
                  weight: _origHoverStyle.weight,
                  opacity: _origHoverStyle.opacity,
                  color: _origHoverStyle.color
                });
              } catch (_) {}
            };
            poly.on('mouseover', () => {
              if (poly.openTooltip) poly.openTooltip();
              if (poly._hoverTimer) clearTimeout(poly._hoverTimer);
              poly._hoverTimer = setTimeout(() => {
                try {
                  poly.setStyle({
                    weight: (_origHoverStyle.weight || 2) + 1,
                    opacity: 1,
                    color: '#444'
                  });
                } catch (_) {}
                poly._hoverTimer = null;
              }, 60);
            });
            poly.on('mouseout', clearHover);
            poly.on('tooltipclose', clearHover);
            poly.on('remove', clearHover);
            poly.addTo(layerGroup);
            layers.push(poly);
          }
        });
      }
    });
    return layers;
  }
};

