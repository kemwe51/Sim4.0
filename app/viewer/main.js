import { parseProgram } from '../../core/gcode_parser/index.js';
import { interpretBlocks } from '../../core/interpreter/index.js';
import { loadMachineModel } from '../../core/kinematics/index.js';
import { planTrajectory } from '../../core/motion_planner/index.js';
import { detectCollisions } from '../../core/collision/index.js';
import { createVoxelStock, runStockRemoval, exportStockToAsciiStl } from '../../core/stock/index.js';

const example = await fetch('./examples/phase1-example.nc').then((r) => r.text());

const editor = document.getElementById('gcode');
const runBtn = document.getElementById('run');
const summary = document.getElementById('summary');
const timelineEl = document.getElementById('timeline');
const collisionsEl = document.getElementById('collisions');
const canvas = document.getElementById('view');
const exportStockBtn = document.getElementById('exportStock');
const exportCollisionsBtn = document.getElementById('exportCollisions');
const machineSelect = document.getElementById('machineSelect');
const machineInfo = document.getElementById('machineInfo');
const assetList = document.getElementById('assetList');
const dtInput = document.getElementById('dt');
const voxelSizeInput = document.getElementById('voxelSize');
const toolDiameterInput = document.getElementById('toolDiameter');
const stockWidthInput = document.getElementById('stockWidth');
const stockHeightInput = document.getElementById('stockHeight');
const stockDepthInput = document.getElementById('stockDepth');

editor.value = example;
let lastResult = null;
let activeMachine = null;
let activeAssets = [];

const machineCatalog = [
  {
    id: 'demo-3axis',
    label: 'Demo 3-Achs (JSON)',
    type: 'json',
    path: './examples/machine-3axis.json',
  },
  {
    id: 'haas-dm1',
    label: 'Haas DM1 3X (XML + STL)',
    type: 'xml',
    path: './machine/haas_dm1_3X/DM1_3X.xml',
    config: './machine/haas_dm1_3X/sim-config.json',
  },
];

function parseMachineXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const axisNodes = Array.from(doc.querySelectorAll('axis[id]'));
  const axes = {};
  axisNodes.forEach((node) => {
    const id = node.getAttribute('id');
    if (!['X', 'Y', 'Z'].includes(id)) return;
    const min = Number.parseFloat(node.getAttribute('minvalue'));
    const max = Number.parseFloat(node.getAttribute('maxvalue'));
    axes[id] = {
      min: Number.isFinite(min) ? min : undefined,
      max: Number.isFinite(max) ? max : undefined,
    };
  });

  const geometries = Array.from(doc.querySelectorAll('geometry[geo]')).map((node) => ({
    name: node.getAttribute('name') ?? 'asset',
    file: node.getAttribute('geo') ?? '',
  }));

  return { axes, geometries };
}

function buildMachineFromXml(axesFromXml, config) {
  const axisDefaults = config.axisDefaults ?? { maxVelocity: 500, maxAccel: 3000, min: -500, max: 500 };
  const resolveAxis = (id) => {
    const axisData = axesFromXml[id] ?? {};
    return {
      type: 'linear',
      maxVelocity: axisDefaults.maxVelocity,
      maxAccel: axisDefaults.maxAccel,
      min: axisData.min ?? axisDefaults.min,
      max: axisData.max ?? axisDefaults.max,
    };
  };
  const axes = {
    X: resolveAxis('X'),
    Y: resolveAxis('Y'),
    Z: resolveAxis('Z'),
  };

  return {
    name: config.name ?? 'Haas DM1 3X',
    tcp: config.tcp ?? { x: 0, y: 0, z: 0 },
    stock: config.stock,
    tool: config.tool,
    workOffsets: config.workOffsets ?? { G54: { x: 0, y: 0, z: 0 } },
    axes,
    envelope: {
      min: { x: axes.X.min, y: axes.Y.min, z: axes.Z.min },
      max: { x: axes.X.max, y: axes.Y.max, z: axes.Z.max },
    },
    fixtures: config.fixtures ?? [],
  };
}

async function loadMachine(option) {
  if (option.type === 'json') {
    const machineJson = await fetch(option.path).then((r) => r.json());
    return { machine: loadMachineModel(machineJson), assets: [] };
  }

  const [xmlText, config] = await Promise.all([
    fetch(option.path).then((r) => r.text()),
    fetch(option.config).then((r) => r.json()),
  ]);
  const parsed = parseMachineXml(xmlText);
  return { machine: buildMachineFromXml(parsed.axes, config), assets: parsed.geometries };
}

function renderMachineInfo(machine) {
  const axes = machine.axes ?? {};
  const lines = [
    `Name: ${machine.name}`,
    `TCP: X${machine.tcp.x} Y${machine.tcp.y} Z${machine.tcp.z}`,
    `Stock: ${machine.stock.width}x${machine.stock.height}x${machine.stock.depth} mm (Voxel ${machine.stock.voxelSize} mm)`,
    `Tool: Ø${machine.tool.diameter} mm`,
    `Axes X/Y/Z:`,
    `  X [${axes.X.min}, ${axes.X.max}] mm`,
    `  Y [${axes.Y.min}, ${axes.Y.max}] mm`,
    `  Z [${axes.Z.min}, ${axes.Z.max}] mm`,
  ];
  machineInfo.textContent = lines.join('\n');
}

function renderAssets(assets) {
  assetList.innerHTML = '';
  if (!assets.length) {
    const li = document.createElement('li');
    li.textContent = 'Keine STL Assets hinterlegt.';
    assetList.appendChild(li);
    return;
  }
  assets.forEach((asset) => {
    const li = document.createElement('li');
    li.textContent = `${asset.name}: ${asset.file}`;
    assetList.appendChild(li);
  });
}

function setInputValue(input, value) {
  input.value = Number.isFinite(value) ? String(value) : '';
}

function readNumber(input, fallback, minValue) {
  const value = Number.parseFloat(input.value);
  if (!Number.isFinite(value)) return fallback;
  if (typeof minValue === 'number' && value < minValue) return fallback;
  return value;
}

async function selectMachine(optionId) {
  const option = machineCatalog.find((item) => item.id === optionId) ?? machineCatalog[0];
  const { machine, assets } = await loadMachine(option);
  activeMachine = machine;
  activeAssets = assets;
  renderMachineInfo(machine);
  renderAssets(assets);
  setInputValue(voxelSizeInput, machine.stock.voxelSize);
  setInputValue(toolDiameterInput, machine.tool.diameter);
  setInputValue(stockWidthInput, machine.stock.width);
  setInputValue(stockHeightInput, machine.stock.height);
  setInputValue(stockDepthInput, machine.stock.depth);
}

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

function buildRuntimeMachine() {
  const stock = {
    ...activeMachine.stock,
    width: readNumber(stockWidthInput, activeMachine.stock.width, 1),
    height: readNumber(stockHeightInput, activeMachine.stock.height, 1),
    depth: readNumber(stockDepthInput, activeMachine.stock.depth, 1),
    voxelSize: readNumber(voxelSizeInput, activeMachine.stock.voxelSize, 0.1),
  };
  const tool = {
    ...activeMachine.tool,
    diameter: readNumber(toolDiameterInput, activeMachine.tool.diameter, 0.1),
  };
  return {
    ...activeMachine,
    stock,
    tool,
  };
}

function runSimulation() {
  if (!activeMachine) return;
  const runtimeMachine = buildRuntimeMachine();
  const dt = readNumber(dtInput, 0.01, 0.001);
  const blocks = parseProgram(editor.value);
  const { commands, diagnostics } = interpretBlocks(blocks);
  const timeline = planTrajectory(commands, runtimeMachine, { dt });
  const collisions = detectCollisions(timeline, runtimeMachine);
  const stock = createVoxelStock(runtimeMachine.stock);
  runStockRemoval(stock, timeline, runtimeMachine.tool.diameter);

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

machineCatalog.forEach((option) => {
  const entry = document.createElement('option');
  entry.value = option.id;
  entry.textContent = option.label;
  machineSelect.appendChild(entry);
});

machineSelect.addEventListener('change', (event) => {
  selectMachine(event.target.value).then(runSimulation);
});

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

await selectMachine(machineCatalog[0].id);
runSimulation();
