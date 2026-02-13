// ==== Config Setup Handlers (aus App ausgelagert) ====
const ConfigSetupHandlers = {
  /**
   * Aktualisiert das Transit-Info-Panel (Sichtbarkeit + Abfahrtszeit)
   */
  updateTransitInfoPanel() {
    const panel = Utils.getElement('#transit-info-panel');
    if (!panel) return;

    const isTransit = CONFIG.PROFILE === 'transit';
    panel.style.display = isTransit ? 'block' : 'none';

    if (isTransit) {
      const departureTimeInput = Utils.getElement('#transit-departure-time');
      
      // Initialisiere Flatpickr, falls noch nicht geschehen
      if (departureTimeInput && !departureTimeInput._flatpickr) {
        const now = new Date();
        
        departureTimeInput._flatpickr = flatpickr(departureTimeInput, {
          enableTime: true,
          time_24hr: true,
          dateFormat: "d.m.Y, H:i",
          defaultDate: now,
          locale: "de",
          allowInput: true,
          minuteIncrement: 5,
          clickOpens: true
        });
        
        // "Jetzt"-Button Event-Listener
        const nowBtn = Utils.getElement('#transit-time-now-btn');
        if (nowBtn && !nowBtn._listenerAdded) {
          nowBtn.addEventListener('click', () => {
            if (departureTimeInput._flatpickr) {
              departureTimeInput._flatpickr.setDate(new Date(), true);
            }
          });
          nowBtn._listenerAdded = true;
        }
      }

      // Max. Umstiege aktualisieren
      const maxTransfersEl = Utils.getElement('#transit-max-transfers');
      if (maxTransfersEl) {
        maxTransfersEl.textContent = CONFIG.TRANSITOUS_MAX_TRANSFERS || 14;
      }
    }
  },
  
  /**
   * Gibt die gewählte Transit-Abfahrtszeit als Date-Objekt zurück
   * @returns {Date} - Die gewählte Zeit oder aktuelle Zeit als Fallback
   */
  getTransitDepartureTime() {
    const departureTimeInput = Utils.getElement('#transit-departure-time');
    
    // Versuche zuerst das Datum aus Flatpickr zu holen
    if (departureTimeInput && departureTimeInput._flatpickr) {
      const selectedDates = departureTimeInput._flatpickr.selectedDates;
      if (selectedDates && selectedDates.length > 0) {
        return selectedDates[0];
      }
    }
    
    // Fallback: versuche das Feld zu parsen
    if (departureTimeInput && departureTimeInput.value) {
      // Deutsches Format: dd.mm.yyyy, HH:MM
      const match = departureTimeInput.value.match(/(\d{1,2})\.(\d{1,2})\.(\d{4}),?\s*(\d{1,2}):(\d{2})/);
      if (match) {
        const [, day, month, year, hours, minutes] = match;
        return new Date(year, month - 1, day, hours, minutes);
      }
    }
    
    return new Date(); // Fallback: aktuelle Zeit
  },

  setupProfileButtons(app) {
    const profileBtns = Utils.getElements('.profile-btn:not(.edit-profile-btn)');
    if (!profileBtns || profileBtns.length === 0) return;

    profileBtns.forEach(btn => {
      if (btn.dataset.profile === CONFIG.PROFILE) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Initial Transit-Panel-Status setzen
    this.updateTransitInfoPanel();

    profileBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        profileBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        app._updateConfigFromUI();
        if (typeof updateConfigFromUI !== 'function') {
          CONFIG.PROFILE = btn.dataset.profile || CONFIG.PROFILE;
        }

        // Transit-Panel aktualisieren
        ConfigSetupHandlers.updateTransitInfoPanel();

        const selectedIndex = State.getSelectedTargetIndex();
        if (selectedIndex !== null && isRememberMode()) {
          return;
        }
        EventBus.emit(Events.CONFIG_PROFILE_CHANGED, { profile: CONFIG.PROFILE });
      });
    });
  },

  setupHistogramModeButtons(app) {
    const btns = Utils.getElements('.histogram-mode-btn');
    if (!btns || btns.length === 0) return;
    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        btns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        app._refreshHistogram();
      });
    });
  },

  setupAggregationToggle(app) {
    const aggregatedInput = Utils.getElement('#config-aggregated');
    if (!aggregatedInput) return;

    aggregatedInput.checked = CONFIG.AGGREGATED;
    aggregatedInput.addEventListener('change', () => {
      app._updateConfigFromUI();
      if (typeof updateConfigFromUI !== 'function') {
        CONFIG.AGGREGATED = aggregatedInput.checked;
      }
      if (typeof toggleAggregationUI === 'function') {
        toggleAggregationUI();
      } else {
        const legend = Utils.getElement('#legend');
        const methodGroup = Utils.getElement('#aggregation-method-group');
        const hideStartPointsGroup = Utils.getElement('#hide-start-points-group');

        if (legend) legend.style.display = CONFIG.AGGREGATED ? 'block' : 'none';
        if (methodGroup) methodGroup.style.display = CONFIG.AGGREGATED ? 'block' : 'none';
        if (hideStartPointsGroup) hideStartPointsGroup.style.display = CONFIG.AGGREGATED ? 'block' : 'none';
        if (CONFIG.AGGREGATED && legend && legend.style.display === 'block') {
          Visualization.updateLegendGradient();
          Visualization.updateColormapPreviews();
        }
      }
      EventBus.emit(Events.CONFIG_AGGREGATION_CHANGED);
    });
  },

  setupAggregationMethod(app) {
    const methodInput = Utils.getElement('#config-aggregation-method');
    if (!methodInput) return;

    methodInput.value = CONFIG.AGGREGATION_METHOD;
    methodInput.addEventListener('change', () => {
      app._updateConfigFromUI();
      if (typeof updateConfigFromUI !== 'function') {
        CONFIG.AGGREGATION_METHOD = methodInput.value || CONFIG.AGGREGATION_METHOD;
      }
      EventBus.emit(Events.CONFIG_AGGREGATION_CHANGED);
    });
  },

  setupRouteCountInput(app) {
    const nInput = Utils.getElement('#config-n');
    if (!nInput) return;

    nInput.value = CONFIG.N;
    nInput.addEventListener('change', async () => {
      app._updateConfigFromUI();
      if (typeof updateConfigFromUI !== 'function') {
        CONFIG.N = Utils.validateNumber(nInput.value, 1, 1000, CONFIG.N);
        nInput.value = CONFIG.N;
      }
      await app._recalculateRoutesIfTargetExists();
    });
  },

  setupRadiusInput(app) {
    const radiusInput = Utils.getElement('#config-radius');
    if (!radiusInput) return;

    radiusInput.value = CONFIG.RADIUS_M / 1000;
    radiusInput.addEventListener('change', async () => {
      app._updateConfigFromUI();
      if (typeof updateConfigFromUI !== 'function') {
        const radiusKm = Utils.validateNumber(radiusInput.value, 0.1, 100, CONFIG.RADIUS_M / 1000);
        CONFIG.RADIUS_M = radiusKm * 1000;
        radiusInput.value = radiusKm;
      }
      const selectedIndex = State.getSelectedTargetIndex();
      if (selectedIndex !== null && isRememberMode()) return;
      await app._recalculateRoutesIfTargetExists();
    });
  },

  setupHideStartPoints(app) {
    const hideStartPointsInput = Utils.getElement('#config-hide-start-points');
    if (!hideStartPointsInput) return;

    hideStartPointsInput.checked = CONFIG.HIDE_START_POINTS;
    hideStartPointsInput.addEventListener('change', () => {
      app._updateConfigFromUI();
      if (typeof updateConfigFromUI !== 'function') {
        CONFIG.HIDE_START_POINTS = hideStartPointsInput.checked;
      }
      Visualization.toggleStartPointsVisibility();
    });
  },

  setupHideTargetPoints(app) {
    const hideTargetPointsInput = Utils.getElement('#config-hide-target-points');
    if (!hideTargetPointsInput) return;

    hideTargetPointsInput.checked = CONFIG.HIDE_TARGET_POINTS;
    hideTargetPointsInput.addEventListener('change', () => {
      app._updateConfigFromUI();
      if (typeof updateConfigFromUI !== 'function') {
        CONFIG.HIDE_TARGET_POINTS = hideTargetPointsInput.checked;
      }
      Visualization.toggleTargetPointsVisibility();
    });
  }
};

