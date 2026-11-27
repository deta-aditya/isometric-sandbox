import { strict as assert } from 'node:assert';
import { CATEGORIES, getPaint, getWallStyle, isFinish, itemsIn } from '../src/catalog.ts';
import { decodeGame, encodeGame } from '../src/saveStore.ts';
import { type History, type HistoryAction, initialHistory, step } from '../src/history.ts';
import { buildDrawables } from '../src/render/drawables.ts';
import { WALL_TEXTURES, type WallMark, type WallTextureId } from '../src/render/wallTextures.ts';
import { WALL_H } from '../src/config.ts';
import { gameWorldOf, wallAt } from '../src/world.ts';
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
    'No finish', 'Brush painted', 'Brickwork', 'Stonework', 'Concrete block', 'Wood panels', 'Wainscot', 'Tiles', 'Striped paper', 'Diamond paper',
  ]);
  finishes.forEach((p) => {
    assert.ok(isFinish(p.id) && p.color === null && p.name.length <= 16, p.id);
    if (p.id !== 'finish-none') assert.ok(p.texture && WALL_TEXTURES[p.texture], p.id);
  });
  assert.equal(getPaint('finish-none').texture, undefined);
  // natural colors: brick, stone, block and wood only
  assert.deepEqual(finishes.filter((p) => p.natural !== undefined).map((p) => p.id), ['finish-brick', 'finish-stone', 'finish-block', 'finish-wood']);
  assert.ok(itemsIn('paints').every((i) => !isFinish(i.id) && getPaint(i.id).texture === undefined), 'paints stay colors');
}
ok('Building > Finishes after Paints: No finish then 9 textures, no colors of their own; natural colors on brick, stone, block and wood');

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

// ===== In the game: coats merge =====
// a room on cells 10..12 x 10..11; brick inside and out by Shift fills, then sky paint on the outside
const settle = (h: History) => run(h, { type: 'setShift', held: false }, { type: 'useSelect' }, { type: 'setWallView', view: 'up' }, { type: 'hover', ...pt(40.5, 40.5) });
const room = run(initialHistory, { type: 'select', id: 'plaster' }, { type: 'setWallMode', mode: 'square' }, ...drag([10.5, 10.5], [12.5, 11.5]));
const brick = settle(run(room, { type: 'select', id: 'finish-brick' }, { type: 'setShift', held: true }, ...click(11.5, 10.2), ...click(11.5, 12.2)));
const front = (h: History) => wallAt(h.state, { axis: 'x', x: 11, y: 12 })!;
assert.deepEqual(front(brick).finish, { before: 'finish-brick', after: 'finish-brick' });
assert.deepEqual(front(brick).paint, { before: null, after: null });
ok('fills spread a finish inside and out, leaving the paint alone');

const sky = settle(run(brick, { type: 'select', id: 'paint-sky' }, { type: 'setShift', held: true }, ...click(11.5, 12.2)));
assert.deepEqual(front(sky).paint, { before: null, after: 'paint-sky' });
assert.deepEqual(front(sky).finish, { before: 'finish-brick', after: 'finish-brick' });
const stripes = settle(run(sky, { type: 'select', id: 'finish-stripes' }, ...click(11.5, 12.2)));
assert.deepEqual(front(stripes).paint.after, 'paint-sky');
assert.equal(front(stripes).finish.after, 'finish-stripes');
const bare = settle(run(stripes, { type: 'select', id: 'finish-none' }, ...click(11.5, 12.2)));
assert.deepEqual([front(bare).paint.after, front(bare).finish.after], ['paint-sky', null]);
ok('painting keeps the finish, a finish keeps the paint, and No finish takes the texture off');

// a finish fill stops at a different finish, not at a different paint
{
  const mixed = settle(run(sky, { type: 'select', id: 'finish-wood' }, ...click(10.5, 12.2), { type: 'select', id: 'finish-tiles' }, { type: 'setShift', held: true }, ...click(11.5, 12.2)));
  const outside = mixed.state.walls.map((w) => w.finish[w.axis === 'x' ? (w.y === 12 ? 'after' : 'before') : w.x === 13 ? 'after' : 'before']);
  assert.equal(outside.filter((f) => f === 'finish-tiles').length, 9);
  assert.equal(wallAt(mixed.state, { axis: 'x', x: 10, y: 12 })!.finish.after, 'finish-wood');
}
ok('Shift with a finish stops where the finish changes');

type Tex = Readonly<{ s0: number; dir: number; line: number; id: string }>;
type Face = Readonly<{ texture?: Tex; color: number }>;
const faces = (h: History) => buildDrawables(toView(h.state)).sorted.filter((d) => d.kind === 'wall') as unknown as Face[];
const expected = [
  ...[10, 11, 12].flatMap((x) => [10, 12].map((y) => `${y * 2}:${x}`)),
  ...[10, 11].flatMap((y) => [10, 13].map((x) => `${x * 2 + 1}:${y}`)),
].sort();
let view = brick;
const dirs: number[] = [];
for (let v = 0; v < 4; v++) {
  const tex = faces(view).map((f) => f.texture);
  assert.equal(tex.length, 10);
  assert.ok(tex.every((t) => t?.id === 'brick'));
  assert.deepEqual(tex.map((t) => `${t!.line}:${t!.s0}`).sort(), expected, `view ${v}: each face keyed by its world wall`);
  dirs.push(...new Set(tex.map((t) => t!.dir)));
  view = step(view, { type: 'rotateView', dir: 1 });
}
assert.ok(dirs.includes(1) && dirs.includes(-1), 'a view looking the other way runs along the line backwards');
ok('from all four camera sides every face is placed by its world wall, so the pattern keeps its place as the camera turns');

// the color a face is drawn in: Plain shows a finish's natural color (or the material), a paint colors it
{
  const at = (h: History) => faces(h).filter((f) => f.texture).map((f) => f.color);
  assert.ok(at(brick).every((c) => c === getPaint('finish-brick').natural), 'plain brick is brick red');
  const skyFront = faces(sky).filter((f) => f.color === getPaint('paint-sky').color);
  assert.equal(skyFront.length, 5);
  assert.ok(skyFront.every((f) => f.texture?.id === 'brick'), 'painted brick: sky blue with the brick texture');
  const tiles = settle(run(room, { type: 'select', id: 'finish-tiles' }, { type: 'setShift', held: true }, ...click(11.5, 12.2)));
  assert.ok(faces(tiles).every((f) => f.color === getWallStyle('plaster').color), 'tiles under Plain show the plaster color');
}
ok('Plain shows a natural color on brick, stone, block and wood, the material under the rest; a paint colors any finish');

// the preview shows the coat on the face toward the camera: a finish keeps the color, a paint the finish
{
  const hover = (h: History, id: string) => faces(run(h, { type: 'select', id }, { type: 'hover', ...pt(11.5, 12.2) }));
  const stone = hover(sky, 'finish-stone').filter((f) => f.texture?.id === 'stone');
  assert.equal(stone.length, 1);
  assert.equal(stone[0]!.color, getPaint('paint-sky').color);
  const mint = hover(brick, 'paint-mint').filter((f) => f.color === getPaint('paint-mint').color);
  assert.equal(mint.length, 1);
  assert.equal(mint[0]!.texture?.id, 'brick');
}
ok('hovering previews the merged result');

// ===== Saves and blueprints =====
{
  const world = gameWorldOf(sky.state);
  const back = decodeGame(encodeGame(world))!;
  assert.equal(back.dropped, 0);
  assert.deepEqual(wallAt({ ...sky.state, walls: back.world.walls }, { axis: 'x', x: 11, y: 12 }), front(sky));
  // the first build of #11b kept finishes in the paint, each with a fixed color
  const old = JSON.parse(encodeGame(world));
  old.version = 4;
  old.walls = [
    { axis: 'x', x: 1, y: 1, styleId: 'plaster', opening: null, paint: { before: 'paint-red-brick', after: 'paint-white-brick' } },
    { axis: 'x', x: 2, y: 1, styleId: 'plaster', opening: null, paint: { before: 'paint-tiles', after: 'paint-mint' } },
  ];
  const up = decodeGame(JSON.stringify(old))!;
  assert.equal(up.dropped, 0);
  assert.deepEqual(up.world.walls.map((w) => [w.paint, w.finish]), [
    [{ before: null, after: 'paint-white' }, { before: 'finish-brick', after: 'finish-brick' }],
    [{ before: 'paint-white', after: 'paint-mint' }, { before: 'finish-tiles', after: null }],
  ]);
  // a version 3 save (before finishes) still loads with its walls and ground
  old.version = 3;
  old.ground = 'terrain-sand';
  const v3 = decodeGame(JSON.stringify(old))!;
  assert.equal(v3.world.ground, 'terrain-sand');
  assert.equal(v3.world.walls.length, 2);
  assert.equal(JSON.parse(encodeGame(v3.world)).version, 4);
}
ok('saves keep paint and finish per side; an old finish loads as its finish plus a color; version 3 saves still load');
console.log('all passed');
