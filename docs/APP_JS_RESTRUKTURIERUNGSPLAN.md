# APP.js Restrukturierungsplan

Dieses Dokument ist der aktive Plan zur schrittweisen Entkopplung von `src/app.js`.

## Ziel

`src/app.js` soll als Orchestrator erhalten bleiben (Init + Composition), waehrend Domänenlogik in fokussierte Module wandert.

## Bestehende Doku einordnen

- `docs/AUFRAEUMPLAN.md`: weiterhin aktive Referenz fuer Test- und Risiko-Checklisten.
- `docs/SCRIPT_LADEREIHENFOLGE.md`: weiterhin aktiv fuer Lade-/Abhaengigkeitsreihenfolge; bei Bedarf inhaltlich aktualisieren.
- `docs/PHASE1_VORBEREITUNG_MOVE_MAP.md`: historischer Kontext der fruehen Umstrukturierung, teilweise veraltet.

Die alten Dokumente bleiben erhalten (kein Loeschen), werden aber als historisch/ergänzend betrachtet.

## Umsetzungsphasen

### Phase A - Utilities

- Generische Helper auslagern:
  - `_mapWithConcurrency` -> `src/utils/async-helpers.js`

### Phase B - Isochrone-Parameter

- Parameter-Methoden auslagern:
  - `_getIsochroneParamsFromUI`
  - `_getIsochroneBucketSizeMin`
  - `_syncIsochroneTimeToBucketSize`
- Ziel: `src/features/isochrones/isochrone-params.js`

### Phase C - UI-Setup-Handler

- Reines Event Binding auslagern:
  - `_setupProfileButtons`
  - `_setupHistogramModeButtons`
  - `_setupAggregationToggle`
  - `_setupAggregationMethod`
  - `_setupRouteCountInput`
  - `_setupRadiusInput`
  - `_setupHideStartPoints`
  - `_setupHideTargetPoints`
- Ziel: `src/ui/config-setup-handlers.js`

### Phase D - Saved-Isochrone-Controller

- Gespeicherte Isochrone-Methoden auslagern:
  - `_appendSavedIsochroneRender`
  - `_replaceSavedIsochroneRenderAtIndex`
  - `_removeSavedIsochroneRenderAtIndex`
  - `_toggleSavedIsochroneVisibilityInPlace`
  - `_updateSavedIsochroneColorInPlace`
  - `_redrawAllSavedIsochrones`
  - `_clearSavedIsochroneRenderState`
  - `applyIsochroneSelectionHighlight`
  - `_onEditSavedIsochroneConfig`
  - `_onSavedIsochroneStartPointDragged`
- Ziel: `src/features/isochrones/saved-isochrone-controller.js`

### Phase E - Overlap/Optimization-Controller

- Overlap-/Worker-/Optimization-Methoden auslagern:
  - `_initOverlapComputeWorker`
  - `_runOverlapWorkerTask`
  - `_recomputeSavedOverlapIfNeeded`
  - `_scheduleOverlapRecompute`
  - `_renderOptimizationAdvancedControls`
  - `_extendIsochroneBucketsForOverlap`
  - `_enforceOverlapBudgets`
  - plus Budget-/Cache-Methoden
- Ziel: `src/features/isochrones/overlap-controller.js`

## Sicherheitsregeln

- Pro Schritt nur eine Modulgruppe umbauen.
- Keine Verhaltensaenderungen, nur Move + Adapter.
- Nach jedem Schritt manuell pruefen:
  - Isochrone (single + remember mode)
  - Saved-Isochronen (edit/color/visibility)
  - Overlap/System-Optimal
  - Transit-Profil inkl. Fehlermeldungen

