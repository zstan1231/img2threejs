#!/usr/bin/env node
// Structural checks for the head generator (no browser): determinism, sane cube counts,
// finite cell data, cloud cells resting on their scatter point, and a face that stays
// inside the frame the camera expects. Visual review is separate (capture.mjs).
//
//   node check_heads.mjs

import assert from 'node:assert/strict';
import { CELLS, PRESETS, resolveParams, randomParams, sampleHead, layoutCells } from './src/heads.js';

const heads = [...Object.keys(PRESETS).map((k) => [k, resolveParams(k)]),
  ['random-42', { ...resolveParams('reference'), ...randomParams(42) }]];

for (const [name, P] of heads) {
  const head = sampleHead(P);
  const cells = layoutCells(head);
  assert.ok(head.voxels.length > 15000 && head.voxels.length < 36000, `${name}: ${head.voxels.length} cubes`);
  assert.ok(cells.voxelCount <= CELLS * 0.8, `${name}: voxel cells exceed budget`);

  let front = 0, cloud = 0;
  for (let c = 0; c < CELLS; c++) {
    const o = c * 4;
    for (const a of [cells.home, cells.scatter, cells.attr]) {
      for (let k = 0; k < 4; k++) assert.ok(Number.isFinite(a[o + k]), `${name}: non-finite at cell ${c}`);
    }
    if (cells.home[o + 3] < 0) {
      cloud++;
      for (let k = 0; k < 3; k++) assert.equal(cells.home[o + k], cells.scatter[o + k], `${name}: cloud cell ${c} not at rest`);
    } else {
      assert.ok(cells.home[o + 3] <= 1, `${name}: peel out of range`);
      if (cells.home[o + 2] > 0.5) front++;
    }
  }
  assert.equal(cloud, CELLS - cells.voxelCount, `${name}: cloud count`);
  assert.ok(front > 2500, `${name}: only ${front} cubes on the face front`);

  const ys = head.voxels.map((v) => v.p[1]);
  assert.ok(Math.max(...ys) < 1.45 && Math.min(...ys) > -2.0, `${name}: head leaves the frame`);
  console.log(`ok ${name}: ${head.voxels.length} cubes, ${front} on the face front, ${cloud} cloud cells`);
}

// Determinism: same parameters, same cubes.
const a = layoutCells(sampleHead(resolveParams('reference')));
const b = layoutCells(sampleHead(resolveParams('reference')));
assert.deepEqual(a.home, b.home);
assert.deepEqual(a.scatter, b.scatter);
console.log('ok deterministic');
