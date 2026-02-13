# Offene TODOs

Dieses Dokument ersetzt die bisherigen Plan-Dokumente. Hier stehen nur noch offene Punkte.

## App.js-Restrukturierung (offen)

- Phase D: Saved-Isochrone-Controller fertigstellen
  - In `App` delegieren auf `SavedIsochroneController`
  - Methoden aus `src/app.js` entfernen:
    - `_appendSavedIsochroneRender`
    - `_replaceSavedIsochroneRenderAtIndex`
    - `_removeSavedIsochroneRenderAtIndex`
    - `_toggleSavedIsochroneVisibilityInPlace`
    - `_redrawAllSavedIsochrones`
    - `_clearSavedIsochroneRenderState`
    - `applyIsochroneSelectionHighlight`
    - `_onEditSavedIsochroneConfig`
    - `_onSavedIsochroneStartPointDragged`

## Architektur / Aufräumen (offen)

- Konfiguration entkoppeln (ohne Bundler):
  - `src/core/config.defaults.js` + optional `src/core/config.local.js`
  - `index.html` lädt defaults, dann local und merged
  - `CONFIG.POPULATION_PMTILES_URL` beibehalten

- Externe CDN-Abhängigkeiten pinnen oder lokal hosten:
  - `vendor/` mit festen Versionen + SRI in `index.html`

- Population als Feature-Modul klar kapseln:
  - Layer-Integration über Adapter (`PopulationLayer.enable/disable`)
  - `CONFIG.POPULATION_PMTILES_URL` bleibt Schlüssel

## Phase 2 (Entkopplung innerhalb Globals) – offen

- Startpunkt-Generierung aus `RouteService.calculateRoutes` auslagern:
  - `RouteStartsFactory` (z. B. `src/features/routing/starts-factory.js`)

- Map-Layer entkoppeln:
  - Population-Layer Setup in eigene Datei (Adapter)

## Phase 3 (optional, größer) – offen

- Umstieg auf ES-Modules + Bundler (z. B. Vite)
- Externe Libs via npm statt CDN
