import { strict as assert } from 'node:assert';
import { clampCamera, mapBounds, minZoom, startCamera } from '../src/camera.ts';
import { sizeOf, toScreen } from '../src/geometry.ts';
import { type History, type HistoryAction, initialHistory, step } from '../src/history.ts';
import { fromView, guideFromView, pointFromView, pointToView, sizeInView, toView } from '../src/view.ts';
import { type State, initialState, interiorCells, objectAt, wallAt } from '../src/world.ts';
const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
const pt = (x: number, y: number) => ({ cell: { x: Math.floor(x), y: Math.floor(y) }, point: { x, y } });
const drag = (a: [number, number], b: [number, number]): HistoryAction[] =>
  [{ type: 'hover', ...pt(...a) }, { type: 'press', ...pt(...a) }, { type: 'hover', ...pt(...b) }, { type: 'release' }];
const click = (x: number, y: number) => drag([x, y], [x, y]);
const turnTo = (v: number): HistoryAction[] => Array.from({ length: v }, () => ({ type: 'rotateView', dir: 1 }) as HistoryAction);
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

// A wide, short map: 40 along x, 20 along y
const WIDE = sizeOf(40, 20);
const fresh = (size = WIDE): History => ({ ...initialHistory, state: { ...initialState, size } });
// In view v, the point a world point (x, y) shows at
const at = (v: number, x: number, y: number): [number, number] => {
  const p = pointToView({ x, y }, v as 0, WIDE);
  return [p.x, p.y];
};

assert.equal(sizeOf(40, 20), WIDE); // one object per size
assert.equal(initialState.size, sizeOf(64, 64));
ok('sizes are one object each, and a new world is 64 by 64');

// ===== Turning a non-square map =====
const built = run(fresh(), { type: 'select', id: 'plaster' }, { type: 'setWallMode', mode: 'square' }, ...drag([33.5, 14.5], [37.5, 17.5]),
  { type: 'select', id: 'sofa' }, ...click(2.5, 2.5), { type: 'select', id: 'wood-floor' }, ...click(39.5, 0.5), { type: 'cancel' });
assert.ok(built.state.walls.length > 0 && built.state.objects.length === 1 && built.state.tiles.length > 0);
[0, 1, 2, 3].forEach((v) => {
  const s: State = { ...built.state, view: v as 0 };
  const there = toView(s);
  assert.equal(there.size, sizeInView(WIDE, v as 0), `view ${v} frame`);
  assert.equal(there.size, v % 2 ? sizeOf(20, 40) : WIDE);
  const back = fromView(there);
  assert.equal(back.size, WIDE);
  assert.equal(back.walls, s.walls); assert.equal(back.objects, s.objects); assert.equal(back.tiles, s.tiles);
  // everything in view stays on the view's frame
  there.tiles.forEach((t) => assert.ok(t.x >= 0 && t.y >= 0 && t.x < there.size.w && t.y < there.size.h, `view ${v} tile`));
  there.objects.forEach((o) => assert.ok(o.x >= 0 && o.y >= 0 && o.x + o.w <= there.size.w && o.y + o.h <= there.size.h, `view ${v} object`));
});
ok('a 40 by 20 map turns into a 20 by 40 frame on odd views and back to the very same lists');

[0, 1, 2, 3].forEach((v) => {
  [{ x: 0, y: 0 }, { x: 40, y: 20 }, { x: 37.25, y: 3.75 }, { x: 0.5, y: 19.5 }].forEach((p) => {
    const q = pointFromView(pointToView(p, v as 0, WIDE), v as 0, WIDE);
    assert.ok(Math.abs(q.x - p.x) < 1e-9 && Math.abs(q.y - p.y) < 1e-9, `view ${v}`);
    const seen = pointToView(p, v as 0, WIDE);
    const frame = sizeInView(WIDE, v as 0);
    assert.ok(seen.x >= 0 && seen.y >= 0 && seen.x <= frame.w && seen.y <= frame.h, `view ${v} in frame`);
  });
});
ok('points, the far corner included, turn into every view and back, staying in that view\'s frame');

// ===== Building in every view reaches every corner and only the map =====
[0, 1, 2, 3].forEach((v) => {
  const corners: [number, number][] = [[0, 0], [39, 0], [0, 19], [39, 19]];
  const h = run(fresh(), ...turnTo(v), { type: 'select', id: 'flower-pot' }, ...corners.flatMap(([x, y]) => click(...at(v, x + 0.5, y + 0.5))));
  corners.forEach(([x, y]) => assert.ok(objectAt(h.state, { x, y }), `view ${v} corner ${x},${y}`));
  assert.equal(h.state.objects.length, 4);
  // just past the short side is off the map, from any side
  const off = run(fresh(), ...turnTo(v), { type: 'select', id: 'flower-pot' }, ...click(...at(v, 10.5, 20.5)), ...click(...at(v, 40.5, 5.5)));
  assert.equal(off.state.objects.length, 0, `view ${v} off the map`);
});
ok('in every view the four corners of a 40 by 20 map can be built on, and nothing lands past its edges');

[0, 1, 2, 3].forEach((v) => {
  // a room in the far corner, drawn from view v
  const [a, b] = [at(v, 34, 15), at(v, 39.5, 19.5)];
  const h = run(fresh(), ...turnTo(v), { type: 'select', id: 'plaster' }, { type: 'setWallMode', mode: 'square' },
    { type: 'hover', ...pt(a[0] + 0.01, a[1] + 0.01) }, { type: 'press', ...pt(a[0] + 0.01, a[1] + 0.01) }, { type: 'hover', ...pt(...b) }, { type: 'release' });
  assert.ok(wallAt(h.state, { axis: 'x', x: 39, y: 20 }), `view ${v} wall on the far edge`);
  assert.ok(wallAt(h.state, { axis: 'y', x: 40, y: 19 }), `view ${v} wall on the far edge`);
  const inside = interiorCells(h.state.walls, h.state.size);
  assert.ok(inside.has('39,19') && inside.has('35,16'), `view ${v} room`);
});
ok('a room drawn against the far edges from any side has walls on the map\'s border and counts as inside');

// the outside flood fill knows the map's real size: a wall line across the short side splits nothing off
const line = run(fresh(), { type: 'select', id: 'plaster' }, ...drag([10, 0], [10, 20]));
assert.equal(interiorCells(line.state.walls, line.state.size).size, 0);
ok('a wall right across the map does not enclose either side (the outside reaches round the edge)');

// Shift + click on empty grass floods the whole map, and only the map
[0, 1].forEach((v) => {
  const h = run(fresh(), ...turnTo(v), { type: 'select', id: 'wood-floor' }, { type: 'setShift', held: true }, ...click(...at(v, 5.5, 5.5)), { type: 'setShift', held: false });
  assert.equal(h.state.tiles.length, 40 * 20, `view ${v}`);
});
ok('a floor fill over bare ground covers exactly the 800 tiles of the map, from either side');

// paint dragged along a wall in a turned view lands on the side pointed at
{
  const room = run(fresh(), { type: 'select', id: 'plaster' }, { type: 'setWallMode', mode: 'square' }, ...drag([30.5, 10.5], [33.5, 12.5]));
  // the wall far from the camera, pointed at from inside: west in view 1, east in view 3
  const far = [{ v: 1, p: [30.2, 11.5], x: 30, side: 'after' }, { v: 3, p: [33.8, 11.5], x: 34, side: 'before' }] as const;
  far.forEach(({ v, p, x, side }) => {
    const h = run(room, ...turnTo(v), { type: 'select', id: 'paint-mint' }, ...click(...at(v, p[0], p[1])));
    const w = wallAt(h.state, { axis: 'y', x, y: 11 });
    assert.equal(w?.paint[side], 'paint-mint', `view ${v}`);
    assert.equal(w?.paint[side === 'after' ? 'before' : 'after'], null, `view ${v}`);
  });
}
ok('painting a wall face in a turned non-square view paints the side pointed at');

// guides name world lines from any view
[0, 1, 2, 3].forEach((v) => {
  const frame = sizeInView(WIDE, v as 0);
  const seen = toView({ ...initialState, size: WIDE, guides: [{ axis: 'x', at: 7 }, { axis: 'y', at: 3 }], view: v as 0 });
  assert.deepEqual(seen.guides.map((g) => guideFromView(g, v as 0, frame)), [{ axis: 'x', at: 7 }, { axis: 'y', at: 3 }], `view ${v}`);
});
ok('guide lines turn with a non-square view and still name their world line');

// ===== Camera limits =====
const screen = { w: 1280, h: 720 };
const big = sizeOf(256, 256);
assert.ok(minZoom(big, screen) < 0.15);
{
  const b = mapBounds(big), z = minZoom(big, screen);
  assert.ok((b.right - b.left) * z <= screen.w && (b.bottom - b.top) * z <= screen.h);
}
assert.equal(minZoom(sizeOf(64, 64), screen), 0.15);
ok('zooming out goes far enough for a 256 by 256 map to fit on screen; small maps keep the old floor');

[WIDE, sizeOf(20, 40), big].forEach((size) => {
  const b = mapBounds(size);
  const far = clampCamera({ x: 1e6, y: -1e6, scale: 1 }, size, screen);
  const center = { x: (screen.w / 2 - far.x) / far.scale, y: (screen.h / 2 - far.y) / far.scale };
  assert.ok(center.x >= b.left - 1e-6 && center.x <= b.right + 1e-6 && center.y >= b.top - 1e-6 && center.y <= b.bottom + 1e-6);
  const start = startCamera(size, screen);
  const kept = clampCamera(start, size, screen); // the start view is already in limits
  assert.ok(Math.abs(kept.x - start.x) < 1e-6 && Math.abs(kept.y - start.y) < 1e-6 && kept.scale === start.scale);
  const mid = toScreen(size.w / 2, size.h / 2);
  assert.ok(Math.abs(start.x + mid.sx * start.scale - screen.w / 2) < 1e-6);
});
assert.equal(clampCamera({ x: 0, y: 0, scale: 9 }, WIDE, screen).scale, 3);
ok('the camera cannot pan the map off screen, starts centered on it, and zoom stays in its range');
