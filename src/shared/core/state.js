// ==== State-Management ====
const State = {
  // Map & Layer
  map: null,
  layerGroup: null,
  
  // Route State
  lastTarget: null,
  allTargets: [], // Array für mehrere Zielpunkte
  targetMarkers: [], // Marker für alle Zielpunkte
  currentTargetMarker: null, // Marker für aktuellen Zielpunkt im normalen Modus
  targetRoutes: [], // Routen pro Zielpunkt: [{target: [lat, lng], routeData: [...], routeResponses: [...], routePolylines: [...], starts: [...], colors: [...]}, ...]
  lastStarts: null,
  lastColors: null,
  startMarkers: [],
  routePolylines: [],
  allRouteData: [],
  allRouteResponses: [],
  isochronePolygonLayers: [], // Leaflet-Polygone der gezeichneten Isochronen
  lastIsochroneResult: null, // { center, polygons, time_limit, buckets } (Einzelmodus)
  savedIsochrones: [], // Gespeicherte Isochronen: [{ id, center, polygons, time_limit, buckets, profile }, ...]
  savedIsochroneMarkers: [], // Marker für jeden gespeicherten Startpunkt
  nextIsochroneId: 1,
  overlapPolygonLayers: [], // Überlappungs-Polygone (Optimierung)
  optimizationSettings: {
    includedIsochroneIds: null, // null = alle sichtbaren einbeziehen
    linkBudgets: true, // ein Zeitbudget für alle
    globalMaxBucket: null, // null = buckets-1
    maxBucketByIsochroneId: {} // { [id]: bucketIndex }
  },
  expectedDistribution: null, // Manuell angepasste erwartete Verteilung
  cafeMarkers: [],
  cafeSearchRadiusCircle: null,
  restaurantMarkers: [],
  restaurantSearchRadiusCircle: null,
  barMarkers: [],
  barSearchRadiusCircle: null,
  selectedTargetIndex: null, // Index des ausgewählten Zielpunkts
  selectedIsochroneStartKey: null, // 'current' | number (Index) | null = keiner ausgewählt (Klick-Lock)
  nextTargetId: 1, // Nächste eindeutige ID für Zielpunkte (z1, z2, z3, ...)
  targetIdMap: new Map(), // Map: target string -> targetId (für schnellen Zugriff)
  
  // Getter
  getMap() { return this.map; },
  getLayerGroup() { return this.layerGroup; },
  getLastTarget() { return this.lastTarget; },
  getAllTargets() { return this.allTargets; },
  getTargetMarkers() { return this.targetMarkers; },
  getCurrentTargetMarker() { return this.currentTargetMarker; },
  getTargetRoutes() { return this.targetRoutes; },
  getLastStarts() { return this.lastStarts; },
  getLastColors() { return this.lastColors; },
  getStartMarkers() { return this.startMarkers; },
  getRoutePolylines() { return this.routePolylines; },
  getAllRouteData() { return this.allRouteData; },
  getAllRouteResponses() { return this.allRouteResponses; },
  getIsochronePolygonLayers() { return this.isochronePolygonLayers; },
  getLastIsochroneResult() { return this.lastIsochroneResult; },
  getSavedIsochrones() { return this.savedIsochrones; },
  getSavedIsochroneMarkers() { return this.savedIsochroneMarkers; },
  getNextIsochroneId() { return this.nextIsochroneId; },
  getOverlapPolygonLayers() { return this.overlapPolygonLayers; },
  getOptimizationSettings() { return this.optimizationSettings; },
  getExpectedDistribution() { return this.expectedDistribution; },
  getCafeMarkers() { return this.cafeMarkers; },
  getCafeSearchRadiusCircle() { return this.cafeSearchRadiusCircle; },
  getRestaurantMarkers() { return this.restaurantMarkers; },
  getRestaurantSearchRadiusCircle() { return this.restaurantSearchRadiusCircle; },
  getBarMarkers() { return this.barMarkers; },
  getBarSearchRadiusCircle() { return this.barSearchRadiusCircle; },
  getSelectedTargetIndex() { return this.selectedTargetIndex; },
  getSelectedIsochroneStartKey() { return this.selectedIsochroneStartKey; },
  getNextTargetId() { return this.nextTargetId; },
  getTargetId(target) { 
    const key = `${target[0]},${target[1]}`;
    return this.targetIdMap.get(key);
  },
  
  // Setter
  setMap(map) { this.map = map; },
  setLayerGroup(layerGroup) { this.layerGroup = layerGroup; },
  setLastTarget(target) { this.lastTarget = target; },
  setAllTargets(targets) { this.allTargets = targets; },
  setTargetMarkers(markers) { this.targetMarkers = markers; },
  setCurrentTargetMarker(marker) { this.currentTargetMarker = marker; },
  setTargetRoutes(routes) { this.targetRoutes = routes; },
  setLastStarts(starts) { this.lastStarts = starts; },
  setLastColors(colors) { this.lastColors = colors; },
  setStartMarkers(markers) { this.startMarkers = markers; },
  setRoutePolylines(polylines) { this.routePolylines = polylines; },
  setAllRouteData(data) { this.allRouteData = data; },
  setAllRouteResponses(responses) { this.allRouteResponses = responses; },
  setIsochronePolygonLayers(layers) { this.isochronePolygonLayers = layers; },
  setLastIsochroneResult(result) { this.lastIsochroneResult = result; },
  setSavedIsochrones(arr) { this.savedIsochrones = arr; },
  setSavedIsochroneMarkers(markers) { this.savedIsochroneMarkers = markers; },
  setNextIsochroneId(id) { this.nextIsochroneId = id; },
  setOverlapPolygonLayers(layers) { this.overlapPolygonLayers = layers; },
  setOptimizationSettings(settings) { this.optimizationSettings = settings; },
  incrementNextIsochroneId() { this.nextIsochroneId++; },
  setExpectedDistribution(dist) { this.expectedDistribution = dist; },
  setCafeMarkers(markers) { this.cafeMarkers = markers; },
  setCafeSearchRadiusCircle(circle) { this.cafeSearchRadiusCircle = circle; },
  setRestaurantMarkers(markers) { this.restaurantMarkers = markers; },
  setRestaurantSearchRadiusCircle(circle) { this.restaurantSearchRadiusCircle = circle; },
  setBarMarkers(markers) { this.barMarkers = markers; },
  setBarSearchRadiusCircle(circle) { this.barSearchRadiusCircle = circle; },
  setSelectedTargetIndex(index) { this.selectedTargetIndex = index; },
  setSelectedIsochroneStartKey(key) { this.selectedIsochroneStartKey = key; },
  setNextTargetId(id) { this.nextTargetId = id; },
  incrementNextTargetId() { this.nextTargetId++; },
  setTargetId(target, id) {
    const key = `${target[0]},${target[1]}`;
    this.targetIdMap.set(key, id);
  },
  removeTargetId(target) {
    const key = `${target[0]},${target[1]}`;
    this.targetIdMap.delete(key);
  },
  
  // Reset
  resetRouteData() {
    this.routePolylines = [];
    this.allRouteData = [];
    this.allRouteResponses = [];
  },
  resetIsochroneData() {
    this.isochronePolygonLayers = [];
    this.lastIsochroneResult = null;
  },
  clearSavedIsochrones() {
    this.savedIsochrones = [];
    this.savedIsochroneMarkers = [];
    this.selectedIsochroneStartKey = null;
  }
};

