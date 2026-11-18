import { strict as assert } from 'node:assert';
import { type History, type HistoryAction, canUndo, initialHistory, step } from '../src/history.ts';
import { fromView, pointFromView, pointToView, toView } from '../src/view.ts';
import { wallAt } from '../src/world.ts';
const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
const pt = (x: number, y: number) => ({ cell: { x: Math.floor(x), y: Math.floor(y) }, point: { x, y } });
const drag = (a: [number, number], b: [number, number]): HistoryAction[] =>
  [{ type: 'hover', ...pt(...a) }, { type: 'press', ...pt(...a) }, { type: 'hover', ...pt(...b) }, { type: 'release' }];
const click = (x: number, y: number) => drag([x, y], [x, y]);
const turnTo = (v: number): HistoryAction[] => Array.from({ length: v }, () => ({ type: 'rotateView', dir: 1 }) as HistoryAction);
const wall = (h: History, axis: 'x' | 'y', x: number, y: number) => wallAt(h.state, { axis, x, y });
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

// a world with a bit of everything: a plaster room with a painted wall and a door, a sofa, a floor, a culvert-free canal
const built = run(initialHistory, { type: 'select', id: 'plaster' }, { type: 'setWallMode', mode: 'square' },
  ...drag([10.5, 10.5], [13.5, 12.5]), { type: 'select', id: 'paint-sky' }, ...click(11.5, 10.2),
  { type: 'select', id: 'wooden-door' }, ...click(12.5, 13.02),
  { type: 'select', id: 'sofa' }, ...click(20.5, 20.5), { type: 'select', id: 'canal' }, ...drag([30.5, 30.5], [33.5, 30.5]), { type: 'cancel' });

// ===== The turns themselves =====
[1, 2, 3].forEach((v) => {
  const s = { ...built.state, view: v as 0 | 1 | 2 | 3 };
  const there = toView(s);
  const back = fromView(there);
  assert.equal(back.walls, s.walls); assert.equal(back.objects, s.objects); assert.equal(back.tiles, s.tiles);
  assert.notEqual(there.walls, s.walls);
  assert.equal(toView(s).walls, there.walls); // turning again gives the same list
});
ok('turning into a view and back gives the very same lists, so nothing looks changed');

[1, 2, 3].forEach((v) => {
  const p = { x: 12.25, y: 40.75 };
  const q = pointFromView(pointToView(p, v as 1), v as 1);
  assert.ok(Math.abs(q.x - p.x) < 1e-9 && Math.abs(q.y - p.y) < 1e-9);
});
ok('points turn into a view and back');

// ===== Turning the camera =====
let h = run(built, ...turnTo(1));
assert.equal(h.state.view, 1);
assert.equal(h.state.walls, built.state.walls);
assert.equal(canUndo(h), canUndo(built));
h = step(h, { type: 'undo' });
assert.equal(h.state.view, 1); // undo does not turn the camera back
assert.notEqual(h.state.objects.length, built.state.objects.length + 1);
h = run(built, ...turnTo(4));
assert.equal(h.state.view, 0);
h = run(built, { type: 'rotateView', dir: -1 });
assert.equal(h.state.view, 3);
ok('the camera turns four ways, Shift turns back, and turning is not an undo step');

// hovering in a turned view leaves the world alone (no extra undo step after a move of the pointer)
h = run(built, ...turnTo(2), { type: 'hover', ...pt(40.5, 40.5) }, { type: 'hover', ...pt(41.5, 40.5) });
assert.equal(h.state.walls, built.state.walls);
assert.equal(h.state.objects, built.state.objects);
assert.equal(h.past.length, built.past.length);
ok('hovering in a turned view changes nothing in the world');

// ===== Building in a turned view =====
// In view 1, world (x, y) shows at (64 - y, x). Clicking view cell (43, 20) is world cell (20, 20) .. checked by turning back
[1, 2, 3].forEach((v) => {
  const view = v as 1 | 2 | 3;
  const at = pointToView({ x: 40.5, y: 22.5 }, view); // the screen spot over world cell (40, 22)
  const done = run(built, ...turnTo(v), { type: 'select', id: 'crate' }, ...click(at.x, at.y));
  const crate = done.state.objects.find((o) => o.defId === 'crate');
  assert.deepEqual(crate && { x: crate.x, y: crate.y }, { x: 40, y: 22 }, `view ${v}`);
});
ok('a 1x1 object lands on the world cell under the pointer in every view');

// the build facing belongs to the world: a sofa set to face one way faces that way in the world from any
// camera, and on screen it turns with everything else. Its footprint still covers the pointed-at cell.
[0, 1, 2, 3].forEach((v) => {
  const at = pointToView({ x: 40.5, y: 22.5 }, v as 1);
  const done = run(initialHistory, ...turnTo(v), { type: 'select', id: 'sofa' }, ...click(at.x, at.y));
  const o = done.state.objects[0]!;
  const seen = toView(done.state).objects[0]!;
  assert.equal(o.rotation, 0, `view ${v} rotation`);
  assert.equal(seen.rotation, v, `view ${v} seen rotation`);
  const cell = { x: Math.floor(at.x), y: Math.floor(at.y) };
  assert.ok(cell.x >= seen.x && cell.x < seen.x + seen.w && cell.y >= seen.y && cell.y < seen.y + seen.h, `view ${v} covers`);
  assert.deepEqual({ x: seen.x, y: seen.y }, cell, `view ${v} grows from the pointer like in view 0`);
});
ok('the build facing is a world facing; on screen the footprint grows from the pointer the same way in every view');

// walls drawn in a turned view are the same world walls
[1, 2, 3].forEach((v) => {
  const a = pointToView({ x: 40.02, y: 50.02 }, v as 1), b = pointToView({ x: 42.98, y: 50.02 }, v as 1);
  const done = run(initialHistory, ...turnTo(v), { type: 'select', id: 'brick' }, { type: 'setWallMode', mode: 'line' },
    { type: 'hover', ...pt(a.x, a.y) }, { type: 'press', ...pt(a.x, a.y) }, { type: 'hover', ...pt(b.x, b.y) }, { type: 'release' });
  assert.deepEqual(done.state.walls.map((w) => `${w.axis}:${w.x},${w.y}`).sort(), ['x:40,50', 'x:41,50', 'x:42,50'], `view ${v}`);
});
ok('a wall line drawn in any view is the same world line');

// ===== Wall faces follow the camera =====
// view 0 sees the after (south/east) side of walls; view 2 looks from the other corner and sees the
// before side. Pointing just inside the wall that is far from the camera paints its inside face: in view 0
// that is the north wall (inside = after), in view 2 the south wall (inside = before).
const farInside = [
  { v: 0, at: { x: 11.5, y: 10.2 }, wall: [11, 10] as const, side: 'after' as const },
  { v: 2, at: { x: 11.5, y: 12.8 }, wall: [11, 13] as const, side: 'before' as const },
  { v: 1, at: { x: 10.2, y: 11.5 }, wall: [10, 11] as const, side: 'after' as const, axis: 'y' as const }, // west wall is far in view 1
  { v: 3, at: { x: 13.8, y: 11.5 }, wall: [14, 11] as const, side: 'before' as const, axis: 'y' as const }, // east wall is far in view 3
];
farInside.forEach(({ v, at, wall: [wx, wy], side, axis }) => {
  const p = pointToView(at, v as 1);
  const done = run(initialHistory, { type: 'select', id: 'plaster' }, { type: 'setWallMode', mode: 'square' },
    ...drag([10.5, 10.5], [13.5, 12.5]), ...turnTo(v), { type: 'select', id: 'paint-mint' }, ...click(p.x, p.y));
  const w = wall(done, axis ?? 'x', wx, wy);
  assert.equal(w?.paint[side], 'paint-mint', `view ${v}`);
  assert.equal(w?.paint[side === 'after' ? 'before' : 'after'], null, `view ${v}`);
});
ok('in every view, pointing inside a room at the far wall paints that wall\'s inside face');

// what the camera shows: view 0 shows the north wall's after side (sky, inside); view 2 shows its before (outside, plain)
assert.equal(wall(built, 'x', 11, 10)?.paint.after, 'paint-sky');
const seen2 = toView({ ...built.state, view: 2 });
const north2 = seen2.walls.find((w) => w.axis === 'x' && w.x === 64 - 11 - 1 && w.y === 64 - 10)!;
assert.deepEqual(north2.paint, { before: 'paint-sky', after: null });
ok('turned walls carry their paint to the side that now faces the camera');

// ===== Wide openings =====
// a long door along a world y wall, built in view 1 (where that wall runs along x, in reverse)
const yRoom = run(initialHistory, { type: 'select', id: 'plaster' }, { type: 'setWallMode', mode: 'line' }, ...drag([20.02, 20.02], [20.02, 24.98]));
[0, 1, 2, 3].forEach((v) => {
  const a = pointToView({ x: 20.02, y: 21.5 }, v as 1), b = pointToView({ x: 20.02, y: 23.5 }, v as 1);
  const done = run(yRoom, ...turnTo(v), { type: 'select', id: 'long-door' },
    { type: 'hover', ...pt(a.x, a.y) }, { type: 'press', ...pt(a.x, a.y) }, { type: 'hover', ...pt(b.x, b.y) }, { type: 'release' });
  const ids = [21, 22, 23].map((y) => wall(done, 'y', 20, y)?.opening);
  assert.deepEqual(ids, ['long-door:start', 'long-door:middle', 'long-door:end'], `view ${v}`);
  // and as the camera sees it, the first piece is at the low end of the run on screen
  const seen = toView(done.state).walls.filter((w) => w.opening).sort((p, q) => p.x + p.y - (q.x + q.y)).map((w) => w.opening);
  assert.deepEqual(seen, ['long-door:start', 'long-door:middle', 'long-door:end'], `view ${v} seen`);
});
ok('a wide opening keeps its end pieces at the ends in every view');

// ===== Undo in a turned view =====
h = run(built, ...turnTo(3), { type: 'select', id: 'crate' }, ...click(5.5, 5.5));
assert.equal(h.state.objects.length, built.state.objects.length + 1);
h = step(h, { type: 'undo' });
assert.equal(h.state.objects.length, built.state.objects.length);
h = step(h, { type: 'redo' });
assert.equal(h.state.objects.length, built.state.objects.length + 1);
ok('undo and redo work the same in a turned view');

// ===== Culverts =====
// a canal along x (y 40..42, x 40..45); its west end bank is the y line at x = 40. Laying a culvert along
// that bank from any view gives the same world culvert.
const canal = run(initialHistory, { type: 'select', id: 'canal' },
  ...[40, 41, 42].flatMap((y) => [40, 41, 42, 43, 44, 45].flatMap((x) => click(x + 0.5, y + 0.5))), { type: 'cancel' });
assert.equal(canal.state.tiles.length, 18);
[0, 1, 2, 3].forEach((v) => {
  const a = pointToView({ x: 40.03, y: 40.5 }, v as 1), b = pointToView({ x: 40.03, y: 42.5 }, v as 1);
  const done = run(canal, ...turnTo(v), { type: 'select', id: 'culvert' },
    { type: 'hover', ...pt(a.x, a.y) }, { type: 'press', ...pt(a.x, a.y) }, { type: 'hover', ...pt(b.x, b.y) }, { type: 'release' });
  assert.deepEqual(done.state.culverts.map((e) => `${e.axis}:${e.x},${e.y}`).sort(), ['y:40,40', 'y:40,41', 'y:40,42'], `view ${v}`);
  assert.equal(done.state.tiles.length, 18, `view ${v}`);
});
ok('a culvert laid along a bank in any view is the same world culvert');
