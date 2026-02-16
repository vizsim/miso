// ==== API-Funktionen ====
const API = {
  _getTransitModes() {
    return [
      'HIGHSPEED_RAIL', 'LONG_DISTANCE', 'NIGHT_RAIL', 'COACH',
      'REGIONAL_FAST_RAIL', 'REGIONAL_RAIL', 'SUBURBAN', 'SUBWAY', 'TRAM', 'BUS',
      'FERRY', 'CABLE_CAR', 'FUNICULAR', 'AERIAL_LIFT', 'OTHER'
    ];
  },

  _isTransitProfile(profile) {
    const p = String(profile || '').toLowerCase();
    return p === 'transit' || p === 'pt' || p === 'oepnv' || p === 'oev' || p === 'public_transport';
  },

  _isTransitEnabled() {
    if (typeof isTransitProfileEnabled === 'function') return isTransitProfileEnabled();
    return CONFIG?.TRANSIT_PROFILE_ENABLED !== false;
  },

  async fetchRoute(startLatLng, endLatLng) {
    const routeProfile = this._isTransitProfile(CONFIG.PROFILE) ? 'foot' : CONFIG.PROFILE;
    const body = {
      profile: routeProfile,
      points: [
        Geo.llToGhPoint(startLatLng[0], startLatLng[1]),
        Geo.llToGhPoint(endLatLng[0], endLatLng[1]),
      ],
      points_encoded: false, // Wichtig: unencoded coordinates zurückgeben
      instructions: false, // Nicht benötigt
      elevation: false
    };

    const res = await fetch(CONFIG.GH_ROUTE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Route-Fehler ${res.status}: ${txt.slice(0,200)}`);
    }

    const data = await res.json();
    return data;
  },
  
  extractRouteCoordinates(ghResponse) {
    const path = ghResponse.paths?.[0];
    if (!path) {
      return null;
    }

    let coords = null;
    
    // Versuche verschiedene Formate
    if (path.points?.coordinates) {
      coords = path.points.coordinates;
    } else if (path.geometry?.coordinates) {
      coords = path.geometry.coordinates;
    } else if (path.points && typeof path.points === 'string') {
      return null;
    }

    if (!coords || !coords.length) {
      return null;
    }

    // GraphHopper gibt [lon, lat] zurück, konvertiere zu [lat, lon]
    return coords.map(([lon, lat]) => [lat, lon]);
  },

  /**
   * Liest die Routenlänge in Metern aus der GraphHopper-Response (paths[0].distance).
   * @param {Object} ghResponse - Response von POST /route
   * @returns {number|null} - Distanz in Metern oder null
   * @see https://docs.graphhopper.com/openapi/routing/postroute
   */
  extractRouteDistance(ghResponse) {
    const path = ghResponse.paths?.[0];
    if (path == null || typeof path.distance !== 'number') return null;
    return path.distance;
  },

  /**
   * Isochrone abfragen:
   * - Standard: GraphHopper-Server (GET /isochrone)
   * - ÖPNV-Profil: Transitous one-to-all (approximiert zu Polygonen)
   * @param {[number, number]} point - [lat, lng]
   * @param {Object} options - { time_limit (Sekunden), buckets, profile, reverse_flow }
   * @returns {Promise<Object>} - Response mit polygons (GeoJSON FeatureCollection)
   */
  async fetchIsochrone(point, options = {}) {
    const timeLimit = options.time_limit ?? CONFIG.ISOCHRONE_TIME_LIMIT;
    const buckets = options.buckets ?? CONFIG.ISOCHRONE_BUCKETS;
    const profile = options.profile ?? CONFIG.PROFILE;
    if (this._isTransitProfile(profile)) {
      if (!this._isTransitEnabled()) {
        throw new Error('ÖPNV-Profil ist deaktiviert (TRANSIT_PROFILE_ENABLED / GitHub-Pages-Auto-Disable).');
      }
      return this._fetchTransitousIsochrone(point, { timeLimit, buckets });
    }

    const reverseFlow = options.reverse_flow !== undefined ? options.reverse_flow : false;
    const pointStr = `${point[0]},${point[1]}`;
    const params = new URLSearchParams({
      point: pointStr,
      time_limit: String(timeLimit),
      distance_limit: "0",
      profile: profile,
      buckets: String(buckets),
      reverse_flow: String(reverseFlow)
    });

    const url = `${CONFIG.GH_ISOCHRONE_URL}?${params}`;
    const res = await fetch(url);

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Isochrone-Fehler ${res.status}: ${txt.slice(0, 200)}`);
    }

    return res.json();
  },

  _normalizeSeconds(v) {
    if (v == null) return null;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
    return null;
  },

  _pickCoord(item) {
    if (item?.lat != null && item?.lon != null) return [Number(item.lon), Number(item.lat)];
    if (item?.lat != null && item?.lng != null) return [Number(item.lng), Number(item.lat)];
    if (item?.latitude != null && item?.longitude != null) return [Number(item.longitude), Number(item.latitude)];
    // MOTIS one-to-all: entries are often { place: { lat, lon, ... }, duration, ... }
    if (item?.place?.lat != null && item?.place?.lon != null) return [Number(item.place.lon), Number(item.place.lat)];
    if (item?.pos?.lat != null && item?.pos?.lon != null) return [Number(item.pos.lon), Number(item.pos.lat)];
    if (item?.location?.lat != null && item?.location?.lon != null) return [Number(item.location.lon), Number(item.location.lat)];
    if (Array.isArray(item?.coords) && item.coords.length >= 2) return [Number(item.coords[0]), Number(item.coords[1])];
    return null;
  },

  _pickTravelTimeSeconds(item) {
    const candidates = [item?.duration, item?.travelTime, item?.totalTime, item?.time, item?.t, item?.seconds];
    for (const c of candidates) {
      const sec = this._normalizeSeconds(c);
      if (sec != null) return sec;
    }
    return null;
  },

  _extractTransitousReachedPoints(json) {
    const arrays = [];
    const walk = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        arrays.push(obj);
        obj.forEach(walk);
        return;
      }
      Object.keys(obj).forEach((k) => walk(obj[k]));
    };
    walk(json);

    let best = null;
    let bestScore = -1;
    arrays.forEach((arr) => {
      if (!Array.isArray(arr) || arr.length < 10) return;
      let ok = 0;
      arr.forEach((it) => {
        if (this._pickCoord(it) && this._pickTravelTimeSeconds(it) != null) ok++;
      });
      const score = ok / arr.length;
      if (score > bestScore && ok >= 10) {
        bestScore = score;
        best = arr;
      }
    });

    if (!best) {
      throw new Error('Transitous one-to-all: keine passenden Punkte in der Antwort gefunden.');
    }

    const raw = best
      .map((it) => {
        const coord = this._pickCoord(it);
        const tSec = this._pickTravelTimeSeconds(it);
        if (!coord || tSec == null || !Number.isFinite(tSec)) return null;
        if (!Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) return null;
        return { coord, tSec };
      })
      .filter(Boolean);

    // Doppelte Haltestellen/Quellen zusammenführen (z. B. DELFI/VBB-Dubletten)
    // und jeweils die kürzeste Reisezeit behalten.
    const byCoord = new Map();
    raw.forEach((p) => {
      const key = `${p.coord[0].toFixed(6)},${p.coord[1].toFixed(6)}`;
      const prev = byCoord.get(key);
      if (!prev || p.tSec < prev.tSec) byCoord.set(key, p);
    });
    return Array.from(byCoord.values());
  },

  _normalizeTransitousDurations(points, { timeLimitSec, maxTravelTimeMin }) {
    const arr = Array.isArray(points) ? points : [];
    if (!arr.length) return arr;

    const unit = String(CONFIG.TRANSITOUS_DURATION_UNIT || 'auto').toLowerCase();
    let factor = 1;
    if (unit === 'minutes') {
      factor = 60;
    } else if (unit === 'seconds') {
      factor = 1;
    } else {
      // Auto-Heuristik:
      // Wenn die größten Dauerwerte im Bereich von "maxTravelTime in Minuten" liegen,
      // kommen sie sehr wahrscheinlich in Minuten.
      const maxRaw = arr.reduce((m, p) => Math.max(m, Number(p.tSec) || 0), 0);
      const minuteLikeUpper = Math.max((maxTravelTimeMin || 0) + 10, 90);
      const secondLikeLower = Math.max((timeLimitSec || 0) * 0.6, 240);
      factor = (maxRaw > 0 && maxRaw <= minuteLikeUpper && maxRaw < secondLikeLower) ? 60 : 1;
    }

    if (factor === 1) return arr;
    return arr.map((p) => ({ ...p, tSec: p.tSec * factor }));
  },

  _buildTransitousBucketPolygons(points, { timeLimit, buckets }) {
    if (typeof turf === 'undefined') {
      throw new Error('Turf.js fehlt: ÖPNV-Isochronen benötigen Turf für Buffer/Union.');
    }
    const totalSec = Math.max(60, Number(timeLimit) || 600);
    const bucketCount = Math.max(1, Number(buckets) || 5);
    const stepSec = totalSec / bucketCount;
    const maxPoints = 1200;
    const bufferSteps = 8;
    const walkSpeedMps = Number(CONFIG.TRANSITOUS_WALK_SPEED_MPS || 1.4);
    const minRadiusM = 50;

    const reachable = points
      .filter((p) => p.tSec <= totalSec)
      .sort((a, b) => a.tSec - b.tSec)
      .slice(0, maxPoints);

    const out = [];
    for (let bucket = 0; bucket < bucketCount; bucket++) {
      const thresholdSec = Math.round((bucket + 1) * stepSec);
      const polys = [];
      reachable.forEach((p) => {
        if (p.tSec > thresholdSec) return;
        const remaining = Math.max(0, thresholdSec - p.tSec);
        const radiusM = remaining * walkSpeedMps;
        if (radiusM < minRadiusM) return;
        try {
          const poly = turf.buffer(turf.point(p.coord), radiusM / 1000, {
            steps: bufferSteps,
            units: 'kilometers'
          });
          if (poly) polys.push(poly);
        } catch (_) {
          // ungültige Punkte ignorieren
        }
      });
      if (!polys.length) continue;
      let merged = polys[0];
      for (let i = 1; i < polys.length; i++) {
        try {
          merged = turf.union(merged, polys[i]) || merged;
        } catch (_) {
          // einzelne Union-Fehler tolerieren
        }
      }
      if (!merged) continue;
      let geom = merged.geometry || merged;
      try {
        geom = turf.simplify(geom, { tolerance: 0.0008, highQuality: false }) || geom;
      } catch (_) {
        // simplify optional
      }
      out.push({
        type: 'Feature',
        geometry: geom.geometry || geom,
        properties: { bucket }
      });
    }

    return out;
  },

  _buildTransitousUrlCandidates() {
    const configured = String(CONFIG.TRANSITOUS_ONE_TO_ALL_URL || '').trim() || '/transitous/api/v1/one-to-all';
    const directDefault = 'https://api.transitous.org/api/v1/one-to-all';
    const out = [];
    const add = (u) => {
      if (!u || out.includes(u)) return;
      out.push(u);
    };

    add(configured);
    // Häufige lokale Proxy-Varianten:
    add('/api/v1/one-to-all');
    add('/transitous/api/v1/one-to-all');

    // Häufiger Fehler: Proxy-Prefix wird nicht entfernt -> /transitous/... landet 1:1 am Upstream.
    if (configured.startsWith('/transitous/')) {
      add(configured.replace(/^\/transitous/, ''));
    }

    // Relative Pfade zusätzlich direkt gegen Transitous testen (ohne lokalen Proxy).
    if (configured.startsWith('/')) {
      add(`https://api.transitous.org${configured}`);
      if (configured.startsWith('/transitous/')) {
        add(`https://api.transitous.org${configured.replace(/^\/transitous/, '')}`);
      }
    }

    add(directDefault);
    return out;
  },

  _buildTransitousParams(point, maxTravelTimeMin) {
    // Hole die gewählte Abfahrtszeit aus dem UI (falls verfügbar)
    let departureTime = new Date();
    if (typeof ConfigSetupHandlers !== 'undefined' && ConfigSetupHandlers.getTransitDepartureTime) {
      departureTime = ConfigSetupHandlers.getTransitDepartureTime();
    }
    
    return new URLSearchParams({
      one: `${point[0]},${point[1]}`,
      maxTravelTime: String(maxTravelTimeMin),
      time: departureTime.toISOString(),
      transitModes: this._getTransitModes().join(','),
      maxTransfers: String(CONFIG.TRANSITOUS_MAX_TRANSFERS ?? 14),
      arriveBy: 'false',
      useRoutedTransfers: 'false',
      pedestrianProfile: 'FOOT',
      requireBikeTransport: 'false',
      requireCarTransport: 'false',
      preTransitModes: 'WALK',
      postTransitModes: 'WALK',
      maxPreTransitTime: '900',
      maxPostTransitTime: '900',
      elevationCosts: 'NONE',
      maxMatchingDistance: '250',
      ignorePreTransitRentalReturnConstraints: 'false',
      ignorePostTransitRentalReturnConstraints: 'false'
    });
  },

  _isTransitNoReachabilityErrorMessage(msg) {
    const s = String(msg || '').toLowerCase();
    return s.includes('keine passenden punkte')
      || s.includes('keine isochronen-polygone')
      || s.includes('keine isochrone');
  },

  async _fetchTransitousIsochrone(point, { timeLimit, buckets }) {
    const maxTravelTimeMin = Math.max(1, Math.round((timeLimit || 600) / 60));
    const params = this._buildTransitousParams(point, maxTravelTimeMin);

    const candidates = this._buildTransitousUrlCandidates();

    let json = null;
    let points = null;
    let lastErr = null;
    let hadCorsOrNetworkError = false;
    for (const baseUrl of candidates) {
      const url = `${baseUrl}?${params}`;
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' }
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          const err = new Error(`Transitous-Fehler ${res.status}: ${txt.slice(0, 220)}`);
          err.status = res.status;
          lastErr = err;
          // Bei 404/5xx nächste URL probieren, bei anderen Fehlern abbrechen.
          if (res.status === 404 || res.status >= 500) continue;
          throw err;
        }
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.toLowerCase().includes('application/json')) {
          throw new Error(`Transitous antwortet nicht mit JSON (${contentType || 'unbekannt'}).`);
        }
        json = await res.json();
        if (json && typeof json === 'object' && json.error) {
          const code = json.error.code || 'unknown';
          const message = json.error.message || 'Unbekannter API-Fehler';
          throw new Error(`Transitous API-Fehler (${code}): ${message}`);
        }
        points = this._extractTransitousReachedPoints(json);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const msg = String(err?.message || '').toLowerCase();
        if (msg.includes('cors') || msg.includes('networkerror') || msg.includes('failed to fetch')) {
          hadCorsOrNetworkError = true;
        }
      }
    }
    if (!json || !points) {
      const msg = lastErr?.message || 'Unbekannter Fehler';
      if (this._isTransitNoReachabilityErrorMessage(msg)) {
        throw new Error('Keine Iso gefunden, bitte suche naeher an einem OeV-Haltepunkt.');
      }
      if (hadCorsOrNetworkError) {
        throw new Error(
          `Transitous ist aus dem Browser derzeit nicht erreichbar (CORS/Netzwerk). ` +
          `Optional Proxy konfigurieren (z. B. /transitous -> https://api.transitous.org) ` +
          `und TRANSITOUS_ONE_TO_ALL_URL darauf setzen. Letzter Fehler: ${msg}`
        );
      }
      throw new Error(`Transitous-Fehler: ${msg}. Geprüfte Endpunkte: ${candidates.join(', ')}`);
    }

    const normalizedPoints = this._normalizeTransitousDurations(points, {
      timeLimitSec: timeLimit,
      maxTravelTimeMin
    });
    const polygons = this._buildTransitousBucketPolygons(normalizedPoints, { timeLimit, buckets });
    if (!polygons.length) {
      throw new Error('Transitous: Keine Isochronen-Polygone aus den erreichbaren Punkten erzeugt.');
    }

    return {
      polygons: {
        type: 'FeatureCollection',
        features: polygons
      }
    };
  }
};

