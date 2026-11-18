// Pure: turns State into a depth-sorted list of things to draw, with previews merged in.
import { type FenceLook, type GlassLook, getItem, getOpeningDef, getPaint, getObjectDef, getTileDef, getWallStyle, isFlat, isPole, isSmart, isWaterTile, layerOf, occupiedCells } from '../catalog';
import { CUT_WALL_H, WALL_H } from '../config';
import { depthSort } from '../depthSort';
import { type Cell, type Edge, type Rect, cellKey, cellsOf, edgeKey, edgeRect } from '../geometry';
import type { WallPiece } from './shapes';
import {
  type ObjectPlacement,
  type State,
  type WallSegment,
  buildPlan,
  canPlaceWall,
  eraseTarget,
  ghostPlacement,
  canopyCells,
  interiorCells,
  isRoofView,
  openingPlan,
  openingRun,
  planPlaceable,
  pickTarget,
  wallAt,
  wallDraft,
  bulldozePlan,
  boxTargets,
  heldPlan,
  NO_PAINT,
  paintPlan,
  storedPaint,
  wallHeight,
} from '../world';

export type ObjectDrawable = ObjectPlacement & Readonly<{ kind: 'object'; alpha: number; joins?: readonly [boolean, boolean, boolean, boolean]; paved?: boolean }>;
export type WallDrawable = Rect & WallPiece & Readonly<{ kind: 'wall' }>; // zero-thickness rect for sorting
export type RoofDrawable = Rect & Readonly<{ kind: 'roof' }>;
export type CanopyDrawable = Rect & Readonly<{ kind: 'canopy'; color: number; alpha: number }>;
export type Drawable = ObjectDrawable | WallDrawable | RoofDrawable | CanopyDrawable;

const ERASE_COLOR = 0xf87171;
export const HOVER_COLOR = 0x93c5fd; // select tool: what a click would pick up
export const SELECTED_COLOR = 0x3b82f6; // select tool: marked things

// The cell a wall hides from the camera: the one on its far side
const behind = (e: Edge): Cell => (e.axis === 'x' ? { x: e.x, y: e.y - 1 } : { x: e.x - 1, y: e.y });

// How each wall should look this frame (preview tweaks layered on top of the real walls)
type WallLook = Readonly<{ wall: WallSegment; alpha: number; color?: number }>;

const wallLooks = (state: State): ReadonlyMap<string, WallLook> => {
  const looks = new Map<string, WallLook>(state.walls.map((w) => [edgeKey(w), { wall: w, alpha: 1 }]));
  const tint = (wall: WallSegment, color: number) => looks.set(edgeKey(wall), { wall, alpha: 1, color });
  // A span is one item, so it highlights as one: every segment of the run
  const tintRun = (wall: WallSegment, color: number) => openingRun(state, wall).forEach((w) => tint(w, color));
  const item = getItem(state.selectedId);

  if (state.tool === 'bulldoze') {
    bulldozePlan(state)?.targets.forEach((t) => {
      if (t.kind === 'wall') tint(t.target, ERASE_COLOR);
      if (t.kind === 'opening') tintRun(t.target, ERASE_COLOR);
    });
    return looks;
  }

  if (state.tool === 'picker') {
    const hit = state.hover ? eraseTarget(state, state.hover, state.point) : null;
    if (hit?.kind === 'wall') tint(hit.target, HOVER_COLOR);
    if (hit?.kind === 'opening') tintRun(hit.target, HOVER_COLOR);
    return looks;
  }

  if (state.tool === 'select') {
    const sel = state.selection;
    // Hovering with empty hands shows what a click would pick up
    // (with things marked a click lifts them, so only Shift, which adds or removes one, shows a hover)
    if ((!sel || (sel.kind === 'marked' && state.shiftHeld)) && state.drag?.mode !== 'box') {
      const hit = state.hover ? pickTarget(state, state.hover, state.point) : null;
      if (hit?.kind === 'wall') tint(hit.target, HOVER_COLOR);
      if (hit?.kind === 'opening') tintRun(hit.target, HOVER_COLOR);
    }
    // Marked walls, and walls a box being dragged would mark
    const marks = [...(sel?.kind === 'marked' ? sel.targets : []), ...boxTargets(state)];
    marks.forEach((t) => (t.kind === 'wall' || t.kind === 'opening') && tint(t.target, SELECTED_COLOR));
    // A held group's walls stand where they would land, see-through
    const held = heldPlan(state);
    held?.ghost.walls.forEach((w) => {
      if (!looks.has(edgeKey(w))) looks.set(edgeKey(w), { wall: w, alpha: held.valid ? 0.6 : 0.35 });
    });
  }

  // Paint preview: the side facing the camera (after) shows the new color on the wall itself;
  // the hidden side is marked by a strip on the floor next to it (drawn in the scene overlay)
  const paint = paintPlan(state);
  paint?.targets
    .filter((t) => t.side === 'after')
    .forEach(({ wall }) => tint(wall, faceColor({ ...wall, paint: { ...wall.paint, after: storedPaint(paint.paintId) } })));

  if (state.tool === 'build' && item.kind === 'wall') {
    // Ghost walls for the run or room being dragged (they take the new style, keeping any opening)
    wallDraft(state)
      .filter((e) => canPlaceWall(state, e))
      .forEach((e) => {
        const existing = looks.get(edgeKey(e))?.wall;
        looks.set(edgeKey(e), { wall: { ...e, styleId: item.id, opening: existing?.opening ?? null, paint: existing?.paint ?? NO_PAINT }, alpha: 0.6 });
      });
  }

  // Openings being built or moved show in place on the walls they would land on
  const plan = openingPlan(state);
  if (planPlaceable(plan))
    plan.edges.forEach((e, i) => {
      const wall = wallAt(state, e);
      if (wall) looks.set(edgeKey(wall), { wall: { ...wall, opening: plan.ids[i] ?? null }, alpha: 1 });
    });
  return looks;
};

// The color of the face the camera sees: its paint, or the material where it has none.
// Today that is the after side (south or east); camera rotation (#20) will pick the side per view.
// On glass, paint is a tint: the pane takes most of the paint's color but keeps a little of the glass,
// and stays see-through (white reads frosted, charcoal smoked).
export const faceColor = (wall: WallSegment): number => {
  const style = getWallStyle(wall.styleId);
  const paint = wall.paint.after ? getPaint(wall.paint.after).color : null;
  if (paint === null) return style.color;
  return style.glass ? mix(style.color, paint, GLASS_TINT) : paint;
};
const GLASS_TINT = 0.75;
const TINTED_ALPHA = 0.6; // clear glass is 0.35; a tinted pane is a little denser so its color reads

// A pane drawn in any color but the glass's own (a paint, or a preview) is tinted
const glassLook = (styleId: string, color: number): GlassLook | undefined => {
  const style = getWallStyle(styleId);
  return style.glass && color !== style.color ? { ...style.glass, alpha: Math.max(style.glass.alpha, TINTED_ALPHA) } : style.glass;
};

// Blend two colors channel by channel: t = 0 is a, t = 1 is b
const mix = (a: number, b: number, t: number): number =>
  [16, 8, 0].reduce((c, sh) => c | (Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t) << sh), 0);

const CANOPY_COLOR = getWallStyle('pole').pole?.canopy ?? 0x7aa2c7;

// Pole walls get a post every 2 tiles along a straight run, and always at a run's ends and wherever
// another wall meets them. A post where two segments of a run meet is drawn by the later one only.
const polePosts = (wall: WallSegment, walls: ReadonlyMap<string, WallSegment>, ends: ReadonlyMap<string, number>): readonly [boolean, boolean] => {
  const step = wall.axis === 'x' ? { x: 1, y: 0 } : { x: 0, y: 1 };
  const prev = walls.get(edgeKey({ ...wall, x: wall.x - step.x, y: wall.y - step.y }));
  const next = walls.get(edgeKey({ ...wall, x: wall.x + step.x, y: wall.y + step.y }));
  const isRun = (w: WallSegment | undefined) => w !== undefined && isPole(w.styleId);
  const v0 = { x: wall.x, y: wall.y };
  const v1 = { x: wall.x + step.x, y: wall.y + step.y };
  // walls meeting at a vertex beyond the run itself: a corner or a junction
  const junction = (v: Cell, run: number) => (ends.get(cellKey(v)) ?? 0) > run;
  const along = wall.axis === 'x' ? wall.x : wall.y;
  const runAt0 = isRun(prev) ? 2 : 1;
  const runAt1 = isRun(next) ? 2 : 1;
  return [!isRun(prev) || along % 2 === 0 || junction(v0, runAt0), !isRun(next) || junction(v1, runAt1)];
};

// A tint (bulldoze, hover, ghost) recolors the whole fence, posts included
const fenceLook = (styleId: string, tint: number | undefined): FenceLook | undefined => {
  const look = getWallStyle(styleId).fence;
  return look && tint !== undefined && look.post !== null ? { ...look, post: tint } : look;
};

// How strongly grid lines show. Hidden grids still show faintly while building or bulldozing,
// so placement stays easy to line up; in select and picker they are fully gone.
export const gridAlpha = (state: State): number =>
  state.showGrid ? 1 : state.tool === 'build' || state.tool === 'bulldoze' || state.tool === 'guide' ? 0.3 : 0;

// A wall drawn low lets you see the floor on its far side
export const isCutLow = (state: State, wall: WallSegment): boolean => wallHeight(state, wall) < WALL_H;

export const buildDrawables = (state: State) => {
  const roof = isRoofView(state);
  const interior = interiorCells(state.walls, state.size);
  const inside = (c: Cell) => interior.has(cellKey(c));
  const heightOf = (wall: WallSegment): number => wallHeight(state, wall);
  // for pole posts: walls by edge, and how many walls end at each vertex
  const byEdge = new Map(state.walls.map((w) => [edgeKey(w), w]));
  const ends = new Map<string, number>();
  state.walls.forEach((w) => {
    const far = w.axis === 'x' ? { x: w.x + 1, y: w.y } : { x: w.x, y: w.y + 1 };
    [cellKey(w), cellKey(far)].forEach((k) => ends.set(k, (ends.get(k) ?? 0) + 1));
  });

  const walls: readonly WallDrawable[] = [...wallLooks(state).values()].map(({ wall, alpha, color }) => ({
    kind: 'wall',
    ...edgeRect(wall),
    axis: wall.axis,
    height: heightOf(wall),
    color: color ?? faceColor(wall),
    opening: wall.opening ? getOpeningDef(wall.opening) : null,
    alpha,
    fence: fenceLook(wall.styleId, color),
    tint: color,
    glass: glassLook(wall.styleId, color ?? faceColor(wall)),
    ...(isPole(wall.styleId) ? { pole: { look: getWallStyle(wall.styleId).pole!, posts: polePosts(wall, byEdge, ends) } } : {}),
  }));

  // Canopies over rooms with pole walls, on every floor; in the roof view they stand in for the roof.
  // The room under the pointer fades, so you can see what you are placing under it.
  const covered = canopyCells(state.walls, state.size);
  const under = state.hover ? covered.get(cellKey(state.hover)) : undefined;
  const canopies: readonly CanopyDrawable[] = [...covered].map(([key, room]) => {
    const [x = 0, y = 0] = key.split(',').map(Number);
    return { kind: 'canopy', x, y, w: 1, h: 1, color: CANOPY_COLOR, alpha: room === under ? 0.3 : 1 };
  });
  const roofs: readonly RoofDrawable[] = roof
    ? cellsOf({ x: 0, y: 0, w: state.size.w, h: state.size.h })
        .filter((c) => inside(c) && !covered.has(cellKey(c)))
        .map((c) => ({ kind: 'roof', x: c.x, y: c.y, w: 1, h: 1 }))
    : [];

  const placed: readonly ObjectDrawable[] = state.objects
    .filter((o) => !roof || !occupiedCells(o).some(inside)) // objects in enclosed rooms are under the roof
    .map((o) => ({ ...o, kind: 'object', alpha: 1 }));
  // flat ground pieces (roads, bays) lie under everything that stands, so they skip the depth sort
  const objects = placed.filter((o) => !isFlat(o.defId));

  // Ghost objects: a new one being built, or the objects of a held group
  const held = heldPlan(state);
  const candidate = ghostPlacement(state);
  const valid = held ? held.valid : candidate !== null && buildPlan(state, candidate).ok;
  const ghostAlpha = valid ? 0.55 : 0.35;
  const allGhosts: readonly ObjectDrawable[] = held
    ? held.ghost.objects.map((o) => ({ ...o, kind: 'object', alpha: ghostAlpha }))
    : candidate ? [{ ...candidate, kind: 'object', alpha: ghostAlpha }] : [];
  const ghosts = allGhosts.filter((o) => !isFlat(o.defId));
  // roads first, then the markings painted on them; a ghost goes on top of its own layer. A smart
  // piece (a median) learns which sides meet one of its kind, ghosts included, so a drag joins up live.
  const smartAt = new Set([...placed, ...allGhosts].filter((o) => isSmart(o.defId)).map((o) => `${o.defId}@${cellKey(o)}`));
  // cells under a crosswalk, where a median shows a paved refuge (its outline stays as its neighbors make it)
  const refuges = new Set([...placed, ...allGhosts].filter((o) => getObjectDef(o.defId).refuge).flatMap((o) => occupiedCells(o).map(cellKey)));
  const withJoins = (o: ObjectDrawable): ObjectDrawable => {
    if (!isSmart(o.defId)) return o;
    const has = (dx: number, dy: number) => smartAt.has(`${o.defId}@${cellKey({ x: o.x + dx, y: o.y + dy })}`);
    return { ...o, joins: [has(0, -1), has(1, 0), has(0, 1), has(-1, 0)], paved: refuges.has(cellKey(o)) };
  };
  const flats = (['road', 'marking', 'median'] as const).flatMap((layer) =>
    [...placed, ...allGhosts].filter((o) => layerOf(o.defId) === layer).map(withJoins));

  // Valid ghosts join the sort; invalid ones may overlap others, so they are drawn on top
  // canopies come after objects, so on a shared cell the canopy is drawn over what stands under it
  const sorted = depthSort<Drawable>([...walls, ...roofs, ...objects, ...(valid ? ghosts : []), ...canopies]);
  return { sorted, ghostsOnTop: valid ? [] : ghosts, ghostValid: valid, flats };
};

// ===== Water =====
// A water tile joins up with neighboring water and shows a bank on each side that faces land.
// Corners matter too: where both neighbors are water but the diagonal is land, a small bank post fills the gap.
export type WaterSides = Readonly<{
  west: boolean; north: boolean; east: boolean; south: boolean;
  nw: boolean; ne: boolean; se: boolean; sw: boolean;
}>;

export const isWater = isWaterTile;

type TileAt = (x: number, y: number) => boolean;
const tileLookup = (tiles: readonly { x: number; y: number; defId: string }[], keep: (defId: string) => boolean): TileAt => {
  const hit = new Set(tiles.filter((t) => keep(t.defId)).map((t) => `${t.x},${t.y}`));
  return (x, y) => hit.has(`${x},${y}`);
};

export const waterLookup = (tiles: readonly { x: number; y: number; defId: string }[]): TileAt => tileLookup(tiles, isWater);

// A culvert on a bank closes in at a V at each end where the canal's side bank meets it
// (for a culvert across a wide canal, only the outer ends do)
export type CulvertEnds = Readonly<{ start: boolean; end: boolean }>;
export const culvertEnds = (wet: TileAt, x: number, y: number, side: 'west' | 'north' | 'east' | 'south'): CulvertEnds =>
  side === 'west' || side === 'east' ? { start: !wet(x, y - 1), end: !wet(x, y + 1) } : { start: !wet(x - 1, y), end: !wet(x + 1, y) };

export const waterSides = (wet: (x: number, y: number) => boolean, x: number, y: number): WaterSides => {
  const [w, n, e, s] = [!wet(x - 1, y), !wet(x, y - 1), !wet(x + 1, y), !wet(x, y + 1)];
  return {
    west: w, north: n, east: e, south: s,
    nw: !w && !n && !wet(x - 1, y - 1),
    ne: !e && !n && !wet(x + 1, y - 1),
    se: !e && !s && !wet(x + 1, y + 1),
    sw: !w && !s && !wet(x - 1, y + 1),
  };
};
