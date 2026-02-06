# Sim4.0 CNC-Maschinenraumsimulator

## 1) Architekturübersicht (Komponenten + Datenfluss)

```
G-Code (.nc/.tap)
  -> core/gcode_parser (Lexer/Parser, RS274-like)
  -> core/interpreter (Modal State Machine, Canonical Commands)
  -> core/motion_planner (zeitparametrisierte Trajektorie, dt-basiert)
  -> core/kinematics (FK, Work Offset Mapping)
  -> core/collision (Kollisionsereignisse / Maschinenraumgrenzen)
  -> core/stock (Voxel-Abtrag, Reststock STL)
  -> app/viewer (Timeline, Visualisierung, Exporte)
```

### Modulrollen
- `core/gcode_parser`: wandelt Zeilen robust in Tokens/Words, inkl. Fehlern pro Block.
- `core/interpreter`: verarbeitet modale Zustände (`G90`, `G17`, `G54`, `M3` etc.) und erzeugt canonical commands.
- `core/motion_planner`: erstellt eine zeitparametrisierte Abtastung (`TrajectorySample`) mit fester Simulationszeitbasis.
- `core/kinematics`: 3-Achs FK (double precision JS Number), Feed-Clamping anhand Achsgrenzen.
- `core/collision`: erkennt Envelope-Verletzung + Fixture-AABB Kollisionen, mit Zeit- und Blockbezug.
- `core/stock`: voxelbasierter Materialabtrag entlang Trajektorie, STL-Export Reststock.
- `app/viewer`: Browser-UI für Import/Simulation/Export.

## 2) Datenmodelle

### `ModalState`
```js
{
  plane: 'G17' | 'G18' | 'G19',
  units: 'mm' | 'inch',
  distanceMode: 'G90' | 'G91',
  feedMode: 'G94',
  motionMode: 'G0' | 'G1',
  spindleMode: 'M3' | 'M4' | 'M5',
  spindleRpm: number,
  feed: number,           // mm/min
  workOffset: 'G54',
  tool: number,
  position: { x, y, z }
}
```

### `CanonicalCommand`
```js
// motion
{
  type: 'motion',
  mode: 'G0' | 'G1',
  plane,
  from: {x,y,z},
  to: {x,y,z},
  feed,
  spindleRpm,
  spindleMode,
  workOffset,
  blockIndex,
  lineNumber
}

// tool change stub
{ type: 'tool_change', tool, blockIndex, lineNumber }
```

### `TrajectorySample`
```js
{
  t: number,              // seconds
  blockIndex: number,
  lineNumber: number,
  position: {x,y,z},      // TCP in machine coordinates
  axes: {x,y,z},          // commanded axes
  feed: number,           // mm/min effective
  spindleRpm: number,
  spindleMode: 'M3'|'M4'|'M5',
  motionMode: 'G0'|'G1'
}
```

## 3) Lauffähiges Minimalbeispiel (Phase 1)

### Enthaltene Features
- 3-Achs Fräsen
- `G0/G1`, `G17/G18/G19`, `G20/G21`, `G90/G91`, `G94`, `F`, `S`, `M3/M4/M5`, `M6` Stub, `G54`
- Modal State Machine
- Fixed timestep Motion Planning (`dt=10ms` im Viewer)
- Voxel-Stock-Abtrag
- Kollisionsreport (Envelope + Fixture AABB)
- Exporte: `collisions.csv` und `reststock.stl`

### Start
1. `python3 -m http.server 8000`
2. Browser öffnen: `http://localhost:8000`
3. G-Code laden/ändern, **Simulieren** klicken.

### Beispielinputs
- `examples/phase1-example.nc`
- `examples/machine-3axis.json`

## 4) Iterationsplan Phase 2–4

### Phase 2
- `G2/G3` inkl. `IJK` und `R`
- Tool Length Compensation `G43 H`
- Erweiterte Work Offsets (`G55+`)
- Optional: Cutter Comp `G41/G42` zunächst geometrisch approximiert

### Phase 3 (5-Achs)
- A/B/C-Achsen im Maschinenmodell + FK-Kette für Rotationsachsen
- Axis-commanded mode (A/B/C direkt aus G-Code)
- Optionaler TCP/RTCP Modus danach (klar als Modus markieren)

### Phase 4 (steuerungsnah)
- Beschleunigungsprofile (Trapez/S-Curve)
- Lookahead über N Blöcke
- Corner blending / `G64`-ähnlicher Modus
- Continuous Collision Detection (swept tests, conservative advancement)

## Tests
- Parser/Modalität
- Planner-Timing
- FK
- Triangle Intersection (robuster 2D-Baryzentrik-Ansatz auf Triangles)
- Determinism Stock Hash

Ausführen mit:
```bash
npm test
```
