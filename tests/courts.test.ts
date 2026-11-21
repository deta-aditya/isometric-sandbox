import { strict as assert } from 'node:assert';
import { getItem, getTileDef } from '../src/catalog.ts';
import { type History, type HistoryAction, initialHistory, step } from '../src/history.ts';
const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
const pt = (x: number, y: number): Omit<Extract<HistoryAction, { type: 'press' }>, 'type'> => ({ cell: { x: Math.floor(x), y: Math.floor(y) }, point: { x, y } });
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

// #33: court markings are white lines only, inside their footprint, 12 by 6 and 6 by 6
for (const [id, w, h] of [['basketball-court', 12, 6], ['half-basketball-court', 6, 6], ['mini-soccer-court', 12, 6]] as const) {
  const def = getItem(id);
  assert.ok(def.kind === 'object' && def.layer === 'marking' && def.group === 'courts');
  assert.equal(def.w, w); assert.equal(def.h, h);
  assert.ok(def.marks!.length > 10);
  def.marks!.forEach((m) => m.pts.forEach(([x, y]) => assert.ok(x >= -1e-9 && x <= w + 1e-9 && y >= -1e-9 && y <= h + 1e-9, `${id} point ${x},${y}`)));
  assert.ok(def.marks!.every((m) => m.color === def.marks![0]!.color), 'one line color');
}
ok('the court markings (basketball, half court, mini soccer) are lines only, inside their footprints');

// the court is symmetric end to end: every line of one end has its mirror at the other
for (const id of ['basketball-court', 'mini-soccer-court']) {
  const marks = (getItem(id) as Extract<ReturnType<typeof getItem>, { kind: 'object' }>).marks!;
  // (each line by its outline box, within a small tolerance: arcs are sampled at angles that need not
  // mirror point for point)
  const boxOf = (pts: readonly (readonly [number, number])[]) => {
    const xs = pts.map(([x]) => x), ys = pts.map(([, y]) => y);
    return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  };
  const boxes = marks.map((m) => boxOf(m.pts));
  const mirrored = marks.filter((m) => {
    const b = boxOf(m.pts.map(([x, y]) => [12 - x, y] as const));
    return boxes.some((o) => o.every((v, i) => Math.abs(v - b[i]!) < 0.01));
  });
  assert.equal(mirrored.length, marks.length, id);
}
ok('the full courts mirror end to end');

// a court goes on any floor: painted Gym floor, Court blue, or plain grass; a hoop stands on it
{
  let h = run(initialHistory, { type: 'select', id: 'gym-floor' }, { type: 'hover', ...pt(10.5, 10.5) }, { type: 'press', ...pt(10.5, 10.5) },
    ...Array.from({ length: 12 }, (_, i): HistoryAction => ({ type: 'hover', ...pt(10.5 + i, 10.5) })), { type: 'release' });
  assert.equal(h.state.tiles.length, 12);
  const objects = (s: History) => s.state.objects.length;
  h = run(h, { type: 'select', id: 'basketball-court' }, { type: 'hover', ...pt(16, 13) }, { type: 'press', ...pt(16, 13) }, { type: 'release' });
  assert.equal(objects(h), 1, 'over a painted floor');
  h = run(h, { type: 'select', id: 'half-basketball-court' }, { type: 'hover', ...pt(40, 40) }, { type: 'press', ...pt(40, 40) }, { type: 'release' });
  assert.equal(objects(h), 2, 'on plain grass');
  const court = h.state.objects[0]!;
  h = run(h, { type: 'select', id: 'basketball-hoop' }, { type: 'hover', ...pt(court.x + 0.5, court.y + 3) }, { type: 'press', ...pt(court.x + 0.5, court.y + 3) }, { type: 'release' });
  assert.equal(objects(h), 3, 'a hoop on the court');
  assert.equal(h.state.tiles.length, 12, 'the floor stays');
}
ok('courts go on a painted floor or plain grass, and a hoop stands on a court');

// the new floors
{
  ['court-blue', 'court-green', 'court-red', 'mowed-grass', 'turf-grass'].forEach((id) => assert.equal(getTileDef(id).group, 'floors'));
  const mowed = getTileDef('mowed-grass');
  assert.ok(mowed.stripe !== undefined && mowed.stripe !== mowed.color);
}
ok('five new floors in the Floors tab; mowed grass has a second stripe color');

// the soccer goal is a 1 by 2 standing object beside the hoop
{
  const goal = getItem('soccer-goal');
  assert.ok(goal.kind === 'object' && goal.group === 'sports' && goal.w === 1 && goal.h === 2 && !goal.layer);
}
ok('the soccer goal is a 1 by 2 object in Scenery > Sports');
