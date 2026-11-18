import { strict as assert } from 'node:assert';
import { type History, type HistoryAction, initialHistory, step } from '../src/history.ts';
const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
const at = (x: number, y: number) => ({ cell: { x, y }, point: { x: x + 0.5, y: y + 0.5 } });
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

// Esc in build goes straight to select, even with the tray open (the tray stays as it was)
let h = run(initialHistory, { type: 'selectCategory', category: 'scenery' }, { type: 'select', id: 'crate' });
assert.equal(h.state.tool, 'build'); assert.ok(h.state.trayOpen);
h = step(h, { type: 'cancel' }); assert.equal(h.state.tool, 'select'); assert.ok(h.state.trayOpen);
h = step(h, { type: 'cancel' }); assert.ok(!h.state.trayOpen);
ok('Esc in build returns to select first; a second Esc closes the tray');

// Esc mid-drag cancels the drag first, then leaves build
h = run(initialHistory, { type: 'select', id: 'stone' }, { type: 'hover', ...at(1, 1) }, { type: 'press', ...at(1, 1) });
assert.ok(h.state.drag); h = step(h, { type: 'cancel' }); assert.equal(h.state.drag, null); assert.equal(h.state.tool, 'build');
h = step(h, { type: 'cancel' }); assert.equal(h.state.tool, 'select');
ok('Esc during a paint stroke ends the stroke, the next Esc leaves build');

// Q (pickHovered) in select builds the hovered thing, with rotation
h = run(initialHistory, { type: 'select', id: 'sofa' }, { type: 'rotate' }, { type: 'hover', ...at(5, 5) }, { type: 'press', ...at(5, 5) },
  { type: 'rotate' }, { type: 'useSelect' }, { type: 'hover', ...at(5, 6) }, { type: 'pickHovered' });
assert.equal(h.state.tool, 'build'); assert.equal(h.state.selectedId, 'sofa'); assert.equal(h.state.rotation, 1);
ok('Q copies the hovered sofa, rotated like the placed one');

// Q does nothing over empty ground, while holding something, or outside select
h = run(initialHistory, { type: 'hover', ...at(20, 20) }, { type: 'pickHovered' }); assert.equal(h.state.tool, 'select');
h = run(initialHistory, { type: 'select', id: 'crate' }, { type: 'hover', ...at(3, 3) }, { type: 'press', ...at(3, 3) },
  { type: 'useSelect' }, { type: 'press', ...at(3, 3) }, { type: 'pickHovered' });
assert.equal(h.state.tool, 'select'); assert.equal(h.state.selection?.kind, 'group'); // a held object is a group of one
ok('Q is ignored over empty ground and while carrying an item');
console.log('all passed');
