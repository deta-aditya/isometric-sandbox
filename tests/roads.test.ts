import { strict as assert } from 'node:assert';
import { getObjectDef, marksOf, occupiedCells } from '../src/catalog.ts';
import { type History, type HistoryAction, initialHistory, step } from '../src/history.ts';
import { objectAt } from '../src/world.ts';
const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
const pt = (x: number, y: number) => ({ cell: { x: Math.floor(x), y: Math.floor(y) }, point: { x, y } });
const click = (x: number, y: number): HistoryAction[] =>
  [{ type: 'hover', ...pt(x, y) }, { type: 'press', ...pt(x, y) }, { type: 'release' }];
const drag = (...path: [number, number][]): HistoryAction[] =>
  [{ type: 'hover', ...pt(...path[0]!) }, { type: 'press', ...pt(...path[0]!) }, ...path.slice(1).map((p): HistoryAction => ({ type: 'hover', ...pt(...p) })), { type: 'release' }];
const turns = (n: number): HistoryAction[] => Array.from({ length: n }, () => ({ type: 'rotate', dir: 1 }));
// put a piece with the pointer at (x, y) (flat pieces center on it), facing r, then face back
const put = (id: string, x: number, y: number, r = 0): HistoryAction[] => [{ type: 'select', id }, ...turns(r), ...click(x, y), ...turns((4 - r) % 4)];
const cellsOf = (id: string, r: 0 | 1 | 2 | 3 = 0) => {
  const d = getObjectDef(id);
  const [w, h] = r % 2 ? [d.h, d.w] : [d.w, d.h];
  return occupiedCells({ defId: id, rotation: r, x: 0, y: 0, w, h });
};
const has = (cells: readonly { x: number; y: number }[], x: number, y: number) => cells.some((c) => c.x === x && c.y === y);
const ids = (h: History, id: string) => h.state.objects.filter((o) => o.defId === id);
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

const PIECES = ['wide-straight', 'wide-dashed', 'wide-dashed2', 'wide-sharp', 'wide-gentle', 'wide-t', 'wide-cross', 'wide-end',
  'narrow-straight', 'narrow-dashed', 'narrow-dashed2', 'narrow-sharp', 'narrow-gentle', 'narrow-t', 'narrow-cross', 'narrow-end',
  'link-narrow-t', 'link-wide-t', 'link-cross', 'link-taper', 'link-turn-right', 'link-turn-left', 'bay-start', 'bay-middle', 'bay-end',
  'crosswalk', 'crosswalk-narrow', 'arrow-straight', 'arrow-left', 'arrow-right', 'car-bay', 'loading-bay'];
for (const id of PIECES) {
  const def = getObjectDef(id);
  for (const r of [0, 1, 2, 3] as const) {
    const [W, H] = r % 2 ? [def.h, def.w] : [def.w, def.h];
    marksOf(def, r).forEach((m) => m.pts.forEach(([x, y]) => assert.ok(x >= -1e-9 && y >= -1e-9 && x <= W + 1e-9 && y <= H + 1e-9, `${id} r${r}`)));
  }
}
assert.deepEqual([getObjectDef('wide-straight').h, getObjectDef('narrow-straight').h], [5, 3]);
assert.deepEqual([getObjectDef('arrow-straight').w, getObjectDef('arrow-straight').h], [3, 1]);
assert.deepEqual([getObjectDef('crosswalk').w, getObjectDef('crosswalk').h, getObjectDef('crosswalk-narrow').h], [1, 5, 3]);
// arrows keep space around them inside their own row
for (const id of ['arrow-straight', 'arrow-left', 'arrow-right']) {
  getObjectDef(id).marks!.forEach((m) => m.pts.forEach(([x, y]) => assert.ok(x >= 0.4 && x <= 2.6 && y >= 0.1 && y <= 0.9, id)));
}
ok('every mark stays in its footprint; wide 5, narrow 3, arrows 3x1 with room, crosswalks 1 deep');

// curves and narrowing pieces stand only on their road
const gentle = cellsOf('wide-gentle');
assert.ok(has(gentle, 0, 0) && has(gentle, 8, 8) && !has(gentle, 0, 8) && !has(gentle, 8, 0));
assert.ok(!has(cellsOf('wide-gentle', 1), 0, 0));
const right = cellsOf('link-turn-right');
const left = cellsOf('link-turn-left');
assert.ok(has(right, 2, 4) && !has(right, 2, 0) && has(left, 2, 0) && !has(left, 2, 4));
ok('curves and narrowing turns stand only on their road');

// flat pieces center on the pointer: a wide straight pointed at row 12 spans rows 10 to 14
let h = run(initialHistory, ...put('wide-straight', 10.5, 12.5));
assert.deepEqual([h.state.objects[0]?.x, h.state.objects[0]?.y], [10, 10]);
h = run(h, ...put('wide-straight', 10.5, 13.5));
assert.equal(h.state.objects.length, 1, 'no road on a road');
h = run(h, ...put('oak', 10.5, 13.5), ...put('arrow-straight', 10.5, 10.5), ...put('crosswalk', 10.5, 12.5));
assert.equal(h.state.objects.length, 3, 'a tree and an arrow, but no crosswalk over the arrow');
assert.deepEqual([ids(h, 'arrow-straight')[0]?.x, ids(h, 'arrow-straight')[0]?.y], [9, 10]);
assert.equal(objectAt(h.state, { x: 10, y: 13 })?.defId, 'oak');
assert.equal(objectAt(h.state, { x: 10, y: 11 })?.defId, 'wide-straight');
ok('flat pieces center on the pointer; roads, markings and standing things keep their layers');

// dragging a straight lays a run in the row it started, however the pointer wobbles; one undo step
h = run(initialHistory, { type: 'select', id: 'wide-straight' }, ...drag([30.5, 40.5], [32.5, 41.7], [34.5, 39.2], [36.5, 40.9]));
assert.equal(ids(h, 'wide-straight').length, 7);
assert.ok(ids(h, 'wide-straight').every((o) => o.y === 38));
assert.equal(run(h, { type: 'undo' } as HistoryAction).state.objects.length, 0);
// turned, it runs along y; a drag back over laid road skips it
h = run(h, ...turns(1), ...drag([20.5, 10.5], [21.7, 14.5], [20.5, 12.5]), ...turns(3));
assert.equal(ids(h, 'wide-straight').length, 7 + 5);
assert.ok(ids(h, 'wide-straight').slice(7).every((o) => o.x === 18));
ok('a drag lays a straight run in its starting row, along the road, in one undo step');

// a median drags down the middle row, crosswalks run under it, and the median is picked first
h = run(initialHistory, { type: 'select', id: 'wide-straight' }, ...drag([20.5, 22.5], [27.5, 22.5]),
  ...put('crosswalk', 23.5, 22.5), { type: 'select', id: 'median' }, ...drag([20.5, 22.5], [27.5, 22.5]));
assert.equal(ids(h, 'median').length, 8, 'the median runs over the crosswalk too');
assert.equal(objectAt(h.state, { x: 23, y: 22 })?.defId, 'median');
assert.equal(objectAt(h.state, { x: 23, y: 20 })?.defId, 'crosswalk');
h = run(h, ...put('oak', 21.5, 22.5));
assert.equal(objectAt(h.state, { x: 21, y: 22 })?.defId, 'oak');
ok('a median crosses a crosswalk, is picked before it, and takes trees');

// a bus bay beside a dashed-side road, its middle dragged
h = run(initialHistory, { type: 'select', id: 'wide-dashed' }, ...drag([10.5, 12.5], [21.5, 12.5]),
  ...put('bay-start', 11.5, 15.5), { type: 'select', id: 'bay-middle' }, ...drag([14.5, 15.5], [16.5, 15.5]), ...put('bay-end', 18.5, 15.5));
assert.equal(h.state.objects.length, 12 + 1 + 3 + 1);
ok('a bus bay of opening, dragged middles and closing beside a dashed-side road');

// the bulldoze clears a road piece
h = run(initialHistory, ...put('narrow-straight', 5.5, 5.5), { type: 'toggleBulldoze' }, ...click(5.5, 5.5));
assert.equal(h.state.objects.length, 0);
ok('the bulldoze removes a road piece');

// a crossroads dropped on a straight road replaces the straights under it and lines up with the road,
// even pointed a row off center; arrows on the replaced road go, others stay; one undo step
h = run(initialHistory, { type: 'select', id: 'wide-straight' }, ...drag([10.5, 12.5], [20.5, 12.5]),
  ...put('arrow-straight', 15.5, 10.5), ...put('arrow-straight', 11.5, 13.5));
assert.equal(h.state.objects.length, 13);
const before = h;
h = run(h, ...put('wide-cross', 15.5, 13.5));
const cross = ids(h, 'wide-cross')[0]!;
assert.deepEqual([cross.x, cross.y], [13, 10], 'snapped onto the road');
assert.equal(ids(h, 'wide-straight').length, 6);
assert.equal(ids(h, 'arrow-straight').length, 1, 'the arrow in the junction went, the other stayed');
assert.equal(run(h, { type: 'undo' } as HistoryAction).state.objects, before.state.objects);
ok('a crossroads replaces the straights under it, snaps to the road, and clears paint inside it');

// a dragged dashed run replaces straights but leaves the junction alone
h = run(h, { type: 'select', id: 'wide-dashed' }, ...drag([10.5, 12.5], [20.5, 12.5]));
assert.equal(ids(h, 'wide-cross').length, 1);
assert.equal(ids(h, 'wide-dashed').length, 6);
assert.equal(ids(h, 'wide-straight').length, 0);
// laying the same piece where it is changes nothing
assert.equal(run(h, ...put('wide-dashed', 10.5, 12.5)).state.objects, h.state.objects);
ok('a dragged run swaps straights, skips junctions, and the same piece twice changes nothing');

// links snap to the road they join: a wide T onto a narrow road, a narrowing piece onto a narrow road
h = run(initialHistory, { type: 'select', id: 'narrow-straight' }, ...drag([10.5, 31.5], [20.5, 31.5]),
  ...put('link-wide-t', 15.5, 32.5));
const t = ids(h, 'link-wide-t')[0]!;
assert.deepEqual([t.x, t.y], [13, 30]);
assert.equal(ids(h, 'narrow-straight').length, 6);
h = run(h, ...put('link-taper', 19.5, 32.5));
assert.equal(ids(h, 'link-taper')[0]?.y, 29, 'its narrow side meets the narrow road');
ok('links snap to the road they join');
