import { strict as assert } from 'node:assert';
import { CATEGORIES, type Mark, type Rotation, getObjectDef, getTileDef, itemsIn, occupiedCells } from '../src/catalog.ts';
import { type ObjectPlacement, buildPlan, canPlaceObject } from '../src/world.ts';
import { type History, type HistoryAction, initialHistory, step } from '../src/history.ts';
const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
const pt = (x: number, y: number) => ({ cell: { x: Math.floor(x), y: Math.floor(y) }, point: { x, y } });
const drag = (a: [number, number], b: [number, number]): HistoryAction[] =>
  [{ type: 'hover', ...pt(...a) }, { type: 'press', ...pt(...a) }, { type: 'hover', ...pt(...b) }, { type: 'release' }];
const ids = (h: History, id: string) => h.state.objects.filter((o) => o.defId === id);
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);
const WHITE = 0xf1f5f9;
const BLACK = 0x111827;
const RED = getTileDef('running-track').color;

// point in polygon, and the color drawn on top at a point (the last mark covering it)
const inside = (m: Mark, x: number, y: number) => {
  let c = false;
  for (let i = 0, j = m.pts.length - 1; i < m.pts.length; j = i++) {
    const [xi, yi] = m.pts[i]!; const [xj, yj] = m.pts[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const colorAt = (id: string, x: number, y: number) => [...getObjectDef(id).marks!].reverse().find((m) => inside(m, x, y))?.color;

// #32: a Track tab after Courts with four pieces; the old Running track path tile stays
{
  const flooring = CATEGORIES.find((c) => c.id === 'flooring')!;
  const tabs = flooring.groups.map((g) => g.id);
  assert.equal(tabs[tabs.indexOf('courts') + 1], 'track');
  assert.equal(flooring.groups.find((g) => g.id === 'track')!.name, 'Track');
  assert.deepEqual(itemsIn('track').map((i) => i.id), ['track-straight', 'track-curve', 'start-line', 'finish-line']);
  assert.deepEqual(itemsIn('track').map((i) => i.name), ['Track straight', 'Track curve', 'Start line', 'Finish line']);
  assert.equal(getTileDef('running-track').group, 'paths');
}
ok('Flooring > Track (after Courts): Track straight, Track curve, Start line, Finish line; the Running track tile stays');

// sizes and layers: the track pieces are road surfaces, the lines are markings painted on them
{
  const def = (id: string) => getObjectDef(id);
  assert.deepEqual([def('track-straight').w, def('track-straight').h, def('track-straight').layer, def('track-straight').run], [1, 3, 'road', true]);
  assert.deepEqual([def('track-curve').w, def('track-curve').h, def('track-curve').layer], [7, 7, 'road']);
  for (const id of ['start-line', 'finish-line']) assert.deepEqual([def(id).w, def(id).h, def(id).layer], [1, 3, 'marking']);
  for (const id of ['track-straight', 'track-curve', 'start-line', 'finish-line']) {
    const { w, h, marks } = def(id);
    marks!.forEach((m) => m.pts.forEach(([x, y]) => assert.ok(x >= -1e-9 && x <= w + 1e-9 && y >= -1e-9 && y <= h + 1e-9, `${id} point ${x},${y}`)));
  }
}
ok('a straight is 1 by 3, a curve 7 by 7 (road layer); start and finish lines are 1 by 3 markings; all inside their footprints');

// six lanes of half a tile in the Running track red, a white line at every lane edge
{
  const marks = getObjectDef('track-straight').marks!;
  assert.equal(marks[0]!.color, RED, 'the same red as the Running track tile, so they join');
  assert.equal(marks.filter((m) => m.color === WHITE).length, 7);
  for (const y of [0.5, 1, 1.5, 2, 2.5]) assert.equal(colorAt('track-straight', 0.5, y), WHITE, `line at ${y}`);
  for (let lane = 0; lane < 6; lane++) assert.equal(colorAt('track-straight', 0.5, lane * 0.5 + 0.25), RED, `lane ${lane + 1}`);
  // the curve carries the same lines round at the same distances from its outer edge
  const size = 7;
  for (const a of [0.2, 0.7, 1.3]) {
    for (const at of [0.5, 1, 1.5, 2, 2.5]) {
      const r = size - at;
      assert.equal(colorAt('track-curve', r * Math.cos(a - Math.PI / 2), size + r * Math.sin(a - Math.PI / 2)), WHITE, `curve line ${at} at ${a}`);
    }
    for (let lane = 0; lane < 6; lane++) {
      const r = size - (lane * 0.5 + 0.25);
      assert.equal(colorAt('track-curve', r * Math.cos(a - Math.PI / 2), size + r * Math.sin(a - Math.PI / 2)), RED);
    }
  }
}
ok('six half-tile lanes in the Running track red, lines at every lane edge, carried round the curve');

// the curve stands on its ring only: the inside of the corner (radius under 4) is free for the infield
{
  const cells = occupiedCells({ defId: 'track-curve', rotation: 0, x: 0, y: 0, w: 7, h: 7 });
  const at = (x: number, y: number) => cells.some((c) => c.x === x && c.y === y);
  assert.ok(at(0, 0) && at(6, 6) && at(3, 1), 'the ring');
  assert.ok(!at(0, 6) && !at(1, 5) && !at(2, 6) && !at(0, 4), 'the infield corner');
}
ok('a curve stands on its ring only, so the infield corner stays free');

// the start line: a white line across all lanes and lane numbers 1 to 6 behind it; lane 1 is the inside
// lane at y = 0, reading toward +x
{
  const marks = getObjectDef('start-line').marks!;
  assert.equal(colorAt('start-line', 0.85, 0.1), WHITE); assert.equal(colorAt('start-line', 0.85, 2.9), WHITE);
  // each lane's half tile holds one digit, and the six digits differ: compare their pixels, placed
  // relative to their lane
  const perLane = Array.from({ length: 6 }, (_, i) => marks.filter((m) => {
    const ys = m.pts.map(([, y]) => y);
    return Math.max(...ys) <= (i + 1) * 0.5 + 1e-9 && Math.min(...ys) >= i * 0.5 - 1e-9 && Math.max(...m.pts.map(([x]) => x)) < 0.8;
  }).map((m) => m.pts.map(([x, y]) => `${x.toFixed(2)},${(y - i * 0.5).toFixed(2)}`).join(' ')).sort().join('|'));
  assert.ok(perLane.every((d) => d.split('|').length >= 7), 'a digit in every lane');
  assert.equal(new Set(perLane).size, 6);
  const finish = getObjectDef('finish-line').marks!;
  assert.ok(finish.some((m) => m.color === WHITE) && finish.some((m) => m.color === BLACK));
  assert.notEqual(colorAt('finish-line', 0.4, 0.1), colorAt('finish-line', 0.4, 0.3), 'checkered across');
  assert.notEqual(colorAt('finish-line', 0.4, 0.1), colorAt('finish-line', 0.6, 0.1), 'checkered along');
}
ok('the start line has lane numbers 1 to 6; the finish line is a checkered band');

// straights are dragged; a full oval (four curves, 12 tiles of straights each side) fits 26 by 14 with a
// mini soccer court in its infield, and start and finish lines go on the straights
{
  let h = run(initialHistory, { type: 'select', id: 'track-straight' }, ...drag([10.5, 10.5], [21.5, 10.5]));
  assert.equal(ids(h, 'track-straight').length, 12);
  assert.equal(h.past.length, 1, 'one undo step');
  let s = initialHistory.state;
  let id = 1;
  const add = (defId: string, x: number, y: number, rotation: Rotation = 0) => {
    const d = getObjectDef(defId);
    const p: ObjectPlacement = { defId, rotation, x, y, w: rotation % 2 === 0 ? d.w : d.h, h: rotation % 2 === 0 ? d.h : d.w };
    assert.ok(canPlaceObject(s, p), `${defId} at ${x},${y} r${rotation}`);
    s = { ...s, objects: [...s.objects, { id: id++, ...p }] };
  };
  for (let x = 28; x < 40; x++) { add('track-straight', x, 20); add('track-straight', x, 31); }
  add('track-curve', 40, 20, 0); add('track-curve', 40, 27, 1); add('track-curve', 21, 27, 2); add('track-curve', 21, 20, 3);
  add('mini-soccer-court', 28, 24);
  add('start-line', 29, 31); add('finish-line', 38, 31);
  const xs = s.objects.flatMap((o) => occupiedCells(o)).map((c) => c.x);
  const ys = s.objects.flatMap((o) => occupiedCells(o)).map((c) => c.y);
  assert.deepEqual([Math.max(...xs) - Math.min(...xs) + 1, Math.max(...ys) - Math.min(...ys) + 1], [26, 14]);
}
ok('straights are dragged in one step; a full oval is 26 by 14 and holds a mini soccer court');

// tracks and roads stay apart: a road junction neither snaps onto a track nor replaces it, and a track
// piece does not replace road; a track curve laid on track straights replaces them like road pieces do
{
  let h = run(initialHistory, { type: 'select', id: 'track-straight' }, ...drag([10.5, 10.5], [21.5, 10.5]));
  const cross: ObjectPlacement = { defId: 'wide-cross', rotation: 0, x: 14, y: 9, w: 5, h: 5 };
  assert.equal(buildPlan(h.state, cross).ok, false, 'a road junction on a track');
  h = run(h, { type: 'select', id: 'wide-straight' }, ...drag([10.5, 30.5], [21.5, 30.5]));
  const curveOnRoad: ObjectPlacement = { defId: 'track-curve', rotation: 0, x: 12, y: 28, w: 7, h: 7 };
  assert.equal(buildPlan(h.state, curveOnRoad).ok, false, 'a track curve on a road');
  const curveOnTrack: ObjectPlacement = { defId: 'track-curve', rotation: 0, x: 18, y: 10, w: 7, h: 7 };
  const plan = buildPlan(h.state, curveOnTrack);
  assert.ok(plan.ok && plan.replaced.length > 0 && plan.replaced.every((o) => o.defId === 'track-straight'));
}
ok('tracks and roads keep apart; a curve on track straights replaces them');
