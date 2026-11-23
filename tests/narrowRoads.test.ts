// Narrow roads (2 across, edge lines only), dirt roads, and the 3-wide roads renamed medium (#31)
import { strict as assert } from 'node:assert';
import { CATALOG, CATEGORIES, type Mark, getObjectDef, itemsIn, marksOf, occupiedCells } from '../src/catalog.ts';
import { arrowLook } from '../src/arrows.ts';
import { canPlaceObject } from '../src/world.ts';
import { type History, type HistoryAction, initialHistory, step } from '../src/history.ts';
const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
const pt = (x: number, y: number) => ({ cell: { x: Math.floor(x), y: Math.floor(y) }, point: { x, y } });
const click = (x: number, y: number): HistoryAction[] => [{ type: 'hover', ...pt(x, y) }, { type: 'press', ...pt(x, y) }, { type: 'release' }];
const drag = (a: [number, number], b: [number, number]): HistoryAction[] =>
  [{ type: 'hover', ...pt(...a) }, { type: 'press', ...pt(...a) }, { type: 'hover', ...pt(...b) }, { type: 'release' }];
const turns = (n: number): HistoryAction[] => Array.from({ length: n }, () => ({ type: 'rotate', dir: 1 }));
const put = (id: string, x: number, y: number, r = 0): HistoryAction[] => [{ type: 'select', id }, ...turns(r), ...click(x, y), ...turns((4 - r) % 4)];
const ids = (h: History, id: string) => h.state.objects.filter((o) => o.defId === id);
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

const NARROW_ROADS = ['small-straight', 'small-dashed', 'small-dashed2', 'small-sharp', 'small-gentle', 'small-t', 'small-cross', 'small-end',
  'small-t-wide', 'small-t-wide-half', 'small-t-medium', 'medium-t-small', 'small-cross-medium', 'small-taper', 'small-turn-right', 'small-turn-left'];
const DIRT_ROADS = ['dirt-straight', 'dirt-sharp', 'dirt-gentle', 'dirt-t', 'dirt-cross', 'dirt-end', 'dirt-paved'];
const WHITE = 0xf1f5f9, ASPHALT = 0x44444c, TRACK = 0xa06f30, STRIP = 0x6b8f4a, DIRT = 0xb58139;

// ===== Names and tabs (#31, regrouped in #31b) =====
const flooring = CATEGORIES.find((c) => c.id === 'flooring')!;
assert.deepEqual(flooring.groups.map((g) => g.name),
  ['Floors', 'Paths', 'Wide roads', 'Medium roads', 'Narrow roads', 'Dirt roads', 'Bus bay', 'Markings', 'Courts', 'Water']);
// wide roads have no links; medium roads carry their links to wide, narrow roads theirs to medium and wide
assert.deepEqual(itemsIn('roads').map((i) => i.name),
  ['Straight road', '1 side dashed', '2 sides dashed', 'Sharp curve', 'Gentle curve', 'T-junction', 'Crossroads', 'Road end']);
assert.deepEqual(itemsIn('narrow').map((i) => i.name),
  ['Medium road', 'Medium, 1 dashed', 'Medium, 2 dashed', 'Medium bend', 'Medium curve', 'Medium T', 'Medium cross', 'Medium end',
    'Medium T wide', 'Wide T medium', 'Medium crossing', 'Wide to medium', 'Right to medium', 'Left to medium']);
assert.deepEqual(itemsIn('small').map((i) => i.id), NARROW_ROADS);
assert.deepEqual(itemsIn('small').map((i) => i.name),
  ['Narrow road', 'Narrow, 1 dashed', 'Narrow, 2 dashed', 'Narrow bend', 'Narrow curve', 'Narrow T', 'Narrow cross', 'Narrow end',
    'Narrow T wide', 'Narrow T 1 side', 'Narrow T medium', 'Medium T narrow', 'Narrow crossing', 'Medium to narrow', 'Right to narrow', 'Left to narrow']);
assert.deepEqual(itemsIn('dirtroad').map((i) => i.id), DIRT_ROADS);
assert.deepEqual(itemsIn('busbay').map((i) => i.name), ['Bus bay opening', 'Bus bay middle', 'Bus bay closing']);
assert.ok(itemsIn('markings').some((i) => i.id === 'bus-box'));
assert.equal(getObjectDef('crosswalk-narrow').name, 'Medium crosswalk');
// no two items share a name
const names = CATALOG.filter((i) => !i.id.includes(':')).map((i) => i.name); // spanning pieces share their item's name
assert.equal(new Set(names).size, names.length);
ok('Wide, Medium, Narrow and Dirt roads tabs (links with the narrower road), a Bus bay tab, the Bus stop box in Markings');

// ===== Shapes =====
for (const id of [...NARROW_ROADS, ...DIRT_ROADS, 'bus-box']) {
  const def = getObjectDef(id);
  assert.equal(def.layer, id === 'bus-box' ? 'marking' : 'road', id);
  for (const r of [0, 1, 2, 3] as const) {
    const [W, H] = r % 2 ? [def.h, def.w] : [def.w, def.h];
    marksOf(def, r).forEach((m) => m.pts.forEach(([x, y]) => assert.ok(x >= -1e-9 && y >= -1e-9 && x <= W + 1e-9 && y <= H + 1e-9, `${id} r${r}`)));
  }
}
assert.deepEqual([getObjectDef('small-straight').h, getObjectDef('dirt-straight').h], [2, 2]);
ok('every narrow and dirt road piece, link and the Bus stop box lies in its footprint in every facing');

// a point inside a mark (even-odd), and the marks of a color covering a point
const inside = (m: Mark, x: number, y: number) => {
  let c = false;
  for (let i = 0, j = m.pts.length - 1; i < m.pts.length; j = i++) {
    const [xi, yi] = m.pts[i]!; const [xj, yj] = m.pts[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
// the color drawn on top at a point (the last mark covering it)
const colorAt = (id: string, x: number, y: number) => [...getObjectDef(id).marks!].reverse().find((m) => inside(m, x, y))?.color;

// a narrow road: asphalt with an edge line each side, nothing in the middle
const straight = getObjectDef('small-straight').marks!;
assert.equal(straight.filter((m) => m.color === WHITE).length, 2);
for (const y of [0.22, 1.78]) assert.equal(colorAt('small-straight', 0.5, y), WHITE);
for (const y of [0.1, 0.5, 1, 1.5, 1.9]) assert.equal(colorAt('small-straight', 0.5, y), ASPHALT);
// the pieces that meet it end to end carry its edge lines at its edge: the paved end of Dirt to paved,
// the narrow side of Medium to narrow (and its medium side carries the medium road's)
for (const y of [0.22, 1.78]) {
  assert.equal(colorAt('dirt-paved', 0.98, y), WHITE, `dirt to paved ${y}`);
  assert.equal(colorAt('small-taper', 1.98, y), WHITE, `narrowing ${y}`);
}
for (const y of [0.22, 2.78]) assert.equal(colorAt('small-taper', 0.02, y), WHITE);
for (const y of [0.22, 2.78]) assert.equal(colorAt('narrow-straight', 0.5, y), WHITE);
ok('narrow roads have edge lines only, and Dirt to paved and Medium to narrow meet them line to line');

// dashed narrow straights dash one or both edge lines, like the other widths
assert.equal(colorAt('small-dashed', 0.1, 1.78), ASPHALT, 'the +y line is dashed');
assert.equal(colorAt('small-dashed', 0.5, 1.78), WHITE);
assert.equal(colorAt('small-dashed', 0.1, 0.22), WHITE, 'the other side stays solid');
assert.equal(colorAt('small-dashed2', 0.1, 0.22), ASPHALT);
// a narrow T into the side of a wide road opens it whole; the one-side T keeps the far lane line and the
// middle row's two solid lines running through, and only the near lane line stops
for (const y of [1, 2, 3, 4]) assert.equal(colorAt('small-t-wide', 1, y), ASPHALT, `full T ${y}`);
assert.equal(colorAt('small-t-wide-half', 0.5, 1), WHITE);
assert.equal(colorAt('small-t-wide-half', 1.5, 1), WHITE);
for (const x of [0.02, 1, 1.98]) for (const y of [2, 3]) assert.equal(colorAt('small-t-wide-half', x, y), WHITE, `one side ${x} ${y}`);
assert.equal(colorAt('small-t-wide-half', 0.5, 4), ASPHALT);
// the turns down to narrow come out with a narrow road's edge lines and no center line
for (const id of ['small-turn-right']) {
  for (const x of [0.22, 1.78]) assert.equal(colorAt(id, x, 2.98), WHITE, `${id} exit ${x}`);
  assert.equal(colorAt(id, 1, 2.98), ASPHALT, `${id} exit middle`);
  for (const y of [0.22, 2.78]) assert.equal(colorAt(id, 0.02, y), WHITE, `${id} entry ${y}`);
}
for (const x of [0.22, 1.78]) assert.equal(colorAt('small-turn-left', x, 0.02), WHITE, `left exit ${x}`);
ok('dashed narrow roads, the full and one-side Narrow T wide, and turns down to narrow carry the right lines');

// dirt roads: tracks and grassy strip line up across every open side of every dirt piece
const across = { track: [0.5, 1.5], strip: [1] };
const sideCheck = (id: string, side: 'w' | 'e' | 'n' | 's') => {
  const { w, h } = getObjectDef(id);
  const at = (u: number): [number, number] =>
    side === 'w' ? [0.02, u] : side === 'e' ? [w - 0.02, u] : side === 'n' ? [u, 0.02] : [u, h - 0.02];
  for (const u of across.track) assert.equal(colorAt(id, ...at(u)), TRACK, `${id} ${side} track ${u}`);
  for (const u of across.strip) assert.equal(colorAt(id, ...at(u)), STRIP, `${id} ${side} strip`);
  for (const u of [0.1, 1.9]) assert.equal(colorAt(id, ...at(u)), DIRT, `${id} ${side} earth ${u}`);
};
sideCheck('dirt-straight', 'w'); sideCheck('dirt-straight', 'e');
for (const s of ['w', 'e', 's'] as const) sideCheck('dirt-t', s);
for (const s of ['w', 'e', 'n', 's'] as const) sideCheck('dirt-cross', s);
sideCheck('dirt-end', 'w'); sideCheck('dirt-paved', 'w');
// a T's closed side is plain earth at its edge, its far track running straight along it
assert.equal(colorAt('dirt-t', 1, 0.05), DIRT);
assert.equal(colorAt('dirt-t', 1, 0.5), TRACK);
// in a junction the tracks turn round the corners: a point on the near arc's middle is track
assert.equal(colorAt('dirt-t', 0.5 * Math.SQRT1_2, 2 - 0.5 * Math.SQRT1_2), TRACK);
assert.equal(colorAt('dirt-cross', 2 - 1.5 * Math.SQRT1_2, 1.5 * Math.SQRT1_2), TRACK);
// and the grassy strip stops short of the middle
assert.equal(colorAt('dirt-cross', 1, 1) === STRIP, false);
ok('dirt pieces join track to track and strip to strip; junction tracks curve round their corners');

// ===== The dirt color stands apart from every tile and terrain =====
const lab = (c: number) => {
  const f = (u: number) => (u > 0.04045 ? ((u + 0.055) / 1.055) ** 2.4 : u / 12.92);
  const [r, g, b] = [16, 8, 0].map((s) => f(((c >> s) & 255) / 255)) as [number, number, number];
  const h = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [x, y, z] = [(r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, r * 0.2126 + g * 0.7152 + b * 0.0722, (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883];
  return [116 * h(y) - 16, 500 * (h(x) - h(y)), 200 * (h(y) - h(z))];
};
const dist = (a: number, b: number) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]!));
const grounds = CATALOG.filter((i) => i.kind === 'tile' || i.kind === 'terrain').map((i) => [i.id, (i as { color: number }).color] as const);
const nearest = Math.min(...grounds.map(([, c]) => dist(DIRT, c)));
assert.ok(nearest > 18, `nearest ${nearest}`);
assert.ok(dist(DIRT, 0x9a7b4f) > 18 && dist(DIRT, 0x7a5536) > 18, 'apart from the Dirt path and the Dirt terrain');
ok(`the dirt road's ochre is at least ${nearest.toFixed(1)} from every floor, path and terrain`);

// ===== Building =====
// straights drag in a run; a narrow T dropped on the road replaces the straights under it and lines up
let h = run(initialHistory, { type: 'select', id: 'small-straight' }, ...drag([10.5, 12.5], [20.5, 12.5]));
assert.equal(ids(h, 'small-straight').length, 11);
assert.ok(ids(h, 'small-straight').every((o) => o.y === 12 && o.h === 2));
assert.equal(h.past.length, 1);
h = run(h, ...put('small-cross', 15.5, 13.5));
const cross = ids(h, 'small-cross')[0]!;
assert.deepEqual([cross.x, cross.y], [15, 12], 'snapped onto the road');
assert.equal(ids(h, 'small-straight').length, 9);
// dirt to paved at the road's end, and dirt straights dragged on from it
h = run(h, ...put('dirt-paved', 9.5, 12.5, 2), { type: 'select', id: 'dirt-straight' }, ...drag([8.5, 12.5], [4.5, 12.5]));
assert.deepEqual([ids(h, 'dirt-paved')[0]!.x, ids(h, 'dirt-paved')[0]!.y], [9, 12]);
assert.equal(ids(h, 'dirt-straight').length, 5);
// a dirt T replaces dirt straights the same way
h = run(h, ...put('dirt-t', 6.5, 13.5));
assert.deepEqual([ids(h, 'dirt-t')[0]!.x, ids(h, 'dirt-t')[0]!.y], [6, 12]);
assert.equal(ids(h, 'dirt-straight').length, 3);
ok('narrow and dirt straights drag in runs; junctions and Dirt to paved snap onto them, replacing straights');

// a narrow road joins a medium one through T into medium, which snaps onto the medium road
h = run(initialHistory, { type: 'select', id: 'narrow-straight' }, ...drag([10.5, 31.5], [20.5, 31.5]), ...put('small-t-medium', 15.5, 32.5));
const t = ids(h, 'small-t-medium')[0]!;
assert.deepEqual([t.x, t.y, t.w, t.h], [15, 30, 2, 3]);
assert.equal(ids(h, 'narrow-straight').length, 9);
// Narrowing to narrow snaps onto the medium road too
h = run(h, ...put('small-taper', 20.5, 31.5));
assert.deepEqual([ids(h, 'small-taper')[0]!.y], [30]);
ok('T into medium and Medium to narrow snap onto a medium road');

// cells: a narrow curve stands only on its road
const cellsOf = (id: string) => { const d = getObjectDef(id); return occupiedCells({ defId: id, rotation: 0, x: 0, y: 0, w: d.w, h: d.h }); };
const has = (cs: readonly { x: number; y: number }[], x: number, y: number) => cs.some((c) => c.x === x && c.y === y);
for (const id of ['small-gentle', 'dirt-gentle']) {
  const cs = cellsOf(id);
  assert.ok(has(cs, 0, 0) && has(cs, 4, 4) && !has(cs, 0, 4), id);
}
// arrows on a narrow road slide to the middle of their lane at the wide size; on dirt they would keep
// the off-road look (they cannot be placed there, see below)
const narrowRun = [0, 1, 2].map((k) => ({ defId: 'small-straight', rotation: 0 as const, x: 10 + k, y: 10, w: 1, h: 2 }));
const look0 = arrowLook({ defId: 'arrow-straight', rotation: 0, x: 10, y: 10, w: 3, h: 1 }, narrowRun);
const look1 = arrowLook({ defId: 'arrow-straight', rotation: 0, x: 10, y: 11, w: 3, h: 1 }, narrowRun);
assert.equal(look0.paint, 'narrow');
assert.ok(Math.abs(look0.shift - 0.11) < 1e-9 && Math.abs(look1.shift + 0.11) < 1e-9, `${look0.shift} ${look1.shift}`);
const dirtRun = [0, 1, 2].map((k) => ({ defId: 'dirt-straight', rotation: 0 as const, x: 10 + k, y: 10, w: 1, h: 2 }));
assert.deepEqual(arrowLook({ defId: 'arrow-straight', rotation: 0, x: 10, y: 10, w: 3, h: 1 }, dirtRun), { paint: 'off', shift: 0 });
ok('narrow and dirt curves stand only on their road; arrows sit mid-lane on narrow roads');

// ===== Arrows are blocked on dirt roads; they go on narrow ones =====
let a = run(initialHistory, { type: 'select', id: 'dirt-straight' }, ...drag([10.5, 20.9], [20.5, 20.9]),
  { type: 'select', id: 'small-straight' }, ...drag([10.5, 30.9], [20.5, 30.9]));
assert.ok(ids(a, 'dirt-straight').every((o) => o.y === 20) && ids(a, 'small-straight').every((o) => o.y === 30));
const before = a.state.objects.length;
a = run(a, ...put('arrow-straight', 14.5, 20.5), ...put('arrow-left', 14.5, 21.5), ...put('arrow-right', 21.5, 20.5));
assert.equal(a.state.objects.length, before, 'no arrow on dirt, not even half on it');
a = run(a, ...put('arrow-straight', 14.5, 30.5), ...put('arrow-straight', 14.5, 31.5, 2));
assert.equal(ids(a, 'arrow-straight').length, 2, 'both lanes of a narrow road take arrows');
// the rule sits in the fit check every placement uses (build, moving, paste, blueprints)
assert.equal(canPlaceObject(a.state, { defId: 'arrow-right', rotation: 0, x: 15, y: 21, w: 3, h: 1 }), false);
assert.equal(canPlaceObject(a.state, { defId: 'arrow-right', rotation: 0, x: 15, y: 23, w: 3, h: 1 }), true, 'off the dirt it fits');
ok('arrows cannot be placed on any dirt road piece, and go in both lanes of a narrow road');

// ===== The Bus stop box fits inside a bus bay's lane =====
const busMarks = getObjectDef('bus-box').marks!.flatMap((m) => m.pts);
assert.ok(busMarks.every(([x, y]) => x >= 0.1 && x <= 2.9 && y >= 0.2 && y <= 1.6), 'inside the bay lane (0 to 1.74 across)');
assert.ok(getObjectDef('bus-box').marks!.every((m) => m.color === 0xfacc15));
let bay = run(initialHistory, { type: 'select', id: 'bay-middle' }, ...drag([10.5, 10.9], [16.5, 10.9]), ...put('bus-box', 13.5, 10.9));
assert.equal(ids(bay, 'bus-box').length, 1);
assert.deepEqual([ids(bay, 'bus-box')[0]!.y, ids(bay, 'bay-middle')[0]!.y], [10, 10]);
bay = run(bay, { type: 'undo' } as HistoryAction);
assert.equal(ids(bay, 'bus-box').length, 0);
ok('the Bus stop box is yellow paint that sits inside the bay lane, placed on bay middles');
