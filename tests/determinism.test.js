import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoxelStock, runStockRemoval, stockHash } from '../core/stock/index.js';

test('stock hash deterministic for same inputs', () => {
  const mk = () => createVoxelStock({ width: 20, height: 20, depth: 10, voxelSize: 1 });
  const timeline = [
    { axes: { x: 1, y: 1, z: 1 } },
    { axes: { x: 10, y: 10, z: 1 } },
  ];
  const s1 = runStockRemoval(mk(), timeline, 4);
  const s2 = runStockRemoval(mk(), timeline, 4);
  assert.equal(stockHash(s1), stockHash(s2));
});
