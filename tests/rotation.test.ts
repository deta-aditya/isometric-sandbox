import { strict as assert } from 'node:assert';
import { type History, type HistoryAction, initialHistory, step } from '../src/history.ts';
import { CATALOG, type ObjectDef, type Rotation, footprintOf, partsOf } from '../src/catalog.ts';
import { boxDrawsBefore } from '../src/depthSort.ts';
const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
const pt = (x: number, y: number) => ({ cell: { x: Math.floor(x), y: Math.floor(y) }, point: { x, y } });
const click = (x: number, y: number): HistoryAction[] => [{ type: 'hover', ...pt(x, y) }, { type: 'press', ...pt(x, y) }, { type: 'release' }];
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);
const objects = CATALOG.filter((i): i is ObjectDef => i.kind === 'object');
const R: Rotation[] = [0, 1, 2, 3];
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

// every part of every object stays inside its footprint in every direction
objects.forEach((d) => R.forEach((r) => {
  const fp = footprintOf(d, r);
  partsOf(d, r).forEach((p) => assert.ok(p.dx > -1e-9 && p.dy > -1e-9 && p.dx + p.w < fp.w + 1e-9 && p.dy + p.h < fp.h + 1e-9, `${d.id} r${r}`));
}));
ok(`all ${objects.length} objects keep every part inside the footprint in all four directions`);

// turning keeps every part (same set, same sizes), and a half turn is the same footprint
objects.forEach((d) => R.forEach((r) => {
  const parts = partsOf(d, r);
  assert.equal(parts.length, d.parts.length);
  const area = (ps: readonly { w: number; h: number; height: number }[]) => ps.reduce((a, p) => a + p.w * p.h * p.height, 0);
  assert.ok(near(area(parts), area(d.parts)), d.id);
}));
assert.deepEqual(footprintOf(objects.find((d) => d.id === 'sofa')!, 1), { w: 1, h: 2 });
ok('turning keeps every part, and quarter turns swap the footprint');

// a half turn really is a half turn: the sofa's backrest moves from the north edge to the south edge
const sofa = objects.find((d) => d.id === 'sofa')!;
const back = (r: Rotation) => partsOf(sofa, r).find((p) => p.color === 0x9a3412 && p.height === 16)!;
assert.ok(back(0).dy < 0.3 && back(2).dy + back(2).h > 0.7);
assert.ok(back(1).w < 0.3 && back(1).dx > 0.5); // a quarter turn clockwise puts it on the east
ok('parts turn about the footprint: the sofa back goes north, east, south, west');

// draw order: in every direction, no pair is drawn against the 3D rule (cycles would show up here)
const violations: string[] = [];
objects.forEach((d) => R.forEach((r) => {
  const parts = partsOf(d, r);
  // snapped to clean numbers, so the check does not share any rounding error with the sort itself
  const sn = (v: number) => Math.round(v * 1e6) / 1e6;
  const box = (p: (typeof parts)[number]) => ({ x: sn(p.dx), y: sn(p.dy), w: sn(p.w), h: sn(p.h), z: p.z, height: p.height });
  parts.forEach((a, i) => parts.slice(i + 1).forEach((b) => { if (boxDrawsBefore(box(b), box(a)) === true) violations.push(`${d.id} r${r}`); }));
}));
console.log(`   draw order violations: ${violations.length}`, [...new Set(violations)].join(', '));
assert.equal(violations.length, 0);
ok('every object in every direction draws its parts back to front');

// controls: R cycles four ways, Shift + R goes back, placing keeps the facing, Q copies it
let h = run(initialHistory, { type: 'select', id: 'sofa' });
const seq = [1, 1, 1, 1].map(() => (h = step(h, { type: 'rotate' })).state.rotation);
assert.deepEqual(seq, [1, 2, 3, 0]);
h = run(h, { type: 'rotate', dir: -1 });
assert.equal(h.state.rotation, 3);
h = run(h, ...click(5.5, 5.5));
const placed = h.state.objects[0]!;
assert.equal(placed.rotation, 3);
assert.deepEqual({ w: placed.w, h: placed.h }, { w: 1, h: 2 });
ok('R turns four ways, Shift + R turns back, and a placed object keeps its facing and footprint');

// picking an object up and turning it while held, then dropping it, moves it in one undo step
h = run(h, { type: 'useSelect' }, ...click(5.5, 5.5), { type: 'rotate' }, ...click(9.5, 9.5));
assert.equal(h.state.objects[0]?.rotation, 0);
// it turns about the cell it was grabbed by (5, 5), which stays under the pointer: the 1x2 sofa becomes
// 2x1 reaching one cell to the west of that cell, so dropped at (9, 9) it spans x 8..9
assert.deepEqual({ x: h.state.objects[0]?.x, y: h.state.objects[0]?.y, w: h.state.objects[0]?.w }, { x: 8, y: 9, w: 2 });
h = step(h, { type: 'undo' });
assert.equal(h.state.objects[0]?.rotation, 3);
ok('a held object turns too, and the move undoes in one step');
