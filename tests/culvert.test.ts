import { strict as assert } from 'node:assert';
import { type History, type HistoryAction, initialHistory, step } from '../src/history.ts';
const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
const pt = (x: number, y: number): Omit<Extract<HistoryAction, { type: 'press' }>, 'type'> => ({ cell: { x: Math.floor(x), y: Math.floor(y) }, point: { x, y } });
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

// a canal 3 wide (y 0..2) and 6 long (x 2..7), painted cell by cell
const cells = [0, 1, 2].flatMap((y) => [2, 3, 4, 5, 6, 7].map((x) => [x, y] as const));
let h = run(initialHistory, { type: 'select', id: 'canal' }, { type: 'hover', ...pt(2.5, 0.5) }, { type: 'press', ...pt(2.5, 0.5) },
  ...cells.map(([x, y]): HistoryAction => ({ type: 'hover', ...pt(x + 0.5, y + 0.5) })), { type: 'release' });
const water = h.state.tiles;
assert.equal(water.length, 18);

// dragging along the canal's west end bank (the y-axis grid line at x = 2) lays the whole run
h = run(h, { type: 'select', id: 'culvert' }, { type: 'hover', ...pt(2.03, 0.5) }, { type: 'press', ...pt(2.03, 0.5) },
  { type: 'hover', ...pt(1.98, 2.4) }, { type: 'release' });
assert.equal(h.state.culverts.length, 3);
assert.ok(h.state.culverts.every((e) => e.axis === 'y' && e.x === 2));
assert.equal(h.state.tiles, water);
ok('a culvert goes on the bank, along the whole drag, and the water stays');

// a drag that runs past the bank onto plain ground places nothing
const before = h.state.culverts;
h = run(h, { type: 'hover', ...pt(8.02, 0.5) }, { type: 'press', ...pt(8.02, 0.5) }, { type: 'hover', ...pt(8.02, 4.5) }, { type: 'release' });
assert.equal(h.state.culverts, before);
ok('a run that leaves the bank places nothing');

// a grid line in the middle of the water is not a bank
h = run(h, { type: 'hover', ...pt(4.02, 1.5) }, { type: 'press', ...pt(4.02, 1.5) }, { type: 'release' });
assert.equal(h.state.culverts, before);
ok('open water is not a bank');

// bulldozing any piece removes the whole run; the canal is untouched
h = run(h, { type: 'toggleBulldoze' }, { type: 'hover', ...pt(2.02, 1.5) }, { type: 'press', ...pt(2.02, 1.5) }, { type: 'release' });
assert.equal(h.state.culverts.length, 0);
assert.equal(h.state.tiles, water);
ok('bulldozing a culvert removes the whole run and leaves the water');

h = run(h, { type: 'undo' });
assert.equal(h.state.culverts.length, 3);
ok('undo brings the whole run back in one step');
