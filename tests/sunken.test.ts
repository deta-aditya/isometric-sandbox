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

// ===== Canal outlets and inlets (#17c) =====
{
  const { initialHistory, step } = await import('../src/history.ts');
  const { culvertFits, culvertRun, emptyWorld, eraseTarget } = await import('../src/world.ts');
  const { toView, fromView } = await import('../src/view.ts');
  const { encodeGame, decodeGame } = await import('../src/saveStore.ts');
  type A = Parameters<typeof step>[1];
  const run = (h: ReturnType<typeof step>, ...a: A[]) => a.reduce(step, h);
  const pt = (x: number, y: number) => ({ cell: { x: Math.floor(x), y: Math.floor(y) }, point: { x, y } });
  const drag = (a: [number, number], b: [number, number]): A[] => [{ type: 'hover', ...pt(...a) }, { type: 'press', ...pt(...a) }, { type: 'hover', ...pt(...b) }, { type: 'release' }];
  // a canal (x 4..7) meeting a stream (x 8..10), rows 5..7; the edge between them is x = 8
  let h = step(initialHistory, { type: 'replaceWorld', world: emptyWorld(sizeOf(20, 20)) });
  h = run(h, { type: 'select', id: 'canal' }, ...[5, 6, 7].flatMap((y) => drag([4.5, y + 0.5], [7.5, y + 0.5])));
  h = run(h, { type: 'select', id: 'stream' }, ...[5, 6, 7].flatMap((y) => drag([8.5, y + 0.5], [10.5, y + 0.5])));
  const s0 = h.state;
  const joint = { axis: 'y' as const, x: 8, y: 6 };
  assert.ok(culvertFits(s0, { ...joint, kind: 'outlet' }) && culvertFits(s0, { ...joint, kind: 'inlet' }));
  assert.ok(!culvertFits(s0, joint), 'a plain culvert needs land on one side');
  assert.ok(!culvertFits(s0, { axis: 'y', x: 4, y: 6, kind: 'outlet' }), 'an outlet needs a stream on the other side');
  ok('an outlet or inlet fits only where a canal meets a stream, and a plain culvert does not fit there');

  h = run(h, { type: 'select', id: 'canal-outlet' }, ...drag([8, 5.2], [8, 7.8]), { type: 'cancel' });
  assert.equal(h.state.culverts.length, 3);
  assert.ok(h.state.culverts.every((c) => c.kind === 'outlet'));
  // a plain culvert on the canal's north bank next to it is its own run
  h = run(h, { type: 'select', id: 'culvert' }, ...drag([5.2, 5], [7.8, 5]), { type: 'cancel' });
  assert.equal(culvertRun(h.state, joint).length, 3);
  assert.equal(culvertRun(h.state, { axis: 'x', x: 6, y: 5 }).length, 3);
  ok('dragging an outlet places a run of outlet edges, and a culvert run beside it stays separate');

  [1, 2, 3].forEach((v) => {
    const seen = toView({ ...h.state, view: v as 1 });
    assert.equal(seen.culverts.filter((c) => c.kind === 'outlet').length, 3, `view ${v}`);
    assert.equal(fromView(seen).culverts, h.state.culverts);
  });
  ok('outlets keep their kind through camera turns');

  const back = decodeGame(encodeGame({ ...emptyWorld(sizeOf(20, 20)), tiles: h.state.tiles, culverts: h.state.culverts }))!.world;
  assert.deepEqual(back.culverts.map((c) => c.kind ?? 'culvert').sort(), ['culvert', 'culvert', 'culvert', 'outlet', 'outlet', 'outlet']);
  const odd = JSON.parse(encodeGame({ ...emptyWorld(sizeOf(20, 20)), culverts: [{ axis: 'x', x: 3, y: 3 }] }));
  odd.culverts[0].kind = 'teleporter';
  assert.equal(decodeGame(JSON.stringify(odd))!.world.culverts[0]!.kind, undefined);
  ok('saves keep outlets and inlets; an unknown kind reads as a plain culvert');

  const picked = eraseTarget({ ...h.state, tool: 'picker' }, { x: 8, y: 6 }, { x: 8.02, y: 6.5 });
  assert.equal(picked?.kind, 'culvert');
  assert.equal((picked as { target: { kind?: string } }).target.kind, 'outlet');
  ok('pointing at an outlet picks it');
}

// the stream is flattened against stonework: along a pinned bank the water starts right at the stone, in
// a straight line, where a natural bank wanders and slopes
{
  const strip = []; for (let x = 0; x < 16; x++) for (let y = 6; y < 8; y++) strip.push({ x, y });
  const W2 = 16 * TERRAIN_PX;
  const starts = (pins: { x: number; y: number; side: 'north' }[]) => {
    const img = chunkPixels(terrainGrid([], 16, 16, () => GROUND_KIND, strip, pins), 0, 0, [], { color: GRASS });
    return [6.5, 7.5, 8.5].map((cx) => {
      const col = Math.round(cx * TERRAIN_PX);
      for (let y = 4 * TERRAIN_PX; y < 9 * TERRAIN_PX; y++) { const i = (y * W2 + col) * 4; if (img[i + 2]! > img[i]! + 40) return y / TERRAIN_PX; }
      return -1;
    });
  };
  const natural = starts([]), pinned = starts([6, 7, 8, 9].map((x) => ({ x, y: 6, side: 'north' as const })));
  assert.ok(pinned.every((v) => Math.abs(v - 6) < 0.13), `pinned ${pinned}`);
  assert.ok(Math.max(...natural) - Math.min(...natural) > Math.max(...pinned) - Math.min(...pinned), `natural ${natural}`);
  ok(`next to a culvert or outlet the water reaches straight up to the stone (starts at ${pinned.map((v) => v.toFixed(2)).join(', ')}; a natural bank wanders: ${natural.map((v) => v.toFixed(2)).join(', ')})`);
}
