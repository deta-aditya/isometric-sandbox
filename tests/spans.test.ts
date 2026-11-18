import { strict as assert } from 'node:assert';
import { type History, type HistoryAction, initialHistory, step } from '../src/history.ts';
import { openingRun, wallAt } from '../src/world.ts';

const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
// pointer exactly on the horizontal grid line y=Y, in the middle of segment x
const onX = (x: number, Y: number) => ({ cell: { x, y: Y }, point: { x: x + 0.5, y: Y } });
const hov = (x: number, Y: number): HistoryAction => ({ type: 'hover', ...onX(x, Y) });
const prs = (x: number, Y: number): HistoryAction => ({ type: 'press', ...onX(x, Y) });
const rel: HistoryAction = { type: 'release' };
const openings = (h: History, Y = 5, from = 0, to = 12) =>
  Array.from({ length: to - from }, (_, i) => wallAt(h.state, { axis: 'x', x: from + i, y: Y })?.opening ?? '-');
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

// a 12-segment plaster wall along y=5
const wall: History = run(initialHistory, { type: 'select', id: 'plaster' },
  { type: 'hover', cell: { x: 0, y: 5 }, point: { x: 0, y: 5 } }, { type: 'press', cell: { x: 0, y: 5 }, point: { x: 0, y: 5 } },
  { type: 'hover', cell: { x: 12, y: 5 }, point: { x: 12, y: 5 } }, rel);
assert.equal(wall.state.walls.length, 12);

const span = (h: History, id: string, a: number, b: number) => run(h, { type: 'select', id }, hov(a, 5), prs(a, 5), hov(b, 5), rel);

// 1. lengths 2, 3, 5 compose start/middle*/end; drag direction does not matter
let h = span(wall, 'long-door', 1, 2);
assert.deepEqual(openings(h).slice(1, 3), ['long-door:start', 'long-door:end']);
h = span(wall, 'long-door', 6, 4);
assert.deepEqual(openings(h).slice(4, 7), ['long-door:start', 'long-door:middle', 'long-door:end']);
h = span(wall, 'long-window', 2, 6);
assert.deepEqual(openings(h).slice(2, 7), ['long-window:start', 'long-window:middle', 'long-window:middle', 'long-window:middle', 'long-window:end']);
ok('spans of 2, 3 and 5 compose start / middle* / end, either drag direction');

// 2. a 1-segment drag places nothing; off-wall segments make the span invalid
h = span(wall, 'long-door', 3, 3); assert.equal(h.state.walls.filter((w) => w.opening).length, 0);
h = span(wall, 'long-arch', 10, 13); assert.equal(h.state.walls.filter((w) => w.opening).length, 0, 'segment 12 has no wall');
ok('one segment, or a run past the end of the wall, places nothing');

// 3. adjacent spans of the same kind stay separate
h = span(span(wall, 'long-door', 1, 2), 'long-door', 3, 5);
const at = (x: number) => wallAt(h.state, { axis: 'x', x, y: 5 })!;
assert.equal(openingRun(h.state, at(2)).length, 2); assert.equal(openingRun(h.state, at(4)).length, 3);
ok('two neighboring long doors are found as separate spans');

// 4. bulldozing any piece removes the whole span, and only that span
h = run(h, { type: 'toggleBulldoze' }, prs(4, 5), rel);
assert.deepEqual(openings(h).slice(1, 6), ['long-door:start', 'long-door:end', '-', '-', '-']);
ok('bulldozing a middle piece removes its whole span only');

// 5. building a plain opening over part of a span replaces the whole span
h = run(span(wall, 'long-window', 2, 5), { type: 'select', id: 'wooden-door' }, hov(3, 5), prs(3, 5));
assert.deepEqual(openings(h).slice(2, 6), ['-', 'wooden-door', '-', '-']);
ok('a plain door built over a span removes the span, no half-spans left');

// 6. picker copies the tray item from any piece
h = run(span(wall, 'long-arch', 1, 4), { type: 'togglePicker' }, prs(2, 5));
assert.equal(h.state.selectedId, 'long-arch'); assert.equal(h.state.tool, 'build');
ok('picker on a piece selects the Long arch item');

// 7. select moves a span whole; needs an equally long empty run; Esc puts it back
h = run(span(wall, 'long-door', 1, 3), { type: 'useSelect' }, prs(2, 5));
assert.equal(h.state.walls.filter((w) => w.opening).length, 0, 'lifted whole');
assert.equal(h.state.selection?.kind === 'opening' && h.state.selection.openingIds.length, 3);
h = run(h, hov(10, 5), prs(10, 5)); assert.ok(h.state.selection, 'only 2 wall segments left at 10..11: refused');
h = run(h, { type: 'cancel' }); assert.deepEqual(openings(h).slice(1, 4), ['long-door:start', 'long-door:middle', 'long-door:end']);
h = run(h, prs(1, 5), hov(7, 5), prs(7, 5));
assert.deepEqual(openings(h), ['-', '-', '-', '-', '-', '-', '-', 'long-door:start', 'long-door:middle', 'long-door:end', '-', '-']);
ok('select lifts a span whole, refuses a short run, puts back on Esc, drops on a free run');

// 8. a moved span is one undo step
const before = h.past.length; h = step(h, { type: 'undo' });
assert.deepEqual(openings(h).slice(1, 4), ['long-door:start', 'long-door:middle', 'long-door:end']); assert.equal(h.past.length, before - 1);
ok('moving a span undoes in one step');
console.log('all passed');
