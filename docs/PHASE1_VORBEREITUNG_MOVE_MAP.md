# Phase 1 – Vorbereitung: Move-Map (ohne Bundler, ohne `import/export`)

Ziel von Phase 1: Dateien **feature-orientiert** gruppieren, aber weiterhin per `<script>` laden. Das ist rein organisatorisch: **keine Logikänderungen**, nur Pfade + `index.html` anpassen.

Wichtig:

- **Routing bleibt** als eigenes Feature (nicht entfernen).
- **`CONFIG.POPULATION_PMTILES_URL` bleibt** in `src/core/config.js`.
- Die **Ladereihenfolge** muss identisch bleiben (siehe `docs/SCRIPT_LADEREIHENFOLGE.md`).

## Vorschlag Zielstruktur

```
src/
  shared/
    core/           (utils/state/config/events)
    domain/         (geo/api/distribution)
  features/
    routing/        (route-service/route-renderer/route-handler/route-warning)
    isochrones/     (isochrone-service/isochrone-renderer/overlap-renderer)
    population/     (population-service + layer adapter optional)
    pois/           (overpass-service + poi-renderer)
  visualization/    (map-renderer, marker-manager, visualization orchestration, histogram, colormap)
  ui/               (ui components)
  app.js
```

Hinweis: `visualization/` kann man auch langfristig in `features/*` aufteilen – für Phase 1 lieber konservativ bleiben.

## Move-Map (Quelle → Ziel)

### Shared/Core/Domain

- `src/core/utils.js` → `src/shared/core/utils.js`
- `src/core/state.js` → `src/shared/core/state.js`
- `src/core/config.js` → `src/shared/core/config.js`
- `src/core/events.js` → `src/shared/core/events.js`

- `src/domain/geo.js` → `src/shared/domain/geo.js`
- `src/domain/api.js` → `src/shared/domain/api.js`
- `src/domain/distribution.js` → `src/shared/domain/distribution.js`

### Routing (bleibt)

- `src/services/route-service.js` → `src/features/routing/route-service.js`
- `src/handlers/route-handler.js` → `src/features/routing/route-handler.js`
- `src/visualization/route-renderer.js` → `src/features/routing/route-renderer.js`
- `src/ui/route-warning.js` → `src/features/routing/route-warning.js`

### Isochrones

- `src/services/isochrone-service.js` → `src/features/isochrones/isochrone-service.js`
- `src/visualization/isochrone-renderer.js` → `src/features/isochrones/isochrone-renderer.js`
- `src/visualization/overlap-renderer.js` → `src/features/isochrones/overlap-renderer.js`

### Population (URL-Key bleibt)

- `src/services/population-service.js` → `src/features/population/population-service.js`
  - `map-renderer.js` bleibt vorerst, kann später einen dünnen Adapter nutzen

### POIs

- `src/services/overpass-service.js` → `src/features/pois/overpass-service.js`
- `src/visualization/poi-renderer.js` → `src/features/pois/poi-renderer.js`

### Rest zunächst unverändert lassen

- `src/services/{aggregation-service,target-service,export-service}.js` vorerst lassen (oder später ebenfalls in Features überführen)
- `src/visualization/{map-renderer,marker-manager,visualization,histogram-renderer,colormap-utils}.js` vorerst lassen
- `src/ui/*` vorerst lassen (außer `route-warning.js`, wenn du Routing komplett kapseln willst)
- `src/utils/geocoder.js` vorerst lassen (später `shared/utils`)

## Was sich bei Phase 1 konkret ändert

- Nur:
  - Dateien verschieben
  - Pfade in `index.html` aktualisieren
  - ggf. wenige harte Pfad-Strings (falls vorhanden; normalerweise nicht)
- Nicht:
  - globale Namen umbenennen
  - Event-Namen ändern
  - API-Keys/URLs anfassen

## Leaflet -> MapLibre vorbereiten (kurz)

- In Phase 1 bleibt Leaflet aktiv; dafür keine Verhaltensänderungen riskieren.
- Für den späteren Wechsel eine kleine Karten-Adapter-Schicht einziehen:
  - `MapRenderer` in `map-adapter` + konkrete Implementierung (`leaflet-map-adapter`) splitten.
  - POI-/Route-/Isochrone-Renderer so kapseln, dass sie nur Adapter-Methoden nutzen (z. B. `drawPolyline`, `drawPolygon`, `addMarker`, `bindTooltip`).
- PMTiles/Population-Logik unabhängig von Leaflet halten (bereits weitgehend im Service).

