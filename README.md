# CNC G-Code Simulator (Haas-style Digital Twin)

## Zielbild
Dieses Update erweitert den Simulator deutlich Richtung **realitätsnahe Frässimulation** mit Haas-orientierter Bedienlogik (Cycle Start / Feed Hold / Single Block), Maschinenhüllraum-Prüfung und Work-Offset-Modell.

> Wichtig: Ein Browser-Prototyp kann eine reale Maschine oder vollwertige CAM-Systeme (z. B. Mastercam + Maschinenmodell) nicht 1:1 ersetzen. Diese Version bringt aber viele zentrale Digital-Twin-Bausteine zusammen.

## Features

### Neu in diesem Stand
- Einstellbare Simulationsauflösung bis **0,01 mm** (mit browserseitiger Sicherheitsbegrenzung der Heightmap-Größe)
- Höhere Interpolationsdichte für Linien/Arcs basierend auf der gewählten Präzision
- **Unreal-Export**: Toolpath und Setup als JSON für den Import in eine Unreal-Engine-Pipeline


### 1) Materialabtrag (Digital Twin Kern)
- 3D-Maschinenviewer (isometrisch) + optionaler 2D-Top-View
- Heightmap-basiertes Rohteilmodell (Stock X/Y/Z)
- Werkzeugdurchmesser-bezogener Materialeingriff
- Live-Volumenabtrag (`Removed`) und Restmaterial (`Stock Left`)
- MRR-Schätzung (`cm³/min`)

### 2) G-Code Engine
- Unterstützt: `G0`, `G1`, `G2`, `G3`, `G17`, `G20`, `G21`, `G90`, `G91`, `G54`, `M3`, `M5`, `M30`
- Arc-Interpolation über `I/J` im XY-Plane
- Absolut/inkrementell + mm/inch

### 3) Haas-orientierte Bedienung
- **Cycle Start**
- **Feed Hold**
- **Single Step**
- **Single Block** (Checkbox)
- Feed Override [%]

### 4) Maschinenmodell
- Konfigurierbarer Maschinenhüllraum (X/Y/Z Max, Z Min)
- Work Offset `G54` (X/Y/Z)
- Anzeige von Werkstück- und Maschinenkoordinaten
- Alarm bei Achsgrenzenverletzung (`TRAVEL LIMIT`)

## Industrietauglichkeit / Realismus
Diese Version ist ein starker Browser-Prototyp mit 3D-Viewer und präziser Trajektorienabtastung bis 0,01 mm, aber keine zertifizierte 1:1-Maschinenvalidierung. Für echte industrielle Freigabe braucht es Controller-Digitalzwillinge, Maschinenkalibrierung und verifizierte Kollisionsmodelle.

## Start
1. Dateien im selben Ordner halten (`index.html`, `style.css`, `app.js`, `README.md`).
2. `index.html` im Browser öffnen.
3. `Parse` drücken, dann `Cycle Start`.
4. Bei Bedarf im Viewer zwischen `3D Machine View` und `2D Top View` wechseln.
5. Für Unreal-Workflow nach dem Parsen auf `Export Unreal JSON` klicken.

## Nächste Schritte Richtung „echte 1:1 Maschine“
- Beschleunigungs-/Jerk-Profile und look-ahead feed planning
- Werkzeughalter-/Spannmittel-/Maschinenkollisionsmodelle
- Controller-spezifische Makros, Tool Length / Cutter Compensation
- 3D-Materialmodell (Voxel/Mesh statt 2.5D Heightmap)
- Kalibrierte Maschinenparameter je Haas-Modell
