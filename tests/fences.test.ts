import { strict as assert } from 'node:assert';
import { type History, type HistoryAction, initialHistory, step } from '../src/history.ts';
import { interiorCells } from '../src/world.ts';
const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
const pt = (x: number, y: number) => ({ cell: { x: Math.floor(x), y: Math.floor(y) }, point: { x, y } });
const square = (x0: number, y0: number, x1: number, y1: number): HistoryAction[] => [
  { type: 'setWallMode', mode: 'square' }, { type: 'hover', ...pt(x0 + 0.5, y0 + 0.5) }, { type: 'press', ...pt(x0 + 0.5, y0 + 0.5) },
  { type: 'hover', ...pt(x1 + 0.5, y1 + 0.5) }, { type: 'release' },
];
const click = (x: number, y: number): HistoryAction[] => [{ type: 'hover', ...pt(x, y) }, { type: 'press', ...pt(x, y) }, { type: 'release' }];
const wall = (h: History, axis: 'x' | 'y', x: number, y: number) => h.state.walls.find((w) => w.axis === axis && w.x === x && w.y === y);
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

// a fenced square is not a room: no interior, no floor
let h = run(initialHistory, { type: 'select', id: 'picket-fence' }, ...square(2, 2, 4, 4));
assert.equal(h.state.walls.length, 12);
assert.equal(interiorCells(h.state.walls).size, 0);
assert.equal(h.state.tiles.length, 0);
ok('a fenced square builds like walls but forms no room and lays no floor');

// a gate goes on a fence; a door does not
h = run(h, { type: 'select', id: 'garden-gate' }, ...click(2.5, 2.02));
assert.equal(wall(h, 'x', 2, 2)?.opening, 'garden-gate');
h = run(h, { type: 'select', id: 'wooden-door' }, ...click(3.5, 2.02));
assert.equal(wall(h, 'x', 3, 2)?.opening, null);
ok('gates go on fences, doors do not');

// a gate does not go on a wall
h = run(h, { type: 'select', id: 'plaster' }, ...square(8, 2, 9, 3));
assert.ok(interiorCells(h.state.walls).size > 0);
h = run(h, { type: 'select', id: 'metal-gate' }, ...click(8.5, 2.02));
assert.equal(wall(h, 'x', 8, 2)?.opening, null);
ok('gates do not go on walls; walls still form rooms next to fences');

// restyling a wall with a door into a fence drops the door
h = run(h, { type: 'select', id: 'wooden-door' }, ...click(8.5, 2.02));
assert.equal(wall(h, 'x', 8, 2)?.opening, 'wooden-door');
h = run(h, { type: 'select', id: 'hedge-row' }, { type: 'setWallMode', mode: 'line' },
  { type: 'hover', ...pt(8.02, 2.02) }, { type: 'press', ...pt(8.02, 2.02) }, { type: 'hover', ...pt(9.98, 2.02) }, { type: 'release' });
assert.equal(wall(h, 'x', 8, 2)?.styleId, 'hedge-row');
assert.equal(wall(h, 'x', 8, 2)?.opening, null);
ok('turning a wall into a fence drops a door that no longer fits');
