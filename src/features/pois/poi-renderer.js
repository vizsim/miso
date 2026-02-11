// ==== POI-Renderer: Cafés, Restaurants, Bars/Kneipen ====
const POI_STYLE = {
  cafe: { color: '#92400e', fill: '#d97706', label: 'Café' },
  restaurant: { color: '#b91c1c', fill: '#dc2626', label: 'Restaurant' },
  bar: { color: '#1e3a5f', fill: '#2563eb', label: 'Bar/Kneipe' }
};

const PoiRenderer = {
  createPoiIcon(zoom, poiType) {
    const style = POI_STYLE[poiType] || POI_STYLE.cafe;
    const baseSize = Math.max(10, Math.min(36, 10 + (zoom - 10) * 2.8));
    const borderWidth = zoom < 13 ? 1.5 : 2;
    return L.divIcon({
      className: 'poi-marker-icon',
      html: `
        <div style="
          width: ${baseSize}px; height: ${baseSize}px;
          background-color: ${style.fill};
          border: ${borderWidth}px solid ${style.color};
          border-radius: 50%;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          display: flex; align-items: center; justify-content: center;
          color: white; font-size: ${baseSize * 0.55}px; font-weight: bold;
          cursor: pointer;
        ">${poiType === 'cafe' ? '☕' : poiType === 'restaurant' ? '🍽' : '🍺'}</div>`,
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
        const poly = L.polygon(place.coordinates, {
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
        const coords = place.coordinates[0][0] === place.coordinates[place.coordinates.length - 1][0] ? place.coordinates.slice(0, -1) : place.coordinates;
        let clat = 0, clng = 0;
        coords.forEach(c => { clat += c[0]; clng += c[1]; });
        clat /= coords.length;
        clng /= coords.length;
        const m = L.marker([clat, clng], { icon }).addTo(layerGroup);
        m._isPoiLayer = true;
        m._poiType = poiType;
        m._poiId = place.id;
        m.bindPopup(createPopup(place), { maxWidth: 250, className: 'poi-popup' });
        layers.push(m);
      } else if (place.lat != null && place.lng != null) {
        const m = L.marker([place.lat, place.lng], { icon }).addTo(layerGroup);
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
    const circle = L.circle([lat, lng], {
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
      if (layer instanceof L.Marker && layer._isPoiLayer && layer._poiType === poiType) {
        layer.setIcon(newIcon);
      }
    });
  }
};

