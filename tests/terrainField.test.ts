import { strict as assert } from 'node:assert';
import { CHUNK, GROUND_KIND, TERRAIN_PX, anyTerrain, chunkPixels, chunkSize, differs, terrainGrid } from '../src/render/terrainField.ts';
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

const GRASS = 0x3a7d44, SAND = 0xf0d77a, DIRT = 0x7a5536;
const looks = [{ color: SAND }, { color: DIRT }, { color: 0x4a8a46, specks: [0xffffff] }];
const kind = (id: string) => ({ sand: 0, dirt: 1, flowers: 2 })[id] ?? GROUND_KIND;
const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const px = (img: Uint8ClampedArray, w: number, x: number, y: number) => Array.from(img.slice((y * w + x) * 4, (y * w + x) * 4 + 4));
const near = (a: number[], b: number[], d = 2) => a.every((v, i) => Math.abs(v - b[i]!) <= d);

// a 10 by 10 sand square at (5, 5) on a 40 by 40 map
const cells = [];
for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) cells.push({ x, y, defId: 'sand' });
const g = terrainGrid(cells, 40, 40, kind);
const img = chunkPixels(g, 0, 0, looks, { color: GRASS });
const w = chunkSize(g, 0, 0).cw * TERRAIN_PX;
assert.equal(w, 32 * TERRAIN_PX);
assert.ok(near(px(img, w, 10 * TERRAIN_PX, 10 * TERRAIN_PX), [...rgb(SAND), 255]));
assert.ok(near(px(img, w, 25 * TERRAIN_PX, 25 * TERRAIN_PX), [...rgb(GRASS), 255]));
ok('inside a patch is its own color, far away is grass');

// across the border: the color slides from grass to sand, and the halfway mix sits on the tile edge
const row = 10 * TERRAIN_PX + 3;
const line = Array.from({ length: 8 * TERRAIN_PX }, (_, i) => px(img, w, 1 * TERRAIN_PX + i, row)[0]!);
for (let i = 1; i < line.length; i++) assert.ok(line[i]! >= line[i - 1]! - 1, 'rising toward sand');
const mid = (rgb(GRASS)[0]! + rgb(SAND)[0]!) / 2;
const edge = 5 * TERRAIN_PX - 1 * TERRAIN_PX; // index of the first pixel past x = 5
assert.ok(line[edge - 1]! < mid && line[edge]! > mid, 'the halfway mix sits on the tile edge');
const blended = line.filter((v) => v > rgb(GRASS)[0]! + 4 && v < rgb(SAND)[0]! - 4).length;
assert.ok(blended >= TERRAIN_PX * 2 && blended <= TERRAIN_PX * 5, `the blend is a few tiles wide (${blended} px)`);
ok('a straight border is a wide gradient, centered on the tile edge');

// corners are round: at the patch corner the diagonal pixel is less sandy than along an edge
const cornerDiag = px(img, w, 5 * TERRAIN_PX, 5 * TERRAIN_PX)[0]!;
const alongEdge = px(img, w, 5 * TERRAIN_PX, 10 * TERRAIN_PX)[0]!;
assert.ok(cornerDiag < alongEdge - 10, 'the corner is cut round');
ok('outer corners come out round');

// two terrains meet straight: sand on the left half, dirt on the right, no ground anywhere
const halves = [];
for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) halves.push({ x, y, defId: x < 10 ? 'sand' : 'dirt' });
const two = terrainGrid(halves, 20, 20, kind);
const im2 = chunkPixels(two, 0, 0, looks, { color: GRASS });
const w2 = 20 * TERRAIN_PX;
for (let i = 6 * TERRAIN_PX; i < 14 * TERRAIN_PX; i++) {
  const [r, gg] = px(im2, w2, i, 10 * TERRAIN_PX);
  // every pixel across the border is a mix of sand and dirt (grass would pull green up)
  const t = (r! - rgb(DIRT)[0]!) / (rgb(SAND)[0]! - rgb(DIRT)[0]!);
  const expectG = rgb(DIRT)[1]! + t * (rgb(SAND)[1]! - rgb(DIRT)[1]!);
  assert.ok(Math.abs(gg! - expectG) < 4, `pixel ${i} is sand and dirt only`);
}
ok('two terrains blend straight into each other, with no grass halo between them');

// map edges carry their terrain on: a patch on the edge stays full color there
const edgeCells = Array.from({ length: 64 }, (_, i) => ({ x: i % 8, y: Math.floor(i / 8), defId: 'dirt' }));
const im3 = chunkPixels(terrainGrid(edgeCells, 16, 16, kind), 0, 0, looks, { color: GRASS });
assert.ok(near(px(im3, 16 * TERRAIN_PX, 0, 0), [...rgb(DIRT), 255], 3));
ok('a patch at the map edge keeps its color right to the edge');

// specks: flowery grass has a few, stays fixed, and grass has none
const flowers = terrainGrid(Array.from({ length: 64 }, (_, i) => ({ x: i % 8, y: Math.floor(i / 8), defId: 'flowers' })), 16, 16, kind);
const f1 = chunkPixels(flowers, 0, 0, looks, { color: GRASS }), f2 = chunkPixels(flowers, 0, 0, looks, { color: GRASS });
assert.deepEqual(f1, f2);
let specks = 0;
for (let y = 1; y < 7 * TERRAIN_PX; y++) for (let x = 1; x < 7 * TERRAIN_PX; x++) if (px(f1, 16 * TERRAIN_PX, x, y)[0] === 255) specks++;
assert.ok(specks > 40 && specks < 400, `specks ${specks}`);
let grassSpecks = 0;
for (let y = 12 * TERRAIN_PX; y < 16 * TERRAIN_PX; y++) for (let x = 12 * TERRAIN_PX; x < 16 * TERRAIN_PX; x++) if (px(f1, 16 * TERRAIN_PX, x, y)[0] === 255) grassSpecks++;
assert.equal(grassSpecks, 0);
ok('flowery grass is speckled the same every time, and plain grass is not');

// how prominent a tile is depends on what surrounds it: a lone tile, the middle of a 3 by 3 patch and
// the middle of a 9 by 9 patch reach more and more of their color
const sandiness = (n: number) => {
  const cs = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) cs.push({ x: 10 + x - Math.floor(n / 2), y: 10 + y - Math.floor(n / 2), defId: 'sand' });
  const im = chunkPixels(terrainGrid(cs, 24, 24, kind), 0, 0, looks, { color: GRASS });
  const c = 10 * TERRAIN_PX + TERRAIN_PX / 2;
  return (px(im, 24 * TERRAIN_PX, c, c)[0]! - rgb(GRASS)[0]!) / (rgb(SAND)[0]! - rgb(GRASS)[0]!);
};
const [one, three, nine] = [sandiness(1), sandiness(3), sandiness(9)];
assert.ok(one < 0.5 && one < three - 0.3 && three < nine && nine > 0.98, `${one.toFixed(2)} ${three.toFixed(2)} ${nine.toFixed(2)}`);
ok(`a tile shows more of its color the more it is surrounded by its own: lone ${one.toFixed(2)}, 3 by 3 ${three.toFixed(2)}, 9 by 9 ${nine.toFixed(2)}`);

// the map's ground can be any terrain, specks included
const onFlowers = chunkPixels(terrainGrid([], 16, 16, kind), 0, 0, looks, { color: 0x4a8a46, specks: [0xffffff] });
let groundSpecks = 0;
for (let i = 0; i < onFlowers.length; i += 4) if (onFlowers[i] === 255) groundSpecks++;
assert.ok(groundSpecks > 100, `${groundSpecks}`);
ok('a map whose ground is flowery grass is speckled everywhere');

// chunks: clipped at the map, and the helpers find terrain and changes
const big = terrainGrid([{ x: 70, y: 3, defId: 'sand' }], 80, 40, kind);
assert.deepEqual(chunkSize(big, 2, 1), { cw: 80 - 2 * CHUNK, ch: 40 - CHUNK });
assert.equal(chunkPixels(big, 2, 1, looks, { color: GRASS }).length, (80 - 64) * TERRAIN_PX * (40 - 32) * TERRAIN_PX * 4);
assert.ok(anyTerrain(big, 64, 0, 96, 32) && !anyTerrain(big, 0, 0, 64, 32));
const moved = terrainGrid([{ x: 71, y: 3, defId: 'sand' }], 80, 40, kind);
assert.ok(differs(big, moved, 64, 0, 96, 32) && !differs(big, moved, 0, 0, 64, 40));
ok('chunks are clipped to the map, and empty or unchanged chunks are found');

// speed: a full chunk of mixed borders draws quickly
const busy = terrainGrid(Array.from({ length: 32 * 32 }, (_, i) => ({ x: i % 32, y: Math.floor(i / 32), defId: ['sand', 'dirt', 'flowers'][(i * 7 + Math.floor(i / 32)) % 3]! })), 32, 32, kind);
const t0 = performance.now(); chunkPixels(busy, 0, 0, looks, { color: GRASS }); const ms = performance.now() - t0;
assert.ok(ms < 400, `${ms.toFixed(0)} ms`);
ok(`a chunk where every tile is a border draws in ${ms.toFixed(0)} ms`);
