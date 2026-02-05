const MM_PER_INCH = 25.4;

const exampleProgram = `
(O1000 SIMPLE RECTANGLE)
(SET METRIC + ABSOLUTE)
G21 G90
S4500 M3
G0 X0 Y0 Z5
F500
G1 Z-1
G1 X50 Y0
G1 X50 Y30
G1 X0 Y30
G1 X0 Y0
G0 Z5
M5
M30
`.trim();

const editor = document.getElementById('gcodeEditor');
const parseBtn = document.getElementById('parseBtn');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const stepBtn = document.getElementById('stepBtn');
const resetBtn = document.getElementById('resetBtn');
const speedSlider = document.getElementById('speedSlider');
const speedValue = document.getElementById('speedValue');
const parsedLinesEl = document.getElementById('parsedLines');

const statusUnits = document.getElementById('statusUnits');
const statusMode = document.getElementById('statusMode');
const statusFeed = document.getElementById('statusFeed');
const statusRpm = document.getElementById('statusRpm');
const statusSpindle = document.getElementById('statusSpindle');
const statusX = document.getElementById('statusX');
const statusY = document.getElementById('statusY');
const statusZ = document.getElementById('statusZ');
const statusLine = document.getElementById('statusLine');

const canvas = document.getElementById('toolpathCanvas');
const ctx = canvas.getContext('2d');

const machineDefaults = () => ({
  units: 'mm',
  distanceMode: 'G90',
  motionMode: 'G0',
  feed: 0,
  rpm: 0,
  spindleOn: false,
  position: { x: 0, y: 0, z: 0 },
});

const state = {
  parsed: [],
  pc: 0,
  running: false,
  speed: 1,
  machine: machineDefaults(),
  pathSegments: [],
  rafId: null,
  lineAccumulator: 0,
  lastTs: null,
};

function cleanLine(line) {
  let cleaned = line.replace(/\(.*?\)/g, '');
  cleaned = cleaned.replace(/;.*$/, '');
  return cleaned.trim().toUpperCase();
}

function parseProgram(source) {
  const lines = source.split(/\r?\n/);
  const parsed = [];

  lines.forEach((line, idx) => {
    const cleaned = cleanLine(line);
    if (!cleaned) return;

    const tokens = cleaned.split(/\s+/).filter(Boolean);
    parsed.push({
      originalLineNumber: idx + 1,
      cleaned,
      tokens,
    });
  });

  return parsed;
}

function toMm(value, units) {
  return units === 'inch' ? value * MM_PER_INCH : value;
}

function parseToken(token) {
  const m = token.match(/^([A-Z])([+\-]?\d*\.?\d+)$/);
  if (!m) return null;
  return { letter: m[1], value: Number(m[2]) };
}

function executeLine(entry) {
  const machine = state.machine;
  const start = { ...machine.position };
  let target = { ...machine.position };
  let hasAxisWord = false;
  let programEnd = false;

  for (const token of entry.tokens) {
    const parsedToken = parseToken(token);
    if (!parsedToken) {
      console.warn(`Unknown token ignored on line ${entry.originalLineNumber}: ${token}`);
      continue;
    }

    const { letter, value } = parsedToken;

    if (letter === 'G') {
      const gCode = `G${Math.round(value)}`;
      if (gCode === 'G0' || gCode === 'G1') {
        machine.motionMode = gCode;
      } else if (gCode === 'G90' || gCode === 'G91') {
        machine.distanceMode = gCode;
      } else if (gCode === 'G20') {
        machine.units = 'inch';
      } else if (gCode === 'G21') {
        machine.units = 'mm';
      } else {
        console.warn(`Unsupported G-code ignored on line ${entry.originalLineNumber}: ${gCode}`);
      }
      continue;
    }

    if (letter === 'M') {
      const mCode = `M${Math.round(value)}`;
      if (mCode === 'M3') machine.spindleOn = true;
      else if (mCode === 'M5') machine.spindleOn = false;
      else if (mCode === 'M30') {
        programEnd = true;
        state.running = false;
      } else {
        console.warn(`Unsupported M-code ignored on line ${entry.originalLineNumber}: ${mCode}`);
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

    if (letter === 'X' || letter === 'Y' || letter === 'Z') {
      hasAxisWord = true;
      const mmVal = toMm(value, machine.units);
      if (machine.distanceMode === 'G90') {
        target[letter.toLowerCase()] = mmVal;
      } else {
        target[letter.toLowerCase()] += mmVal;
      }
      continue;
    }

    console.warn(`Unknown token ignored on line ${entry.originalLineNumber}: ${token}`);
  }

  if (hasAxisWord) {
    state.pathSegments.push({
      from: start,
      to: { ...target },
      motion: machine.motionMode,
    });
    machine.position = target;
  }

  if (programEnd) {
    state.pc = state.parsed.length;
  } else {
    state.pc += 1;
  }
}

function stepOneLine() {
  if (state.pc >= state.parsed.length) {
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
  state.pathSegments = [];
  state.lineAccumulator = 0;
  state.lastTs = null;
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

  if (state.lastTs == null) {
    state.lastTs = ts;
  }

  const dt = (ts - state.lastTs) / 1000;
  state.lastTs = ts;

  const linesPerSecondBase = 6;
  const linesPerSecond = linesPerSecondBase * state.speed;
  state.lineAccumulator += dt * linesPerSecond;

  while (state.lineAccumulator >= 1 && state.running) {
    state.lineAccumulator -= 1;
    stepOneLine();
    if (state.pc >= state.parsed.length) {
      state.running = false;
    }
  }

  if (state.running) {
    state.rafId = requestAnimationFrame(loop);
  }
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
  let minX = state.machine.position.x;
  let maxX = state.machine.position.x;
  let minY = state.machine.position.y;
  let maxY = state.machine.position.y;

  for (const seg of state.pathSegments) {
    minX = Math.min(minX, seg.from.x, seg.to.x);
    maxX = Math.max(maxX, seg.from.x, seg.to.x);
    minY = Math.min(minY, seg.from.y, seg.to.y);
    maxY = Math.max(maxY, seg.from.y, seg.to.y);
  }

  if (minX === maxX) {
    minX -= 1;
    maxX += 1;
  }
  if (minY === maxY) {
    minY -= 1;
    maxY += 1;
  }

  const padding = 4;
  return {
    minX: minX - padding,
    maxX: maxX + padding,
    minY: minY - padding,
    maxY: maxY + padding,
  };
}

function worldToScreen(x, y, bounds, w, h) {
  const scaleX = w / (bounds.maxX - bounds.minX);
  const scaleY = h / (bounds.maxY - bounds.minY);
  const scale = Math.min(scaleX, scaleY);

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
  const step = 10;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;

  const startX = Math.floor(bounds.minX / step) * step;
  const endX = Math.ceil(bounds.maxX / step) * step;
  for (let x = startX; x <= endX; x += step) {
    const p1 = worldToScreen(x, bounds.minY, bounds, w, h);
    const p2 = worldToScreen(x, bounds.maxY, bounds, w, h);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  const startY = Math.floor(bounds.minY / step) * step;
  const endY = Math.ceil(bounds.maxY / step) * step;
  for (let y = startY; y <= endY; y += step) {
    const p1 = worldToScreen(bounds.minX, y, bounds, w, h);
    const p2 = worldToScreen(bounds.maxX, y, bounds, w, h);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  ctx.restore();
}

function draw() {
  ensureCanvasSize();
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  const bounds = computeBounds();
  drawGrid(bounds, w, h);

  for (const seg of state.pathSegments) {
    const a = worldToScreen(seg.from.x, seg.from.y, bounds, w, h);
    const b = worldToScreen(seg.to.x, seg.to.y, bounds, w, h);

    ctx.save();
    if (seg.motion === 'G0') {
      ctx.setLineDash([9, 7]);
      ctx.strokeStyle = '#9aa4b2';
      ctx.lineWidth = 1.8;
    } else {
      ctx.setLineDash([]);
      ctx.strokeStyle = '#6dff9d';
      ctx.lineWidth = 2.2;
    }

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  const tool = worldToScreen(state.machine.position.x, state.machine.position.y, bounds, w, h);
  ctx.beginPath();
  ctx.arc(tool.x, tool.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = state.machine.spindleOn ? '#53d0ff' : '#d7dde7';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(tool.x, tool.y, state.machine.spindleOn ? 10 : 8, 0, Math.PI * 2);
  ctx.strokeStyle = state.machine.spindleOn ? 'rgba(83, 208, 255, 0.5)' : 'rgba(215, 221, 231, 0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();
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
  const items = parsedLinesEl.querySelectorAll('li');
  items.forEach((li) => {
    li.classList.toggle('current', Number(li.dataset.index) === state.pc);
  });
}

function updateUI() {
  statusUnits.textContent = state.machine.units;
  statusMode.textContent = state.machine.distanceMode;
  statusFeed.textContent = state.machine.feed.toFixed(2);
  statusRpm.textContent = String(state.machine.rpm);
  statusSpindle.textContent = state.machine.spindleOn ? 'M3' : 'M5';
  statusX.textContent = state.machine.position.x.toFixed(3);
  statusY.textContent = state.machine.position.y.toFixed(3);
  statusZ.textContent = state.machine.position.z.toFixed(3);
  statusLine.textContent = state.pc < state.parsed.length ? `${state.pc + 1}` : 'END';

  updateCurrentLineHighlight();
}

parseBtn.addEventListener('click', () => {
  parseAndReset();
});

startBtn.addEventListener('click', () => {
  if (!state.parsed.length) parseAndReset();
  if (state.pc >= state.parsed.length) return;
  state.running = true;
  state.lastTs = null;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = requestAnimationFrame(loop);
});

pauseBtn.addEventListener('click', () => {
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

resetBtn.addEventListener('click', () => {
  resetSimulation();
});

speedSlider.addEventListener('input', () => {
  state.speed = Number(speedSlider.value);
  speedValue.textContent = `${state.speed.toFixed(1)}×`;
});

window.addEventListener('resize', draw);

function boot() {
  editor.value = exampleProgram;
  state.speed = Number(speedSlider.value);
  speedValue.textContent = `${state.speed.toFixed(1)}×`;
  parseAndReset();
}

boot();
