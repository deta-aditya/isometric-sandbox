// World logic: pure state and transitions. No Pixi, no DOM.
import { snapArrow } from './arrows';
import { type View, fromView, toView, turnAbout, turnView } from './view';
import { CUT_WALL_H, DEFAULT_GRID, EDGE_PICK, LEVELS, ROOF_LEVEL, TILE_H, WALL_H } from './config';
import {
  CATEGORIES,
  type CategoryId,
  type GroupId,
  categoryOf,
  footprintOf,
  getItem,
  getObjectDef,
  getOpeningDef,
  isTerrain,
  getPaint,
  type Rotation,
  type CulvertPiece,
  culvertItemOf,
  turn,
  type OpeningDef,
  trayItemOf,
  getWallStyle,
  groupsOf,
  isFence,
  isPaintable,
  isPole,
  isFlat,
  isRun,
  isSmart,
  isWaterTile,
  layerOf,
  occupiedCells,
  itemsIn,
} from './catalog';
import { type BrushSize, DEFAULT_BRUSH, brushCells, stepBrush as stepBrushSize, strokeCells } from './brush';
import {
  type Cell,
  type Edge,
  type Point,
  type Rect,
  cellKey,
  cellsOf,
  covers,
  edgeInsideRect,
  edgeKey,
  edgesBetween,
  nearestEdge,
  nearestVertex,
  perimeterEdges,
  rectBetween,
  range,
  rectsOverlap,
  sameCell,
  sameEdge,
  type Size,
  sizeOf,
} from './geometry';

export type ObjectPlacement = Rect & Readonly<{ defId: string; rotation: Rotation }>;
export type ObjectEntity = ObjectPlacement & Readonly<{ id: number }>;
export type Tile = Cell & Readonly<{ defId: string }>;
// The ground under everything: at most one per cell, and only where it differs from the map's ground
// (`State.ground`): a cell with no entry shows the ground, so an entry never holds the ground's own id
export type TerrainCell = Readonly<{ x: number; y: number; defId: string }>;
// A wall segment on one grid edge, optionally holding a door, window or arch
// Paint on each side of a wall. `before` faces the cell at smaller x or y (north or west), `after`
// the cell at the edge's own x, y (south or east). Null shows the material.
export type WallPaint = Readonly<{ before: string | null; after: string | null }>;
export const NO_PAINT: WallPaint = { before: null, after: null };
export type WallSide = keyof WallPaint;
export type WallSegment = Edge & Readonly<{ styleId: string; opening: string | null; paint: WallPaint }>;

// An in-progress pointer gesture
export type Drag =
  | Readonly<{ mode: 'wall'; start: Cell }> // start is a grid vertex
  | Readonly<{ mode: 'square'; start: Cell }> // start is a cell
  | Readonly<{ mode: 'paint' }>
  | Readonly<{ mode: 'brush'; last: Point }> // painting terrain with the round brush; `last` is where the stroke has reached
  | Readonly<{ mode: 'run'; start: Cell }> // laying a straight run of road pieces, in the row it started
  | Readonly<{ mode: 'erase'; start: Cell; point: Point | null }> // bulldozing: a box from start to the hover
  | Readonly<{ mode: 'span'; start: Edge }> // dragging a wide opening along a wall
  | Readonly<{ mode: 'culvert'; start: Edge }> // dragging a culvert along a canal bank
  | Readonly<{ mode: 'wallPaint'; start: Edge; side: WallSide }> // painting one side along a run of walls
  | Readonly<{ mode: 'box'; start: Cell; add: boolean }> // marking everything in a box (Shift adds to the marks)
  | Readonly<{ mode: 'guide'; axis: GuideAxis; at: number; index: number | null }>; // a guide being added or moved

// 'select' (the default) picks things up to move them; 'picker' copies a placed thing into the build
// tool; 'build' places the selected catalog item; 'bulldoze' removes whatever is clicked; 'guide'
// adds, moves and removes guide lines
export type Tool = 'select' | 'picker' | 'build' | 'bulldoze' | 'guide';

// Things moved together, exactly as they were in the world (walls keep their paint and openings)
export type Pieces = Readonly<{
  objects: readonly ObjectEntity[];
  walls: readonly WallSegment[];
  tiles: readonly Tile[];
  terrain: readonly TerrainCell[];
  culverts: readonly CulvertEdge[];
}>;

// Copied things and the cell a paste is held by (the middle of them), plus the marks they came from
// so the chip can say they were copied
export type Clipboard = Readonly<{ pieces: Pieces; anchor: Cell; from: readonly EraseTarget[] }>;

// ===== Rulers and guides =====
// Guides: helper lines across the whole map on grid lines, a drawing aid (not undone, not saved).
// Axis 'x' is the line x = at. The guide tool (its own button) adds, moves and removes them: pointing
// lights up the guide under the pointer, or else the nearest grid line; a click on a grid line adds a
// guide there, a click on a guide removes it, and a drag moves it (snapping to grid lines), or
// removes it when let go off the map. Guides show in every tool but only the guide tool touches them.
export type GuideAxis = 'x' | 'y';
export type Guide = Readonly<{ axis: GuideAxis; at: number }>;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const GUIDE_REACH = 0.3; // how close (in tiles) the pointer must be to grab a guide
const MAP_MARGIN = 0.5; // off the map by more than this is off the map

const offMap = (size: Size, p: Point): boolean => p.x < -MAP_MARGIN || p.y < -MAP_MARGIN || p.x > size.w + MAP_MARGIN || p.y > size.h + MAP_MARGIN;

// What the guide tool points at: a guide (with its index) or the nearest grid line (index null)
export const guideUnder = (s: State, p: Point | null): Readonly<{ guide: Guide; index: number | null }> | null => {
  if (!p || offMap(s.size, p)) return null;
  const off = (g: Guide) => Math.abs((g.axis === 'x' ? p.x : p.y) - g.at);
  const near = s.guides.map((g, index) => ({ guide: g, index, off: off(g) })).filter((h) => h.off <= GUIDE_REACH);
  if (near.length > 0) {
    const { guide, index } = near.reduce((a, b) => (b.off < a.off ? b : a));
    return { guide, index };
  }
  const x: Guide = { axis: 'x', at: clamp(Math.round(p.x), 0, s.size.w) };
  const y: Guide = { axis: 'y', at: clamp(Math.round(p.y), 0, s.size.h) };
  return { guide: off(x) <= off(y) ? x : y, index: null };
};

export const guideDragTarget = (s: State): Guide | 'remove' | null => {
  const d = s.drag;
  if (d?.mode !== 'guide' || !s.point) return null;
  const along = d.axis === 'x' ? s.point.x : s.point.y;
  if (offMap(s.size, s.point)) return 'remove'; // let go off the map
  const end = d.axis === 'x' ? s.size.w : s.size.h;
  return { axis: d.axis, at: clamp(Math.round(along), 0, end) };
};

const startGuide = (s: State, point: Point): State => {
  const hit = guideUnder(s, point);
  return hit ? { ...s, point, drag: { mode: 'guide', axis: hit.guide.axis, at: hit.guide.at, index: hit.index } } : { ...s, point };
};

// Letting go: a click (it never moved) adds a guide on the grid line, or takes away the guide there;
// a drag moves the guide (or makes a new one) to where it was let go, or removes it off the map
const finishGuide = (s: State, d: Readonly<{ axis: GuideAxis; at: number; index: number | null }>): State => {
  const done: State = { ...s, drag: null };
  const target = guideDragTarget(s);
  const others = d.index === null ? s.guides : s.guides.filter((_, i) => i !== d.index);
  if (target === null) return done;
  if (target === 'remove') return { ...done, guides: others };
  if (target.at === d.at) return { ...done, guides: d.index === null ? [...s.guides, target] : others };
  const taken = others.some((g) => g.axis === target.axis && g.at === target.at);
  return { ...done, guides: taken ? others : [...others, target] };
};

// A saved group to place again later: a named clipboard. Its pieces sit at the origin (only their
// places relative to each other matter) and it is held by the cell in the middle, like a paste.
export type Blueprint = Readonly<{ id: number; name: string; pieces: Pieces; anchor: Cell }>;

// What the select tool has. Marked things are highlighted where they are (the world is unchanged).
// A held group is lifted out of the world and follows the pointer: its pieces as they were, the cell
// it was grabbed by, and the quarter turns made about that cell. `marked` says whether it came from
// marks (and stays marked when dropped). A `copy` is pasted from the clipboard: it took nothing out of
// the world, each drop places fresh copies and it stays in hand to place again. A held opening slides
// onto walls instead.
export type Selection =
  | Readonly<{ kind: 'marked'; targets: readonly EraseTarget[] }>
  | Readonly<{ kind: 'group'; pieces: Pieces; anchor: Cell; turns: Rotation; marked: boolean; copy: boolean; name?: string }>
  | Readonly<{ kind: 'opening'; originals: readonly WallSegment[]; openingIds: readonly string[] }>; // a span, in axis order

// How wall styles are built: one straight run at a time, or a square (all four sides of a rectangle)
export type WallMode = 'line' | 'square';

// How walls are shown on the 1st floor: all full height, cut away where they hide a room, or all cut low
export type WallView = 'up' | 'cutaway' | 'down';

export type State = Readonly<{
  size: Size; // the map's width and height in tiles (part of the world; in a view it is the view's frame)
  objects: readonly ObjectEntity[];
  tiles: readonly Tile[];
  terrain: readonly TerrainCell[]; // the ground under floors, paths, water and roads, where it differs from `ground`
  ground: string; // the terrain id of every tile with no terrain entry (chosen at New game; part of the world)
  culverts: readonly CulvertEdge[]; // culverts on water banks, canal outlets and inlets
  walls: readonly WallSegment[];
  nextId: number;
  hover: Cell | null; // cell under the pointer
  point: Point | null; // exact pointer position in grid units (for walls and openings)
  category: CategoryId;
  group: GroupId; // the active tab inside the category's tray
  selectedId: string;
  rotation: Rotation; // facing of the next object to build
  level: number; // index into LEVELS
  drag: Drag | null;
  trayOpen: boolean; // item tray for the current category
  tool: Tool; // what a click does; the selected item is kept while bulldozing
  wallMode: WallMode; // kept across wall styles, so switching style keeps the mode
  selection: Selection | null;
  wallView: WallView; // a view setting, so it is not part of undo history
  showGrid: boolean; // also a view setting
  bulldozeFilter: BulldozeFilter; // which kinds of thing the bulldoze removes (a tool setting, not undone)
  selectFilter: BulldozeFilter; // which kinds of thing the select tool picks and boxes (its own setting)
  brushSize: BrushSize; // how wide the terrain brush is (a tool setting: not undone, not saved)
  clipboard: Clipboard | null; // what Ctrl+C or Ctrl+X kept (session only, not undone, not saved)
  blueprints: readonly Blueprint[]; // the saved library (kept by the browser, not undone, not part of the world)
  blueprintTray: boolean; // the tray shows the blueprints instead of a catalog category
  guides: readonly Guide[]; // guide lines across the map (a drawing aid: not undone, not part of the world)
  shiftHeld: boolean; // Shift turns a bulldoze click into clearing the whole room, and a build click into a fill
  ctrlHeld: boolean; // with Shift, a fill spreads over everything instead of only the same floor or paint
  view: View; // which side the camera looks from (camera state, not part of undo)
}>;

// The thing a removal at the pointer would hit
export type EraseTarget =
  | Readonly<{ kind: 'object'; target: ObjectEntity }>
  | Readonly<{ kind: 'tile'; target: Tile }>
  | Readonly<{ kind: 'terrain'; target: TerrainCell }>
  | Readonly<{ kind: 'wall'; target: WallSegment }>
  | Readonly<{ kind: 'opening'; target: WallSegment }>
  | Readonly<{ kind: 'culvert'; target: CulvertEdge }>;

export type Action =
  | { type: 'hover'; cell: Cell | null; point: Point | null }
  | { type: 'press'; cell: Cell; point: Point }
  | { type: 'release' }
  | { type: 'cancel' }
  | { type: 'selectCategory'; category: CategoryId }
  | { type: 'cycleCategory'; dir: 1 | -1 }
  | { type: 'selectGroup'; group: GroupId }
  | { type: 'cycleGroup'; dir: 1 | -1 }
  | { type: 'select'; id: string }
  | { type: 'selectIndex'; index: number }
  | { type: 'rotate'; dir?: 1 | -1 } // a quarter turn clockwise, or back with -1
  | { type: 'setLevel'; level: number }
  | { type: 'toggleBulldoze' }
  | { type: 'useSelect' }
  | { type: 'togglePicker' }
  | { type: 'pickHovered' }
  | { type: 'setWallView'; view: WallView }
  | { type: 'toggleGrid' }
  | { type: 'toggleBulldozeFilter'; category: CategoryId }
  | { type: 'toggleSelectFilter'; category: CategoryId }
  | { type: 'stepBrush'; step: 1 | -1 }
  | { type: 'toggleGuideTool' }
  | { type: 'clearGuides' }
  | { type: 'toggleBlueprints' }
  | { type: 'saveBlueprint' }
  | { type: 'renameBlueprint'; id: number; name: string }
  | { type: 'deleteBlueprint'; id: number }
  | { type: 'placeBlueprint'; id: number }
  | { type: 'loadBlueprints'; blueprints: readonly Blueprint[] }
  | { type: 'copy' }
  | { type: 'cut' }
  | { type: 'paste' }
  | { type: 'setShift'; held: boolean }
  | { type: 'setCtrl'; held: boolean }
  | { type: 'rotateView'; dir: 1 | -1 } // turn the camera a quarter, clockwise or back
  | { type: 'deleteSelection' }
  | { type: 'setWallMode'; mode: WallMode }
  | { type: 'toggleWallMode' };

const firstGroupOf = (category: CategoryId): GroupId => groupsOf(category)[0]?.id ?? 'decor';
const firstItemIn = (group: GroupId): string => itemsIn(group)[0]?.id ?? '';

export const initialState: State = {
  size: sizeOf(DEFAULT_GRID, DEFAULT_GRID),
  objects: [],
  culverts: [],
  tiles: [],
  terrain: [],
  ground: 'grass',
  walls: [],
  nextId: 1,
  hover: null,
  point: null,
  category: 'scenery',
  group: 'decor',
  selectedId: firstItemIn('decor'),
  rotation: 0,
  level: 0,
  drag: null,
  trayOpen: false,
  tool: 'select',
  wallMode: 'line',
  selection: null,
  wallView: 'cutaway',
  showGrid: true,
  bulldozeFilter: { scenery: true, furniture: true, flooring: true, building: true, terrain: true },
  selectFilter: { scenery: true, furniture: true, flooring: true, building: true, terrain: true },
  brushSize: DEFAULT_BRUSH,
  clipboard: null,
  blueprints: [],
  blueprintTray: false,
  guides: [],
  shiftHeld: false,
  ctrlHeld: false,
  view: 0,
};

// ===== Whole worlds (new game, save, load) =====
// Everything a saved game holds: the map's size, what is built, and the build facing. Always in the
// world's own (unturned) frame, never the turned view.
export type GameWorld = Readonly<{
  size: Size;
  objects: readonly ObjectEntity[];
  tiles: readonly Tile[];
  terrain: readonly TerrainCell[];
  ground: string;
  walls: readonly WallSegment[];
  culverts: readonly CulvertEdge[];
  nextId: number;
  rotation: Rotation;
}>;

export const emptyWorld = (size: Size, ground = 'grass'): GameWorld => ({ size, objects: [], tiles: [], terrain: [], ground, walls: [], culverts: [], nextId: 1, rotation: 0 });

// An entry equal to the ground says nothing, so it is never stored
export const withoutGround = <T extends { defId: string }>(ground: string, entries: readonly T[]): readonly T[] =>
  entries.some((t) => t.defId === ground) ? entries.filter((t) => t.defId !== ground) : entries;

// Takes the world state (what history holds), not the turned view state
export const gameWorldOf = (s: State): GameWorld => ({
  size: s.size,
  objects: s.objects,
  tiles: s.tiles,
  terrain: s.terrain,
  ground: s.ground,
  walls: s.walls,
  culverts: s.culverts,
  nextId: s.nextId,
  rotation: s.rotation,
});

// ===== Enclosure =====
// Rooms are not stored: a cell is "inside" when walls cut it off from the outside of the map.
// Flood fill from beyond the map edge; every in-bounds cell it cannot reach is enclosed.
// Openings do not count as gaps, so a room with a door is still a room.
// Cached per wall list and map size (sizes are one object each, see sizeOf)
const interiorCache = new WeakMap<readonly WallSegment[], WeakMap<Size, ReadonlySet<string>>>();

export const interiorCells = (walls: readonly WallSegment[], size: Size): ReadonlySet<string> => {
  const bySize = interiorCache.get(walls) ?? new WeakMap<Size, ReadonlySet<string>>();
  interiorCache.set(walls, bySize);
  const cached = bySize.get(size);
  if (cached) return cached;

  const blocked = new Set(walls.filter((w) => !isFence(w.styleId)).map(edgeKey)); // fences never form rooms
  const inPadded = (c: Cell) => c.x >= -1 && c.y >= -1 && c.x <= size.w && c.y <= size.h;
  const reached = new Set<string>([cellKey({ x: -1, y: -1 })]);
  const queue: Cell[] = [{ x: -1, y: -1 }];
  while (queue.length > 0) {
    const c = queue.pop()!;
    // neighbor, and the edge you would cross to reach it
    const steps: readonly (readonly [Cell, Edge])[] = [
      [{ x: c.x + 1, y: c.y }, { axis: 'y', x: c.x + 1, y: c.y }],
      [{ x: c.x - 1, y: c.y }, { axis: 'y', x: c.x, y: c.y }],
      [{ x: c.x, y: c.y + 1 }, { axis: 'x', x: c.x, y: c.y + 1 }],
      [{ x: c.x, y: c.y - 1 }, { axis: 'x', x: c.x, y: c.y }],
    ];
    for (const [next, crossing] of steps) {
      const key = cellKey(next);
      if (!inPadded(next) || reached.has(key) || blocked.has(edgeKey(crossing))) continue;
      reached.add(key);
      queue.push(next);
    }
  }

  const interior = new Set(
    cellsOf({ x: 0, y: 0, w: size.w, h: size.h })
      .map(cellKey)
      .filter((k) => !reached.has(k)),
  );
  bySize.set(size, interior);
  return interior;
};

export const isInterior = (s: State, c: Cell): boolean => interiorCells(s.walls, s.size).has(cellKey(c));

// Covered cells: every room with at least one pole wall on its edge has a canopy over it, shown on
// the 1st floor too (a covered walkway is open at the sides, so it reads from outside). Maps each
// covered cell to its room's index, so the room under the pointer can fade as a whole.
const canopyCache = new WeakMap<readonly WallSegment[], WeakMap<Size, ReadonlyMap<string, number>>>();
export const canopyCells = (walls: readonly WallSegment[], size: Size): ReadonlyMap<string, number> => {
  const bySize = canopyCache.get(walls) ?? new WeakMap<Size, ReadonlyMap<string, number>>();
  canopyCache.set(walls, bySize);
  const cached = bySize.get(size);
  if (cached) return cached;
  const out = new Map<string, number>();
  if (walls.some((w) => isPole(w.styleId))) {
    const inside = interiorCells(walls, size);
    const byEdge = new Map(walls.filter((w) => !isFence(w.styleId)).map((w) => [edgeKey(w), w]));
    const seen = new Set<string>();
    let room = 0;
    for (const key of inside) {
      if (seen.has(key)) continue;
      const [x0 = 0, y0 = 0] = key.split(',').map(Number);
      const cells: Cell[] = [];
      let poled = false;
      const queue: Cell[] = [{ x: x0, y: y0 }];
      seen.add(key);
      for (let c = queue.pop(); c; c = queue.pop()) {
        cells.push(c);
        const steps: readonly [Cell, Edge][] = [
          [{ x: c.x + 1, y: c.y }, { axis: 'y', x: c.x + 1, y: c.y }],
          [{ x: c.x - 1, y: c.y }, { axis: 'y', x: c.x, y: c.y }],
          [{ x: c.x, y: c.y + 1 }, { axis: 'x', x: c.x, y: c.y + 1 }],
          [{ x: c.x, y: c.y - 1 }, { axis: 'x', x: c.x, y: c.y }],
        ];
        for (const [n, e] of steps) {
          const wall = byEdge.get(edgeKey(e));
          if (wall) {
            if (isPole(wall.styleId)) poled = true;
            continue;
          }
          const k = cellKey(n);
          if (seen.has(k) || !inside.has(k)) continue;
          seen.add(k);
          queue.push(n);
        }
      }
      if (poled) cells.forEach((c) => out.set(cellKey(c), room));
      room++;
    }
  }
  bySize.set(size, out);
  return out;
};

// ===== Queries =====
export const isRoofView = (s: State): boolean => s.level === ROOF_LEVEL;

export const cellInBounds = (size: Size, { x, y }: Cell): boolean => x >= 0 && y >= 0 && x < size.w && y < size.h;
export const rectInBounds = (size: Size, r: Rect): boolean => r.x >= 0 && r.y >= 0 && r.x + r.w <= size.w && r.y + r.h <= size.h;
export const edgeInBounds = (size: Size, e: Edge): boolean =>
  e.axis === 'x'
    ? e.x >= 0 && e.x < size.w && e.y >= 0 && e.y <= size.h
    : e.x >= 0 && e.x <= size.w && e.y >= 0 && e.y < size.h;

// What an object stands on: usually its footprint, but a flat piece (a road curve) may leave cells free
const onCell = (o: ObjectPlacement, c: Cell): boolean => covers(o, c) && occupiedCells(o).some((d) => d.x === c.x && d.y === c.y);
const onArea = (o: ObjectPlacement, r: Rect): boolean => rectsOverlap(o, r) && occupiedCells(o).some((c) => covers(r, c));
// Two objects clash when they are in the same layer (both standing, both roads, both markings) and
// stand on a common cell
const sharesCells = (a: ObjectPlacement, b: ObjectPlacement): boolean => {
  if (layerOf(a.defId) !== layerOf(b.defId) || !rectsOverlap(a, b)) return false;
  const mine = new Set(occupiedCells(a).map(cellKey));
  return occupiedCells(b).some((c) => mine.has(cellKey(c)));
};
// A wall runs through an object when both cells beside it are cells the object stands on. Walls cross
// flat pieces freely, as they cross floors.
const edgeThrough = (e: Edge, o: ObjectPlacement): boolean =>
  layerOf(o.defId) === null && edgeInsideRect(e, o) && sidesOf(e).every((c) => onCell(o, c));

// What is at a cell, top first: something standing, then a median, a marking, and the road under them
const PICK_ORDER = [null, 'median', 'marking', 'road'] as const;
export const objectAt = (s: State, c: Cell) => {
  const here = s.objects.filter((o) => onCell(o, c));
  return PICK_ORDER.map((layer) => here.find((o) => layerOf(o.defId) === layer)).find((o) => o !== undefined);
};
export const tileAt = (s: State, c: Cell) => s.tiles.find((t) => t.x === c.x && t.y === c.y);
export const terrainAt = (s: State, c: Cell) => s.terrain.find((t) => t.x === c.x && t.y === c.y);
export const wallAt = (s: State, e: Edge) => s.walls.find((w) => sameEdge(w, e));

// From the roof view, enclosed cells are under a roof and cannot be reached
const hiddenUnderRoof = (s: State, c: Cell): boolean => isRoofView(s) && isInterior(s, c);

export const objectCandidate = (s: State, cell: Cell): ObjectPlacement | null => {
  const item = getItem(s.selectedId);
  if (item.kind !== 'object') return null;
  const size = footprintOf(item, s.rotation);
  // flat pieces (roads, markings) sit centered on the pointer, so you point at the middle of the road
  const [dx, dy] = isFlat(item.id) ? [Math.floor((size.w - 1) / 2), Math.floor((size.h - 1) / 2)] : [0, 0];
  const at = { defId: item.id, rotation: s.rotation, x: cell.x - dx, y: cell.y - dy, ...size };
  if (getObjectDef(item.id).arrow) return snapArrow(at, s.objects.filter((o) => layerOf(o.defId) === 'road'), s.point);
  return layerOf(item.id) === 'road' && !isRun(item.id) ? snapToRoad(s, cell, at) : at;
};

// A straight road piece (one tile long, 3 or 5 across) the pointer is on, if any
// A straight road under a cell (any width from the 2-wide narrow and dirt roads up; the bus bay middle,
// also laid by dragging, is not a road to line up with)
const straightAt = (s: State, c: Cell): ObjectPlacement | undefined =>
  s.objects.find((o) => layerOf(o.defId) === 'road' && isRun(o.defId) && o.defId !== 'bay-middle' && Math.min(o.w, o.h) === 1 && Math.max(o.w, o.h) >= 2 && onCell(o, c));

// A junction, link or road end held over a straight road slides across to line up with it: centered
// on the road's width, so a piece as wide as the road meets its edges exactly, and a narrowing piece's
// narrow side meets a narrow road. The facing (R) stays the player's.
const snapToRoad = (s: State, cell: Cell, p: ObjectPlacement): ObjectPlacement => {
  const road = straightAt(s, cell);
  if (!road) return p;
  const alongX = road.w === 1; // a straight runs along x when its footprint is one tile in x
  const [width, across] = alongX ? [road.h, p.h] : [road.w, p.w];
  const off = (width - across) / 2;
  if (!Number.isInteger(off)) return p;
  return alongX ? { ...p, y: road.y + off } : { ...p, x: road.x + off };
};

// Building a road piece over road: the road pieces it overlaps are replaced, and markings and medians
// on its cells go with them (lane paint and medians do not belong inside a junction). A drag (a run of
// straights) replaces only straights, so it never wipes out a junction or a curve. Laying the same
// piece where it already is changes nothing. Anything else builds only where it fits, as before.
export type BuildPlan = Readonly<{ ok: boolean; replaced: readonly ObjectEntity[] }>;
export const buildPlan = (s: State, p: ObjectPlacement, run = false): BuildPlan => {
  const no: BuildPlan = { ok: false, replaced: [] };
  if (layerOf(p.defId) !== 'road') return { ok: canPlaceObject(s, p), replaced: [] };
  const roads = s.objects.filter((o) => layerOf(o.defId) === 'road' && sharesCells(o, p));
  if (roads.some((o) => o.defId === p.defId && o.rotation === p.rotation && o.x === p.x && o.y === p.y)) return no;
  if (run && roads.some((o) => !isRun(o.defId))) return no;
  const mine = new Set(occupiedCells(p).map(cellKey));
  const paint = roads.length === 0 ? [] : s.objects.filter((o) => {
    const layer = layerOf(o.defId);
    return (layer === 'marking' || layer === 'median') && occupiedCells(o).some((c) => mine.has(cellKey(c)));
  });
  const replaced = [...roads, ...paint];
  const rest = { ...s, objects: s.objects.filter((o) => !replaced.includes(o)) };
  return canPlaceObject(rest, p) ? { ok: true, replaced } : no;
};

// Lane arrows are paint, and dirt roads have nothing painted on them (#31b): an arrow may not touch a
// dirt road piece. Dirt road pieces are the Dirt roads tab, Dirt to paved included.
const onDirt = (s: State, p: ObjectPlacement): boolean => {
  if (!getObjectDef(p.defId).arrow) return false;
  const mine = new Set(occupiedCells(p).map(cellKey));
  return s.objects.some((o) => getObjectDef(o.defId).group === 'dirtroad' && occupiedCells(o).some((c) => mine.has(cellKey(c))));
};

// Objects may sit against walls but never across one
export const canPlaceObject = (s: State, p: ObjectPlacement): boolean =>
  rectInBounds(s.size, p) &&
  !s.objects.some((o) => sharesCells(o, p)) &&
  !onDirt(s, p) &&
  !s.walls.some((w) => edgeThrough(w, p)) &&
  !occupiedCells(p).some((c) => hiddenUnderRoof(s, c));

// The cells stepped through going from a to b (b included, a not), one side at a time, so the path
// stays edge-connected: a median dragged diagonally still joins up
const cellsBetween = (a: Cell, b: Cell): readonly Cell[] => {
  const out: Cell[] = [];
  let { x, y } = a;
  const [dx, dy] = [Math.abs(b.x - a.x), Math.abs(b.y - a.y)];
  for (let i = 0; i < dx + dy; i++) {
    // step along whichever axis is further behind the straight line from a to b
    const doneX = dx === 0 ? 1 : Math.abs(x - a.x) / dx;
    const doneY = dy === 0 ? 1 : Math.abs(y - a.y) / dy;
    if (doneX <= doneY && x !== b.x) x += Math.sign(b.x - a.x);
    else y += Math.sign(b.y - a.y);
    out.push({ x, y });
  }
  return out.length > 0 ? out : [b];
};

// The selected object, built at a cell if it fits there
const placeObjectAt = (s: State, cell: Cell, run = false): State => {
  const p = objectCandidate(s, cell);
  if (!p) return s;
  const plan = buildPlan(s, p, run);
  if (!plan.ok) return s;
  const kept = s.objects.filter((o) => !plan.replaced.includes(o));
  return { ...s, objects: [...kept, { id: s.nextId, ...p }], nextId: s.nextId + 1 };
};

export const canPaint = (s: State, cell: Cell): boolean => cellInBounds(s.size, cell) && !hiddenUnderRoof(s, cell);



// ===== Culverts =====
// Built like a wide door on a wall: drag along a canal bank and the whole straight run goes in at once.
// A bank is a grid edge with water on exactly one side; that water cell is where it gets drawn.
export type BankSide = 'west' | 'north' | 'east' | 'south';
export type Bank = Readonly<{ cell: Cell; side: BankSide }>;

const wetAt = (s: State, c: Cell): boolean => {
  const t = tileAt(s, c);
  return t !== undefined && isWaterTile(t.defId);
};

export const bankOf = (s: State, e: Edge): Bank | null => {
  // an x edge lies between the cell above it and the cell below; a y edge between left and right
  const [before, after]: [Cell, Cell] = e.axis === 'x' ? [{ x: e.x, y: e.y - 1 }, { x: e.x, y: e.y }] : [{ x: e.x - 1, y: e.y }, { x: e.x, y: e.y }];
  const [a, b] = [wetAt(s, before), wetAt(s, after)];
  if (a === b) return null;
  return a ? { cell: before, side: e.axis === 'x' ? 'south' : 'east' } : { cell: after, side: e.axis === 'x' ? 'north' : 'west' };
};

// A culvert edge: a plain culvert on a bank, or a canal outlet or inlet where a canal meets a stream
export type CulvertEdge = Edge & Readonly<{ kind?: CulvertPiece }>;

// The canal and stream cells on either side of an edge, if it lies between a canal and a stream
export const canalStreamOf = (s: State, e: Edge): Readonly<{ canal: Cell; stream: Cell }> | null => {
  const [a, b]: [Cell, Cell] = e.axis === 'x' ? [{ x: e.x, y: e.y - 1 }, { x: e.x, y: e.y }] : [{ x: e.x - 1, y: e.y }, { x: e.x, y: e.y }];
  const [ta, tb] = [tileAt(s, a)?.defId, tileAt(s, b)?.defId];
  if (ta === 'canal' && tb === 'stream') return { canal: a, stream: b };
  if (ta === 'stream' && tb === 'canal') return { canal: b, stream: a };
  return null;
};

// A plain culvert is a piece of stonework on the water tile behind its edge: a back wall along the edge,
// and a side wall at either end where the tile beside it along the edge is not water. So it is a U on a
// 1-wide channel, an L at the corners of a wider one's end, and a back wall alone in between. before is
// the side toward lower x (or y) along the edge, after the side toward higher.
export type CulvertShape = Readonly<{ cell: Cell; back: BankSide; before: boolean; after: boolean }>;
const STEP: Readonly<Record<BankSide, readonly [number, number]>> = { west: [-1, 0], north: [0, -1], east: [1, 0], south: [0, 1] };
export const culvertShape = (s: State, e: Edge): CulvertShape | null => {
  const b = bankOf(s, e);
  if (!b) return null;
  const [ax, ay] = e.axis === 'x' ? [1, 0] : [0, 1];
  const { x, y } = b.cell;
  return { cell: b.cell, back: b.side, before: !wetAt(s, { x: x - ax, y: y - ay }), after: !wetAt(s, { x: x + ax, y: y + ay }) };
};

// Culverts go only at a channel's end: the water behind the edge must run on at least as far into the
// channel as the end is wide. Along a channel's side the end is long and the water short, so it is not.
const REACH_CAP = 64;
export const atChannelEnd = (s: State, e: Edge): boolean => {
  const b = bankOf(s, e);
  if (!b) return false;
  const [dx, dy] = STEP[b.side];
  const [ax, ay] = e.axis === 'x' ? [1, 0] : [0, 1];
  const wet = (x: number, y: number) => wetAt(s, { x, y });
  const endAt = (x: number, y: number) => wet(x, y) && !wet(x + dx, y + dy);
  const { x, y } = b.cell;
  let wide = 1;
  for (let k = 1; k <= REACH_CAP && endAt(x - ax * k, y - ay * k); k++) wide++;
  for (let k = 1; k <= REACH_CAP && endAt(x + ax * k, y + ay * k); k++) wide++;
  let long = 1;
  while (long <= REACH_CAP && wet(x - dx * long, y - dy * long)) long++;
  return long >= wide;
};

// Whether a culvert edge of this kind fits here: a plain culvert on a bank at a channel's end, an outlet
// or inlet between a canal and a stream
export const culvertFits = (s: State, e: CulvertEdge): boolean => {
  if (e.kind) return canalStreamOf(s, e) !== null;
  const b = bankOf(s, e);
  return b !== null && canPaint(s, b.cell) && atChannelEnd(s, e);
};

export type CulvertPlan = Readonly<{ edges: readonly CulvertEdge[]; valid: boolean }>;

export const culvertPlan = (s: State): CulvertPlan | null => {
  const item = getItem(s.selectedId);
  if (s.tool !== 'build' || !s.point || item.kind !== 'culvert') return null;
  const here = nearestEdge(s.point).edge;
  const run = s.drag?.mode === 'culvert' ? edgeRun(s.drag.start, here) : [here];
  const edges = run.map((e): CulvertEdge => (item.piece ? { ...e, kind: item.piece } : e));
  return { edges, valid: edges.every((e) => culvertFits(s, e)) };
};

export const culvertAt = (s: State, e: Edge): CulvertEdge | undefined => s.culverts.find((c) => sameEdge(c, e));

// A culvert goes as a whole, like a span of door: the straight unbroken run of culvert edges through this one
export const culvertRun = (s: State, e: Edge): readonly Edge[] => {
  const walk = (dir: 1 | -1): Edge[] => {
    const out: Edge[] = [];
    const kind = culvertAt(s, e)?.kind;
    for (let next = stepEdge(e, dir); culvertAt(s, next) && culvertAt(s, next)?.kind === kind; next = stepEdge(next, dir)) out.push(next);
    return out;
  };
  return [...walk(-1).reverse(), e, ...walk(1)];
};

const removeCulvert = (s: State, e: Edge): State => {
  const run = culvertRun(s, e);
  return { ...s, culverts: s.culverts.filter((c) => !run.some((r) => sameEdge(r, c))) };
};

const placeCulvert = (s: State, plan: CulvertPlan): State => ({
  ...s,
  culverts: [...s.culverts, ...plan.edges.filter((e) => !culvertAt(s, e))],
});

// The rectangle being dragged out in square mode, if any
export const squareDraft = (s: State): Rect | null =>
  s.drag?.mode === 'square' ? rectBetween(s.drag.start, s.hover ?? s.drag.start) : null;

// The wall edges being dragged out: a straight run, or the outline of a square
export const wallDraft = (s: State): readonly Edge[] => {
  if (s.drag?.mode === 'wall' && s.point) return edgesBetween(s.drag.start, nearestVertex(s.point));
  const square = squareDraft(s);
  return square ? perimeterEdges(square) : [];
};

export const canPlaceWall = (s: State, e: Edge): boolean =>
  edgeInBounds(s.size, e) && !s.objects.some((o) => edgeThrough(e, o));

// ===== Pointing at walls =====
// Wall height follows the wall view on the 1st floor; the roof view always shows full walls.
// Cutaway cuts a wall low when enclosed space is behind it, so you can see into rooms.
// Lives in the core because both drawing and pointing need the same answer.
const behindCell = (e: Edge): Cell => (e.axis === 'x' ? { x: e.x, y: e.y - 1 } : { x: e.x - 1, y: e.y });

export const wallHeight = (s: State, wall: WallSegment): number => {
  const fence = getWallStyle(wall.styleId).fence;
  if (fence) return fence.height; // fences are low already, so no wall view cuts them
  if (isPole(wall.styleId)) return WALL_H; // poles hold up a canopy and hide nothing, so they stay up
  if (isRoofView(s)) return WALL_H;
  switch (s.wallView) {
    case 'up':
      return WALL_H;
    case 'down':
      return CUT_WALL_H;
    case 'cutaway':
      return isInterior(s, behindCell(wall)) ? CUT_WALL_H : WALL_H;
  }
};

// The wall face under the pointer. The pointer gives the ground point under it, but a wall stands up:
// a spot on a wall at height z shows on screen z pixels above its base, which is the same screen spot
// as the ground point t = z / TILE_H tiles further back along both axes. So walk from the ground point
// toward the camera and see which faces the line passes through below their drawn height. The one
// nearest the camera (largest t) is the one you see. A face always shows its after side.
const BASE_SLACK = 0.06; // a little in front of the base still counts as the wall
export const faceUnder = (s: State, p: Point): WallSegment | null => {
  let best: { wall: WallSegment; t: number } | null = null;
  for (const wall of s.walls) {
    const t = wall.axis === 'x' ? wall.y - p.y : wall.x - p.x;
    if (t < -BASE_SLACK || t > wallHeight(s, wall) / TILE_H) continue;
    const along = wall.axis === 'x' ? p.x + t - wall.x : p.y + t - wall.y;
    if (along < 0 || along > 1) continue;
    if (!best || t > best.t) best = { wall, t };
  }
  return best?.wall ?? null;
};

// The edge an action on existing walls points at: the face under the pointer, or failing that the
// grid line nearest the ground point (which is how bare edges and low walls are reached)
export const edgeUnder = (s: State, p: Point): Readonly<{ edge: Edge; face: boolean }> => {
  const face = faceUnder(s, p);
  return face ? { edge: face, face: true } : { edge: nearestEdge(p).edge, face: false };
};

// The wall edge an opening would go into
export const openingTarget = (s: State): Edge | null => (s.point ? edgeUnder(s, s.point).edge : null);

// Building may swap the opening already in a wall; moving one needs an empty wall.
// Gates go on fences, everything else on walls.
// Doors and windows go on walls, gates on fences, nothing on poles (they are open already)
const openingFitsStyle = (styleId: string, openingId: string): boolean =>
  !isPole(styleId) && isFence(styleId) === (getOpeningDef(openingId).gate === true);
const fitsWall = (wall: WallSegment, openingId: string): boolean => openingFitsStyle(wall.styleId, openingId);

export const canPlaceOpening = (s: State, edge: Edge, replace: boolean, openingId: string): boolean => {
  const wall = wallAt(s, edge);
  return wall !== undefined && (replace || wall.opening === null) && fitsWall(wall, openingId);
};

// ===== Spans: openings across several wall segments =====
// The edge `i` steps further along the same wall line
const stepEdge = (e: Edge, i: number): Edge =>
  e.axis === 'x' ? { axis: 'x', x: e.x + i, y: e.y } : { axis: 'y', x: e.x, y: e.y + i };

// Consecutive edges on one wall line between two edges, in axis order (just `from` if not on one line)
export const edgeRun = (from: Edge, to: Edge): readonly Edge[] => {
  const sameLine = from.axis === to.axis && (from.axis === 'x' ? from.y === to.y : from.x === to.x);
  if (!sameLine) return [from];
  const a = from.axis === 'x' ? from.x : from.y;
  const b = to.axis === 'x' ? to.x : to.y;
  const first = stepEdge(from, Math.min(a, b) - a);
  return range(Math.abs(a - b) + 1).map((i) => stepEdge(first, i));
};

// Which opening goes on each of n segments: a plain opening fits one, a span needs at least two
export const openingIdsFor = (item: OpeningDef, n: number): readonly string[] => {
  if (!item.pieces) return n === 1 ? [item.id] : [];
  return n < 2 ? [] : [item.pieces.start, ...range(n - 2).map(() => item.pieces?.middle ?? ''), item.pieces.end];
};

// Every segment of the span a wall's opening belongs to, in axis order (a plain opening is a span of one).
// Walks outwards until the start and end pieces, never into a neighboring span.
export const openingRun = (s: State, wall: WallSegment): readonly WallSegment[] => {
  const pieceOf = (w: WallSegment | undefined) => (w?.opening ? getOpeningDef(w.opening) : undefined);
  const parent = pieceOf(wall)?.parent;
  if (!parent) return [wall];
  const walk = (dir: 1 | -1, stopAt: 'start' | 'end', foreign: 'start' | 'end'): WallSegment[] => {
    const found: WallSegment[] = [];
    let current = wall;
    while (pieceOf(current)?.role !== stopAt) {
      const next = wallAt(s, stepEdge(current, dir));
      const piece = pieceOf(next);
      if (!next || piece?.parent !== parent || piece.role === foreign) break;
      found.push(next);
      current = next;
    }
    return found;
  };
  return [...walk(-1, 'start', 'end').reverse(), wall, ...walk(1, 'end', 'start')];
};

// Where openings would land right now (being built or being moved), and whether they fit.
// `ids` matches `edges` one to one when there is something to place.
export type OpeningPlan = Readonly<{ edges: readonly Edge[]; ids: readonly string[]; valid: boolean }>;

export const openingPlan = (s: State): OpeningPlan | null => {
  const target = openingTarget(s);
  if (!target) return null;
  const fits = (edges: readonly Edge[], replace: boolean, openingId: string) =>
    edges.every((e) => canPlaceOpening(s, e, replace, openingId));
  const item = getItem(s.selectedId);
  if (s.tool === 'build' && item.kind === 'opening') {
    const edges = s.drag?.mode === 'span' ? edgeRun(s.drag.start, target) : [target];
    const ids = openingIdsFor(item, edges.length);
    // Before a span drag starts, just show whether the hovered spot is a wall
    const ready = ids.length === edges.length || (item.pieces !== undefined && s.drag?.mode !== 'span');
    return { edges, ids, valid: ready && fits(edges, true, item.id) };
  }
  if (s.tool === 'select' && s.selection?.kind === 'opening') {
    const ids = s.selection.openingIds;
    const edges = range(ids.length).map((i) => stepEdge(target, i));
    return { edges, ids, valid: fits(edges, false, ids[0] ?? '') };
  }
  return null;
};

export const planPlaceable = (p: OpeningPlan | null): p is OpeningPlan =>
  p !== null && p.valid && p.ids.length > 0 && p.ids.length === p.edges.length;

// The object ghost under the pointer: a new one being built, or one being moved
export const ghostPlacement = (s: State): ObjectPlacement | null => {
  if (!s.hover) return null;
  if (s.tool === 'build') return objectCandidate(s, s.hover);
  return null;
};

// Walls win when the pointer is right on a grid line, then objects, then tiles.
// Shared by removal and by the bulldoze highlight, so what you see is what goes.
export const eraseTarget = (s: State, cell: Cell, point: Point | null): EraseTarget | null => {
  const near = point ? nearestEdge(point) : null;
  const face = point ? faceUnder(s, point) : null;
  const wall = face ?? (near && near.dist <= EDGE_PICK ? wallAt(s, near.edge) : undefined);
  if (wall) return wall.opening ? { kind: 'opening', target: wall } : { kind: 'wall', target: wall };
  const culvert = near && near.dist <= EDGE_PICK ? culvertAt(s, near.edge) : undefined;
  if (culvert) return { kind: 'culvert', target: culvert };
  if (hiddenUnderRoof(s, cell)) return null;
  const object = objectAt(s, cell);
  if (object) return { kind: 'object', target: object };
  const tile = tileAt(s, cell);
  if (tile) return { kind: 'tile', target: tile };
  // terrain is the lowest thing: a click reaches it only when nothing else is there
  const ground = terrainAt(s, cell);
  return ground ? { kind: 'terrain', target: ground } : null;
};

// What the select tool would pick: the same priority as removal, but floors and culverts are only
// boxed, never clicked. Its filter skips the kinds switched off and looks past them: with Building
// off, a wall face in front of a sofa no longer hides it.
export const pickTarget = (s: State, cell: Cell, point: Point | null): EraseTarget | null => {
  if (s.selectFilter.building) {
    const near = point ? nearestEdge(point) : null;
    const wall = (point ? faceUnder(s, point) : null) ?? (near && near.dist <= EDGE_PICK ? wallAt(s, near.edge) : undefined);
    if (wall) return wall.opening ? { kind: 'opening', target: wall } : { kind: 'wall', target: wall };
  }
  if (hiddenUnderRoof(s, cell)) return null;
  const object = objectAt(s, cell);
  const hit: EraseTarget | null = object ? { kind: 'object', target: object } : null;
  if (hit && s.selectFilter[categoryOfTarget(hit)]) return hit;
  return terrainPick(s, cell);
};

// Terrain is picked last, and only bare: a floor or a road on top hides it (and floors are never clicked).
// Standing things switched off in the filter are looked past.
const terrainPick = (s: State, cell: Cell): EraseTarget | null => {
  const covered = tileAt(s, cell) !== undefined || s.objects.some((o) => layerOf(o.defId) !== null && onCell(o, cell));
  const ground = s.selectFilter.terrain && !covered ? terrainAt(s, cell) : undefined;
  return ground ? { kind: 'terrain', target: ground } : null;
};

// ===== Paint =====
// Paint goes on one side of a wall: the side the pointer is on. Click for one segment, or drag along
// a run like a wide door. Only walls whose material takes paint are painted; the rest are skipped.
export const sideOf = (e: Edge, p: Point): WallSide =>
  (e.axis === 'x' ? p.y < e.y : p.x < e.x) ? 'before' : 'after';

// Pointing at a wall's face paints the side you see; pointing at the floor beside it paints that side
const paintSide = (s: State, p: Point): WallSide => {
  const under = edgeUnder(s, p);
  return under.face ? 'after' : sideOf(under.edge, p);
};

// Which side of which wall gets painted. A click or drag paints one side along a run; Shift + click
// fills: it spreads from the face under the pointer along the wall surface (see wallSurface).
export type PaintTarget = Readonly<{ wall: WallSegment; side: WallSide }>;
export type FillMode = 'same' | 'all'; // Shift: only the same paint or floor; Shift + Ctrl: everything
export type PaintPlan = Readonly<{ targets: readonly PaintTarget[]; paintId: string; fill: FillMode | null }>;

export const fillMode = (s: State): FillMode | null => (s.shiftHeld ? (s.ctrlHeld ? 'all' : 'same') : null);

// ===== Wall surfaces =====
// A wall face is one side of one wall. Faces join up the way a hand slides along a wall: at each end
// of a wall, turn toward the face's side until the next wall around that grid point. That turns at
// corners, follows T junctions into the space the face looks at, and at a free end wraps around to
// the wall's other side. Only real walls count (fences never join a surface), so a room's inside is
// one loop and a building's outside is another. Glass is part of a surface like any wall (paint tints it).
type Dir = 0 | 1 | 2 | 3; // east, south, west, north: clockwise on screen (y grows down)

// The wall leaving grid point (x, y) in a direction
const edgeFrom = (x: number, y: number, d: Dir): Edge =>
  d === 0 ? { axis: 'x', x, y } : d === 1 ? { axis: 'y', x, y } : d === 2 ? { axis: 'x', x: x - 1, y } : { axis: 'y', x, y: y - 1 };

// A wall's two ends, each with the direction pointing back along the wall
const endsOf = (e: Edge): readonly (readonly [number, number, Dir])[] =>
  e.axis === 'x' ? [[e.x, e.y, 0], [e.x + 1, e.y, 2]] : [[e.x, e.y, 1], [e.x, e.y + 1, 3]];

// Standing at a wall's end and looking along it, the side to the clockwise hand
const clockwiseSide = (d: Dir): WallSide => (d === 0 || d === 3 ? 'after' : 'before');
const otherSide = (side: WallSide): WallSide => (side === 'after' ? 'before' : 'after');

// The faces next to a face: one across each end of its wall
const nextFaces = (walls: ReadonlyMap<string, WallSegment>, wall: WallSegment, side: WallSide): PaintTarget[] =>
  endsOf(wall).flatMap(([x, y, d]) => {
    const clockwise = side === clockwiseSide(d);
    for (let k = 1; k <= 4; k++) {
      const turned = ((d + (clockwise ? k : 4 - k)) % 4) as Dir; // k = 4 comes back to this wall: its other side
      const next = walls.get(edgeKey(edgeFrom(x, y, turned)));
      if (next) return [{ wall: next, side: clockwise ? otherSide(clockwiseSide(turned)) : clockwiseSide(turned) }];
    }
    return [];
  });

const faceKey = (t: PaintTarget) => `${edgeKey(t.wall)}|${t.side}`;
const paintOn = (t: PaintTarget): string | null => t.wall.paint[t.side];

// Every face joined to `start`. 'same' stops at a different paint; 'all' goes over everything.
export const wallSurface = (s: State, start: PaintTarget, mode: FillMode): PaintTarget[] => {
  if (!isPaintable(start.wall.styleId)) return [];
  const walls = new Map(s.walls.filter((w) => !isFence(w.styleId)).map((w) => [edgeKey(w), w]));
  const fits = (t: PaintTarget) => isPaintable(t.wall.styleId) && (mode === 'all' || paintOn(t) === paintOn(start));
  const seen = new Map<string, PaintTarget>([[faceKey(start), start]]);
  const queue: PaintTarget[] = [start];
  for (let t = queue.pop(); t; t = queue.pop()) {
    nextFaces(walls, t.wall, t.side).forEach((n) => {
      if (seen.has(faceKey(n)) || !fits(n)) return;
      seen.set(faceKey(n), n);
      queue.push(n);
    });
  }
  return [...seen.values()];
};

// The face a click starts from: the wall nearest the pointer, on the side the pointer is on
const faceUnderPointer = (s: State): PaintTarget | null => {
  if (!s.point) return null;
  const wall = wallAt(s, edgeUnder(s, s.point).edge);
  return wall && !isFence(wall.styleId) ? { wall, side: paintSide(s, s.point) } : null;
};

export const paintPlan = (s: State): PaintPlan | null => {
  const item = getItem(s.selectedId);
  if (s.tool !== 'build' || item.kind !== 'paint' || !s.point) return null;
  const mode = fillMode(s);
  if (mode && !s.drag) {
    const start = faceUnderPointer(s);
    return { targets: start ? wallSurface(s, start, mode) : [], paintId: item.id, fill: mode };
  }
  const here = edgeUnder(s, s.point).edge;
  const drag = s.drag?.mode === 'wallPaint' ? s.drag : null;
  const side = drag?.side ?? paintSide(s, s.point);
  const edges = drag ? edgeRun(drag.start, here) : [here];
  const targets = edges.flatMap((e): PaintTarget[] => {
    const wall = wallAt(s, e);
    return wall && isPaintable(wall.styleId) ? [{ wall, side }] : [];
  });
  return { targets, paintId: item.id, fill: null };
};

// The paint id stored on a side, or null for Plain (show the material)
export const storedPaint = (paintId: string): string | null => (getItem(paintId).kind === 'paint' && getPaint(paintId).color !== null ? paintId : null);

const applyPaint = (s: State, plan: PaintPlan | null): State => {
  if (!plan || plan.targets.length === 0) return s;
  const value = storedPaint(plan.paintId);
  const sides = new Map<string, WallSide[]>();
  plan.targets.forEach((t) => sides.set(edgeKey(t.wall), [...(sides.get(edgeKey(t.wall)) ?? []), t.side]));
  return {
    ...s,
    walls: s.walls.map((w) => {
      const paintHere = sides.get(edgeKey(w));
      return paintHere ? { ...w, paint: paintHere.reduce((p, side) => ({ ...p, [side]: value }), w.paint) } : w;
    }),
  };
};

// ===== Fill for flooring =====
// Shift + click spreads a floor from the tile under the pointer over neighboring tiles with the same
// floor (or the same bare ground); Shift + Ctrl + click spreads over every floor. Real walls stop it
// either way, so it never leaks into the next room; fences do not. Works indoors and out.
export type FloorFill = Readonly<{ cells: readonly Cell[]; mode: FillMode }>;

export const floodTiles = (s: State, start: Cell, mode: FillMode): Cell[] =>
  flood(s, start, mode, new Map(s.tiles.map((t) => [cellKey(t), t.defId])));

// The same spread for any ground layer: `floorAt` says what each cell holds (no entry is bare ground)
const flood = (s: State, start: Cell, mode: FillMode, floorAt: ReadonlyMap<string, string>): Cell[] => {
  if (!cellInBounds(s.size, start)) return [];
  const startFloor = floorAt.get(cellKey(start)) ?? null;
  const walls = new Set(s.walls.filter((w) => !isFence(w.styleId)).map(edgeKey));
  const blocked = (e: Edge) => walls.has(edgeKey(e));
  const fits = (c: Cell) => cellInBounds(s.size, c) && (mode === 'all' || (floorAt.get(cellKey(c)) ?? null) === startFloor);
  const seen = new Map<string, Cell>([[cellKey(start), start]]);
  const queue: Cell[] = [start];
  for (let c = queue.pop(); c; c = queue.pop()) {
    const steps: readonly [Cell, Edge][] = [
      [{ x: c.x + 1, y: c.y }, { axis: 'y', x: c.x + 1, y: c.y }],
      [{ x: c.x - 1, y: c.y }, { axis: 'y', x: c.x, y: c.y }],
      [{ x: c.x, y: c.y + 1 }, { axis: 'x', x: c.x, y: c.y + 1 }],
      [{ x: c.x, y: c.y - 1 }, { axis: 'x', x: c.x, y: c.y }],
    ];
    steps.forEach(([n, e]) => {
      if (seen.has(cellKey(n)) || !fits(n) || blocked(e)) return;
      seen.set(cellKey(n), n);
      queue.push(n);
    });
  }
  return [...seen.values()];
};

// The hud and the preview both ask every frame; the answer only changes with the world or the pointer
let lastFill: { tiles: State['tiles']; walls: State['walls']; key: string; cells: readonly Cell[] } | null = null;

export const floorFill = (s: State): FloorFill | null => {
  const item = getItem(s.selectedId);
  const mode = fillMode(s);
  if (s.tool !== 'build' || item.kind !== 'tile' || !mode || s.drag || !s.hover) return null;
  const key = `${cellKey(s.hover)}|${mode}`;
  if (!lastFill || lastFill.tiles !== s.tiles || lastFill.walls !== s.walls || lastFill.key !== key) {
    lastFill = { tiles: s.tiles, walls: s.walls, key, cells: floodTiles(s, s.hover, mode).filter((c) => canPaint(s, c)) };
  }
  return { cells: lastFill.cells, mode };
};

const applyFloorFill = (s: State, fill: FloorFill | null, defId: string): State =>
  (fill?.cells ?? []).reduce((acc, c) => paint(acc, c, defId), s);

// ===== Terrain =====
// Painted with the round brush (a stroke is one undo step, like a floor drag) and filled like floors:
// Shift + click spreads over the same terrain (bare ground counts as one terrain), Shift + Ctrl over any.
// Real walls stop a fill and fences do not. Floors on top are ignored: the fill works on the terrain
// layer under them. `cells` is what the fill would paint, in view space, for the preview.
export type TerrainFill = Readonly<{ cells: readonly Cell[]; mode: FillMode }>;

// Sets the terrain of many cells at once (the map's own ground is the eraser: it takes the entry away). Cells off the map are
// skipped; the state itself comes back when nothing changes, so a stroke over painted ground is free.
const paintTerrain = (s: State, cells: readonly Cell[], defId: string): State => {
  const erase = defId === s.ground;
  const there = new Map(s.terrain.map((t) => [cellKey(t), t.defId]));
  const changed = new Map<string, Cell>();
  cells.forEach((c) => {
    if (!cellInBounds(s.size, c)) return;
    const key = cellKey(c);
    if ((there.get(key) ?? s.ground) !== defId) changed.set(key, c);
  });
  if (changed.size === 0) return s;
  const kept = s.terrain.filter((t) => !changed.has(cellKey(t)));
  const added = erase ? [] : [...changed.values()].map((c): TerrainCell => ({ x: c.x, y: c.y, defId }));
  return { ...s, terrain: [...kept, ...added] };
};

export const floodTerrain = (s: State, start: Cell, mode: FillMode): Cell[] =>
  flood(s, start, mode, new Map(s.terrain.map((t) => [cellKey(t), t.defId])));

let lastTerrainFill: { terrain: State['terrain']; walls: State['walls']; key: string; cells: readonly Cell[] } | null = null;

export const terrainFill = (s: State): TerrainFill | null => {
  const mode = fillMode(s);
  if (s.tool !== 'build' || !isTerrain(s.selectedId) || !mode || s.drag || !s.hover) return null;
  const key = `${cellKey(s.hover)}|${mode}`;
  if (!lastTerrainFill || lastTerrainFill.terrain !== s.terrain || lastTerrainFill.walls !== s.walls || lastTerrainFill.key !== key) {
    lastTerrainFill = { terrain: s.terrain, walls: s.walls, key, cells: floodTerrain(s, s.hover, mode) };
  }
  return { cells: lastTerrainFill.cells, mode };
};

const applyTerrainFill = (s: State, fill: TerrainFill | null, defId: string): State => (fill ? paintTerrain(s, fill.cells, defId) : s);

// ===== Bulldoze =====
// One plan says everything a bulldoze action would remove: a single click (the same target the
// highlight shows), a dragged box, or with Shift a whole room. The preview draws the plan and
// release applies it, so what you see is what goes. The filter keeps only the kinds switched on.
export type BulldozeFilter = Readonly<Record<CategoryId, boolean>>;
export type BulldozePlan = Readonly<{
  targets: readonly EraseTarget[];
  area: Rect | null; // the dragged box
  room: readonly Cell[] | null; // the room being cleared
  outdoors: boolean; // Shift is held but the cursor is not in a room
}>;

export const categoryOfTarget = (t: EraseTarget): CategoryId => {
  switch (t.kind) {
    case 'object':
      return categoryOf(getItem(t.target.defId).group);
    case 'tile':
    case 'terrain':
      return categoryOf(getItem(t.target.defId).group);
    case 'culvert':
      return categoryOf(getItem('culvert').group);
    case 'wall':
    case 'opening':
      return 'building';
  }
};

// The room around a cell: interior cells reached without crossing a real wall (fences do not divide rooms)
export const roomAt = (s: State, start: Cell): readonly Cell[] | null => {
  const inside = interiorCells(s.walls, s.size);
  if (!inside.has(cellKey(start))) return null;
  const blocked = (e: Edge) => { const w = wallAt(s, e); return w !== undefined && !isFence(w.styleId); };
  const seen = new Map<string, Cell>([[cellKey(start), start]]);
  const queue: Cell[] = [start];
  for (let c = queue.shift(); c; c = queue.shift()) {
    const steps: readonly [Cell, Edge][] = [
      [{ x: c.x + 1, y: c.y }, { axis: 'y', x: c.x + 1, y: c.y }],
      [{ x: c.x - 1, y: c.y }, { axis: 'y', x: c.x, y: c.y }],
      [{ x: c.x, y: c.y + 1 }, { axis: 'x', x: c.x, y: c.y + 1 }],
      [{ x: c.x, y: c.y - 1 }, { axis: 'x', x: c.x, y: c.y }],
    ];
    steps.forEach(([n, e]) => {
      if (seen.has(cellKey(n)) || !inside.has(cellKey(n)) || blocked(e)) return;
      seen.set(cellKey(n), n);
      queue.push(n);
    });
  }
  return [...seen.values()];
};

// The two cells either side of an edge
const sidesOf = (e: Edge): readonly [Cell, Cell] =>
  e.axis === 'x' ? [{ x: e.x, y: e.y - 1 }, { x: e.x, y: e.y }] : [{ x: e.x - 1, y: e.y }, { x: e.x, y: e.y }];

// Walls inside a box always go. A wall on the box's border goes only when it encloses a room the box
// covers: boxing a building's floor takes its walls, boxing the ground beside it leaves them alone.
const edgeInArea = (s: State, e: Edge, r: Rect): boolean => {
  if (edgeInsideRect(e, r)) return true;
  if (!perimeterEdges(r).some((p) => sameEdge(p, e))) return false;
  const inside = sidesOf(e).find((c) => covers(r, c));
  return inside !== undefined && isInterior(s, inside);
};

// Everything in a set of cells (a box or a room), plus walls that `edgeIn` accepts
const targetsWhere = (
  s: State, inCell: (c: Cell) => boolean, overlaps: (o: ObjectPlacement) => boolean, edgeIn: (e: Edge) => boolean,
): EraseTarget[] => [
  ...s.objects.filter((o) => overlaps(o) && !occupiedCells(o).some((c) => hiddenUnderRoof(s, c))).map((o): EraseTarget => ({ kind: 'object', target: o })),
  ...s.tiles.filter((t) => inCell(t) && !hiddenUnderRoof(s, t)).map((t): EraseTarget => ({ kind: 'tile', target: t })),
  ...s.terrain.filter((t) => inCell(t) && !hiddenUnderRoof(s, t)).map((t): EraseTarget => ({ kind: 'terrain', target: t })),
  ...s.walls.filter(edgeIn).map((w): EraseTarget => ({ kind: 'wall', target: w })),
  ...s.culverts.filter(edgeIn).map((c): EraseTarget => ({ kind: 'culvert', target: c })),
];

export const bulldozePlan = (s: State): BulldozePlan | null => {
  if (s.tool !== 'bulldoze' || !s.hover) return null;
  const keep = (ts: readonly EraseTarget[]) => ts.filter((t) => s.bulldozeFilter[categoryOfTarget(t)]);
  const none = { area: null, room: null, outdoors: false };
  if (s.shiftHeld && !s.drag) {
    const room = roomAt(s, s.hover);
    if (!room) return { ...none, targets: [], outdoors: true };
    const inRoom = new Set(room.map(cellKey));
    const has = (c: Cell) => inRoom.has(cellKey(c));
    const targets = targetsWhere(s, has, (o) => occupiedCells(o).some(has), (e) => sidesOf(e).some(has));
    return { ...none, targets: keep(targets), room };
  }
  const drag = s.drag?.mode === 'erase' ? s.drag : null;
  if (drag && !sameCell(drag.start, s.hover)) {
    const area = rectBetween(drag.start, s.hover);
    const targets = targetsWhere(s, (c) => covers(area, c), (o) => onArea(o, area), (e) => edgeInArea(s, e, area));
    return { ...none, targets: keep(targets), area };
  }
  // A click, or a drag that has not left its cell: the single thing under the pointer
  const hit = eraseTarget(s, s.hover, drag?.point ?? s.point);
  return { ...none, targets: hit ? keep([hit]) : [] };
};

const applyBulldoze = (s: State, plan: BulldozePlan | null): State =>
  (plan?.targets ?? []).reduce((acc, t) => {
    switch (t.kind) {
      case 'object':
        return { ...acc, objects: acc.objects.filter((o) => o !== t.target) };
      case 'tile':
        return { ...acc, tiles: acc.tiles.filter((x) => x !== t.target) };
      case 'terrain':
        return { ...acc, terrain: acc.terrain.filter((x) => x !== t.target) };
      case 'culvert': // one culvert goes as its whole run, like a span of door
        return culvertAt(acc, t.target) ? removeCulvert(acc, t.target) : acc;
      case 'opening': { // removing an opening leaves the walls; a span goes as a whole
        const wall = wallAt(acc, t.target);
        return wall?.opening ? clearOpenings(acc, openingRun(acc, wall)) : acc;
      }
      case 'wall':
        return { ...acc, walls: acc.walls.filter((w) => !sameEdge(w, t.target)) };
    }
  }, s);

// ===== Transitions =====
const paint = (s: State, cell: Cell, defId: string): State => {
  if (!canPaint(s, cell) || tileAt(s, cell)?.defId === defId) return s;
  return {
    ...s,
    tiles: [...s.tiles.filter((t) => !(t.x === cell.x && t.y === cell.y)), { x: cell.x, y: cell.y, defId }],
  };
};

const replaceWall = (s: State, wall: WallSegment, next: WallSegment | null): State => ({
  ...s,
  walls: next ? s.walls.map((w) => (w === wall ? next : w)) : s.walls.filter((w) => w !== wall),
});


// Cells that became enclosed going from one set of walls to another get the style's floor,
// unless they already have a tile (a path or floor someone chose stays as it is)
const floorNewRooms = (before: State, after: State, floorId: string): State => {
  const wasInside = interiorCells(before.walls, before.size);
  const fresh = [...interiorCells(after.walls, after.size)]
    .filter((k) => !wasInside.has(k))
    .map((k) => {
      const [x = 0, y = 0] = k.split(',').map(Number);
      return { x, y };
    })
    .filter((c) => !tileAt(after, c));
  return fresh.length === 0 ? after : { ...after, tiles: [...after.tiles, ...fresh.map((c) => ({ ...c, defId: floorId }))] };
};

// Builds every valid edge. Line mode restyles walls it runs over (that is how you repaint);
// square mode leaves existing walls alone, so a square built against a neighbor keeps the shared wall.
// Both keep openings, and both lay floors in any room they close off.
const placeWalls = (s: State, edges: readonly Edge[], styleId: string, restyle: boolean): State => {
  const byEdge = new Map(s.walls.map((w) => [edgeKey(w), w]));
  edges
    .filter((e) => canPlaceWall(s, e) && (restyle || !byEdge.has(edgeKey(e))))
    .forEach((e) => {
      // an opening survives a restyle only if it still fits: a door on a wall turned fence goes
      const current = byEdge.get(edgeKey(e));
      const kept = current?.opening ?? null;
      const fits = kept !== null && openingFitsStyle(styleId, kept);
      // paint stays on a restyle as long as the new material takes paint
      const paint = current && isPaintable(styleId) ? current.paint : NO_PAINT;
      byEdge.set(edgeKey(e), { ...e, styleId, opening: fits ? kept : null, paint });
    });
  const next = { ...s, walls: [...byEdge.values()] };
  const floor = getWallStyle(styleId).floor;
  return floor ? floorNewRooms(s, next, floor) : next;
};

const clearOpenings = (s: State, walls: readonly WallSegment[]): State =>
  walls.reduce((acc, w) => {
    const current = wallAt(acc, w);
    return current?.opening ? replaceWall(acc, current, { ...current, opening: null }) : acc;
  }, s);

// Puts openings onto walls. Any span already crossing those walls is removed whole first,
// so building over part of a span never leaves broken pieces behind.
const placeOpenings = (s: State, edges: readonly Edge[], ids: readonly string[]): State => {
  const cleared = edges.reduce((acc, e) => {
    const wall = wallAt(acc, e);
    return wall?.opening ? clearOpenings(acc, openingRun(acc, wall)) : acc;
  }, s);
  return edges.reduce((acc, e, i) => {
    const wall = wallAt(acc, e);
    const id = ids[i];
    return wall && id ? replaceWall(acc, wall, { ...wall, opening: id }) : acc;
  }, cleared);
};

// ===== Selecting several things =====
export const pieceCount = (p: Pieces): number => p.objects.length + p.walls.length + p.tiles.length + p.terrain.length + p.culverts.length;

// What a mark stands for: a door marks its wall (walls carry their openings), and a wide opening marks
// its whole run, so it never comes apart
const marksFor = (s: State, hit: EraseTarget): EraseTarget[] => {
  if (hit.kind !== 'wall' && hit.kind !== 'opening') return [hit];
  return (hit.target.opening ? openingRun(s, hit.target) : [hit.target]).map((w): EraseTarget => ({ kind: 'wall', target: w }));
};

const sameTarget = (a: EraseTarget, b: EraseTarget): boolean => a.target === b.target;
export const isMarked = (s: State, hit: EraseTarget): boolean =>
  s.selection?.kind === 'marked' && marksFor(s, hit).some((m) => s.selection?.kind === 'marked' && s.selection.targets.some((t) => sameTarget(t, m)));

// Adds marks without doubles
const unionMarks = (a: readonly EraseTarget[], b: readonly EraseTarget[]): EraseTarget[] =>
  [...a, ...b.filter((t) => !a.some((x) => sameTarget(x, t)))];

const marked = (targets: readonly EraseTarget[]): Selection | null => (targets.length ? { kind: 'marked', targets } : null);

export const piecesOf = (targets: readonly EraseTarget[]): Pieces => ({
  objects: targets.flatMap((t) => (t.kind === 'object' ? [t.target] : [])),
  walls: targets.flatMap((t) => (t.kind === 'wall' || t.kind === 'opening' ? [t.target] : [])),
  tiles: targets.flatMap((t) => (t.kind === 'tile' ? [t.target] : [])),
  terrain: targets.flatMap((t) => (t.kind === 'terrain' ? [t.target] : [])),
  culverts: targets.flatMap((t) => (t.kind === 'culvert' ? [t.target] : [])),
});

const targetsOf = (p: Pieces): EraseTarget[] => [
  ...p.objects.map((target): EraseTarget => ({ kind: 'object', target })),
  ...p.walls.map((target): EraseTarget => ({ kind: 'wall', target })),
  ...p.tiles.map((target): EraseTarget => ({ kind: 'tile', target })),
  ...p.terrain.map((target): EraseTarget => ({ kind: 'terrain', target })),
  ...p.culverts.map((target): EraseTarget => ({ kind: 'culvert', target })),
];

// Everything in a box the select tool drags out: the same reach as a bulldoze box
export const boxArea = (s: State): Rect | null =>
  s.drag?.mode === 'box' && s.hover && !sameCell(s.drag.start, s.hover) ? rectBetween(s.drag.start, s.hover) : null;
export const boxTargets = (s: State): EraseTarget[] => {
  const area = boxArea(s);
  const all = area ? targetsWhere(s, (c) => covers(area, c), (o) => onArea(o, area), (e) => edgeInArea(s, e, area)) : [];
  return all.filter((t) => s.selectFilter[categoryOfTarget(t)]);
};

// Takes pieces out of the world (by identity: exactly these, not look-alikes)
const without = (s: State, p: Pieces): State => {
  const gone = new Set<object>([...p.objects, ...p.walls, ...p.tiles, ...p.terrain, ...p.culverts]);
  return {
    ...s,
    objects: s.objects.filter((o) => !gone.has(o)),
    walls: s.walls.filter((w) => !gone.has(w)),
    tiles: s.tiles.filter((t) => !gone.has(t)),
    terrain: s.terrain.filter((t) => !gone.has(t)),
    culverts: s.culverts.filter((c) => !gone.has(c)),
  };
};

// Where a held group would land: turned about its grabbed cell, then moved with the pointer
export const groupGhost = (s: State): Pieces | null => {
  const sel = s.selection;
  if (s.tool !== 'select' || sel?.kind !== 'group' || !s.hover) return null;
  let p = sel.pieces;
  for (let i = 0; i < sel.turns; i++) p = turnAbout(sel.anchor, p);
  const dx = s.hover.x - sel.anchor.x, dy = s.hover.y - sel.anchor.y;
  const move = <T extends { x: number; y: number }>(t: T): T => ({ ...t, x: t.x + dx, y: t.y + dy });
  return { objects: p.objects.map(move), walls: p.walls.map(move), tiles: p.tiles.map(move), terrain: p.terrain.map(move), culverts: p.culverts.map(move) };
};

// A held group's ghost and whether it fits. Drawing asks several times a frame, and the answer only
// changes with the pointer, the held group or the world, so the last answer is kept.
export type HeldPlan = Readonly<{ ghost: Pieces; valid: boolean }>;
let lastHeld: { key: readonly unknown[]; plan: HeldPlan | null } | null = null;
export const heldPlan = (s: State): HeldPlan | null => {
  const key = [s.selection, s.hover?.x, s.hover?.y, s.tool, s.objects, s.walls, s.tiles, s.terrain, s.culverts];
  if (lastHeld && lastHeld.key.every((k, i) => k === key[i])) return lastHeld.plan;
  const ghost = groupGhost(s);
  const plan = ghost && { ghost, valid: placePieces(s, ghost) !== null };
  lastHeld = { key, plan };
  return plan;
};

// A wall that lands on a wall already there joins it instead of being refused, so a copied room can
// share a wall with its neighbor. The wall already there keeps its material; each side takes the
// landing wall's paint if it has one (a pasted room's inside paint shows on its side, the neighbor's
// stays on theirs); a door or window on either is kept. Two different openings, or a wall landing on
// a fence (or the other way round), cannot be one wall: null.
export const joinWalls = (there: WallSegment, landing: WallSegment): WallSegment | null => {
  if (isFence(there.styleId) !== isFence(landing.styleId)) return null;
  if (there.opening && landing.opening && there.opening !== landing.opening) return null;
  return {
    ...there,
    opening: there.opening ?? landing.opening,
    paint: { before: landing.paint.before ?? there.paint.before, after: landing.paint.after ?? there.paint.after },
  };
};

// Marks follow what is now in the world: a wall that joined one already there is that joined wall
const placedTargets = (placed: State, p: Pieces): EraseTarget[] =>
  targetsOf({ ...p, walls: p.walls.map((w) => wallAt(placed, w) ?? w) });

// Puts pieces into the world if every one fits, else null. Walls go first (joining walls already
// there), then floors (a moved floor replaces what is there), then culverts (they need water beside
// them, which may be moving too), then objects, each checked against everything placed before it.
export const placePieces = (s: State, p: Pieces): State | null => {
  const walled = p.walls.reduce<State | null>((acc, w) => {
    if (!acc || !canPlaceWall(acc, w)) return null;
    const there = wallAt(acc, w);
    if (!there) return { ...acc, walls: [...acc.walls, w] };
    const joined = joinWalls(there, w);
    return joined ? { ...acc, walls: acc.walls.map((x) => (x === there ? joined : x)) } : null;
  }, s);
  if (!walled) return null;
  if (!p.tiles.every((t) => canPaint(walled, t))) return null;
  if (!p.terrain.every((t) => cellInBounds(walled.size, t))) return null;
  const at = new Set(p.tiles.map(cellKey));
  const ground = new Set(p.terrain.map(cellKey)); // terrain lands over terrain, as a floor over a floor
  const floored: State = {
    ...walled,
    tiles: [...walled.tiles.filter((t) => !at.has(cellKey(t))), ...p.tiles],
    terrain: [...walled.terrain.filter((t) => !ground.has(cellKey(t))), ...withoutGround(walled.ground, p.terrain)],
  };
  if (!p.culverts.every((c) => !culvertAt(floored, c) && culvertFits(floored, c))) return null;
  const culverted: State = { ...floored, culverts: [...floored.culverts, ...p.culverts] };
  return p.objects.reduce<State | null>(
    (acc, o) => (acc && canPlaceObject(acc, o) ? { ...acc, objects: [...acc.objects, o] } : null),
    culverted,
  );
};

const lift = (s: State, targets: readonly EraseTarget[], anchor: Cell, isMarked: boolean): State => {
  const pieces = piecesOf(targets);
  return { ...without(s, pieces), selection: { kind: 'group', pieces, anchor, turns: 0, marked: isMarked, copy: false } };
};

// Returns whatever the select tool is holding to where it came from, and clears marks. A held group
// that came from marks is marked again unless `clear` (Esc peels one layer at a time: the held group
// goes back marked, the next Esc clears the marks).
const putBack = (s: State, clear = true): State => {
  const sel = s.selection;
  if (!sel) return s;
  const cleared: State = { ...s, selection: null };
  switch (sel.kind) {
    case 'marked':
      return cleared;
    case 'group': {
      if (sel.copy) return cleared; // a paste took nothing out of the world
      const p = sel.pieces;
      const back: State = { ...cleared, objects: [...s.objects, ...p.objects], walls: [...s.walls, ...p.walls], tiles: [...s.tiles, ...p.tiles], terrain: [...s.terrain, ...p.terrain], culverts: [...s.culverts, ...p.culverts] };
      return clear || !sel.marked ? back : { ...back, selection: marked(targetsOf(p)) };
    }
    case 'opening':
      return sel.originals.every((o) => wallAt(cleared, o)?.opening === null)
        ? placeOpenings(cleared, sel.originals, sel.openingIds)
        : cleared;
  }
};

// Turns marked things a quarter in place (about the middle of what is marked), if they still fit
const turnMarked = (s: State, targets: readonly EraseTarget[], dir: 1 | -1): State => {
  const pieces = piecesOf(targets);
  const box = boundsOf(pieces);
  const pivot = { x: box.x + Math.floor((box.w - 1) / 2), y: box.y + Math.floor((box.h - 1) / 2) };
  let turned = pieces;
  for (let i = 0; i < (dir === 1 ? 1 : 3); i++) turned = turnAbout(pivot, turned);
  const placed = placePieces(without(s, pieces), turned);
  return placed ? { ...placed, selection: marked(placedTargets(placed, turned)) } : s;
};

// The cells a set of pieces spans (walls and culverts count the cells beside them)
export const piecesBounds = (p: Pieces): Rect => boundsOf(p);
const boundsOf = (p: Pieces): Rect => {
  const rects: Rect[] = [
    ...p.objects,
    ...p.tiles.map((t) => ({ x: t.x, y: t.y, w: 1, h: 1 })),
    ...p.terrain.map((t) => ({ x: t.x, y: t.y, w: 1, h: 1 })),
    ...[...p.walls, ...p.culverts].map((e) => (e.axis === 'x' ? { x: e.x, y: e.y - 1, w: 1, h: 2 } : { x: e.x - 1, y: e.y, w: 2, h: 1 })),
  ];
  const x = Math.min(...rects.map((r) => r.x)), y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
};

// Select tool click. Holding something: drop it there (if it fits). Shift: add or remove what is under
// the pointer from the marks, or start a box that adds. With things marked, a click anywhere lifts them
// all. Otherwise an object lifts by itself, an opening slides off its wall, a wall becomes the one mark,
// and empty ground starts a box. Esc or a right click lets go of marks.
const selectPress = (s: State, cell: Cell, point: Point): State => {
  const at: State = { ...s, hover: cell, point };
  const sel = s.selection;

  if (sel?.kind === 'group') {
    const ghost = groupGhost(at);
    if (!ghost) return at;
    // pasted objects are new things with new ids; the paste stays in hand for the next drop
    const fresh = sel.copy ? { ...ghost, objects: ghost.objects.map((o, i) => ({ ...o, id: at.nextId + i })) } : ghost;
    const placed = placePieces(at, fresh);
    if (!placed) return at;
    if (sel.copy) return { ...placed, nextId: at.nextId + fresh.objects.length };
    return { ...placed, selection: sel.marked ? marked(placedTargets(placed, ghost)) : null };
  }
  if (sel?.kind === 'opening') {
    const plan = openingPlan(at);
    return planPlaceable(plan) ? { ...placeOpenings(at, plan.edges, plan.ids), selection: null } : at;
  }

  const hit = pickTarget(at, cell, point);
  const marks = sel?.kind === 'marked' ? sel.targets : [];
  // With things marked, a plain click anywhere lifts them all, held by the clicked cell
  if (marks.length && !s.shiftHeld) return lift(at, marks, cell, true);
  // Terrain is the ground you start boxes on, so pressing on it starts a box too; a click that never
  // left its cell marks the terrain there instead (see finishBox)
  if (!hit || hit.kind === 'terrain') return { ...at, drag: { mode: 'box', start: cell, add: s.shiftHeld } };
  if (s.shiftHeld) {
    const these = marksFor(at, hit);
    const next = isMarked(at, hit) ? marks.filter((t) => !these.some((m) => sameTarget(t, m))) : unionMarks(marks, these);
    return { ...at, selection: marked(next) };
  }
  switch (hit.kind) {
    case 'object':
      return lift(at, [hit], cell, false);
    case 'opening': {
      const run = openingRun(at, hit.target); // a span is picked up whole
      return {
        ...clearOpenings(at, run),
        selection: { kind: 'opening', originals: run, openingIds: run.map((w) => w.opening ?? '') },
      };
    }
    default:
      return { ...at, selection: marked(marksFor(at, hit)) };
  }
};

// ===== Copy and paste =====
// Copy keeps what is marked (or what is held), held by the cell in the middle of it
const copyOf = (pieces: Pieces, from: readonly EraseTarget[]): Clipboard => {
  const box = boundsOf(pieces);
  return { pieces, anchor: { x: box.x + Math.floor((box.w - 1) / 2), y: box.y + Math.floor((box.h - 1) / 2) }, from };
};

// Paste: a held copy of the clipboard (or a blueprint), in the select tool, to drop as many times as wanted
const paste = (s: State, c: Pick<Clipboard, 'pieces' | 'anchor'> | null, name?: string): State => {
  if (!c || pieceCount(c.pieces) === 0) return s;
  return { ...switchTool(s, 'select'), trayOpen: false, selection: { kind: 'group', pieces: c.pieces, anchor: c.anchor, turns: 0, marked: false, copy: true, name } };
};

// ===== Blueprints =====
// Saving moves the marked things to the origin, so a blueprint does not remember where it came from
const blueprintOf = (id: number, name: string, pieces: Pieces): Blueprint => {
  const box = boundsOf(pieces);
  const move = <T extends { x: number; y: number }>(t: T): T => ({ ...t, x: t.x - box.x, y: t.y - box.y });
  const at = { objects: pieces.objects.map(move), walls: pieces.walls.map(move), tiles: pieces.tiles.map(move), terrain: pieces.terrain.map(move), culverts: pieces.culverts.map(move) };
  return { id, name, pieces: at, anchor: { x: Math.floor((box.w - 1) / 2), y: Math.floor((box.h - 1) / 2) } };
};

const nextBlueprintId = (s: State): number => Math.max(0, ...s.blueprints.map((b) => b.id)) + 1;

// "Blueprint 3": the first number not taken
const freeName = (s: State): string => {
  const taken = new Set(s.blueprints.map((b) => b.name));
  let n = 1;
  while (taken.has(`Blueprint ${n}`)) n++;
  return `Blueprint ${n}`;
};

export const canSaveBlueprint = (s: State): boolean => s.selection?.kind === 'marked' && s.selection.targets.length > 0;

// Letting go of a box: mark what it covers (Shift adds to the marks). A click that never left its
// cell is a click on empty ground: it clears the marks, unless Shift is held.
const finishBox = (s: State, drag: Readonly<{ start: Cell; add: boolean }>): State => {
  const marks = s.selection?.kind === 'marked' ? s.selection.targets : [];
  const boxed = boxTargets(s);
  const done: State = { ...s, drag: null };
  if (!boxArea(s)) {
    const ground = terrainPick(s, drag.start);
    if (ground) {
      const next = drag.add ? (isMarked(s, ground) ? marks.filter((t) => !sameTarget(t, ground)) : unionMarks(marks, [ground])) : [ground];
      return { ...done, selection: marked(next) };
    }
    return drag.add ? done : { ...done, selection: null };
  }
  return { ...done, selection: marked(drag.add ? unionMarks(marks, boxed) : boxed) };
};

// The catalog item that builds a placed thing (what the picker copies)
export const sourceItem = (hit: EraseTarget): string => {
  switch (hit.kind) {
    case 'object':
      return hit.target.defId;
    case 'tile':
    case 'terrain':
      return hit.target.defId;
    case 'wall':
      return hit.target.styleId;
    case 'opening':
      return hit.target.opening ? trayItemOf(hit.target.opening) : hit.target.styleId;
    case 'culvert':
      return culvertItemOf(hit.target.kind);
  }
};

// Bare ground is no thing to move or remove, but the picker tool still builds it: it picks the map's ground (Q does not)
const pickBareGround = (s: State, cell: Cell): State =>
  cellInBounds(s.size, cell) && !hiddenUnderRoof(s, cell) ? select(s, s.ground) : s;

// Starts building what a placed thing was built from, facing the same way if it is an object
const pickFrom = (s: State, hit: EraseTarget): State => {
  const picked = select(s, sourceItem(hit));
  return hit.kind === 'object' ? { ...picked, rotation: hit.target.rotation } : picked;
};

// Finishes whatever is in progress the safe way: drops any drag, puts back anything held
export const settle = (s: State): State => ({ ...putBack(s), drag: null });

// A whole new world (new game or load): anything in progress is settled, then the world is swapped in.
// What points into the old map goes (selection, drag, pointer, guides, which may lie off a smaller map);
// the player's own settings stay (tool, tray, filters, wall view, grid, camera turn, clipboard, blueprints).
export const replaceWorld = (s: State, w: GameWorld): State => ({
  ...settle(s),
  size: w.size,
  objects: w.objects,
  tiles: w.tiles,
  terrain: withoutGround(w.ground, w.terrain),
  ground: w.ground,
  walls: w.walls,
  culverts: w.culverts,
  nextId: w.nextId,
  rotation: w.rotation,
  selection: null,
  drag: null,
  hover: null,
  point: null,
  guides: [],
});

// Switching tools never loses a held item
const switchTool = (s: State, tool: Tool): State => ({ ...putBack(s), tool, drag: null });

// Picking anything to build switches to the build tool
const select = (s: State, id: string): State => {
  const item = getItem(id);
  return s.selectedId === id && s.tool === 'build'
    ? s
    : { ...switchTool(s, 'build'), selectedId: id, group: item.group, category: categoryOf(item.group) };
};

// Changes in the targeted vertex or edge matter for wall and opening previews, not just the cell
const pointKey = (p: Point | null): string => {
  if (!p) return '';
  const v = nearestVertex(p);
  const n = nearestEdge(p);
  // wall faces are picked from the exact point, so small moves can change the target too
  return `${v.x},${v.y}|${edgeKey(n.edge)}|${n.dist <= EDGE_PICK}|${Math.round(p.x * 20)},${Math.round(p.y * 20)}`;
};

// Actions arrive in view space (what the player sees and points at), so the update runs there: turn the
// state into the view, update, turn the result back into the world. See view.ts.
export const update = (state: State, action: Action): State => {
  if (action.type === 'rotateView') return { ...state, view: turnView(state.view, action.dir), hover: null, point: null };
  if (state.view === 0) return updateInView(state, action);
  const before = toView(state);
  const after = updateInView(before, action);
  return after === before ? state : fromView(after, state.view);
};

const updateInView = (state: State, action: Action): State => {
  switch (action.type) {
    case 'hover': {
      const sameSpot = sameCell(state.hover, action.cell);
      if (sameSpot && pointKey(state.point) === pointKey(action.point)) return state;
      const next = { ...state, hover: action.cell, point: action.point };
      if (!action.cell || !state.drag) return next;
      const item = getItem(state.selectedId);
      // a road run follows the pointer along the road's direction only, staying in the row it started
      // in, and lays a piece on every cell it passes (cells with road already are skipped)
      if (state.drag.mode === 'run' && !sameSpot) {
        const start = state.drag.start;
        const alongX = state.rotation % 2 === 0;
        const onRow = (c: Cell): Cell => (alongX ? { x: c.x, y: start.y } : { x: start.x, y: c.y });
        const from = onRow(state.hover ?? start);
        const to = onRow(action.cell);
        if (sameCell(from, to)) return next;
        return cellsBetween(from, to).reduce((acc, c) => placeObjectAt(acc, c, true), next);
      }
      // a terrain stroke stamps the brush all the way from where it got to, so a quick drag leaves no gaps
      if (state.drag.mode === 'brush' && item.kind === 'terrain' && action.point) {
        const stroke = strokeCells(state.drag.last, action.point, state.brushSize);
        return { ...paintTerrain(next, stroke, item.id), drag: { mode: 'brush', last: action.point } };
      }
      // a painting drag fills every cell from the last one to this, so a quick drag leaves no gaps
      if (state.drag.mode === 'paint' && !sameSpot) {
        const lay = (acc: State, c: Cell): State =>
          item.kind === 'tile' ? paint(acc, c, item.id) : item.kind === 'object' ? placeObjectAt(acc, c) : acc;
        return cellsBetween(state.hover ?? action.cell, action.cell).reduce(lay, next);
      }
      return next;
    }

    case 'press': {
      if (state.tool === 'guide') return startGuide(state, action.point);
      if (state.tool === 'select') return selectPress(state, action.cell, action.point);
      // Picker: build what was clicked
      if (state.tool === 'picker') {
        const hit = eraseTarget(state, action.cell, action.point);
        return hit ? pickFrom(state, hit) : pickBareGround(state, action.cell);
      }
      // Removing things is the bulldoze tool's job only
      if (state.tool === 'bulldoze') {
        // Shift: clear the whole room at once; otherwise start a box (a click is a box of one)
        if (state.shiftHeld) return applyBulldoze(state, bulldozePlan(state));
        return { ...state, hover: action.cell, point: action.point, drag: { mode: 'erase', start: action.cell, point: action.point } };
      }
      const item = getItem(state.selectedId);
      switch (item.kind) {
        case 'object': {
          // a smart piece (a median) is laid by dragging, like a canal
          if (isSmart(item.id)) return { ...placeObjectAt(state, action.cell), drag: { mode: 'paint' } };
          // a road straight is laid by dragging along the road's direction
          if (isRun(item.id)) return { ...placeObjectAt(state, action.cell, true), hover: action.cell, drag: { mode: 'run', start: action.cell } };
          return placeObjectAt(state, action.cell);
        }
        case 'tile':
          if (state.shiftHeld) return applyFloorFill(state, floorFill(state), item.id);
          return { ...paint(state, action.cell, item.id), drag: { mode: 'paint' } };
        case 'terrain': {
          const at: State = { ...state, hover: action.cell, point: action.point };
          if (state.shiftHeld) return applyTerrainFill(at, terrainFill(at), item.id);
          return { ...paintTerrain(at, brushCells(action.point, state.brushSize), item.id), drag: { mode: 'brush', last: action.point } };
        }
        case 'culvert':
          return { ...state, point: action.point, drag: { mode: 'culvert', start: nearestEdge(action.point).edge } };
        case 'wall':
          return state.wallMode === 'square'
            ? { ...state, hover: action.cell, drag: { mode: 'square', start: action.cell } }
            : { ...state, point: action.point, drag: { mode: 'wall', start: nearestVertex(action.point) } };
        case 'opening': {
          const edge = edgeUnder(state, action.point).edge;
          if (item.pieces) return { ...state, point: action.point, drag: { mode: 'span', start: edge } };
          return canPlaceOpening(state, edge, true, item.id) ? placeOpenings(state, [edge], [item.id]) : state;
        }
        case 'paint': {
          if (state.shiftHeld) return applyPaint(state, paintPlan(state));
          // the side you point at is the side that gets painted, all along the drag
          const edge = edgeUnder(state, action.point).edge;
          return { ...state, point: action.point, drag: { mode: 'wallPaint', start: edge, side: paintSide(state, action.point) } };
        }
      }
    }

    case 'release': {
      if (!state.drag) return state;
      const done: State = { ...state, drag: null };
      if (state.drag.mode === 'erase') return applyBulldoze(done, bulldozePlan(state));
      if (state.drag.mode === 'box') return finishBox(state, state.drag);
      if (state.drag.mode === 'guide') return finishGuide(state, state.drag);
      if (state.drag.mode === 'span') {
        const plan = openingPlan(state);
        return planPlaceable(plan) ? placeOpenings(done, plan.edges, plan.ids) : done;
      }
      if (state.drag.mode === 'culvert') {
        const plan = culvertPlan(state);
        return plan?.valid ? placeCulvert(done, plan) : done;
      }
      if (state.drag.mode === 'wallPaint') return applyPaint(done, paintPlan(state));
      const item = getItem(state.selectedId);
      return item.kind === 'wall' && (state.drag.mode === 'wall' || state.drag.mode === 'square')
        ? placeWalls(done, wallDraft(state), item.id, state.drag.mode === 'wall')
        : done;
    }

    // Escape peels back one layer at a time: a drag, then building (straight back to select),
    // then the tray, then a held item, then any other tool
    case 'cancel':
      if (state.drag) return { ...state, drag: null };
      if (state.tool === 'build') return switchTool(state, 'select');
      if (state.trayOpen) return { ...state, trayOpen: false };
      if (state.selection) return putBack(state, false);
      return state.tool === 'select' ? state : switchTool(state, 'select');

    // Q in select mode: build more of whatever is under the pointer (the picker, without the tool)
    case 'pickHovered': {
      const holding = state.selection?.kind === 'group' || state.selection?.kind === 'opening';
      if (state.tool !== 'select' || holding || !state.hover) return state;
      const hit = eraseTarget(state, state.hover, state.point);
      return hit ? pickFrom(state, hit) : state;
    }

    case 'useSelect':
      return state.tool === 'select' ? state : { ...switchTool(state, 'select'), trayOpen: false };

    case 'togglePicker':
      return state.tool === 'picker' ? switchTool(state, 'select') : { ...switchTool(state, 'picker'), trayOpen: false };

    // Delete: held things are already out of the world, so just let go of them; marked things are removed
    case 'deleteSelection': {
      const sel = state.selection;
      if (!sel) return state;
      if (sel.kind !== 'marked') return { ...state, selection: null };
      return { ...without(state, piecesOf(sel.targets)), selection: null };
    }

    // Choosing the open category again closes its tray; another category opens its own.
    // Category buttons and tabs only browse: they open the tray and switch tabs without touching
    // the tool or the selected item. Picking an item from the tray is what starts building.
    case 'selectCategory':
      return state.category === action.category && !state.blueprintTray
        ? { ...state, trayOpen: !state.trayOpen }
        : { ...state, category: action.category, group: firstGroupOf(action.category), trayOpen: true, blueprintTray: false };

    // A tool button: it closes the tray, and clicking it again returns to the select tool
    case 'toggleBulldoze':
      return state.tool === 'bulldoze' ? switchTool(state, 'select') : { ...switchTool(state, 'bulldoze'), trayOpen: false };

    case 'cycleCategory': {
      const i = CATEGORIES.findIndex((c) => c.id === state.category);
      const next = CATEGORIES[(i + action.dir + CATEGORIES.length) % CATEGORIES.length];
      return next ? update(state, { type: 'selectCategory', category: next.id }) : state;
    }

    case 'selectGroup':
      return state.group === action.group
        ? state
        : { ...state, category: categoryOf(action.group), group: action.group, trayOpen: true };

    case 'cycleGroup': {
      const groups = groupsOf(state.category);
      const i = groups.findIndex((g) => g.id === state.group);
      const next = groups[(i + action.dir + groups.length) % groups.length];
      return next ? update(state, { type: 'selectGroup', group: next.id }) : state;
    }

    case 'select':
      return select(state, action.id);

    case 'selectIndex': {
      // with the blueprint tray open, the numbers on its cards place blueprints
      if (state.trayOpen && state.blueprintTray) {
        const b = state.blueprints[action.index];
        return b ? paste(state, b, b.name) : state;
      }
      const item = itemsIn(state.group)[action.index];
      return item ? select(state, item.id) : state;
    }

    // R turns what is held a quarter turn about where it was grabbed, or what is marked in place;
    // otherwise the next object to build
    case 'rotate': {
      const by = action.dir ?? 1;
      const sel = state.selection;
      if (sel?.kind === 'group') return { ...state, selection: { ...sel, turns: turn(sel.turns, by) } };
      if (sel?.kind === 'marked' && state.tool === 'select') return turnMarked(state, sel.targets, by);
      return { ...state, rotation: turn(state.rotation, by) };
    }

    // Ctrl + C copies what is marked and holds the copy at once, ready to place (#37): no separate paste.
    // While a group is held (being moved) it only keeps a copy, since one thing is held at a time.
    case 'copy': {
      const sel = state.selection;
      if (sel?.kind === 'marked') {
        const clipboard = copyOf(piecesOf(sel.targets), sel.targets);
        return paste({ ...state, clipboard }, clipboard);
      }
      if (sel?.kind === 'group') return { ...state, clipboard: copyOf(sel.pieces, []) };
      return state;
    }
    // Ctrl + X takes the marks out (one undo step) and holds them at once, so it picks them up to move
    case 'cut': {
      const sel = state.selection;
      if (sel?.kind !== 'marked') return state;
      const clipboard = copyOf(piecesOf(sel.targets), []);
      return paste({ ...without(state, piecesOf(sel.targets)), selection: null, clipboard }, clipboard);
    }
    // Ctrl + V holds the clipboard again, any time
    case 'paste':
      return paste(state, state.clipboard);

    // The Blueprints button opens their tray (or closes it if it is open); a category opens its own
    case 'toggleGuideTool':
      return state.tool === 'guide' ? switchTool(state, 'select') : { ...switchTool(state, 'guide'), trayOpen: false };
    case 'clearGuides':
      return state.guides.length === 0 ? state : { ...state, guides: [], drag: state.drag?.mode === 'guide' ? null : state.drag };

    case 'toggleBlueprints':
      return state.trayOpen && state.blueprintTray ? { ...state, trayOpen: false } : { ...state, trayOpen: true, blueprintTray: true };
    case 'saveBlueprint': {
      const sel = state.selection;
      // nothing marked yet: get ready to mark (the select tool, with the blueprint tray left open)
      if (sel?.kind !== 'marked' || sel.targets.length === 0) return state.tool === 'select' ? state : switchTool(state, 'select');
      return { ...state, blueprints: [...state.blueprints, blueprintOf(nextBlueprintId(state), freeName(state), piecesOf(sel.targets))] };
    }
    case 'renameBlueprint': {
      const name = action.name.trim().slice(0, 40);
      if (!name) return state;
      return { ...state, blueprints: state.blueprints.map((b) => (b.id === action.id ? { ...b, name } : b)) };
    }
    case 'deleteBlueprint':
      return { ...state, blueprints: state.blueprints.filter((b) => b.id !== action.id) };
    case 'placeBlueprint': {
      const b = state.blueprints.find((x) => x.id === action.id);
      return b ? paste(state, b, b.name) : state;
    }
    case 'loadBlueprints':
      return { ...state, blueprints: action.blueprints };

    case 'stepBrush': {
      const size = stepBrushSize(state.brushSize, action.step);
      return size === state.brushSize ? state : { ...state, brushSize: size };
    }

    case 'toggleSelectFilter':
      return { ...state, selectFilter: { ...state.selectFilter, [action.category]: !state.selectFilter[action.category] } };
    case 'toggleBulldozeFilter':
      return { ...state, bulldozeFilter: { ...state.bulldozeFilter, [action.category]: !state.bulldozeFilter[action.category] } };
    case 'setShift':
      return state.shiftHeld === action.held ? state : { ...state, shiftHeld: action.held };
    case 'setCtrl':
      return state.ctrlHeld === action.held ? state : { ...state, ctrlHeld: action.held };
    case 'rotateView':
      return state; // handled by update, outside view space
    case 'toggleGrid':
      return { ...state, showGrid: !state.showGrid };
    case 'setWallView':
      return state.wallView === action.view ? state : { ...state, wallView: action.view };

    case 'setWallMode':
      return state.wallMode === action.mode ? state : { ...state, wallMode: action.mode, drag: null };

    case 'toggleWallMode':
      return { ...state, wallMode: state.wallMode === 'line' ? 'square' : 'line', drag: null };

    case 'setLevel': {
      const level = Math.max(0, Math.min(LEVELS.length - 1, action.level));
      return level === state.level ? state : { ...putBack(state), level, drag: null };
    }
  }
};
