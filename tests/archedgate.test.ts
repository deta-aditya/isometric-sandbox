import { strict as assert } from 'node:assert';
import { getItem, getOpeningDef } from '../src/catalog.ts';
import { type History, type HistoryAction, initialHistory, step } from '../src/history.ts';
const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
const pt = (x: number, y: number) => ({ cell: { x: Math.floor(x), y: Math.floor(y) }, point: { x, y } });
const drag = (a: [number, number], b: [number, number]): HistoryAction[] =>
  [{ type: 'hover', ...pt(...a) }, { type: 'press', ...pt(...a) }, { type: 'hover', ...pt(...b) }, { type: 'release' }];
const openings = (h: History, y: number) =>
  h.state.walls.filter((w) => w.axis === 'x' && w.y === y).sort((a, b) => a.x - b.x).map((w) => w.opening);
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

// the item: a gate in Building > Gates, with start / middle / end pieces that all carry the arch
const item = getItem('arched-gate');
assert.equal(item.kind, 'opening');
assert.ok(item.kind === 'opening' && item.gate && item.pieces);
for (const role of ['start', 'middle', 'end'] as const) {
  const p = getOpeningDef(`arched-gate:${role}`);
  assert.equal(p.role, role);
  assert.ok(p.arch && p.arch.spring + p.arch.rise > p.arch.pillarHeight - 10, 'the arch tops the pillars');
  assert.ok(p.top < p.arch.spring, 'the leaves stay under the arch');
}
assert.ok(getOpeningDef('arched-gate:start').from > 0 && getOpeningDef('arched-gate:end').to < 1);
ok('the arched gate is a span of pieces that all know the arch and their role');

// placed along a fence like the wide gate: one piece per segment, start and end at the outer ends
let h = run(initialHistory, { type: 'select', id: 'picket-fence' }, { type: 'setWallMode', mode: 'line' }, ...drag([10, 10], [17, 10]));
assert.equal(h.state.walls.length, 7);
h = run(h, { type: 'select', id: 'arched-gate' }, ...drag([11.5, 10.02], [14.5, 10.02]));
assert.deepEqual(openings(h, 10), [null, 'arched-gate:start', 'arched-gate:middle', 'arched-gate:middle', 'arched-gate:end', null, null]);
// a two-segment gate is just the two halves of the arch
h = run(h, ...drag([15.5, 10.02], [16.5, 10.02]));
assert.deepEqual(openings(h, 10).slice(5), ['arched-gate:start', 'arched-gate:end']);
ok('it goes along fences like the wide gate, two segments or more');

// it does not go on a wall
h = run(initialHistory, { type: 'select', id: 'plaster' }, { type: 'setWallMode', mode: 'line' }, ...drag([10, 10], [14, 10]),
  { type: 'select', id: 'arched-gate' }, ...drag([10.5, 10.02], [12.5, 10.02]));
assert.ok(openings(h, 10).every((o) => o === null));
ok('it stays off walls');
