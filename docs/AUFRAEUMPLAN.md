# Aufräum- & Restrukturierungsplan (Miso)

Ziel: Das Projekt so aufräumen, dass **klar ist, was Runtime-Code ist**, was „Legacy/optional“ ist, und dass die Architektur zukünftige Änderungen leichter macht – ohne Feature-Verlust.

## Nicht anfassen / muss erhalten bleiben

- **Routing-Funktionen**: Alles rund um Route-Berechnung und -Visualisierung bleibt erhalten (u. a. `src/services/route-service.js`, `src/handlers/route-handler.js`, `src/visualization/route-renderer.js`, `src/ui/route-warning.js`).
- **`CONFIG.POPULATION_PMTILES_URL`**: Muss erhalten bleiben (Population-Weighting/Layer sind Feature-Flags und dürfen nicht kaputt gehen).

## Kurzer Ist-Überblick (Runtime)

- **Entry**: `index.html` lädt alle JS-Dateien per `<script src="...">` (keine Bundling-Pipeline).
- **Core**: `src/core/{utils,state,config,events}.js`
- **Domain**: `src/domain/{api,geo,distribution}.js`
- **Services**: `src/services/*` (u. a. Isochrone, Overpass, Export, Routing, Population)
- **Visualization**: `src/visualization/*` (Leaflet/Turf/PMTiles/Protomaps Integration)
- **UI**: `src/ui/*`
- **Handlers**: `src/handlers/route-handler.js`

## Was kann wahrscheinlich weg (oder zumindest isoliert werden)

### Sicherer Kandidat: `src/core/compat.js`

- Datei wird aktuell **nicht** in `index.html` eingebunden und es gibt keine Referenzen im Code.
- Inhalt ist effektiv wirkungslos (block-scoped `const Aggregation` innerhalb eines `if`).
- **Maßnahme**: Entfernen oder (falls Migration geplant) korrekt als globaler Alias implementieren und in `index.html` einbinden. Empfehlung: **löschen**, solange es keine konkrete Migration gibt.

### Python-Setup (`pyproject.toml`, `uv.lock`)

- Im Repo existiert ein Python-Projekt (`routing-bulk`) mit `geopandas/pyarrow`, aber es gibt **keine `.py` Dateien** im Workspace.
- **Interpretation**: Vermutlich ein Rest/Tooling für Datenvorbereitung, nicht Teil der Web-Runtime.
- **Maßnahme (Option A – bevorzugt)**: In `tools/` auslagern (z. B. `tools/python/`), mit eigener `README` („wofür ist das?“).
- **Maßnahme (Option B)**: Wenn sicher ungenutzt: entfernen. (Nur nach kurzer Git-Historie/Team-Absprache – hier als Planpunkt, nicht automatisch.)

### Doku-Ballast

- `docs/` enthält mehrere Dateien „teils aus Vorprojekt“ (laut `README.md`).
- **Maßnahme**: `docs/` in zwei Bereiche teilen:
  - `docs/runtime/` (nur Doku zur aktuellen Web-App)
  - `docs/archive/` (Vorprojekt/Ideen/alte Problemstellungen)

## Was kann outgesourct werden (ohne Feature-Verlust)

### 1) Konfiguration (URLs/Defaults) aus dem Code ziehen

Heute: `src/core/config.js` enthält API-URLs und Feature-Flags.

- **Ziel**: Environment-spezifische Werte ohne Code-Änderung tauschen (dev/staging/prod).
- **Minimal-invasive Option (ohne Bundler)**:
  - `src/core/config.defaults.js` (im Repo)
  - `src/core/config.local.js` (gitignored, optional)
  - `index.html` lädt erst defaults, dann local (falls vorhanden) und merged.
- **Wichtig**: `POPULATION_PMTILES_URL` bleibt als Schlüssel erhalten.

### 2) Externe CDN-Abhängigkeiten pinnen/selbst hosten

Heute: Leaflet/Turf/H3/PBF/PMTiles/Protomaps kommen via CDN.

- **Risiko**: CDN-Ausfall/Breaking changes.
- **Optionen**:
  - Vendor-Folder (`vendor/`) + feste Versionen + Subresource Integrity (SRI) im HTML
  - oder mittelfristig Bundler/Package-Manager (siehe unten)

### 3) Population-PMTiles als „Feature-Modul“

Heute: Population-Weighting hängt an UI-Checkbox + `CONFIG.POPULATION_PMTILES_URL`, Logik verteilt in:
- `src/services/population-service.js`
- `src/services/route-service.js` (Startpunkt-Generierung)
- `src/visualization/map-renderer.js` (Layer anzeigen)

**Maßnahme**: als klarer Feature-Block kapseln (siehe Restrukturierung), aber URL-Key beibehalten.

## Restrukturierung (inkrementell, ohne Bundler)

### Phase 0 – Hygiene (kleine Schritte, wenig Risiko)

- **`src/core/compat.js` entfernen** (oder bewusst reaktivieren).
- **Benennungen/Kommentare aktualisieren** (z. B. Logo-Name in README, falls relevant).
- **„Globale“ Abhängigkeiten dokumentieren**: Welche Dateien müssen vor welchen geladen werden (Script-Reihenfolge).

### Phase 1 – Feature-orientierte Ordner (ohne Import/Export)

Ziel: Code so gruppieren, dass man ihn später modularisieren/bundlen kann, ohne funktional etwas zu ändern.

Vorschlag:

- `src/features/isochrones/`
  - isochrone-service + renderer + overlap
- `src/features/routing/` (**bleibt**)
  - `route-service.js`, `route-handler.js`, `route-renderer.js`, `route-warning.js`
- `src/features/population/` (**URL-Key bleibt**)
  - `population-service.js` + Layer-Integration (oder ein dünner Adapter)
- `src/features/pois/`
  - overpass-service + poi-renderer
- `src/shared/`
  - `core/` (config/state/events/utils), `domain/` (geo/distribution/api helpers)

Wichtig: Bei Script-Projekten ist die **Lade-Reihenfolge** kritisch. Daher diese Phase nur als „Ordner verschieben + Script-Pfade in `index.html` anpassen“.

### Phase 2 – Entkopplung der Zuständigkeiten (innerhalb bestehender Globals)

- **Startpunkt-Generierung** aus `RouteService.calculateRoutes` herausziehen:
  - `RouteStartsFactory` (z. B. `src/features/routing/starts-factory.js`)
  - bekommt `target`, `N`, `RADIUS`, `distributionType`, `populationEnabled`, `POPULATION_PMTILES_URL`
- **Map-Layer**:
  - Population-Layer Setup in eine eigene Datei (Adapter), `MapRenderer` ruft nur `PopulationLayer.enable/disable`.

### Phase 3 – Optional: ES Modules + Bundling (größter Hebel)

Wenn du weitergehen willst:

- Umstieg auf `type="module"` und `import/export` (statt Globals)
- Bundler (z. B. Vite) + `package.json`
- Vorteile:
  - Dead-code elimination, klarere Abhängigkeiten, Tests einfacher
  - Externe Libs versioniert via npm statt CDN
- Achtung: Das ist eine eigene Migration, aber durch Phase 1/2 deutlich leichter.

## Checkliste „Kann weg?“ (praktisch)

Für jede Datei:
- Wird sie in `index.html` geladen?
- Wird sie irgendwo referenziert (Name im Global-Scope)?
- Hat sie Seiteneffekte (registriert Events, erweitert `State`, etc.)?

Erst wenn **alle drei** sicher „nein“ sind: Kandidat für Löschung.

## Testplan (manuell, nach jedem Schritt)

- App startet ohne Console-Errors.
- Isochrone: Klick auf Karte → Isochrone erscheint, Buckets/Profil/Limit funktionieren.
- Saved-Isochrones: speichern, Sichtbarkeit togglen, bearbeiten, exportieren.
- Overpass: Rechtsklick-Menü, POI-Suche zeigt Marker.
- Routing (**muss bleiben**): Route-Berechnung + Anzeige + Update/Drag (falls vorhanden) + Histogramm.
- Population (**muss bleiben**): Checkbox/Layer/gewichtete Startpunkte funktionieren, wenn `POPULATION_PMTILES_URL` gesetzt ist.

