// ==== Liste gespeicherter Isochronen-Startpunkte ====
const SavedIsochronesList = {
  _container: null,
  _listGroup: null,
  _editIndex: null,
  _editSelectedCoordinates: null, // [lat,lng] wenn Adresse ausgewählt
  _editLocationDebounce: null,

  _isTransitEnabled() {
    if (typeof isTransitProfileEnabled === 'function') return isTransitProfileEnabled();
    return CONFIG?.TRANSIT_PROFILE_ENABLED !== false;
  },

  init() {
    this._container = Utils.getElement('#saved-isochrones-list');
    this._listGroup = Utils.getElement('#saved-isochrones-list-group');
    if (!this._container) return;

    const clearBtn = Utils.getElement('#saved-isochrones-clear-all');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this._onClearAll());
    }

    const modal = Utils.getElement('#edit-isochrone-modal');
    const applyBtn = Utils.getElement('#edit-isochrone-apply');
    const cancelBtn = Utils.getElement('#edit-isochrone-cancel');
    const profileBtns = document.querySelectorAll('#edit-isochrone-profile-btns .edit-profile-btn');
    const bucketSizeSelect = Utils.getElement('#edit-isochrone-bucket-size');
    const colorInput = Utils.getElement('#edit-isochrone-color');
    const colorHexInput = Utils.getElement('#edit-isochrone-color-hex');
    const swatches = Utils.getElement('#edit-isochrone-color-swatches');
    const locInput = Utils.getElement('#edit-isochrone-location');
    const locSug = Utils.getElement('#edit-isochrone-location-suggestions');
    if (modal && applyBtn) {
      applyBtn.addEventListener('click', () => this._onEditApply());
      if (cancelBtn) cancelBtn.addEventListener('click', () => this._closeEditModal());
      if (bucketSizeSelect) {
        bucketSizeSelect.addEventListener('change', () => this._syncEditModalTimeToBucketSize());
      }
      const editTimeInput = Utils.getElement('#edit-isochrone-time');
      if (editTimeInput) {
        editTimeInput.addEventListener('change', () => this._syncEditModalTimeToBucketSize());
      }
      if (profileBtns.length) {
        profileBtns.forEach(function(btn) {
          btn.addEventListener('click', function() {
            profileBtns.forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
          });
        });
      }
      modal.addEventListener('click', function(e) {
        if (e.target === modal) SavedIsochronesList._closeEditModal();
      });
    }

    // Colorpicker Sync: picker <-> hex field <-> swatches
    const normalizeHex = (v) => {
      const s = String(v || '').trim();
      if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
      if (/^[0-9a-fA-F]{6}$/.test(s)) return ('#' + s).toLowerCase();
      return null;
    };
    const setColor = (hex) => {
      if (!hex) return;
      if (colorInput) colorInput.value = hex;
      if (colorHexInput) colorHexInput.value = hex;
    };
    if (colorInput) {
      colorInput.addEventListener('input', () => setColor(colorInput.value));
      colorInput.addEventListener('change', () => setColor(colorInput.value));
    }
    if (colorHexInput) {
      colorHexInput.addEventListener('input', () => {
        const n = normalizeHex(colorHexInput.value);
        if (n && colorInput) colorInput.value = n;
      });
      colorHexInput.addEventListener('change', () => {
        const n = normalizeHex(colorHexInput.value);
        if (n) setColor(n);
      });
    }
    if (swatches) {
      swatches.querySelectorAll('button[data-color]').forEach(btn => {
        btn.addEventListener('click', () => {
          const n = normalizeHex(btn.getAttribute('data-color'));
          if (n) setColor(n);
        });
      });
    }

    // Modal-Geocoder (Photon via Geocoder.search)
    const escapeHtml = (text) => {
      const div = document.createElement('div');
      div.textContent = String(text || '');
      return div.innerHTML;
    };
    const hideSug = () => { if (locSug) locSug.style.display = 'none'; };
    const showSug = (items) => {
      if (!locSug) return;
      if (!items || !items.length) return hideSug();
      locSug.innerHTML = items.map((s, i) => `
        <div class="geocoder-suggestion" data-index="${i}">
          <div class="geocoder-suggestion-name">${escapeHtml(s.name)}</div>
          <div class="geocoder-suggestion-address">${escapeHtml(s.address)}</div>
          <div class="geocoder-suggestion-type">${escapeHtml(s.type)}</div>
        </div>
      `).join('');
      locSug.style.display = 'block';
      locSug.querySelectorAll('.geocoder-suggestion').forEach((el, i) => {
        el.addEventListener('click', () => {
          const s = items[i];
          if (!s || !s.coordinates) return;
          this._editSelectedCoordinates = s.coordinates;
          if (locInput) locInput.value = s.address || s.name || '';
          hideSug();
        });
      });
    };
    const runSearch = async (q) => {
      if (!locInput || !locSug) return;
      const query = String(q || '').trim();
      if (query.length < 2) return hideSug();
      const map = State.getMap && State.getMap();
      const center = map ? map.getCenter() : null;
      const res = (typeof Geocoder !== 'undefined' && Geocoder.search)
        ? await Geocoder.search(query, { lat: center?.lat, lng: center?.lng, limit: 8 })
        : [];
      showSug(res || []);
    };
    if (locInput) {
      locInput.addEventListener('input', () => {
        this._editSelectedCoordinates = null; // nur Auswahl zählt
        if (this._editLocationDebounce) clearTimeout(this._editLocationDebounce);
        this._editLocationDebounce = setTimeout(() => runSearch(locInput.value), 250);
      });
      locInput.addEventListener('focus', () => {
        if (locSug && locSug.innerHTML.trim()) locSug.style.display = 'block';
      });
    }
    document.addEventListener('click', (e) => {
      if (!locSug || !locInput) return;
      if (e.target === locInput || locSug.contains(e.target)) return;
      hideSug();
    });
  },

  _openEditModal(index) {
    const saved = State.getSavedIsochrones();
    if (index < 0 || index >= saved.length) return;
    this._editIndex = index;
    const item = saved[index];
    const timeMin = item.time_limit != null ? Math.round(item.time_limit / 60) : 10;
    const buckets = item.buckets != null ? item.buckets : 5;
    const requestedProfile = item.profile || 'foot';
    const profile = (!this._isTransitEnabled() && requestedProfile === 'transit') ? 'foot' : requestedProfile;
    const allowedSizes = [1, 2, 3, 5, 10];
    let bucketSizeMin = buckets > 0 ? Math.round(timeMin / buckets) : 5;
    if (!allowedSizes.includes(bucketSizeMin)) {
      bucketSizeMin = allowedSizes.reduce((a, b) => Math.abs(b - bucketSizeMin) < Math.abs(a - bucketSizeMin) ? b : a);
    }
    const timeRounded = Math.round(timeMin / bucketSizeMin) * bucketSizeMin;
    const timeClamped = Math.max(bucketSizeMin, Math.min(120, timeRounded || bucketSizeMin));

    const titleEl = Utils.getElement('#edit-isochrone-modal-title');
    if (titleEl) titleEl.textContent = 'Startpunkt S' + (index + 1) + ' bearbeiten';
    const bucketSizeSelect = Utils.getElement('#edit-isochrone-bucket-size');
    const timeInput = Utils.getElement('#edit-isochrone-time');
    const colorInput = Utils.getElement('#edit-isochrone-color');
    const colorHexInput = Utils.getElement('#edit-isochrone-color-hex');
    const locInput = Utils.getElement('#edit-isochrone-location');
    const profileBtns = document.querySelectorAll('#edit-isochrone-profile-btns .edit-profile-btn');
    if (bucketSizeSelect) bucketSizeSelect.value = String(bucketSizeMin);
    if (timeInput) {
      timeInput.min = bucketSizeMin;
      timeInput.step = bucketSizeMin;
      timeInput.value = timeClamped;
    }
    const c = (item.color && /^#[0-9a-fA-F]{6}$/.test(item.color)) ? item.color : CONFIG.DEFAULT_ISOCHRONE_COLOR;
    if (colorInput) colorInput.value = c;
    if (colorHexInput) colorHexInput.value = c;
    this._editSelectedCoordinates = null;
    if (locInput) {
      locInput.value = '';
      locInput.placeholder = `Aktuell: ${item.center ? (item.center[0].toFixed(5) + ', ' + item.center[1].toFixed(5)) : 'Position'}`;
    }
    if (profileBtns.length) {
      profileBtns.forEach(function(btn) {
        btn.classList.toggle('active', (btn.dataset.profile || '') === profile);
      });
    }
    this._syncEditModalTimeToBucketSize();

    const modal = Utils.getElement('#edit-isochrone-modal');
    if (modal) modal.style.display = 'flex';
  },

  _syncEditModalTimeToBucketSize() {
    const bucketSizeSelect = Utils.getElement('#edit-isochrone-bucket-size');
    const timeInput = Utils.getElement('#edit-isochrone-time');
    if (!bucketSizeSelect || !timeInput) return;
    const bucketSizeMin = parseInt(bucketSizeSelect.value, 10) || 5;
    timeInput.min = bucketSizeMin;
    timeInput.step = bucketSizeMin;
    let timeMin = parseInt(timeInput.value, 10) || bucketSizeMin;
    const rounded = Math.round(timeMin / bucketSizeMin) * bucketSizeMin;
    timeMin = Math.max(bucketSizeMin, Math.min(120, rounded));
    timeInput.value = timeMin;
  },

  _closeEditModal() {
    this._editIndex = null;
    this._editSelectedCoordinates = null;
    const modal = Utils.getElement('#edit-isochrone-modal');
    if (modal) modal.style.display = 'none';
  },

  _onEditApply() {
    const index = this._editIndex;
    if (index == null) return;
    this._syncEditModalTimeToBucketSize();
    const timeInput = Utils.getElement('#edit-isochrone-time');
    const bucketSizeSelect = Utils.getElement('#edit-isochrone-bucket-size');
    const colorInput = Utils.getElement('#edit-isochrone-color');
    const colorHexInput = Utils.getElement('#edit-isochrone-color-hex');
    const profileBtns = document.querySelectorAll('#edit-isochrone-profile-btns .edit-profile-btn');
    const bucketSizeMin = bucketSizeSelect ? parseInt(bucketSizeSelect.value, 10) || 5 : 5;
    const timeMin = timeInput ? Math.max(bucketSizeMin, Math.min(120, parseInt(timeInput.value, 10) || bucketSizeMin)) : bucketSizeMin;
    const buckets = Math.round(timeMin / bucketSizeMin) || 1;
    const rawColor = (colorHexInput && colorHexInput.value) ? colorHexInput.value : (colorInput ? colorInput.value : '');
    const color = /^#?[0-9a-fA-F]{6}$/.test(rawColor)
      ? (rawColor.startsWith('#') ? rawColor : ('#' + rawColor)).toLowerCase()
      : CONFIG.DEFAULT_ISOCHRONE_COLOR;
    let profile = 'foot';
    if (profileBtns.length) {
      const active = Array.from(profileBtns).find(function(b) { return b.classList.contains('active'); });
      if (active) profile = active.dataset.profile || 'foot';
    }
    if (!this._isTransitEnabled() && profile === 'transit') profile = 'foot';
    const selectedCoords = this._editSelectedCoordinates; // vor dem Schließen sichern
    this._closeEditModal();
    if (typeof App !== 'undefined' && App._onEditSavedIsochroneConfig) {
      const cfg = { time_limit: timeMin * 60, buckets: buckets, profile: profile, color: color };
      if (selectedCoords) cfg.center = selectedCoords;
      App._onEditSavedIsochroneConfig(Number(index), cfg);
    }
  },

  toggle(visible) {
    if (this._listGroup) {
      this._listGroup.style.display = visible ? 'block' : 'none';
    }
  },

  /**
   * Hebt die Zeile und den zugehörigen Karten-Marker vis-à-vis hervor (oder hebt ab).
   * @param {number} index - Index des Startpunkts
   * @param {boolean} on - true = hervorheben, false = abheben
   */
  highlightRow(index, on) {
    const row = this._container ? this._container.querySelector(`.saved-isochrone-row[data-index="${index}"]`) : null;
    if (row) {
      row.classList.toggle('saved-isochrone-row--highlight', !!on);
    }
    const markers = State.getSavedIsochroneMarkers();
    const marker = markers && markers[index];
    if (marker && marker._icon) {
      marker._icon.classList.toggle('isochrone-start-point-icon--highlight', !!on);
    }
  },

  /** Entfernt Highlight von allen Listenzeilen und gespeicherten Markern (für Klick-Lock Reset). */
  clearAllHighlights() {
    const saved = State.getSavedIsochrones();
    if (saved && this._container) {
      saved.forEach((_, index) => this.highlightRow(index, false));
    }
  },

  update() {
    if (!this._container) return;
    const saved = State.getSavedIsochrones();
    this._container.innerHTML = '';

    if (!saved || saved.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'target-item';
      empty.style.fontSize = '12px';
      empty.style.color = '#999';
      empty.style.textAlign = 'center';
      empty.textContent = 'Keine Startpunkte gespeichert';
      this._container.appendChild(empty);
      return;
    }

    saved.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'target-item saved-isochrone-row';
      row.dataset.index = String(index);
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.justifyContent = 'space-between';
      row.style.gap = '6px';
      row.style.flexWrap = 'wrap';
      row.addEventListener('mouseenter', () => this.highlightRow(index, true));
      row.addEventListener('mouseleave', () => this.highlightRow(index, false));
      row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        State.setSelectedIsochroneStartKey(index);
        if (typeof App !== 'undefined' && App.applyIsochroneSelectionHighlight) App.applyIsochroneSelectionHighlight();
      });

      const timeMin = item.time_limit != null ? Math.round(item.time_limit / 60) : 10;
      const buckets = item.buckets != null ? item.buckets : 5;
      const profile = item.profile || '–';
      const visible = item.visible !== false;
      const color = (item.color && /^#[0-9a-fA-F]{6}$/.test(item.color)) ? item.color : CONFIG.DEFAULT_ISOCHRONE_COLOR;

      const labelWrap = document.createElement('span');
      labelWrap.style.flex = '1';
      labelWrap.style.minWidth = 0;
      labelWrap.style.display = 'flex';
      labelWrap.style.alignItems = 'center';
      labelWrap.style.gap = '6px';

      const colorSwatch = document.createElement('span');
      colorSwatch.className = 'saved-isochrone-color-swatch';
      colorSwatch.style.cssText = `width:10px;height:10px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.15);flex-shrink:0;`;
      colorSwatch.title = 'Hauptfarbe';

      const label = document.createElement('span');
      label.style.fontSize = '12px';
      label.textContent = `S${index + 1} | ${profile} | ${timeMin} min | ${buckets} Buckets`;

      labelWrap.appendChild(colorSwatch);
      labelWrap.appendChild(label);

      const btnGroup = document.createElement('span');
      btnGroup.style.display = 'flex';
      btnGroup.style.alignItems = 'center';
      btnGroup.style.gap = '4px';
      btnGroup.style.flexShrink = 0;

      const eyeBtn = document.createElement('button');
      eyeBtn.type = 'button';
      eyeBtn.className = 'saved-isochrone-eye-btn';
      eyeBtn.title = visible ? 'Isochrone ausblenden' : 'Isochrone einblenden';
      eyeBtn.setAttribute('aria-label', visible ? 'Ausblenden' : 'Einblenden');
      eyeBtn.innerHTML = visible
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
      eyeBtn.style.background = 'none';
      eyeBtn.style.border = 'none';
      eyeBtn.style.cursor = 'pointer';
      eyeBtn.style.padding = '2px';
      eyeBtn.style.opacity = visible ? '1' : '0.5';
      eyeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._onToggleVisibility(index);
      });

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'saved-isochrone-edit-btn';
      editBtn.title = 'Konfiguration bearbeiten';
      editBtn.setAttribute('aria-label', 'Bearbeiten');
      editBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
      editBtn.style.background = 'none';
      editBtn.style.border = 'none';
      editBtn.style.cursor = 'pointer';
      editBtn.style.padding = '2px';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._openEditModal(index);
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-close';
      delBtn.title = 'Entfernen';
      delBtn.setAttribute('aria-label', 'Startpunkt entfernen');
      delBtn.innerHTML = '×';
      delBtn.style.flexShrink = 0;
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._onRemove(index);
      });

      btnGroup.appendChild(eyeBtn);
      btnGroup.appendChild(editBtn);
      btnGroup.appendChild(delBtn);
      row.appendChild(labelWrap);
      row.appendChild(btnGroup);
      this._container.appendChild(row);
    });
    if (typeof App !== 'undefined' && App.applyIsochroneSelectionHighlight) App.applyIsochroneSelectionHighlight();
  },

  _onToggleVisibility(index) {
    const saved = State.getSavedIsochrones();
    if (index < 0 || index >= saved.length) return;
    saved[index].visible = saved[index].visible === false; // false → true, sonst → false
    State.setSavedIsochrones([...saved]);
    if (typeof App !== 'undefined' && App._toggleSavedIsochroneVisibilityInPlace) {
      App._toggleSavedIsochroneVisibilityInPlace(index);
    } else if (typeof App !== 'undefined' && App._redrawAllSavedIsochrones) {
      App._redrawAllSavedIsochrones();
    }
    this.update();
  },

  _onRemove(index) {
    const saved = State.getSavedIsochrones();
    if (index < 0 || index >= saved.length) return;
    const removed = saved[index];
    const next = saved.filter((_, i) => i !== index);
    State.setSavedIsochrones(next);
    if (typeof App !== 'undefined' && App._removeSavedIsochroneRenderAtIndex) {
      App._removeSavedIsochroneRenderAtIndex(index, removed);
    } else if (typeof App !== 'undefined' && App._redrawAllSavedIsochrones) {
      App._redrawAllSavedIsochrones();
    }
    this.update();
    const exportBtn = Utils.getElement('#export-btn');
    if (exportBtn) {
      exportBtn.disabled = State.getSavedIsochrones().length === 0 && !State.getLastIsochroneResult();
    }
  },

  _onClearAll() {
    State.clearSavedIsochrones();
    if (typeof App !== 'undefined' && App._clearSavedIsochroneRenderState) {
      App._clearSavedIsochroneRenderState();
    } else {
      MapRenderer.clearIsochrones();
      MapRenderer.clearOverlap();
      State.setOverlapPolygonLayers([]);
    }
    if (typeof App !== 'undefined' && App._updateNoTargetHint) {
      App._updateNoTargetHint();
    }
    this.update();
    const exportBtn = Utils.getElement('#export-btn');
    if (exportBtn) {
      exportBtn.disabled = true;
    }
  }
};
