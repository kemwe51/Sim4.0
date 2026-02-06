import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProgram } from '../core/gcode_parser/index.js';
import { interpretBlocks } from '../core/interpreter/index.js';

test('modal G1 remains active until changed', () => {
  const src = `G21 G90\nG1 X10 F100\nY5\nG0 Z10`;
  const blocks = parseProgram(src);
  const { commands } = interpretBlocks(blocks);
  const motions = commands.filter((c) => c.type === 'motion');
  assert.equal(motions[1].mode, 'G1');
  assert.equal(motions[2].mode, 'G0');
});
