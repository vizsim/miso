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

  /**
   * Systemoptimale Einzugsgebiete: Pro (Start, Bucket) die Fläche, die dieser Start
   * am schnellsten erreicht (ohne Flächen, die ein anderer Start schneller erreicht).
   * @param {Array} savedIsochrones - [{ polygons, time_limit, buckets, color }, ...]
   * @returns {Array} - [{ startIndex, bucket, timeLabel, feature, color }, ...] (feature kann Polygon/MultiPolygon sein)
   */
  computeSystemOptimalCatchments(savedIsochrones, options = {}) {
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
        // Tooltip zuerst, dann (leicht) Rand highlighten
        poly._hoverOutlineLayers = [];
        poly._hoverOutlineTimer = null;
        const ensurePane = () => {
          const map = State.getMap && State.getMap();
          if (!map || !map.createPane || !map.getPane) return null;
          const name = 'isochrone-hover-outline';
          if (!map.getPane(name)) {
            const pane = map.createPane(name);
            pane.style.zIndex = 900;
            pane.style.pointerEvents = 'none';
          }
          return name;
        };
        poly.on('mouseover', () => {
          if (poly.openTooltip) poly.openTooltip();
          if (poly._hoverOutlineTimer) { clearTimeout(poly._hoverOutlineTimer); poly._hoverOutlineTimer = null; }
          const paneName = ensurePane();
          const rings = poly.getLatLngs ? poly.getLatLngs() : null;
          if (!rings) return;
          // Polygon: [outer, holes...] -> take outer
          const outer = Array.isArray(rings[0]) ? rings[0] : rings;
          poly._hoverOutlineTimer = setTimeout(() => {
            const outline = L.polyline(outer, { pane: paneName || undefined, color: '#444', weight: 3, opacity: 0.9 });
            outline.addTo(layerGroup);
            poly._hoverOutlineLayers.push(outline);
            poly._hoverOutlineTimer = null;
          }, 60);
        });
        poly.on('mouseout', () => {
          if (poly._hoverOutlineTimer) { clearTimeout(poly._hoverOutlineTimer); poly._hoverOutlineTimer = null; }
          if (poly._hoverOutlineLayers && poly._hoverOutlineLayers.length) {
            poly._hoverOutlineLayers.forEach(l => { try { layerGroup.removeLayer(l); } catch (_) {} });
            poly._hoverOutlineLayers = [];
          }
        });
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
            poly._hoverOutlineLayers = [];
            poly._hoverOutlineTimer = null;
            const ensurePane = () => {
              const map = State.getMap && State.getMap();
              if (!map || !map.createPane || !map.getPane) return null;
              const name = 'isochrone-hover-outline';
              if (!map.getPane(name)) {
                const pane = map.createPane(name);
                pane.style.zIndex = 900;
                pane.style.pointerEvents = 'none';
              }
              return name;
            };
            poly.on('mouseover', () => {
              if (poly.openTooltip) poly.openTooltip();
              if (poly._hoverOutlineTimer) { clearTimeout(poly._hoverOutlineTimer); poly._hoverOutlineTimer = null; }
              const paneName = ensurePane();
              const rings = poly.getLatLngs ? poly.getLatLngs() : null;
              if (!rings) return;
              const outer = Array.isArray(rings[0]) ? rings[0] : rings;
              poly._hoverOutlineTimer = setTimeout(() => {
                const outline = L.polyline(outer, { pane: paneName || undefined, color: '#444', weight: 3, opacity: 0.9 });
                outline.addTo(layerGroup);
                poly._hoverOutlineLayers.push(outline);
                poly._hoverOutlineTimer = null;
              }, 60);
            });
            poly.on('mouseout', () => {
              if (poly._hoverOutlineTimer) { clearTimeout(poly._hoverOutlineTimer); poly._hoverOutlineTimer = null; }
              if (poly._hoverOutlineLayers && poly._hoverOutlineLayers.length) {
                poly._hoverOutlineLayers.forEach(l => { try { layerGroup.removeLayer(l); } catch (_) {} });
                poly._hoverOutlineLayers = [];
              }
            });
            poly.addTo(layerGroup);
            layers.push(poly);
          }
        });
      }
    });
    return layers;
  }
};
