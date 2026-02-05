const MM_PER_INCH = 25.4;

const exampleProgram = `
(O3000 HAAS STYLE ROUGH + FINISH)
G21 G90 G17
G54
S8000 M3
G0 X8 Y8 Z10
F1200
G1 Z-2
G1 X112 Y8
G1 X112 Y72
G1 X8 Y72
G1 X8 Y8
G1 Z-6
G1 X20 Y20
G2 X100 Y20 I40 J0
G1 X100 Y60
G3 X20 Y60 I-40 J0
G1 X20 Y20
G0 Z12
M5
M30
`.trim();

const $ = (id) => document.getElementById(id);

const editor = $('gcodeEditor');
const parseBtn = $('parseBtn');
const cycleStartBtn = $('cycleStartBtn');
const feedHoldBtn = $('feedHoldBtn');
const stepBtn = $('stepBtn');
const resetBtn = $('resetBtn');
const singleBlockInput = $('singleBlock');

const speedSlider = $('speedSlider');
const speedValue = $('speedValue');
const parsedLinesEl = $('parsedLines');

const stockWidthInput = $('stockWidth');
const stockHeightInput = $('stockHeight');
const stockDepthInput = $('stockDepth');
const toolDiameterInput = $('toolDiameter');

const machineMaxXInput = $('machineMaxX');
const machineMaxYInput = $('machineMaxY');
const machineMaxZInput = $('machineMaxZ');
const machineMinZInput = $('machineMinZ');

const offsetXInput = $('offsetX');
const offsetYInput = $('offsetY');
const offsetZInput = $('offsetZ');
const feedOverrideInput = $('feedOverride');

const statusUnits = $('statusUnits');
const statusMode = $('statusMode');
const statusFeed = $('statusFeed');
const statusRpm = $('statusRpm');
const statusSpindle = $('statusSpindle');
const statusX = $('statusX');
const statusY = $('statusY');
const statusZ = $('statusZ');
const statusMx = $('statusMx');
const statusMy = $('statusMy');
const statusMz = $('statusMz');
const statusLine = $('statusLine');
const statusCutting = $('statusCutting');
const statusRemoved = $('statusRemoved');
const statusStock = $('statusStock');
const statusMrr = $('statusMrr');
const statusAlarm = $('statusAlarm');

const canvas = $('toolpathCanvas');
const ctx = canvas.getContext('2d');

function machineDefaults() {
  return {
    units: 'mm',
    distanceMode: 'G90',
    plane: 'G17',
    wcs: 'G54',
    motionMode: 'G0',
    feed: 0,
    rpm: 0,
    spindleOn: false,
    position: { x: 0, y: 0, z: 0 },
  };
}

function setupDefaults() {
  return {
    stock: {
      width: Number(stockWidthInput.value || 120),
      height: Number(stockHeightInput.value || 80),
      depth: Number(stockDepthInput.value || 20),
    },
    toolDiameter: Number(toolDiameterInput.value || 10),
    resolution: 2,
    envelope: {
      maxX: Number(machineMaxXInput.value || 762),
      maxY: Number(machineMaxYInput.value || 406),
      maxZ: Number(machineMaxZInput.value || 508),
      minZ: Number(machineMinZInput.value || -508),
    },
    offsets: {
      G54: {
        x: Number(offsetXInput.value || 0),
        y: Number(offsetYInput.value || 0),
        z: Number(offsetZInput.value || 0),
      },
    },
    feedOverride: Math.max(1, Number(feedOverrideInput.value || 100)) / 100,
  };
}

const state = {
  parsed: [],
  pc: 0,
  running: false,
  speed: 1,
  machine: machineDefaults(),
  setup: setupDefaults(),
  pathSegments: [],
  heightmap: null,
  cellsX: 0,
  cellsY: 0,
  removedVolumeMm3: 0,
  removedVolumeAtLastLine: 0,
  initialVolumeMm3: 0,
  cuttingNow: false,
  alarm: null,
  rafId: null,
  lineAccumulator: 0,
  lastTs: null,
  mrrCm3PerMin: 0,
};

function cleanLine(line) {
  return line.replace(/\(.*?\)/g, '').replace(/;.*$/, '').trim().toUpperCase();
}

function parseProgram(source) {
  return source
    .split(/\r?\n/)
    .map((line, idx) => ({ originalLineNumber: idx + 1, cleaned: cleanLine(line) }))
    .filter((line) => line.cleaned)
    .map((line) => ({ ...line, tokens: line.cleaned.split(/\s+/).filter(Boolean) }));
}

function toMm(value, units) {
  return units === 'inch' ? value * MM_PER_INCH : value;
}

function parseToken(token) {
  const m = token.match(/^([A-Z])([+\-]?\d*\.?\d+)$/);
  return m ? { letter: m[1], value: Number(m[2]) } : null;
}

function buildHeightmap() {
  const { stock, resolution } = state.setup;
  state.cellsX = Math.max(10, Math.round(stock.width / resolution));
  state.cellsY = Math.max(10, Math.round(stock.height / resolution));
  state.heightmap = Array.from({ length: state.cellsY }, () => new Float32Array(state.cellsX).fill(stock.depth));
  state.removedVolumeMm3 = 0;
  state.removedVolumeAtLastLine = 0;
  state.initialVolumeMm3 = stock.width * stock.height * stock.depth;
}

function stockCellCenter(ix, iy) {
  const dx = state.setup.stock.width / state.cellsX;
  const dy = state.setup.stock.height / state.cellsY;
  return { x: (ix + 0.5) * dx, y: (iy + 0.5) * dy };
}

function pointInsideEnvelope(mcPos) {
  const env = state.setup.envelope;
  return mcPos.x >= 0 && mcPos.x <= env.maxX && mcPos.y >= 0 && mcPos.y <= env.maxY && mcPos.z >= env.minZ && mcPos.z <= env.maxZ;
}

function toMachineCoords(workPos) {
  const offset = state.setup.offsets[state.machine.wcs] || { x: 0, y: 0, z: 0 };
  return {
    x: workPos.x + offset.x,
    y: workPos.y + offset.y,
    z: workPos.z + offset.z,
  };
}

function cutAtPoint(x, y, z) {
  if (!state.heightmap) return;
  const radius = state.setup.toolDiameter / 2;
  const targetHeight = Math.max(0, state.setup.stock.depth + z);
  const dxCell = state.setup.stock.width / state.cellsX;
  const dyCell = state.setup.stock.height / state.cellsY;

  const minX = Math.max(0, Math.floor((x - radius) / dxCell));
  const maxX = Math.min(state.cellsX - 1, Math.ceil((x + radius) / dxCell));
  const minY = Math.max(0, Math.floor((y - radius) / dyCell));
  const maxY = Math.min(state.cellsY - 1, Math.ceil((y + radius) / dyCell));

  for (let iy = minY; iy <= maxY; iy += 1) {
    for (let ix = minX; ix <= maxX; ix += 1) {
      const c = stockCellCenter(ix, iy);
      if (Math.hypot(c.x - x, c.y - y) > radius) continue;
      const current = state.heightmap[iy][ix];
      if (targetHeight < current) {
        const removed = current - targetHeight;
        state.heightmap[iy][ix] = targetHeight;
        state.removedVolumeMm3 += removed * dxCell * dyCell;
      }
    }
  }
}

function processInterpolation(points, motion) {
  for (const p of points) {
    const mc = toMachineCoords(p);
    if (!pointInsideEnvelope(mc)) {
      state.alarm = `TRAVEL LIMIT @ X${mc.x.toFixed(2)} Y${mc.y.toFixed(2)} Z${mc.z.toFixed(2)}`;
      state.running = false;
      return false;
    }
    if (motion !== 'G0' && state.machine.spindleOn && p.z <= 0) {
      cutAtPoint(p.x, p.y, p.z);
    }
  }
  return true;
}

function interpolateLinePoints(start, end) {
  const dist = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  const steps = Math.max(1, Math.ceil(dist / 1));
  const points = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    points.push({
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
      z: start.z + (end.z - start.z) * t,
    });
  }
  return points;
}

function interpolateArcPoints(start, end, center, cw) {
  const r = Math.hypot(start.x - center.x, start.y - center.y);
  const a0 = Math.atan2(start.y - center.y, start.x - center.x);
  let a1 = Math.atan2(end.y - center.y, end.x - center.x);
  if (cw && a1 >= a0) a1 -= Math.PI * 2;
  if (!cw && a1 <= a0) a1 += Math.PI * 2;
  const delta = a1 - a0;
  const arcLen = Math.abs(delta * r);
  const steps = Math.max(4, Math.ceil(arcLen / 1));
  const points = [];

  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const a = a0 + delta * t;
    points.push({
      x: center.x + Math.cos(a) * r,
      y: center.y + Math.sin(a) * r,
      z: start.z + (end.z - start.z) * t,
    });
  }
  return points;
}

function computeMrr(lineDeltaMm3) {
  const feed = Math.max(1, state.machine.feed * state.setup.feedOverride);
  const roughLineMinutes = 1 / feed;
  const mrr = lineDeltaMm3 / Math.max(0.0001, roughLineMinutes);
  state.mrrCm3PerMin = mrr / 1000;
}

function executeLine(entry) {
  state.removedVolumeAtLastLine = state.removedVolumeMm3;

  const machine = state.machine;
  const start = { ...machine.position };
  let target = { ...machine.position };
  let hasAxisWord = false;
  let programEnd = false;
  let arcData = null;

  for (const token of entry.tokens) {
    const p = parseToken(token);
    if (!p) {
      if (token === 'G54') machine.wcs = 'G54';
      continue;
    }
    const { letter, value } = p;

    if (letter === 'G') {
      const gCode = `G${Math.round(value)}`;
      if (['G0', 'G1', 'G2', 'G3'].includes(gCode)) machine.motionMode = gCode;
      else if (gCode === 'G90' || gCode === 'G91') machine.distanceMode = gCode;
      else if (gCode === 'G17') machine.plane = gCode;
      else if (gCode === 'G20') machine.units = 'inch';
      else if (gCode === 'G21') machine.units = 'mm';
      else if (gCode === 'G54') machine.wcs = 'G54';
      continue;
    }

    if (letter === 'M') {
      const mCode = `M${Math.round(value)}`;
      if (mCode === 'M3') machine.spindleOn = true;
      else if (mCode === 'M5') machine.spindleOn = false;
      else if (mCode === 'M30') {
        programEnd = true;
        state.running = false;
      }
      continue;
    }

    if (letter === 'F') {
      machine.feed = toMm(value, machine.units);
      continue;
    }

    if (letter === 'S') {
      machine.rpm = value;
      continue;
    }

    if (['X', 'Y', 'Z'].includes(letter)) {
      hasAxisWord = true;
      const mmVal = toMm(value, machine.units);
      if (machine.distanceMode === 'G90') target[letter.toLowerCase()] = mmVal;
      else target[letter.toLowerCase()] += mmVal;
      continue;
    }

    if (letter === 'I' || letter === 'J') {
      arcData = arcData || { i: 0, j: 0 };
      arcData[letter.toLowerCase()] = toMm(value, machine.units);
    }
  }

  if (hasAxisWord) {
    state.pathSegments.push({ from: start, to: { ...target }, motion: machine.motionMode, arcData });

    let ok = true;
    if (machine.motionMode === 'G2' || machine.motionMode === 'G3') {
      const center = { x: start.x + (arcData?.i || 0), y: start.y + (arcData?.j || 0) };
      const points = interpolateArcPoints(start, target, center, machine.motionMode === 'G2');
      ok = processInterpolation(points, machine.motionMode);
    } else {
      const points = interpolateLinePoints(start, target);
      ok = processInterpolation(points, machine.motionMode);
    }

    machine.position = ok ? target : machine.position;
    state.cuttingNow = ok && machine.spindleOn && machine.motionMode !== 'G0' && machine.position.z <= 0;
  } else {
    state.cuttingNow = false;
  }

  computeMrr(Math.max(0, state.removedVolumeMm3 - state.removedVolumeAtLastLine));

  state.pc = programEnd || state.alarm ? state.parsed.length : state.pc + 1;

  if (singleBlockInput.checked) {
    state.running = false;
  }
}

function stepOneLine() {
  if (state.pc >= state.parsed.length || state.alarm) {
    state.running = false;
    return;
  }
  executeLine(state.parsed[state.pc]);
  updateUI();
  draw();
}

function resetSimulation() {
  state.pc = 0;
  state.running = false;
  state.machine = machineDefaults();
  state.setup = setupDefaults();
  state.pathSegments = [];
  state.cuttingNow = false;
  state.alarm = null;
  state.mrrCm3PerMin = 0;
  state.lineAccumulator = 0;
  state.lastTs = null;
  buildHeightmap();
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = null;
  updateUI();
  draw();
}

function parseAndReset() {
  state.parsed = parseProgram(editor.value);
  renderParsedLines();
  resetSimulation();
}

function loop(ts) {
  if (!state.running) return;
  if (state.lastTs == null) state.lastTs = ts;

  const dt = (ts - state.lastTs) / 1000;
  state.lastTs = ts;
  const linesPerSecond = 6 * state.speed;
  state.lineAccumulator += dt * linesPerSecond;

  while (state.lineAccumulator >= 1 && state.running) {
    state.lineAccumulator -= 1;
    stepOneLine();
    if (state.pc >= state.parsed.length || state.alarm) state.running = false;
  }

  if (state.running) state.rafId = requestAnimationFrame(loop);
}

function ensureCanvasSize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(100, Math.floor(rect.width * dpr));
  const h = Math.max(100, Math.floor(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function computeBounds() {
  const { width, height } = state.setup.stock;
  return { minX: -5, maxX: width + 5, minY: -5, maxY: height + 5 };
}

function worldToScreen(x, y, bounds, w, h) {
  const scale = Math.min(w / (bounds.maxX - bounds.minX), h / (bounds.maxY - bounds.minY));
  const contentW = (bounds.maxX - bounds.minX) * scale;
  const contentH = (bounds.maxY - bounds.minY) * scale;
  const offsetX = (w - contentW) / 2;
  const offsetY = (h - contentH) / 2;

  return {
    x: offsetX + (x - bounds.minX) * scale,
    y: h - (offsetY + (y - bounds.minY) * scale),
  };
}

function drawGrid(bounds, w, h) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  for (let x = Math.floor(bounds.minX / 10) * 10; x <= bounds.maxX; x += 10) {
    const a = worldToScreen(x, bounds.minY, bounds, w, h);
    const b = worldToScreen(x, bounds.maxY, bounds, w, h);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  for (let y = Math.floor(bounds.minY / 10) * 10; y <= bounds.maxY; y += 10) {
    const a = worldToScreen(bounds.minX, y, bounds, w, h);
    const b = worldToScreen(bounds.maxX, y, bounds, w, h);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.restore();
}

function drawStock(bounds, w, h) {
  if (!state.heightmap) return;
  const dx = state.setup.stock.width / state.cellsX;
  const dy = state.setup.stock.height / state.cellsY;
  const depth = state.setup.stock.depth;

  for (let iy = 0; iy < state.cellsY; iy += 1) {
    for (let ix = 0; ix < state.cellsX; ix += 1) {
      const hCell = state.heightmap[iy][ix];
      const ratio = Math.max(0, Math.min(1, hCell / depth));
      const r = Math.round(30 + 110 * ratio);
      const g = Math.round(35 + 130 * ratio);
      const b = Math.round(55 + 60 * ratio);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;

      const p0 = worldToScreen(ix * dx, iy * dy, bounds, w, h);
      const p1 = worldToScreen((ix + 1) * dx, (iy + 1) * dy, bounds, w, h);
      ctx.fillRect(Math.min(p0.x, p1.x), Math.min(p0.y, p1.y), Math.abs(p1.x - p0.x) + 0.5, Math.abs(p1.y - p0.y) + 0.5);
    }
  }
}

function drawPath(bounds, w, h) {
  for (const seg of state.pathSegments) {
    const a = worldToScreen(seg.from.x, seg.from.y, bounds, w, h);
    const b = worldToScreen(seg.to.x, seg.to.y, bounds, w, h);

    ctx.save();
    if (seg.motion === 'G0') {
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = '#9aa4b2';
      ctx.lineWidth = 1.7;
    } else {
      ctx.setLineDash([]);
      ctx.strokeStyle = '#6dff9d';
      ctx.lineWidth = 2.1;
    }

    ctx.beginPath();
    if ((seg.motion === 'G2' || seg.motion === 'G3') && seg.arcData) {
      const center = { x: seg.from.x + seg.arcData.i, y: seg.from.y + seg.arcData.j };
      const c = worldToScreen(center.x, center.y, bounds, w, h);
      const r = Math.hypot(a.x - c.x, a.y - c.y);
      const a0 = Math.atan2(a.y - c.y, a.x - c.x);
      const a1 = Math.atan2(b.y - c.y, b.x - c.x);
      ctx.arc(c.x, c.y, r, a0, a1, seg.motion === 'G2');
    } else {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

function drawTool(bounds, w, h) {
  const tool = worldToScreen(state.machine.position.x, state.machine.position.y, bounds, w, h);
  const scale = Math.min(w / (bounds.maxX - bounds.minX), h / (bounds.maxY - bounds.minY));
  const radius = Math.max(4, (state.setup.toolDiameter / 2) * scale);

  ctx.beginPath();
  ctx.arc(tool.x, tool.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = state.machine.spindleOn ? 'rgba(83,208,255,0.35)' : 'rgba(215,221,231,0.18)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(tool.x, tool.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = state.alarm ? '#ff6f6f' : (state.machine.spindleOn ? '#53d0ff' : '#d7dde7');
  ctx.fill();
}

function draw() {
  ensureCanvasSize();
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const bounds = computeBounds();
  drawGrid(bounds, w, h);
  drawStock(bounds, w, h);
  drawPath(bounds, w, h);
  drawTool(bounds, w, h);
}

function renderParsedLines() {
  parsedLinesEl.innerHTML = '';
  state.parsed.forEach((line, idx) => {
    const li = document.createElement('li');
    li.dataset.index = String(idx);
    li.textContent = `N${idx + 1} | L${line.originalLineNumber}: ${line.cleaned}`;
    parsedLinesEl.appendChild(li);
  });
}

function updateCurrentLineHighlight() {
  parsedLinesEl.querySelectorAll('li').forEach((li) => {
    li.classList.toggle('current', Number(li.dataset.index) === state.pc);
  });
}

function updateUI() {
  const mcPos = toMachineCoords(state.machine.position);
  statusUnits.textContent = state.machine.units;
  statusMode.textContent = `${state.machine.distanceMode} ${state.machine.motionMode} ${state.machine.wcs}`;
  statusFeed.textContent = (state.machine.feed * state.setup.feedOverride).toFixed(1);
  statusRpm.textContent = String(state.machine.rpm);
  statusSpindle.textContent = state.machine.spindleOn ? 'M3' : 'M5';
  statusX.textContent = state.machine.position.x.toFixed(3);
  statusY.textContent = state.machine.position.y.toFixed(3);
  statusZ.textContent = state.machine.position.z.toFixed(3);
  statusMx.textContent = mcPos.x.toFixed(3);
  statusMy.textContent = mcPos.y.toFixed(3);
  statusMz.textContent = mcPos.z.toFixed(3);
  statusLine.textContent = state.pc < state.parsed.length ? `${state.pc + 1}` : 'END';
  statusCutting.textContent = state.cuttingNow ? 'YES' : 'NO';
  statusRemoved.textContent = `${(state.removedVolumeMm3 / 1000).toFixed(2)} cm³`;
  statusMrr.textContent = `${state.mrrCm3PerMin.toFixed(2)} cm³/min`;

  const left = Math.max(0, 100 - (state.removedVolumeMm3 / Math.max(1, state.initialVolumeMm3)) * 100);
  statusStock.textContent = `${left.toFixed(1)}%`;
  statusAlarm.textContent = state.alarm || 'NONE';
  statusAlarm.classList.toggle('alarm-active', Boolean(state.alarm));

  updateCurrentLineHighlight();
}

parseBtn.addEventListener('click', parseAndReset);
cycleStartBtn.addEventListener('click', () => {
  if (state.alarm) return;
  if (!state.parsed.length) parseAndReset();
  if (state.pc >= state.parsed.length) return;
  state.running = true;
  state.lastTs = null;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = requestAnimationFrame(loop);
});

feedHoldBtn.addEventListener('click', () => {
  state.running = false;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = null;
});

stepBtn.addEventListener('click', () => {
  state.running = false;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = null;
  if (!state.parsed.length) parseAndReset();
  stepOneLine();
});

resetBtn.addEventListener('click', resetSimulation);

speedSlider.addEventListener('input', () => {
  state.speed = Number(speedSlider.value);
  speedValue.textContent = `${state.speed.toFixed(1)}×`;
});

feedOverrideInput.addEventListener('change', () => {
  state.setup.feedOverride = Math.max(0.01, Number(feedOverrideInput.value || 100) / 100);
  updateUI();
});

[
  stockWidthInput,
  stockHeightInput,
  stockDepthInput,
  toolDiameterInput,
  machineMaxXInput,
  machineMaxYInput,
  machineMaxZInput,
  machineMinZInput,
  offsetXInput,
  offsetYInput,
  offsetZInput,
].forEach((el) => {
  el.addEventListener('change', parseAndReset);
});

window.addEventListener('resize', draw);

function boot() {
  editor.value = exampleProgram;
  state.speed = Number(speedSlider.value);
  speedValue.textContent = `${state.speed.toFixed(1)}×`;
  parseAndReset();
}

boot();
