import { strict as assert } from 'node:assert';
import { type History, type HistoryAction, initialHistory, step } from '../src/history.ts';
import { canopyCells, isInterior, wallHeight } from '../src/world.ts';
import { WALL_H } from '../src/config.ts';
const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
const pt = (x: number, y: number) => ({ cell: { x: Math.floor(x), y: Math.floor(y) }, point: { x, y } });
const drag = (a: [number, number], b: [number, number]): HistoryAction[] =>
  [{ type: 'hover', ...pt(...a) }, { type: 'press', ...pt(...a) }, { type: 'hover', ...pt(...b) }, { type: 'release' }];
const click = (x: number, y: number) => drag([x, y], [x, y]);
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);
const line: HistoryAction = { type: 'setWallMode', mode: 'line' };

// a walkway: a brick wall with a strip of poles beside it, closed at both ends
let h = run(initialHistory, { type: 'select', id: 'brick' }, line, ...drag([10, 10], [20, 10]),
  { type: 'select', id: 'pole' }, ...drag([10, 12], [20, 12]), ...drag([10, 10], [10, 12]), ...drag([20, 10], [20, 12]));
assert.ok(isInterior(h.state, { x: 12, y: 11 }), 'poles enclose like walls');
const covered = canopyCells(h.state.walls);
assert.equal(covered.size, 20, 'the 10 by 2 strip is covered');
assert.ok(covered.has('12,11') && !covered.has('12,9'));
ok('a strip ringed by poles (and a wall) is a room with a canopy');

// a room of solid walls has no canopy; a solid room next door keeps its own roof
h = run(h, { type: 'select', id: 'plaster' }, { type: 'setWallMode', mode: 'square' }, ...drag([30, 30], [34, 34]));
assert.ok(isInterior(h.state, { x: 31, y: 31 }));
assert.ok(!canopyCells(h.state.walls).has('31,31'));
ok('rooms of solid walls get no canopy');

// a pole on the edge of a solid room covers that room: a veranda opens it up
h = run(h, { type: 'select', id: 'pole' }, line, ...drag([30, 30], [34, 30]));
assert.ok(canopyCells(h.state.walls).has('31,31'), 'restyled to poles along one side');
ok('one pole wall on its edge gives a room a canopy');

// poles take no paint and no doors, and stand full height in every wall view
const before = h.state.walls.find((w) => w.axis === 'x' && w.x === 12 && w.y === 12)!;
h = run(h, { type: 'select', id: 'paint-cream' }, ...click(12.5, 12.1));
const after = h.state.walls.find((w) => w.axis === 'x' && w.x === 12 && w.y === 12)!;
assert.deepEqual(after.paint, before.paint);
h = run(h, { type: 'select', id: 'wooden-door' }, ...click(14.5, 12.02));
assert.equal(h.state.walls.find((w) => w.axis === 'x' && w.x === 14 && w.y === 12)?.opening, null);
for (const view of ['up', 'cutaway', 'down'] as const) {
  const s = run(h, { type: 'setWallView', view }).state;
  assert.equal(wallHeight(s, after), WALL_H, view);
}
ok('poles take no paint or doors and are never cut down');

// restyling a wall with a door to poles drops the door
h = run(initialHistory, { type: 'select', id: 'plaster' }, line, ...drag([5, 5], [8, 5]), { type: 'select', id: 'wooden-door' }, ...click(6.5, 5.02));
assert.equal(h.state.walls.find((w) => w.x === 6)?.opening, 'wooden-door');
h = run(h, { type: 'select', id: 'pole' }, ...drag([5, 5], [8, 5]));
assert.equal(h.state.walls.find((w) => w.x === 6)?.opening, null);
assert.equal(h.state.walls.find((w) => w.x === 6)?.styleId, 'pole');
ok('a door goes when its wall becomes poles');
