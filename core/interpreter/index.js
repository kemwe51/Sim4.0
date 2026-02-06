import { createModalState } from './modal_state.js';

const linearAxes = new Set(['X', 'Y', 'Z']);

function toMm(value, units) {
  return units === 'inch' ? value * 25.4 : value;
}

function nextPosition(state, wordMap) {
  const next = { ...state.position };
  for (const axis of linearAxes) {
    if (!wordMap.has(axis)) continue;
    const key = axis.toLowerCase();
    const mm = toMm(wordMap.get(axis), state.units);
    next[key] = state.distanceMode === 'G90' ? mm : next[key] + mm;
  }
  return next;
}

export function interpretBlocks(blocks) {
  const state = createModalState();
  const commands = [];
  const diagnostics = [];

  blocks.forEach((block, blockIndex) => {
    if (!block.words.length && !block.errors.length) return;
    if (block.errors.length) {
      diagnostics.push({ blockIndex, lineNumber: block.lineNumber, severity: 'error', message: block.errors.join('; ') });
      return;
    }

    const wordMap = new Map();
    for (const word of block.words) {
      if (!wordMap.has(word.letter)) wordMap.set(word.letter, word.value);
    }

    for (const word of block.words) {
      if (word.letter !== 'G' && word.letter !== 'M') continue;
      const code = `${word.letter}${Math.trunc(word.value)}`;
      if (['G17', 'G18', 'G19'].includes(code)) state.plane = code;
      else if (code === 'G20') state.units = 'inch';
      else if (code === 'G21') state.units = 'mm';
      else if (['G90', 'G91'].includes(code)) state.distanceMode = code;
      else if (code === 'G94') state.feedMode = 'G94';
      else if (['G0', 'G1'].includes(code)) state.motionMode = code;
      else if (code === 'G54') state.workOffset = 'G54';
      else if (['M3', 'M4', 'M5'].includes(code)) state.spindleMode = code;
      else if (code === 'M6') {
        commands.push({ type: 'tool_change', blockIndex, lineNumber: block.lineNumber, tool: wordMap.get('T') ?? state.tool });
      } else {
        diagnostics.push({ blockIndex, lineNumber: block.lineNumber, severity: 'warning', message: `Unsupported modal code ${code}` });
      }
    }

    if (wordMap.has('F')) state.feed = toMm(wordMap.get('F'), state.units);
    if (wordMap.has('S')) state.spindleRpm = wordMap.get('S');
    if (wordMap.has('T')) state.tool = wordMap.get('T');

    const hasMotionTarget = ['X', 'Y', 'Z'].some((a) => wordMap.has(a));
    if (hasMotionTarget) {
      const from = { ...state.position };
      const to = nextPosition(state, wordMap);
      state.position = to;
      commands.push({
        type: 'motion',
        mode: state.motionMode,
        plane: state.plane,
        from,
        to,
        feed: state.feed,
        spindleRpm: state.spindleRpm,
        spindleMode: state.spindleMode,
        workOffset: state.workOffset,
        blockIndex,
        lineNumber: block.lineNumber,
      });
    }

    commands.push({
      type: 'modal_snapshot',
      blockIndex,
      lineNumber: block.lineNumber,
      state: structuredClone(state),
    });
  });

  return { commands, diagnostics, finalState: state };
}
