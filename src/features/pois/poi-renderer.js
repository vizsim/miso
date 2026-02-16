// ==== POI-Renderer: Cafés, Restaurants, Bars/Kneipen ====
const POI_STYLE = {
  cafe: { color: '#92400e', fill: '#d97706', label: 'Café' },
  restaurant: { color: '#b91c1c', fill: '#dc2626', label: 'Restaurant' },
  bar: { color: '#1e3a5f', fill: '#2563eb', label: 'Bar/Kneipe' }
};

const POI_ICON_SVG = {
  cafe: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h10v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8zm10 2h2.2a2.8 2.8 0 1 1 0 5.6H14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 4c0 1 .6 1.5 1.2 2 .6.5 1.2 1 1.2 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M10 4c0 1 .6 1.5 1.2 2 .6.5 1.2 1 1.2 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  restaurant: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v8M9.5 3v8M12 3v8c0 1.7-1.3 3-3 3h-.2v7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 3v6M17 9c1.7 0 3 1.3 3 3v9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  bar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-6 7v5a2 2 0 0 1-2 2h0a2 2 0 0 1-2-2v-5L4 5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 21h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
};

const PoiRenderer = {
  _computePolygonCentroid(latlngs) {
    const points = (latlngs || []).filter(c => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]));
    if (points.length === 0) return null;
    const first = points[0];
    const last = points[points.length - 1];
    const ring = (first[0] === last[0] && first[1] === last[1]) ? points.slice(0, -1) : points;
    if (ring.length < 3) return { lat: ring[0][0], lng: ring[0][1] };

    let area2 = 0;
    let centroidLat = 0;
    let centroidLng = 0;

    for (let i = 0; i < ring.length; i++) {
      const [lat1, lng1] = ring[i];
      const [lat2, lng2] = ring[(i + 1) % ring.length];
      const cross = (lng1 * lat2) - (lng2 * lat1);
      area2 += cross;
      centroidLat += (lat1 + lat2) * cross;
      centroidLng += (lng1 + lng2) * cross;
    }

    if (Math.abs(area2) < 1e-12) {
      let latSum = 0;
      let lngSum = 0;
      ring.forEach(([lat, lng]) => { latSum += lat; lngSum += lng; });
      return { lat: latSum / ring.length, lng: lngSum / ring.length };
    }

    const factor = 1 / (3 * area2);
    return { lat: centroidLat * factor, lng: centroidLng * factor };
  },

  createPoiIcon(zoom, poiType) {
    const style = POI_STYLE[poiType] || POI_STYLE.cafe;
    const baseSize = Math.max(10, Math.min(36, 10 + (zoom - 10) * 2.8));
    const borderWidth = zoom < 13 ? 1.5 : 2;
    return MapRenderer.createDivIcon({
      className: 'poi-marker-icon',
      html: `
        <div class="poi-marker-icon-inner" style="
          width: ${baseSize}px; height: ${baseSize}px;
          background-color: ${style.fill};
          border: ${borderWidth}px solid ${style.color};
          border-radius: 50%;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          display: flex; align-items: center; justify-content: center;
          color: white;
          cursor: pointer;
        ">
          <span class="poi-marker-icon-glyph" style="width:${baseSize * 0.62}px;height:${baseSize * 0.62}px;">${POI_ICON_SVG[poiType] || POI_ICON_SVG.cafe}</span>
        </div>`,
      iconSize: [baseSize, baseSize],
      iconAnchor: [baseSize / 2, baseSize / 2]
    });
  },

  drawPois(places, poiType) {
    const layerGroup = State.getLayerGroup();
    if (!layerGroup) return [];
    const map = State.getMap();
    const currentZoom = map ? map.getZoom() : 13;
    const icon = this.createPoiIcon(currentZoom, poiType);
    const layers = [];

    const createPopup = (place) => {
      let html = `<strong>${place.name}</strong>`;
      if (place.tags) {
        if (place.tags['addr:street'] && place.tags['addr:housenumber']) html += `<br>${place.tags['addr:street']} ${place.tags['addr:housenumber']}`;
        if (place.tags['addr:postcode'] && place.tags['addr:city']) html += `<br>${place.tags['addr:postcode']} ${place.tags['addr:city']}`;
        if (place.tags.website) html += `<br><a href="${place.tags.website}" target="_blank">Website</a>`;
        if (place.tags.phone) html += `<br>Tel: ${place.tags.phone}`;
        if (place.tags.opening_hours) html += `<br>Öffnungszeiten: ${place.tags.opening_hours}`;
      }
      return html;
    };

    places.forEach(place => {
      if (place.type === 'way' && place.coordinates && place.coordinates.length >= 3) {
        const poly = MapRenderer.createPolygon(place.coordinates, {
          color: POI_STYLE[poiType].color,
          fillColor: POI_STYLE[poiType].fill,
          fillOpacity: 0.3,
          weight: 2,
          opacity: 0.8
        }).addTo(layerGroup);
        poly._isPoiLayer = true;
        poly._poiType = poiType;
        poly._poiId = place.id;
        poly.bindPopup(createPopup(place), { maxWidth: 250, className: 'poi-popup' });
        layers.push(poly);
        const centroid = this._computePolygonCentroid(place.coordinates);
        if (!centroid) return;
        const m = MapRenderer.createMarker([centroid.lat, centroid.lng], { icon }).addTo(layerGroup);
        m._isPoiLayer = true;
        m._poiType = poiType;
        m._poiId = place.id;
        m.bindPopup(createPopup(place), { maxWidth: 250, className: 'poi-popup' });
        layers.push(m);
      } else if (place.lat != null && place.lng != null) {
        const m = MapRenderer.createMarker([place.lat, place.lng], { icon }).addTo(layerGroup);
        m._isPoiLayer = true;
        m._poiType = poiType;
        m._poiId = place.id;
        m.bindPopup(createPopup(place), { maxWidth: 250, className: 'poi-popup' });
        layers.push(m);
      }
    });
    return layers;
  },

  clearPois(layers) {
    if (!layers || !layers.length) return;
    const layerGroup = State.getLayerGroup();
    layers.forEach(layer => {
      if (layer && layerGroup) layerGroup.removeLayer(layer);
    });
  },

  drawPoiSearchRadius(lat, lng, radiusMeters, poiType) {
    const layerGroup = State.getLayerGroup();
    if (!layerGroup) return null;
    const getter = poiType === 'cafe' ? 'getCafeSearchRadiusCircle' : poiType === 'restaurant' ? 'getRestaurantSearchRadiusCircle' : 'getBarSearchRadiusCircle';
    const setter = poiType === 'cafe' ? 'setCafeSearchRadiusCircle' : poiType === 'restaurant' ? 'setRestaurantSearchRadiusCircle' : 'setBarSearchRadiusCircle';
    const oldCircle = State[getter]();
    if (oldCircle) layerGroup.removeLayer(oldCircle);
    const circle = MapRenderer.createCircle([lat, lng], {
      radius: radiusMeters,
      color: '#666',
      fillColor: '#999',
      fillOpacity: 0.2,
      weight: 2,
      opacity: 0.5
    }).addTo(layerGroup);
    State[setter](circle);
    return circle;
  },

  clearPoiSearchRadius(poiType) {
    const getter = poiType === 'cafe' ? 'getCafeSearchRadiusCircle' : poiType === 'restaurant' ? 'getRestaurantSearchRadiusCircle' : 'getBarSearchRadiusCircle';
    const setter = poiType === 'cafe' ? 'setCafeSearchRadiusCircle' : poiType === 'restaurant' ? 'setRestaurantSearchRadiusCircle' : 'setBarSearchRadiusCircle';
    const oldCircle = State[getter]();
    if (oldCircle) {
      const layerGroup = State.getLayerGroup();
      if (layerGroup) layerGroup.removeLayer(oldCircle);
    }
    State[setter](null);
  },

  updatePoiIcons(poiType) {
    const map = State.getMap();
    if (!map) return;
    const getter = poiType === 'cafe' ? 'getCafeMarkers' : poiType === 'restaurant' ? 'getRestaurantMarkers' : 'getBarMarkers';
    const layers = State[getter]() || [];
    const newIcon = this.createPoiIcon(map.getZoom(), poiType);
    layers.forEach(layer => {
      if (MapRenderer.isMarker(layer) && layer._isPoiLayer && layer._poiType === poiType) {
        layer.setIcon(newIcon);
      }
    });
  }
};

