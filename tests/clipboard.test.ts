import { strict as assert } from 'node:assert';
import { type History, type HistoryAction, initialHistory, step } from '../src/history.ts';
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
const wall = (h: History, axis: 'x' | 'y', x: number, y: number) => wallAt(h.state, { axis, x, y });
const objectsAt = (h: History, x: number, y: number) => h.state.objects.filter((o) => x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h);
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

// a small furnished room (cells 10..12 x 10..11) with sky paint inside, a door south and a crate and chair
const world = run(initialHistory,
  { type: 'select', id: 'plaster' }, { type: 'setWallMode', mode: 'square' }, ...drag([10.5, 10.5], [12.5, 11.5]),
  { type: 'select', id: 'paint-sky' }, { type: 'setShift', held: true }, ...click(11.5, 10.2), { type: 'setShift', held: false },
  { type: 'select', id: 'wooden-door' }, ...click(11.5, 12.02),
  { type: 'select', id: 'crate' }, ...click(10.5, 10.5), { type: 'select', id: 'chair' }, ...click(12.5, 11.5),
  { type: 'useSelect' });
const markRoom = drag([13.5, 12.5], [9.5, 9.5]);
const total = (h: History) => h.state.walls.length + h.state.objects.length + h.state.tiles.length;
const roomSize = total(world);

// ===== Copy =====
// Ctrl+C copies the marks and holds the copy at once (#37), centered on the pointer by the middle of the
// copied things (cell 11, 10). Copying changes nothing and is not an undo step.
let h = run(world, ...markRoom, { type: 'copy' });
assert.ok(h.state.clipboard);
assert.equal(h.state.clipboard.pieces.walls.length, 10);
assert.equal(h.state.selection?.kind, 'group');
assert.equal(h.state.tool, 'select');
assert.equal(h.past.length, world.past.length);
assert.equal(h.state.walls, world.state.walls);
ok('Ctrl+C keeps the marks in the clipboard and holds a copy at once, changing nothing');

h = run(h, hover(31.5, 30.5));
assert.equal(heldPlan(h.state)?.valid, true);
h = run(h, { type: 'press', ...pt(31.5, 30.5) }, { type: 'release' });
assert.equal(total(h), roomSize * 2);
assert.equal(wall(h, 'x', 31, 32)?.opening, 'wooden-door');
assert.equal(wall(h, 'x', 31, 30)?.paint.after, 'paint-sky');
assert.equal(objectsAt(h, 30, 30)[0]?.defId, 'crate');
assert.equal(wall(h, 'x', 11, 12)?.opening, 'wooden-door'); // the original stays
assert.equal(h.state.selection?.kind, 'group'); // still holding a copy
assert.equal(h.past.length, world.past.length + 1);
// drop again: a third room, each drop its own undo step
h = run(h, hover(41.5, 40.5), { type: 'press', ...pt(41.5, 40.5) }, { type: 'release' });
assert.equal(total(h), roomSize * 3);
assert.equal(h.past.length, world.past.length + 2);
const ids = h.state.objects.map((o) => o.id);
assert.equal(new Set(ids).size, ids.length);
ok('each click places fresh copies (new ids) and keeps holding, one undo step per drop');

// undo takes back only the last drop and lets go of the paste
const undone = step(h, { type: 'undo' });
assert.equal(total(undone), roomSize * 2);
assert.equal(undone.state.selection, null);
ok('undo takes back the last drop');

// ===== Paste =====
// Ctrl+V holds the clipboard again any time, after letting go
h = run(world, ...markRoom, { type: 'copy' }, { type: 'cancel' });
assert.equal(h.state.selection, null);
h = run(h, { type: 'paste' }, ...click(31.5, 30.5));
assert.equal(total(h), roomSize * 2);
assert.equal(h.state.selection?.kind, 'group');
ok('Ctrl+V holds the clipboard again after letting go');

// a drop that does not fit places nothing and keeps holding: onto the original room
h = run(world, ...markRoom, { type: 'copy' }, { type: 'paste' }, hover(11.5, 10.5));
assert.equal(heldPlan(h.state)?.valid, false);
h = run(h, { type: 'press', ...pt(11.5, 10.5) }, { type: 'release' });
assert.equal(total(h), roomSize);
assert.equal(h.state.selection?.kind, 'group');
// Esc lets go and puts nothing back (a paste took nothing out)
h = run(h, { type: 'cancel' });
assert.equal(h.state.selection, null);
assert.equal(total(h), roomSize);
assert.equal(h.past.length, world.past.length);
ok('a paste that does not fit places nothing; Esc lets go of it and changes nothing');

// R turns a paste before placing it
h = run(world, ...markRoom, { type: 'copy' }, { type: 'paste' }, { type: 'rotate' }, ...click(41.5, 40.5));
const copyWalls = h.state.walls.filter((w) => w.x > 30);
const spanOf = (ws: typeof copyWalls) => [Math.max(...ws.map((w) => w.x)) - Math.min(...ws.map((w) => w.x)), Math.max(...ws.map((w) => w.y)) - Math.min(...ws.map((w) => w.y))];
assert.deepEqual(spanOf(copyWalls), [2, 3]); // the 3x2 room placed as 2x3
assert.equal(copyWalls.filter((w) => w.opening === 'wooden-door').length, 1);
ok('R turns a paste before it is placed');

// ===== Cut =====
// Ctrl+X takes the marks out (one undo step) and holds them at once; a click puts them down elsewhere
h = run(world, ...markRoom, { type: 'cut' });
assert.equal(total(h), 0);
assert.equal(h.past.length, world.past.length + 1);
assert.equal(h.state.selection?.kind, 'group');
h = run(h, ...click(31.5, 30.5));
assert.equal(total(h), roomSize);
assert.equal(wall(h, 'x', 31, 32)?.opening, 'wooden-door');
assert.equal(h.past.length, world.past.length + 2);
// Esc after a cut lets go: the marks stay removed (undo brings them back)
h = run(world, ...markRoom, { type: 'cut' }, { type: 'cancel' });
assert.equal(total(h), 0);
assert.equal(total(step(h, { type: 'undo' })), roomSize);
ok('Ctrl+X removes the marks as one undo step and holds them to place elsewhere');

// ===== Edges =====
// paste from the build tool switches to select; paste with an empty clipboard does nothing
h = run(world, ...markRoom, { type: 'copy' }, { type: 'select', id: 'crate' }, { type: 'paste' });
assert.equal(h.state.tool, 'select');
assert.equal(h.state.selection?.kind, 'group');
assert.equal(run(world, { type: 'paste' }).state, world.state);
// copying what is held: lift a crate, copy it, put it back, paste copies
h = run(world, ...click(10.5, 10.5), { type: 'copy' }, { type: 'cancel' }, { type: 'paste' }, ...click(40.5, 40.5), ...click(41.5, 40.5));
assert.equal(h.state.objects.filter((o) => o.defId === 'crate').length, 3);
ok('paste works from any tool; copying while holding copies what is held');

// from a turned camera: copy and paste with screen positions turned gives the same world (the box starts
// on open ground in front of the room, which in view 1 is its north-east corner)
const v = (x: number, y: number): [number, number] => { const p = pointToView({ x, y }, 1, SQ); return [p.x, p.y]; };
h = run(world, { type: 'rotateView', dir: 1 }, ...drag(v(13.5, 9.5), v(9.5, 12.5)), { type: 'copy' }, { type: 'paste' }, ...click(...v(31.5, 30.5)));
assert.equal(total(h), roomSize * 2);
assert.equal(h.state.walls.filter((w) => w.x > 25).length, 10);
assert.equal(h.state.walls.filter((w) => w.opening === 'wooden-door').length, 2);
ok('copy and paste work from a turned camera');

// ===== Shared walls =====
// A copy pasted right beside the original shares its wall instead of being refused. The original room's
// inside is repainted mint first, the copy carries sky inside. Pasting 3 cells east puts the copy's west
// wall on the original's east wall (x = 13).
const mintInside = run(world, ...markRoom, { type: 'copy' }, { type: 'cancel' },
  { type: 'select', id: 'paint-mint' }, { type: 'setShift', held: true }, { type: 'setCtrl', held: true }, ...click(11.5, 10.2),
  { type: 'setShift', held: false }, { type: 'setCtrl', held: false }, { type: 'useSelect' });
assert.equal(wall(mintInside, 'y', 13, 10)?.paint.before, 'paint-mint');
h = run(mintInside, { type: 'paste' }, hover(14.5, 10.5));
assert.equal(heldPlan(h.state)?.valid, true);
h = run(h, { type: 'press', ...pt(14.5, 10.5) }, { type: 'release' });
assert.equal(h.state.walls.length, 10 + 10 - 2); // the shared wall (2 segments) is one wall now
assert.deepEqual(wall(h, 'y', 13, 10)?.paint, { before: 'paint-mint', after: 'paint-sky' }); // each room keeps its inside
assert.deepEqual(wall(h, 'y', 13, 11)?.paint, { before: 'paint-mint', after: 'paint-sky' });
assert.equal(wall(h, 'x', 14, 12)?.opening, 'wooden-door'); // the copy's door
ok('a pasted room shares a wall with its neighbor; each side keeps its own room\'s paint');

// a door on either side is kept; two different openings cannot be one wall
const doorOnShared = run(mintInside, { type: 'select', id: 'wooden-door' }, ...click(13.02, 10.5), { type: 'useSelect' });
assert.equal(wall(doorOnShared, 'y', 13, 10)?.opening, 'wooden-door');
h = run(doorOnShared, { type: 'paste' }, ...click(14.5, 10.5));
assert.equal(wall(h, 'y', 13, 10)?.opening, 'wooden-door');
assert.equal(h.state.walls.length, 18);
const windowCopy = run(world, { type: 'select', id: 'window' }, ...click(10.02, 10.5), { type: 'useSelect' }, ...markRoom, { type: 'copy' }, { type: 'cancel' });
assert.equal(wall(windowCopy, 'y', 10, 10)?.opening, 'window');
const clash = run(windowCopy, { type: 'select', id: 'wooden-door' }, ...click(13.02, 10.5), { type: 'useSelect' }, { type: 'paste' }, hover(14.5, 10.5));
assert.equal(heldPlan(clash.state)?.valid, false); // the copy's window would land on the door
ok('a door or window on either wall is kept; a window landing on a door cannot be placed');

// a wall cannot land on a fence
const fenced = run(world, { type: 'select', id: 'picket-fence' }, { type: 'setWallMode', mode: 'line' }, ...drag([13.02, 10.02], [13.02, 11.98]),
  { type: 'useSelect' }, ...markRoom, { type: 'copy' }, { type: 'cancel' });
assert.equal(heldPlan(run(fenced, { type: 'paste' }, hover(14.5, 10.5)).state)?.valid, false);
ok('a wall landing on a fence cannot be placed');

// moved rooms join too, and stay marked on the walls really in the world
h = run(mintInside, { type: 'select', id: 'plaster' }, { type: 'setWallMode', mode: 'square' }, ...drag([20.5, 10.5], [22.5, 11.5]), { type: 'useSelect' },
  ...drag([23.5, 12.5], [19.5, 9.5]), ...click(20.5, 10.5), ...click(13.5, 10.5)); // held by its west cell: lands on cells 13..15
assert.equal(h.state.selection?.kind, 'marked');
const marks = h.state.selection?.kind === 'marked' ? h.state.selection.targets : [];
assert.ok(marks.every((t) => t.kind !== 'wall' || h.state.walls.includes(t.target)));
assert.equal(h.state.walls.length, 18);
ok('a moved room joins its neighbor too, and its marks are the walls in the world');
