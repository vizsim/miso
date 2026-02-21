// ==== Karten-Layer-Steuerung (Basemap, Terrain, Hillshade) ====

(function () {
  const THUMB_BASE = 'https://raw.githubusercontent.com/vizsim/missing_mapillary_gh-routing/main/thumbs';
  const THUMB_URLS = {
    standard: THUMB_BASE + '/thumb-standard.png',
    osm: THUMB_BASE + '/thumb-osm.png',
    satellite: THUMB_BASE + '/thumb-satellite.png'
  };

  let _currentOverlay = 'none';  // 'none' | 'osm' | 'satellite'

  function getMap() {
    if (typeof State !== 'undefined' && State.getMap) return State.getMap();
    if (typeof MapRenderer !== 'undefined' && MapRenderer.getMap) return MapRenderer.getMap();
    return null;
  }

  /**
   * Apply basemap overlay visibility and terrain/hillshade from UI state.
   * Called after each style load so state is restored.
   */
  function applyMapLayerState(map) {
    if (!map || !map.getStyle()) return;
    try {
      if (map.getLayer('osm-layer')) {
        map.setLayoutProperty('osm-layer', 'visibility', _currentOverlay === 'osm' ? 'visible' : 'none');
      }
      if (map.getLayer('satellite-layer')) {
        map.setLayoutProperty('satellite-layer', 'visibility', _currentOverlay === 'satellite' ? 'visible' : 'none');
      }
      if (map.getLayer('hillshade-layer')) {
        const hillEl = document.getElementById('toggleHillshade');
        const vis = hillEl && hillEl.checked ? 'visible' : 'none';
        map.setLayoutProperty('hillshade-layer', 'visibility', vis);
      }
      applyTerrainFromCheckbox(map);
      // Overlay-Zustand aus UI wiederherstellen (ÖPNV, Einwohner)
      document.querySelectorAll('.overlay-tile').forEach(function (btn) {
        const overlay = btn.getAttribute('data-overlay');
        const isActive = btn.classList.contains('active');
        if (overlay && typeof window._setOverlayVisibility === 'function') {
          window._setOverlayVisibility(overlay, isActive);
        }
      });
    } catch (e) {
      console.warn('applyMapLayerState:', e);
    }
  }

  function applyTerrainFromCheckbox(map) {
    if (!map || !map.getSource('terrain')) return;
    try {
      const terrainEl = document.getElementById('toggleTerrain');
      if (terrainEl && terrainEl.checked) {
        map.setTerrain({ source: 'terrain', exaggeration: 1.5 });
      } else {
        map.setTerrain(null);
      }
    } catch (e) {
      console.warn('applyTerrainFromCheckbox:', e);
    }
  }

  function setBasemapButtonsEnabled(enabled) {
    document.querySelectorAll('.basemap-btn').forEach(function (btn) {
      btn.disabled = !enabled;
      btn.style.pointerEvents = enabled ? '' : 'none';
      btn.style.opacity = enabled ? '' : '0.6';
    });
  }

  window._applyMapLayerState = applyMapLayerState;
  window._applyTerrainFromCheckbox = applyTerrainFromCheckbox;

  function setBasemapSelection(mapKey) {
    document.querySelectorAll('.basemap-btn').forEach(function (btn) {
      btn.classList.toggle('selected', btn.getAttribute('data-map') === mapKey);
    });
  }

  function setupThumbnails() {
    document.querySelectorAll('.basemap-btn').forEach(function (btn) {
      const key = btn.getAttribute('data-map');
      if (key && THUMB_URLS[key]) {
        btn.style.backgroundImage = "url('" + THUMB_URLS[key] + "')";
      }
    });
  }

  function init() {
    const map = getMap();
    if (!map) return;

    setBasemapButtonsEnabled(true);
    setupThumbnails();

    // Basemap buttons
    document.querySelectorAll('.basemap-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (this.disabled) return;
        const key = this.getAttribute('data-map');
        if (!key) return;

        const isStandard = key === 'standard';
        const isOsm = key === 'osm';
        const isSatellite = key === 'satellite';

        if (isStandard) {
          _currentOverlay = 'none';
          try {
            if (map.getLayer('osm-layer')) map.setLayoutProperty('osm-layer', 'visibility', 'none');
            if (map.getLayer('satellite-layer')) map.setLayoutProperty('satellite-layer', 'visibility', 'none');
          } catch (e) {}
          setBasemapSelection(key);
        } else if (isOsm || isSatellite) {
          _currentOverlay = isOsm ? 'osm' : (isSatellite ? 'satellite' : 'none');
          if (typeof window._ensureBasemapOverlayLayers === 'function') {
            window._ensureBasemapOverlayLayers();
          }
          function applyOverlay() {
            try {
              if (map.getLayer('osm-layer')) {
                map.setLayoutProperty('osm-layer', 'visibility', isOsm ? 'visible' : 'none');
              }
              if (map.getLayer('satellite-layer')) {
                map.setLayoutProperty('satellite-layer', 'visibility', isSatellite ? 'visible' : 'none');
              }
            } catch (e) {
              console.warn('Basemap overlay switch:', e);
            }
          }
          applyOverlay();
          if (!map.getLayer('osm-layer') || !map.getLayer('satellite-layer')) {
            setTimeout(applyOverlay, 150);
          }
          setBasemapSelection(key);
        }
      });
    });

    // Map settings panel open/close
    const settingsToggle = document.getElementById('map-settings-toggle');
    const settingsPanel = document.getElementById('map-settings-panel');
    const settingsMenu = document.getElementById('map-settings-menu');
    if (settingsToggle && settingsPanel && settingsMenu) {
      settingsToggle.addEventListener('click', function (e) {
        e.stopPropagation();
        settingsPanel.classList.toggle('hidden');
      });
      document.addEventListener('click', function (e) {
        if (!settingsMenu.contains(e.target)) {
          settingsPanel.classList.add('hidden');
        }
      });
    }

    // Terrain
    const terrainToggle = document.getElementById('toggleTerrain');
    if (terrainToggle) {
      terrainToggle.addEventListener('change', function () {
        const m = getMap();
        if (!m) return;
        if (this.checked && m.getSource('terrain')) {
          m.setTerrain({ source: 'terrain', exaggeration: 1.5 });
        } else {
          m.setTerrain(null);
        }
      });
    }

    // Hillshade
    const hillshadeToggle = document.getElementById('toggleHillshade');
    if (hillshadeToggle) {
      hillshadeToggle.addEventListener('change', function () {
        const m = getMap();
        if (!m || !m.getLayer('hillshade-layer')) return;
        m.setLayoutProperty('hillshade-layer', 'visibility', this.checked ? 'visible' : 'none');
      });
    }

    // Overlay-Kacheln: UI-Toggle + Layer ein-/ausblenden
    const einwohnerTile = document.querySelector('.overlay-tile[data-overlay="einwohner"]');
    if (einwohnerTile && typeof CONFIG !== 'undefined' && CONFIG.POPULATION_LAYER_VISIBLE) {
      einwohnerTile.classList.add('active');
    }
    document.querySelectorAll('.overlay-tile').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (this.disabled) return;
        this.classList.toggle('active');
        const overlay = this.getAttribute('data-overlay');
        const isActive = this.classList.contains('active');
        if (typeof window._setOverlayVisibility === 'function') {
          window._setOverlayVisibility(overlay, isActive);
        }
      });
    });

  }

  function runWhenMapReady() {
    if (getMap()) {
      init();
      return;
    }
    if (typeof EventBus !== 'undefined' && typeof Events !== 'undefined') {
      EventBus.on(Events.MAP_READY, function onReady() {
        EventBus.off(Events.MAP_READY, onReady);
        init();
      });
    } else {
      setTimeout(runWhenMapReady, 50);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runWhenMapReady);
  } else {
    runWhenMapReady();
  }
})();
