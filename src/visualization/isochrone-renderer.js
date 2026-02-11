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
  // Nicht-linear: mittlere Buckets etwas kräftiger, äußerster Rand etwas transparenter
  const tEase = Math.pow(Math.max(0, Math.min(1, t)), 0.6);
  const r = Math.round(rgb.r * t + ISOCHRONE_WHITE.r * (1 - t));
  const g = Math.round(rgb.g * t + ISOCHRONE_WHITE.g * (1 - t));
  const b = Math.round(rgb.b * t + ISOCHRONE_WHITE.b * (1 - t));
  const fillColor = `rgb(${r},${g},${b})`;
  const fillOpacity = 0.12 + 0.58 * tEase; // innen ~0.70, Mitte kräftiger, außen ~0.12
  const strokeOpacity = 0.65 + 0.30 * tEase; // innen etwas kräftiger, außen etwas leichter
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

      // Hover: Rand hervorheben, ohne Layer-Reihenfolge zu zerstören
      // (kein bringToFront; stattdessen Outline in eigenem Pane ganz oben)
      polygon._hoverOutlineLayers = [];
      polygon._hoverOutlineTimer = null;
      const ensureOutlinePane = () => {
        const map = State.getMap && State.getMap();
        if (!map || !map.createPane || !map.getPane) return null;
        const name = 'isochrone-hover-outline';
        if (!map.getPane(name)) {
          const pane = map.createPane(name);
          pane.style.zIndex = 900; // über Isochronen
          pane.style.pointerEvents = 'none';
        }
        return name;
      };
      const extractOuterRings = (latlngsAny) => {
        const isLatLng = (x) => x && typeof x.lat === 'number' && typeof x.lng === 'number';
        if (!Array.isArray(latlngsAny) || latlngsAny.length === 0) return [];

        // Ring: [LatLng, LatLng, ...]
        if (isLatLng(latlngsAny[0])) return [latlngsAny];

        // Polygon: [ ring, hole, ... ] where ring is [LatLng...]
        if (Array.isArray(latlngsAny[0]) && latlngsAny[0].length && isLatLng(latlngsAny[0][0])) {
          return [latlngsAny[0]];
        }

        // MultiPolygon: [ [ring, ...], [ring, ...], ... ]
        if (
          Array.isArray(latlngsAny[0]) &&
          latlngsAny[0].length &&
          Array.isArray(latlngsAny[0][0]) &&
          latlngsAny[0][0].length &&
          isLatLng(latlngsAny[0][0][0])
        ) {
          return latlngsAny
            .map(poly => (Array.isArray(poly) && poly[0] && poly[0].length ? poly[0] : null))
            .filter(Boolean);
        }

        return [];
      };
      polygon.on('mouseover', () => {
        // Tooltip zuerst anzeigen (und erst danach Outline zeichnen)
        if (polygon.openTooltip) polygon.openTooltip();
        if (polygon._hoverOutlineTimer) {
          clearTimeout(polygon._hoverOutlineTimer);
          polygon._hoverOutlineTimer = null;
        }
        const paneName = ensureOutlinePane();
        const latlngsAny = polygon.getLatLngs ? polygon.getLatLngs() : null;
        if (!latlngsAny) return;

        const outlines = extractOuterRings(latlngsAny);
        polygon._hoverOutlineTimer = setTimeout(() => {
          outlines.forEach(ring => {
            const outline = L.polyline(ring, {
              pane: paneName || undefined,
              color: '#444',
              weight: 3,
              opacity: 0.9
            });
            outline._isIsochroneHoverOutline = true;
            outline.addTo(layerGroup);
            polygon._hoverOutlineLayers.push(outline);
          });
          polygon._hoverOutlineTimer = null;
        }, 60);
      });
      polygon.on('mouseout', () => {
        if (polygon._hoverOutlineTimer) {
          clearTimeout(polygon._hoverOutlineTimer);
          polygon._hoverOutlineTimer = null;
        }
        if (polygon._hoverOutlineLayers && polygon._hoverOutlineLayers.length) {
          polygon._hoverOutlineLayers.forEach(l => { try { layerGroup.removeLayer(l); } catch (_) {} });
          polygon._hoverOutlineLayers = [];
        }
      });

      polygon.addTo(layerGroup);
      layers.push(polygon);
    });

    return layers;
  }
};
