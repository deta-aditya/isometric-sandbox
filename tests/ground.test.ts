import { strict as assert } from 'node:assert';
import { sizeOf } from '../src/geometry.ts';
import { type History, type HistoryAction, canUndo, initialHistory, step, worldOf, sameWorld } from '../src/history.ts';
import { type Blueprint, blueprintOf, emptyWorld, gameWorldOf, withoutGround } from '../src/world.ts';
import { pointToView } from '../src/view.ts';

const SQ = sizeOf(64, 64);
const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
const pt = (x: number, y: number) => ({ cell: { x: Math.floor(x), y: Math.floor(y) }, point: { x, y } });
const drag = (a: [number, number], b: [number, number]): HistoryAction[] =>
  [{ type: 'hover', ...pt(...a) }, { type: 'press', ...pt(...a) }, { type: 'hover', ...pt(...b) }, { type: 'release' }];
const click = (x: number, y: number) => drag([x, y], [x, y]);
const shift = (held: boolean): HistoryAction[] => [{ type: 'setShift', held }, { type: 'setCtrl', held: false }];
const brush1 = (h: History): History => { let out = h; while (out.state.brushSize !== 1) out = step(out, { type: 'stepBrush', step: -1 }); return out; };
const terrainAt = (h: History, x: number, y: number) => h.state.terrain.find((t) => t.x === x && t.y === y)?.defId;
const SAND = 'terrain-sand';
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

// A fresh game on a given ground, as main.ts starts one
const game = (ground: string, size = SQ): History => run(initialHistory, { type: 'replaceWorld', world: emptyWorld(size, ground) });
const sandy = () => brush1(game(SAND));

// ===== The ground is part of the world =====
assert.equal(initialHistory.state.ground, 'grass');
assert.equal(emptyWorld(SQ).ground, 'grass');
assert.equal(game(SAND).state.ground, SAND);
assert.equal(gameWorldOf(game(SAND).state).ground, SAND);
assert.equal(game(SAND).committed.ground, SAND);
ok('a new game takes its ground, and it travels with the world');

// The fingerprint changes with ground, even when every list is rebuilt
const a = worldOf(game('grass').state);
const b = { ...worldOf(game(SAND).state), objects: [...a.objects], tiles: [...a.tiles], terrain: [...a.terrain], walls: [...a.walls], culverts: [...a.culverts] };
assert.equal(sameWorld(a, b), false);
assert.equal(sameWorld(a, { ...a, terrain: [...a.terrain] }), true);
ok('the history fingerprint changes with the ground');

// ===== Painting =====
// Sand is the ground here: painting sand erases an entry, painting grass sets one
let h = run(sandy(), { type: 'select', id: 'moss' }, ...click(10.5, 10.5));
assert.equal(terrainAt(h, 10, 10), 'moss');
h = run(h, { type: 'select', id: SAND }, ...click(10.5, 10.5));
assert.equal(h.state.terrain.length, 0); // the ground's own item erases
h = run(h, { type: 'select', id: 'grass' }, ...click(12.5, 10.5));
assert.equal(terrainAt(h, 12, 10), 'grass'); // grass is an entry on a sand map
h = run(h, { type: 'select', id: SAND }, ...click(12.5, 10.5));
assert.equal(h.state.terrain.length, 0);
// sand over bare sand changes nothing, and is not an undo step
const before = h;
h = run(h, ...click(30.5, 30.5));
assert.equal(h.state.terrain, before.state.terrain); assert.equal(h.past.length, before.past.length);
// a stroke is one undo step, and undo brings the entries back
h = run(sandy(), { type: 'select', id: 'clay' }, ...drag([5.5, 5.5], [9.5, 5.5]));
assert.equal(h.state.terrain.length, 5); assert.equal(h.past.length, 1);
h = run(h, { type: 'select', id: SAND }, ...drag([6.5, 5.5], [7.5, 5.5]));
assert.deepEqual(h.state.terrain.map((t) => t.x).sort((p, q) => p - q), [5, 8, 9]);
assert.equal(canUndo(h), true);
h = run(h, { type: 'undo' });
assert.equal(h.state.terrain.length, 5);
ok('painting: the ground item erases entries, any other item (grass too) sets them, strokes undo as one step');

// On a grass map nothing changed: grass erases
h = run(brush1(game('grass')), { type: 'select', id: 'moss' }, ...click(4.5, 4.5), { type: 'select', id: 'grass' }, ...click(4.5, 4.5));
assert.equal(h.state.terrain.length, 0);
ok('on a grass map grass still erases');

// Bounds: a wide brush at the edge paints only inside the map
h = run(game(SAND, sizeOf(16, 16)), { type: 'select', id: 'clay' }, ...click(0.5, 0.5));
assert.ok(h.state.terrain.length > 0 && h.state.terrain.every((t) => t.x >= 0 && t.y >= 0 && t.x < 16 && t.y < 16));
ok('the brush stays inside the map on a sand map');

// ===== Fills =====
// Shift + click over bare ground on a sand map paints the whole bare region; bare ground is one terrain
const small = sizeOf(16, 16);
h = run(brush1(game(SAND, small)), { type: 'select', id: 'moss' }, ...shift(true), ...click(3.5, 3.5), ...shift(false));
assert.equal(h.state.terrain.length, 256); assert.ok(h.state.terrain.every((t) => t.defId === 'moss'));
// fill the moss with the ground again: the entries go
h = run(h, { type: 'select', id: SAND }, ...shift(true), ...click(3.5, 3.5), ...shift(false));
assert.equal(h.state.terrain.length, 0);
// a fill that stops at a ring of other terrain: only the bare inside is reached
let ring = brush1(game(SAND, small)); ring = run(ring, { type: 'select', id: 'clay' });
for (const [x, y] of [[4, 4], [5, 4], [6, 4], [4, 5], [6, 5], [4, 6], [5, 6], [6, 6]]) ring = run(ring, ...click(x! + 0.5, y! + 0.5));
const ringed = run(ring, { type: 'select', id: 'moss' }, ...shift(true), ...click(5.5, 5.5), ...shift(false));
assert.equal(terrainAt(ringed, 5, 5), 'moss'); assert.equal(terrainAt(ringed, 4, 4), 'clay'); assert.equal(terrainAt(ringed, 0, 0), undefined);
assert.equal(ringed.state.terrain.length, 9);
// painting the ground over a bare region is a no-op
const noop = run(brush1(game(SAND, small)), { type: 'select', id: SAND }, ...shift(true), ...click(3.5, 3.5), ...shift(false));
assert.equal(noop.state.terrain.length, 0); assert.equal(noop.past.length, 0);
// grass fill over a sand map's bare ground sets entries
const grassy = run(brush1(game(SAND, small)), { type: 'select', id: 'grass' }, ...shift(true), ...click(3.5, 3.5), ...shift(false));
assert.equal(grassy.state.terrain.length, 256); assert.ok(grassy.state.terrain.every((t) => t.defId === 'grass'));
ok('fills: bare ground on a non-grass map counts as the ground, and filling with the ground erases');

// ===== Picking and editing: only entries are things =====
const bare = sandy();
assert.equal(run(bare, { type: 'useSelect' }, ...click(20.5, 20.5)).state.selection, null);
// the bulldoze tool ignores bare ground
const dozed = run(bare, { type: 'toggleBulldoze' }, ...click(20.5, 20.5));
assert.equal(dozed.past.length, 0);
// the picker over bare ground picks the ground; over an entry it picks the entry
let picked = run(bare, { type: 'togglePicker' }, { type: 'hover', ...pt(20.5, 20.5) }, { type: 'press', ...pt(20.5, 20.5) }, { type: 'release' });
assert.equal(picked.state.tool, 'build'); assert.equal(picked.state.selectedId, SAND);
const painted = run(bare, { type: 'select', id: 'clay' }, ...click(20.5, 20.5));
picked = run(painted, { type: 'togglePicker' }, { type: 'hover', ...pt(20.5, 20.5) }, { type: 'press', ...pt(20.5, 20.5) }, { type: 'release' });
assert.equal(picked.state.selectedId, 'clay');
ok('bare ground is not selected or bulldozed, and the picker on it picks the ground');

// ===== replaceWorld drops entries equal to the ground =====
const dirty = { ...emptyWorld(small, SAND), terrain: [{ x: 0, y: 0, defId: SAND }, { x: 1, y: 0, defId: 'moss' }, { x: 2, y: 0, defId: 'grass' }] };
const replaced = run(initialHistory, { type: 'replaceWorld', world: dirty });
assert.deepEqual(replaced.state.terrain.map((t) => t.defId), ['moss', 'grass']);
assert.deepEqual(replaced.committed.terrain.map((t) => t.defId), ['moss', 'grass']);
assert.deepEqual(withoutGround('grass', [{ defId: 'grass' }, { defId: 'moss' }]), [{ defId: 'moss' }]);
ok('replaceWorld drops entries equal to the ground');

// ===== Pasting a blueprint with sand onto a sand map stores nothing for those tiles =====
// Saved on a grass map: a block of sand and a block of moss
let src = brush1(game('grass')); src = run(src, { type: 'select', id: SAND }, ...drag([10.5, 10.5], [11.5, 10.5]), { type: 'select', id: 'moss' }, ...drag([12.5, 10.5], [13.5, 10.5]));
assert.equal(src.state.terrain.length, 4);
// select no longer takes terrain, so this is a blueprint saved before that change, holding the lot
const bp: Blueprint | undefined = blueprintOf(1, 'Older blueprint', { objects: [], walls: [], tiles: [], culverts: [], terrain: src.state.terrain });
assert.ok(bp && bp.pieces.terrain.length === 4);
const lands = (ground: string, size = SQ): History => {
  const into: History = { ...game(ground, size), state: { ...game(ground, size).state, blueprints: [bp!] } };
  return run(into, { type: 'placeBlueprint', id: bp!.id }, { type: 'hover', ...pt(30.5, 30.5) }, { type: 'press', ...pt(30.5, 30.5) }, { type: 'release' });
};
const onSand = lands(SAND);
assert.deepEqual(onSand.state.terrain.map((t) => t.defId), ['moss', 'moss']); // the sand tiles say nothing on a sand map
const onGrass = lands('grass');
assert.deepEqual(onGrass.state.terrain.map((t) => t.defId).sort(), ['moss', 'moss', SAND, SAND]);
// sand landing over existing clay on a sand map clears the clay instead of storing sand
let over = run(sandy(), { type: 'select', id: 'clay' }, ...drag([30.5, 30.5], [33.5, 30.5]));
over = run({ ...over, state: { ...over.state, blueprints: [bp!] } }, { type: 'placeBlueprint', id: bp!.id }, { type: 'hover', ...pt(30.5, 30.5) }, { type: 'press', ...pt(30.5, 30.5) }, { type: 'release' });
assert.ok(over.state.terrain.every((t) => t.defId !== SAND));
assert.deepEqual(over.state.terrain.map((t) => `${t.x}:${t.defId}`).sort(), ['31:moss', '32:moss', '33:clay']); // the clay under the sand is gone, not replaced by sand
// the same from a turned camera
const quarter = (x: number, y: number) => { const p = pointToView({ x, y }, 1, SQ); return pt(p.x, p.y); };
const into2: History = { ...game(SAND), state: { ...game(SAND).state, blueprints: [bp!] } };
const turned = run(into2, { type: 'rotateView', dir: 1 }, { type: 'placeBlueprint', id: bp!.id }, { type: 'hover', ...quarter(30.5, 30.5) }, { type: 'press', ...quarter(30.5, 30.5) }, { type: 'release' });
assert.equal(turned.state.terrain.length, 2); assert.ok(turned.state.terrain.every((t) => t.defId === 'moss'));
ok('a blueprint with sand placed on a sand map stores nothing for the sand tiles (all four views kept the rule)');
for (const turns of [1, 2, 3]) {
  let t2 = into2; for (let i = 0; i < turns; i++) t2 = run(t2, { type: 'rotateView', dir: 1 });
  const pos = pointToView({ x: 30.5, y: 30.5 }, turns as 1 | 2 | 3, SQ);
  t2 = run(t2, { type: 'placeBlueprint', id: bp!.id }, { type: 'hover', ...pt(pos.x, pos.y) }, { type: 'press', ...pt(pos.x, pos.y) }, { type: 'release' });
  assert.equal(t2.state.terrain.length, 2, `view ${turns}`); assert.ok(t2.state.terrain.every((t) => t.defId === 'moss'));
}
ok('the same from every camera turn');

// ===== Undo =====
// A new game's ground is not undone (replaceWorld starts a fresh history), and undo keeps the ground
h = run(sandy(), { type: 'select', id: 'clay' }, ...click(3.5, 3.5), { type: 'undo' });
assert.equal(h.state.ground, SAND); assert.equal(h.state.terrain.length, 0);
ok('undo keeps the ground');

// A fresh game on a chosen ground has nothing to lose (the ground alone is not unsaved work)
{
  const { isDirty, newSession } = await import('../src/session.ts');
  const fresh = game(SAND);
  assert.equal(isDirty(newSession('A', 5), fresh.committed), false);
  assert.equal(isDirty(newSession('A', 5), run(fresh, { type: 'select', id: 'clay' }, ...click(3.5, 3.5)).committed), true);
  ok('a fresh game on sand is not dirty until something is built');
}
