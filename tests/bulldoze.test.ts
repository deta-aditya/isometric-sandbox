import { strict as assert } from 'node:assert';
import { type History, type HistoryAction, canUndo, initialHistory, step } from '../src/history.ts';
import { bulldozePlan } from '../src/world.ts';
const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
const pt = (x: number, y: number) => ({ cell: { x: Math.floor(x), y: Math.floor(y) }, point: { x, y } });
const click = (x: number, y: number): HistoryAction[] => [{ type: 'hover', ...pt(x, y) }, { type: 'press', ...pt(x, y) }, { type: 'release' }];
const drag = (a: [number, number], b: [number, number]): HistoryAction[] =>
  [{ type: 'hover', ...pt(...a) }, { type: 'press', ...pt(...a) }, { type: 'hover', ...pt(...b) }, { type: 'release' }];
const place = (id: string, x: number, y: number): HistoryAction[] => [{ type: 'select', id }, ...click(x + 0.5, y + 0.5)];
const square = (id: string, x0: number, y0: number, x1: number, y1: number): HistoryAction[] => [
  { type: 'select', id }, { type: 'setWallMode', mode: 'square' }, ...drag([x0 + 0.5, y0 + 0.5], [x1 + 0.5, y1 + 0.5]),
];
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

// a walled room at 10..13 x 10..12 (auto floor), with a sofa and a tree inside, plus a tree outside
const setup = run(initialHistory, ...square('plaster', 10, 10, 13, 12), ...place('armchair', 11, 11), ...place('oak', 12, 11),
  ...place('oak', 20, 20), { type: 'cancel' });
const base = setup.state;
assert.equal(base.objects.length, 3);
assert.ok(base.tiles.length >= 12);
const wallsBefore = base.walls.length;

// a box drag removes everything inside it, in one undo step
let h = run(setup, { type: 'toggleBulldoze' }, ...drag([10.5, 10.5], [13.5, 12.5]));
assert.equal(h.state.objects.length, 1, 'only the outside tree is left');
assert.equal(h.state.tiles.length, 0);
assert.equal(h.state.walls.length, 0, 'the room walls sit on the box edge and go too');
h = step(h, { type: 'undo' });
assert.equal(h.state.objects.length, 3);
assert.equal(h.state.walls.length, wallsBefore);
ok('dragging a box removes everything in it, in one undo step');

// a box on the ground beside the room leaves the room's wall alone, even on the box's edge
h = run(setup, { type: 'toggleBulldoze' }, ...drag([14.5, 10.5], [16.5, 12.5]));
assert.equal(h.state.walls.length, wallsBefore);
ok('a box beside a building does not take its walls');

// the filter keeps the kinds switched off
h = run(setup, { type: 'toggleBulldoze' }, { type: 'toggleBulldozeFilter', category: 'building' }, { type: 'toggleBulldozeFilter', category: 'flooring' },
  ...drag([10.5, 10.5], [13.5, 12.5]));
assert.equal(h.state.objects.length, 1);
assert.equal(h.state.walls.length, wallsBefore);
assert.equal(h.state.tiles.length, base.tiles.length);
ok('with Building and Flooring off, a box clears only the furniture and scenery');

// a click still removes just the one thing under the pointer, walls included
h = run(setup, { type: 'toggleBulldoze' }, ...click(11.5, 10.03));
assert.equal(h.state.walls.length, wallsBefore - 1);
assert.equal(h.state.objects.length, 3);
ok('a click removes the single thing under the pointer');

// Shift + click clears the whole room, walls included (Building on)
h = run(setup, { type: 'toggleBulldoze' }, { type: 'setShift', held: true }, { type: 'hover', ...pt(11.5, 11.5) });
const plan = bulldozePlan(h.state);
assert.equal(plan?.room?.length, 12);
h = run(h, { type: 'press', ...pt(11.5, 11.5) }, { type: 'release' });
assert.equal(h.state.objects.length, 1, 'the outside tree stays');
assert.equal(h.state.tiles.length, 0);
assert.equal(h.state.walls.length, 0);
assert.ok(canUndo(h));
ok('Shift + click clears the room under the pointer, leaving the outdoors alone');

// Shift + click with only Furniture on empties the room but keeps its walls and floor
h = run(setup, { type: 'toggleBulldoze' }, { type: 'toggleBulldozeFilter', category: 'building' },
  { type: 'toggleBulldozeFilter', category: 'flooring' }, { type: 'toggleBulldozeFilter', category: 'scenery' },
  { type: 'setShift', held: true }, ...click(11.5, 11.5));
assert.equal(h.state.objects.length, 2, 'the armchair goes; both trees stay');
assert.equal(h.state.walls.length, wallsBefore);
ok('a room clear follows the filter');

// outdoors, Shift + click does nothing
h = run(setup, { type: 'toggleBulldoze' }, { type: 'setShift', held: true }, { type: 'hover', ...pt(20.5, 20.5) });
assert.equal(bulldozePlan(h.state)?.outdoors, true);
h = run(h, { type: 'press', ...pt(20.5, 20.5) }, { type: 'release' });
assert.equal(h.state.objects.length, 3);
ok('outdoors is not a room, so Shift + click removes nothing');

// the filter is a tool setting, not an undo step
h = run(initialHistory, { type: 'toggleBulldoze' }, { type: 'toggleBulldozeFilter', category: 'scenery' });
assert.equal(canUndo(h), false);
ok('switching the filter is not an undo step');
