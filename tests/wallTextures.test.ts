import { strict as assert } from 'node:assert';
import { CATEGORIES, getPaint, itemsIn } from '../src/catalog.ts';
import { type History, type HistoryAction, initialHistory, step } from '../src/history.ts';
import { buildDrawables } from '../src/render/drawables.ts';
import { WALL_TEXTURES, type WallMark, type WallTextureId } from '../src/render/wallTextures.ts';
import { WALL_H } from '../src/config.ts';
import { wallAt } from '../src/world.ts';
import { toView } from '../src/view.ts';
const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
const pt = (x: number, y: number) => ({ cell: { x: Math.floor(x), y: Math.floor(y) }, point: { x, y } });
const drag = (a: [number, number], b: [number, number]): HistoryAction[] =>
  [{ type: 'hover', ...pt(...a) }, { type: 'press', ...pt(...a) }, { type: 'hover', ...pt(...b) }, { type: 'release' }];
const click = (x: number, y: number) => drag([x, y], [x, y]);
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

// ===== Items =====
{
  const tabs = CATEGORIES.find((c) => c.id === 'building')!.groups.map((g) => g.id);
  assert.equal(tabs[tabs.indexOf('paints') + 1], 'finishes');
  const finishes = itemsIn('finishes').map((i) => getPaint(i.id));
  assert.deepEqual(finishes.map((p) => p.name), [
    'Brush painted', 'Red brickwork', 'White brickwork', 'Stonework', 'Concrete block', 'Wood panels', 'Wainscot', 'White tiles', 'Striped paper', 'Diamond paper',
  ]);
  finishes.forEach((p) => {
    assert.ok(p.texture && WALL_TEXTURES[p.texture], p.id);
    assert.ok(p.color !== null && p.name.length <= 16, p.id);
  });
  assert.ok(itemsIn('paints').every((i) => getPaint(i.id).texture === undefined), 'plain paints stay plain');
}
ok('Building > Finishes after Paints: 10 textured paints, Brush painted first, names within 16 characters');

// ===== Patterns follow the world line =====
// Any mark narrower than a tile is the same whichever segment draws it, so a pattern runs on across joints
// (bands across the whole face, such as bed joints and the wainscot rail, belong to their own segment)
{
  const key = (m: WallMark) => JSON.stringify([m.pts.map(([s, z]) => [+s.toFixed(6), +z.toFixed(6)]), m.color, m.alpha ?? 1]);
  const span = (m: WallMark) => [Math.min(...m.pts.map((p) => p[0])), Math.max(...m.pts.map((p) => p[0]))] as const;
  (Object.keys(WALL_TEXTURES) as WallTextureId[]).forEach((id) => {
    const a = WALL_TEXTURES[id](3, 14, WALL_H, 0xa6452e), b = WALL_TEXTURES[id](4, 14, WALL_H, 0xa6452e);
    const small = (ms: WallMark[]) => ms.filter((m) => span(m)[1] - span(m)[0] < 0.9);
    const across = small(a).filter((m) => span(m)[0] < 4 && span(m)[1] > 4); // marks crossing the joint at s = 4
    const inB = new Set(small(b).map(key));
    across.forEach((m) => assert.ok(inB.has(key(m)), `${id}: a mark crossing the joint is drawn the same by the next segment`));
    assert.deepEqual(WALL_TEXTURES[id](3, 14, WALL_H, 0xa6452e).map(key), a.map(key), `${id} is stable`);
    assert.ok(a.length > 0, id);
  });
}
ok('every texture is a function of the world line: marks crossing a joint match on both sides, and drawing is stable');

// ===== In the game: a brick room, seen from every side =====
// a room on cells 10..12 x 10..11, red brick inside and out
const h = run(initialHistory,
  { type: 'select', id: 'plaster' }, { type: 'setWallMode', mode: 'square' }, ...drag([10.5, 10.5], [12.5, 11.5]),
  { type: 'select', id: 'paint-red-brick' }, { type: 'setShift', held: true }, ...click(11.5, 10.2), ...click(11.5, 12.2), { type: 'setShift', held: false },
  { type: 'useSelect' }, { type: 'setWallView', view: 'up' }, { type: 'hover', ...pt(40.5, 40.5) });
assert.deepEqual(wallAt(h.state, { axis: 'x', x: 11, y: 12 })?.paint, { before: 'paint-red-brick', after: 'paint-red-brick' });
ok('fills spread a finish inside and out like any paint');

type Tex = Readonly<{ s0: number; dir: number; line: number; id: string }>;
const textured = (h: History) =>
  buildDrawables(toView(h.state)).sorted.filter((d) => d.kind === 'wall').map((d) => (d as unknown as { texture?: Tex }).texture);
const expected = [
  ...[10, 11, 12].flatMap((x) => [10, 12].map((y) => `${y * 2}:${x}`)),
  ...[10, 11].flatMap((y) => [10, 13].map((x) => `${x * 2 + 1}:${y}`)),
].sort();
let view = h;
const dirs: number[] = [];
for (let v = 0; v < 4; v++) {
  const tex = textured(view);
  assert.equal(tex.length, 10);
  assert.ok(tex.every((t) => t?.id === 'brick'));
  assert.deepEqual(tex.map((t) => `${t!.line}:${t!.s0}`).sort(), expected, `view ${v}: each face keyed by its world wall`);
  dirs.push(...new Set(tex.map((t) => t!.dir)));
  view = step(view, { type: 'rotateView', dir: 1 });
}
assert.ok(dirs.includes(1) && dirs.includes(-1), 'a view looking the other way runs along the line backwards');
ok('from all four camera sides every face is placed by its world wall, so the pattern keeps its place as the camera turns');

// the paint preview shows the finish itself on the face toward the camera, not a flat color
{
  const hover = run(h, { type: 'select', id: 'paint-stonework' }, { type: 'hover', ...pt(11.5, 12.2) });
  const tex = textured(hover).filter((t) => t?.id === 'stone');
  assert.equal(tex.length, 1);
}
ok('hovering a finish over a wall previews its texture');

// a plain paint over a finish draws no texture
{
  const plain = run(h, { type: 'select', id: 'paint-sky' }, { type: 'setShift', held: true }, ...click(11.5, 12.2), { type: 'setShift', held: false }, { type: 'useSelect' }, { type: 'hover', ...pt(40.5, 40.5) });
  // the outside is plain sky now; the room's back walls still show brick inside
  assert.equal(wallAt(plain.state, { axis: 'x', x: 11, y: 12 })?.paint.after, 'paint-sky');
  assert.deepEqual(textured(plain).filter((t) => t).map((t) => `${t!.line}:${t!.s0}`).sort(), ['20:10', '20:11', '20:12', '21:10', '21:11'].sort());
}
ok('a plain paint over a finish takes the texture away');
console.log('all passed');
