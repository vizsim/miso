# Miso – Isochronen

Web-Anwendung zur Berechnung und Darstellung von **Isochronen** (Erreichbarkeitsflächen) auf einer Karte. Nutzt GraphHopper (Straßenprofile), Transitous one-to-all (ÖPNV, approximiert) und OpenStreetMap (Overpass) für POI-Suchen.

## Features

- **Isochronen berechnen**: Klick auf die Karte setzt einen Startpunkt und berechnet die Erreichbarkeit (Fuß, Fahrrad, Auto, ÖPNV) in konfigurierbaren Zeitstufen.
- **Bucket-Größe & Zeitlimit**: Zeitintervalle z. B. 5 Min – Zeitlimit nur in diesen Schritten (5, 10, 15 … Min). Bucket-Größen: 5, 10 oder 20 Minuten.
- **Startpunkte merken**: Mehrere Isochronen speichern, einzeln ein-/ausblenden, bearbeiten, verschieben.
- **Farbe pro Startpunkt**: Jeder gespeicherte Startpunkt kann eine eigene Hauptfarbe haben (z. B. Blau, Rot, Grün); Darstellung innen kräftig, nach außen abnehmend.
- **Überlappungsflächen**: Optional Anzeige der Flächen, die von allen sichtbaren Startpunkten innerhalb derselben Zeit erreichbar sind.
- **POI-Suche (Overpass)**: Rechtsklick auf die Karte → Cafés, Restaurants oder Bars/Kneipen im Umkreis suchen und als Marker anzeigen.
- **Hover & Klick-Lock**: Startpunkte auf der Karte und in der Liste beim Hover hervorheben; Klick „lockt“ einen Punkt (bleibt hervorgehoben bis Klick woanders).
- **Button „Isochronen berechnen“**: Neuberechnung mit aktuellem Startpunkt und Einstellungen; während der Berechnung Anzeige „Berechne…“ (Button deaktiviert).
- **Export**: Einzelne oder alle gespeicherten Isochronen als GeoJSON inkl. Metadaten exportieren.
- **Adresssuche**: Geocoder zum Springen zu einer Adresse und sofortigen Isochrone um den gefundenen Punkt.

## Verwendung

1. **Startpunkt setzen**: Einmal in die Karte klicken → Isochrone wird um den Klickpunkt berechnet (Standard: 10 Min, 5‑Minuten‑Buckets; Profil gemäß CONFIG, z. B. „bike“).
2. **Einstellungen** (linkes Panel):
   - **Bucket-Größe (Min.)**: 5, 10 oder 20 – legt die Zeitstufen und die Schrittweite für das Zeitlimit fest.
   - **Zeitlimit (Min.)**: Nur Vielfache der Bucket-Größe (z. B. bei 5 Min: 5, 10, 15, …).
   - **Profil**: Fuß, Fahrrad, Auto oder ÖPNV (Transitous/Motis).
   - **Startpunkte merken**: An → weitere Klicks/Kalkulationen werden als zusätzliche Isochronen gespeichert (Liste mit S1, S2, …).
3. **Gespeicherte Startpunkte**: In der Liste pro Eintrag: Auge (Sichtbarkeit), Stift (Bearbeiten: Zeitlimit, Bucket-Größe, Profil, **Farbe**), Löschen. Klick auf Zeile oder auf den Punkt auf der Karte hebt ihn hervor (Lock).
4. **Rechtsklick-Menü** auf der Karte:
   - **Isochrone hier berechnen**: Setzt Startpunkt an die Klickposition und startet die Berechnung.
   - **OSM Objektabfrage**: Link zu Overpass Turbo o. Ä.
   - **Cafés / Restaurants / Bars-Kneipen hier suchen**: Sucht im Umkreis (600 m) und zeigt Treffer als Marker.
5. **Export**: Button „Export“ lädt die aktuelle bzw. alle gespeicherten Isochronen als GeoJSON herunter.

## Lokaler Start mit Transitous-Proxy

Für das ÖPNV-Profil ist lokal ein Proxy nötig (Browser-CORS). Dafür liegt ein minimaler Dev-Server im Repo:

```bash
node dev-server.mjs
```

Dann im Browser öffnen:

- `http://localhost:3000`

Der Server liefert statische Dateien aus dem Projekt aus und proxyt:

- `/transitous/*` -> `https://api.transitous.org/*`
- `/api/*` -> `https://api.transitous.org/*` (Fallback, falls im Frontend bereits `/api/...` verwendet wird)

Hinweis:

- Für ÖPNV sollte `TRANSITOUS_ONE_TO_ALL_URL` auf `/transitous/api/v1/one-to-all` stehen.

## Projektstruktur

```
miso/
├── index.html              # Einstiegsseite & Kontextmenüs
├── style.css               # Layout & Komponenten
├── README.md
├── LICENSE                 # AGPL-3.0
├── miso_logo.svg           # Logo
│
├── docs/                   # Doku
│   └── OPEN_TODOS.md       # Offene TODOs
│
└── src/
    ├── app.js              # App-Initialisierung, Event-Handler, Isochrone-Logik
    │
   ├── core/
   │   └── config.js       # CONFIG (inkl. POPULATION_PMTILES_URL)
    │
    ├── shared/
    │   ├── core/           # state, events, utils
    │   └── domain/         # api, geo, distribution
    │
   ├── services/           # verbleibende Querschnittsservices
    │   ├── aggregation-service.js
    │   ├── export-service.js
    │   └── target-service.js
    │
   ├── features/
   │   ├── routing/        # route-service, route-renderer, route-handler, route-warning
   │   ├── isochrones/     # isochrone-service, isochrone-renderer, overlap-renderer, overlap-controller,
   │   │                   # saved-isochrone-controller, isochrone-params
   │   ├── population/     # population-service (PMTiles)
   │   └── pois/           # overpass-service, poi-renderer
    │
   ├── visualization/
   │   ├── visualization.js      # Orchestrierung (Startpunkte, Marker, …)
   │   ├── map-renderer.js       # Karte, Kontextmenü, clearLayers
   │   ├── marker-manager.js
   │   ├── colormap-utils.js
   │   └── histogram-renderer.js
    │
   ├── ui/                 # UI-Komponenten (ohne Routing-Warnung)
   │   ├── saved-isochrones-list.js  # Liste „Gespeicherte Startpunkte“, Edit-Modal, Farbwahl
   │   ├── targets-list.js
   │   ├── config-helpers.js
   │   ├── config-setup-handlers.js
   │   ├── distribution-selector.js
   │   └── colormap-selector.js
    │
   └── utils/
      ├── async-helpers.js # Async-Utilities
      └── geocoder.js      # Adresssuche
```

## Technologie-Stack

- **MapLibre GL JS**: Karte, Marker, Polygone, Popups
- **GraphHopper API**: Isochrone-Endpunkt (Fuß/Fahrrad/Auto)
- **Transitous API**: one-to-all Endpunkt für ÖPNV (Approximation via Buffer/Union im Browser)
- **Overpass API**: POI-Abfragen (Cafés, Restaurants, Bars/Kneipen)
- **Turf.js**: Überlappungsflächen (Schnittmengen)
- **Vanilla JavaScript**: Kein Framework, modulare Skripte
- **Event-Bus**: Lose Kopplung (z. B. `ISOCHRONE_CALCULATED`, `ISOCHRONE_CALCULATING`)

## Konfiguration

Wichtige Einträge in `src/core/config.js`:

```javascript
CONFIG = {
  GH_ISOCHRONE_URL: "https://ghroute.vizsim.de/isochrone",  // GraphHopper Isochrone-API
  TRANSITOUS_ONE_TO_ALL_URL: "/transitous/api/v1/one-to-all", // ÖPNV one-to-all (Proxy empfohlen)
  TRANSIT_PROFILE_ENABLED: true,      // ÖPNV-Profil global an/aus
  TRANSIT_PROFILE_AUTO_DISABLE_ON_GITHUB_PAGES: true, // auf *.github.io automatisch aus
   ISOCHRONE_TIME_LIMIT: 1500,       // Sekunden (wird aus UI abgeleitet)
   ISOCHRONE_BUCKET_SIZE_MIN: 5,     // 5, 10 oder 20 Minuten
   PROFILE: "bike",                  // "foot" | "bike" | "car" | "transit"
  REMEMBER_ISOCHRONE_STARTS: false, // Startpunkte merken
  OPTIMIZATION_MODE: "none",       // "none" | "overlap" | "system_optimal"
  OVERPASS_SERVERS: [ "https://overpass-api.de/api/", ... ], // Fallback-Liste
  MAP_CENTER: [52.6858, 14.10078],
  MAP_ZOOM: 13,
  // …
};
```


## Lizenz

Dieses Projekt steht unter der GNU Affero General Public License v3.0 (AGPL-3.0). Siehe [LICENSE](LICENSE).

