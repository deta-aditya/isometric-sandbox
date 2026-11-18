import { strict as assert } from 'node:assert';
import { type History, type HistoryAction, canUndo, initialHistory, step } from '../src/history.ts';
import { faceColor } from '../src/render/drawables.ts';
import { getPaint, getWallStyle } from '../src/catalog.ts';
const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
const pt = (x: number, y: number) => ({ cell: { x: Math.floor(x), y: Math.floor(y) }, point: { x, y } });
const drag = (a: [number, number], b: [number, number]): HistoryAction[] =>
  [{ type: 'hover', ...pt(...a) }, { type: 'press', ...pt(...a) }, { type: 'hover', ...pt(...b) }, { type: 'release' }];
const click = (x: number, y: number) => drag([x, y], [x, y]);
const wall = (h: History, axis: 'x' | 'y', x: number, y: number) => h.state.walls.find((w) => w.axis === axis && w.x === x && w.y === y);
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

// a plaster room 10..13 x 10..12, and a picket fence beside it
const room = run(initialHistory, { type: 'select', id: 'plaster' }, { type: 'setWallMode', mode: 'square' }, ...drag([10.5, 10.5], [13.5, 12.5]),
  { type: 'select', id: 'picket-fence' }, { type: 'setWallMode', mode: 'line' }, ...drag([16.02, 10.02], [19.98, 10.02]), { type: 'cancel' });
const north = () => wall(room, 'x', 11, 10)!;
assert.deepEqual(north().paint, { before: null, after: null });
assert.equal(faceColor(north()), getWallStyle('plaster').color);
ok('new walls start unpainted and show their material');

// clicking just inside the room paints the inner (after) side of the north wall only
let h = run(room, { type: 'select', id: 'paint-sky' }, ...click(11.5, 10.08));
assert.deepEqual(wall(h, 'x', 11, 10)?.paint, { before: null, after: 'paint-sky' });
assert.equal(faceColor(wall(h, 'x', 11, 10)!), getPaint('paint-sky').color);
assert.ok(canUndo(h));
ok('a click paints the side the pointer is on, as one undo step');

// the outside of a back wall is hidden behind the wall itself, so it is reached with walls down,
// pointing at the ground beyond the low wall; the inside stays
h = run(h, { type: 'setWallView', view: 'down' }, { type: 'select', id: 'paint-terracotta' }, ...click(11.5, 9.5));
assert.deepEqual(wall(h, 'x', 11, 10)?.paint, { before: 'paint-terracotta', after: 'paint-sky' });
ok('each side keeps its own paint');

// dragging along the wall paints the whole run on the starting side
h = run(room, { type: 'select', id: 'paint-mint' }, ...drag([10.5, 10.08], [13.5, 10.08]));
[10, 11, 12, 13].forEach((x) => assert.equal(wall(h, 'x', x, 10)?.paint.after, 'paint-mint'));
h = step(h, { type: 'undo' });
[10, 11, 12, 13].forEach((x) => assert.equal(wall(h, 'x', x, 10)?.paint.after, null));
ok('dragging paints a run, and undo takes it back in one step');

// Plain strips paint back to the material
h = run(room, { type: 'select', id: 'paint-navy' }, ...click(11.5, 10.08), { type: 'select', id: 'paint-plain' }, ...click(11.5, 10.08));
assert.equal(wall(h, 'x', 11, 10)?.paint.after, null);
ok('Plain strips the paint back to the material');

// fences do not take paint
h = run(room, { type: 'select', id: 'paint-rose' }, ...click(17.5, 10.08));
assert.deepEqual(wall(h, 'x', 17, 10)?.paint, { before: null, after: null });
ok('fences are not painted');

// restyling a painted wall to another material keeps the paint; turning it into a fence drops it
h = run(room, { type: 'select', id: 'paint-sky' }, ...click(11.5, 10.08),
  { type: 'select', id: 'brick' }, { type: 'setWallMode', mode: 'line' }, ...drag([11.02, 10.02], [11.98, 10.02]));
assert.equal(wall(h, 'x', 11, 10)?.styleId, 'brick');
assert.equal(wall(h, 'x', 11, 10)?.paint.after, 'paint-sky');
h = run(h, { type: 'select', id: 'hedge-row' }, ...drag([11.02, 10.02], [11.98, 10.02]));
assert.deepEqual(wall(h, 'x', 11, 10)?.paint, { before: null, after: null });
ok('paint survives a change of material, but not a change to a fence');

// pointing at the middle of a tall wall's face paints that wall, even though the ground under the
// cursor is behind it: half way up (28px) is 28 / 32 tiles back along both axes
h = run(room, { type: 'setWallView', view: 'up' }, { type: 'select', id: 'paint-mint' }, ...click(11.5 - 0.875, 10 - 0.875));
assert.equal(wall(h, 'x', 11, 10)?.paint.after, 'paint-mint');
assert.equal(wall(h, 'x', 10, 9), undefined);
ok('pointing at a wall face paints that wall, not the ground behind it');

// near the top of a front wall that is in front of a back wall, the front one wins
const top = 11.5 - 1.6; // 51px up the south wall at y = 13
h = run(room, { type: 'setWallView', view: 'up' }, { type: 'select', id: 'paint-rose' }, ...click(top, 13 - 1.6));
assert.equal(wall(h, 'x', 11, 13)?.paint.after, 'paint-rose');
ok('the wall nearest the camera is the one picked');
