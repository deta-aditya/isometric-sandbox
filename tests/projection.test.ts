import { strict as assert } from 'node:assert';
import { DEFAULT_GRID, TILE_H, TILE_W } from '../src/config.ts';
import { toGridPoint, toScreen } from '../src/geometry.ts';
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

assert.equal(TILE_W, TILE_H * 2);
ok('tiles are 2:1, the classic isometric angle');

// one step along a grid axis moves half a tile across and half a tile down, whatever the grid size
const a = toScreen(0, 0), b = toScreen(1, 0), c = toScreen(0, 1);
assert.equal((b.sy - a.sy) / (b.sx - a.sx), 0.5);
assert.equal((c.sy - a.sy) / (a.sx - c.sx), 0.5);
ok('grid lines slope 1:2 on screen');

// the whole map is twice as wide as it is tall (for a square grid)
const corners = [toScreen(0, 0), toScreen(DEFAULT_GRID, 0), toScreen(0, DEFAULT_GRID), toScreen(DEFAULT_GRID, DEFAULT_GRID)];
const width = Math.max(...corners.map((p) => p.sx)) - Math.min(...corners.map((p) => p.sx));
const height = Math.max(...corners.map((p) => p.sy)) - Math.min(...corners.map((p) => p.sy));
assert.equal(width / height, 2);
ok('a square map is twice as wide as tall');

// screen to grid undoes grid to screen
const p = toScreen(12.25, 40.5); const back = toGridPoint(p.sx, p.sy);
assert.ok(Math.abs(back.x - 12.25) < 1e-9 && Math.abs(back.y - 40.5) < 1e-9);
ok('screen and grid conversions round-trip');
