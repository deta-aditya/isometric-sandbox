import { strict as assert } from 'node:assert';
import { BRUSH_SIZES, DEFAULT_BRUSH, brushCells, strokeCells } from '../src/brush.ts';
import { CATEGORIES, FILTER_ORDER, getItem, groupsOf, isTerrain } from '../src/catalog.ts';
import { sizeOf } from '../src/geometry.ts';
import { type History, type HistoryAction, canRedo, canUndo, initialHistory, step } from '../src/history.ts';
import { pointToView } from '../src/view.ts';
import { type FillMode, bulldozePlan, groupGhost, pickTarget, terrainFill } from '../src/world.ts';

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
assert.equal(getItem('soil-dirt').name, 'Dirt');
assert.equal(getItem('dirt').kind, 'tile'); // the path keeps its id
assert.throws(() => getItem('gravel'));
assert.throws(() => getItem('sand'));
assert.equal(getItem('flowery-grass').kind === 'terrain' && getItem('flowery-grass').specks?.length, 4);
// Terrain sits after Flooring in the bar; the filter keys keep 1 to 4 and give Terrain the fifth
assert.deepEqual(CATEGORIES.map((c) => c.id), ['scenery', 'furniture', 'flooring', 'terrain', 'building']);
assert.deepEqual(FILTER_ORDER, ['scenery', 'furniture', 'flooring', 'building', 'terrain']);
assert.deepEqual(groupsOf('terrain').map((g) => g.name), ['Grass', 'Ground']);
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

// ===== Select: filters and click priority =====
const patch = run(base, { type: 'stepBrush', step: -1 }, { type: 'stepBrush', step: -1 }, ...drag([30.5, 30.5], [33.5, 30.5]), ...drag([30.5, 31.5], [33.5, 31.5]), { type: 'useSelect' });
assert.equal(patch.state.terrain.length, 8);
// a box marks the terrain in it
h = run(patch, ...drag([29.5, 29.5], [34.5, 32.5]));
assert.equal(marks(h).length, 8);
assert.ok(marks(h).every((t) => t.kind === 'terrain'));
assert.equal(h.past.length, patch.past.length); // marking is not an undo step
// with the Terrain filter off a box marks none of it
h = run(patch, { type: 'toggleSelectFilter', category: 'terrain' }, ...drag([29.5, 29.5], [34.5, 32.5]));
assert.equal(marks(h).length, 0);
assert.equal(h.state.bulldozeFilter.terrain, true); // the two filters are separate
// a click with nothing else there marks that one cell; a click on bare grass marks nothing
h = run(patch, ...click(31.5, 30.5));
assert.equal(marks(h).length, 1);
assert.equal(marks(h)[0]?.kind, 'terrain');
assert.equal(run(patch, ...click(50.5, 50.5)).state.selection, null);
// Shift + click adds and removes
h = run(patch, ...click(31.5, 30.5), ...shift(true), ...click(32.5, 30.5));
assert.equal(marks(h).length, 2);
h = run(h, ...click(31.5, 30.5));
assert.equal(marks(h).length, 1);
h = run(h, ...shift(false));
// and a drag that starts on terrain is a box, not a click on one cell
h = run(patch, ...drag([30.5, 30.5], [33.5, 31.5]));
assert.equal(marks(h).length, 8);
// click priority: an object over the terrain wins, and a floor hides the terrain below it
const stacked = run(patch, { type: 'select', id: 'crate' }, ...click(31.5, 30.5), { type: 'select', id: 'wood-floor' }, ...click(32.5, 30.5), { type: 'useSelect' });
h = run(stacked, ...click(31.5, 30.5));
assert.equal(h.state.selection?.kind, 'group');
assert.equal(h.state.selection?.kind === 'group' && h.state.selection.pieces.objects.length, 1);
assert.equal(h.state.selection?.kind === 'group' && h.state.selection.pieces.terrain.length, 0);
assert.equal(pickTarget(stacked.state, { x: 32, y: 30 }, { x: 32.5, y: 30.5 }), null); // under a floor
assert.equal(pickTarget(stacked.state, { x: 33, y: 30 }, { x: 33.5, y: 30.5 })?.kind, 'terrain');
// with Scenery off the object is looked past, and the terrain below it can be picked
h = run(stacked, { type: 'toggleSelectFilter', category: 'scenery' }, ...click(31.5, 30.5));
assert.equal(marks(h)[0]?.kind, 'terrain');
// the picker copies the terrain item
h = run(patch, { type: 'togglePicker' }, ...click(31.5, 30.5));
assert.equal(h.state.selectedId, 'lush-grass');
assert.equal(h.state.tool, 'build');
ok('the Terrain filter rules box select, a click picks terrain last (not under floors), and the picker copies it');

// ===== Edit: move, copy, paste, cut =====
// a three-tile L of clay at 10..11 x 10..11 (cells 10,10 11,10 11,11), and moss where a drop will land
const clay = run(base, { type: 'select', id: 'clay' }, { type: 'stepBrush', step: -1 }, { type: 'stepBrush', step: -1 }, ...click(10.5, 10.5), ...click(11.5, 10.5), ...click(11.5, 11.5));
assert.deepEqual(terrainKeys(clay), ['10,10', '11,10', '11,11']);
const marked = run(clay, { type: 'useSelect' }, ...drag([9.5, 9.5], [11.5, 11.5]));
assert.equal(marks(marked).length, 3);

// move: click lifts the marked cells, a click elsewhere drops them
h = run(marked, ...click(10.5, 10.5));
assert.equal(h.state.selection?.kind, 'group');
assert.equal(h.state.terrain.length, 0); // lifted out of the world
h = run(h, ...click(20.5, 20.5));
assert.deepEqual(terrainKeys(h), ['20,20', '21,20', '21,21']);
assert.ok(h.state.terrain.every((t) => t.defId === 'clay'));
assert.equal(h.past.length, clay.past.length + 1); // the whole move is one step
h = step(h, { type: 'undo' });
assert.deepEqual(terrainKeys(h), ['10,10', '11,10', '11,11']);
ok('marked terrain lifts and drops as a group, in one undo step');

// a drop replaces terrain where it lands, like a floor over a floor
const target = run(clay, { type: 'select', id: 'moss' }, { type: 'stepBrush', step: 1 }, { type: 'stepBrush', step: 1 }, ...click(21.5, 21.5), { type: 'useSelect' }, ...drag([9.5, 9.5], [11.5, 11.5]));
assert.equal(target.state.terrain.filter((t) => t.defId === 'moss').length, 9);
assert.equal(marks(target).length, 3);
h = run(target, ...click(10.5, 10.5), ...click(20.5, 20.5));
assert.equal(terrainAt(h, 20, 20), 'clay');
assert.equal(terrainAt(h, 21, 20), 'clay');
assert.equal(terrainAt(h, 21, 21), 'clay');
assert.equal(terrainAt(h, 22, 22), 'moss'); // beside the drop, untouched
assert.equal(terrainAt(h, 20, 21), 'moss');
assert.equal(h.state.terrain.length, 9); // 6 moss left, 3 clay: one terrain per tile
assert.equal(new Set(terrainKeys(h)).size, h.state.terrain.length);
ok('dropping terrain replaces the terrain where it lands');

// copy and paste: copies stay in hand and each drop is its own step; the original stays
h = run(marked, { type: 'copy' }, { type: 'paste' }, hover(30.5, 30.5), ...click(30.5, 30.5), ...click(40.5, 40.5));
assert.equal(h.state.terrain.length, 9);
assert.equal(terrainAt(h, 30, 30), 'clay');
assert.equal(terrainAt(h, 41, 41), 'clay');
assert.equal(terrainAt(h, 11, 11), 'clay');
assert.equal(h.past.length, clay.past.length + 2);
// cut takes it out, paste puts it back
h = run(marked, { type: 'cut' });
assert.equal(h.state.terrain.length, 0);
h = run(h, { type: 'paste' }, ...click(15.5, 15.5));
assert.equal(terrainAt(h, 15, 15), 'clay');
assert.equal(h.state.terrain.length, 3);
ok('copy and paste carry terrain and leave the original; cut and paste moves it');

// turning a held group turns its terrain like tiles: (dx, dy) about the grabbed cell becomes (-dy, dx)
const held = run(marked, ...click(10.5, 10.5)); // grabbed by cell 10,10
const ghostAt = (s: History, x: number, y: number) => groupGhost({ ...s.state, hover: { x, y } });
const relative = (s: History, turns: number) => {
  const g = ghostAt(run(s, ...Array.from({ length: turns }, (): HistoryAction => ({ type: 'rotate' }))), 20, 20);
  return keys(g?.terrain ?? []);
};
const sorted = (...ks: string[]) => ks.sort();
assert.deepEqual(relative(held, 0), sorted('20,20', '21,20', '21,21'));
assert.deepEqual(relative(held, 1), sorted('20,20', '20,21', '19,21')); // (1,0) -> (0,1), (1,1) -> (-1,1)
assert.deepEqual(relative(held, 2), sorted('20,20', '19,20', '19,19'));
assert.deepEqual(relative(held, 3), sorted('20,20', '20,19', '21,19'));
h = run(held, { type: 'rotate' }, ...click(20.5, 20.5));
assert.deepEqual(terrainKeys(h), sorted('19,21', '20,20', '20,21'));
// marked terrain turns in place about the middle of the marks
const inPlace = run(marked, { type: 'rotate' });
assert.equal(inPlace.state.terrain.length, 3);
assert.deepEqual(terrainKeys(inPlace), sorted('10,10', '10,11', '9,11')); // about the middle cell 10,10
assert.equal(marks(inPlace).length, 3); // still marked
ok('turning a held group, or marks in place, turns the terrain with it');

// moving terrain from a turned camera gives the same world as from the usual one
([1, 2, 3] as const).forEach((view) => {
  const at = (x: number, y: number) => { const p = pointToView({ x, y }, view, SQ); return pt(p.x, p.y); };
  let t = marked;
  for (let i = 0; i < view; i++) t = step(t, { type: 'rotateView', dir: 1 });
  t = run(t, { type: 'hover', ...at(10.5, 10.5) }, { type: 'press', ...at(10.5, 10.5) }, { type: 'hover', ...at(20.5, 20.5) }, { type: 'press', ...at(20.5, 20.5) });
  assert.deepEqual(terrainKeys(t), ['20,20', '21,20', '21,21'], `view ${view}`);
});
ok('moving terrain works the same from every camera view');

// delete removes marked terrain
h = run(marked, { type: 'deleteSelection' });
assert.equal(h.state.terrain.length, 0);
assert.equal(h.past.length, clay.past.length + 1);
ok('Delete removes marked terrain in one undo step');

// a new game or load swaps the terrain with the rest of the world
h = step(clay, { type: 'replaceWorld', world: { size: SQ, objects: [], tiles: [], terrain: [{ x: 1, y: 1, defId: 'moss' }], walls: [], culverts: [], nextId: 1, rotation: 0 } });
assert.deepEqual(terrainKeys(h), ['1,1']);
assert.equal(h.past.length, 0);
ok('replacing the world replaces its terrain');
