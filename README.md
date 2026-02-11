# Miso – Isochronen

Web-Anwendung zur Berechnung und Darstellung von **Isochronen** (Erreichbarkeitsflächen) auf einer Karte. Nutzt die GraphHopper Isochrone-API und OpenStreetMap (Overpass) für POI-Suchen.

## Features

- **Isochronen berechnen**: Klick auf die Karte setzt einen Startpunkt und berechnet die Erreichbarkeit (Fuß, Fahrrad, Auto) in konfigurierbaren Zeitstufen.
- **Bucket-Größe & Zeitlimit**: Zeitintervalle z. B. 5 Min – Zeitlimit nur in diesen Schritten (5, 10, 15 … Min). Bucket-Größen: 1, 2, 3, 5 oder 10 Minuten.
- **Startpunkte merken**: Mehrere Isochronen speichern, einzeln ein-/ausblenden, bearbeiten, verschieben.
- **Farbe pro Startpunkt**: Jeder gespeicherte Startpunkt kann eine eigene Hauptfarbe haben (z. B. Blau, Rot, Grün); Darstellung innen kräftig, nach außen abnehmend.
- **Überlappungsflächen**: Optional Anzeige der Flächen, die von allen sichtbaren Startpunkten innerhalb derselben Zeit erreichbar sind.
- **POI-Suche (Overpass)**: Rechtsklick auf die Karte → Cafés, Restaurants oder Bars/Kneipen im Umkreis suchen und als Marker anzeigen.
- **Hover & Klick-Lock**: Startpunkte auf der Karte und in der Liste beim Hover hervorheben; Klick „lockt“ einen Punkt (bleibt hervorgehoben bis Klick woanders).
- **Button „Isochronen berechnen“**: Neuberechnung mit aktuellem Startpunkt und Einstellungen; während der Berechnung Anzeige „Berechne…“ (Button deaktiviert).
- **Export**: Einzelne oder alle gespeicherten Isochronen als GeoJSON inkl. Metadaten exportieren.
- **Adresssuche**: Geocoder zum Springen zu einer Adresse und sofortigen Isochrone um den gefundenen Punkt.

## Verwendung

1. **Startpunkt setzen**: Einmal in die Karte klicken → Isochrone wird um den Klickpunkt berechnet (Standard: 10 Min, 5-Minuten-Buckets, Profil „Fuß“).
2. **Einstellungen** (linkes Panel):
   - **Bucket-Größe (Min.)**: 1, 2, 3, 5 oder 10 – legt die Zeitstufen und die Schrittweite für das Zeitlimit fest.
   - **Zeitlimit (Min.)**: Nur Vielfache der Bucket-Größe (z. B. bei 5 Min: 5, 10, 15, …).
   - **Profil**: Fuß, Fahrrad oder Auto.
   - **Startpunkte merken**: An → weitere Klicks/Kalkulationen werden als zusätzliche Isochronen gespeichert (Liste mit S1, S2, …).
3. **Gespeicherte Startpunkte**: In der Liste pro Eintrag: Auge (Sichtbarkeit), Stift (Bearbeiten: Zeitlimit, Bucket-Größe, Profil, **Farbe**), Löschen. Klick auf Zeile oder auf den Punkt auf der Karte hebt ihn hervor (Lock).
4. **Rechtsklick-Menü** auf der Karte:
   - **Isochrone hier berechnen**: Setzt Startpunkt an die Klickposition und startet die Berechnung.
   - **OSM Objektabfrage**: Link zu Overpass Turbo o. Ä.
   - **Cafés / Restaurants / Bars-Kneipen hier suchen**: Sucht im Umkreis (600 m) und zeigt Treffer als Marker.
5. **Export**: Button „Export“ lädt die aktuelle bzw. alle gespeicherten Isochronen als GeoJSON herunter.

## Projektstruktur

```
miso/
├── index.html              # Einstiegsseite & Kontextmenüs
├── style.css               # Layout & Komponenten
├── README.md
├── LICENSE                 # MIT
├── bulk_router_logo.svg    # Logo
│
├── docs/                   # Zusätzliche Doku (teils aus Vorprojekt)
│   └── ...
│
└── src/
    ├── app.js              # App-Initialisierung, Event-Handler, Isochrone-Logik
    │
    ├── core/
    │   ├── config.js       # CONFIG (API-URLs, Isochrone-Defaults, …)
    │   ├── state.js        # Globaler State (Karte, Isochronen, Marker, …)
    │   ├── events.js       # Event-Bus
    │   ├── utils.js        # Hilfsfunktionen
    │   └── compat.js       # Kompatibilität
    │
    ├── services/
    │   ├── isochrone-service.js   # Aufruf GraphHopper Isochrone-API
    │   ├── overpass-service.js    # Overpass: Cafés, Restaurants, Bars
    │   ├── export-service.js     # GeoJSON-Export
    │   ├── route-service.js      # (Legacy/Vorprojekt)
    │   ├── target-service.js
    │   ├── aggregation-service.js
    │   └── population-service.js
    │
    ├── domain/
    │   ├── api.js          # fetchIsochrone, fetchRoute, …
    │   ├── geo.js
    │   └── distribution.js
    │
    ├── visualization/
    │   ├── visualization.js      # Orchestrierung (Startpunkte, Marker, …)
    │   ├── map-renderer.js       # Karte, Kontextmenü, POI-Suche, clearLayers
    │   ├── isochrone-renderer.js # Isochrone-Polygone (Farbe, Buckets)
    │   ├── overlap-renderer.js   # Überlappungsflächen (Turf.js)
    │   ├── poi-renderer.js       # Cafés, Restaurants, Bars (Marker)
    │   ├── marker-manager.js
    │   ├── route-renderer.js
    │   ├── colormap-utils.js
    │   └── histogram-renderer.js
    │
    ├── ui/
    │   ├── saved-isochrones-list.js  # Liste „Gespeicherte Startpunkte“, Edit-Modal, Farbwahl
    │   ├── targets-list.js
    │   ├── config-helpers.js
    │   ├── distribution-selector.js
    │   ├── colormap-selector.js
    │   └── route-warning.js
    │
    ├── handlers/
    │   └── route-handler.js
    │
    └── utils/
        └── geocoder.js     # Adresssuche
```

## Technologie-Stack

- **Leaflet.js**: Karte, Marker, Polygone, Popups
- **GraphHopper API**: Isochrone-Endpunkt (Zeit-Erreichbarkeit)
- **Overpass API**: POI-Abfragen (Cafés, Restaurants, Bars/Kneipen)
- **Turf.js**: Überlappungsflächen (Schnittmengen)
- **Vanilla JavaScript**: Kein Framework, modulare Skripte
- **Event-Bus**: Lose Kopplung (z. B. `ISOCHRONE_CALCULATED`, `ISOCHRONE_CALCULATING`)

## Konfiguration

Wichtige Einträge in `src/core/config.js`:

```javascript
CONFIG = {
  GH_ISOCHRONE_URL: "https://ghroute.vizsim.de/isochrone",  // GraphHopper Isochrone-API
  ISOCHRONE_TIME_LIMIT: 600,        // Sekunden (wird aus UI abgeleitet)
  ISOCHRONE_BUCKET_SIZE_MIN: 5,     // 1, 2, 3, 5 oder 10 Minuten
  PROFILE: "foot",                  // "foot" | "bike" | "car"
  REMEMBER_ISOCHRONE_STARTS: false, // Startpunkte merken
  OPTIMIZATION_MODE: "none",       // "none" | "overlap" | "system_optimal"
  OVERPASS_SERVERS: [ "https://overpass-api.de/api/", ... ], // Fallback-Liste
  MAP_CENTER: [52.6858, 14.10078],
  MAP_ZOOM: 13,
  // …
};
```


## Lizenz

