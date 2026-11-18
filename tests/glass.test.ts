import { strict as assert } from 'node:assert';
import { type History, type HistoryAction, initialHistory, step } from '../src/history.ts';
import { interiorCells, paintPlan } from '../src/world.ts';
import { faceColor } from '../src/render/drawables.ts';
import { sizeOf } from '../src/geometry.ts';
const SQ = sizeOf(64, 64);
const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
const pt = (x: number, y: number) => ({ cell: { x: Math.floor(x), y: Math.floor(y) }, point: { x, y } });
const drag = (a: [number, number], b: [number, number]): HistoryAction[] =>
  [{ type: 'hover', ...pt(...a) }, { type: 'press', ...pt(...a) }, { type: 'hover', ...pt(...b) }, { type: 'release' }];
const click = (x: number, y: number) => drag([x, y], [x, y]);
const wall = (h: History, axis: 'x' | 'y', x: number, y: number) => h.state.walls.find((w) => w.axis === axis && w.x === x && w.y === y);
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

// a glass room is still a room
const room = run(initialHistory, { type: 'select', id: 'glass' }, { type: 'setWallMode', mode: 'square' }, ...drag([10.5, 10.5], [12.5, 12.5]), { type: 'cancel' });
assert.equal(interiorCells(room.state.walls, SQ).size, 9);
ok('glass walls form rooms like any wall');

// glass takes paint like any wall: a click paints one side, a Shift fill goes around the room
let h = run(room, { type: 'select', id: 'paint-sky' }, ...click(11.5, 10.2));
assert.deepEqual(wall(h, 'x', 11, 10)?.paint, { before: null, after: 'paint-sky' });
h = run(room, { type: 'select', id: 'paint-sky' }, { type: 'setShift', held: true }, { type: 'hover', ...pt(11.5, 10.3) });
assert.equal(paintPlan(h.state)?.targets.length, 12);
ok('glass takes paint, one side or a whole room fill');

// the pane shows a tint: mostly the paint, a little of the glass; unpainted glass keeps its blue
const glassBlue = 0xbae6fd, sky = 0x93c5fd;
assert.equal(faceColor(room.state.walls[0]!), glassBlue);
const tinted = faceColor({ ...room.state.walls[0]!, paint: { before: null, after: 'paint-sky' } });
const channel = (c: number, sh: number) => (c >> sh) & 255;
[16, 8, 0].forEach((sh) => assert.equal(channel(tinted, sh), Math.round(channel(glassBlue, sh) * 0.25 + channel(sky, sh) * 0.75)));
assert.equal(faceColor({ ...room.state.walls[0]!, paint: { before: null, after: 'paint-plain' } }), glassBlue);
ok('paint tints a glass pane; Plain shows clear glass');

// restyling a painted wall to glass keeps its paint, now as a tint
h = run(initialHistory, { type: 'select', id: 'plaster' }, { type: 'setWallMode', mode: 'square' }, ...drag([10.5, 10.5], [12.5, 12.5]),
  { type: 'select', id: 'paint-sky' }, ...click(11.5, 10.2),
  { type: 'select', id: 'glass' }, { type: 'setWallMode', mode: 'line' }, ...drag([11.02, 10.02], [11.98, 10.02]));
assert.equal(wall(h, 'x', 11, 10)?.styleId, 'glass');
assert.deepEqual(wall(h, 'x', 11, 10)?.paint, { before: null, after: 'paint-sky' });
ok('turning a painted wall into glass keeps the paint');
