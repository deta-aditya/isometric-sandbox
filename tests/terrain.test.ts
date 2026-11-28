import { strict as assert } from 'node:assert';
import { BRUSH_SIZES, DEFAULT_BRUSH, brushCells, strokeCells } from '../src/brush.ts';
import { CATEGORIES, FILTER_ORDER, getItem, groupsOf, isTerrain } from '../src/catalog.ts';
import { sizeOf } from '../src/geometry.ts';
import { type History, type HistoryAction, canRedo, canUndo, initialHistory, step } from '../src/history.ts';
import { pointToView } from '../src/view.ts';
import { type FillMode, bulldozePlan, pickTarget, terrainFill } from '../src/world.ts';

const SQ = sizeOf(64, 64);
const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
const pt = (x: number, y: number) => ({ cell: { x: Math.floor(x), y: Math.floor(y) }, point: { x, y } });
const drag = (a: [number, number], b: [number, number]): HistoryAction[] =>
  [{ type: 'hover', ...pt(...a) }, { type: 'press', ...pt(...a) }, { type: 'hover', ...pt(...b) }, { type: 'release' }];
const click = (x: number, y: number) => drag([x, y], [x, y]);
const hover = (x: number, y: number): HistoryAction => ({ type: 'hover', ...pt(x, y) });
const shift = (held: boolean, ctrl = false): HistoryAction[] => [{ type: 'setShift', held }, { type: 'setCtrl', held: held && ctrl }];
const keys = (cs: readonly { x: number; y: number }[]) => cs.map((c) => `${c.x},${c.y}`).sort();
const terrainKeys = (h: History) => keys(h.state.terrain);
const terrainAt = (h: History, x: number, y: number) => h.state.terrain.find((t) => t.x === x && t.y === y)?.defId;
const tileAt = (h: History, x: number, y: number) => h.state.tiles.find((t) => t.x === x && t.y === y)?.defId;
const marks = (h: History) => (h.state.selection?.kind === 'marked' ? h.state.selection.targets : []);
const brush = (h: History, size: number): History => {
  let out = h;
  while (out.state.brushSize !== size) out = step(out, { type: 'stepBrush', step: out.state.brushSize < size ? 1 : -1 });
  return out;
};
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

// ===== Catalog =====
assert.ok(isTerrain('lush-grass') && isTerrain('soil-dirt') && !isTerrain('dirt') && !isTerrain('stone'));
assert.equal(getItem('soil-dirt').name, 'Soil');
assert.equal(getItem('dirt').kind, 'tile'); // the path keeps its id
assert.throws(() => getItem('gravel'));
assert.throws(() => getItem('sand'));
assert.equal(getItem('flowery-grass').kind === 'terrain' && getItem('flowery-grass').specks?.length, 4);
// Terrain sits after Flooring in the bar; the filter keys keep 1 to 4 and give Terrain the fifth
assert.deepEqual(CATEGORIES.map((c) => c.id), ['scenery', 'furniture', 'flooring', 'terrain', 'building']);
assert.deepEqual(FILTER_ORDER, ['scenery', 'furniture', 'flooring', 'building', 'terrain']);
assert.deepEqual(groupsOf('terrain').map((g) => g.name), ['Grassland', 'Desert', 'Savanna', 'Tropical', 'Wetland', 'Coastal', 'Cold', 'Alpine']);
ok('terrain items are in the catalog, Dirt has its own id, and the old gravel and sand tiles are gone');

// ===== Painting =====
const base = run(initialHistory, { type: 'select', id: 'lush-grass' });
assert.equal(base.state.brushSize, DEFAULT_BRUSH);
// the brush size steps along its sizes and stops at the ends; it is not an undo step
let h = run(base, { type: 'stepBrush', step: -1 });
assert.equal(h.state.brushSize, 2);
assert.equal(step(h, { type: 'stepBrush', step: 1 }).state.brushSize, DEFAULT_BRUSH);
const smallest = brush(base, 1), largest = brush(base, 12);
assert.equal(smallest.state.brushSize, 1);
assert.equal(step(smallest, { type: 'stepBrush', step: -1 }), smallest); // already smallest
assert.equal(largest.state.brushSize, 12);
assert.equal(step(largest, { type: 'stepBrush', step: 1 }), largest); // already largest
assert.equal(h.past.length, 0);
ok('the brush size steps through its sizes and stops at the ends, outside undo');

// a stroke paints exactly the cells the brush covers on the way, as one undo step
h = run(base, hover(10.5, 10.5), { type: 'press', ...pt(10.5, 10.5) }, hover(14.5, 10.5), hover(14.5, 14.5), { type: 'release' });
const expected = keys([...strokeCells({ x: 10.5, y: 10.5 }, { x: 14.5, y: 10.5 }, 3), ...strokeCells({ x: 14.5, y: 10.5 }, { x: 14.5, y: 14.5 }, 3)]);
assert.deepEqual(terrainKeys(h), [...new Set(expected)].sort());
assert.ok(h.state.terrain.every((t) => t.defId === 'lush-grass'));
assert.equal(h.state.drag, null);
assert.equal(h.past.length, 1);
assert.equal(h.state.tiles.length, 0); // terrain is not a floor
h = step(h, { type: 'undo' });
assert.equal(h.state.terrain.length, 0);
assert.equal(canUndo(h), false);
assert.ok(canRedo(h));
h = step(h, { type: 'redo' });
assert.deepEqual(terrainKeys(h), [...new Set(expected)].sort());
ok('a stroke paints the brush cells along its path in one undo step');

// a press alone stamps the brush; nothing is committed while the button is down
let down = run(base, hover(20.5, 20.5), { type: 'press', ...pt(20.5, 20.5) });
assert.deepEqual(terrainKeys(down), keys(brushCells({ x: 20.5, y: 20.5 }, 3)));
assert.equal(down.state.drag?.mode, 'brush');
assert.equal(down.past.length, 0);
down = step(down, { type: 'release' });
assert.equal(down.past.length, 1);
// a press and release on the same spot with every size is just that brush stamp
BRUSH_SIZES.forEach((size) => assert.deepEqual(terrainKeys(run(brush(base, size), ...click(30.3, 30.7))), keys(brushCells({ x: 30.3, y: 30.7 }, size))));
ok('a press stamps the brush at once and the stroke is committed on release; every size stamps its own shape');

// painting over the same terrain changes nothing; a different one replaces it, one per tile
assert.equal(run(h, ...click(12.5, 10.5)).past.length, 1);
let two = run(h, { type: 'select', id: 'moss' }, ...click(12.5, 10.5));
assert.equal(terrainAt(two, 12, 10), 'moss');
assert.equal(terrainAt(two, 10, 10), 'lush-grass');
assert.equal(new Set(terrainKeys(two)).size, two.state.terrain.length);
assert.equal(two.past.length, 2);
ok('repainting the same terrain is no step; another terrain replaces it, one per tile');

// Grass is the eraser: it takes the terrain away and is never stored
two = run(two, { type: 'select', id: 'grass' }, ...click(12.5, 10.5));
assert.equal(terrainAt(two, 12, 10), undefined);
assert.equal(terrainAt(two, 10, 10), 'lush-grass');
assert.ok(two.state.terrain.every((t) => t.defId !== 'grass'));
assert.ok(two.state.terrain.length < h.state.terrain.length + 9);
assert.equal(run(base, { type: 'select', id: 'grass' }, ...click(40.5, 40.5)).past.length, 0); // nothing to erase
ok('the Grass item erases terrain and is never stored');

// cells off the map are skipped
h = run(base, ...click(0.5, 0.5));
assert.equal(h.state.terrain.length, 4); // the 3x3 brush at the corner keeps its 2x2 on the map
assert.ok(h.state.terrain.every((t) => t.x >= 0 && t.y >= 0));
const corner = run(base, ...click(63.5, 63.5));
assert.equal(corner.state.terrain.length, 4);
assert.ok(corner.state.terrain.every((t) => t.x < 64 && t.y < 64));
assert.deepEqual(terrainKeys(run(base, ...drag([-3, 5.5], [2.5, 5.5]))).filter((k) => Number(k.split(',')[0]) < 0), []);
ok('brush cells off the map are skipped');

// a stroke made in each of the four views lands on the same world cells (square and non-square maps,
// an odd and an even brush; the points avoid exact tile and half-tile ties, where rounding has no side)
[SQ, sizeOf(40, 20)].forEach((size) => [3, 4].forEach((width) => {
  const start: History = { ...initialHistory, state: { ...initialHistory.state, size } };
  const from = brush(run(start, { type: 'select', id: 'clay' }), width);
  const world = run(from, hover(6.3, 7.7), { type: 'press', ...pt(6.3, 7.7) }, hover(9.1, 8.7), hover(12.2, 9.6), { type: 'release' });
  assert.ok(world.state.terrain.length > 20);
  ([0, 1, 2, 3] as const).forEach((view) => {
    const at = (x: number, y: number) => { const p = pointToView({ x, y }, view, size); return pt(p.x, p.y); };
    let t = from;
    for (let i = 0; i < view; i++) t = step(t, { type: 'rotateView', dir: 1 });
    t = run(t, { type: 'hover', ...at(6.3, 7.7) }, { type: 'press', ...at(6.3, 7.7) }, { type: 'hover', ...at(9.1, 8.7) }, { type: 'hover', ...at(12.2, 9.6) }, { type: 'release' });
    assert.deepEqual(terrainKeys(t), terrainKeys(world), `view ${view}, ${size.w}x${size.h}, brush ${width}`);
    assert.equal(t.past.length, 1);
    // a turn of the camera in the middle of a stroke keeps the stroke going
    if (view === 0) return;
    const mid = run(from, { type: 'hover', ...pt(6.3, 7.7) }, { type: 'press', ...pt(6.3, 7.7) }, { type: 'rotateView', dir: 1 });
    assert.equal(mid.state.drag?.mode, 'brush');
  });
}));
ok('a stroke in any of the four views paints the same world cells, on square and wide maps');

// ===== Fills =====
// a plaster room 10..13 x 10..12 (its floor is laid by the walls) and bare grass all around
const room = run(initialHistory, { type: 'select', id: 'plaster' }, { type: 'setWallMode', mode: 'square' }, ...drag([10.5, 10.5], [13.5, 12.5]), { type: 'cancel' });
assert.equal(room.state.tiles.length, 12);
const ALL = 64 * 64;
const fillWith = (from: History, id: string, at: [number, number], mode: FillMode = 'same'): History =>
  run(from, { type: 'select', id }, ...shift(true, mode === 'all'), hover(...at), { type: 'press', ...pt(...at) }, { type: 'release' }, ...shift(false));

// the preview is exposed in state for the renderer: cells and mode, only with Shift held and a terrain item
const prev = run(room, { type: 'select', id: 'turf' }, hover(11.5, 11.5));
assert.equal(terrainFill(prev.state), null);
const shown = run(prev, ...shift(true), hover(11.5, 11.5));
assert.equal(terrainFill(shown.state)?.cells.length, 12);
assert.equal(terrainFill(shown.state)?.mode, 'same');
assert.equal(terrainFill(run(shown, ...shift(true, true)).state)?.mode, 'all');
assert.equal(terrainFill(run(shown, { type: 'select', id: 'wood-floor' }).state), null);
ok('the fill preview is exposed as cells and a mode, only for a terrain item with Shift held');

// Shift + click spreads over bare grass inside the room only (real walls stop it), under the floors, in one step
h = fillWith(room, 'turf', [11.5, 11.5]);
assert.equal(h.state.terrain.length, 12);
[10, 11, 12, 13].forEach((x) => [10, 11, 12].forEach((y) => assert.equal(terrainAt(h, x, y), 'turf')));
assert.equal(terrainAt(h, 20, 20), undefined);
assert.equal(h.state.drag, null);
assert.equal(h.past.length, room.past.length + 1);
assert.equal(h.state.tiles.length, 12); // the floors are untouched
h = step(h, { type: 'undo' });
assert.equal(h.state.terrain.length, 0);
// from outside it fills the whole ground around the room but not inside it
h = fillWith(room, 'turf', [30.5, 30.5]);
assert.equal(h.state.terrain.length, ALL - 12);
assert.equal(terrainAt(h, 11, 11), undefined);
ok('Shift + click fills over the same terrain, stopped by walls, under floors, in one undo step');

// the same terrain only: a different terrain stops it; Shift + Ctrl goes over everything
const patched = run(base, { type: 'select', id: 'moss' }, ...click(30.5, 30.5));
const mossCells = patched.state.terrain.length;
h = fillWith(patched, 'meadow', [40.5, 40.5]);
assert.equal(h.state.terrain.length, ALL);
assert.equal(h.state.terrain.filter((t) => t.defId === 'moss').length, mossCells);
h = fillWith(patched, 'meadow', [30.5, 30.5]); // starting on the moss only spreads over moss
assert.equal(h.state.terrain.length, mossCells);
assert.ok(h.state.terrain.every((t) => t.defId === 'meadow'));
h = fillWith(patched, 'meadow', [40.5, 40.5], 'all');
assert.equal(h.state.terrain.length, ALL);
assert.ok(h.state.terrain.every((t) => t.defId === 'meadow'));
assert.equal(h.past.length, patched.past.length + 1);
// filling with Grass erases a whole patch (same) or everything (all)
h = fillWith(patched, 'grass', [30.5, 30.5]);
assert.equal(h.state.terrain.length, 0);
assert.equal(fillWith(h, 'grass', [30.5, 30.5]).past.length, h.past.length); // nothing changed, no step
ok('a fill stops at different terrain (bare grass counts as one), Shift + Ctrl goes over all, Grass erases');

// fences do not stop a fill
const fenced = run(initialHistory, { type: 'select', id: 'picket-fence' }, { type: 'setWallMode', mode: 'square' }, ...drag([10.5, 10.5], [13.5, 12.5]), { type: 'cancel' });
assert.ok(fenced.state.walls.length > 0);
h = fillWith(fenced, 'turf', [30.5, 30.5]);
assert.equal(h.state.terrain.length, ALL);
ok('fences do not stop a terrain fill');

// ===== Layering =====
// terrain stays under a floor when the floor goes: bulldoze the floor and the terrain shows again
const layered = run(base, ...drag([20.5, 20.5], [22.5, 20.5]), { type: 'select', id: 'wood-floor' }, ...click(21.5, 20.5));
assert.equal(tileAt(layered, 21, 20), 'wood-floor');
assert.equal(terrainAt(layered, 21, 20), 'lush-grass');
h = run(layered, { type: 'toggleBulldoze' }, ...click(21.5, 20.5));
assert.equal(tileAt(h, 21, 20), undefined);
assert.equal(terrainAt(h, 21, 20), 'lush-grass');
// ...and a second click, with nothing else left there, takes the terrain
h = run(h, ...click(21.5, 20.5));
assert.equal(terrainAt(h, 21, 20), undefined);
assert.equal(terrainAt(h, 20, 20), 'lush-grass');
// a box with the Flooring filter only takes the floor; Terrain only takes the terrain
const boxOver = (from: History) => run(from, { type: 'toggleBulldoze' }, ...drag([19.5, 19.5], [23.5, 21.5]));
h = boxOver(run(layered, { type: 'toggleBulldozeFilter', category: 'terrain' }));
assert.equal(tileAt(h, 21, 20), undefined);
assert.ok(h.state.terrain.length > 0 && terrainAt(h, 21, 20) === 'lush-grass');
h = boxOver(run(layered, { type: 'toggleBulldozeFilter', category: 'flooring' }));
assert.equal(tileAt(h, 21, 20), 'wood-floor');
assert.equal(h.state.terrain.length, 0);
h = boxOver(layered);
assert.equal(h.state.terrain.length, 0);
assert.equal(h.state.tiles.length, 0);
assert.equal(h.past.length, layered.past.length + 1);
ok('terrain under a floor survives bulldozing the floor; the Terrain filter picks what a box removes; a click takes it last');

// the old tile removal is unaffected: a flat, standing or wall target still comes first
const crate = run(base, ...drag([20.5, 20.5], [22.5, 20.5]), { type: 'select', id: 'crate' }, ...click(21.5, 20.5), { type: 'toggleBulldoze' });
assert.equal(bulldozePlan({ ...crate.state, hover: { x: 21, y: 20 }, point: { x: 21.5, y: 20.5 } })?.targets[0]?.kind, 'object');
h = run(crate, ...click(21.5, 20.5));
assert.equal(h.state.objects.length, 0);
assert.equal(terrainAt(h, 21, 20), 'lush-grass');
ok('bulldozing an object leaves the terrain under it');

// Shift + click clears a whole room, its terrain too when the Terrain filter is on
const roomy = fillWith(room, 'turf', [11.5, 11.5]);
h = run(roomy, { type: 'toggleBulldoze' }, ...shift(true), hover(11.5, 11.5), { type: 'press', ...pt(11.5, 11.5) }, ...shift(false));
assert.equal(h.state.terrain.length, 0);
assert.equal(h.state.tiles.length, 0);
assert.equal(h.state.walls.length, 0);
h = run(roomy, { type: 'toggleBulldoze' }, { type: 'toggleBulldozeFilter', category: 'terrain' }, ...shift(true), hover(11.5, 11.5), { type: 'press', ...pt(11.5, 11.5) }, ...shift(false));
assert.equal(h.state.terrain.length, 12);
assert.equal(h.state.tiles.length, 0);
ok('Shift + click on a room clears its terrain when the Terrain filter is on');

// ===== Select leaves the ground layers alone (Deta's call: terrain and water are layers of their own) =====
const patch = run(base, { type: 'stepBrush', step: -1 }, { type: 'stepBrush', step: -1 }, ...drag([30.5, 30.5], [33.5, 30.5]), ...drag([30.5, 31.5], [33.5, 31.5]), { type: 'useSelect' });
assert.equal(patch.state.terrain.length, 8);
// a box over painted ground marks nothing, and a click on it is a click on empty ground
h = run(patch, ...drag([29.5, 29.5], [34.5, 32.5]));
assert.equal(h.state.selection, null);
assert.equal(pickTarget(patch.state, { x: 31, y: 30 }, { x: 31.5, y: 30.5 }), null);
h = run(patch, ...click(31.5, 30.5));
assert.equal(h.state.selection, null);
// a crate standing on the terrain: a box takes the crate only, and so does a click
const stacked = run(patch, { type: 'select', id: 'crate' }, ...click(31.5, 30.5), { type: 'useSelect' });
h = run(stacked, ...drag([29.5, 29.5], [34.5, 32.5]));
assert.deepEqual(marks(h).map((t) => t.kind), ['object']);
// with Scenery off the crate is looked past, and there is nothing under it to take
assert.equal(pickTarget(run(stacked, { type: 'toggleSelectFilter', category: 'scenery' }).state, { x: 31, y: 30 }, { x: 31.5, y: 30.5 }), null);
// the picker still copies the terrain item
h = run(patch, { type: 'togglePicker' }, ...click(31.5, 30.5));
assert.equal(h.state.selectedId, 'lush-grass');
assert.equal(h.state.tool, 'build');
ok('select never marks terrain: a box or a click on painted ground takes nothing, things standing on it are taken alone, and the picker still copies it');

// moving, copying, cutting, turning and deleting the crate leave the terrain where it was painted
{
  const marked = run(stacked, ...drag([29.5, 29.5], [34.5, 32.5]));
  const ground = terrainKeys(stacked);
  const crateAt = (hh: History) => hh.state.objects.map((o) => `${o.x},${o.y}`).sort();
  h = run(marked, ...click(31.5, 30.5));
  assert.equal(h.state.selection?.kind === 'group' && h.state.selection.pieces.terrain.length, 0);
  assert.deepEqual(terrainKeys(h), ground); // lifting takes nothing off the ground
  h = run(h, ...click(40.5, 40.5));
  assert.deepEqual(crateAt(h), ['40,40']);
  assert.deepEqual(terrainKeys(h), ground);
  h = run(marked, { type: 'copy' }, { type: 'paste' }, ...click(45.5, 45.5));
  assert.deepEqual(crateAt(h), ['31,30', '45,45']);
  assert.deepEqual(terrainKeys(h), ground);
  h = run(marked, { type: 'cut' });
  assert.equal(h.state.objects.length, 0);
  assert.deepEqual(terrainKeys(h), ground);
  h = run(marked, { type: 'rotate' });
  assert.deepEqual(terrainKeys(h), ground);
  h = run(marked, { type: 'deleteSelection' });
  assert.equal(h.state.objects.length, 0);
  assert.deepEqual(terrainKeys(h), ground);
  // the same from a turned camera
  ([1, 2, 3] as const).forEach((view) => {
    const at = (x: number, y: number) => { const p = pointToView({ x, y }, view, SQ); return pt(p.x, p.y); };
    let t = marked;
    for (let i = 0; i < view; i++) t = step(t, { type: 'rotateView', dir: 1 });
    t = run(t, { type: 'hover', ...at(31.5, 30.5) }, { type: 'press', ...at(31.5, 30.5) }, { type: 'release' }, { type: 'hover', ...at(40.5, 40.5) }, { type: 'press', ...at(40.5, 40.5) }, { type: 'release' });
    assert.deepEqual(crateAt(t), ['40,40'], `view ${view}`);
    assert.deepEqual(terrainKeys(t), ground, `view ${view}`);
  });
}
ok('moving, copying, cutting, turning and deleting marks leave the terrain where it was painted, from every view');

// water is a ground layer too: a box over a canal beside a floor takes the floor only
{
  const wet = run(base, { type: 'select', id: 'canal' }, ...drag([10.5, 10.5], [13.5, 10.5]), { type: 'select', id: 'wood-floor' }, ...drag([10.5, 12.5], [13.5, 12.5]), { type: 'useSelect' });
  assert.equal(wet.state.tiles.length, 8);
  h = run(wet, ...drag([9.5, 9.5], [14.5, 13.5]));
  assert.equal(marks(h).length, 4);
  assert.ok(marks(h).every((t) => t.kind === 'tile' && t.target.defId === 'wood-floor'));
  h = run(h, ...click(11.5, 12.5), ...click(30.5, 30.5)); // move the floor away; the canal stays
  assert.equal(h.state.tiles.filter((t) => t.defId === 'canal' && t.y === 10).length, 4);
  assert.equal(h.state.tiles.filter((t) => t.defId === 'wood-floor' && t.y === 12).length, 0);
}
ok('select never marks Canal or Stream water (or the culverts on it): a box over water takes only the floor beside it');

// a new game or load swaps the terrain with the rest of the world
h = step(patch, { type: 'replaceWorld', world: { size: SQ, objects: [], tiles: [], terrain: [{ x: 1, y: 1, defId: 'moss' }], walls: [], culverts: [], nextId: 1, rotation: 0 } });
assert.deepEqual(terrainKeys(h), ['1,1']);
assert.equal(h.past.length, 0);
ok('replacing the world replaces its terrain');
