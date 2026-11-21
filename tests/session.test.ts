import { strict as assert } from 'node:assert';
import { type History, type HistoryAction, canRedo, canUndo, initialHistory, step, worldOf } from '../src/history.ts';
import { sizeOf } from '../src/geometry.ts';
import { type Session, chipState, cleanName, freeGameName, isDirty, newSession, piecesLeftOut, relativeTime } from '../src/session.ts';
import { pointToView } from '../src/view.ts';
import { emptyWorld, gameWorldOf } from '../src/world.ts';

const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
const pt = (x: number, y: number) => ({ cell: { x: Math.floor(x), y: Math.floor(y) }, point: { x, y } });
const drag = (a: [number, number], b: [number, number]): HistoryAction[] =>
  [{ type: 'hover', ...pt(...a) }, { type: 'press', ...pt(...a) }, { type: 'hover', ...pt(...b) }, { type: 'release' }];
const click = (x: number, y: number) => drag([x, y], [x, y]);
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

// ===== Names =====
assert.equal(freeGameName([]), 'Game 1');
assert.equal(freeGameName(['Game 1', 'Game 2']), 'Game 3');
assert.equal(freeGameName(['Game 2', 'My town']), 'Game 1');
assert.equal(freeGameName(['Game 1', 'Game 3']), 'Game 2');
assert.equal(cleanName('  Town  ', 'Game 1'), 'Town');
assert.equal(cleanName('   ', 'Game 1'), 'Game 1');
assert.equal(cleanName('x'.repeat(60), 'Game 1').length, 40);
assert.equal(cleanName(`${'x'.repeat(39)} tail`, 'Game 1'), 'x'.repeat(39)); // trimmed again after the cut
ok('free game names take the lowest number, and names are trimmed to 40 with a fallback');

// ===== Relative times =====
const T = 1_000_000_000_000, min = 60_000, hour = 60 * min, day = 24 * hour;
const ago = (ms: number) => relativeTime(T - ms, T);
assert.equal(ago(0), 'just now');
assert.equal(ago(59_999), 'just now');
assert.equal(ago(min), '1 min ago');
assert.equal(ago(59 * min + 59_000), '59 min ago');
assert.equal(ago(hour), '1 h ago');
assert.equal(ago(23 * hour + 59 * min), '23 h ago');
assert.equal(ago(day), 'yesterday');
assert.equal(ago(2 * day - 1), 'yesterday');
assert.equal(ago(2 * day), '2 days ago');
assert.equal(ago(10 * day), '10 days ago');
assert.equal(relativeTime(T + 5 * min, T), 'just now'); // a clock that went back
ok('relative times: just now, N min, N h, yesterday, N days');

// ===== Dirty =====
const fresh = newSession('Game 1', 3);
assert.equal(isDirty(fresh, initialHistory.committed), false);
let h = run(initialHistory, { type: 'select', id: 'crate' }, ...click(5.5, 5.5), { type: 'useSelect' });
assert.equal(isDirty(fresh, h.committed), true);
const saved: Session = { ...fresh, gameId: 1, saved: h.committed, savedAt: T };
assert.equal(isDirty(saved, h.committed), false);
// lifting a piece and putting it back is no change
let lifted = run(h, ...click(5.5, 5.5));
assert.equal(lifted.state.objects.length, 0);
assert.equal(isDirty(saved, lifted.committed), false, 'while it is held, the committed world is untouched');
lifted = run(lifted, ...click(5.5, 5.5));
assert.equal(lifted.state.objects.length, 1);
assert.notEqual(lifted.committed, h.committed);
assert.equal(isDirty(saved, lifted.committed), false, 'put back where it was');
// moved is a change, and moved back is not
const moved = run(h, ...click(5.5, 5.5), ...click(9.5, 9.5));
assert.equal(isDirty(saved, moved.committed), true);
assert.equal(isDirty(saved, run(moved, ...click(9.5, 9.5), ...click(5.5, 5.5)).committed), false);
// the build facing alone does not count
assert.equal(isDirty(saved, run(h, { type: 'rotate' }, { type: 'rotate' }).committed), false);
// undo back to an empty never-saved game is clean; a game saved empty is dirty once built on
assert.equal(isDirty(fresh, step(h, { type: 'undo' }).committed), false);
assert.equal(isDirty({ ...fresh, saved: initialHistory.committed, gameId: 1, savedAt: T }, h.committed), true);
// a never-saved game with only a build facing changed is still clean
assert.equal(isDirty(fresh, run(initialHistory, { type: 'rotate' }).committed), false);
ok('dirty: an empty new game is clean; lift and put back is clean; moved, built or erased is dirty');

// ===== What the chip says =====
const chip = (s: Session, dirty: boolean, now = T, notice: string | null = null) => chipState(s, dirty, now, notice);
assert.deepEqual(chip(fresh, false), { kind: 'saved', text: 'Not saved yet' });
assert.deepEqual(chip(saved, false, T), { kind: 'saved', text: 'Saved just now' });
assert.deepEqual(chip(saved, false, T + 3 * min), { kind: 'saved', text: 'Saved 3 min ago' });
assert.deepEqual(chip(saved, true), { kind: 'unsaved', text: 'Unsaved changes' });
assert.deepEqual(chip({ ...saved, problem: 'full' }, true), { kind: 'problem', text: "Couldn't save, storage full" });
assert.deepEqual(chip({ ...saved, problem: 'full' }, true, T, piecesLeftOut(3)), { kind: 'notice', text: 'Loaded, 3 pieces left out' });
assert.equal(piecesLeftOut(1), 'Loaded, 1 piece left out');
ok('the chip says Saved, Saved N min ago, Unsaved changes, the storage problem, or a notice');

// ===== Replacing the world =====
const WIDE = sizeOf(40, 20);
const SQ = sizeOf(64, 64);
const v1 = (size: typeof SQ, x: number, y: number): [number, number] => { const p = pointToView({ x, y }, 1, size); return [p.x, p.y]; };
const room = run(initialHistory,
  { type: 'select', id: 'plaster' }, { type: 'setWallMode', mode: 'square' }, ...drag([10.5, 10.5], [12.5, 11.5]),
  { type: 'select', id: 'paint-sky' }, { type: 'setShift', held: true }, ...click(11.5, 10.2), { type: 'setShift', held: false },
  { type: 'select', id: 'wooden-door' }, ...click(11.5, 12.02),
  { type: 'select', id: 'crate' }, ...click(10.5, 10.5), { type: 'select', id: 'chair' }, ...click(12.5, 11.5),
  { type: 'useSelect' });
const roomPieces = room.state.walls.length + room.state.objects.length + room.state.tiles.length;
assert.ok(roomPieces > 10 && canUndo(room));

h = run(room, { type: 'rotateView', dir: 1 }, { type: 'toggleGrid' }, { type: 'setWallView', view: 'down' }, ...drag(v1(SQ, 13.5, 9.5), v1(SQ, 9.5, 12.5)), { type: 'saveBlueprint' },
  { type: 'copy' }, { type: 'cancel' }, { type: 'undo' }, { type: 'redo' }, { type: 'toggleBulldoze' });
h = { ...h, state: { ...h.state, guides: [{ axis: 'x', at: 50 }] } };
assert.ok(canUndo(h) && h.state.clipboard && h.state.blueprints.length === 1 && h.state.guides.length === 1);
const undone = step(h, { type: 'undo' });
assert.ok(canRedo(undone));
const target = { ...emptyWorld(WIDE), nextId: 7, rotation: 2 as const };
const swapped = step(undone, { type: 'replaceWorld', world: target });
assert.equal(swapped.past.length, 0); assert.equal(swapped.future.length, 0);
assert.equal(canUndo(swapped), false); assert.equal(canRedo(swapped), false);
assert.deepEqual(swapped.committed, worldOf(swapped.state));
assert.equal(swapped.state.size, WIDE);
assert.equal(swapped.state.objects.length + swapped.state.walls.length + swapped.state.tiles.length, 0);
assert.equal(swapped.state.nextId, 7); assert.equal(swapped.state.rotation, 2);
assert.equal(swapped.state.view, 1, 'the camera turn stays');
assert.equal(swapped.state.clipboard, h.state.clipboard);
assert.equal(swapped.state.blueprints, h.state.blueprints);
assert.equal(swapped.state.tool, 'bulldoze'); assert.equal(swapped.state.showGrid, false); assert.equal(swapped.state.wallView, 'down');
assert.deepEqual(swapped.state.guides, []);
assert.equal(swapped.state.selection, null); assert.equal(swapped.state.drag, null);
assert.equal(swapped.state.hover, null); assert.equal(swapped.state.point, null);
assert.equal(step(swapped, { type: 'undo' }), swapped);
assert.deepEqual(gameWorldOf(swapped.state), target);
ok('replaceWorld swaps the world, starts the history afresh, and keeps the camera turn, clipboard and settings');

// in the middle of a move or a drag, the swap settles first and nothing is carried over
const carrying = run(room, ...click(10.5, 10.5)); // lifted a crate
assert.ok(carrying.state.selection);
const afterCarry = step(carrying, { type: 'replaceWorld', world: emptyWorld(sizeOf(64, 64)) });
assert.equal(afterCarry.state.selection, null);
assert.equal(afterCarry.state.objects.length, 0);
const dragging = run(room, { type: 'select', id: 'stone' }, { type: 'hover', ...pt(1.5, 1.5) }, { type: 'press', ...pt(1.5, 1.5) });
assert.ok(dragging.state.drag);
assert.equal(step(dragging, { type: 'replaceWorld', world: emptyWorld(sizeOf(16, 16)) }).state.drag, null);
ok('replaceWorld settles a move or a drag in progress');

// ===== A clipboard carried to another map size =====
// Copied on the 64x64 map from view 1, pasted on a 40x20 map from view 1: same arrangement, nothing stale
const layout = (h: History) => {
  const ws = h.state.walls, os = h.state.objects, ts = h.state.tiles;
  const x0 = Math.min(...ws.map((w) => w.x)), y0 = Math.min(...ws.map((w) => w.y));
  return [
    ...ws.map((w) => `wall ${w.axis} ${w.x - x0},${w.y - y0} ${w.opening} ${w.paint.before}/${w.paint.after}`),
    ...os.map((o) => `object ${o.defId} ${o.x - x0},${o.y - y0} ${o.w}x${o.h} r${o.rotation}`),
    ...ts.map((t) => `tile ${t.defId} ${t.x - x0},${t.y - y0}`),
  ].sort();
};
const copied = run(room, { type: 'rotateView', dir: 1 }, ...drag(v1(SQ, 13.5, 9.5), v1(SQ, 9.5, 12.5)), { type: 'copy' });
assert.ok(copied.state.clipboard);
const there = step(copied, { type: 'replaceWorld', world: emptyWorld(WIDE) });
assert.equal(there.state.view, 1);
const pasted = run(there, { type: 'paste' }, ...click(...v1(WIDE, 20.5, 10.5)));
assert.equal(pasted.state.walls.length, room.state.walls.length);
assert.equal(pasted.state.objects.length, room.state.objects.length);
assert.deepEqual(layout(pasted), layout(room));
assert.equal(pasted.state.walls.filter((w) => w.opening === 'wooden-door').length, 1);
assert.ok(pasted.state.walls.every((w) => w.x >= 0 && w.y >= 0 && w.x <= 40 && w.y <= 20));
// and back again: a copy made on the small map pastes whole on a big one
const wideCopy = run(pasted, ...drag(v1(WIDE, 23.5, 9.5), v1(WIDE, 19.5, 12.5)), { type: 'copy' });
const bigAgain = run(step(wideCopy, { type: 'replaceWorld', world: emptyWorld(sizeOf(100, 80)) }), { type: 'paste' }, ...click(...v1(sizeOf(100, 80), 60.5, 40.5)));
assert.deepEqual(layout(bigAgain), layout(room));
ok('a clipboard copied in view 1 on one map size pastes in the same arrangement on another size');
console.log('all passed');
