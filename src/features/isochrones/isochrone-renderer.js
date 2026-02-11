// ==== Isochrone-Renderer: Zeichnet Isochrone-Polygone auf der Karte ====
// Einfarbig (optional pro Startpunkt): innen kräftig, nach außen abnehmende Intensität

const DEFAULT_ISOCHRONE_COLOR = '#3388ff';
const ISOCHRONE_WHITE = { r: 245, g: 250, b: 255 };

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

/**
 * Gibt für einen Bucket Fill-Farbe und Opacity zurück. baseRgb = Hauptfarbe (innen), sonst Default-Blau.
 */
function getBucketStyle(bucket, buckets, baseRgb) {
  const rgb = baseRgb || hexToRgb(DEFAULT_ISOCHRONE_COLOR);
  if (!rgb) return { fillColor: DEFAULT_ISOCHRONE_COLOR, lineColor: '#4f80ff', fillOpacity: 0.5, strokeOpacity: 0.9, weight: 3 };
  const n = Math.max(1, buckets);
  const t = n === 1 ? 1 : 1 - bucket / (n - 1); // 1 innen, 0 außen
  const tClamped = Math.max(0, Math.min(1, t));
  // Opacity: außen deutlich schwächer, innen kräftiger (Exponent > 1 drückt kleine Werte nach unten)
  const tOpacity = Math.pow(tClamped, 1.5);
  const fillColor = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
  const lineR = Math.max(0, rgb.r - 24);
  const lineG = Math.max(0, rgb.g - 32);
  const lineB = Math.max(0, rgb.b - 42);
  const lineColor = `rgb(${lineR},${lineG},${lineB})`;
  const fillOpacity = 0.08 + 0.35 * tOpacity;
  const strokeOpacity = 0.55 + 0.40 * tOpacity;
  return { fillColor, lineColor, fillOpacity, strokeOpacity };
}

const IsochroneRenderer = {
  _isFiniteCoord(pt) {
    return Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1]);
  },

  _to2dCoord(pt) {
    return [Number(pt[0]), Number(pt[1])];
  },

  _closeRingIfNeeded(ring) {
    if (!Array.isArray(ring) || ring.length < 3) return [];
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (!first || !last) return [];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      return [...ring, [first[0], first[1]]];
    }
    return ring;
  },

  _sanitizeGeometry(geom) {
    if (!geom || !geom.type || !Array.isArray(geom.coordinates)) return null;
    if (geom.type === 'Polygon') {
      const rings = geom.coordinates
        .map(ring => (Array.isArray(ring) ? ring.filter(pt => this._isFiniteCoord(pt)).map(pt => this._to2dCoord(pt)) : []))
        .map(ring => this._closeRingIfNeeded(ring))
        .filter(ring => ring.length >= 4);
      if (!rings.length) return null;
      return { type: 'Polygon', coordinates: rings };
    }
    if (geom.type === 'MultiPolygon') {
      const polys = geom.coordinates
        .map(poly => {
          const rings = (Array.isArray(poly) ? poly : [])
            .map(ring => (Array.isArray(ring) ? ring.filter(pt => this._isFiniteCoord(pt)).map(pt => this._to2dCoord(pt)) : []))
            .map(ring => this._closeRingIfNeeded(ring))
            .filter(ring => ring.length >= 4);
          return rings.length ? rings : null;
        })
        .filter(Boolean);
      if (!polys.length) return null;
      return { type: 'MultiPolygon', coordinates: polys };
    }
    return null;
  },

  _hasDrawableGeometry(geom) {
    if (!geom || !geom.type) return false;
    if (geom.type === 'Polygon') {
      return Array.isArray(geom.coordinates) && geom.coordinates.some(ring => Array.isArray(ring) && ring.length >= 3);
    }
    if (geom.type === 'MultiPolygon') {
      return Array.isArray(geom.coordinates) && geom.coordinates.some(
        poly => Array.isArray(poly) && poly.some(ring => Array.isArray(ring) && ring.length >= 3)
      );
    }
    return false;
  },

  _asFeature(input) {
    if (!input) return null;
    if (input.type === 'Feature' && input.geometry) return input;
    const geom = input.geometry || input;
    if (!geom || !geom.type || !geom.coordinates) return null;
    return { type: 'Feature', geometry: geom, properties: input.properties || {} };
  },

  _buildBucketBands(polygons) {
    if (!Array.isArray(polygons) || polygons.length === 0) return [];
    // Simple & robust rendering path:
    // Draw each bucket as returned by API/hex-snap directly.
    // This avoids topology/orientation pitfalls from polygon difference operations.
    return polygons.map((p, idx) => ({
      feature: p,
      bandGeometry: (p && (p.geometry || p)) || null,
      originalIndex: idx
    }));
  },

  _estimateGeometryArea(geom) {
    if (!geom) return 0;
    if (typeof turf !== 'undefined' && typeof turf.area === 'function') {
      try {
        return turf.area({ type: 'Feature', geometry: geom, properties: {} }) || 0;
      } catch (_) {}
    }
    const flatten = (coordinates) => {
      const out = [];
      const walk = (arr) => {
        if (!Array.isArray(arr)) return;
        if (arr.length >= 2 && typeof arr[0] === 'number' && typeof arr[1] === 'number') {
          out.push(arr);
          return;
        }
        arr.forEach(walk);
      };
      walk(coordinates);
      return out;
    };
    const pts = flatten(geom.coordinates || []);
    if (!pts.length) return 0;
    let minX = pts[0][0], maxX = pts[0][0], minY = pts[0][1], maxY = pts[0][1];
    pts.forEach(([x, y]) => {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    });
    return Math.max(0, (maxX - minX) * (maxY - minY));
  },
  /**
   * Berechnet die Anzeige-Zeit für einen Bucket (in Minuten).
   * @param {number} bucket - Index 0..buckets-1
   * @param {number} timeLimit - Zeitlimit in Sekunden
   * @param {number} buckets - Anzahl Buckets
   * @returns {string} - z.B. "0–2 min"
   */
  getTimeBucketLabel(bucket, timeLimit, buckets) {
    const step = timeLimit / buckets;
    const minSec = bucket * step;
    const maxSec = (bucket + 1) * step;
    const minMin = Math.round(minSec / 60);
    const maxMin = Math.round(maxSec / 60);
    return `${minMin}–${maxMin} min`;
  },

  /**
   * Konvertiert GeoJSON-Koordinaten zu Leaflet LatLng.
   * GeoJSON: [lon, lat] oder [lon, lat, z]; Leaflet: [lat, lng]
   */
  _geoJsonToLatLngs(coords) {
    if (!coords || !coords.length) return [];
    const first = coords[0];
    if (Array.isArray(first) && typeof first[0] === 'number') {
      return coords.map(c => [c[1], c[0]]);
    }
    return [[first[1], first[0]]];
  },

  /**
   * Zeichnet Isochrone-Polygone aus der API-Response.
   * @param {Object} isochroneResult - { center, polygons, time_limit, buckets }
   * @returns {Object[]} - Gezeichnete Layer
   */
  drawIsochrones(isochroneResult) {
    const layerGroup = State.getLayerGroup();
    if (!layerGroup) return [];

    const { center, polygons, time_limit, buckets, color } = isochroneResult;
    const baseRgb = (color && hexToRgb(color)) || null;

    const layers = [];

    const bucketBands = this._buildBucketBands(polygons);

    // Größter Bucket zuerst unten; innerhalb gleicher Buckets größere Flächen zuerst.
    const sorted = [...bucketBands].sort((a, b) => {
      const bucketA = Number(a?.feature?.properties?.bucket ?? a?.feature?.bucket);
      const bucketB = Number(b?.feature?.properties?.bucket ?? b?.feature?.bucket);
      const aHasBucket = Number.isFinite(bucketA);
      const bHasBucket = Number.isFinite(bucketB);
      if (aHasBucket && bHasBucket && bucketA !== bucketB) {
        return bucketB - bucketA;
      }
      const geomA = a.bandGeometry || a.feature?.geometry || a.feature || a;
      const geomB = b.bandGeometry || b.feature?.geometry || b.feature || b;
      return this._estimateGeometryArea(geomB) - this._estimateGeometryArea(geomA);
    });

    if (CONFIG.ISOCHRONE_DEBUG_BUCKETS) {
      const debugRows = sorted.map((row, i) => {
        const rawBucket = row?.feature?.properties?.bucket ?? row?.feature?.bucket;
        const fallbackBucket = (sorted.length - 1) - i;
        const bandGeom = row?.bandGeometry || {};
        const bandValid = this._hasDrawableGeometry(bandGeom);
        return {
          drawIndex: i,
          rawBucket,
          styleBucket: fallbackBucket,
          sourceGeomType: (row?.feature?.geometry || row?.feature || {}).type || 'n/a',
          bandGeomType: bandGeom.type || 'n/a',
          bandValid
        };
      });
      console.log('[ISO DEBUG] renderer draw order');
      console.table(debugRows);
    }

    sorted.forEach((row, index) => {
      const feature = row.feature || row;
      const rawGeom = row.bandGeometry || feature.geometry || feature;
      const geom = this._sanitizeGeometry(rawGeom);
      if (!geom) {
        if (CONFIG.ISOCHRONE_DEBUG_BUCKETS) {
          console.log('[ISO DEBUG] skipped invalid geometry for bucket', feature?.properties?.bucket ?? feature?.bucket ?? index);
        }
        return;
      }
      const rawBucket = feature.properties?.bucket ?? feature.bucket;
      const fallbackBucket = (sorted.length - 1) - index; // 0=innen, n-1=außen
      const bucket = Number.isFinite(Number(rawBucket)) ? Number(rawBucket) : fallbackBucket;
      const styleBucket = bucket;

      const style = getBucketStyle(styleBucket, buckets, baseRgb);
      const label = this.getTimeBucketLabel(bucket, time_limit, buckets);

      const polygon = MapRenderer.createGeoJsonGeometryLayer(geom, {
        color: style.lineColor,
        fillColor: style.fillColor,
        fillOpacity: style.fillOpacity,
        opacity: style.strokeOpacity,
        weight: 2.5
      });
      if (!polygon) return;
      polygon._isIsochroneLayer = true;
      polygon.bindTooltip(label, {
        permanent: false,
        direction: 'top',
        sticky: true,
        offset: [0, -8],
        className: 'isochrone-tooltip'
      });

      // Hover: Tooltip zuerst, dann dezentes Highlight (ohne zusätzliche Layer, damit nichts "hängen bleibt")
      const _origHoverStyle = {
        weight: polygon.options?.weight ?? 3,
        opacity: polygon.options?.opacity ?? style.strokeOpacity,
        color: polygon.options?.color ?? style.fillColor
      };
      const clearHover = () => {
        try {
          polygon.setStyle({
            weight: _origHoverStyle.weight,
            opacity: _origHoverStyle.opacity,
            color: _origHoverStyle.color
          });
        } catch (_) {
          // ignore
        }
      };
      polygon.on('mouseover', () => {
        if (polygon.openTooltip) polygon.openTooltip();
        try {
          polygon.setStyle({
            weight: (_origHoverStyle.weight || 3) + 1,
            opacity: 1,
            color: '#444'
          });
        } catch (_) {
          // ignore
        }
      });
      polygon.on('mouseout', clearHover);
      polygon.on('tooltipclose', clearHover);
      polygon.on('remove', clearHover);

      polygon.addTo(layerGroup);
      layers.push(polygon);

      if (CONFIG.ISOCHRONE_DEBUG_BUCKETS) {
        const map = State.getMap && State.getMap();
        console.log('[ISO DEBUG] layer add status', {
          bucket,
          styleBucket,
          fillColor: style.fillColor,
          lineColor: style.lineColor,
          addedToMap: !!polygon._map,
          sourceId: polygon._sourceId,
          fillLayerId: polygon._fillLayerId,
          lineLayerId: polygon._lineLayerId,
          hasSource: !!(map && polygon._sourceId && map.getSource(polygon._sourceId)),
          hasFillLayer: !!(map && polygon._fillLayerId && map.getLayer(polygon._fillLayerId)),
          hasLineLayer: !!(map && polygon._lineLayerId && map.getLayer(polygon._lineLayerId))
        });
      }
    });

    return layers;
  }
};

