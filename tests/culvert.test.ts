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

// #17d: culverts go only across a channel's end, and each tile's stonework takes its shape from the channel
{
  const { culvertFits, culvertShape } = await import('../src/world.ts');
  const s = h.state; // the 3 wide canal above (y 0..2, x 2..7); y 0 lies on the map's north edge
  // its west end (the y line at x = 2) takes culverts; its long south side (the x line at y = 3) does not
  [0, 1, 2].forEach((y) => assert.ok(culvertFits(s, { axis: 'y', x: 2, y }), `west end at y ${y}`));
  [2, 4, 7].forEach((x) => assert.ok(!culvertFits(s, { axis: 'x', x, y: 3 }), `south side at x ${x}`));
  ok('a culvert fits across a channel\'s end but not along its side, even at a corner');

  // across the 3 wide end: an L at each corner, the back wall alone in the middle
  const shape = (y: number) => {
    const p = culvertShape(s, { axis: 'y', x: 2, y })!;
    return `${p.back}:${p.before ? 'B' : '-'}${p.after ? 'A' : '-'}`;
  };
  assert.deepEqual([0, 1, 2].map(shape), ['west:B-', 'west:--', 'west:-A']);
  ok('across a wide end the corners are Ls and the middle is a back wall alone, also when placed alone');

  // a 1 wide stream (x 12, y 4..9): its north end is a U
  let k = run(h, { type: 'select', id: 'stream' }, { type: 'hover', ...pt(12.5, 4.5) }, { type: 'press', ...pt(12.5, 4.5) },
    { type: 'hover', ...pt(12.5, 9.5) }, { type: 'release' });
  const u = culvertShape(k.state, { axis: 'x', x: 12, y: 4 })!;
  assert.ok(culvertFits(k.state, { axis: 'x', x: 12, y: 4 }) && u.back === 'north' && u.before && u.after);
  assert.ok(!culvertFits(k.state, { axis: 'y', x: 12, y: 6 }), 'not on its side');
  k = run(k, { type: 'select', id: 'culvert' }, { type: 'hover', ...pt(12.5, 4.03) }, { type: 'press', ...pt(12.5, 4.03) }, { type: 'release' });
  assert.equal(k.state.culverts.length, 4);
  ok('a 1 wide stream\'s end takes a U, and placing one there works');
}
