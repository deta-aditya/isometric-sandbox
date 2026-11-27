import { strict as assert } from 'node:assert';
import { type History, type HistoryAction, initialHistory, step } from '../src/history.ts';
import { decodeBlueprints, encodeBlueprints } from '../src/blueprintStore.ts';
import { pointToView } from '../src/view.ts';
import { canSaveBlueprint, wallAt } from '../src/world.ts';
import { sizeOf } from '../src/geometry.ts';
const SQ = sizeOf(64, 64);
const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
const pt = (x: number, y: number) => ({ cell: { x: Math.floor(x), y: Math.floor(y) }, point: { x, y } });
const drag = (a: [number, number], b: [number, number]): HistoryAction[] =>
  [{ type: 'hover', ...pt(...a) }, { type: 'press', ...pt(...a) }, { type: 'hover', ...pt(...b) }, { type: 'release' }];
const click = (x: number, y: number) => drag([x, y], [x, y]);
const wall = (h: History, axis: 'x' | 'y', x: number, y: number) => wallAt(h.state, { axis, x, y });
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

// a small furnished room (cells 10..12 x 10..11), sky inside, a door south, a crate and a chair
const world = run(initialHistory,
  { type: 'select', id: 'plaster' }, { type: 'setWallMode', mode: 'square' }, ...drag([10.5, 10.5], [12.5, 11.5]),
  { type: 'select', id: 'paint-sky' }, { type: 'setShift', held: true }, ...click(11.5, 10.2), { type: 'setShift', held: false },
  { type: 'select', id: 'wooden-door' }, ...click(11.5, 12.02),
  { type: 'select', id: 'crate' }, ...click(10.5, 10.5), { type: 'select', id: 'chair' }, ...click(12.5, 11.5),
  { type: 'useSelect' });
const marked = run(world, ...drag([13.5, 12.5], [9.5, 9.5]));
const total = (h: History) => h.state.walls.length + h.state.objects.length + h.state.tiles.length;
const roomSize = total(world);

// ===== Saving =====
assert.equal(canSaveBlueprint(world.state), false);
assert.equal(canSaveBlueprint(marked.state), true);
let h = run(marked, { type: 'saveBlueprint' });
assert.equal(h.state.blueprints.length, 1);
const bp = h.state.blueprints[0]!;
assert.equal(bp.name, 'Blueprint 1');
const xs = [...bp.pieces.objects.map((o) => o.x), ...bp.pieces.tiles.map((t) => t.x)];
assert.equal(Math.min(...xs), 1); // moved to the origin: the bounds start at the cells just outside its west wall
assert.equal(Math.min(...bp.pieces.walls.map((w) => w.x)), 1);
assert.equal(bp.pieces.walls.length + bp.pieces.objects.length + bp.pieces.tiles.length, roomSize);
assert.equal(h.past.length, marked.past.length); // not an undo step
assert.equal(h.state.walls, marked.state.walls);
h = run(h, { type: 'saveBlueprint' });
assert.deepEqual(h.state.blueprints.map((b) => b.name), ['Blueprint 1', 'Blueprint 2']);
assert.notEqual(h.state.blueprints[0]!.id, h.state.blueprints[1]!.id);
assert.equal(run(world, { type: 'saveBlueprint' }).state.blueprints.length, 0); // nothing marked
// with nothing marked, Save gets the player ready to mark: the select tool, tray still open, no step
const ready = run(world, { type: 'select', id: 'crate' }, { type: 'toggleBlueprints' }, { type: 'saveBlueprint' });
assert.equal(ready.state.tool, 'select');
assert.equal(ready.state.trayOpen && ready.state.blueprintTray, true);
assert.equal(ready.state.blueprints.length, 0);
ok('saving keeps the marks at the origin with a free name, without touching the world or undo');

// ===== Renaming and deleting =====
const id1 = h.state.blueprints[0]!.id;
h = run(h, { type: 'renameBlueprint', id: id1, name: '  Classroom  ' });
assert.equal(h.state.blueprints[0]!.name, 'Classroom');
assert.equal(run(h, { type: 'renameBlueprint', id: id1, name: '   ' }).state.blueprints[0]!.name, 'Classroom'); // blank is ignored
assert.equal(run(h, { type: 'renameBlueprint', id: id1, name: 'x'.repeat(80) }).state.blueprints[0]!.name.length, 40);
// a freed name is reused
const three = run(h, { type: 'saveBlueprint' });
assert.equal(three.state.blueprints.at(-1)!.name, 'Blueprint 1');
h = run(h, { type: 'deleteBlueprint', id: h.state.blueprints[1]!.id });
assert.deepEqual(h.state.blueprints.map((b) => b.name), ['Classroom']);
ok('rename trims and caps names (blank ignored), delete removes one, free names are reused');

// ===== Placing =====
// placing holds a copy like a paste: each click places the whole room again
h = run(h, { type: 'cancel' }, { type: 'placeBlueprint', id: id1 });
assert.equal(h.state.selection?.kind, 'group');
assert.equal(h.state.selection?.kind === 'group' && h.state.selection.name, 'Classroom');
h = run(h, ...click(31.5, 30.5), ...click(41.5, 30.5));
assert.equal(total(h), roomSize * 3);
assert.equal(wall(h, 'x', 31, 32)?.opening, 'wooden-door');
assert.equal(wall(h, 'x', 31, 30)?.paint.after, 'paint-sky');
const ids = h.state.objects.map((o) => o.id);
assert.equal(new Set(ids).size, ids.length);
ok('placing a blueprint holds a copy; each click places the whole group with fresh ids');

// number keys place blueprints while their tray is open, and pick catalog items otherwise
h = run(h, { type: 'cancel' }, { type: 'toggleBlueprints' });
assert.equal(h.state.trayOpen && h.state.blueprintTray, true);
const byKey = run(h, { type: 'selectIndex', index: 0 });
assert.equal(byKey.state.selection?.kind, 'group');
const catalog = run(h, { type: 'selectCategory', category: 'scenery' });
assert.equal(catalog.state.blueprintTray, false);
assert.equal(run(catalog, { type: 'selectIndex', index: 0 }).state.tool, 'build');
assert.equal(run(h, { type: 'toggleBlueprints' }).state.trayOpen, false);
ok('the Blueprints button opens and closes their tray; its number keys place them');

// undo never touches the library
const undone = step(run(marked, { type: 'saveBlueprint' }, { type: 'deleteSelection' }), { type: 'undo' });
assert.equal(undone.state.blueprints.length, 1);
assert.equal(total(undone), roomSize);
ok('undo leaves the blueprint library alone');

// a blueprint keeps its world facing: saved in view 0, placed from view 1, it lands as in view 0
const saved = run(marked, { type: 'saveBlueprint' }, { type: 'cancel' });
const id = saved.state.blueprints[0]!.id;
const v1 = (x: number, y: number) => { const p = pointToView({ x, y }, 1, SQ); return pt(p.x, p.y); };
const fromView0 = run(saved, { type: 'placeBlueprint', id }, { type: 'hover', ...pt(31.5, 30.5) }, { type: 'press', ...pt(31.5, 30.5) }, { type: 'release' });
const fromView1 = run(saved, { type: 'rotateView', dir: 1 }, { type: 'placeBlueprint', id }, { type: 'hover', ...v1(31.5, 30.5) }, { type: 'press', ...v1(31.5, 30.5) }, { type: 'release' });
const key = (h: History) => h.state.walls.map((w) => `${w.axis}${w.x},${w.y}:${w.opening}:${w.paint.before}/${w.paint.after}`).sort().join(' ');
assert.equal(key(fromView1), key(fromView0));
ok('a blueprint keeps its world facing when placed from a turned camera');

// ===== The browser store =====
const lib = run(marked, { type: 'saveBlueprint' }).state.blueprints;
assert.deepEqual(decodeBlueprints(encodeBlueprints(lib)), lib);
assert.deepEqual(decodeBlueprints(null), []);
assert.deepEqual(decodeBlueprints('not json'), []);
assert.deepEqual(decodeBlueprints(JSON.stringify({ version: 99, blueprints: lib })), []);
// unknown items are dropped piece by piece; an unknown door leaves its wall; an empty blueprint goes
const tampered = JSON.parse(encodeBlueprints(lib));
tampered.blueprints[0].pieces.objects[0].defId = 'no-such-thing';
tampered.blueprints[0].pieces.walls.find((w: { opening: string | null }) => w.opening).opening = 'no-such-door';
tampered.blueprints.push({ id: 99, name: 'empty', anchor: { x: 0, y: 0 }, pieces: { objects: [{ defId: 'nope', x: 0, y: 0, w: 1, h: 1, rotation: 0 }] } });
tampered.blueprints.push({ id: lib[0]!.id, name: 'duplicate id', anchor: { x: 0, y: 0 }, pieces: lib[0]!.pieces });
const read = decodeBlueprints(JSON.stringify(tampered));
assert.equal(read.length, 1);
assert.equal(read[0]!.pieces.objects.length, lib[0]!.pieces.objects.length - 1);
assert.equal(read[0]!.pieces.walls.length, lib[0]!.pieces.walls.length);
assert.equal(read[0]!.pieces.walls.filter((w) => w.opening).length, 0);
ok('the store reads back what it wrote, and drops what it cannot trust instead of failing');

// ===== Terrain =====
{
  // a 2x2 of moss with a lone crate on it, marked with a box
  const painted = run(initialHistory, { type: 'select', id: 'moss' }, { type: 'stepBrush', step: -1 }, ...click(20, 20), { type: 'select', id: 'crate' }, ...click(19.5, 19.5), { type: 'useSelect' });
  assert.equal(painted.state.terrain.length, 4);
  const marked2 = run(painted, ...drag([17.5, 17.5], [22.5, 22.5]));
  const saved2 = run(marked2, { type: 'saveBlueprint' });
  const tbp = saved2.state.blueprints[0]!;
  assert.equal(tbp.pieces.terrain.length, 4);
  assert.equal(Math.min(...tbp.pieces.terrain.map((t) => t.x)), 0); // at the origin with the rest
  assert.equal(saved2.past.length, painted.past.length);
  const back = decodeBlueprints(encodeBlueprints(saved2.state.blueprints));
  assert.deepEqual(back, saved2.state.blueprints);
  // placing it elsewhere puts the terrain there, in one step, with the object
  let placed = run(saved2, { type: 'cancel' }, { type: 'placeBlueprint', id: tbp.id }, ...click(40.5, 40.5));
  assert.equal(placed.state.terrain.length, 8);
  assert.equal(placed.state.objects.length, 2);
  assert.ok(placed.state.terrain.some((t) => t.x >= 40 && t.defId === 'moss'));
  assert.equal(placed.past.length, painted.past.length + 1);
  // from a turned camera it lands on the same world cells
  const quarter = (x: number, y: number) => { const p = pointToView({ x, y }, 1, SQ); return pt(p.x, p.y); };
  const turned = run(saved2, { type: 'cancel' }, { type: 'rotateView', dir: 1 }, { type: 'placeBlueprint', id: tbp.id }, { type: 'hover', ...quarter(40.5, 40.5) }, { type: 'press', ...quarter(40.5, 40.5) }, { type: 'release' });
  const cells = (hh: History) => hh.state.terrain.map((t) => `${t.x},${t.y}`).sort().join(' ');
  assert.equal(cells(turned), cells(placed));
  ok('a blueprint stores terrain with the rest, reads back whole, and places the same from any view');

  // terrain alone is enough for a blueprint, and what the catalog does not know is dropped
  const bare = JSON.parse(encodeBlueprints(saved2.state.blueprints));
  bare.blueprints[0].pieces = { terrain: [{ x: 0, y: 0, defId: 'moss' }, { x: 1, y: 0, defId: 'grass' }, { x: 2, y: 0, defId: 'no-such-ground' }, { x: 3, y: 0, defId: 'wood-floor' }, { x: 4, y: 0, defId: 'turf' }] };
  const kept = decodeBlueprints(JSON.stringify(bare));
  assert.deepEqual(kept[0]!.pieces.terrain.map((t) => t.defId), ['moss', 'grass', 'turf']); // grass is a terrain like any other (a map's ground may be sand)
  bare.blueprints[0].pieces = { terrain: [{ x: 0, y: 0, defId: 'no-such-ground' }] };
  assert.deepEqual(decodeBlueprints(JSON.stringify(bare)), []); // nothing left, so no blueprint
  ok('stored terrain is validated: unknown ids and non-terrain are dropped, grass is kept');

  // a version 1 library had gravel and sand as tiles: they come back as terrain at the same cells
  const old = {
    version: 1,
    blueprints: [{
      id: 3, name: 'Old yard', anchor: { x: 1, y: 0 },
      pieces: { objects: [], walls: [], culverts: [], tiles: [{ x: 0, y: 0, defId: 'gravel' }, { x: 1, y: 0, defId: 'sand' }, { x: 2, y: 0, defId: 'stone' }, { x: 3, y: 0, defId: 'gone' }] },
    }],
  };
  const upgraded = decodeBlueprints(JSON.stringify(old));
  assert.equal(upgraded.length, 1);
  assert.deepEqual(upgraded[0]!.pieces.tiles, [{ x: 2, y: 0, defId: 'stone' }]);
  assert.deepEqual(upgraded[0]!.pieces.terrain, [{ x: 0, y: 0, defId: 'terrain-gravel' }, { x: 1, y: 0, defId: 'terrain-sand' }]);
  // a library of only gravel and sand is not empty any more
  old.blueprints[0]!.pieces.tiles = [{ x: 0, y: 0, defId: 'sand' }];
  assert.equal(decodeBlueprints(JSON.stringify(old))[0]?.pieces.terrain[0]?.defId, 'terrain-sand');
  // written again it is the current version (3), and from version 2 on an old gravel tile is just an unknown tile
  assert.equal(JSON.parse(encodeBlueprints(upgraded)).version, 3);
  assert.deepEqual(decodeBlueprints(encodeBlueprints(upgraded)), upgraded);
  assert.deepEqual(decodeBlueprints(JSON.stringify({ ...old, version: 2 })), []);
  ok('version 1 blueprints turn gravel and sand tiles into terrain; the library is written as the current version');
}
