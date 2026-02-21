// ==== Overlap / Optimization Controller ====
const OverlapController = {
  initOverlapComputeWorker(app) {
    if (app._overlapComputeWorker) return;
    if (typeof Worker === 'undefined') return;
    try {
      const worker = new Worker('src/workers/overlap-worker.js');
      worker.onmessage = (event) => {
        const data = event?.data || {};
        const pending = app._overlapWorkerPending.get(data.id);
        if (!pending) return;
        app._overlapWorkerPending.delete(data.id);
        if (data.ok) pending.resolve(data.result);
        else pending.reject(new Error(data.error || 'Worker error'));
      };
      worker.onerror = (error) => {
        const pendings = Array.from(app._overlapWorkerPending.values());
        app._overlapWorkerPending.clear();
        pendings.forEach(p => p.reject(error));
      };
      app._overlapComputeWorker = worker;
    } catch (_) {
      app._overlapComputeWorker = null;
    }
  },

  runOverlapWorkerTask(app, type, payload) {
    if (!app._overlapComputeWorker) return Promise.reject(new Error('No overlap worker'));
    const id = app._overlapWorkerReqSeq++;
    return new Promise((resolve, reject) => {
      app._overlapWorkerPending.set(id, { resolve, reject });
      app._overlapComputeWorker.postMessage({ id, type, payload });
    });
  },

  markIsochroneGeometryChanged(app, isochroneId) {
    if (isochroneId == null) return;
    const cur = Number(app._savedIsochroneGeometryVersionById[isochroneId] || 0);
    app._savedIsochroneGeometryVersionById[isochroneId] = cur + 1;
    app._overlapComputeCache.clear();
  },

  dropIsochroneGeometryVersion(app, isochroneId) {
    if (isochroneId == null) return;
    delete app._savedIsochroneGeometryVersionById[isochroneId];
    app._overlapComputeCache.clear();
  },

  getSavedIsochroneBatchLayerById(_app, isochroneId) {
    const layers = State.getIsochronePolygonLayers() || [];
    return layers.find(layer => layer && layer._isIsochroneBatch === true && layer._savedIsochroneId === isochroneId) || null;
  },

  buildOverlapCacheKey(app, mode, includedSaved, maxBucketByIndex) {
    const parts = includedSaved.map((item, idx) => {
      const rev = Number(app._savedIsochroneGeometryVersionById[item.id] || 0);
      const maxBucket = Array.isArray(maxBucketByIndex) ? Number(maxBucketByIndex[idx]) : -1;
      return `${item.id}:${rev}:${maxBucket}`;
    });
    return `${mode}|${parts.join('|')}`;
  },

  setOverlapCacheEntry(app, key, value) {
    app._overlapComputeCache.set(key, value);
    if (app._overlapComputeCache.size > 40) {
      const oldestKey = app._overlapComputeCache.keys().next().value;
      app._overlapComputeCache.delete(oldestKey);
    }
  },

  logSystemOptimalComputePath(app, results, fromCache = false) {
    const first = Array.isArray(results) && results.length ? results[0] : null;
    const path = first?.computePath || 'unknown';
    const msg = `[Systemoptimal] compute path: ${path}${fromCache ? ' (cache hit)' : ''}`;
    if (msg === app._lastSystemOptimalConsoleStatus) return;
    app._lastSystemOptimalConsoleStatus = msg;
    console.info(msg);
  },

  async recomputeSavedOverlapIfNeeded(app) {
    MapRenderer.clearOverlap();
    const saved = State.getSavedIsochrones() || [];
    const visibleSaved = saved.filter(item => item.visible !== false);
    const mode = CONFIG.OPTIMIZATION_MODE || 'none';
    if (typeof OverlapRenderer === 'undefined' || visibleSaved.length < 2 || mode === 'none') return;
    const { includedSaved, maxBucketByIndex } = app._getOptimizationSelectionAndBudgets(visibleSaved);
    const runId = ++app._overlapRecomputeRunId;
    const cacheKey = app._buildOverlapCacheKey(mode, includedSaved, maxBucketByIndex);

    const drawIfCurrent = (results) => {
      if (runId !== app._overlapRecomputeRunId) return;
      if (!results || !results.length) {
        State.setOverlapPolygonLayers([]);
        return;
      }
      if (mode === 'overlap') {
        const overlapLayers = OverlapRenderer.drawOverlaps(results);
        State.setOverlapPolygonLayers(overlapLayers);
        return;
      }
      const overlapLayers = OverlapRenderer.drawSystemOptimalCatchments(results, includedSaved);
      State.setOverlapPolygonLayers(overlapLayers);
    };

    if (app._overlapComputeCache.has(cacheKey)) {
      if (mode === 'system_optimal') {
        app._logSystemOptimalComputePath(app._overlapComputeCache.get(cacheKey), true);
      }
      drawIfCurrent(app._overlapComputeCache.get(cacheKey));
      return;
    }

    if (mode === 'overlap') {
      if (includedSaved.length >= 2) {
        let overlapResults = null;
        try {
          overlapResults = await app._runOverlapWorkerTask('overlap', { savedIsochrones: includedSaved });
        } catch (_) {
          overlapResults = OverlapRenderer.computeOverlapPerBucket(includedSaved);
        }
        app._setOverlapCacheEntry(cacheKey, overlapResults || []);
        drawIfCurrent(overlapResults);
      }
      return;
    }
    if (mode === 'system_optimal' && includedSaved.length >= 2) {
      let catchmentResults = null;
      try {
        catchmentResults = await app._runOverlapWorkerTask('system_optimal', {
          savedIsochrones: includedSaved,
          maxBucketByIndex
        });
      } catch (_) {
        catchmentResults = OverlapRenderer.computeSystemOptimalCatchments(includedSaved, { maxBucketByIndex });
      }
      app._setOverlapCacheEntry(cacheKey, catchmentResults || []);
      app._logSystemOptimalComputePath(catchmentResults, false);
      drawIfCurrent(catchmentResults);
    }
  },

  scheduleOverlapRecompute(app, delayMs = 120) {
    if (app._overlapRecomputeTimer) clearTimeout(app._overlapRecomputeTimer);
    app._overlapRecomputeTimer = setTimeout(() => {
      app._overlapRecomputeTimer = null;
      app._recomputeSavedOverlapIfNeeded().catch(e => console.warn('Overlap recompute failed', e));
    }, Math.max(0, delayMs));
  },

  getOptimizationSettings() {
    const cur = State.getOptimizationSettings && State.getOptimizationSettings();
    if (cur && typeof cur === 'object') {
      cur.maxBucketByIsochroneId = cur.maxBucketByIsochroneId || {};
      return cur;
    }
    return { includedIsochroneIds: null, linkBudgets: true, globalMaxBucket: null, maxBucketByIsochroneId: {} };
  },

  getOptimizationSelectionAndBudgets(app, visibleSaved) {
    const s = app._getOptimizationSettings();
    const includedIds = Array.isArray(s.includedIsochroneIds) ? new Set(s.includedIsochroneIds) : null;
    const includedSaved = includedIds ? visibleSaved.filter(it => includedIds.has(it.id)) : visibleSaved;
    const buckets = Math.min(...includedSaved.map(it => it.buckets ?? Infinity));
    const maxBucketDefault = Math.max(0, buckets - 1);
    const global = (s.globalMaxBucket == null) ? maxBucketDefault : Math.max(0, Math.min(maxBucketDefault, s.globalMaxBucket));
    const maxBucketByIndex = includedSaved.map(it => {
      const per = s.maxBucketByIsochroneId?.[it.id];
      const v = s.linkBudgets ? global : (per == null ? global : per);
      return Math.max(0, Math.min(maxBucketDefault, v));
    });
    return { includedSaved, maxBucketByIndex };
  },

  updateOptimizationGlobalBudgetLabel(_app, labelEl, bucketIndex, refIsochrone) {
    if (!labelEl) return;
    const timeLimit = refIsochrone?.time_limit != null ? refIsochrone.time_limit : CONFIG.ISOCHRONE_TIME_LIMIT;
    const buckets = refIsochrone?.buckets != null ? refIsochrone.buckets : CONFIG.ISOCHRONE_BUCKETS;
    const lbl = (typeof IsochroneRenderer !== 'undefined' && IsochroneRenderer.getTimeBucketLabel)
      ? IsochroneRenderer.getTimeBucketLabel(bucketIndex, timeLimit, buckets)
      : `${bucketIndex}`;
    labelEl.textContent = `Max. Zeit: ${lbl}`;
  },

  renderOptimizationAdvancedControls(app) {
    const advanced = Utils.getElement('#optimization-advanced-controls');
    const select = Utils.getElement('#config-optimization-mode');
    const cbLink = Utils.getElement('#config-opt-link-budgets');
    const globalRange = Utils.getElement('#config-opt-global-budget');
    const globalLabel = Utils.getElement('#config-opt-global-budget-label');
    const startsContainer = Utils.getElement('#optimization-starts-container');
    const statusEl = Utils.getElement('#optimization-status');
    if (!advanced || !select || !startsContainer) return;

    const mode = select.value || (CONFIG.OPTIMIZATION_MODE || 'none');
    const visibleSaved = (State.getSavedIsochrones() || []).filter(it => it.visible !== false);
    const show = isRememberIsochroneStarts() && mode !== 'none' && visibleSaved.length >= 2;
    advanced.style.display = show ? 'block' : 'none';
    if (!show) return;

    const s = app._getOptimizationSettings();
    const includedIds = Array.isArray(s.includedIsochroneIds) ? new Set(s.includedIsochroneIds) : null;
    const includedSaved = includedIds ? visibleSaved.filter(it => includedIds.has(it.id)) : visibleSaved;
    const first = includedSaved[0] || visibleSaved[0] || {};
    const buckets = Math.min(...includedSaved.map(it => it.buckets ?? Infinity));
    const maxBucketDefault = Math.max(0, buckets - 1);
    if (s.globalMaxBucket == null) s.globalMaxBucket = maxBucketDefault;
    s.globalMaxBucket = Math.max(0, Math.min(maxBucketDefault, s.globalMaxBucket));
    if (cbLink) cbLink.checked = !!s.linkBudgets;

    if (globalRange) {
      globalRange.min = '0';
      globalRange.max = String(maxBucketDefault);
      globalRange.step = '1';
      globalRange.value = String(s.globalMaxBucket);
    }
    app._updateOptimizationGlobalBudgetLabel(globalLabel, s.globalMaxBucket, first);

    const rows = visibleSaved.map((it, idx) => {
      const included = includedIds ? includedIds.has(it.id) : true;
      const per = s.maxBucketByIsochroneId?.[it.id];
      const bucketVal = s.linkBudgets ? s.globalMaxBucket : (per == null ? s.globalMaxBucket : per);
      const clamped = Math.max(0, Math.min(maxBucketDefault, bucketVal));
      const timeLbl = (typeof IsochroneRenderer !== 'undefined' && IsochroneRenderer.getTimeBucketLabel)
        ? IsochroneRenderer.getTimeBucketLabel(clamped, it.time_limit ?? CONFIG.ISOCHRONE_TIME_LIMIT, it.buckets ?? CONFIG.ISOCHRONE_BUCKETS)
        : `${clamped}`;
      const color = it.color || CONFIG.DEFAULT_ISOCHRONE_COLOR;
      return `
        <div class="config-group" style="margin-top: 8px; padding: 8px; border: 1px solid #eee; border-radius: 6px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox" data-opt-include="1" data-iso-id="${it.id}" ${included ? 'checked' : ''} style="width:auto; margin:0;" />
            <span style="display:inline-block; width:10px; height:10px; border-radius: 2px; background:${color}; border:1px solid rgba(0,0,0,0.15);"></span>
            <div style="flex:1; font-size: 12px; font-weight: 600; color:#333;">Start ${idx + 1}</div>
            <div style="font-size: 11px; color:#666;" data-opt-time-label="${it.id}">${timeLbl}</div>
          </div>
          <div style="margin-top: 6px; opacity:${included ? 1 : 0.45};">
            <input type="range" data-opt-budget="1" data-iso-id="${it.id}" min="0" max="${maxBucketDefault}" step="1" value="${clamped}" ${s.linkBudgets ? 'disabled' : ''}/>
          </div>
        </div>
      `;
    }).join('');
    startsContainer.innerHTML = rows;

    startsContainer.querySelectorAll('input[data-opt-include="1"]').forEach(el => {
      el.addEventListener('change', () => {
        const isoId = parseInt(el.getAttribute('data-iso-id'), 10);
        const set = includedIds ? new Set(includedIds) : new Set(visibleSaved.map(v => v.id));
        if (el.checked) set.add(isoId);
        else set.delete(isoId);
        s.includedIsochroneIds = Array.from(set);
        State.setOptimizationSettings(s);
        app._scheduleOverlapRecompute(0);
      });
    });
    startsContainer.querySelectorAll('input[data-opt-budget="1"]').forEach(el => {
      el.addEventListener('input', () => {
        const isoId = parseInt(el.getAttribute('data-iso-id'), 10);
        const v = parseInt(el.value, 10) || 0;
        s.maxBucketByIsochroneId[isoId] = v;
        State.setOptimizationSettings(s);
        const it = visibleSaved.find(x => x.id === isoId);
        const lbl = (typeof IsochroneRenderer !== 'undefined' && IsochroneRenderer.getTimeBucketLabel)
          ? IsochroneRenderer.getTimeBucketLabel(v, it?.time_limit ?? CONFIG.ISOCHRONE_TIME_LIMIT, it?.buckets ?? CONFIG.ISOCHRONE_BUCKETS)
          : `${v}`;
        const labelEl = startsContainer.querySelector(`[data-opt-time-label="${isoId}"]`);
        if (labelEl) labelEl.textContent = lbl;
      });
      el.addEventListener('change', () => {
        app._scheduleOverlapRecompute(0);
      });
    });

    if (statusEl) {
      const includedCount = Array.isArray(s.includedIsochroneIds) ? s.includedIsochroneIds.length : visibleSaved.length;
      statusEl.textContent = `Ausgewählt: ${includedCount} Startpunkte.`;
    }
  },

  async extendIsochroneBucketsForOverlap(app, statusEl, deltaBuckets = 1) {
    if (app._optimizationExtendingBuckets) return;
    app._optimizationExtendingBuckets = true;
    try {
      const visibleSaved = (State.getSavedIsochrones() || []).filter(it => it.visible !== false);
      if (visibleSaved.length < 2) {
        if (statusEl) statusEl.textContent = 'Zu wenige Startpunkte.';
        return;
      }
      const s = app._getOptimizationSettings();
      const includedIds = Array.isArray(s.includedIsochroneIds) ? new Set(s.includedIsochroneIds) : null;
      const includedSaved = includedIds ? visibleSaved.filter(it => includedIds.has(it.id)) : visibleSaved;
      if (includedSaved.length < 2) {
        if (statusEl) statusEl.textContent = 'Zu wenige ausgewählte Startpunkte.';
        return;
      }

      const currentMaxBuckets = Math.max(...includedSaved.map(it => it.buckets ?? 0));
      const targetBuckets = Math.min(60, Math.max(1, currentMaxBuckets + Math.max(1, deltaBuckets)));
      const first = includedSaved[0];
      const stepSec = Math.round((first.time_limit ?? CONFIG.ISOCHRONE_TIME_LIMIT) / Math.max(1, (first.buckets ?? CONFIG.ISOCHRONE_BUCKETS)));
      const targetTimeLimit = targetBuckets * (stepSec || (CONFIG.ISOCHRONE_BUCKET_SIZE_MIN * 60));

      if (statusEl) statusEl.textContent = `Berechne Isochronen neu… (${targetBuckets} Buckets)`;

      const savedAll = State.getSavedIsochrones() || [];
      const fetched = await app._mapWithConcurrency(includedSaved, 3, async (it) => {
        try {
          return await IsochroneService.fetchIsochrone(it.center, {
            time_limit: targetTimeLimit,
            buckets: targetBuckets,
            profile: it.profile ?? CONFIG.PROFILE,
            silent: true
          });
        } catch (_) {
          return null;
        }
      });
      includedSaved.forEach((it, i) => {
        const result = fetched[i];
        if (!result) return;
        const idx = savedAll.findIndex(x => x.id === it.id);
        if (idx >= 0) {
          savedAll[idx] = { ...savedAll[idx], ...result, id: savedAll[idx].id, color: savedAll[idx].color, visible: savedAll[idx].visible };
        }
      });
      State.setSavedIsochrones([...savedAll]);
      if (SavedIsochronesList && SavedIsochronesList.update) SavedIsochronesList.update();

      const newMaxBucket = targetBuckets - 1;
      if (s.globalMaxBucket == null || s.globalMaxBucket < newMaxBucket) s.globalMaxBucket = newMaxBucket;
      includedSaved.forEach(it => { s.maxBucketByIsochroneId[it.id] = Math.max(s.maxBucketByIsochroneId[it.id] ?? 0, newMaxBucket); });
      State.setOptimizationSettings(s);

      if (statusEl) statusEl.textContent = `Erweitert auf ${targetBuckets} Buckets.`;
      app._renderOptimizationAdvancedControls();
      app._redrawAllSavedIsochrones();
    } catch (e) {
      if (statusEl) statusEl.textContent = `Fehler beim Erweitern: ${e?.message || e}`;
    } finally {
      app._optimizationExtendingBuckets = false;
    }
  },

  enforceOverlapBudgets(app, statusEl) {
    const visibleSaved = (State.getSavedIsochrones() || []).filter(it => it.visible !== false);
    if (visibleSaved.length < 2 || typeof OverlapRenderer === 'undefined') return;
    const s = app._getOptimizationSettings();

    const includedIds = Array.isArray(s.includedIsochroneIds) ? new Set(s.includedIsochroneIds) : null;
    const includedSaved = includedIds ? visibleSaved.filter(it => includedIds.has(it.id)) : visibleSaved;
    if (includedSaved.length < 2) {
      if (statusEl) statusEl.textContent = 'Zu wenige ausgewählte Startpunkte.';
      return;
    }

    const first = includedSaved[0] || {};
    const buckets = first.buckets != null ? first.buckets : 5;
    const maxBucket = Math.max(0, buckets - 1);
    const global = (s.globalMaxBucket == null) ? maxBucket : Math.max(0, Math.min(maxBucket, s.globalMaxBucket));

    let budgets = includedSaved.map(it => {
      const per = s.maxBucketByIsochroneId?.[it.id];
      const v = s.linkBudgets ? global : (per == null ? global : per);
      return Math.max(0, Math.min(maxBucket, v));
    });

    const maxIters = (maxBucket + 1) * includedSaved.length + 5;
    let iter = 0;
    let ok = false;
    while (iter < maxIters) {
      const res = OverlapRenderer.computeSystemOptimalCatchments(includedSaved, { maxBucketByIndex: budgets });
      if (res && res.length > 0) { ok = true; break; }
      if (s.linkBudgets) {
        const next = budgets[0] + 1;
        if (next > maxBucket) break;
        budgets = budgets.map(() => next);
      } else {
        const min = Math.min(...budgets);
        if (min >= maxBucket) break;
        budgets = budgets.map(v => (v === min ? v + 1 : v));
      }
      iter++;
    }

    if (!ok) {
      if (statusEl) statusEl.textContent = 'Kein Overlap gefunden (auch bei maximalem Budget).';
      return;
    }

    if (s.linkBudgets) {
      s.globalMaxBucket = budgets[0];
      includedSaved.forEach(it => { s.maxBucketByIsochroneId[it.id] = budgets[0]; });
    } else {
      budgets.forEach((b, i) => { s.maxBucketByIsochroneId[includedSaved[i].id] = b; });
    }
    State.setOptimizationSettings(s);
    if (statusEl) statusEl.textContent = `Overlap gefunden nach ${iter} Schritt(en).`;
    app._renderOptimizationAdvancedControls();
    app._recomputeSavedOverlapIfNeeded().catch(e => console.warn('Overlap recompute failed', e));
  },

  setupOptimizationOverlap(app) {
    const group = Utils.getElement('#optimization-overlap-group');
    const select = Utils.getElement('#config-optimization-mode');
    if (!select) return;
    if (group) group.style.display = isRememberIsochroneStarts() ? 'block' : 'none';
    const mode = CONFIG.OPTIMIZATION_MODE || 'none';
    if (['none', 'overlap', 'system_optimal'].includes(mode)) select.value = mode;
    select.addEventListener('change', () => {
      CONFIG.OPTIMIZATION_MODE = select.value;
      if (CONFIG.OPTIMIZATION_MODE === 'none') MapRenderer.clearOverlap();
      else app._scheduleOverlapRecompute(0);
      app._renderOptimizationAdvancedControls();
    });

    const cbLink = Utils.getElement('#config-opt-link-budgets');
    const globalRange = Utils.getElement('#config-opt-global-budget');
    const globalLabel = Utils.getElement('#config-opt-global-budget-label');
    const btnEnforce = Utils.getElement('#optimization-enforce-overlap');
    const btnAddBuckets = Utils.getElement('#optimization-add-buckets');
    const btnReset = Utils.getElement('#optimization-reset-budgets');
    const statusEl = Utils.getElement('#optimization-status');

    if (cbLink) {
      cbLink.addEventListener('change', () => {
        const s = app._getOptimizationSettings();
        s.linkBudgets = !!cbLink.checked;
        State.setOptimizationSettings(s);
        app._renderOptimizationAdvancedControls();
        app._scheduleOverlapRecompute(0);
      });
    }
    if (globalRange) {
      globalRange.addEventListener('input', () => {
        const s = app._getOptimizationSettings();
        s.globalMaxBucket = parseInt(globalRange.value, 10) || 0;
        if (s.linkBudgets) {
          const vis = (State.getSavedIsochrones() || []).filter(it => it.visible !== false);
          vis.forEach(it => { s.maxBucketByIsochroneId[it.id] = s.globalMaxBucket; });
        }
        State.setOptimizationSettings(s);
        app._updateOptimizationGlobalBudgetLabel(globalLabel, s.globalMaxBucket, (State.getSavedIsochrones() || [])[0]);
        app._renderOptimizationAdvancedControls();
        if ((CONFIG.OPTIMIZATION_MODE || 'none') !== 'none') app._scheduleOverlapRecompute(120);
      });
      globalRange.addEventListener('change', () => {
        if ((CONFIG.OPTIMIZATION_MODE || 'none') !== 'none') app._scheduleOverlapRecompute(0);
      });
    }
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        State.setOptimizationSettings({
          includedIsochroneIds: null,
          linkBudgets: true,
          globalMaxBucket: null,
          maxBucketByIsochroneId: {}
        });
        app._renderOptimizationAdvancedControls();
        app._scheduleOverlapRecompute(0);
      });
    }
    if (btnEnforce) {
      btnEnforce.addEventListener('click', () => {
        app._enforceOverlapBudgets(statusEl);
      });
    }
    if (btnAddBuckets) {
      btnAddBuckets.addEventListener('click', () => {
        app._extendIsochroneBucketsForOverlap(statusEl, 1);
      });
    }
    app._renderOptimizationAdvancedControls();
  }
};

