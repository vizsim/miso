// ==== Konfiguration ====
const CONFIG = {
  // Overpass API: Reihenfolge = Fallback bei Fehlern (erster nicht erreichbar → nächster)
  OVERPASS_SERVERS: [
    "https://overpass-api.de/api/",
    "https://overpass.kumi.systems/api/",
    "https://maps.mail.ru/osm/tools/overpass/api/",
    "https://overpass.openstreetmap.ru/api/"
  ],
  //GH_ROUTE_URL: "https://ghroute.duckdns.org/route", // GraphHopper Route API
  GH_ROUTE_URL: "https://ghroute.vizsim.de/route", // GraphHopper Route API
  //GH_ROUTE_URL: "http://localhost:8989/route", // GraphHopper Route API
  // Isochrone API (gleicher Server, anderer Pfad)
  GH_ISOCHRONE_URL: "https://ghroute.vizsim.de/isochrone", 
  //GH_ISOCHRONE_URL: "http://localhost:8990/isochrone",
  // Transitous/Motis one-to-all (ÖPNV-Isochrone, approximiert im Browser)
  // Standard: direkter Zugriff auf Transitous (CORS-fähig).
  TRANSITOUS_ONE_TO_ALL_URL: "https://api.transitous.org/api/v1/one-to-all",
  //TRANSITOUS_ONE_TO_ALL_URL: "/transitous/api/v1/one-to-all",
  TRANSITOUS_WALK_SPEED_MPS: 1.4, // Restzeit -> Fußweg-Puffer (m/s)
  TRANSITOUS_MAX_TRANSFERS: 14,
  // Einheit der "duration" aus one-to-all:
  // 'auto' (heuristisch), 'minutes' oder 'seconds'
  TRANSITOUS_DURATION_UNIT: 'auto',
  // ÖPNV-Profil ein-/ausschalten (z. B. für statisches Hosting wie GitHub Pages)
  TRANSIT_PROFILE_ENABLED: true,
  // Optionaler Guard: auf *.github.io standardmäßig ausblenden/deaktivieren
  TRANSIT_PROFILE_AUTO_DISABLE_ON_GITHUB_PAGES: false,
  ISOCHRONE_TIME_LIMIT: 1500, // Sekunden (wird aus Zeitlimit Min. abgeleitet)
  ISOCHRONE_BUCKET_SIZE_MIN: 5, // Bucket-Größe in Minuten (z. B. 5 → 0–5, 5–10, …); Zeitlimit nur in diesem Schritt wählbar
  ISOCHRONE_BUCKETS: 0, // wird berechnet: Zeitlimit / Bucket-Größe
  // Isochrone-Geometrie: optional auf Hex-Raster "snappen" (schneller für Turf, weniger Detail)
  ISOCHRONE_HEX_SNAP: true,
  ISOCHRONE_HEX_CELL_SIZE_M: 250, // Basis-Zellgröße (Detailgrad): 100/250/500/1000
  ISOCHRONE_HEX_MAX_CELLS_PER_BUCKET: 12000, // Schutz gegen extrem viele Hex-Zellen (100m braucht mehr)
  ISOCHRONE_HEX_AUTO_UPSCALE: true, // wenn zu viele Zellen: Zellgröße automatisch vergrößern
  PROFILE: "bike", // anpassen (z.B. "foot", "bike", "cargo_bike"...)
  N: 10, // Anzahl der Routen
  RADIUS_M: 2000, // Radius in Metern für Startpunkte
  MAP_CENTER: [52.6858, 14.10078], // [lat, lon]
  MAP_ZOOM: 13,
  AGGREGATED: false, // Aggregierte Darstellung
  AGGREGATION_METHOD: "simple", // "simple" oder "lazyOverlap"
  HIDE_START_POINTS: false, // Startpunkte ausblenden
  HIDE_TARGET_POINTS: false, // Zielpunkte ausblenden
  COLORMAP: "viridis_r", // Colormap: "viridis_r", "plasma_r", "inferno_r", "magma_r"
  REMEMBER_TARGETS: false, // Zielpunkte merken
  REMEMBER_ISOCHRONE_STARTS: false, // Startpunkte (Isochronen) merken
  // Optimierung: 'none' | 'overlap' (von allen in gleicher Zeit) | 'system_optimal' (Einzugsgebiete)
  OPTIMIZATION_MODE: 'none',
  // Einwohner (PMTiles): Overlay „Einwohner“ + ggf. Startpunkte-Gewichtung
  POPULATION_PMTILES_URL: "https://f003.backblazeb2.com/file/unfallkarte-data/Zensus2022_100m_poly_GER_wPLZ_wRS_ew_10.pmtiles", // leer = deaktiviert

  POPULATION_PROPERTY: "Einwohner", // Attributname für Einwohnerzahl im PMTiles-Layer
  POPULATION_LAYER_NAME: "rasters-polys", // Layer-Name im PMTiles (leer = erster Layer mit Features)
  POPULATION_ZOOM: 14, // Zoom für PopulationService (getPopulationFeaturesInRadius / getPopulationAtPoint)
  POPULATION_LAYER_VISIBLE: false, // Overlay beim Start an (wenn true); sonst nur Overlay-Kachel „Einwohner“
  POPULATION_LAYER_MAX_NATIVE_ZOOM: 14, // Nur für PopulationService; Karten-Overlay nutzt immer Overzoom bis z22

  // Overlay ÖPNV (Raster). pt.facilmap.org sendet keine CORS-Header.
  // OVERLAY_OPNV_TILE_URL: Leer = Tiles über CORS-Proxy (rate-limitiert). Sonst direkte/Proxy-URL mit {z}/{x}/{y}.
  OVERLAY_OPNV_TILE_URL: "",
  // Optional: eigener CORS-Proxy (wird nur genutzt wenn OVERLAY_OPNV_TILE_URL leer ist). Format: "https://proxy.de/?url=" – es wird encodeURIComponent(Tile-URL) angehängt. Leer = corsproxy.io (stark rate-limitiert).
  OVERLAY_OPNV_CORS_PROXY: "https://miso-cors-proxy.sims-com.workers.dev/?url="
};

/**
 * Prüft ob der "Zielpunkte merken" Modus aktiv ist
 * @returns {boolean} - true wenn aktiv, false sonst
 */
function isRememberMode() {
  return CONFIG.REMEMBER_TARGETS === true;
}

/**
 * Prüft ob der "Startpunkte merken" Modus für Isochronen aktiv ist
 * @returns {boolean}
 */
function isRememberIsochroneStarts() {
  return CONFIG.REMEMBER_ISOCHRONE_STARTS === true;
}

/**
 * Prüft, ob die App auf GitHub Pages läuft.
 * @returns {boolean}
 */
function isGitHubPagesHost() {
  const host = (typeof window !== 'undefined' && window.location && window.location.hostname)
    ? window.location.hostname
    : '';
  return /\.github\.io$/i.test(host);
}

/**
 * Prüft, ob das ÖPNV-Profil (Transitous) aktiv sein soll.
 * @returns {boolean}
 */
function isTransitProfileEnabled() {
  if (CONFIG.TRANSIT_PROFILE_ENABLED === false) return false;
  if (CONFIG.TRANSIT_PROFILE_AUTO_DISABLE_ON_GITHUB_PAGES === true && isGitHubPagesHost()) return false;
  return true;
}
