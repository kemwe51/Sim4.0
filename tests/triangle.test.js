import test from 'node:test';
import assert from 'node:assert/strict';
import { triangleTriangleIntersect } from '../core/collision/triangle.js';

test('triangle intersection basic case', () => {
  const a = [[0,0,0],[1,0,0],[0,1,0]];
  const b = [[0.2,0.2,0],[1.2,0.2,0],[0.2,1.2,0]];
  assert.equal(triangleTriangleIntersect(a, b), true);
});
