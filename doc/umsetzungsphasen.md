# Refactoring: Umsetzungsphasen

Dieses Dokument ordnet die Maßnahmen aus [refactoring-empfehlungen.md](refactoring-empfehlungen.md) in **Umsetzungsphasen**. Begonnen wird mit **sehr sinnvoll und einfach** umsetzbaren Aufgaben; danach folgen mittlerer Aufwand und größere Refaktorierungen.

**Grundlage:** [doc/refactoring-empfehlungen.md](refactoring-empfehlungen.md)  
**Verknüpfung:** [docs/OPEN_TODOS.md](../docs/OPEN_TODOS.md), [docs/TRANSITOUS_PROXY_TODOS.md](../docs/TRANSITOUS_PROXY_TODOS.md)

---

## Phase 1: Sehr sinnvoll und einfach

Kleine, risikoarme Änderungen mit klarem Nutzen. Kein großer Refactor, meist eine Datei oder wenige Zeilen.

### 1.1 Fehlerbehandlung (Robustheit)

| # | Aufgabe | Datei(en) | Kurzbeschreibung |
|---|---------|-----------|------------------|
| 1.1.1 | Geschluckte Rejections loggen | [src/app.js](../src/app.js), [src/features/isochrones/saved-isochrone-controller.js](../src/features/isochrones/saved-isochrone-controller.js), [src/features/isochrones/overlap-controller.js](../src/features/isochrones/overlap-controller.js) | `_recomputeSavedOverlapIfNeeded().catch(() => {})` ersetzen durch `.catch(e => console.warn('Overlap recompute failed', e))` (oder zentrale Logging-Funktion). |

### 1.2 Toter Code entfernen

| # | Aufgabe | Datei(en) | Kurzbeschreibung |
|---|---------|-----------|------------------|
| 1.2.1 | Auskommentierte Parameterblöcke | [src/services/aggregation-service.js](../src/services/aggregation-service.js) (ca. Zeilen 79–88) | Zwei große auskommentierte Blöcke („sehr präzise“ / „weniger präzise“) entfernen oder in ein kurzes Design-Dokument (z.B. unter `doc/`) auslagern. |
| 1.2.2 | Auskommentierte URLs | [src/core/config.js](../src/core/config.js) | Auskommentierte alternative URLs entweder entfernen oder in einem lokalen Config-Dokument beschreiben. |

### 1.3 Zentrale Konstanten (Modularität)

| # | Aufgabe | Datei(en) | Kurzbeschreibung |
|---|---------|-----------|------------------|
| 1.3.1 | Default-Farbe `#3388ff` | [src/core/config.js](../src/core/config.js) + alle Vorkommen | Eine Konstante (z.B. `DEFAULT_ISOCHRONE_COLOR` oder in CONFIG) einführen und in map-renderer, index.html, app.js, overlap-renderer, saved-isochrones-list, saved-isochrone-controller, overlap-controller, isochrone-renderer, visualization referenzieren. |

### 1.4 DOM-Caching (Performance)

| # | Aufgabe | Datei(en) | Kurzbeschreibung |
|---|---------|-----------|------------------|
| 1.4.1 | Route-Service | [src/features/routing/route-service.js](../src/features/routing/route-service.js) | `getElementById('config-population-weight-starts')` und `querySelector('.dist-btn.active')` einmal cachen (Modul-Variable oder beim ersten Aufruf). |
| 1.4.2 | Histogram-Renderer | [src/visualization/histogram-renderer.js](../src/visualization/histogram-renderer.js) | Selektoren in `updateDistanceHistogram` (#distance-histogram, .histogram-mode-btn.active, .dist-btn.active, #config-population-weight-starts) cachen. |
| 1.4.3 | Isochrone-Params | [src/features/isochrones/isochrone-params.js](../src/features/isochrones/isochrone-params.js) | In `getFromUI()` getElementById für Bucket-Size und Time einmal holen und wiederverwenden. |
| 1.4.4 | Map-Renderer Legende | [src/visualization/map-renderer.js](../src/visualization/map-renderer.js) | In `_setPopulationLegendVisible` getElementById('population-legend-wrapper') und getElementById('population-legend') cachen. |

---

## Phase 2: Sinnvoll, mittlerer Aufwand

Klare Grenzen, überschaubares Risiko. Mehrere Dateien oder etwas strukturelle Änderung.

### 2.1 Konstanten und Konfiguration

| # | Aufgabe | Datei(en) | Kurzbeschreibung |
|---|---------|-----------|------------------|
| 2.1.1 | Profile- und Sichtbarkeits-Strings | config oder shared/domain | Konstanten für `'foot'`, `'transit'` sowie `'visibility'`, `'visible'`, `'none'` einführen und im Code nutzen. |
| 2.1.2 | CONFIG-Key-Konstanten | [src/core/config.js](../src/core/config.js) | Optionale Key-Konstanten (z.B. CONFIG_KEYS.PROFILE, CONFIG_KEYS.ISOCHRONE_TIME_LIMIT) definieren und an zentralen Call-Sites nutzen. |

### 2.2 Dopplungen reduzieren

| # | Aufgabe | Datei(en) | Kurzbeschreibung |
|---|---------|-----------|------------------|
| 2.2.1 | Gemeinsame Hilfsfunktion getStyleForBucket / „nur Farbe geändert“ | [src/app.js](../src/app.js), [src/features/isochrones/saved-isochrone-controller.js](../src/features/isochrones/saved-isochrone-controller.js) | Eine gemeinsame Hilfsfunktion (z.B. in shared oder im Isochrone-Feature) einführen und an beiden Stellen verwenden. |

### 2.3 Entkopplung (Modularität)

| # | Aufgabe | Datei(en) | Kurzbeschreibung |
|---|---------|-----------|------------------|
| 2.3.1 | window._*-Brücke ersetzen | [src/visualization/map-renderer.js](../src/visualization/map-renderer.js), [src/ui/map-layer-controls.js](../src/ui/map-layer-controls.js) | `_setOverlayVisibility`, `_applyMapLayerState`, `_applyTerrainFromCheckbox`, `_ensureBasemapOverlayLayers` nicht mehr über window; stattdessen kleine gemeinsame API (Objekt von MapRenderer an MapLayerControls) oder Event-Bus. |

### 2.4 Robustheit

| # | Aufgabe | Datei(en) | Kurzbeschreibung |
|---|---------|-----------|------------------|
| 2.4.1 | Async Event-Handler absichern | [src/ui/config-setup-handlers.js](../src/ui/config-setup-handlers.js) | In async Click-/Change-Handlern try/catch oder .catch() auf interne Promises, damit Rejections nicht unhandled sind. |
| 2.4.2 | Optionale API-Validierung | [src/shared/domain/api.js](../src/shared/domain/api.js) | Für fetchRoute und Isochrone optional Shape-Check oder Guards vor Rückgabe (z.B. paths, GeoJSON-Features). |
| 2.4.3 | Silent catch in map-renderer | [src/visualization/map-renderer.js](../src/visualization/map-renderer.js) | Wo sinnvoll: catch (_) {} durch Logging oder Propagierung ersetzen. |

### 2.5 Event-Listener (Robustheit / Speicher)

| # | Aufgabe | Datei(en) | Kurzbeschreibung |
|---|---------|-----------|------------------|
| 2.5.1 | Listener-Cleanup Overlap-Controller | [src/features/isochrones/overlap-controller.js](../src/features/isochrones/overlap-controller.js) | In `_renderOptimizationAdvancedControls`: vor erneutem Anhängen alte Listener entfernen oder Container ersetzen und Listener nur einmal setzen. |
| 2.5.2 | Listener-Cleanup Saved-Isochronen-Modal | [src/ui/saved-isochrones-list.js](../src/ui/saved-isochrones-list.js) | Modal: entweder gleiche DOM-Node wiederverwenden und Listener nur einmal setzen, oder beim Schließen removeEventListener für alle gesetzten Handler. |

### 2.6 Performance (optional)

| # | Aufgabe | Datei(en) | Kurzbeschreibung |
|---|---------|-----------|------------------|
| 2.6.1 | Debounce input (Overlap) | [src/features/isochrones/overlap-controller.js](../src/features/isochrones/overlap-controller.js) | Falls nötig: Debounce auf input-Event der Slider/Range ergänzen. |
| 2.6.2 | Histogram rAF-Batching | [src/visualization/histogram-renderer.js](../src/visualization/histogram-renderer.js) | Bei sehr häufigen Aufrufen: updateDistanceHistogram in requestAnimationFrame batching einbinden. |

---

## Phase 3: Größere Refaktorierung

Mehrere Dateien, Abhängigkeiten, höherer Planungsaufwand. Sinnvoll nach Abschluss von Phase 1 und Teilen von Phase 2.

### 3.1 Große Dateien aufteilen

| # | Aufgabe | Datei(en) | Kurzbeschreibung |
|---|---------|-----------|------------------|
| 3.1.1 | app.js entlasten | [src/app.js](../src/app.js) | Isochrone-Start/Saved-Logik, Route-Handling, Config/UI-Sync, Histogramm/Legende, Export auslagern. SavedIsochroneController vollständig nutzen (siehe OPEN_TODOS). |
| 3.1.2 | map-renderer.js aufteilen | [src/visualization/map-renderer.js](../src/visualization/map-renderer.js) | Aufteilung in: Basemap/Overlay-Setup, Population-Layer, Kontextmenü/Geocoder-UI. |
| 3.1.3 | visualization.js trennen | [src/visualization/visualization.js](../src/visualization/visualization.js) | Zeichenlogik (Drawing) vs. Legende/Colormap und Routen-Helfer. |
| 3.1.4 | style.css nach Bereichen | [style.css](../style.css) | Nach Feature/Bereich splitten (Map, Panel, Modals, Targets, Isochronen …), in index.html mehrere CSS-Dateien einbinden. |

### 3.2 Konfiguration und Umgebung

| # | Aufgabe | Datei(en) | Kurzbeschreibung |
|---|---------|-----------|------------------|
| 3.2.1 | Config-Split | [src/core/](../src/core/) | config.defaults.js + optional config.local.js (siehe OPEN_TODOS); index.html lädt beide und merged. |
| 3.2.2 | URLs zentralisieren | CONFIG / config.defaults.js | Hardcodierte URLs (map-renderer Basemaps/Overlays, map-layer-controls Thumb-Base, api.js Transitous, overlap-worker Turf/h3, overpass-service, geocoder Photon) in CONFIG oder config.defaults.js; ggf. env-basiert. |
| 3.2.3 | Magic Numbers auslagern | diverse | Wichtige Werte (Zeiten, Radien, Schwellen, Canvas-Maße) in map-renderer, api.js, overlap-renderer, isochrone-service, app.js, overpass-service, geo.js, aggregation-service, histogram-renderer als benannte Konstanten (Dateianfang oder config/domain). |

### 3.3 Architektur (optional)

| # | Aufgabe | Datei(en) | Kurzbeschreibung |
|---|---------|-----------|------------------|
| 3.3.1 | Abhängigkeiten explizit | app.js, visualization.js, config-setup-handlers, saved-isochrone-controller, overlap-controller, route-service | Abhängigkeiten über Konstruktor-Parameter oder klare Public API statt vieler Globals; Script-Reihenfolge nicht als einzige Dokumentation. |
| 3.3.2 | Document-Listener dokumentieren | README / Architektur-Doc | Festhalten: Bei künftigem Teardown von Komponenten ist removeEventListener für document-Listener nötig (map-renderer, map-layer-controls, saved-isochrones-list, colormap-selector, geocoder, route-warning). |
| 3.3.3 | Resize-Throttle (falls hinzugefügt) | – | Falls später resize-Listener dazu kommen: Throttle (z.B. 100–150 ms) einplanen. |

---

## Übersicht: Reihenfolge empfohlen

1. **Phase 1** vollständig: schneller Gewinn, wenig Risiko.
2. **Phase 2** nach Priorität: 2.1–2.2 (Konstanten, Dopplungen), dann 2.3–2.5 (Entkopplung, Robustheit, Listener), 2.6 bei Bedarf.
3. **Phase 3** in Ruhe planen: z.B. zuerst 3.1.1 (app.js) und 3.2.1 (Config-Split), dann restliche Aufteilungen und URL-/Konstanten-Zentralisierung.

*Quelle der Einzelmaßnahmen: [doc/refactoring-empfehlungen.md](refactoring-empfehlungen.md).*
