# Refactoring-Empfehlungen: Modularität, Performance, Robustheit

Dieses Dokument bündelt die Ergebnisse einer durchgängigen Codebase-Analyse des miso-Repos. Es enthält **keine Code-Änderungen**, sondern beschreibt umsetzbare Maßnahmen in drei Bereichen.

**Verknüpfung mit bestehenden Docs:**

- [docs/OPEN_TODOS.md](../docs/OPEN_TODOS.md) – Offene Punkte zu App.js-Refaktor, Config-Split, CDN-Pinning, Population-Kapselung
- [docs/TRANSITOUS_PROXY_TODOS.md](../docs/TRANSITOUS_PROXY_TODOS.md) – Schritte für den Transitous-Proxy

Überschneidungen mit den OPEN_TODOS werden hier nur kurz referenziert; Details stehen in den genannten Dateien. Alle Empfehlungen sind **ohne ES-Modules/Bundler** umsetzbar, sofern nicht ausdrücklich „Phase 3“ (z.B. Vite) genannt wird.

---

## 1. Modularität

### 1.1 Große Dateien aufteilen

| Datei | Größe | Empfehlung |
|-------|--------|------------|
| [src/app.js](../src/app.js) | ~1455 Zeilen | Orchestrierung beibehalten; auslagern: Isochrone-Start- und Saved-Logik, Route-Handling, Config/UI-Sync, Histogramm/Legende, Export. Siehe auch OPEN_TODOS „SavedIsochroneController“ – Methoden wie `_appendSavedIsochroneRender`, `_replaceSavedIsochroneRenderAtIndex`, `_onEditSavedIsochroneConfig` etc. in den Controller verschieben. |
| [src/visualization/map-renderer.js](../src/visualization/map-renderer.js) | ~966 Zeilen | Aufteilen in: (1) Basemap/Overlay-Setup, (2) Population-Layer, (3) Kontextmenü und Geocoder-UI. So werden Verantwortlichkeiten klarer und Änderungen lokaler. |
| [style.css](../style.css) | ~1872 Zeilen | Nach Feature/Bereich splitten: z.B. Map, Panel, Modals, Targets, Isochronen. Mehrere CSS-Dateien in `index.html` einbinden; Reihenfolge beibehalten, um Spezifität konsistent zu halten. |
| [src/visualization/visualization.js](../src/visualization/visualization.js) | groß | Trennung: Zeichenlogik (Drawing) vs. Legende/Colormap und Routen-Helfer. Erleichtert Tests und spätere Wiederverwendung. |

### 1.2 Entkopplung über Globals

- **window._\*-Brücke:** Zwischen [src/visualization/map-renderer.js](../src/visualization/map-renderer.js) und [src/ui/map-layer-controls.js](../src/ui/map-layer-controls.js) werden `_setOverlayVisibility`, `_applyMapLayerState`, `_applyTerrainFromCheckbox`, `_ensureBasemapOverlayLayers` über `window` angebunden. **Empfehlung:** Ersetzen durch eine kleine gemeinsame API (z.B. Objekt, das MapRenderer an MapLayerControls übergibt) oder konsequente Nutzung des Event-Bus – verbessert Testbarkeit und macht Abhängigkeiten explizit.

- **Hohe Kopplung:** In `app.js`, `visualization.js`, `config-setup-handlers.js`, `saved-isochrone-controller.js`, `overlap-controller.js`, `route-service.js` werden viele Globals (State, CONFIG, EventBus, MapRenderer, …) genutzt. **Empfehlung:** Abhängigkeiten explizit machen (z.B. Konstruktor-Parameter, klare „Public API“ pro Modul), damit die Script-Reihenfolge in `index.html` nicht die einzige Dokumentation der Abhängigkeiten ist.

### 1.3 Dopplungen reduzieren

- **Farbe `#3388ff`:** Kommt an vielen Stellen vor (map-renderer, index.html, app.js, overlap-renderer, saved-isochrones-list, saved-isochrone-controller, overlap-controller, isochrone-renderer, visualization). **Empfehlung:** Eine zentrale Konstante, z.B. in [src/core/config.js](../src/core/config.js) oder in einem shared/domain-Modul (z.B. „default isochrone/catchment color“), und überall referenzieren.

- **Profile- und Sichtbarkeits-Strings:** `'foot'`, `'transit'` sowie `'visibility'`, `'visible'`, `'none'` sind mehrfach als Literale im Code. **Empfehlung:** Konstanten einführen (z.B. in config oder domain), um Tippfehler zu vermeiden und Änderungen zentral zu halten.

- **Gemeinsame Logik „nur Farbe geändert“ / getStyleForBucket:** Zwischen [src/app.js](../src/app.js) und [src/features/isochrones/saved-isochrone-controller.js](../src/features/isochrones/saved-isochrone-controller.js) existiert nahezu gleiche Logik. **Empfehlung:** Eine gemeinsame Hilfsfunktion (z.B. in shared oder im Isochrone-Feature) einführen und an beiden Stellen nutzen.

### 1.4 Toter Code

- **[src/core/config.js](../src/core/config.js):** Auskommentierte alternative URLs (z.B. GH_ROUTE_URL, GH_ISOCHRONE_URL, TRANSITOUS_ONE_TO_ALL_URL). **Empfehlung:** Entweder env-basiert oder in einem lokalen Config-Dokument beschreiben – oder entfernen, wenn nicht mehr gebraucht.

- **[src/services/aggregation-service.js](../src/services/aggregation-service.js)** (ca. Zeilen 79–88): Zwei große auskommentierte Parameterblöcke („sehr präzise“ / „weniger präzise“). **Empfehlung:** Entweder löschen oder in ein kurzes Design-Dokument auslagern, damit die Codebasis klar bleibt.

### 1.5 Konfiguration

- CONFIG-Keys werden nur in [src/core/config.js](../src/core/config.js) definiert; an Call-Sites sind die Key-Namen als String-Literale verstreut. **Empfehlung:** Optionale Key-Konstanten (z.B. `CONFIG_KEYS.PROFILE`, `CONFIG_KEYS.ISOCHRONE_TIME_LIMIT`) einführen, um Tippfehler zu reduzieren.

- Siehe OPEN_TODOS: Aufteilung in `config.defaults.js` + optional `config.local.js` bleibt das Ziel für die Konfigurationsstruktur.

---

## 2. Performance

### 2.1 DOM-Zugriffe

Wiederholte `getElementById` / `querySelector` in Hot Paths belasten unnötig. **Empfehlung:** Referenzen einmal besorgen und cachen (beim Init oder beim ersten Zugriff).

| Datei | Stelle | Maßnahme |
|-------|--------|----------|
| [src/features/routing/route-service.js](../src/features/routing/route-service.js) | Bei jeder Routenberechnung | `getElementById('config-population-weight-starts')` und `querySelector('.dist-btn.active')` cachen (z.B. Modul-Variable oder beim ersten Aufruf setzen). |
| [src/visualization/histogram-renderer.js](../src/visualization/histogram-renderer.js) | In `updateDistanceHistogram` | Gleiche Selektoren (z.B. `#distance-histogram`, `.histogram-mode-btn.active`, `.dist-btn.active`, `#config-population-weight-starts`) cachen. |
| [src/features/isochrones/isochrone-params.js](../src/features/isochrones/isochrone-params.js) | In `getFromUI()` | `getElementById` für Bucket-Size und Time einmal ausführen und wiederverwenden. |
| [src/visualization/map-renderer.js](../src/visualization/map-renderer.js) | In `_setPopulationLegendVisible` | `getElementById('population-legend-wrapper')` und `getElementById('population-legend')` cachen. |

### 2.2 Event-Handler

- **[src/features/isochrones/overlap-controller.js](../src/features/isochrones/overlap-controller.js):** Die `input`-Listener auf Slider/Range triggern State-Updates und `_scheduleOverlapRecompute(120)` – die Recompute-Verzögerung ist bereits vorhanden. Falls bei sehr schnellem Bewegen dennoch zu viele Updates anfallen: **optional** Debounce auf dem `input`-Event ergänzen.

- **Resize:** Aktuell kein `resize`-Listener gefunden. Falls später einer hinzukommt: **Throttle** (z.B. 100–150 ms), um teure Layout-Updates zu begrenzen.

### 2.3 Schweres Arbeiten

- **Histogramm:** `updateDistanceHistogram` (Canvas + Verteilungsberechnung) läuft auf dem Main-Thread. Bei sehr häufigen Aufrufen: **requestAnimationFrame**-Batching erwägen, damit nicht in einem Frame mehrfach neu gezeichnet wird.

- **Overlap:** Bereits per Worker umgesetzt; beibehalten.

---

## 3. Robustheit

### 3.1 Fehlerbehandlung

- **Geschluckte Rejections:** In [src/app.js](../src/app.js), [src/features/isochrones/saved-isochrone-controller.js](../src/features/isochrones/saved-isochrone-controller.js) und [src/features/isochrones/overlap-controller.js](../src/features/isochrones/overlap-controller.js) wird `_recomputeSavedOverlapIfNeeded().catch(() => {})` ohne Logging verwendet. **Empfehlung:** Mindestens `console.warn`/`console.error` mit Fehler-Objekt oder eine zentrale Error-Logging-Funktion, damit Fehler in der Konsole sichtbar sind.

- **Silent catch:** In [src/visualization/map-renderer.js](../src/visualization/map-renderer.js) kommen mehrfach `catch (_) {}` (z.B. bei Callbacks) vor. **Empfehlung:** Wo sinnvoll Fehler loggen oder nach oben propagieren, damit Fehlverhalten leichter zu diagnostizieren ist.

- **Async Event-Handler:** In [src/ui/config-setup-handlers.js](../src/ui/config-setup-handlers.js) werden `async` Click-/Change-Handler verwendet. **Empfehlung:** Im Handler **try/catch** oder `.catch()` auf den internen Promises, damit Rejections nicht als unhandled erscheinen.

### 3.2 API- und Datenvalidierung

- **[src/shared/domain/api.js](../src/shared/domain/api.js):** `fetchRoute` und Isochrone-Aufrufe geben `res.json()` zurück, ohne die erwartete Struktur (z.B. `paths`, GeoJSON-Features) zu prüfen. **Empfehlung:** Optionale Validierung (Shape-Check oder Guards) vor der Rückgabe, um bei kaputten oder geänderten APIs klare Fehler zu bekommen statt undefiniertes Verhalten im Aufrufer.

### 3.3 Event-Listener und Speicher

- **Document-Listener:** Mehrere `document.addEventListener('click'/'keydown', ...)` ohne `removeEventListener` (map-renderer, map-layer-controls, saved-isochrones-list, colormap-selector, geocoder, route-warning). Für eine Single-Page-App ohne Teardown in der Regel akzeptabel. **Empfehlung:** In der Architektur/README dokumentieren, dass bei künftigem Teardown von Komponenten Cleanup (removeEventListener) nötig wäre.

- **Listener-Anhäufung:**
  - **[src/features/isochrones/overlap-controller.js](../src/features/isochrones/overlap-controller.js):** `_renderOptimizationAdvancedControls` fügt bei jedem Aufruf neue Listener hinzu, ohne die alten zu entfernen – Risiko doppelter Handler und Speicherwachstum. **Empfehlung:** Vor dem erneuten Anhängen alte Listener entfernen oder den Container ersetzen (z.B. innerHTML/Replace) und Listener nur einmal setzen.
  - **[src/ui/saved-isochrones-list.js](../src/ui/saved-isochrones-list.js):** Beim Öffnen des Modals werden viele Listener registriert. **Empfehlung:** Entweder dieselbe DOM-Node wiederverwenden und Listener nur einmal setzen, oder beim Schließen `removeEventListener` für alle gesetzten Handler aufrufen.

### 3.4 Konstanten und Umgebung

- **Magic Numbers:** In map-renderer, api.js, overlap-renderer, isochrone-service, app.js, overpass-service, geo.js, aggregation-service, histogram-renderer stehen viele numerische Literale (Zeiten, Radien, Schwellen, Canvas-Maße). **Empfehlung:** Wichtige Werte als benannte Konstanten am Dateianfang oder in config/domain auslagern.

- **URLs:** Mehrere hardcodierte URLs außerhalb von CONFIG: Basemaps/Overlays und CORS-Proxy in map-renderer, Thumb-Base in map-layer-controls, Transitous in api.js, Turf/h3 in overlap-worker, Overpass-Server in overpass-service, Photon in geocoder. **Empfehlung:** In CONFIG oder config.defaults.js zentralisieren und ggf. env-basiert machen (siehe OPEN_TODOS zu Config-Split und optional lokalem Config).

---

## 4. Priorisierung (optional)

| Priorität | Typ | Beispiele |
|-----------|-----|-----------|
| **Schnell umsetzbar** | Kein großer Refactor | DOM-Caching (route-service, histogram-renderer, isochrone-params, map-renderer); zentrale Konstante für `#3388ff`; `.catch(e => console.warn(e))` statt `.catch(() => {})`; auskommentierte Blöcke in aggregation-service entfernen oder auslagern. |
| **Mittlerer Aufwand** | Klare Grenzen, wenig Risiko | window._*-Brücke durch kleine API ersetzen; CONFIG-Key-Konstanten; Listener-Cleanup in overlap-controller und saved-isochrones-list; optionale API-Validierung in api.js. |
| **Größere Refaktorierung** | Mehrere Dateien, Abhängigkeiten | app.js und map-renderer.js aufteilen; CSS nach Bereichen splitten; visualization.js trennen; Config-Split (defaults + local) wie in OPEN_TODOS. |

---

*Stand: Ergebnis der Repo-Review; keine Code-Änderungen in dieser Phase. Implementierung in späteren Schritten.*
