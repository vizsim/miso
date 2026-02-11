// ==== Overpass Service: Abfragen von OpenStreetMap-Daten ====
const OverpassService = {
  _defaultServers: [
    'https://overpass-api.de/api/',
    'https://overpass.kumi.systems/api/',
    'https://maps.mail.ru/osm/tools/overpass/api/',
    'https://overpass.openstreetmap.ru/api/'
  ],

  _handleOverpassError(response, entityType) {
    if (!response) {
      const message = `Alle Overpass-Server nicht erreichbar. Fehler beim Laden der ${entityType}. Bitte versuche es später erneut.`;
      Utils.showError(message, true);
      throw new Error('Overpass API: alle Server fehlgeschlagen');
    }
    if (response.status === 504) {
      const message = `Overpass-Server hat nicht rechtzeitig geantwortet (Timeout). Bitte zoome näher ran und versuche es erneut, oder später nochmal.`;
      Utils.showError(message, true);
      throw new Error('Overpass API Gateway Timeout (504)');
    }
    const message = `Fehler beim Laden der ${entityType}. Bitte versuche es später erneut.`;
    Utils.showError(message, true);
    throw new Error(`Overpass API error: ${response.status}`);
  },

  async _fetchWithFallback(query, entityType) {
    const servers = (typeof CONFIG !== 'undefined' && CONFIG.OVERPASS_SERVERS?.length)
      ? CONFIG.OVERPASS_SERVERS
      : this._defaultServers;
    let lastResponse = null;
    for (const baseUrl of servers) {
      const url = baseUrl.replace(/\/?$/, '/') + 'interpreter';
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`
        });
        if (response.ok) return response;
        lastResponse = response;
      } catch (err) {
        console.warn(`Overpass ${url} fehlgeschlagen:`, err.message || err);
      }
    }
    this._handleOverpassError(lastResponse, entityType);
  },

  /**
   * Sucht POIs mit amenity-Tag im Umkreis (Cafés, Restaurants, Bars/Kneipen).
   * @param {number} lat - Breitengrad
   * @param {number} lng - Längengrad
   * @param {number} radius - Radius in Metern
   * @param {string|string[]} amenityValues - z.B. "cafe", "restaurant" oder ["bar", "pub"]
   * @param {string} entityLabel - z.B. "Cafés"
   * @param {string} defaultName - z.B. "Unbenanntes Café"
   * @returns {Promise<Array>} Array von {id, type, lat, lng, coordinates?, name, tags}
   */
  async _searchAmenity(lat, lng, radius, amenityValues, entityLabel, defaultName) {
    const values = Array.isArray(amenityValues) ? amenityValues : [amenityValues];
    const match = values.length === 1 ? `"amenity"="${values[0]}"` : `"amenity"~"${values.join('|')}"`;
    const query = `
      [out:json][timeout:12];
      (
        node[${match}](around:${radius},${lat},${lng});
        way[${match}](around:${radius},${lat},${lng});
        relation[${match}](around:${radius},${lat},${lng});
      );
      out body;
      >;
      out skel qt;
      relation[${match}](around:${radius},${lat},${lng});
      out center;
    `;
    try {
      const response = await this._fetchWithFallback(query, entityLabel);
      const data = await response.json();
      const results = [];
      const elements = data.elements || [];
      const nodeMap = new Map();
      const ways = [];
      const relations = [];
      const amenitySet = new Set(values);

      for (const el of elements) {
        if (el.type === 'node' && el.lat != null && el.lon != null) nodeMap.set(el.id, [el.lat, el.lon]);
        if (el.type === 'way' && el.nodes) ways.push(el);
        if (el.type === 'relation') relations.push(el);
      }

      for (const el of elements) {
        if (el.type === 'node' && el.tags && amenitySet.has(el.tags.amenity)) {
          results.push({
            id: el.id,
            type: 'node',
            lat: el.lat,
            lng: el.lon,
            name: el.tags?.name || defaultName,
            tags: el.tags || {}
          });
        }
      }

      for (const way of ways) {
        if (!way.tags || !amenitySet.has(way.tags.amenity)) continue;
        const coordinates = [];
        for (const nodeId of way.nodes) {
          const c = nodeMap.get(nodeId);
          if (c) coordinates.push(c);
        }
        if (coordinates.length >= 3) {
          if (coordinates[0][0] !== coordinates[coordinates.length - 1][0] || coordinates[0][1] !== coordinates[coordinates.length - 1][1]) {
            coordinates.push(coordinates[0]);
          }
          results.push({
            id: way.id,
            type: 'way',
            coordinates,
            name: way.tags?.name || defaultName,
            tags: way.tags || {}
          });
        }
      }

      for (const rel of relations) {
        if (!rel.tags || !amenitySet.has(rel.tags.amenity)) continue;
        const center = rel.center || rel;
        if (center.lat != null && center.lon != null) {
          results.push({
            id: rel.id,
            type: 'relation',
            lat: center.lat,
            lng: center.lon,
            name: rel.tags?.name || defaultName,
            tags: rel.tags || {}
          });
        }
      }

      return results;
    } catch (error) {
      console.error('Fehler bei Overpass-Abfrage (' + entityLabel + '):', error);
      return [];
    }
  },

  async searchCafes(lat, lng, radius = 1000) {
    return this._searchAmenity(lat, lng, radius, 'cafe', 'Cafés', 'Unbenanntes Café');
  },

  async searchRestaurants(lat, lng, radius = 1000) {
    return this._searchAmenity(lat, lng, radius, 'restaurant', 'Restaurants', 'Unbenanntes Restaurant');
  },

  async searchBars(lat, lng, radius = 1000) {
    return this._searchAmenity(lat, lng, radius, ['bar', 'pub'], 'Bars/Kneipen', 'Unbenannte Bar');
  }
};

