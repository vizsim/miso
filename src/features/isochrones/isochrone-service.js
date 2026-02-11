// ==== Isochrone-Service: Isochrone vom GraphHopper-Server abfragen ====
const IsochroneService = {
  _metersToKm(m) {
    return (m || 0) / 1000;
  },

  _h3ResolutionForCellSizeM(cellSizeM) {
    const m = Math.max(1, cellSizeM || 250);
    // Grobe Zuordnung anhand durchschnittlicher Kantenlänge (H3):
    // res10 ~ 66m, res9 ~ 174m, res8 ~ 461m, res7 ~ 1220m, res6 ~ 3229m
    if (m <= 120) return 10;
    if (m <= 250) return 9;
    if (m <= 600) return 8;
    if (m <= 1400) return 7;
    return 6;
  },

  _ensureFeature(input) {
    if (!input) return null;
    if (input.type === 'Feature' && input.geometry) return input;
    const geom = input.geometry || input;
    if (!geom || !geom.type || !geom.coordinates) return null;
    return { type: 'Feature', geometry: geom, properties: input.properties || {} };
  },

  _featureCollectionToMultiPolygon(fc, properties = {}) {
    const features = fc?.features || [];
    if (!features.length) return null;
    if (features.length === 1) {
      const f = features[0];
      return { type: 'Feature', properties, geometry: f.geometry };
    }
    const polys = [];
    for (const f of features) {
      if (!f?.geometry) continue;
      if (f.geometry.type === 'Polygon') polys.push(f.geometry.coordinates);
      if (f.geometry.type === 'MultiPolygon') polys.push(...f.geometry.coordinates);
    }
    if (!polys.length) return null;
    return { type: 'Feature', properties, geometry: { type: 'MultiPolygon', coordinates: polys } };
  },

  _selectHexesFromGrid(grid, polygonFeature) {
    const centroidFn = typeof turf !== 'undefined' && turf.centroid;
    const pipFn = typeof turf !== 'undefined' && turf.booleanPointInPolygon;
    if (!centroidFn || !pipFn) return [];
    const selected = [];
    for (const hex of (grid?.features || [])) {
      try {
        const c = centroidFn(hex);
        if (pipFn(c, polygonFeature)) selected.push(hex);
      } catch (_) {
        // ignore
      }
    }
    return selected;
  },

  _hexSnapPolygonsH3(polygons, cellSizeM, maxCells) {
    if (typeof h3 === 'undefined' || !h3.polygonToCells || !h3.cellsToMultiPolygon) return null;

    const feats = (polygons || []).map(p => this._ensureFeature(p)).filter(Boolean);
    if (!feats.length) return null;

    // Bucket-Index bestimmen + äußersten Bucket wählen (als Worst-Case für Zellanzahl)
    const bucketVals = feats
      .map(f => (f.properties?.bucket ?? f.bucket))
      .filter(v => typeof v === 'number');
    const maxBucket = bucketVals.length ? Math.max(...bucketVals) : null;
    const outer = (maxBucket == null)
      ? feats[0]
      : (feats.find(f => (f.properties?.bucket ?? f.bucket) === maxBucket) || feats[0]);

    const requestedM = cellSizeM || 250;
    const requestedRes = this._h3ResolutionForCellSizeM(requestedM);
    let res = requestedRes;
    const max = maxCells || 2500;

    const polyfillAtRes = (feature, useRes) => {
      const geom = feature?.geometry;
      if (!geom) return [];
      const flag = h3.POLYGON_TO_CELLS_FLAGS?.containmentOverlapping;
      const fillOne = (loops) => {
        try {
          return flag
            ? h3.polygonToCellsExperimental(loops, useRes, flag, true) // isGeoJson = true ([lng,lat])
            : h3.polygonToCells(loops, useRes, true);
        } catch (_) {
          return [];
        }
      };
      if (geom.type === 'Polygon') return fillOne(geom.coordinates);
      if (geom.type === 'MultiPolygon') {
        const set = new Set();
        for (const poly of geom.coordinates) {
          for (const c of fillOne(poly)) set.add(c);
        }
        return Array.from(set);
      }
      return [];
    };

    // Auto-upscale: wenn zu viele Zellen, Resolution verringern (gröbere Hexe)
    let outerCells = polyfillAtRes(outer, res);
    let tries = 0;
    while (outerCells.length > max && res > 0 && tries < 5) {
      res -= 1;
      outerCells = polyfillAtRes(outer, res);
      tries++;
    }
    if (!outerCells.length || outerCells.length > max) return null;
    const upscaled = res !== requestedRes;

    // Effektive Zellgröße (zur Diagnose)
    let effectiveEdgeM = requestedM;
    try {
      if (h3.getHexagonEdgeLengthAvg) {
        effectiveEdgeM = Math.round(h3.getHexagonEdgeLengthAvg(res, h3.UNITS?.m || 'm'));
      }
    } catch (_) {
      // ignore
    }

    // Pro Bucket: H3-Zellen (globales fixes Grid) -> dissolved MultiPolygon über cellsToMultiPolygon
    return feats.map((f) => {
      const props = { ...(f.properties || {}) };
      const cells = polyfillAtRes(f, res);
      if (!cells.length || cells.length > max) return f;
      let mpCoords = null;
      try {
        mpCoords = h3.cellsToMultiPolygon(cells, true); // GeoJSON [lng,lat], closed loops
      } catch (_) {
        mpCoords = null;
      }
      if (!mpCoords || !mpCoords.length) return f;
      const out = {
        type: 'Feature',
        properties: {
          ...props,
          _hex_snapped: true,
          _hex_method: 'h3',
          _hex_res: res,
          _hex_cell_m: effectiveEdgeM,
          _hex_requested_m: requestedM,
          _hex_requested_res: requestedRes,
          _hex_upscaled: upscaled,
          _hex_cells: cells.length
        },
        geometry: {
          type: 'MultiPolygon',
          coordinates: mpCoords
        }
      };
      // In-Memory Cache: H3-Zellen für schnelle Set-Optimierungen (nicht serialisiert)
      out.__h3Cells = cells;
      out.__h3Res = res;
      return out;
    });
  },

  _hexSnapPolygonsTurf(polygons, cellSizeM, maxCells, autoUpscale = true) {
    const hexGridFn = typeof turf !== 'undefined' && turf.hexGrid;
    const bboxFn = typeof turf !== 'undefined' && turf.bbox;
    const dissolveFn = typeof turf !== 'undefined' && turf.dissolve;
    const fcFn = typeof turf !== 'undefined' && turf.featureCollection;
    if (!hexGridFn || !bboxFn || !dissolveFn || !fcFn) return polygons;

    const feats = (polygons || []).map(p => this._ensureFeature(p)).filter(Boolean);
    if (!feats.length) return polygons;

    // Bucket-Index bestimmen
    const buckets = feats
      .map(f => (f.properties?.bucket ?? f.bucket))
      .filter(v => typeof v === 'number');
    const maxBucket = buckets.length ? Math.max(...buckets) : null;
    const outer = (maxBucket == null)
      ? feats[0]
      : (feats.find(f => (f.properties?.bucket ?? f.bucket) === maxBucket) || feats[0]);

    let cellKm = this._metersToKm(cellSizeM || 250);
    if (!cellKm || cellKm <= 0) return polygons;
    const max = maxCells || 2500;

    // Wichtig: EIN fixes Grid pro Isochrone (aus äußerstem Bucket) -> Buckets haben exakt gleiche Hex-Grenzen
    let grid = null;
    let selectedOuter = [];
    let tries = 0;
    while (tries < 5) {
      const bb = bboxFn(outer);
      grid = hexGridFn(bb, cellKm, { units: 'kilometers' });
      selectedOuter = this._selectHexesFromGrid(grid, outer);
      if (!autoUpscale) break;
      if (selectedOuter.length <= max) break;
      cellKm *= 2;
      tries++;
    }
    if (!grid || !selectedOuter.length) return polygons;
    if (selectedOuter.length > max) return polygons;

    const snappedCellM = Math.round(cellKm * 1000);

    // Pro Bucket: Hexe selektieren (aus dem gleichen Grid) und dissolven
    return feats.map((f) => {
      const props = { ...(f.properties || {}) };
      const selected = this._selectHexesFromGrid(grid, f);
      if (!selected.length || selected.length > max) return f;
      const dissolved = dissolveFn(fcFn(selected));
      const out = this._featureCollectionToMultiPolygon(dissolved, {
        ...props,
        _hex_snapped: true,
        _hex_cell_m: snappedCellM,
        _hex_cells: selected.length
      });
      return out || f;
    });
  },

  _hexSnapPolygons(polygons, cellSizeM, maxCells, autoUpscale = true) {
    // Prefer global H3 grid (identische Hex-Grenzen über alle Starts/Buckets)
    const h3Result = this._hexSnapPolygonsH3(polygons, cellSizeM, maxCells);
    if (h3Result) return h3Result;
    // Fallback: Turf hexGrid (lokales Grid pro Isochrone)
    return this._hexSnapPolygonsTurf(polygons, cellSizeM, maxCells, autoUpscale);
  },

  /**
   * Berechnet eine Isochrone für einen Punkt (Klick in die Karte).
   * @param {[number, number]} point - [lat, lng]
   * @param {Object} options - { time_limit, buckets, profile, silent } - silent: true = kein Event, nur Rückgabe
   * @returns {Promise<Object|null>} - { center, polygons, time_limit, buckets } oder null
   */
  async fetchIsochrone(point, options = {}) {
    if (!Utils.assertExists(point, 'Point')) return null;
    if (!Array.isArray(point) || point.length !== 2) {
      Utils.showError('Ungültiger Punkt', true);
      return null;
    }

    const timeLimit = options.time_limit ?? CONFIG.ISOCHRONE_TIME_LIMIT;
    const buckets = options.buckets ?? CONFIG.ISOCHRONE_BUCKETS;
    const profile = options.profile ?? CONFIG.PROFILE;

    try {
      EventBus.emit(Events.ISOCHRONE_CALCULATING, { active: true });
      const data = await API.fetchIsochrone(point, {
        time_limit: timeLimit,
        buckets: buckets,
        profile: profile
      });

      let polygons = data.polygons;
      if (polygons && polygons.features) polygons = polygons.features;
      if (!polygons) polygons = data.features || [];
      polygons = Array.isArray(polygons) ? polygons : [];
      if (!polygons.length) {
        Utils.showError('Isochrone: Keine Polygone in der Antwort.', true);
        return null;
      }

      // Optional: Hex-Raster-Snapping (reduziert Detail / beschleunigt Turf-Operationen)
      if (CONFIG.ISOCHRONE_HEX_SNAP) {
        const cellSizeM = CONFIG.ISOCHRONE_HEX_CELL_SIZE_M || 250;
        const maxCells = CONFIG.ISOCHRONE_HEX_MAX_CELLS_PER_BUCKET || 2500;
        const autoUpscale = CONFIG.ISOCHRONE_HEX_AUTO_UPSCALE !== false;
        polygons = this._hexSnapPolygons(polygons, cellSizeM, maxCells, autoUpscale);
      }

      const result = {
        center: point,
        polygons: polygons,
        time_limit: timeLimit,
        buckets: buckets,
        profile: profile
      };

      if (!options.silent) {
        EventBus.emit(Events.ISOCHRONE_CALCULATED, result);
      }
      return result;
    } catch (err) {
      Utils.logError('IsochroneService.fetchIsochrone', err);
      Utils.showError(`Isochrone-Fehler: ${err.message}`, true);
      return null;
    } finally {
      EventBus.emit(Events.ISOCHRONE_CALCULATING, { active: false });
    }
  }
};

