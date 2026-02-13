// ==== Haupt-Orchestrierung (neu strukturiert) ====
const App = {
  /**
   * Initialisiert die Anwendung
   */
  async init() {
    this._overlapComputeWorker = null;
    this._overlapWorkerReqSeq = 1;
    this._overlapWorkerPending = new Map();
    this._overlapComputeCache = new Map();
    this._savedIsochroneGeometryVersionById = {};
    this._overlapRecomputeRunId = 0;
    this._lastSystemOptimalConsoleStatus = '';

    // Map initialisieren
    MapRenderer.init();
    
    // UI-Komponenten initialisieren
    await this._initUI();
    
    // Event-Listener registrieren
    this._registerEventListeners();
    
    // Panel Collapse Handler
    this._setupPanelCollapse();
    
    console.log('App initialisiert');
  },
  
  /**
   * Initialisiert UI-Komponenten
   */
  async _initUI() {
    // Targets-List initialisieren
    TargetsList.init();
    
    // Initiale Sichtbarkeit der Targets-Liste setzen
    TargetsList.toggle(CONFIG.REMEMBER_TARGETS);
    
    // Geocoder initialisieren
    Geocoder.init((lat, lng, suggestion) => {
      this._handleGeocoderSelect(lat, lng, suggestion);
    });
    
    // Initiale Aggregation-UI Sichtbarkeit setzen
    if (typeof toggleAggregationUI === 'function') {
      toggleAggregationUI();
    }
    
    // Export-Button Handler und initialer Status
    const exportBtn = Utils.getElement('#export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        ExportService.exportToGeoJSON();
      });
      exportBtn.disabled = !State.getLastIsochroneResult() && (!State.getSavedIsochrones() || State.getSavedIsochrones().length === 0);
    }

    this._isochroneCalculating = false;
    const calcBtn = Utils.getElement('#btn-calculate-isochrone');
    if (calcBtn) {
      calcBtn.addEventListener('click', () => this._onCalculateIsochroneClick());
    }
    this._updateCalculateIsochroneButton();
    
    SavedIsochronesList.init();
    SavedIsochronesList.toggle(CONFIG.REMEMBER_ISOCHRONE_STARTS);
    if (SavedIsochronesList.update) SavedIsochronesList.update();
    this._applyTransitProfileAvailability();
    
    this._setupRememberIsochroneStarts();
    this._setupOptimizationOverlap();
    this._initOverlapComputeWorker();
    
    // Hinweis „Noch kein Ziel“ initial anzeigen/verstecken
    this._updateNoTargetHint();
    // Histogramm-Platzhalter anzeigen (keine Routen)
    Visualization.updateDistanceHistogram([], null, {});
  },

  _applyTransitProfileAvailability() {
    const enabled = (typeof isTransitProfileEnabled === 'function') ? isTransitProfileEnabled() : true;
    const mainTransitBtn = Utils.getElement('#profile-transit');
    const editTransitBtn = document.querySelector('#edit-isochrone-profile-btns .edit-profile-btn[data-profile="transit"]');
    if (mainTransitBtn) mainTransitBtn.style.display = enabled ? '' : 'none';
    if (editTransitBtn) {
      editTransitBtn.style.display = enabled ? '' : 'none';
      if (!enabled) editTransitBtn.classList.remove('active');
    }

    if (!enabled && String(CONFIG.PROFILE || '').toLowerCase() === 'transit') {
      CONFIG.PROFILE = 'foot';
    }

    const mainBtns = Utils.getElements('.profile-btn:not(.edit-profile-btn)');
    if (mainBtns && mainBtns.length) {
      let hasActiveVisible = false;
      mainBtns.forEach((btn) => {
        const profile = btn.dataset.profile || '';
        if (profile === 'transit' && !enabled) return;
        const shouldBeActive = profile === CONFIG.PROFILE;
        btn.classList.toggle('active', shouldBeActive);
        if (shouldBeActive) hasActiveVisible = true;
      });
      if (!hasActiveVisible) {
        const fallback = Array.from(mainBtns).find(btn => (btn.dataset.profile || '') === 'foot');
        if (fallback) {
          fallback.classList.add('active');
          CONFIG.PROFILE = 'foot';
        }
      }
    }
  },

  _initOverlapComputeWorker() {
    OverlapController.initOverlapComputeWorker(this);
  },

  _runOverlapWorkerTask(type, payload) {
    return OverlapController.runOverlapWorkerTask(this, type, payload);
  },
  
  /**
   * Zeigt oder versteckt den Hinweis „Noch kein Ziel“ je nach Ziel-Status
   */
  _updateNoTargetHint() {
    const hint = Utils.getElement('#no-target-hint');
    if (!hint) return;
    const saved = State.getSavedIsochrones();
    const hasTarget = State.getLastTarget() !== null || State.getLastIsochroneResult() !== null || (saved && saved.length > 0);
    hint.classList.toggle('is-hidden', hasTarget);
  },

  _updateCalculateIsochroneButton() {
    const btn = Utils.getElement('#btn-calculate-isochrone');
    if (!btn) return;
    const loading = !!this._isochroneCalculating;
    const hasTarget = State.getLastTarget() !== null;
    btn.textContent = loading ? 'Berechne....' : 'Isochronen berechnen';
    btn.disabled = loading || !hasTarget;
  },

  async _onCalculateIsochroneClick() {
    const center = State.getLastTarget();
    if (!center) return;
    this._getIsochroneParamsFromUI();
    if (isRememberIsochroneStarts()) {
      const result = await IsochroneService.fetchIsochrone(center, {
        time_limit: CONFIG.ISOCHRONE_TIME_LIMIT,
        buckets: CONFIG.ISOCHRONE_BUCKETS,
        profile: CONFIG.PROFILE,
        silent: true
      });
      if (result) {
        const saved = State.getSavedIsochrones();
        const idx = saved.findIndex(item => item.center && item.center[0] === center[0] && item.center[1] === center[1]);
        if (idx >= 0) {
          saved[idx] = { ...saved[idx], ...result };
          State.setSavedIsochrones([...saved]);
          // Bestehenden Startpunkt inkrementell aktualisieren.
          this._replaceSavedIsochroneRenderAtIndex(idx);
        } else {
          const id = State.getNextIsochroneId();
          State.incrementNextIsochroneId();
          saved.push({ id, visible: true, color: '#3388ff', ...result });
          State.setSavedIsochrones(saved);
          // Neuer Startpunkt: inkrementell rendern statt alles neu zu zeichnen.
          this._appendSavedIsochroneRender(saved[saved.length - 1], saved.length - 1);
        }
        SavedIsochronesList.update();
      }
    } else {
      await IsochroneService.fetchIsochrone(center, {
        time_limit: CONFIG.ISOCHRONE_TIME_LIMIT,
        buckets: CONFIG.ISOCHRONE_BUCKETS,
        profile: CONFIG.PROFILE
      });
    }
  },

  /**
   * Registriert Event-Listener
   */
  _registerEventListeners() {
    // Map-Click
    EventBus.on(Events.MAP_CLICK, (data) => {
      this.handleMapClick(data.latlng);
    });
    
    EventBus.on(Events.ISOCHRONE_CALCULATING, (data) => {
      this._isochroneCalculating = !!data.active;
      this._updateCalculateIsochroneButton();
      
      // Transit-Panel aktualisieren (Abfahrtszeit wird bei jeder Berechnung neu gesetzt)
      if (data.active && CONFIG.PROFILE === 'transit') {
        ConfigSetupHandlers.updateTransitInfoPanel();
      }
    });

    // Isochrone berechnet
    EventBus.on(Events.ISOCHRONE_CALCULATED, (data) => {
      if (isRememberIsochroneStarts()) {
        const id = State.getNextIsochroneId();
        State.incrementNextIsochroneId();
        const saved = State.getSavedIsochrones();
        saved.push({ id, visible: true, color: '#3388ff', ...data });
        State.setSavedIsochrones(saved);
        this._appendSavedIsochroneRender(saved[saved.length - 1], saved.length - 1);
        SavedIsochronesList.update();
      } else {
        MapRenderer.clearIsochrones();
        const layers = IsochroneRenderer.drawIsochrones(data);
        State.setIsochronePolygonLayers(layers);
        State.setLastIsochroneResult(data);
      }
      this._updateNoTargetHint();
      this._updateCalculateIsochroneButton();
    const exportBtn = Utils.getElement('#export-btn');
    if (exportBtn) {
      exportBtn.disabled = false;
      exportBtn.title = 'Isochrone(n) als GeoJSON herunterladen';
    }
    });
    
    // Routes berechnet
    EventBus.on(Events.ROUTES_CALCULATED, (data) => {
      RouteHandler.handleRoutesCalculated(data);
    });
    
    // Route aktualisiert
    EventBus.on(Events.ROUTE_UPDATED, (data) => {
      RouteHandler.handleRouteUpdated(data);
    });
    
    // Target hinzugefügt
    EventBus.on(Events.TARGET_ADDED, (data) => {
      // Verwaiste Marker entfernen (bevor neuer Marker hinzugefügt wird)
      Visualization.cleanupOrphanedTargetMarkers();
      // Marker zeichnen (falls noch nicht vorhanden)
      const targetMarkers = State.getTargetMarkers();
      if (!targetMarkers[data.index]) {
        const marker = Visualization.drawTargetPoint(data.target, data.index, data.targetId);
        // Stelle sicher, dass das Array groß genug ist
        while (targetMarkers.length <= data.index) {
          targetMarkers.push(null);
        }
        targetMarkers[data.index] = marker;
        State.setTargetMarkers(targetMarkers);
        // currentTargetMarker zurücksetzen, da der Marker jetzt in targetMarkers ist
        State.setCurrentTargetMarker(null);
      }
      // Liste aktualisieren
      TargetsList.update();
      this._updateNoTargetHint();
    });
    
    // Target entfernt
    EventBus.on(Events.TARGET_REMOVED, (data) => {
      // Verwaiste Marker entfernen
      Visualization.cleanupOrphanedTargetMarkers();
      // Liste aktualisieren
      TargetsList.update();
      if (isRememberMode()) {
        EventBus.emit(Events.VISUALIZATION_UPDATE);
      }
      RouteHandler._updateExportButtonState();
      this._updateNoTargetHint();
      // Wenn keine Routen mehr: Histogramm-Platzhalter anzeigen
      const hasRoutes = isRememberMode()
        ? State.getTargetRoutes().length > 0
        : State.getAllRouteData().length > 0;
      if (!hasRoutes) {
        Visualization.updateDistanceHistogram([], null, {});
      }
    });
    
    // Visualization Update
    EventBus.on(Events.VISUALIZATION_UPDATE, () => {
      if (isRememberMode()) {
        RouteRenderer.drawAllTargetRoutes();
      }
    });
    
    // Config geändert
    EventBus.on(Events.CONFIG_CHANGED, () => {
      this._handleConfigChanged();
    });
    
    // Config: Profil geändert (nur im Einzelmodus neu berechnen)
    EventBus.on(Events.CONFIG_PROFILE_CHANGED, async (data) => {
      if (isRememberIsochroneStarts()) return;
      const center = State.getLastTarget();
      if (center) {
        const { timeLimitSec, buckets } = this._getIsochroneParamsFromUI();
        Utils.showInfo('Isochrone wird neu berechnet…', false);
        await IsochroneService.fetchIsochrone(center, {
          time_limit: timeLimitSec,
          buckets,
          profile: CONFIG.PROFILE
        });
        Utils.showInfo('', false);
      }
    });
    
    // Config: Aggregation geändert
    EventBus.on(Events.CONFIG_AGGREGATION_CHANGED, () => {
      if (isRememberMode()) {
        RouteRenderer.drawAllTargetRoutes();
      } else {
        this._redrawCurrentRoutes();
      }
    });
    
    // Config: Remember Targets geändert
    this._setupRememberTargetsHandler();
    
    // Target Hover (für Marker-Highlighting)
    EventBus.on(Events.TARGET_HOVER, (data) => {
      Visualization.highlightTargetMarker(data.index);
    });
    
    EventBus.on(Events.TARGET_UNHOVER, () => {
      Visualization.unhighlightAllTargetMarkers();
    });
    
    // Profil-Buttons und Aggregation-Toggle
    this._setupProfileButtons();
    this._setupAggregationToggle();
    this._setupAggregationMethod();
    
    // Isochrone-Parameter (Zeitlimit, Buckets)
    this._setupIsochroneParams();
    
    // Anzahl Routen und Radius (für ggf. spätere Nutzung ausgeblendet)
    this._setupRouteCountInput();
    this._setupRadiusInput();
    
    // Längenverteilungs-Buttons
    if (document.querySelector('.distribution-buttons')) {
      DistributionSelector.init();
    }

    // Histogramm-Modus: Beeline vs. Echte Routenlänge
    this._setupHistogramModeButtons();
    
    // Colormap-Selector
    ColormapSelector.init();
    
    // Route-Warnung initialisieren
    RouteWarning.init();
    
    // Startpunkte ausblenden
    this._setupHideStartPoints();
    
    // Zielpunkte ausblenden
    this._setupHideTargetPoints();
  },
  
  /**
   * Richtet die Profil-Buttons ein
   */
  _setupProfileButtons() {
    ConfigSetupHandlers.setupProfileButtons(this);
  },

  /**
   * Histogramm-Modus: Beeline vs. Echte Routenlänge
   */
  _setupHistogramModeButtons() {
    ConfigSetupHandlers.setupHistogramModeButtons(this);
  },
  
  /**
   * Richtet den Aggregation-Toggle ein
   */
  _setupAggregationToggle() {
    ConfigSetupHandlers.setupAggregationToggle(this);
  },
  
  /**
   * Richtet die Aggregierungsmethode ein
   */
  _setupAggregationMethod() {
    ConfigSetupHandlers.setupAggregationMethod(this);
  },
  
  
  /**
   * Berechnet Routen für einen Zielpunkt neu und aktualisiert die Anzeige
   */
  async _recalculateTargetRoutes(target, targetIndex) {
    if (!isRememberMode()) return;
    
    // Routen neu berechnen
    const routeInfo = await RouteService.calculateRoutes(target, { silent: true });
    if (!routeInfo) return;
    
    // RouteInfo im targetRoutes aktualisieren
    const targetRoutes = State.getTargetRoutes();
    const targetRouteIndex = targetRoutes.findIndex(tr => 
      TargetService.isEqual(tr.target, target)
    );
    
    if (targetRouteIndex >= 0) {
      targetRoutes[targetRouteIndex] = {
        target: target,
        routeData: routeInfo.routeData,
        routeResponses: routeInfo.routeResponses,
        routePolylines: [],
        starts: routeInfo.starts,
        colors: routeInfo.colors,
        distributionType: routeInfo.distributionType,
        config: routeInfo.config
      };
      State.setTargetRoutes(targetRoutes);
    }
    
    // Alle Routen neu zeichnen
    RouteRenderer.drawAllTargetRoutes();
    
    // Startpunkte anzeigen
    if (routeInfo.starts && routeInfo.colors) {
      Visualization._clearStartMarkers();
      Visualization.drawStartPoints(routeInfo.starts, routeInfo.colors, target);
    }
    
    // Histogramm aktualisieren
    if (routeInfo.starts && routeInfo.starts.length > 0) {
      Visualization.updateDistanceHistogram(routeInfo.starts, target, { routeData: routeInfo.routeData, routeDistances: RouteService.getRouteDistances(routeInfo) });
    }
    
    // Panel aktualisieren (damit Config-Informationen angezeigt werden)
    TargetsList.update();
    
    // lastTarget aktualisieren
    State.setLastTarget(target);
  },
  
  /**
   * Helper: Aktualisiert CONFIG aus UI (mit Fallback)
   */
  _updateConfigFromUI() {
    if (typeof updateConfigFromUI === 'function') {
      updateConfigFromUI();
    }
  },
  
  /**
   * Helper: Entfernt alte Routen im normalen Modus
   */
  _clearRoutesInNormalMode() {
    if (!isRememberMode()) {
      const routePolylines = State.getRoutePolylines();
      MapRenderer.removePolylines(routePolylines);
      MapRenderer.clearRoutes();
      State.setRoutePolylines([]);
    }
  },
  
  /**
   * Helper: Berechnet Routen neu, wenn Zielpunkt vorhanden
   */
  async _recalculateRoutesIfTargetExists() {
    const lastTarget = State.getLastTarget();
    if (lastTarget) {
      this._clearRoutesInNormalMode();
      await RouteService.calculateRoutes(lastTarget);
    }
  },
  
  /**
   * Richtet den Event-Handler für Anzahl Routen ein
   */
  _setupRouteCountInput() {
    ConfigSetupHandlers.setupRouteCountInput(this);
  },
  
  /**
   * Richtet "Startpunkte merken" (Isochronen) ein
   */
  _setupRememberIsochroneStarts() {
    const cb = Utils.getElement('#config-remember-isochrone-starts');
    if (!cb) return;
    cb.checked = !!CONFIG.REMEMBER_ISOCHRONE_STARTS;
    cb.addEventListener('change', () => {
      CONFIG.REMEMBER_ISOCHRONE_STARTS = cb.checked;
      SavedIsochronesList.toggle(CONFIG.REMEMBER_ISOCHRONE_STARTS);
      if (CONFIG.REMEMBER_ISOCHRONE_STARTS) {
        const last = State.getLastIsochroneResult();
        if (last && last.polygons && last.polygons.length > 0) {
          const id = State.getNextIsochroneId();
          State.incrementNextIsochroneId();
          State.setSavedIsochrones([{ id, color: '#3388ff', ...last }]);
          this._redrawAllSavedIsochrones();
          SavedIsochronesList.update();
          const exportBtn = Utils.getElement('#export-btn');
          if (exportBtn) exportBtn.disabled = false;
        }
        const optGroup = Utils.getElement('#optimization-overlap-group');
        if (optGroup) optGroup.style.display = 'block';
      } else {
        State.clearSavedIsochrones();
        MapRenderer.clearIsochrones();
        MapRenderer.clearOverlap();
        this._savedIsochroneGeometryVersionById = {};
        this._overlapComputeCache.clear();
        SavedIsochronesList.update();
        this._updateNoTargetHint();
        const exportBtn = Utils.getElement('#export-btn');
        if (exportBtn) exportBtn.disabled = !State.getLastIsochroneResult();
        const optGroup = Utils.getElement('#optimization-overlap-group');
        if (optGroup) optGroup.style.display = 'none';
      }
    });
  },

  _markIsochroneGeometryChanged(isochroneId) {
    OverlapController.markIsochroneGeometryChanged(this, isochroneId);
  },

  _dropIsochroneGeometryVersion(isochroneId) {
    OverlapController.dropIsochroneGeometryVersion(this, isochroneId);
  },

  _getSavedIsochroneBatchLayerById(isochroneId) {
    return OverlapController.getSavedIsochroneBatchLayerById(this, isochroneId);
  },

  _buildOverlapCacheKey(mode, includedSaved, maxBucketByIndex) {
    return OverlapController.buildOverlapCacheKey(this, mode, includedSaved, maxBucketByIndex);
  },

  _setOverlapCacheEntry(key, value) {
    OverlapController.setOverlapCacheEntry(this, key, value);
  },

  _logSystemOptimalComputePath(results, fromCache = false) {
    OverlapController.logSystemOptimalComputePath(this, results, fromCache);
  },

  /**
   * Zeichnet einen gespeicherten Isochronen-Startpunkt inkrementell (ohne Full-Redraw).
   * Wird bei neu hinzugefügten Startpunkten im "Startpunkte merken"-Modus verwendet.
   */
  _appendSavedIsochroneRender(item, index) {
    if (!item) return;
    const layerGroup = State.getLayerGroup();
    if (!layerGroup) return;

    const isVisible = item.visible !== false;
    const currentLayers = State.getIsochronePolygonLayers() || [];
    const currentMarkers = State.getSavedIsochroneMarkers() || [];
    while (currentMarkers.length <= index) currentMarkers.push(null);

    if (isVisible) {
      const newLayer = IsochroneRenderer.drawSavedIsochroneBatch(item) || IsochroneRenderer.drawIsochrones(item);
      const newLayers = newLayer ? (Array.isArray(newLayer) ? newLayer : [newLayer]) : [];
      State.setIsochronePolygonLayers([...currentLayers, ...newLayers]);
      const marker = Visualization.drawIsochroneStartPoint(item.center, {
        index,
        color: item.color,
        onDragEnd: (newLatLng) => this._onSavedIsochroneStartPointDragged(index, newLatLng),
        onSelect: () => {
          State.setSelectedIsochroneStartKey(index);
          this.applyIsochroneSelectionHighlight();
        }
      });
      if (marker) marker._isSavedIsochroneCenter = true;
      currentMarkers[index] = marker || null;
      State.setSavedIsochroneMarkers(currentMarkers);
      this._markIsochroneGeometryChanged(item.id);
    } else {
      State.setIsochronePolygonLayers(currentLayers);
      currentMarkers[index] = null;
      State.setSavedIsochroneMarkers(currentMarkers);
    }

    this._recomputeSavedOverlapIfNeeded().catch(() => {});
    this._updateNoTargetHint();
    this._renderOptimizationAdvancedControls();
  },

  async _recomputeSavedOverlapIfNeeded() {
    return OverlapController.recomputeSavedOverlapIfNeeded(this);
  },

  _scheduleOverlapRecompute(delayMs = 120) {
    OverlapController.scheduleOverlapRecompute(this, delayMs);
  },

  _updateSavedIsochroneColorInPlace(index, color) {
    const saved = State.getSavedIsochrones();
    if (!saved || index < 0 || index >= saved.length) return;
    const item = saved[index];
    if (!item) return;

    const layers = State.getIsochronePolygonLayers() || [];
    layers.forEach(layer => {
      if (!layer || layer._savedIsochroneId !== item.id) return;
      if (layer._isIsochroneBatch && typeof layer.setColor === 'function') {
        layer.setColor(color);
        return;
      }
      const bucket = Number.isFinite(layer._isochroneBucket) ? layer._isochroneBucket : 0;
      const buckets = Number.isFinite(layer._isochroneBuckets) ? layer._isochroneBuckets : (item.buckets || 1);
      const style = IsochroneRenderer.getStyleForBucket(bucket, buckets, color);
      try {
        layer.setStyle({
          color: style.lineColor,
          fillColor: style.fillColor,
          fillOpacity: style.fillOpacity,
          opacity: style.strokeOpacity,
          weight: 2.5
        });
      } catch (_) {
        // ignore style failures for non-styleable layers
      }
    });

    const markerRefs = State.getSavedIsochroneMarkers() || [];
    const oldMarker = markerRefs[index];
    if (oldMarker) {
      const layerGroup = State.getLayerGroup();
      if (layerGroup) layerGroup.removeLayer(oldMarker);
    }
    const marker = Visualization.drawIsochroneStartPoint(item.center, {
      index,
      color,
      onDragEnd: (newLatLng) => this._onSavedIsochroneStartPointDragged(index, newLatLng),
      onSelect: () => {
        State.setSelectedIsochroneStartKey(index);
        this.applyIsochroneSelectionHighlight();
      }
    });
    if (marker) marker._isSavedIsochroneCenter = true;
    while (markerRefs.length <= index) markerRefs.push(null);
    markerRefs[index] = marker || null;
    State.setSavedIsochroneMarkers(markerRefs);
  },

  _replaceSavedIsochroneRenderAtIndex(index) {
    const saved = State.getSavedIsochrones();
    if (!saved || index < 0 || index >= saved.length) return;
    const item = saved[index];
    if (!item) return;
    const layerGroup = State.getLayerGroup();
    if (!layerGroup) return;

    const oldLayers = State.getIsochronePolygonLayers() || [];
    const keptLayers = [];
    let targetBatchLayer = null;
    oldLayers.forEach(layer => {
      if (layer && layer._savedIsochroneId === item.id) {
        if (layer._isIsochroneBatch && !targetBatchLayer) {
          targetBatchLayer = layer;
        } else {
          layerGroup.removeLayer(layer);
        }
      } else if (layer) {
        keptLayers.push(layer);
      }
    });

    const visible = item.visible !== false;
    if (visible) {
      if (targetBatchLayer && typeof targetBatchLayer.setIsochroneData === 'function') {
        targetBatchLayer.setIsochroneData(item);
        State.setIsochronePolygonLayers([...keptLayers, targetBatchLayer]);
      } else {
        const newLayer = IsochroneRenderer.drawSavedIsochroneBatch(item) || IsochroneRenderer.drawIsochrones(item);
        const newLayers = newLayer ? (Array.isArray(newLayer) ? newLayer : [newLayer]) : [];
        State.setIsochronePolygonLayers([...keptLayers, ...newLayers]);
      }
      this._markIsochroneGeometryChanged(item.id);
    } else {
      if (targetBatchLayer) layerGroup.removeLayer(targetBatchLayer);
      State.setIsochronePolygonLayers(keptLayers);
    }

    const markerRefs = State.getSavedIsochroneMarkers() || [];
    while (markerRefs.length <= index) markerRefs.push(null);
    const oldMarker = markerRefs[index];
    if (oldMarker) layerGroup.removeLayer(oldMarker);

    if (visible) {
      const marker = Visualization.drawIsochroneStartPoint(item.center, {
        index,
        color: item.color,
        onDragEnd: (newLatLng) => this._onSavedIsochroneStartPointDragged(index, newLatLng),
        onSelect: () => {
          State.setSelectedIsochroneStartKey(index);
          this.applyIsochroneSelectionHighlight();
        }
      });
      if (marker) marker._isSavedIsochroneCenter = true;
      markerRefs[index] = marker || null;
    } else {
      markerRefs[index] = null;
    }
    State.setSavedIsochroneMarkers(markerRefs);

    this._recomputeSavedOverlapIfNeeded().catch(() => {});
    this._updateNoTargetHint();
    this._renderOptimizationAdvancedControls();
  },

  _removeSavedIsochroneRenderAtIndex(index, removedItem) {
    const layerGroup = State.getLayerGroup();
    if (!layerGroup || !removedItem) return;

    const oldLayers = State.getIsochronePolygonLayers() || [];
    const keptLayers = [];
    oldLayers.forEach(layer => {
      if (layer && layer._savedIsochroneId === removedItem.id) {
        layerGroup.removeLayer(layer);
      } else if (layer) {
        keptLayers.push(layer);
      }
    });
    State.setIsochronePolygonLayers(keptLayers);

    const oldMarkers = State.getSavedIsochroneMarkers() || [];
    oldMarkers.forEach(marker => { if (marker) layerGroup.removeLayer(marker); });

    const saved = State.getSavedIsochrones() || [];
    const newMarkers = [];
    saved.forEach((item, i) => {
      if (item.visible === false) {
        newMarkers.push(null);
        return;
      }
      const marker = Visualization.drawIsochroneStartPoint(item.center, {
        index: i,
        color: item.color,
        onDragEnd: (newLatLng) => this._onSavedIsochroneStartPointDragged(i, newLatLng),
        onSelect: () => {
          State.setSelectedIsochroneStartKey(i);
          this.applyIsochroneSelectionHighlight();
        }
      });
      if (marker) marker._isSavedIsochroneCenter = true;
      newMarkers.push(marker || null);
    });
    State.setSavedIsochroneMarkers(newMarkers);
    this._dropIsochroneGeometryVersion(removedItem.id);

    const selected = State.getSelectedIsochroneStartKey();
    if (typeof selected === 'number') {
      if (selected === index) State.setSelectedIsochroneStartKey(null);
      else if (selected > index) State.setSelectedIsochroneStartKey(selected - 1);
    }
    this.applyIsochroneSelectionHighlight();
    this._recomputeSavedOverlapIfNeeded().catch(() => {});
    this._updateNoTargetHint();
    this._renderOptimizationAdvancedControls();
  },

  _toggleSavedIsochroneVisibilityInPlace(index) {
    const saved = State.getSavedIsochrones();
    if (!saved || index < 0 || index >= saved.length) return;
    const item = saved[index];
    if (!item) return;
    const layerGroup = State.getLayerGroup();
    if (!layerGroup) return;

    const oldLayers = State.getIsochronePolygonLayers() || [];
    const keptLayers = [];
    oldLayers.forEach(layer => {
      if (layer && layer._savedIsochroneId === item.id) {
        layerGroup.removeLayer(layer);
      } else if (layer) {
        keptLayers.push(layer);
      }
    });

    const markerRefs = State.getSavedIsochroneMarkers() || [];
    while (markerRefs.length <= index) markerRefs.push(null);
    const oldMarker = markerRefs[index];
    if (oldMarker) layerGroup.removeLayer(oldMarker);

    if (item.visible !== false) {
      const newLayer = IsochroneRenderer.drawSavedIsochroneBatch(item) || IsochroneRenderer.drawIsochrones(item);
      const newLayers = newLayer ? (Array.isArray(newLayer) ? newLayer : [newLayer]) : [];
      State.setIsochronePolygonLayers([...keptLayers, ...newLayers]);
      const marker = Visualization.drawIsochroneStartPoint(item.center, {
        index,
        color: item.color,
        onDragEnd: (newLatLng) => this._onSavedIsochroneStartPointDragged(index, newLatLng),
        onSelect: () => {
          State.setSelectedIsochroneStartKey(index);
          this.applyIsochroneSelectionHighlight();
        }
      });
      if (marker) marker._isSavedIsochroneCenter = true;
      markerRefs[index] = marker || null;
    } else {
      State.setIsochronePolygonLayers(keptLayers);
      markerRefs[index] = null;
      const selected = State.getSelectedIsochroneStartKey();
      if (selected === index) State.setSelectedIsochroneStartKey(null);
    }

    State.setSavedIsochroneMarkers(markerRefs);
    this.applyIsochroneSelectionHighlight();
    this._recomputeSavedOverlapIfNeeded().catch(() => {});
    this._updateNoTargetHint();
    this._renderOptimizationAdvancedControls();
  },

  _clearSavedIsochroneRenderState() {
    this._savedIsochroneGeometryVersionById = {};
    this._overlapComputeCache.clear();
    MapRenderer.clearIsochrones();
    MapRenderer.clearOverlap();
    State.setOverlapPolygonLayers([]);
  },

  /**
   * Zeichnet alle gespeicherten Isochronen und deren Startpunkt-Marker neu
   */
  _redrawAllSavedIsochrones() {
    MapRenderer.clearIsochrones();
    const saved = State.getSavedIsochrones();
    if (!saved || saved.length === 0) return;
    const layerGroup = State.getLayerGroup();
    if (!layerGroup) return;

    const allLayers = [];
    const markers = [];
    saved.forEach((item, index) => {
      const visible = item.visible !== false;
      if (!visible) {
        markers.push(null);
        return;
      }
      const layer = IsochroneRenderer.drawSavedIsochroneBatch(item) || IsochroneRenderer.drawIsochrones(item);
      const layers = layer ? (Array.isArray(layer) ? layer : [layer]) : [];
      allLayers.push(...layers);
      const marker = Visualization.drawIsochroneStartPoint(item.center, {
        index,
        color: item.color,
        onDragEnd: (newLatLng) => this._onSavedIsochroneStartPointDragged(index, newLatLng),
        onSelect: () => {
          State.setSelectedIsochroneStartKey(index);
          this.applyIsochroneSelectionHighlight();
        }
      });
      marker._isSavedIsochroneCenter = true;
      markers.push(marker);
      this._markIsochroneGeometryChanged(item.id);
    });
    State.setIsochronePolygonLayers(allLayers);
    State.setSavedIsochroneMarkers(markers);
    this._recomputeSavedOverlapIfNeeded().catch(() => {});
    this._updateNoTargetHint();
    this._renderOptimizationAdvancedControls();
  },

  /**
   * Richtet Optimierungs-Modus ein (Keine / Überlappung / Systemoptimal)
   */
  _setupOptimizationOverlap() {
    OverlapController.setupOptimizationOverlap(this);
  },

  _getOptimizationSettings() {
    return OverlapController.getOptimizationSettings();
  },

  _getOptimizationSelectionAndBudgets(visibleSaved) {
    return OverlapController.getOptimizationSelectionAndBudgets(this, visibleSaved);
  },

  _updateOptimizationGlobalBudgetLabel(labelEl, bucketIndex, refIsochrone) {
    OverlapController.updateOptimizationGlobalBudgetLabel(this, labelEl, bucketIndex, refIsochrone);
  },

  _renderOptimizationAdvancedControls() {
    OverlapController.renderOptimizationAdvancedControls(this);
  },

  async _extendIsochroneBucketsForOverlap(statusEl, deltaBuckets = 1) {
    return OverlapController.extendIsochroneBucketsForOverlap(this, statusEl, deltaBuckets);
  },

  /**
   * Führt async 작업 mit Concurrency-Limit aus (z. B. mehrere GH-Isochronen parallel).
   * @template T,U
   * @param {T[]} items
   * @param {number} limit
   * @param {(item: T, index: number) => Promise<U>} mapper
   * @returns {Promise<(U|null)[]>}
   */
  async _mapWithConcurrency(items, limit, mapper) {
    return AsyncHelpers.mapWithConcurrency(items, limit, mapper);
  },

  _enforceOverlapBudgets(statusEl) {
    OverlapController.enforceOverlapBudgets(this, statusEl);
  },

  /**
   * Liest Bucket-Größe und Zeitlimit aus der UI, rundet Zeitlimit auf Vielfaches der Bucket-Größe,
   * aktualisiert CONFIG und gibt { timeLimitSec, buckets } zurück.
   */
  _getIsochroneParamsFromUI() {
    return IsochroneParams.getFromUI();
  },

  /**
   * Holt Bucket-Größe (Min.) aus der UI und setzt CONFIG.ISOCHRONE_BUCKET_SIZE_MIN
   */
  _getIsochroneBucketSizeMin() {
    return IsochroneParams.getBucketSizeMin();
  },

  /**
   * Rundet Zeitlimit (Min.) auf Vielfaches der Bucket-Größe und setzt Zeitlimit-Input min/step
   */
  /**
   * Wendet die aktuelle Startpunkt-Auswahl (Klick-Lock) an: ein ausgewählter Punkt bleibt blau/groß.
   * Wird nach Klick auf Startpunkt, Klick auf Karte (Abwahl) und nach Listen-Update aufgerufen.
   */
  applyIsochroneSelectionHighlight() {
    const key = State.getSelectedIsochroneStartKey();
    const currentMarker = State.getCurrentTargetMarker();
    if (currentMarker && currentMarker._icon) {
      currentMarker._icon.classList.toggle('isochrone-start-point-icon--highlight', key === 'current');
    }
    if (typeof SavedIsochronesList !== 'undefined' && SavedIsochronesList.clearAllHighlights) {
      SavedIsochronesList.clearAllHighlights();
    }
    if (key !== null && key !== 'current' && typeof key === 'number') {
      if (SavedIsochronesList && SavedIsochronesList.highlightRow) {
        SavedIsochronesList.highlightRow(key, true);
      }
    }
  },

  _syncIsochroneTimeToBucketSize() {
    return IsochroneParams.syncTimeToBucketSize();
  },

  /**
   * Richtet Isochrone-Parameter (Bucket-Größe, Zeitlimit in Schritten) ein
   */
  _setupIsochroneParams() {
    const timeInput = Utils.getElement('#config-isochrone-time');
    const bucketSizeSelect = Utils.getElement('#config-isochrone-bucket-size');
    const hexSnapCb = Utils.getElement('#config-isochrone-hex-snap');
    const hexSizeSelect = Utils.getElement('#config-isochrone-hex-size');
    const timeLimitMin = Math.round((CONFIG.ISOCHRONE_TIME_LIMIT || 600) / 60);
    const bucketSizeMin = CONFIG.ISOCHRONE_BUCKET_SIZE_MIN || 5;
    if (bucketSizeSelect) {
      bucketSizeSelect.value = String(bucketSizeMin);
      bucketSizeSelect.addEventListener('change', () => {
        this._syncIsochroneTimeToBucketSize();
      });
    }
    if (timeInput) {
      timeInput.min = bucketSizeMin;
      timeInput.step = bucketSizeMin;
      const rounded = Math.round(timeLimitMin / bucketSizeMin) * bucketSizeMin;
      timeInput.value = Math.max(bucketSizeMin, Math.min(120, rounded));
      CONFIG.ISOCHRONE_TIME_LIMIT = (timeInput.value | 0) * 60;
      CONFIG.ISOCHRONE_BUCKETS = Math.round((timeInput.value | 0) / bucketSizeMin);
      timeInput.addEventListener('change', () => {
        const bucketSize = this._getIsochroneBucketSizeMin();
        const v = parseInt(timeInput.value, 10) || bucketSize;
        const rounded = Math.round(v / bucketSize) * bucketSize;
        const clamped = Math.max(bucketSize, Math.min(120, rounded));
        timeInput.value = clamped;
        CONFIG.ISOCHRONE_TIME_LIMIT = clamped * 60;
        CONFIG.ISOCHRONE_BUCKETS = Math.round(clamped / bucketSize);
      });
    }

    // Hex-Snapping (Detailgrad)
    if (hexSnapCb) {
      hexSnapCb.checked = !!CONFIG.ISOCHRONE_HEX_SNAP;
      hexSnapCb.addEventListener('change', () => {
        CONFIG.ISOCHRONE_HEX_SNAP = !!hexSnapCb.checked;
      });
    }
    if (hexSizeSelect) {
      const v = parseInt(hexSizeSelect.value, 10) || CONFIG.ISOCHRONE_HEX_CELL_SIZE_M || 250;
      hexSizeSelect.value = String(CONFIG.ISOCHRONE_HEX_CELL_SIZE_M || v);
      hexSizeSelect.addEventListener('change', () => {
        const val = parseInt(hexSizeSelect.value, 10) || 250;
        CONFIG.ISOCHRONE_HEX_CELL_SIZE_M = [100, 250, 500, 1000].includes(val) ? val : 250;
        hexSizeSelect.value = String(CONFIG.ISOCHRONE_HEX_CELL_SIZE_M);
      });
    }
  },

  /**
   * Richtet den Event-Handler für Radius ein
   */
  _setupRadiusInput() {
    ConfigSetupHandlers.setupRadiusInput(this);
  },
  
  
  /**
   * Richtet den Event-Handler für "Startpunkte ausblenden" ein
   */
  _setupHideStartPoints() {
    ConfigSetupHandlers.setupHideStartPoints(this);
  },
  
  /**
   * Richtet den Event-Handler für "Zielpunkte ausblenden" ein
   */
  _setupHideTargetPoints() {
    ConfigSetupHandlers.setupHideTargetPoints(this);
  },
  
  /**
   * Migriert aktuellen Zielpunkt zum "Zielpunkte merken" Modus
   */
  _migrateCurrentTargetToRememberMode(currentTarget) {
    const added = TargetService.addTarget(currentTarget);
    if (!added) return;
    
    // Prüfe ob bereits ein Marker für diesen Zielpunkt existiert (ohne Index)
    // Wenn ja, entferne ihn und erstelle einen neuen mit Index
    const layerGroup = State.getLayerGroup();
    let oldMarker = null;
    if (layerGroup) {
      layerGroup.eachLayer(layer => {
        if (MapRenderer.isMarker(layer) &&
            layer._targetLatLng && 
            TargetService.isEqual(layer._targetLatLng, currentTarget) &&
            layer._targetIndex === undefined) {
          // Alten Marker ohne Index merken und entfernen
          oldMarker = layer;
          layerGroup.removeLayer(layer);
        }
      });
    }
    
    // Neuen Marker mit Index zeichnen
    const index = State.getAllTargets().length - 1;
    const marker = Visualization.drawTargetPoint(currentTarget, index);
    
    const targetMarkers = State.getTargetMarkers();
    // Stelle sicher, dass das Array groß genug ist
    while (targetMarkers.length <= index) {
      targetMarkers.push(null);
    }
    targetMarkers[index] = marker;
    State.setTargetMarkers(targetMarkers);
    
    // currentTargetMarker zurücksetzen, da der Marker jetzt in targetMarkers ist
    // Auch wenn es der alte Marker war, sollte er jetzt null sein
    if (oldMarker === State.getCurrentTargetMarker()) {
      State.setCurrentTargetMarker(null);
    }
    
    // Routen zum aktuellen Zielpunkt speichern (falls vorhanden)
    const allRouteData = State.getAllRouteData();
    const allRouteResponses = State.getAllRouteResponses();
    const routePolylines = State.getRoutePolylines();
    const lastStarts = State.getLastStarts();
    const lastColors = State.getLastColors();
    
    if (allRouteData.length > 0 || allRouteResponses.length > 0) {
      // Verteilungstyp ermitteln
      const activeDistBtn = document.querySelector('.dist-btn.active');
      const distType = activeDistBtn ? activeDistBtn.dataset.dist : 'lognormal';
      
      TargetService.updateTargetRoutes(currentTarget, {
        routeData: allRouteData,
        routeResponses: allRouteResponses,
        routePolylines: routePolylines,
        starts: lastStarts,
        colors: lastColors,
        distributionType: distType,
        config: {
          profile: CONFIG.PROFILE,
          n: CONFIG.N,
          radiusKm: CONFIG.RADIUS_M / 1000
        }
      });
      
      // Alle Routen neu zeichnen
      RouteRenderer.drawAllTargetRoutes();
    }
  },
  
  /**
   * Richtet den Event-Handler für "Zielpunkte merken" ein
   */
  _setupRememberTargetsHandler() {
    const rememberTargetsInput = Utils.getElement('#config-remember-targets');
    if (!rememberTargetsInput) return;
    
    rememberTargetsInput.addEventListener('change', () => {
      // Config aktualisieren
      this._updateConfigFromUI();
      if (typeof updateConfigFromUI !== 'function') {
        CONFIG.REMEMBER_TARGETS = rememberTargetsInput.checked;
      }
      
      // UI aktualisieren
      TargetsList.toggle(CONFIG.REMEMBER_TARGETS);
      
      // Wenn aktiviert, aktuellen Zielpunkt und Routen zur Liste hinzufügen (falls vorhanden)
      if (isRememberMode()) {
        const currentTarget = State.getLastTarget();
        if (currentTarget) {
          this._migrateCurrentTargetToRememberMode(currentTarget);
        }
      } else {
        // Wenn deaktiviert, alle gespeicherten Zielpunkte und Routen löschen
        TargetService.clearAll();
        
        // Auswahl zurücksetzen
        State.setSelectedTargetIndex(null);
        Visualization.updateSelectedTargetMarker();
        
        // Aktuellen Zielpunkt beibehalten und neu zeichnen
        const currentTarget = State.getLastTarget();
        if (currentTarget) {
          // POIs (Cafés, Restaurants, Bars) behalten
          MapRenderer.clearLayersExceptSchools();
          const marker = Visualization.drawTargetPoint(currentTarget);
          // Marker im State speichern, damit er ausgeblendet werden kann
          State.setCurrentTargetMarker(marker);
        }
      }
      
      EventBus.emit(Events.CONFIG_CHANGED);
    });
  },
  
  /**
   * Behandelt Geocoder-Auswahl: Karte bewegen und Isochrone berechnen
   */
  async _handleGeocoderSelect(lat, lng, suggestion) {
    const map = State.getMap();
    if (!map) return;

    map.setView([lat, lng], Math.max(map.getZoom(), 15));

    const center = [lat, lng];
    State.setLastTarget(center);
    this._updateCalculateIsochroneButton();
    this._getIsochroneParamsFromUI();

    if (isRememberIsochroneStarts()) {
      Utils.showInfo('Isochrone wird berechnet…', false);
      await IsochroneService.fetchIsochrone(center, {
        time_limit: CONFIG.ISOCHRONE_TIME_LIMIT,
        buckets: CONFIG.ISOCHRONE_BUCKETS,
        profile: CONFIG.PROFILE
      });
      Utils.showInfo('', false);
      return;
    }

    State.setSelectedIsochroneStartKey(null);
    this.applyIsochroneSelectionHighlight();
    MapRenderer.clearIsochrones();
    State.resetIsochroneData();
    MapRenderer.clearLayersExceptSchools();
    const marker = Visualization.drawIsochroneStartPoint(center, {
      onDragEnd: (newLatLng) => this._onIsochroneStartPointDragged(newLatLng),
      onSelect: () => {
        State.setSelectedIsochroneStartKey('current');
        this.applyIsochroneSelectionHighlight();
      }
    });
    State.setCurrentTargetMarker(marker);
    this._updateNoTargetHint();
    Utils.showInfo('Isochrone wird berechnet…', false);
    await IsochroneService.fetchIsochrone(center, {
      time_limit: CONFIG.ISOCHRONE_TIME_LIMIT,
      buckets: CONFIG.ISOCHRONE_BUCKETS,
      profile: CONFIG.PROFILE
    });
    Utils.showInfo('', false);
  },

  /**
   * Konfiguration eines gespeicherten Startpunkts anpassen (Zeitlimit, Buckets, Profil) → Isochrone neu berechnen
   */
  async _onEditSavedIsochroneConfig(index, config) {
    const i = Number(index);
    const saved = State.getSavedIsochrones();
    if (!saved || !Array.isArray(saved) || i < 0 || i >= saved.length) return;
    const item = saved[i];
    if (!item || !item.center) return;
    const newCenter = (config && Array.isArray(config.center) && config.center.length === 2)
      ? [Number(config.center[0]), Number(config.center[1])]
      : null;
    const center = newCenter && !isNaN(newCenter[0]) && !isNaN(newCenter[1])
      ? newCenter
      : (item.center.slice ? item.center.slice() : [item.center[0], item.center[1]]);
    const color = (config.color != null && /^#[0-9a-fA-F]{6}$/.test(config.color)) ? config.color : (item.color || '#3388ff');

    const sameCenter = !!item.center && Math.abs(item.center[0] - center[0]) < 1e-10 && Math.abs(item.center[1] - center[1]) < 1e-10;
    const sameTime = Number(item.time_limit) === Number(config.time_limit);
    const sameBuckets = Number(item.buckets) === Number(config.buckets);
    const sameProfile = String(item.profile || '') === String(config.profile || '');
    const onlyColorChanged = sameCenter && sameTime && sameBuckets && sameProfile && color !== (item.color || '#3388ff');

    if (onlyColorChanged) {
      const savedNow = State.getSavedIsochrones();
      if (!savedNow || i >= savedNow.length) return;
      savedNow[i] = { ...savedNow[i], color };
      State.setSavedIsochrones([...savedNow]);
      this._updateSavedIsochroneColorInPlace(i, color);
      SavedIsochronesList.update();
      return;
    }

    Utils.showInfo('Isochrone wird neu berechnet…', false);
    const result = await IsochroneService.fetchIsochrone(center, {
      time_limit: config.time_limit,
      buckets: config.buckets,
      profile: config.profile,
      silent: true
    });
    Utils.showInfo('', false);
    if (!result) return;
    const savedNow = State.getSavedIsochrones();
    if (!savedNow || i >= savedNow.length) return;
    savedNow[i] = { ...savedNow[i], id: savedNow[i].id, visible: savedNow[i].visible, center: center, polygons: result.polygons, time_limit: result.time_limit, buckets: result.buckets, profile: result.profile, color };
    State.setSavedIsochrones([...savedNow]);
    this._replaceSavedIsochroneRenderAtIndex(i);
    SavedIsochronesList.update();
  },

  /**
   * Wird aufgerufen, wenn ein gespeicherter Startpunkt verschoben wurde → Isochrone für diesen Punkt neu berechnen
   */
  async _onSavedIsochroneStartPointDragged(index, newLatLng) {
    const saved = State.getSavedIsochrones();
    if (index < 0 || index >= saved.length) return;
    const center = [newLatLng.lat, newLatLng.lng];
    const { timeLimitSec, buckets } = this._getIsochroneParamsFromUI();
    Utils.showInfo('Isochrone wird neu berechnet…', false);
    const result = await IsochroneService.fetchIsochrone(center, {
      time_limit: timeLimitSec,
      buckets,
      profile: CONFIG.PROFILE,
      silent: true
    });
    Utils.showInfo('', false);
    if (result) {
      saved[index] = { ...saved[index], center, polygons: result.polygons, time_limit: result.time_limit, buckets: result.buckets, profile: result.profile };
      State.setSavedIsochrones([...saved]);
      this._replaceSavedIsochroneRenderAtIndex(index);
      SavedIsochronesList.update();
    }
  },

  /**
   * Wird aufgerufen, wenn der (einzige) Startpunkt verschoben wurde → Isochrone neu berechnen
   */
  async _onIsochroneStartPointDragged(newLatLng) {
    const center = [newLatLng.lat, newLatLng.lng];
    State.setLastTarget(center);
    const { timeLimitSec, buckets } = this._getIsochroneParamsFromUI();
    Utils.showInfo('Isochrone wird neu berechnet…', false);
    await IsochroneService.fetchIsochrone(center, {
      time_limit: timeLimitSec,
      buckets,
      profile: CONFIG.PROFILE
    });
    Utils.showInfo('', false);
  },

  /**
   * Behandelt Map-Click: Isochrone um den Klickpunkt berechnen
   */
  async handleMapClick(latlng) {
    State.setSelectedIsochroneStartKey(null);
    this.applyIsochroneSelectionHighlight();

    const center = [latlng.lat, latlng.lng];
    State.setLastTarget(center);
    this._updateCalculateIsochroneButton();
    this._getIsochroneParamsFromUI();
    
    if (isRememberIsochroneStarts()) {
      Utils.showInfo('Isochrone wird berechnet…', false);
      await IsochroneService.fetchIsochrone(center, {
        time_limit: CONFIG.ISOCHRONE_TIME_LIMIT,
        buckets: CONFIG.ISOCHRONE_BUCKETS,
        profile: CONFIG.PROFILE
      });
      Utils.showInfo('', false);
      return;
    }
    
    MapRenderer.clearIsochrones();
    State.resetIsochroneData();
    MapRenderer.clearLayersExceptSchools();
    const marker = Visualization.drawIsochroneStartPoint(center, {
      onDragEnd: (newLatLng) => this._onIsochroneStartPointDragged(newLatLng),
      onSelect: () => {
        State.setSelectedIsochroneStartKey('current');
        this.applyIsochroneSelectionHighlight();
      }
    });
    State.setCurrentTargetMarker(marker);
    
    this._updateNoTargetHint();
    Utils.showInfo('Isochrone wird berechnet…', false);
    await IsochroneService.fetchIsochrone(center, {
      time_limit: CONFIG.ISOCHRONE_TIME_LIMIT,
      buckets: CONFIG.ISOCHRONE_BUCKETS,
      profile: CONFIG.PROFILE
    });
    Utils.showInfo('', false);
  },
  
  /**
   * Behandelt aktualisierte Route (delegiert an RouteHandler)
   */
  _handleRouteUpdated(data) {
    RouteHandler.handleRouteUpdated(data);
  },
  
  /**
   * Histogramm mit aktuellem State neu zeichnen (z. B. nach Modus-Umschaltung)
   */
  _refreshHistogram() {
    const lastTarget = State.getLastTarget();
    if (lastTarget) {
      const updatedStarts = State.getLastStarts();
      let routeData = State.getAllRouteData();
      let routeDistances = (State.getAllRouteResponses?.() || []).map(r => r?.distance ?? 0);
      const targetRoutes = State.getTargetRoutes();
      if (targetRoutes && targetRoutes.length > 0) {
        const tr = targetRoutes.find(t => TargetService.isEqual(t.target, lastTarget));
        if (tr) {
          if (tr.routeData) routeData = tr.routeData;
          routeDistances = RouteService.getRouteDistances(tr);
        }
      }
      Visualization.updateDistanceHistogram(updatedStarts, lastTarget, { routeData: routeData || [], routeDistances });
    }
  },
  
  /**
   * Behandelt Config-Änderungen
   */
  _handleConfigChanged() {
    // Reagieren auf Config-Änderungen
    TargetsList.toggle(CONFIG.REMEMBER_TARGETS);
  },
  
  /**
   * Zeichnet aktuelle Routen neu
   */
  _redrawCurrentRoutes() {
    const allRouteData = State.getAllRouteData();
    const allRouteResponses = State.getAllRouteResponses();
    const colors = State.getLastColors();
    const lastStarts = State.getLastStarts();
    const lastTarget = State.getLastTarget();
    
    // Routen neu zeichnen, wenn Route-Daten vorhanden sind
    if (allRouteData.length > 0 || (allRouteResponses && allRouteResponses.length > 0)) {
      MapRenderer.clearRoutes();
      
      // Startpunkte neu zeichnen (mit neuer Größe basierend auf Modus)
      if (lastStarts && colors && lastTarget) {
        Visualization.drawStartPoints(lastStarts, colors, lastTarget);
        Visualization.toggleStartPointsVisibility();
      }
      
      RouteRenderer.drawRoutesForTarget(allRouteData, allRouteResponses, colors);
    }
  },
  
  /**
   * Berechnet Routen neu (z.B. nach Profilwechsel)
   */
  async recalculateRoutes() {
    const lastTarget = State.getLastTarget();
    if (lastTarget) {
      // Alte Routen entfernen (bevor neue berechnet werden)
      if (isRememberMode()) {
        // Im "Zielpunkte merken" Modus: Routen zum aktuellen Zielpunkt entfernen
        const targetRoutes = State.getTargetRoutes();
        const targetIndex = targetRoutes.findIndex(tr => 
          TargetService.isEqual(tr.target, lastTarget)
        );
        if (targetIndex >= 0) {
          const oldRouteInfo = targetRoutes[targetIndex];
          if (oldRouteInfo && oldRouteInfo.routePolylines) {
            MapRenderer.removePolylines(oldRouteInfo.routePolylines);
          }
        }
        // Alle Polylines entfernen (werden neu gezeichnet mit allen Zielpunkten)
        MapRenderer.clearRoutes();
      } else {
        // Im normalen Modus: Alle Routen entfernen
        const routePolylines = State.getRoutePolylines();
        MapRenderer.removePolylines(routePolylines);
        State.setRoutePolylines([]);
        MapRenderer.clearRoutes();
      }
      
      // Startpunkte wiederverwenden
      const routeInfo = await RouteService.calculateRoutes(lastTarget, { reuseStarts: true });
      if (routeInfo) {
        // Im "Zielpunkte merken" Modus: Routen zum Zielpunkt aktualisieren
        if (isRememberMode()) {
          // RouteInfo enthält bereits die neuen Routen, werden in RouteService gespeichert
          // Jetzt alle Routen neu zeichnen
          RouteRenderer.drawAllTargetRoutes();
        } else {
          // Visualisierung aktualisieren
          RouteHandler.handleRoutesCalculated({ target: lastTarget, routeInfo });
        }
      }
    }
  },
  
  /**
   * Richtet Panel-Ein-/Ausklappen ein
   */
  _setupPanelCollapse() {
    const collapseBtn = Utils.getElement('#collapse-panel');
    const panel = Utils.getElement('#main-panel');
    const arrow = collapseBtn?.querySelector('svg');
    
    if (!collapseBtn || !panel || !arrow) return;
    
    // Arrow-Klasse hinzufügen
    if (arrow) {
      arrow.classList.add('toggle-arrow');
    }
    
    collapseBtn.addEventListener('click', () => {
      panel.classList.toggle('collapsed');
    });
  },
  
};

// ==== Start ====
// Warte bis DOM und Leaflet geladen sind
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => App.init());
} else {
  App.init();
}

