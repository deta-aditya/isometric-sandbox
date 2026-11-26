import { strict as assert } from 'node:assert';
import { CATALOG, getTileDef, itemsIn } from '../src/catalog.ts';
import { type FloorPiece, type WorldTile, floorPieces, isPlain } from '../src/render/floors.ts';
import { PATTERNS } from '../src/render/patterns.ts';
import { GRID_LINE } from '../src/render/shapes.ts';
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

// a little world of floors from a picture: one letter per tile, '.' for bare ground
const world = (rows: readonly string[], ids: Readonly<Record<string, string>>) => {
  const at = new Map<string, string>();
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') at.set(`${x},${y}`, ids[ch]!); }));
  const tiles: WorldTile[] = [...at].map(([k, defId]) => {
    const [wx, wy] = k.split(',').map(Number) as [number, number];
    return { wx, wy, defId, color: getTileDef(defId).color };
  });
  return floorPieces(tiles, (x, y) => at.get(`${x},${y}`));
};
const pieceAt = (ps: readonly FloorPiece[], x: number, y: number) => ps.filter((p) => p.wx === x && p.wy === y);
const isSquare = (p: FloorPiece) => p.outline.length === 4 && p.outline.every(([u, v]) => (u === 0 || u === 1) && (v === 0 || v === 1));
const area = (pts: readonly (readonly [number, number])[]) => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]!; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const lab = (c: number) => {
  const f = (u: number) => (u > 0.04045 ? ((u + 0.055) / 1.055) ** 2.4 : u / 12.92);
  const [r, g, b] = [16, 8, 0].map((s) => f(((c >> s) & 255) / 255)) as [number, number, number];
  const h = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [x, y, z] = [(r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, r * 0.2126 + g * 0.7152 + b * 0.0722, (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883];
  return [116 * h(y) - 16, 500 * (h(x) - h(y)), 200 * (h(y) - h(z))];
};
const dist = (a: number, b: number) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]!));

// ===== Items (#11) =====
{
  const paths = itemsIn('paths').map((i) => i.id);
  assert.equal(paths.at(-1), 'overgrown-path');
  assert.equal(getTileDef('overgrown-path').name, 'Overgrown path');
  const floors = itemsIn('floors').map((i) => i.id);
  assert.equal(floors[floors.indexOf('turf-grass') + 1], 'turf-grass-dark');
  assert.equal(getTileDef('turf-grass').name, 'Turf grass light');
  assert.equal(getTileDef('turf-grass-dark').name, 'Turf grass dark');
  for (const id of ['overgrown-path', 'turf-grass', 'turf-grass-dark']) assert.ok(getTileDef(id).name.length <= 16);
  // the dark turf pairs with the light one but stands apart from the lawn and every other ground
  const grounds = CATALOG.filter((i) => i.kind === 'tile' || i.kind === 'terrain').map((i) => [i.id, (i as { color: number }).color] as const);
  const dark = getTileDef('turf-grass-dark').color;
  assert.ok(grounds.filter(([id]) => id !== 'turf-grass-dark').every(([, c]) => dist(dark, c) > 12), 'dark turf apart from every ground');
  // the overgrown path is old stone: related to the Stone path on purpose, apart from the rest
  const og = getTileDef('overgrown-path').color;
  assert.ok(grounds.filter(([id]) => !['overgrown-path', 'stone'].includes(id)).every(([, c]) => dist(og, c) > 14));
}
ok('Overgrown path ends the Paths tab; Turf grass light (same id) and Turf grass dark sit side by side');

// ===== Patterns =====
{
  // every floor and path has a pattern except the ones left plain on purpose
  const plain = ['epoxy', 'court-blue', 'court-green', 'court-red', 'court-yellow', 'mowed-grass', 'running-track'];
  const tiles = CATALOG.filter((i) => i.kind === 'tile' && (i.group === 'floors' || i.group === 'paths')).map((i) => i.id);
  tiles.forEach((id) => assert.equal(PATTERNS[id] === undefined, plain.includes(id), id));
  assert.ok(isPlain('epoxy') && isPlain('mowed-grass') && !isPlain('running-track') && !isPlain('wood-floor'), 'running track is plain but still a path');
  // a pattern comes from the world tile alone: the same tile always looks the same, neighbors differ
  const none = () => undefined;
  for (const id of Object.keys(PATTERNS)) {
    const a = JSON.stringify(PATTERNS[id]!(5, 7, 0x888888, none));
    assert.equal(a, JSON.stringify(PATTERNS[id]!(5, 7, 0x888888, none)), id);
    if (!['white-tile'].includes(id)) assert.notEqual(a, JSON.stringify(PATTERNS[id]!(6, 7, 0x888888, none)), `${id} varies`);
  }
  // drawn marks never leave their piece
  const ps = world(['ww.dd', 'bb.oo', 'cc.tt'], { w: 'wood-floor', d: 'dirt', b: 'red-brick', o: 'overgrown-path', c: 'cobblestone', t: 'terrazzo' });
  ps.forEach((p) => p.marks.forEach((m) => m.pts.forEach(([u, v]) => assert.ok(u >= -1e-9 && u <= 1 + 1e-9 && v >= -1e-9 && v <= 1 + 1e-9, `${p.defId} ${u},${v}`))));
}
ok('every floor and path but the plain ones has a pattern, fixed by its world tile, and kept inside its tile');

// bricks run on across tile edges: a brick cut by the edge keeps one shade on both sides
{
  const left = PATTERNS['red-brick']!(3, 2, 0x9a3f28, () => undefined), right = PATTERNS['red-brick']!(4, 2, 0x9a3f28, () => undefined);
  // the row shifted by a quarter tile: its brick across u = 1 on the left is the one from u = 0 on the right
  const atEdge = (marks: typeof left, u: number) => marks.find((m) => m.pts.some(([pu]) => Math.abs(pu - u) < 1e-9) && m.pts.some(([, pv]) => pv > 0.27 && pv < 0.48));
  assert.equal(atEdge(left, 1)?.color, atEdge(right, 0)?.color);
}
ok('a brick crossing a tile edge keeps one shade');

// ===== Diagonal paths =====
const S = { s: 'stone' };
{
  // a lone tile, a straight path's end, a right-angle turn and a plaza's corners stay square
  assert.ok(isSquare(pieceAt(world(['...', '.s.', '...'], S), 1, 1)[0]!));
  const straight = world(['.....', '.sss.', '.....'], S);
  assert.ok(straight.every(isSquare) && straight.length === 3);
  const turn = world(['sss', '..s', '..s'], S);
  assert.ok(turn.every(isSquare) && turn.length === 5);
  const plaza = world(['sss', 'sss', 'sss'], S);
  assert.ok(plaza.every(isSquare) && plaza.length === 9);
}
ok('a lone tile, a path end, a right-angle turn and a plaza stay square');
{
  // a one-tile diagonal: the middle tile loses the two corners off the line, keeps the two on it, and
  // each gap is bridged by two triangles in the bare tiles beside it
  const ps = world(['s..', '.s.', '..s'], S);
  const mid = pieceAt(ps, 1, 1)[0]!;
  assert.equal(mid.outline.length, 6);
  assert.ok(Math.abs(area(mid.outline) - 0.75) < 1e-9);
  assert.equal(pieceAt(ps, 1, 0).length, 1); assert.equal(pieceAt(ps, 0, 1).length, 1);
  assert.equal(pieceAt(ps, 2, 1).length, 1); assert.equal(pieceAt(ps, 1, 2).length, 1);
  assert.equal(pieceAt(ps, 2, 0).length + pieceAt(ps, 0, 2).length, 0);
  // the ends too lose the corners off the line (their far corner stays), so every tile is 0.75 and the
  // band is the same width all along: 3 tiles of 0.75 and 4 triangles of 1/8
  ps.filter((p) => p.outline.length !== 3).forEach((p) => assert.ok(Math.abs(area(p.outline) - 0.75) < 1e-9));
  assert.ok(Math.abs(ps.reduce((s, p) => s + area(p.outline), 0) - (3 * 0.75 + 4 / 8)) < 1e-9);
}
ok('a one-tile diagonal is a straight band: corners cut off the line, gaps bridged');
{
  // a band of steps two wide: outer corners cut, inner notches filled
  const ps = world(['ss....', 'sss...', '.sss..', '..sss.', '...ss.'], S);
  const cuts = ps.filter((p) => !isSquare(p) && p.outline.length > 3);
  const fills = ps.filter((p) => p.outline.length === 3);
  assert.ok(cuts.length >= 4 && fills.length >= 3, `${cuts.length} cut, ${fills.length} filled`);
  // a single jog on a two-wide path: one cut corner and one filled notch on each side
  const jog = world(['sss...', 'ssssss', '...sss'], S);
  assert.equal(jog.filter((p) => p.outline.length === 3).length, 2);
  assert.equal(jog.filter((p) => p.outline.length === 5).length, 2);
}
ok('a band of steps and a single jog take diagonal edges on both sides');
{
  // different paths, and floors that are not paths, never cut or fill
  const mixed = world(['b..', '.c.', '..b'], { b: 'red-brick', c: 'cobblestone' });
  assert.ok(mixed.every(isSquare) && mixed.length === 3);
  const wood = world(['w..', '.w.', '..w'], { w: 'wood-floor' });
  assert.ok(wood.every(isSquare) && wood.length === 3);
  // a jog whose notch holds another floor stays square on that side (the other side still smooths)
  const byFloor = world(['sssw..', 'ssssss', '...sss'], { w: 'wood-floor', s: 'stone' });
  assert.ok(isSquare(pieceAt(byFloor, 2, 0)[0]!));
  assert.equal(pieceAt(byFloor, 3, 0).length, 1, 'the wood tile only, no triangle of stone on it');
  assert.equal(byFloor.filter((p) => p.outline.length === 3).length, 1);
}
ok('only one path type joins itself diagonally; floors stay square');

// ===== The dirt path blends into the grass =====
{
  const ps = world(['.....', '.ddd.', '.dds.', '.....'], { d: 'dirt', s: 'stone' });
  // a grassy band per open half side (sides are split at their middle, where a diagonal may meet them)
  const fringeOf = (p: FloorPiece) => p.marks.filter((m) => m.color === 0x3a7d44 && m.pts.length >= 6).length;
  // the middle-top tile has grass only on its top side; the tile beside the stone path none there
  const top = pieceAt(ps, 2, 1)[0]!;
  assert.equal(fringeOf(top), 2);
  const byStone = pieceAt(ps, 2, 2)[0]!;
  assert.equal(fringeOf(byStone), 2, 'grass from below only, not from the stone path');
  // edges facing bare ground take the lawn's grid line; edges against floors the dirt's own outline
  const open = top.edges.filter((e) => e.color === GRID_LINE);
  assert.equal(open.length, 1);
  assert.ok(open.every((e) => e.a[1] === 0 && e.b[1] === 0));
  // a stone path never grows grass
  const stone = pieceAt(ps, 3, 2)[0]!;
  assert.ok(stone.edges.every((e) => e.color !== GRID_LINE));
  // diagonal dirt edges grow grass too
  const diag = world(['d..', '.d.', '..d'], { d: 'dirt' });
  const mid = pieceAt(diag, 1, 1)[0]!;
  assert.ok(fringeOf(mid) >= 2);
}
ok('the dirt path grows grass on edges facing bare ground, straight or diagonal, and nowhere else');
