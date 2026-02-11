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
  if (!rgb) return { fillColor: DEFAULT_ISOCHRONE_COLOR, fillOpacity: 0.5, strokeOpacity: 0.9, weight: 3 };
  const n = Math.max(1, buckets);
  const t = n === 1 ? 1 : 1 - bucket / (n - 1); // 1 innen, 0 außen
  const tClamped = Math.max(0, Math.min(1, t));
  // Opacity: außen deutlich schwächer, innen kräftiger (Exponent > 1 drückt kleine Werte nach unten)
  const tOpacity = Math.pow(tClamped, 1.5);
  // Farbe: außen nicht komplett weiß, sondern behält etwas Basisfarbe
  const tColor = 0.18 + 0.82 * Math.pow(tClamped, 1.15);
  const r = Math.round(rgb.r * tColor + ISOCHRONE_WHITE.r * (1 - tColor));
  const g = Math.round(rgb.g * tColor + ISOCHRONE_WHITE.g * (1 - tColor));
  const b = Math.round(rgb.b * tColor + ISOCHRONE_WHITE.b * (1 - tColor));
  const fillColor = `rgb(${r},${g},${b})`;
  const fillOpacity = 0.08 + 0.35 * tOpacity; // innen ~0.85, außen ~0.05
  const strokeOpacity = 0.55 + 0.40 * tOpacity; // innen ~0.95, außen ~0.55
  return { fillColor, fillOpacity, strokeOpacity };
}

const IsochroneRenderer = {
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
   * @returns {L.Polygon[]} - Gezeichnete Layer
   */
  drawIsochrones(isochroneResult) {
    const layerGroup = State.getLayerGroup();
    if (!layerGroup) return [];

    const { center, polygons, time_limit, buckets, color } = isochroneResult;
    const baseRgb = (color && hexToRgb(color)) || null;

    const layers = [];

    // Größte Isochrone (längste Zeit) zuerst zeichnen → liegt unten; kleinste (kürzeste Zeit) zuletzt → liegt oben
    const sorted = [...polygons].sort((a, b) => {
      const bucketA = a.properties?.bucket ?? a.bucket ?? 0;
      const bucketB = b.properties?.bucket ?? b.bucket ?? 0;
      return bucketB - bucketA;
    });

    sorted.forEach((feature, index) => {
      const geom = feature.geometry || feature;
      const coords = geom.coordinates || geom;
      if (!coords || !coords.length) return;
      const bucket = feature.properties?.bucket ?? feature.bucket ?? index;

      let latlngs = null;
      // GeoJSON Polygon: [ [ [lon,lat], ... ] , ...holes ]
      if (geom.type === 'Polygon' && Array.isArray(coords[0]) && Array.isArray(coords[0][0])) {
        latlngs = coords.map(ring => ring.map(c => [c[1], c[0]]));
      }
      // GeoJSON MultiPolygon: [ polygon[], polygon[], ... ]
      if (geom.type === 'MultiPolygon' && Array.isArray(coords[0]) && Array.isArray(coords[0][0]) && Array.isArray(coords[0][0][0])) {
        latlngs = coords.map(poly => poly.map(ring => ring.map(c => [c[1], c[0]])));
      }
      // Fallback (altes Format): einfacher Ring
      if (!latlngs && Array.isArray(coords[0]) && typeof coords[0][0] === 'number') {
        latlngs = coords.map(c => [c[1], c[0]]);
      }
      if (!latlngs) return;

      const style = getBucketStyle(bucket, buckets, baseRgb);
      const label = this.getTimeBucketLabel(bucket, time_limit, buckets);

      const polygon = L.polygon(latlngs, {
        color: style.fillColor,
        fillColor: style.fillColor,
        fillOpacity: style.fillOpacity,
        opacity: style.strokeOpacity,
        weight: 3
      });
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
        weight: polygon.options.weight,
        opacity: polygon.options.opacity,
        color: polygon.options.color
      };
      polygon._hoverTimer = null;
      const clearHover = () => {
        if (polygon._hoverTimer) {
          clearTimeout(polygon._hoverTimer);
          polygon._hoverTimer = null;
        }
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
        if (polygon._hoverTimer) clearTimeout(polygon._hoverTimer);
        polygon._hoverTimer = setTimeout(() => {
          try {
            polygon.setStyle({
              weight: (_origHoverStyle.weight || 3) + 1,
              opacity: 1,
              color: '#444'
            });
          } catch (_) {
            // ignore
          }
          polygon._hoverTimer = null;
        }, 60);
      });
      polygon.on('mouseout', clearHover);
      polygon.on('tooltipclose', clearHover);
      polygon.on('remove', clearHover);

      polygon.addTo(layerGroup);
      layers.push(polygon);
    });

    return layers;
  }
};

