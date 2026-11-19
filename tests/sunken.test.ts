import { strict as assert } from 'node:assert';
import { CANAL_DEPTH, STREAM_SINK } from '../src/config.ts';
import { sizeOf } from '../src/geometry.ts';
import { buildDrawables } from '../src/render/drawables.ts';
import { GROUND_KIND, TERRAIN_PX, chunkPixels, terrainGrid } from '../src/render/terrainField.ts';
import { type State, initialState } from '../src/world.ts';
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

// ===== The stream sinks =====
// a straight stream 4 tiles wide running along x (rows 10 to 13) on a 32 by 32 map of grass
const GRASS = 0x3a7d44;
const streams = []; for (let x = 0; x < 32; x++) for (let y = 10; y < 14; y++) streams.push({ x, y });
const g = terrainGrid([], 32, 32, () => GROUND_KIND, streams);
const img = chunkPixels(g, 0, 0, [], { color: GRASS });
const W = 32 * TERRAIN_PX;
const px = (x: number, y: number) => Array.from(img.slice((y * W + x) * 4, (y * W + x) * 4 + 3));
const isGrass = (c: number[]) => Math.abs(c[0]! - 0x3a) < 6 && Math.abs(c[1]! - 0x7d) < 6 && Math.abs(c[2]! - 0x44) < 6;
const isWater = (c: number[]) => c[2]! > c[0]! + 40 && c[2]! > 110;
const isBank = (c: number[]) => !isGrass(c) && !isWater(c) && c[0]! > c[2]!;
// walk down one column (x fixed, so the wobble is the same on both sides' terms) and classify
const col = 16 * TERRAIN_PX + 3;
const kinds = Array.from({ length: 32 * TERRAIN_PX }, (_, y) => { const c = px(col, y); return isWater(c) ? 'w' : isBank(c) ? 'b' : isGrass(c) ? 'g' : '?'; }).join('');
assert.ok(kinds.slice(0, 7 * TERRAIN_PX).split('').every((k) => k === 'g'), 'grass well above the stream');
assert.ok(kinds.slice(18 * TERRAIN_PX).split('').every((k) => k === 'g'), 'grass well below the stream');
assert.ok(kinds.includes('w'), 'water in the middle');
// the far bank (smaller y, above the water on screen) faces the camera and shows wider than the near bank
const firstW = kinds.indexOf('w'), lastW = kinds.lastIndexOf('w');
const farBank = kinds.slice(0, firstW).split('').filter((k) => k === 'b').length;
const nearBank = kinds.slice(lastW).split('').filter((k) => k === 'b').length;
assert.ok(farBank > nearBank, `far bank ${farBank} px, near bank ${nearBank} px`);
ok(`a stream sinks: grass, an earth bank, water; the far bank's slope shows wider (${farBank} px) than the near one (${nearBank} px)`);

// the water shows lower than the tiles: its middle sits a little past the tiles' middle toward the camera
const mid = (firstW + lastW) / 2 / TERRAIN_PX;
assert.ok(mid > 12 && mid < 13, `water middle at ${mid.toFixed(2)}`);
ok('the water is drawn lowered (its middle shows past the tiles\' middle, toward the camera)');

// a lone stream tile is still a small pond, not nothing
const pond = chunkPixels(terrainGrid([], 16, 16, () => GROUND_KIND, [{ x: 8, y: 8 }, { x: 9, y: 8 }, { x: 8, y: 9 }, { x: 9, y: 9 }]), 0, 0, [], { color: GRASS });
let wet = 0;
for (let i = 0; i < pond.length; i += 4) if (pond[i + 2]! > pond[i]! + 40 && pond[i + 2]! > 110) wet++;
assert.ok(wet > TERRAIN_PX * TERRAIN_PX, `${wet} water px`);
ok('a 2 by 2 stream is a small pond with water in it');

// ===== Floating things =====
const on = (defId: string, tile: string | null): number => {
  const s: State = {
    ...initialState, size: sizeOf(20, 20),
    tiles: tile ? [{ x: 5, y: 5, defId: tile }, { x: 5, y: 6, defId: tile }, { x: 5, y: 7, defId: tile }] : [],
    objects: [{ id: 1, defId, x: 5, y: 5, w: 1, h: defId === 'footbridge' ? 3 : defId === 'rowboat' ? 2 : 1, rotation: 0 }],
    nextId: 2,
  };
  const d = buildDrawables(s).sorted.find((x) => x.kind === 'object') as { sink?: number } | undefined;
  return d?.sink ?? 0;
};
assert.equal(on('duck', 'canal'), CANAL_DEPTH);
assert.equal(on('lily-pads', 'stream'), STREAM_SINK);
assert.equal(on('rowboat', 'canal'), CANAL_DEPTH);
assert.equal(on('duck', null), 0);
assert.equal(on('footbridge', 'stream'), 0);
assert.equal(on('oak', 'canal'), 0);
ok('things that float sit at the water\'s surface on a canal or stream, stand on the ground on land, and the footbridge never sinks');
