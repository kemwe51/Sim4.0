import { parseProgram } from '../../core/gcode_parser/index.js';
import { interpretBlocks } from '../../core/interpreter/index.js';
import { loadMachineModel } from '../../core/kinematics/index.js';
import { planTrajectory } from '../../core/motion_planner/index.js';
import { detectCollisions } from '../../core/collision/index.js';
import { createVoxelStock, runStockRemoval, exportStockToAsciiStl } from '../../core/stock/index.js';

const example = await fetch('./examples/phase1-example.nc').then((r) => r.text());
const machineJson = await fetch('./examples/machine-3axis.json').then((r) => r.json());
const machine = loadMachineModel(machineJson);

const editor = document.getElementById('gcode');
const runBtn = document.getElementById('run');
const summary = document.getElementById('summary');
const timelineEl = document.getElementById('timeline');
const collisionsEl = document.getElementById('collisions');
const canvas = document.getElementById('view');
const exportStockBtn = document.getElementById('exportStock');
const exportCollisionsBtn = document.getElementById('exportCollisions');

editor.value = example;
let lastResult = null;

function drawPath(timeline) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#081018';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!timeline.length) return;

  const xs = timeline.map((s) => s.axes.x);
  const ys = timeline.map((s) => s.axes.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const sx = (canvas.width - 30) / Math.max(1, maxX - minX);
  const sy = (canvas.height - 30) / Math.max(1, maxY - minY);

  ctx.beginPath();
  timeline.forEach((s, i) => {
    const x = 15 + (s.axes.x - minX) * sx;
    const y = canvas.height - (15 + (s.axes.y - minY) * sy);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#74f7b9';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function toCsv(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  return [keys.join(','), ...rows.map((r) => keys.map((k) => JSON.stringify(r[k] ?? '')).join(','))].join('\n');
}

function runSimulation() {
  const blocks = parseProgram(editor.value);
  const { commands, diagnostics } = interpretBlocks(blocks);
  const timeline = planTrajectory(commands, machine, { dt: 0.01 });
  const collisions = detectCollisions(timeline, machine);
  const stock = createVoxelStock(machine.stock);
  runStockRemoval(stock, timeline, machine.tool.diameter);

  lastResult = { blocks, commands, diagnostics, timeline, collisions, stock };

  summary.textContent = `Blöcke: ${blocks.length} | Canonical Commands: ${commands.length} | Trajectory Samples: ${timeline.length}`;
  timelineEl.textContent = timeline.slice(0, 12).map((s) => `t=${s.t.toFixed(3)}s N${s.lineNumber} XYZ(${s.axes.x.toFixed(3)}, ${s.axes.y.toFixed(3)}, ${s.axes.z.toFixed(3)}) F${s.feed.toFixed(1)}`).join('\n');
  collisionsEl.textContent = collisions.length
    ? collisions.map((c) => `${c.kind} at t=${c.t.toFixed(3)}s line=${c.lineNumber} pair=${c.pair.join('/')}`).join('\n')
    : 'Keine Kollisionen';

  if (diagnostics.length) {
    collisionsEl.textContent += `\n\nDiagnostics:\n${diagnostics.map((d) => `${d.severity.toUpperCase()} L${d.lineNumber}: ${d.message}`).join('\n')}`;
  }

  drawPath(timeline);
}

runBtn.addEventListener('click', runSimulation);

exportStockBtn.addEventListener('click', () => {
  if (!lastResult) return;
  const stl = exportStockToAsciiStl(lastResult.stock);
  const blob = new Blob([stl], { type: 'model/stl' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'reststock.stl';
  a.click();
});

exportCollisionsBtn.addEventListener('click', () => {
  if (!lastResult) return;
  const rows = lastResult.collisions.map((c) => ({
    kind: c.kind,
    time_s: c.t.toFixed(6),
    line: c.lineNumber,
    pair: c.pair.join(':'),
    x: c.point.x,
    y: c.point.y,
    z: c.point.z,
  }));
  const csv = toCsv(rows);
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'collisions.csv';
  a.click();
});

runSimulation();
