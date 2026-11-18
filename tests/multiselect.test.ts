import { strict as assert } from 'node:assert';
import { type History, type HistoryAction, canUndo, initialHistory, step } from '../src/history.ts';
import { pointToView } from '../src/view.ts';
import { heldPlan, wallAt } from '../src/world.ts';
import { sizeOf } from '../src/geometry.ts';
const SQ = sizeOf(64, 64);
const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
const pt = (x: number, y: number) => ({ cell: { x: Math.floor(x), y: Math.floor(y) }, point: { x, y } });
const drag = (a: [number, number], b: [number, number]): HistoryAction[] =>
  [{ type: 'hover', ...pt(...a) }, { type: 'press', ...pt(...a) }, { type: 'hover', ...pt(...b) }, { type: 'release' }];
const click = (x: number, y: number) => drag([x, y], [x, y]);
const hover = (x: number, y: number): HistoryAction => ({ type: 'hover', ...pt(x, y) });
const shift = (held: boolean): HistoryAction => ({ type: 'setShift', held });
const marks = (h: History) => (h.state.selection?.kind === 'marked' ? h.state.selection.targets : []);
const wall = (h: History, axis: 'x' | 'y', x: number, y: number) => wallAt(h.state, { axis, x, y });
const objectAt = (h: History, x: number, y: number) => h.state.objects.find((o) => x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h);
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

// A small furnished room: plaster walls around cells 10..12 x 10..11 (its floor comes with it), the
// inside painted sky, a door in the south wall, a crate and a chair inside, a canal with a culvert
// outside, and a lone crate far away.
const world = run(initialHistory,
  { type: 'select', id: 'plaster' }, { type: 'setWallMode', mode: 'square' }, ...drag([10.5, 10.5], [12.5, 11.5]),
  { type: 'select', id: 'paint-sky' }, shift(true), ...click(11.5, 10.2), shift(false),
  { type: 'select', id: 'wooden-door' }, ...click(11.5, 12.02),
  { type: 'select', id: 'crate' }, ...click(10.5, 10.5), ...click(30.5, 30.5),
  { type: 'select', id: 'chair' }, ...click(12.5, 11.5),
  { type: 'useSelect' });
const roomWalls = world.state.walls.length;
assert.equal(roomWalls, 10);
assert.equal(wall(world, 'x', 11, 12)?.opening, 'wooden-door');
assert.equal(wall(world, 'x', 11, 10)?.paint.after, 'paint-sky');
const floor = world.state.tiles.length;
assert.ok(floor === 6, `room floor tiles ${floor}`);

// ===== Marking =====
// a box over the room marks everything in it: its floor, its walls (they enclose what the box covers),
// the crate and the chair, but not the far crate
let h = run(world, ...drag([13.5, 12.5], [9.5, 9.5]));
assert.equal(h.state.selection?.kind, 'marked');
assert.equal(marks(h).filter((t) => t.kind === 'object').length, 2);
assert.equal(marks(h).filter((t) => t.kind === 'wall').length, 10);
assert.equal(marks(h).filter((t) => t.kind === 'tile').length, 6);
assert.equal(h.state.walls, world.state.walls);
assert.equal(h.past.length, world.past.length);
ok('a box marks everything in it (room walls included) and changes nothing in the world');

// Esc (or a right click, which sends the same cancel) clears the marks
assert.equal(run(h, { type: 'cancel' }).state.selection, null);
// with things marked, a click anywhere lifts them all, held by the clicked cell: here empty ground
// 30 cells away, so dropping 5 cells further on moves the room by 5
const lifted = run(h, ...click(40.5, 40.5));
assert.equal(lifted.state.selection?.kind, 'group');
assert.equal(lifted.state.walls.length, 0);
const moved = run(lifted, ...click(45.5, 40.5));
assert.equal(wall(moved, 'x', 16, 12)?.opening, 'wooden-door');
assert.equal(moved.state.selection?.kind, 'marked');
ok('Esc clears the marks; a click anywhere lifts them, grabbed at that spot');

// Shift + click adds and removes; a door marks its wall
h = run(world, shift(true), ...click(10.5, 10.5), ...click(30.5, 30.5));
assert.equal(marks(h).length, 2);
h = run(h, ...click(30.5, 30.5));
assert.equal(marks(h).length, 1);
assert.equal(h.state.objects.length, world.state.objects.length); // nothing was lifted
h = run(h, ...click(11.5, 12.02));
assert.ok(marks(h).some((t) => t.kind === 'wall' && t.target.opening === 'wooden-door'));
h = run(h, shift(false));
ok('Shift + click adds a thing to the marks or takes it out, without lifting it');

// Shift + box adds to the marks
h = run(world, shift(true), ...click(30.5, 30.5), ...drag([13.5, 12.5], [9.5, 9.5]), shift(false));
assert.equal(marks(h).length, 1 + 2 + 10 + 6);
ok('Shift + box adds what it covers to the marks');

// ===== Moving =====
// clicking a marked thing lifts all the marks, held by the clicked cell; they follow the pointer
h = run(world, ...drag([13.5, 12.5], [9.5, 9.5]), hover(10.5, 10.5), { type: 'press', ...pt(10.5, 10.5) }, { type: 'release' });
assert.equal(h.state.selection?.kind, 'group');
assert.equal(h.state.walls.length, 0);
assert.equal(h.state.objects.length, 1); // only the far crate stays
h = run(h, hover(20.5, 30.5));
assert.equal(heldPlan(h.state)?.valid, true);
h = run(h, { type: 'press', ...pt(20.5, 30.5) }, { type: 'release' });
// the room moved by (10, 20) with everything in it
assert.equal(h.state.walls.length, roomWalls);
assert.equal(wall(h, 'x', 21, 32)?.opening, 'wooden-door');
assert.equal(wall(h, 'x', 21, 30)?.paint.after, 'paint-sky');
assert.equal(objectAt(h, 20, 30)?.defId, 'crate');
assert.equal(objectAt(h, 22, 31)?.defId, 'chair');
assert.equal(h.state.tiles.filter((t) => t.x >= 20 && t.x <= 22 && t.y >= 30 && t.y <= 31).length, 6);
assert.equal(h.state.tiles.length, floor);
assert.equal(h.state.selection?.kind, 'marked'); // still marked, ready to move again
assert.equal(h.past.length, world.past.length + 1);
h = step(h, { type: 'undo' });
assert.deepEqual(h.state.walls.map((w) => `${w.axis}${w.x},${w.y}`).sort(), world.state.walls.map((w) => `${w.axis}${w.x},${w.y}`).sort());
ok('a marked room lifts as one, moves with its walls, paint, door, floor and furniture, and undoes in one step');

// a drop that does not fit keeps holding: over the far crate
h = run(world, ...drag([13.5, 12.5], [9.5, 9.5]), ...click(10.5, 10.5), hover(30.5, 30.5));
assert.equal(heldPlan(h.state)?.valid, false);
h = run(h, { type: 'press', ...pt(30.5, 30.5) }, { type: 'release' });
assert.equal(h.state.selection?.kind, 'group');
// Esc puts it back and keeps the marks; Esc again clears them
h = run(h, { type: 'cancel' });
assert.equal(h.state.selection?.kind, 'marked');
assert.equal(h.state.walls.length, roomWalls);
assert.equal(h.past.length, world.past.length);
h = run(h, { type: 'cancel' });
assert.equal(h.state.selection, null);
ok('a group that does not fit stays held; Esc puts it back marked, Esc again clears');

// ===== Turning =====
// R turns a held room about the grabbed cell; the inside paint stays inside, the door stays in a wall
h = run(world, ...drag([13.5, 12.5], [9.5, 9.5]), ...click(10.5, 10.5), { type: 'rotate' }, ...click(40.5, 40.5));
assert.equal(h.state.walls.length, roomWalls);
const room = h.state.walls;
const xs = room.map((w) => w.x), ys = room.map((w) => w.y);
assert.deepEqual([Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)], [2, 3]); // 3x2 became 2x3
assert.ok(room.every((w) => (w.paint.after === 'paint-sky') !== (w.paint.before === 'paint-sky')), 'every wall painted on exactly one side');
// every painted side faces into the room
const inRoom = (c: { x: number; y: number }) => h.state.tiles.some((t) => t.x === c.x && t.y === c.y);
room.forEach((w) => {
  const side = w.paint.after === 'paint-sky' ? 'after' : 'before';
  const c = w.axis === 'x' ? { x: w.x, y: side === 'after' ? w.y : w.y - 1 } : { x: side === 'after' ? w.x : w.x - 1, y: w.y };
  assert.ok(inRoom(c), `paint faces in ${w.axis}${w.x},${w.y}`);
});
assert.equal(room.filter((w) => w.opening === 'wooden-door').length, 1);
assert.equal(h.state.objects.filter((o) => o.defId === 'chair').length, 1);
ok('R turns a held room about the grabbed cell; paint stays on the inside and the door stays in its wall');

// R on marks (not held) turns them in place when they fit, as one undo step: the 3x2 room becomes 2x3
h = run(world, ...drag([13.5, 12.5], [9.5, 9.5]), { type: 'rotate' });
assert.equal(h.state.walls.length, roomWalls);
const span = (ws: typeof h.state.walls) => [Math.max(...ws.map((w) => w.x)) - Math.min(...ws.map((w) => w.x)), Math.max(...ws.map((w) => w.y)) - Math.min(...ws.map((w) => w.y))];
assert.deepEqual(span(world.state.walls), [3, 2]);
assert.deepEqual(span(h.state.walls), [2, 3]);
assert.equal(h.state.selection?.kind, 'marked');
assert.equal(h.past.length, world.past.length + 1);
// a turn in place that does not fit changes nothing: a sofa (31..32, 30) whose turn needs (31, 31), taken by a crate
const blocked = run(world, { type: 'select', id: 'sofa' }, ...click(31.5, 30.5), { type: 'select', id: 'crate' }, ...click(31.5, 31.5), { type: 'useSelect' });
const sofa = blocked.state.objects.find((o) => o.defId === 'sofa')!;
assert.deepEqual({ x: sofa.x, y: sofa.y, w: sofa.w }, { x: 31, y: 30, w: 2 });
h = run(blocked, shift(true), ...click(31.5, 30.5), shift(false));
assert.equal(marks(h).length, 1);
const tried = run(h, { type: 'rotate' });
assert.equal(tried.state.objects, h.state.objects);
assert.equal(tried.past.length, h.past.length);
const free = run(blocked, { type: 'select', id: 'crate' }, { type: 'useSelect' }, shift(true), ...click(31.5, 31.5), shift(false), { type: 'deleteSelection' },
  shift(true), ...click(31.5, 30.5), shift(false), { type: 'rotate' });
const turned = free.state.objects.find((o) => o.defId === 'sofa')!;
assert.deepEqual({ x: turned.x, y: turned.y, w: turned.w, h: turned.h }, { x: 31, y: 30, w: 1, h: 2 });
ok('R on marked things turns them in place when they fit (one undo step), and does nothing when they do not');

// ===== Deleting =====
h = run(world, ...drag([13.5, 12.5], [9.5, 9.5]), { type: 'deleteSelection' });
assert.equal(h.state.walls.length, 0);
assert.equal(h.state.objects.length, 1);
assert.equal(h.state.tiles.length, 0);
assert.equal(h.past.length, world.past.length + 1);
h = step(h, { type: 'undo' });
assert.equal(h.state.walls.length, roomWalls);
ok('Delete removes everything marked, in one undo step');

h = run(world, ...drag([13.5, 12.5], [9.5, 9.5]), ...click(10.5, 10.5), { type: 'deleteSelection' });
assert.equal(h.state.walls.length, 0);
assert.equal(h.past.length, world.past.length + 1);
ok('Delete while holding a group lets go of it, in one undo step');

// ===== Single things still work the old way =====
h = run(world, ...click(30.5, 30.5));
assert.equal(h.state.selection?.kind, 'group');
h = run(h, ...click(35.5, 35.5));
assert.equal(h.state.selection, null);
assert.equal(objectAt(h, 35, 35)?.defId, 'crate');
h = run(world, ...click(11.5, 12.02));
assert.equal(h.state.selection?.kind, 'opening');
h = run(world, ...click(10.5, 10.05));
assert.equal(h.state.selection?.kind, 'marked');
ok('an unmarked object still lifts on a click and lets go after the drop; a door still slides; a wall is marked');

// ===== From a turned camera =====
// the same box and move done in view 2 (screen positions turned) gives the same world. A box starts on
// open ground in front of the room, which in view 2 is the opposite corner, so a press there is not on a wall face
const v = (x: number, y: number) => pointToView({ x, y }, 2, SQ);
const at = (x: number, y: number): [number, number] => { const p = v(x, y); return [p.x, p.y]; };
h = run(world, { type: 'rotateView', dir: 1 }, { type: 'rotateView', dir: 1 },
  ...drag(at(9.5, 9.5), at(13.5, 12.5)), ...click(...at(10.5, 10.5)), ...click(...at(20.5, 30.5)));
assert.equal(wall(h, 'x', 21, 32)?.opening, 'wooden-door');
assert.equal(wall(h, 'x', 21, 30)?.paint.after, 'paint-sky');
assert.equal(objectAt(h, 20, 30)?.defId, 'crate');
assert.equal(objectAt(h, 22, 31)?.defId, 'chair');
ok('marking and moving work the same from a turned camera');

// ===== Filters =====
// the select tool has its own filter, separate from the bulldoze one, and it is not an undo step
h = run(world, { type: 'toggleSelectFilter', category: 'building' }, { type: 'toggleSelectFilter', category: 'flooring' });
assert.deepEqual(h.state.selectFilter, { scenery: true, furniture: true, flooring: false, building: false });
assert.deepEqual(h.state.bulldozeFilter, { scenery: true, furniture: true, flooring: true, building: true });
assert.equal(h.past.length, world.past.length);
// a box over the room now marks only the crate and the chair
const onlyFurniture = run(h, ...drag([13.5, 12.5], [9.5, 9.5]));
assert.deepEqual(marks(onlyFurniture).map((t) => t.kind), ['object', 'object']);
ok('the select filter keeps a box to the kinds switched on, and is its own setting outside undo');

// a click that would hit a wall face goes past it when Building is off. On screen, the room's near
// (south) wall stands in front of the chair at (12, 11): pointing at (12.5, 11.8) is on that wall's face.
const facePoint = pt(12.5, 11.8);
const atFace = run(world, hover(12.5, 11.8), { type: 'press', ...facePoint }, { type: 'release' });
assert.equal(atFace.state.selection?.kind, 'marked');
assert.ok(marks(atFace).every((t) => t.kind === 'wall')); // Building on: the wall in front
const past = run(world, { type: 'toggleSelectFilter', category: 'building' }, hover(12.5, 11.8), { type: 'press', ...facePoint }, { type: 'release' });
assert.equal(past.state.selection?.kind, 'group'); // Building off: the chair behind it, lifted
assert.equal(past.state.selection?.kind === 'group' && past.state.selection.pieces.objects[0]?.defId, 'chair');
// and furniture off: clicking the chair does nothing
const noFurniture = run(world, { type: 'toggleSelectFilter', category: 'furniture' }, ...click(12.5, 11.5));
assert.equal(noFurniture.state.selection, null);
assert.equal(noFurniture.state.objects.length, world.state.objects.length);
ok('a click skips filtered kinds: past a wall face with Building off, and not onto furniture with Furniture off');
