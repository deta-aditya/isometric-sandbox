import assert from 'node:assert/strict';
import { waterSides } from '../src/render/drawables';
const set = (cells: [number, number][]) => { const k = new Set(cells.map(([x, y]) => `${x},${y}`)); return (x: number, y: number) => k.has(`${x},${y}`); };
// a straight canal along x: banks on north and south only
const line = set([[0, 0], [1, 0], [2, 0]]);
assert.deepEqual(waterSides(line, 1, 0), { west: false, north: true, east: false, south: true, nw: false, ne: false, se: false, sw: false });
// an L: the inner corner gets a post where the diagonal is land
const ell = set([[0, 0], [1, 0], [0, 1]]);
assert.equal(waterSides(ell, 0, 0).se, true);
assert.equal(waterSides(ell, 0, 0).west, true);
// a 2x2 block: every tile has two banks and no posts
const block = set([[0, 0], [1, 0], [0, 1], [1, 1]]);
const s = waterSides(block, 1, 1);
assert.deepEqual([s.east, s.south, s.west, s.north, s.nw], [true, true, false, false, false]);
console.log('all passed');
