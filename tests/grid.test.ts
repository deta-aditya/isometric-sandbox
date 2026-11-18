import { strict as assert } from 'node:assert';
import { canUndo, initialHistory, step } from '../src/history.ts';
import { gridAlpha } from '../src/render/drawables.ts';
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

let h = initialHistory;
assert.equal(h.state.showGrid, true);
assert.equal(gridAlpha(h.state), 1);
h = step(h, { type: 'toggleGrid' });
assert.equal(h.state.showGrid, false);
assert.equal(canUndo(h), false);
ok('G hides the grid, and it is a view setting, not an undo step');

assert.equal(gridAlpha(h.state), 0);
h = step(h, { type: 'select', id: 'oak' });
assert.equal(gridAlpha(h.state), 0.3);
h = step(h, { type: 'toggleBulldoze' });
assert.equal(gridAlpha(h.state), 0.3);
ok('a hidden grid stays faint while building or bulldozing, and is gone in select');

h = step(h, { type: 'toggleGrid' });
assert.equal(gridAlpha(h.state), 1);
ok('G shows it again');
