import test from 'node:test';
import assert from 'node:assert/strict';
import { forwardKinematics3Axis } from '../core/kinematics/index.js';

test('fk applies work offset', () => {
  const p = forwardKinematics3Axis({ tcp:{x:0,y:0,z:0} }, {x:1,y:2,z:3}, {x:10,y:20,z:30});
  assert.deepEqual(p, {x:11,y:22,z:33});
});
