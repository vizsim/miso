// ==== Map-Renderer: native MapLibre ====
const POPULATION_ATTRIBUTION = '© Statistisches Bundesamt (Destatis)';

function _toLngLat(latlng) {
  if (!latlng) return { lng: 0, lat: 0 };
  if (Array.isArray(latlng)) return { lat: latlng[0], lng: latlng[1] };
  return { lat: latlng.lat, lng: latlng.lng };
}

function _isLatLngPair(v) {
  return Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number';
}

class MLDivIcon {
  constructor(options = {}) {
    this.className = options.className || '';
    this.html = options.html || '';
    this.iconSize = options.iconSize || [20, 20];
    this.iconAnchor = options.iconAnchor || [this.iconSize[0] / 2, this.iconSize[1] / 2];
  }
}

class MLLayerGroup {
  constructor(renderer) {
    this._renderer = renderer;
    this._layers = new Set();
  }
  addLayer(layer) {
    if (!layer) return layer;
    this._layers.add(layer);
    if (typeof layer._addToRenderer === 'function') {
      try {
        layer._addToRenderer(this._renderer);
      } catch (err) {
        this._layers.delete(layer);
        if (typeof Utils !== 'undefined' && typeof Utils.logError === 'function') {
          Utils.logError('Layer konnte nicht zur Karte hinzugefügt werden.', err);
        } else {
          console.error('Layer konnte nicht zur Karte hinzugefügt werden.', err);
        }
      }
    }
    return layer;
  }
  removeLayer(layer) {
    if (!layer) return;
    if (typeof layer._removeFromRenderer === 'function') layer._removeFromRenderer(this._renderer);
    this._layers.delete(layer);
  }
  eachLayer(cb) { Array.from(this._layers).forEach(cb); }
  hasLayer(layer) { return this._layers.has(layer); }
  bringToFront() {}
}

let _mlLayerId = 0;
class MLBaseLayer {
  constructor() {
    this._id = `ml-layer-${++_mlLayerId}`;
    this._listeners = {};
    this._tooltip = null;
    this._popup = null;
    this._hoverPopup = null;
    this._clickPopup = null;
  }
  addTo(layerGroup) { layerGroup.addLayer(this); return this; }
  on(eventName, callback) {
    if (!this._listeners[eventName]) this._listeners[eventName] = [];
    this._listeners[eventName].push(callback);
    return this;
  }
  _emit(eventName, payload = {}) {
    (this._listeners[eventName] || []).forEach(cb => {
      try { cb(payload); } catch (_) {}
    });
  }
  bindTooltip(content, options = {}) { this._tooltip = { content, options }; return this; }
  bindPopup(content, options = {}) { this._popup = { content, options }; return this; }
  setTooltipContent(content) { if (this._tooltip) this._tooltip.content = content; }
}

class MLMarker extends MLBaseLayer {
  constructor(latlng, options = {}) {
    super();
    this._latlng = _toLngLat(latlng);
    this._iconDef = options.icon instanceof MLDivIcon ? options.icon : new MLDivIcon({ html: '', className: '' });
    this._icon = document.createElement('div');
    this._syncIcon();
    this._marker = null;
    this._draggable = !!options.draggable;
  }
  _syncIcon() {
    const mapLibreClasses = Array.from(this._icon.classList || []).filter(cls => cls.startsWith('maplibregl-marker'));
    const customClasses = String(this._iconDef.className || '')
      .split(/\s+/)
      .filter(Boolean);
    const mergedClasses = Array.from(new Set([...mapLibreClasses, ...customClasses]));
    this._icon.className = mergedClasses.join(' ');
    this._icon.innerHTML = this._iconDef.html || '';
  }
  _addToRenderer(renderer) {
    const map = renderer._map;
    if (!map) return;
    this._marker = new maplibregl.Marker({ element: this._icon, draggable: this._draggable, anchor: 'center' })
      .setLngLat([this._latlng.lng, this._latlng.lat])
      .addTo(map);
    this._map = map;

    this._icon.addEventListener('click', (e) => {
      const ll = this.getLatLng();
      this._emit('click', { target: this, originalEvent: e, latlng: ll });
      if (this._popup) {
        if (this._clickPopup) this._clickPopup.remove();
        this._clickPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, className: this._popup.options?.className || '' })
          .setLngLat([ll.lng, ll.lat])
          .setHTML(this._popup.content)
          .addTo(map);
      }
    });
    this._icon.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const ll = this.getLatLng();
      this._emit('contextmenu', { target: this, originalEvent: e, latlng: ll });
    });
    this._icon.addEventListener('mouseenter', (e) => {
      const ll = this.getLatLng();
      this._emit('mouseover', { target: this, originalEvent: e, latlng: ll });
      if (this._tooltip && !this._tooltip.options?.permanent) this.openTooltip();
    });
    this._icon.addEventListener('mouseleave', (e) => {
      const ll = this.getLatLng();
      this._emit('mouseout', { target: this, originalEvent: e, latlng: ll });
      if (this._hoverPopup) {
        this._hoverPopup.remove();
        this._hoverPopup = null;
        this._emit('tooltipclose', { target: this });
      }
    });

    if (this._marker && this._draggable) {
      this._marker.on('dragend', () => this._emit('dragend', { target: this }));
    }
  }
  _removeFromRenderer() {
    if (this._clickPopup) this._clickPopup.remove();
    if (this._hoverPopup) this._hoverPopup.remove();
    if (this._marker) this._marker.remove();
    this._marker = null;
    this._map = null;
    this._emit('remove', { target: this });
  }
  getLatLng() {
    if (this._marker) {
      const ll = this._marker.getLngLat();
      return { lat: ll.lat, lng: ll.lng };
    }
    return { lat: this._latlng.lat, lng: this._latlng.lng };
  }
  setLatLng(latlng) {
    const ll = _toLngLat(latlng);
    this._latlng = ll;
    if (this._marker) this._marker.setLngLat([ll.lng, ll.lat]);
  }
  setOpacity(opacity) { this._icon.style.opacity = String(opacity); }
  setIcon(icon) {
    if (icon instanceof MLDivIcon) {
      this._iconDef = icon;
      this._syncIcon();
    }
  }
  openTooltip() {
    if (!this._map || !this._tooltip) return;
    const ll = this.getLatLng();
    if (this._hoverPopup) this._hoverPopup.remove();
    this._hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: this._tooltip.options?.className || '', offset: 12 })
      .setLngLat([ll.lng, ll.lat])
      .setHTML(this._tooltip.content)
      .addTo(this._map);
  }
}

class MLGeoLayer extends MLBaseLayer {
  constructor(geometry, style = {}) {
    super();
    this._geometry = geometry;
    this._style = style;
    this.options = { ...style };
    this._sourceId = `${this._id}-src`;
    this._fillLayerId = `${this._id}-fill`;
    this._lineLayerId = `${this._id}-line`;
    this._isLineOnly = geometry.type === 'LineString';
    this._handlers = [];
    this._addRetryTimer = null;
  }
  _addToRenderer(renderer) {
    const map = renderer._map;
    if (!map) return;
    if (this._map === map) return;
    if (!map.isStyleLoaded()) {
      if (this._addRetryTimer) return;
      this._addRetryTimer = setTimeout(() => {
        this._addRetryTimer = null;
        if (renderer._layerGroup && renderer._layerGroup.hasLayer(this)) {
          this._addToRenderer(renderer);
        }
      }, 60);
      return;
    }
    if (this._addRetryTimer) {
      clearTimeout(this._addRetryTimer);
      this._addRetryTimer = null;
    }
    const feature = { type: 'Feature', geometry: this._geometry, properties: {} };
    if (!map.getSource(this._sourceId)) {
      map.addSource(this._sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: [feature] } });
    }
    if (this._isLineOnly) {
      if (!map.getLayer(this._lineLayerId)) {
        map.addLayer({
          id: this._lineLayerId,
          source: this._sourceId,
          type: 'line',
          paint: {
            'line-color': this._style.color || '#3388ff',
            'line-opacity': this._style.opacity ?? 0.8,
            'line-width': this._style.weight ?? 2
          }
        });
      }
    } else {
      if (!map.getLayer(this._fillLayerId)) {
        map.addLayer({
          id: this._fillLayerId,
          source: this._sourceId,
          type: 'fill',
          paint: {
            'fill-color': this._style.fillColor || this._style.color || '#3388ff',
            'fill-opacity': this._style.fillOpacity ?? 0.3
          }
        });
      }
      if (!map.getLayer(this._lineLayerId)) {
        map.addLayer({
          id: this._lineLayerId,
          source: this._sourceId,
          type: 'line',
          paint: {
            'line-color': this._style.color || '#3388ff',
            'line-opacity': this._style.opacity ?? 0.8,
            'line-width': this._style.weight ?? 2
          }
        });
      }
    }
    this._map = map;
    if (this._handlers.length === 0) this._wireInteractions();
  }
  _wireInteractions() {
    if (!this._map) return;
    const layerId = this._isLineOnly ? this._lineLayerId : this._fillLayerId;
    const isTopLayerAtPoint = (e) => {
      try {
        const hits = this._map.queryRenderedFeatures(e.point);
        if (!hits || hits.length === 0) return false;
        const topLayerId = hits[0]?.layer?.id;
        return topLayerId === layerId;
      } catch (_) {
        return true;
      }
    };
    const onMove = (e) => {
      if (!isTopLayerAtPoint(e)) {
        if (this._hoverPopup) {
          this._hoverPopup.remove();
          this._hoverPopup = null;
          this._emit('tooltipclose', { target: this });
        }
        this._emit('mouseout', { target: this });
        return;
      }
      const ll = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      this._emit('mouseover', { target: this, latlng: ll, originalEvent: e.originalEvent || null });
      if (this._tooltip && !this._tooltip.options?.permanent) {
        if (this._hoverPopup) this._hoverPopup.remove();
        this._hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: this._tooltip.options?.className || '', offset: 10 })
          .setLngLat([ll.lng, ll.lat])
          .setHTML(this._tooltip.content)
          .addTo(this._map);
      }
    };
    const onLeave = () => {
      if (this._hoverPopup) {
        this._hoverPopup.remove();
        this._hoverPopup = null;
        this._emit('tooltipclose', { target: this });
      }
      this._emit('mouseout', { target: this });
    };
    const onClick = (e) => {
      if (!isTopLayerAtPoint(e)) return;
      if (this._popup) {
        if (this._clickPopup) this._clickPopup.remove();
        this._clickPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, className: this._popup.options?.className || '' })
          .setLngLat([e.lngLat.lng, e.lngLat.lat])
          .setHTML(this._popup.content)
          .addTo(this._map);
      }
    };
    this._map.on('mousemove', layerId, onMove);
    this._map.on('mouseleave', layerId, onLeave);
    this._map.on('click', layerId, onClick);
    this._handlers = [
      ['mousemove', layerId, onMove],
      ['mouseleave', layerId, onLeave],
      ['click', layerId, onClick]
    ];
  }
  _removeFromRenderer() {
    if (this._addRetryTimer) {
      clearTimeout(this._addRetryTimer);
      this._addRetryTimer = null;
    }
    if (!this._map) return;
    this._handlers.forEach(([eventName, layerId, fn]) => {
      try { this._map.off(eventName, layerId, fn); } catch (_) {}
    });
    this._handlers = [];
    if (this._clickPopup) this._clickPopup.remove();
    if (this._hoverPopup) this._hoverPopup.remove();
    [this._fillLayerId, this._lineLayerId].forEach(id => {
      if (this._map.getLayer(id)) this._map.removeLayer(id);
    });
    if (this._map.getSource(this._sourceId)) this._map.removeSource(this._sourceId);
    this._map = null;
    this._emit('remove', { target: this });
  }
  setStyle(stylePatch = {}) {
    this._style = { ...this._style, ...stylePatch };
    this.options = { ...this.options, ...stylePatch };
    if (!this._map) return;
    if (this._map.getLayer(this._lineLayerId)) {
      this._map.setPaintProperty(this._lineLayerId, 'line-color', this._style.color || '#3388ff');
      this._map.setPaintProperty(this._lineLayerId, 'line-opacity', this._style.opacity ?? 0.8);
      this._map.setPaintProperty(this._lineLayerId, 'line-width', this._style.weight ?? 2);
    }
    if (!this._isLineOnly && this._map.getLayer(this._fillLayerId)) {
      this._map.setPaintProperty(this._fillLayerId, 'fill-color', this._style.fillColor || this._style.color || '#3388ff');
      this._map.setPaintProperty(this._fillLayerId, 'fill-opacity', this._style.fillOpacity ?? 0.3);
    }
  }
  getBounds() {
    const coords = this._isLineOnly ? this._geometry.coordinates : (this._geometry.type === 'Polygon' ? this._geometry.coordinates[0] : this._geometry.coordinates[0][0]);
    const sum = coords.reduce((acc, c) => ({ lat: acc.lat + c[1], lng: acc.lng + c[0] }), { lat: 0, lng: 0 });
    const n = Math.max(1, coords.length);
    return { getCenter: () => ({ lat: sum.lat / n, lng: sum.lng / n }) };
  }
  openTooltip() {
    if (!this._map || !this._tooltip) return;
    const b = this.getBounds().getCenter();
    if (this._hoverPopup) this._hoverPopup.remove();
    this._hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: this._tooltip.options?.className || '' })
      .setLngLat([b.lng, b.lat])
      .setHTML(this._tooltip.content)
      .addTo(this._map);
  }
}

function _circleGeometry(lat, lng, radiusMeters, steps = 64) {
  const coords = [];
  const earth = 6371000;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const dLat = (radiusMeters * Math.sin(t)) / earth;
    const dLng = (radiusMeters * Math.cos(t)) / (earth * Math.cos(lat * Math.PI / 180));
    coords.push([lng + (dLng * 180 / Math.PI), lat + (dLat * 180 / Math.PI)]);
  }
  return { type: 'Polygon', coordinates: [coords] };
}

const MapRenderer = {
  _map: null,
  _layerGroup: null,
  _populationHoverTimeout: null,
  _populationHoverPopup: null,
  _populationSourceId: 'population-source',
  _populationFillLayerId: 'population-fill',
  _populationLineLayerId: 'population-line',
  _populationHoverAttached: false,
  _pmtilesProtocolAdded: false,

  createDivIcon(options) { return new MLDivIcon(options); },
  createMarker(latlng, options) { return new MLMarker(latlng, options); },
  createPolyline(latlngs, style) {
    const coords = (latlngs || []).map(p => [p[1], p[0]]);
    return new MLGeoLayer({ type: 'LineString', coordinates: coords }, style || {});
  },
  createGeoJsonGeometryLayer(geometry, style) {
    if (!geometry || !geometry.type || !Array.isArray(geometry.coordinates)) return null;
    return new MLGeoLayer(geometry, style || {});
  },
  createPolygon(latlngs, style) {
    let geometry = null;
    if (_isLatLngPair(latlngs?.[0])) {
      // single ring: [ [lat,lng], ... ]
      geometry = { type: 'Polygon', coordinates: [(latlngs || []).map(p => [p[1], p[0]])] };
    } else if (_isLatLngPair(latlngs?.[0]?.[0])) {
      // polygon with rings: [ ring[], ring[] ... ]
      geometry = { type: 'Polygon', coordinates: (latlngs || []).map(ring => ring.map(p => [p[1], p[0]])) };
    } else if (_isLatLngPair(latlngs?.[0]?.[0]?.[0])) {
      // multipolygon: [ polygon[rings], polygon[rings], ... ]
      geometry = { type: 'MultiPolygon', coordinates: (latlngs || []).map(poly => poly.map(ring => ring.map(p => [p[1], p[0]]))) };
    } else {
      geometry = { type: 'Polygon', coordinates: [] };
    }
    return new MLGeoLayer(geometry, style || {});
  },
  createCircle(latlng, style) {
    const ll = _toLngLat(latlng);
    const radius = style?.radius || 500;
    const geometry = _circleGeometry(ll.lat, ll.lng, radius);
    return new MLGeoLayer(geometry, style || {});
  },
  isMarker(layer) { return layer instanceof MLMarker; },
  isPolyline(layer) {
    return layer instanceof MLGeoLayer && layer._geometry?.type === 'LineString';
  },

  _renderPopulationLegend() {
    const el = document.getElementById('population-legend');
    if (!el) return;
    const ticks = [0, 10, 50, 100, 500, 2000];
    const fillForPop = (pop) => {
      if (pop < 10) return 'rgba(255,255,245,0.08)';
      if (pop < 50) return 'rgba(255,240,210,0.16)';
      if (pop < 100) return 'rgba(255,215,160,0.24)';
      if (pop < 500) return 'rgba(245,170,90,0.34)';
      if (pop < 2000) return 'rgba(215,120,50,0.44)';
      return 'rgba(170,80,30,0.55)';
    };
    let html = '<div class="population-legend-bar">';
    ticks.forEach(v => { html += `<span class="population-legend-segment" style="background:${fillForPop(v)}" title="${v}"></span>`; });
    html += '</div><div class="population-legend-labels">';
    ticks.forEach(v => { html += `<span class="population-legend-tick">${v}</span>`; });
    html += '</div>';
    el.innerHTML = html;
  },
  _setPopulationLegendVisible(visible) {
    const el = document.getElementById('population-legend');
    if (!el) return;
    el.style.display = visible ? 'block' : 'none';
  },

  _ensurePMTilesProtocol() {
    if (this._pmtilesProtocolAdded) return;
    if (typeof pmtiles === 'undefined' || typeof maplibregl === 'undefined') return;
    try {
      const protocol = new pmtiles.Protocol();
      maplibregl.addProtocol('pmtiles', protocol.tile);
      this._pmtilesProtocolAdded = true;
    } catch (_) {}
  },

  async setPopulationLayerVisible(visible) {
    if (!this._map) return;
    if (!this._map.isStyleLoaded()) {
      this._map.once('load', () => this.setPopulationLayerVisible(visible));
      return;
    }
    const url = (CONFIG.POPULATION_PMTILES_URL || '').trim();
    if (!url) return;
    if (!visible) {
      this._setPopulationLegendVisible(false);
      this._detachPopulationHover();
      if (this._map.getLayer(this._populationFillLayerId)) this._map.setLayoutProperty(this._populationFillLayerId, 'visibility', 'none');
      if (this._map.getLayer(this._populationLineLayerId)) this._map.setLayoutProperty(this._populationLineLayerId, 'visibility', 'none');
      return;
    }

    this._setPopulationLegendVisible(true);
    this._ensurePMTilesProtocol();
    const layerName = (CONFIG.POPULATION_LAYER_NAME && CONFIG.POPULATION_LAYER_NAME.trim()) || 'rasters-polys';
    const propName = (CONFIG.POPULATION_PROPERTY && CONFIG.POPULATION_PROPERTY.trim()) || 'Einwohner';
    const propLower = propName.toLowerCase();
    const maxNativeZoom = typeof CONFIG.POPULATION_LAYER_MAX_NATIVE_ZOOM === 'number'
      ? CONFIG.POPULATION_LAYER_MAX_NATIVE_ZOOM
      : ((typeof PopulationService !== 'undefined' && PopulationService.getPopulationPMTilesMaxZoom)
          ? await PopulationService.getPopulationPMTilesMaxZoom().catch(() => 14)
          : 14);

    if (!this._map.getSource(this._populationSourceId)) {
      this._map.addSource(this._populationSourceId, {
        type: 'vector',
        url: `pmtiles://${url}`,
        maxzoom: maxNativeZoom
      });
    }

    const popExpr = ['to-number', ['coalesce', ['get', propName], ['get', propLower], 0]];
    if (!this._map.getLayer(this._populationFillLayerId)) {
      this._map.addLayer({
        id: this._populationFillLayerId,
        type: 'fill',
        source: this._populationSourceId,
        'source-layer': layerName,
        paint: {
          'fill-color': [
            'step',
            popExpr,
            'rgba(255,255,245,0.08)',
            10, 'rgba(255,240,210,0.16)',
            50, 'rgba(255,215,160,0.24)',
            100, 'rgba(245,170,90,0.34)',
            500, 'rgba(215,120,50,0.44)',
            2000, 'rgba(170,80,30,0.55)'
          ]
        }
      });
    } else {
      this._map.setLayoutProperty(this._populationFillLayerId, 'visibility', 'visible');
    }
    if (!this._map.getLayer(this._populationLineLayerId)) {
      this._map.addLayer({
        id: this._populationLineLayerId,
        type: 'line',
        source: this._populationSourceId,
        'source-layer': layerName,
        paint: {
          'line-color': 'rgba(180,180,180,0.15)',
          'line-width': 0.8
        }
      });
    } else {
      this._map.setLayoutProperty(this._populationLineLayerId, 'visibility', 'visible');
    }
    this._attachPopulationHover();
  },

  _attachPopulationHover() {
    if (!this._map || this._populationHoverAttached) return;
    this._populationHoverAttached = true;
    const onMove = (e) => {
      if (this._populationHoverTimeout) clearTimeout(this._populationHoverTimeout);
      this._populationHoverTimeout = setTimeout(async () => {
        const lat = e.lngLat.lat;
        const lng = e.lngLat.lng;
        if (typeof PopulationService === 'undefined' || !PopulationService.getPopulationAtPoint) return;
        const result = await PopulationService.getPopulationAtPoint(lat, lng).catch(() => null);
        if (this._populationHoverPopup) this._populationHoverPopup.remove();
        if (result && result.population != null) {
          this._populationHoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'population-tooltip', offset: 10 })
            .setLngLat([lng, lat])
            .setHTML(`Einwohner: ${result.population}`)
            .addTo(this._map);
        }
      }, 80);
    };
    const onOut = () => {
      if (this._populationHoverPopup) this._populationHoverPopup.remove();
      this._populationHoverPopup = null;
    };
    this._map.on('mousemove', this._populationFillLayerId, onMove);
    this._map.on('mouseleave', this._populationFillLayerId, onOut);
    this._populationHoverMove = onMove;
    this._populationHoverOut = onOut;
  },
  _detachPopulationHover() {
    if (!this._map || !this._populationHoverAttached) return;
    if (this._populationHoverMove) this._map.off('mousemove', this._populationFillLayerId, this._populationHoverMove);
    if (this._populationHoverOut) this._map.off('mouseleave', this._populationFillLayerId, this._populationHoverOut);
    this._populationHoverAttached = false;
    if (this._populationHoverPopup) this._populationHoverPopup.remove();
    this._populationHoverPopup = null;
  },

  init() {
    const map = new maplibregl.Map({
      container: 'map',
      center: [CONFIG.MAP_CENTER[1], CONFIG.MAP_CENTER[0]],
      zoom: CONFIG.MAP_ZOOM,
      style: 'https://tiles.openfreemap.org/styles/positron'
    });
    map.addControl(new maplibregl.NavigationControl(), 'bottom-left');
    map.setView = (latlng, zoom) => {
      const ll = _toLngLat(latlng);
      map.easeTo({ center: [ll.lng, ll.lat], zoom: zoom ?? map.getZoom() });
    };
    this._map = map;
    this._layerGroup = new MLLayerGroup(this);
    State.setMap(map);
    State.setLayerGroup(this._layerGroup);

    map.on('click', (e) => EventBus.emit(Events.MAP_CLICK, { latlng: { lat: e.lngLat.lat, lng: e.lngLat.lng } }));
    let zoomUpdateTimeout = null;
    const onViewChange = () => {
      if (zoomUpdateTimeout) clearTimeout(zoomUpdateTimeout);
      zoomUpdateTimeout = setTimeout(() => {
        zoomUpdateTimeout = null;
        Visualization.updatePoiIcons();
      }, 100);
    };
    map.on('zoomend', onViewChange);
    map.on('moveend', onViewChange);

    this._initContextMenu();

    const populationWeightGroup = Utils.getElement('#population-weight-group');
    const populationLayerCheckbox = Utils.getElement('#config-population-layer-visible');
    const populationWeightCheckbox = Utils.getElement('#config-population-weight-starts');
    if ((CONFIG.POPULATION_PMTILES_URL || '').trim()) {
      if (populationWeightGroup) populationWeightGroup.style.display = 'block';
      this._renderPopulationLegend();
      this._setPopulationLegendVisible(!!CONFIG.POPULATION_LAYER_VISIBLE);
      if (populationLayerCheckbox) {
        populationLayerCheckbox.checked = !!CONFIG.POPULATION_LAYER_VISIBLE;
        populationLayerCheckbox.addEventListener('change', () => {
          CONFIG.POPULATION_LAYER_VISIBLE = populationLayerCheckbox.checked;
          this.setPopulationLayerVisible(CONFIG.POPULATION_LAYER_VISIBLE);
        });
        if (CONFIG.POPULATION_LAYER_VISIBLE) this.setPopulationLayerVisible(true);
      }
      if (populationWeightCheckbox) {
        populationWeightCheckbox.addEventListener('change', async () => {
          const lastTarget = State.getLastTarget();
          const lastStarts = State.getLastStarts();
          if (!lastTarget || !lastStarts || lastStarts.length === 0 || isRememberMode()) return;
          try {
            MapRenderer.removePolylines(State.getRoutePolylines());
            MapRenderer.clearRoutes();
            State.setRoutePolylines([]);
            const routeInfo = await RouteService.calculateRoutes(lastTarget, { reuseStarts: false });
            if (routeInfo) {
              Visualization.updateDistanceHistogram(routeInfo.starts, lastTarget, { routeData: routeInfo.routeData, routeDistances: RouteService.getRouteDistances(routeInfo) });
              EventBus.emit(Events.ROUTES_CALCULATED, { target: lastTarget, routeInfo });
            }
          } catch (e) {
            if (typeof Utils !== 'undefined' && Utils.logError) Utils.logError('MapRenderer', e);
          }
        });
      }
    } else if (populationWeightGroup) {
      populationWeightGroup.style.display = 'none';
    }
    EventBus.emit(Events.MAP_READY);
  },

  _initContextMenu() {
    const contextMenu = Utils.getElement('#context-menu');
    if (!contextMenu || !this._map) return;
    let contextMenuLatLng = null;
    this._map.on('contextmenu', (e) => {
      if (e.originalEvent) e.originalEvent.preventDefault();
      contextMenuLatLng = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      contextMenu.style.left = `${e.point.x}px`;
      contextMenu.style.top = `${e.point.y}px`;
      contextMenu.style.display = 'block';
      const osmQueryLink = Utils.getElement('#context-menu-osm-query');
      if (osmQueryLink) osmQueryLink.href = `https://www.openstreetmap.org/query?lat=${contextMenuLatLng.lat}&lon=${contextMenuLatLng.lng}`;
    });

    const setEndBtn = Utils.getElement('#context-menu-set-end');
    if (setEndBtn) {
      setEndBtn.addEventListener('click', () => {
        if (!contextMenuLatLng) return;
        contextMenu.style.display = 'none';
        EventBus.emit(Events.MAP_CLICK, { latlng: contextMenuLatLng });
      });
    }
    const searchRadius = 600;
    const runPoiSearch = async (searchFn, entityLabel, getMarkers, setMarkers, drawFn, drawRadiusFn, clearRadiusFn) => {
      if (!contextMenuLatLng) return;
      contextMenu.style.display = 'none';
      clearRadiusFn();
      drawRadiusFn(contextMenuLatLng.lat, contextMenuLatLng.lng, searchRadius);
      Utils.showInfo(`Suche nach ${entityLabel}...`, false);
      try {
        const places = await searchFn(contextMenuLatLng.lat, contextMenuLatLng.lng, searchRadius);
        if (places.length === 0) {
          Utils.showInfo(`Keine ${entityLabel} in der Nähe gefunden.`, false);
          setTimeout(() => clearRadiusFn(), 3000);
          return;
        }
        const oldLayers = getMarkers() || [];
        const newLayers = drawFn(places);
        setMarkers([...oldLayers, ...newLayers]);
        Utils.showInfo(`${places.length} ${entityLabel} gefunden.`, false);
        setTimeout(() => clearRadiusFn(), 3000);
        const points = newLayers.map(l => (l.getLatLng ? l.getLatLng() : (l.getBounds ? l.getBounds().getCenter() : null))).filter(Boolean).concat([contextMenuLatLng]);
        if (points.length) {
          let minLng = points[0].lng, maxLng = points[0].lng, minLat = points[0].lat, maxLat = points[0].lat;
          points.forEach(p => {
            minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
            minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
          });
          this._map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 50, maxZoom: 16 });
        }
      } catch (error) {
        console.error('Fehler bei POI-Suche:', error);
        Utils.showError(`Fehler beim Laden der ${entityLabel}.`, true);
      }
    };
    const cafesBtn = Utils.getElement('#context-menu-cafes');
    if (cafesBtn) cafesBtn.addEventListener('click', () => runPoiSearch(OverpassService.searchCafes.bind(OverpassService), 'Cafés', State.getCafeMarkers.bind(State), State.setCafeMarkers.bind(State), Visualization.drawCafes.bind(Visualization), Visualization.drawCafeSearchRadius.bind(Visualization), Visualization.clearCafeSearchRadius.bind(Visualization)));
    const restaurantsBtn = Utils.getElement('#context-menu-restaurants');
    if (restaurantsBtn) restaurantsBtn.addEventListener('click', () => runPoiSearch(OverpassService.searchRestaurants.bind(OverpassService), 'Restaurants', State.getRestaurantMarkers.bind(State), State.setRestaurantMarkers.bind(State), Visualization.drawRestaurants.bind(Visualization), Visualization.drawRestaurantSearchRadius.bind(Visualization), Visualization.clearRestaurantSearchRadius.bind(Visualization)));
    const barsBtn = Utils.getElement('#context-menu-bars');
    if (barsBtn) barsBtn.addEventListener('click', () => runPoiSearch(OverpassService.searchBars.bind(OverpassService), 'Bars/Kneipen', State.getBarMarkers.bind(State), State.setBarMarkers.bind(State), Visualization.drawBars.bind(Visualization), Visualization.drawBarSearchRadius.bind(Visualization), Visualization.clearBarSearchRadius.bind(Visualization)));

    document.addEventListener('click', (e) => {
      if (contextMenu && !contextMenu.contains(e.target)) contextMenu.style.display = 'none';
      const targetContextMenu = Utils.getElement('#target-context-menu');
      if (targetContextMenu && !targetContextMenu.contains(e.target)) targetContextMenu.style.display = 'none';
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (contextMenu) contextMenu.style.display = 'none';
      const targetContextMenu = Utils.getElement('#target-context-menu');
      if (targetContextMenu) targetContextMenu.style.display = 'none';
    });
  },

  getMap() { return this._map; },
  getLayerGroup() { return this._layerGroup; },

  clearLayersExceptSchools() {
    State.setCurrentTargetMarker(null);
    if (!this._layerGroup) return;
    const cafeLayers = new Set(State.getCafeMarkers() || []);
    const restaurantLayers = new Set(State.getRestaurantMarkers() || []);
    const barLayers = new Set(State.getBarMarkers() || []);
    const radiusCircles = [State.getCafeSearchRadiusCircle(), State.getRestaurantSearchRadiusCircle(), State.getBarSearchRadiusCircle()];
    const toRemove = [];
    this._layerGroup.eachLayer(layer => {
      const isPoi = cafeLayers.has(layer) || restaurantLayers.has(layer) || barLayers.has(layer) || layer._isPoiLayer === true;
      const isRadius = radiusCircles.includes(layer);
      if (!isPoi && !isRadius) toRemove.push(layer);
    });
    toRemove.forEach(layer => this._layerGroup.removeLayer(layer));
  },
  clearRoutes() {
    if (!this._layerGroup) return;
    const toRemove = [];
    this._layerGroup.eachLayer(layer => {
      if (layer._isIsochroneLayer) toRemove.push(layer);
      else if (this.isPolyline(layer) && !layer._isPoiLayer) toRemove.push(layer);
    });
    toRemove.forEach(layer => this._layerGroup.removeLayer(layer));
  },
  clearIsochrones() {
    if (!this._layerGroup) return;
    const layers = State.getIsochronePolygonLayers();
    (layers || []).forEach(layer => { if (layer) this._layerGroup.removeLayer(layer); });
    State.setIsochronePolygonLayers([]);
    const savedMarkers = State.getSavedIsochroneMarkers();
    (savedMarkers || []).forEach(m => { if (m) this._layerGroup.removeLayer(m); });
    State.setSavedIsochroneMarkers([]);
    const currentMarker = State.getCurrentTargetMarker();
    if (currentMarker) {
      this._layerGroup.removeLayer(currentMarker);
      State.setCurrentTargetMarker(null);
    }
    State.setLastIsochroneResult(null);
  },
  clearOverlap() {
    if (!this._layerGroup) return;
    const layers = State.getOverlapPolygonLayers();
    (layers || []).forEach(layer => { if (layer) this._layerGroup.removeLayer(layer); });
    State.setOverlapPolygonLayers([]);
  },
  removePolylines(polylines) {
    if (!this._layerGroup || !polylines) return;
    polylines.forEach(polyline => { if (polyline) this._layerGroup.removeLayer(polyline); });
  }
};

