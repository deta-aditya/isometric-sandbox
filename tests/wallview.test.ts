import { strict as assert } from 'node:assert';
import { type History, type HistoryAction, initialHistory, step } from '../src/history.ts';
import { buildDrawables } from '../src/render/drawables.ts';
import { CUT_WALL_H, WALL_H } from '../src/config.ts';
const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
const at = (x: number, y: number) => ({ cell: { x, y }, point: { x: x + 0.5, y: y + 0.5 } });
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

// a 3x2 room at (10,10), plus a free-standing wall run elsewhere
let h = run(initialHistory, { type: 'select', id: 'plaster' }, { type: 'setWallMode', mode: 'square' },
  { type: 'hover', ...at(10, 10) }, { type: 'press', ...at(10, 10) }, { type: 'hover', ...at(12, 11) }, { type: 'release' },
  { type: 'setWallMode', mode: 'line' }, { type: 'hover', cell: { x: 20, y: 5 }, point: { x: 20, y: 5 } },
  { type: 'press', cell: { x: 20, y: 5 }, point: { x: 20, y: 5 } }, { type: 'hover', cell: { x: 23, y: 5 }, point: { x: 23, y: 5 } }, { type: 'release' },
  { type: 'useSelect' });
const heights = (h: History) => {
  const walls = buildDrawables(h.state).sorted.filter((d) => d.kind === 'wall') as { x: number; y: number; axis: string; height: number }[];
  const room = walls.filter((w) => w.x <= 13 && w.y <= 12);
  const front = room.filter((w) => (w.axis === 'x' && w.y === 12) || (w.axis === 'y' && w.x === 13));
  const back = room.filter((w) => (w.axis === 'x' && w.y === 10) || (w.axis === 'y' && w.x === 10));
  const lone = walls.filter((w) => w.y === 5);
  const uniq = (ws: { height: number }[]) => [...new Set(ws.map((w) => w.height))];
  return { front: uniq(front), back: uniq(back), lone: uniq(lone) };
};
assert.deepEqual(heights(h), { front: [CUT_WALL_H], back: [WALL_H], lone: [WALL_H] });
ok('cutaway (default): room fronts cut, back walls and lone walls full');

const up = step(h, { type: 'setWallView', view: 'up' });
assert.deepEqual(heights(up), { front: [WALL_H], back: [WALL_H], lone: [WALL_H] });
ok('walls up: every wall full height');

const down = step(h, { type: 'setWallView', view: 'down' });
assert.deepEqual(heights(down), { front: [CUT_WALL_H], back: [CUT_WALL_H], lone: [CUT_WALL_H] });
ok('walls down: every wall cut low');

const roof = run(down, { type: 'setLevel', level: 1 });
assert.deepEqual(heights(roof), { front: [WALL_H], back: [WALL_H], lone: [WALL_H] });
ok('roof view shows full walls whatever the wall view');

assert.equal(down.past.length, h.past.length, 'no undo step'); assert.equal(step(down, { type: 'undo' }).state.wallView, 'down');
ok('changing the wall view is not an undo step, and undo leaves it alone');
console.log('all passed');
