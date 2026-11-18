import { strict as assert } from 'node:assert';
import { type History, type HistoryAction, canRedo, canUndo, initialHistory, step } from '../src/history.ts';

const run = (h: History, ...actions: HistoryAction[]) => actions.reduce(step, h);
const at = (x: number, y: number) => ({ cell: { x, y }, point: { x: x + 0.5, y: y + 0.5 } });
const vertex = (x: number, y: number) => ({ cell: { x, y }, point: { x, y } });
const press = (x: number, y: number): HistoryAction => ({ type: 'press', ...at(x, y) });
const hover = (x: number, y: number): HistoryAction => ({ type: 'hover', ...at(x, y) });
const release: HistoryAction = { type: 'release' };
const undo: HistoryAction = { type: 'undo' };
const redo: HistoryAction = { type: 'redo' };
const counts = (h: History) => ({ o: h.state.objects.length, t: h.state.tiles.length, w: h.state.walls.length });
let n = 0; const ok = (name: string) => console.log(`ok ${++n} - ${name}`);

// 1. place, undo, redo
let h = run(initialHistory, { type: 'select', id: 'crate' }, hover(5, 5), press(5, 5));
assert.deepEqual(counts(h), { o: 1, t: 0, w: 0 }); assert.ok(canUndo(h));
h = step(h, undo); assert.equal(h.state.objects.length, 0); assert.ok(canRedo(h)); assert.equal(h.state.tool, 'build');
h = step(h, redo); assert.equal(h.state.objects.length, 1); assert.ok(!canRedo(h));
ok('place, undo, redo; undo keeps the tool');

// 2. a paint stroke is one step
h = run(initialHistory, { type: 'select', id: 'stone' }, hover(1, 1), press(1, 1), hover(2, 1), hover(3, 1), hover(4, 1), release);
assert.equal(h.state.tiles.length, 4); assert.equal(h.past.length, 1);
h = step(h, undo); assert.equal(h.state.tiles.length, 0);
ok('a 4-tile paint stroke undoes in one step');

// 3. a room drag is one step, including its automatic floor
h = run(initialHistory, { type: 'select', id: 'brick' }, { type: 'setWallMode', mode: 'square' }, hover(10, 10), press(10, 10), hover(12, 11), release);
assert.deepEqual(counts(h), { o: 0, t: 6, w: 10 }); assert.equal(h.past.length, 1);
h = step(h, undo); assert.deepEqual(counts(h), { o: 0, t: 0, w: 0 });
ok('room with auto floor undoes in one step');

// 4. a move is one step; pick up + Esc records nothing
h = run(initialHistory, { type: 'select', id: 'crate' }, hover(5, 5), press(5, 5), { type: 'useSelect' });
const before = h.past.length;
h = run(h, press(5, 5)); assert.equal(h.state.objects.length, 0); assert.equal(h.past.length, before, 'lifting is not a step');
h = run(h, { type: 'cancel' }); assert.equal(h.state.objects.length, 1); assert.equal(h.past.length, before, 'put back is not a step');
h = run(h, press(5, 5), hover(8, 8), press(8, 8)); assert.equal(h.past.length, before + 1);
assert.deepEqual([h.state.objects[0]?.x, h.state.objects[0]?.y], [8, 8]);
h = step(h, undo); assert.deepEqual([h.state.objects[0]?.x, h.state.objects[0]?.y], [5, 5]);
ok('move is one step, cancelled pick-up is none');

// 5. undo while carrying puts the item back first, then undoes the previous change
h = run(initialHistory, { type: 'select', id: 'crate' }, hover(1, 1), press(1, 1), hover(3, 3), press(3, 3), { type: 'useSelect' }, press(3, 3));
assert.equal(h.state.objects.length, 1); // one placed, one carried
h = step(h, undo); assert.equal(h.state.objects.length, 1); assert.equal(h.state.selection, null);
assert.deepEqual([h.state.objects[0]?.x, h.state.objects[0]?.y], [1, 1]);
ok('undo while carrying settles first, nothing lost or duplicated');

// 6. new change after undo clears redo
h = run(initialHistory, { type: 'select', id: 'crate' }, hover(1, 1), press(1, 1), undo);
assert.ok(canRedo(h)); h = run(h, hover(2, 2), press(2, 2)); assert.ok(!canRedo(h));
ok('a new change after undo clears redo');

// 7. wall run and bulldoze sweep, opening move
h = run(initialHistory, { type: 'select', id: 'plaster' }, { type: 'hover', ...vertex(0, 4) }, { type: 'press', ...vertex(0, 4) }, { type: 'hover', ...vertex(5, 4) }, release);
assert.equal(h.state.walls.length, 5); assert.equal(h.past.length, 1);
h = run(h, { type: 'select', id: 'stone' }, hover(0, 6), press(0, 6), hover(1, 6), hover(2, 6), release, { type: 'toggleBulldoze' }, press(0, 6), hover(1, 6), hover(2, 6), release);
assert.equal(h.state.tiles.length, 0); assert.equal(h.past.length, 3);
h = step(h, undo); assert.equal(h.state.tiles.length, 3);
ok('wall run is one step; bulldoze sweep is one step');

// 8. history is capped
h = run(initialHistory, { type: 'select', id: 'crate' });
for (let i = 0; i < 120; i++) h = run(h, hover(i % 32, Math.floor(i / 32)), press(i % 32, Math.floor(i / 32)));
assert.equal(h.past.length, 100);
ok('history keeps the last 100 steps');
console.log('all passed');
