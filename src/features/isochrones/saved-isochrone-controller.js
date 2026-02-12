// ==== Saved Isochrone Controller ====
const SavedIsochroneController = {
  appendSavedIsochroneRender(app, item, index) {
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
        onDragEnd: (newLatLng) => app._onSavedIsochroneStartPointDragged(index, newLatLng),
        onSelect: () => {
          State.setSelectedIsochroneStartKey(index);
          app.applyIsochroneSelectionHighlight();
        }
      });
      if (marker) marker._isSavedIsochroneCenter = true;
      currentMarkers[index] = marker || null;
      State.setSavedIsochroneMarkers(currentMarkers);
      app._markIsochroneGeometryChanged(item.id);
    } else {
      State.setIsochronePolygonLayers(currentLayers);
      currentMarkers[index] = null;
      State.setSavedIsochroneMarkers(currentMarkers);
    }

    app._recomputeSavedOverlapIfNeeded().catch(() => {});
    app._updateNoTargetHint();
    app._renderOptimizationAdvancedControls();
  },

  updateSavedIsochroneColorInPlace(app, index, color) {
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
      } catch (_) {}
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
      onDragEnd: (newLatLng) => app._onSavedIsochroneStartPointDragged(index, newLatLng),
      onSelect: () => {
        State.setSelectedIsochroneStartKey(index);
        app.applyIsochroneSelectionHighlight();
      }
    });
    if (marker) marker._isSavedIsochroneCenter = true;
    while (markerRefs.length <= index) markerRefs.push(null);
    markerRefs[index] = marker || null;
    State.setSavedIsochroneMarkers(markerRefs);
  },

  replaceSavedIsochroneRenderAtIndex(app, index) {
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
        if (layer._isIsochroneBatch && !targetBatchLayer) targetBatchLayer = layer;
        else layerGroup.removeLayer(layer);
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
      app._markIsochroneGeometryChanged(item.id);
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
        onDragEnd: (newLatLng) => app._onSavedIsochroneStartPointDragged(index, newLatLng),
        onSelect: () => {
          State.setSelectedIsochroneStartKey(index);
          app.applyIsochroneSelectionHighlight();
        }
      });
      if (marker) marker._isSavedIsochroneCenter = true;
      markerRefs[index] = marker || null;
    } else {
      markerRefs[index] = null;
    }
    State.setSavedIsochroneMarkers(markerRefs);

    app._recomputeSavedOverlapIfNeeded().catch(() => {});
    app._updateNoTargetHint();
    app._renderOptimizationAdvancedControls();
  },

  removeSavedIsochroneRenderAtIndex(app, index, removedItem) {
    const layerGroup = State.getLayerGroup();
    if (!layerGroup || !removedItem) return;

    const oldLayers = State.getIsochronePolygonLayers() || [];
    const keptLayers = [];
    oldLayers.forEach(layer => {
      if (layer && layer._savedIsochroneId === removedItem.id) layerGroup.removeLayer(layer);
      else if (layer) keptLayers.push(layer);
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
        onDragEnd: (newLatLng) => app._onSavedIsochroneStartPointDragged(i, newLatLng),
        onSelect: () => {
          State.setSelectedIsochroneStartKey(i);
          app.applyIsochroneSelectionHighlight();
        }
      });
      if (marker) marker._isSavedIsochroneCenter = true;
      newMarkers.push(marker || null);
    });
    State.setSavedIsochroneMarkers(newMarkers);
    app._dropIsochroneGeometryVersion(removedItem.id);

    const selected = State.getSelectedIsochroneStartKey();
    if (typeof selected === 'number') {
      if (selected === index) State.setSelectedIsochroneStartKey(null);
      else if (selected > index) State.setSelectedIsochroneStartKey(selected - 1);
    }
    app.applyIsochroneSelectionHighlight();
    app._recomputeSavedOverlapIfNeeded().catch(() => {});
    app._updateNoTargetHint();
    app._renderOptimizationAdvancedControls();
  },

  toggleSavedIsochroneVisibilityInPlace(app, index) {
    const saved = State.getSavedIsochrones();
    if (!saved || index < 0 || index >= saved.length) return;
    const item = saved[index];
    if (!item) return;
    const layerGroup = State.getLayerGroup();
    if (!layerGroup) return;

    const oldLayers = State.getIsochronePolygonLayers() || [];
    const keptLayers = [];
    oldLayers.forEach(layer => {
      if (layer && layer._savedIsochroneId === item.id) layerGroup.removeLayer(layer);
      else if (layer) keptLayers.push(layer);
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
        onDragEnd: (newLatLng) => app._onSavedIsochroneStartPointDragged(index, newLatLng),
        onSelect: () => {
          State.setSelectedIsochroneStartKey(index);
          app.applyIsochroneSelectionHighlight();
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
    app.applyIsochroneSelectionHighlight();
    app._recomputeSavedOverlapIfNeeded().catch(() => {});
    app._updateNoTargetHint();
    app._renderOptimizationAdvancedControls();
  },

  clearSavedIsochroneRenderState(app) {
    app._savedIsochroneGeometryVersionById = {};
    app._overlapComputeCache.clear();
    MapRenderer.clearIsochrones();
    MapRenderer.clearOverlap();
    State.setOverlapPolygonLayers([]);
  },

  redrawAllSavedIsochrones(app) {
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
        onDragEnd: (newLatLng) => app._onSavedIsochroneStartPointDragged(index, newLatLng),
        onSelect: () => {
          State.setSelectedIsochroneStartKey(index);
          app.applyIsochroneSelectionHighlight();
        }
      });
      marker._isSavedIsochroneCenter = true;
      markers.push(marker);
      app._markIsochroneGeometryChanged(item.id);
    });
    State.setIsochronePolygonLayers(allLayers);
    State.setSavedIsochroneMarkers(markers);
    app._recomputeSavedOverlapIfNeeded().catch(() => {});
    app._updateNoTargetHint();
    app._renderOptimizationAdvancedControls();
  },

  applyIsochroneSelectionHighlight(app) {
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

  async onEditSavedIsochroneConfig(app, index, config) {
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
      app._updateSavedIsochroneColorInPlace(i, color);
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
    savedNow[i] = {
      ...savedNow[i],
      id: savedNow[i].id,
      visible: savedNow[i].visible,
      center: center,
      polygons: result.polygons,
      time_limit: result.time_limit,
      buckets: result.buckets,
      profile: result.profile,
      color
    };
    State.setSavedIsochrones([...savedNow]);
    app._replaceSavedIsochroneRenderAtIndex(i);
    SavedIsochronesList.update();
  },

  async onSavedIsochroneStartPointDragged(app, index, newLatLng) {
    const saved = State.getSavedIsochrones();
    if (index < 0 || index >= saved.length) return;
    const center = [newLatLng.lat, newLatLng.lng];
    const { timeLimitSec, buckets } = app._getIsochroneParamsFromUI();
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
      app._replaceSavedIsochroneRenderAtIndex(index);
      SavedIsochronesList.update();
    }
  }
};

