import { strict as assert } from 'node:assert';
import { type History, type HistoryAction, canUndo, initialHistory, step } from '../src/history.ts';
import { floorFill, paintPlan } from '../src/world.ts';
const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
const pt = (x: number, y: number) => ({ cell: { x: Math.floor(x), y: Math.floor(y) }, point: { x, y } });
const drag = (a: [number, number], b: [number, number]): HistoryAction[] =>
  [{ type: 'hover', ...pt(...a) }, { type: 'press', ...pt(...a) }, { type: 'hover', ...pt(...b) }, { type: 'release' }];
const click = (x: number, y: number) => drag([x, y], [x, y]);
const wall = (h: History, axis: 'x' | 'y', x: number, y: number) => h.state.walls.find((w) => w.axis === axis && w.x === x && w.y === y);
const tileAt = (h: History, x: number, y: number) => h.state.tiles.find((t) => t.x === x && t.y === y)?.defId;
const shift = (ctrl = false): HistoryAction[] => [{ type: 'setShift', held: true }, { type: 'setCtrl', held: ctrl }];
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

// two plaster rooms side by side sharing the wall at x = 14: A is 10..13 x 10..12, B is 14..16 x 10..12
const rooms = run(initialHistory, { type: 'select', id: 'plaster' }, { type: 'setWallMode', mode: 'square' },
  ...drag([10.5, 10.5], [13.5, 12.5]), ...drag([14.5, 10.5], [16.5, 12.5]), { type: 'cancel' });
const floorB = tileAt(rooms, 15, 11);
const OUTSIDE = 64 * 64 - 12 - 9;

// ===== Floors =====
let h = run(rooms, { type: 'select', id: 'carpet' }, ...shift(), { type: 'hover', ...pt(11.5, 11.5) });
assert.equal(floorFill(h.state)?.cells.length, 12);
h = run(h, { type: 'press', ...pt(11.5, 11.5) }, { type: 'release' });
[10, 11, 12, 13].forEach((x) => [10, 11, 12].forEach((y) => assert.equal(tileAt(h, x, y), 'carpet')));
assert.equal(tileAt(h, 15, 11), floorB);
assert.ok(canUndo(h));
h = step(h, { type: 'undo' });
assert.notEqual(tileAt(h, 11, 11), 'carpet');
ok('Shift + click spreads a floor over the same floor, stopped by walls, in one undo step');

// a different floor stops a Shift fill; Shift + Ctrl goes over it
const patched = run(rooms, { type: 'select', id: 'carpet' }, ...click(11.5, 11.5), ...click(12.5, 11.5));
h = run(patched, { type: 'select', id: 'stone-floor' }, ...shift(), { type: 'hover', ...pt(10.5, 10.5) });
assert.equal(floorFill(h.state)?.cells.length, 10);
assert.equal(floorFill(h.state)?.mode, 'same');
h = run(h, { type: 'press', ...pt(10.5, 10.5) }, { type: 'release' });
assert.equal(tileAt(h, 10, 10), 'stone-floor');
assert.equal(tileAt(h, 11, 11), 'carpet');
h = run(patched, { type: 'select', id: 'stone-floor' }, ...shift(true), { type: 'hover', ...pt(10.5, 10.5) });
assert.equal(floorFill(h.state)?.cells.length, 12);
assert.equal(floorFill(h.state)?.mode, 'all');
h = run(h, { type: 'press', ...pt(10.5, 10.5) }, { type: 'release' });
assert.equal(tileAt(h, 11, 11), 'stone-floor');
assert.equal(tileAt(h, 15, 11), floorB);
ok('Shift stops at a different floor; Shift + Ctrl replaces every floor in reach');

// outdoors works too: the bare ground around the buildings, stopping at another floor; Ctrl takes it too
const pathed = run(rooms, { type: 'select', id: 'carpet' }, ...click(30.5, 30.5));
h = run(pathed, { type: 'select', id: 'wood-floor' }, ...shift(), { type: 'hover', ...pt(40.5, 40.5) });
assert.equal(floorFill(h.state)?.cells.length, OUTSIDE - 1);
h = run(h, { type: 'press', ...pt(40.5, 40.5) }, { type: 'release' });
assert.equal(tileAt(h, 40, 40), 'wood-floor');
assert.equal(tileAt(h, 30, 30), 'carpet');
assert.equal(tileAt(h, 15, 11), floorB);
h = run(pathed, { type: 'select', id: 'wood-floor' }, ...shift(true), { type: 'hover', ...pt(40.5, 40.5) });
assert.equal(floorFill(h.state)?.cells.length, OUTSIDE);
ok('outdoors, a fill covers the ground around buildings without going inside');

// ===== Walls =====
// inside room A: the 14 inner faces form one loop; the shared wall only gets A's side
h = run(rooms, { type: 'select', id: 'paint-sky' }, ...shift(), { type: 'hover', ...pt(11.5, 10.3) });
assert.equal(paintPlan(h.state)?.targets.length, 14);
h = run(h, { type: 'press', ...pt(11.5, 10.3) }, { type: 'release' });
assert.equal(wall(h, 'x', 11, 10)?.paint.after, 'paint-sky');
assert.deepEqual(wall(h, 'x', 11, 13)?.paint, { before: 'paint-sky', after: null });
assert.deepEqual(wall(h, 'y', 14, 11)?.paint, { before: 'paint-sky', after: null });
ok('Shift + click inside a room paints the loop of faces around it, one side of a shared wall');

// outside: the building's outer surface is one loop of 7 + 7 + 3 + 3 faces, going past the shared wall
h = run(rooms, { type: 'select', id: 'paint-sky' }, ...shift(), { type: 'hover', ...pt(11.5, 13.2) });
assert.equal(paintPlan(h.state)?.targets.length, 20);
h = run(h, { type: 'press', ...pt(11.5, 13.2) }, { type: 'release' });
assert.deepEqual(wall(h, 'x', 11, 13)?.paint, { before: null, after: 'paint-sky' });
assert.deepEqual(wall(h, 'x', 15, 10)?.paint, { before: 'paint-sky', after: null });
assert.deepEqual(wall(h, 'y', 17, 11)?.paint, { before: null, after: 'paint-sky' });
assert.deepEqual(wall(h, 'y', 14, 11)?.paint, { before: null, after: null });
ok('Shift + click outside paints the outer faces all the way around the building');

// a different paint stops Shift; Shift + Ctrl paints over it
const striped = run(rooms, { type: 'select', id: 'paint-butter' }, ...click(12.5, 13.2));
assert.equal(wall(striped, 'x', 12, 13)?.paint.after, 'paint-butter');
h = run(striped, { type: 'select', id: 'paint-sky' }, ...shift(), { type: 'hover', ...pt(11.5, 13.2) });
assert.equal(paintPlan(h.state)?.targets.length, 19);
h = run(h, { type: 'press', ...pt(11.5, 13.2) }, { type: 'release' });
assert.equal(wall(h, 'x', 12, 13)?.paint.after, 'paint-butter');
assert.equal(wall(h, 'x', 13, 13)?.paint.after, 'paint-sky');
h = run(striped, { type: 'select', id: 'paint-sky' }, ...shift(true), { type: 'hover', ...pt(11.5, 13.2) });
assert.equal(paintPlan(h.state)?.targets.length, 20);
h = run(h, { type: 'press', ...pt(11.5, 13.2) }, { type: 'release' });
assert.equal(wall(h, 'x', 12, 13)?.paint.after, 'paint-sky');
ok('Shift stops at a different paint; Shift + Ctrl paints over every paint');

// a fence against the building does not split its surface
h = run(rooms, { type: 'select', id: 'picket-fence' }, { type: 'setWallMode', mode: 'line' }, ...drag([17.02, 11.02], [19.98, 11.02]),
  { type: 'select', id: 'paint-sky' }, ...shift(), { type: 'hover', ...pt(11.5, 13.2) });
assert.ok(h.state.walls.some((w) => w.styleId === 'picket-fence'));
assert.equal(paintPlan(h.state)?.targets.length, 20);
ok('fences never join or split a wall surface');

// a free-standing wall: the surface wraps around its ends, so both sides fill
const line = run(initialHistory, { type: 'select', id: 'plaster' }, { type: 'setWallMode', mode: 'line' }, ...drag([30.02, 30.02], [32.98, 30.02]));
assert.equal(line.state.walls.length, 3);
h = run(line, { type: 'select', id: 'paint-sky' }, ...shift(), { type: 'hover', ...pt(31.5, 30.4) });
assert.equal(paintPlan(h.state)?.targets.length, 6);
ok('a free-standing wall fills on both sides, wrapping around its ends');

// a wall stub sticking into a room: the loop goes along one side, around its tip and back the other side
const stub = run(initialHistory, { type: 'select', id: 'plaster' }, { type: 'setWallMode', mode: 'square' }, ...drag([20.5, 20.5], [25.5, 23.5]),
  { type: 'setWallMode', mode: 'line' }, ...drag([23.02, 20.02], [23.02, 21.98]), { type: 'cancel' });
assert.equal(stub.state.walls.length, 20 + 2);
h = run(stub, { type: 'select', id: 'paint-sky' }, ...shift(), { type: 'hover', ...pt(21.5, 20.3) });
assert.equal(paintPlan(h.state)?.targets.length, 20 + 4);
ok('a wall stub inside a room is part of the room loop, both of its sides');

// glass is part of a surface like any wall
h = run(line, { type: 'select', id: 'glass' }, ...drag([33.02, 30.02], [34.98, 30.02]),
  { type: 'select', id: 'paint-sky' }, ...shift(true), { type: 'hover', ...pt(31.5, 30.4) });
assert.equal(h.state.walls.length, 5);
const targets = paintPlan(h.state)?.targets ?? [];
assert.equal(targets.length, 10); // both sides of the whole run, wrapping around both ends
assert.equal(targets.filter((t) => t.wall.styleId === 'glass').length, 4);
ok('glass joins a fill and takes its paint');

// pointing away from any wall fills nothing
const before = run(rooms, { type: 'select', id: 'paint-sky' }, ...shift());
h = run(before, { type: 'hover', ...pt(40.5, 40.5) });
assert.equal(paintPlan(h.state)?.targets.length, 0);
h = run(h, { type: 'press', ...pt(40.5, 40.5) }, { type: 'release' });
assert.deepEqual(h.state.walls, before.state.walls);
ok('Shift + click away from walls paints nothing');

// Ctrl is a key state, not an undo step
h = run(rooms, { type: 'setCtrl', held: true });
assert.equal(h.state.ctrlHeld, true);
assert.equal(step(h, { type: 'undo' }).state.ctrlHeld, true);
ok('holding Ctrl is not an undo step');
