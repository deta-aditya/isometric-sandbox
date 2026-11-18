import { strict as assert } from 'node:assert';
import { type History, type HistoryAction, initialHistory, step } from '../src/history.ts';
import { guideUnder, initialState } from '../src/world.ts';
const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
const pt = (x: number, y: number) => ({ cell: { x: Math.floor(x), y: Math.floor(y) }, point: { x, y } });
const drag = (a: [number, number], b: [number, number]): HistoryAction[] =>
  [{ type: 'hover', ...pt(...a) }, { type: 'press', ...pt(...a) }, { type: 'hover', ...pt(...b) }, { type: 'release' }];
const click = (x: number, y: number) => drag([x, y], [x, y]);
const guides = (h: History) => h.state.guides.map((g) => `${g.axis}${g.at}`).sort();
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);
const tool: HistoryAction = { type: 'toggleGuideTool' };

// pointing finds the nearest grid line, or a guide near the pointer first
assert.deepEqual(guideUnder(initialState, { x: 12.1, y: 7.6 }), { guide: { axis: 'x', at: 12 }, index: null });
assert.deepEqual(guideUnder(initialState, { x: 12.45, y: 7.9 }), { guide: { axis: 'y', at: 8 }, index: null });
assert.equal(guideUnder(initialState, { x: -3, y: 7 }), null); // off the map
ok('the guide tool points at the nearest grid line');

// the button (or Shift + G) turns the guide tool on; a click adds a guide, a click on it removes it
let h = run(initialHistory, tool);
assert.equal(h.state.tool, 'guide');
h = run(h, ...click(12.1, 7.6), ...click(30.4, 20.05));
assert.deepEqual(guides(h), ['x12', 'y20']);
assert.equal(h.past.length, 0);
assert.deepEqual(guideUnder(h.state, { x: 40.5, y: 20.2 }), { guide: { axis: 'y', at: 20 }, index: 1 });
h = run(h, ...click(12.25, 50.5)); // anywhere along it, within reach
assert.deepEqual(guides(h), ['y20']);
ok('click a grid line to add a guide, click a guide to remove it, outside undo');

// drag a guide to move it (snapping); a drag from a bare grid line makes one where it is let go
h = run(initialHistory, tool, ...click(12.1, 5.5), ...drag([12.1, 5.5], [20.2, 15]));
assert.deepEqual(guides(h), ['x20']);
h = run(h, ...drag([30.05, 10.5], [33.6, 40]));
assert.deepEqual(guides(h), ['x20', 'x34']);
assert.deepEqual(guides(run(h, ...drag([34, 10.5], [20.1, 5]))), ['x20']); // merges
assert.deepEqual(guides(run(h, ...drag([34, 10.5], [70, 10]))), ['x20']); // off the map: removed
ok('drag moves a guide (snapping), merges onto another, or removes it off the map');

// guides stay put in other tools: select and build clicks do what they always did
h = run(h, tool);
assert.equal(h.state.tool, 'select');
h = run(h, { type: 'select', id: 'crate' }, ...click(20.1, 5.5));
assert.deepEqual(guides(h), ['x20', 'x34']);
assert.equal(h.state.objects.length, 1);
// and the guide tool never builds, even with an item chosen
h = run(h, tool, ...click(40.5, 10.1));
assert.equal(h.state.objects.length, 1);
assert.deepEqual(guides(h), ['x20', 'x34', 'y10']);
ok('only the guide tool touches guides, and it never builds');

// Esc leaves the guide tool; Clear all takes every guide away
assert.equal(run(h, { type: 'cancel' }).state.tool, 'select');
assert.deepEqual(guides(run(h, { type: 'clearGuides' })), []);
ok('Esc leaves the tool, Clear all removes every guide');

// guides are world lines: in view 1 the view line x' = 20 is the world line y = 44
h = run(initialHistory, { type: 'rotateView', dir: 1 }, tool, ...click(20.05, 10.4));
assert.deepEqual(guides(h), ['y44']);
h = run(h, ...drag([20.1, 10.4], [24.2, 10]));
assert.deepEqual(guides(h), ['y40']);
h = run(h, { type: 'rotateView', dir: -1 }, ...click(5.5, 40.1));
assert.deepEqual(guides(h), []);
ok('guides are world lines: made, moved and removed from any view');
