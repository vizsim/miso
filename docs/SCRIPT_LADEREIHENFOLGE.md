# Script-Ladereihenfolge & globale Abhängigkeiten

Dieses Projekt nutzt **klassische `<script>`-Tags** (keine `import/export`-Module). Dadurch ist die **Ladereihenfolge** entscheidend, weil Dateien Variablen/Funktionen im Global-Scope erwarten (z. B. `CONFIG`, `State`, `API`, `MapRenderer`, …).

## Reihenfolge (wie in `index.html`)

### Externe Libraries (Globals)

- Leaflet → global `L`
- Turf → global `turf`
- h3-js → global `h3`
- pbf → global `Pbf`
- pmtiles → global `pmtiles`
- protomaps-leaflet → ergänzt Leaflet/Protomaps Integration (für PMTiles-Layer genutzt)

### App-Code (Globals, in dieser Reihenfolge laden)

**Core**

- `src/shared/core/utils.js`
- `src/shared/core/state.js`
- `src/core/config.js` (**enthält u. a. `POPULATION_PMTILES_URL`**)
- `src/shared/core/events.js`

**Domain**

- `src/shared/domain/geo.js` (nutzt u. a. `Utils`)
- `src/shared/domain/api.js` (nutzt u. a. `CONFIG`)
- `src/shared/domain/distribution.js`

**Services**

- `src/services/aggregation-service.js`
- `src/services/target-service.js`
- `src/features/routing/route-service.js` (**Routing bleibt**; nutzt `API`, `Geo`, `Distribution`, optional `PopulationService`)
- `src/features/isochrones/isochrone-service.js`
- `src/features/population/population-service.js` (nutzt `CONFIG.POPULATION_PMTILES_URL`)
- `src/services/export-service.js`
- `src/features/pois/overpass-service.js`

**Visualization**

- `src/visualization/colormap-utils.js`
- `src/visualization/histogram-renderer.js`
- `src/visualization/marker-manager.js`
- `src/features/pois/poi-renderer.js`
- `src/visualization/visualization.js`
- `src/visualization/map-renderer.js` (Population-Layer optional via `CONFIG.POPULATION_PMTILES_URL`)
- `src/features/routing/route-renderer.js` (**Routing bleibt**)
- `src/features/isochrones/isochrone-renderer.js`
- `src/features/isochrones/overlap-renderer.js`

**Utils**

- `src/utils/geocoder.js`

**UI**

- `src/ui/targets-list.js`
- `src/ui/saved-isochrones-list.js`
- `src/ui/config-helpers.js`
- `src/ui/distribution-selector.js`
- `src/ui/colormap-selector.js`
- `src/features/routing/route-warning.js` (**Routing bleibt**)

**Handlers**

- `src/features/routing/route-handler.js` (**Routing bleibt**)

**App**

- `src/app.js` (wired alles zusammen)

## Faustregel für spätere Moves (Phase 1)

- **Nur verschieben** (ohne Module/Bundler) ist ok, solange `index.html` die Pfade aktualisiert und die Reihenfolge gleich bleibt.
- Wenn eine Datei im Global-Scope etwas erwartet, muss deren „Provider“ davor geladen sein.

