import test from 'node:test';
import assert from 'node:assert/strict';
import { planTrajectory } from '../core/motion_planner/index.js';

test('planner generates monotonic timeline', () => {
  const commands = [{ type: 'motion', mode: 'G1', from: {x:0,y:0,z:0}, to: {x:60,y:0,z:0}, feed: 600, spindleRpm: 0, spindleMode: 'M5', workOffset: 'G54', blockIndex: 0, lineNumber: 1 }];
  const machine = { axes: { X:{maxVelocity:200}, Y:{maxVelocity:200}, Z:{maxVelocity:200} }, tcp:{x:0,y:0,z:0}, workOffsets:{G54:{x:0,y:0,z:0}} };
  const tl = planTrajectory(commands, machine, { dt: 0.01 });
  assert.ok(tl.length > 0);
  assert.ok(tl[0].t > 0);
  assert.ok(tl[tl.length - 1].t >= 5.9 && tl[tl.length - 1].t <= 6.1);
});
