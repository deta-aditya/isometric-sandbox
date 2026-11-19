// Scene view: State -> Pixi drawing. Owns the Graphics layers, nothing else.
import { Container, Graphics } from 'pixi.js';
import { type Rotation, footprintOf, getItem, getTileDef, isFlat, isTerrain, getTerrainDef, occupiedCells } from '../catalog';
import { brushCells, brushCircle } from '../brush';
import { ROOF_T, WALL_H } from '../config';
import { type Size, sizeOf, toScreen } from '../geometry';
import { type Rect, nearestVertex } from '../geometry';
import {
  type State,
  buildPlan,
  objectCandidate,
  canPaint,
  canPlaceWall,
  bankOf,
  bulldozePlan,
  culvertPlan,
  culvertRun,
  floorFill,
  paintPlan,
  tileAt,
  eraseTarget,
  ghostPlacement,
  openingPlan,
  openingRun,
  pickTarget,
  squareDraft,
  wallDraft,
  type EraseTarget,
  boxArea,
  boxTargets,
  heldPlan,
  type Pieces,
  piecesBounds,
  terrainFill,
  cellInBounds,
} from '../world';
import { createTerrainLayer } from './terrainLayer';
import { drawCanalOpening, drawCanalSunk, drawCanalTop, drawJointTops, drawStreamCulverts, waterLayers } from './water';
import { drawObject } from './draw';
import { createGuides } from './guides';
import { type Drawable, HOVER_COLOR, SELECTED_COLOR, type ScreenWindow, buildDrawables, culvertEnds, gridAlpha, inWindow, waterLookup, waterSides } from './drawables';
import { GRASS, poly, quad, drawBox, drawCulvertBank, drawEdgeStrip, drawFootprint, drawGridLines, drawGround, drawTile, drawVertex, drawWall, drawWash, drawWaterTile, shade } from './shapes';

const VALID = 0x4ade80;
const INVALID = 0xef4444;
const ROOF_COLOR = 0x475569;

// A thin strip on the floor along one side of a wall
const sideStrip = (e: Readonly<{ axis: 'x' | 'y'; x: number; y: number }>, side: 'before' | 'after'): Rect => {
  const [gap, depth] = [0.05, 0.14];
  const off = side === 'before' ? -(gap + depth) : gap;
  return e.axis === 'x' ? { x: e.x, y: e.y + off, w: 1, h: depth } : { x: e.x + off, y: e.y, w: depth, h: 1 };
};

const drawDrawable = (g: Graphics, d: Drawable): void => {
  switch (d.kind) {
    case 'object':
      return drawObject(g, d);
    case 'wall':
      return drawWall(g, d);
    case 'roof':
      return drawBox(g, d, WALL_H, ROOF_T, ROOF_COLOR, 1);
    case 'canopy':
      return drawBox(g, d, WALL_H, 3, d.color, d.alpha);
  }
};

// Floors, water and culverts
// Floors and paths (water is drawn sunken by its own layers: the canal in water.ts, the stream in the
// ground picture)
const drawFloorsInto = (g: Graphics, state: State, lines: number, win: ScreenWindow | null = null): void => {
  state.tiles.forEach((t) => {
    if (!inWindow(win, { x: t.x, y: t.y, w: 1, h: 1 }, 0)) return;
    const { color, bank } = getTileDef(t.defId);
    if (bank === undefined) drawTile(g, t.x, t.y, color, shade(color, 0.85), lines);
  });
};

// A set of pieces drawn on their own on a patch of grass, as the game would show them (for blueprint cards)
const PREVIEW_GRASS = 0x4b8f55;
export const drawPiecesPreview = (g: Graphics, base: State, p: Pieces): Container => {
  const box = piecesBounds(p);
  // the card's own small map, just big enough for its pieces, on the card's lighter grass
  const size = sizeOf(Math.max(1, box.x + box.w), Math.max(1, box.y + box.h));
  const state: State = { ...base, size, objects: p.objects, walls: p.walls, tiles: p.tiles, culverts: p.culverts, terrain: p.terrain, selection: null, drag: null, hover: null, point: null, tool: 'select', level: 0 };
  for (let x = box.x; x < box.x + box.w; x++) for (let y = box.y; y < box.y + box.h; y++) drawTile(g, x, y, PREVIEW_GRASS, shade(PREVIEW_GRASS, 0.85));
  // terrain on a card is flat tiles in its color (the soft blend needs the full renderer)
  p.terrain.forEach((t) => drawTile(g, t.x, t.y, getTerrainDef(t.defId).color, shade(getTerrainDef(t.defId).color, 0.85)));
  // in the game's order: water (the stream's ground picture blends the terrain in), then floors, then
  // what stands
  const water = waterLayers(state, PREVIEW_GRASS);
  const floorsG = new Graphics();
  drawFloorsInto(floorsG, state, 1);
  const things = new Graphics();
  const { sorted, flats } = buildDrawables(state);
  flats.forEach((d) => drawObject(things, d)); // roads and bays first, on the ground
  sorted.forEach((d) => drawDrawable(things, d));
  const out = new Container();
  out.addChild(water, floorsG, things);
  return out;
};

export const createScene = (world: Container) => {
  const ground = new Graphics();
  const gridLines = new Graphics();
  const floors = new Graphics();
  const flats = new Graphics(); // flat ground pieces: roads, parking and loading bays
  const overlay = new Graphics();
  const solids = new Graphics();
  // guides lie on the ground (walls and furniture stand in front of them); rulers sit outside the map, on top
  const guides = new Container();
  // terrain lies on the grass, under the grid lines and floors
  const terrain = createTerrainLayer((id) => (isTerrain(id) ? getTerrainDef(id) : null));
  // the canal: what lies below ground is seen only through its opening (a mask), coping on top
  const canalSunk = new Graphics();
  const canalBox = new Container();
  const canalMask = new Graphics();
  const canalTop = new Graphics();
  canalBox.addChild(canalSunk);
  canalBox.mask = canalMask;
  // grid lines stop at stream tiles (the canal covers them; its layers are above the grid)
  const streamMask = new Graphics();
  gridLines.setMask({ mask: streamMask, inverse: true });
  world.addChild(ground, terrain.container, gridLines, streamMask, canalBox, canalMask, canalTop, floors, flats, guides, overlay, solids);
  let canalDrawn: Readonly<{ tiles: State['tiles']; culverts: State['culverts']; win: ScreenWindow | null }> | null = null;
  const drawCanal = (state: State, win: ScreenWindow | null): void => {
    const c = canalDrawn;
    if (c && c.tiles === state.tiles && c.culverts === state.culverts && c.win === win) return;
    canalDrawn = { tiles: state.tiles, culverts: state.culverts, win };
    [canalSunk, canalMask, canalTop, streamMask].forEach((g) => g.clear());
    state.tiles.forEach((t) => {
      if (t.defId === 'stream' && inWindow(win, { x: t.x, y: t.y, w: 1, h: 1 }, 0)) poly(streamMask, quad({ x: t.x, y: t.y, w: 1, h: 1 }, 0), 0xffffff, 1);
    });
    // an empty mask would hide nothing anyway; keep one tiny shape off the map so the mask is valid
    if (streamMask.bounds.width === 0) poly(streamMask, quad({ x: -9, y: -9, w: 0.01, h: 0.01 }, 0), 0xffffff, 1);
    drawCanalSunk(canalSunk, state, win);
    drawCanalOpening(canalMask, state, win);
    drawCanalTop(canalTop, state, win);
    drawJointTops(canalTop, state, win);
    drawStreamCulverts(canalTop, state, win);
  };
  const guideLines = createGuides(guides);

  // Ground and grid lines are one fill and long lines, redrawn only when the frame's size changes
  // (a new game or load, or turning a non-square map)
  // (and the fill takes the map's ground color)
  let groundDrawn: Readonly<{ size: Size; color: number }> | null = null;
  const drawGroundFor = (size: Size, groundId: string): void => {
    const color = isTerrain(groundId) ? getTerrainDef(groundId).color : GRASS;
    if (groundDrawn && groundDrawn.size === size && groundDrawn.color === color) return;
    groundDrawn = { size, color };
    ground.clear();
    gridLines.clear();
    drawGround(ground, size.w, size.h, color);
    drawGridLines(gridLines, size.w, size.h);
  };

  // Floors change far less often than the pointer moves: redrawn only when what they show changes
  let floorsDrawn: Readonly<{ tiles: State['tiles']; culverts: State['culverts']; lines: number; win: ScreenWindow | null }> | null = null;
  const drawFloors = (state: State, win: ScreenWindow | null): void => {
    const lines = gridAlpha(state); // painted floors outline their tiles only while the grid shows
    const f = floorsDrawn;
    if (f && f.tiles === state.tiles && f.culverts === state.culverts && f.lines === lines && f.win === win) return;
    floorsDrawn = { tiles: state.tiles, culverts: state.culverts, lines, win };
    floors.clear();
    drawFloorsInto(floors, state, lines, win);
  };

  // An object's footprint, or for a flat piece (a road curve) just the cells it stands on
  const drawObjectFootprint = (o: Rect & Readonly<{ defId: string; rotation: Rotation }>, color: number, fillAlpha?: number): void =>
    isFlat(o.defId)
      ? occupiedCells(o).forEach((c) => drawFootprint(overlay, { ...c, w: 1, h: 1 }, color, fillAlpha))
      : drawFootprint(overlay, o, color, fillAlpha);

  // Bulldoze: outline what a click here would remove (walls are also tinted red in the scene)
  // Everything the bulldoze plan would remove, over a faint box or room so its reach is clear
  const drawBulldozeTarget = (state: State, cell: Rect): void => {
    const plan = bulldozePlan(state);
    if (!plan) return;
    // the box keeps its outline so its edge is clear; a room is just washed, its walls show the edge
    if (plan.area) drawFootprint(overlay, plan.area, INVALID, 0.1);
    plan.room?.forEach((c) => drawWash(overlay, { ...c, w: 1, h: 1 }, INVALID, 0.12));
    if (plan.targets.length === 0 && !plan.area && !plan.room) drawFootprint(overlay, cell, INVALID, 0.08);
    plan.targets.forEach((t) => {
      switch (t.kind) {
        case 'object':
          return drawObjectFootprint(t.target, INVALID, 0.45);
        case 'tile':
        case 'terrain':
          return drawFootprint(overlay, { ...t.target, w: 1, h: 1 }, INVALID, 0.45);
        case 'culvert':
          return culvertRun(state, t.target).forEach((e) => drawEdgeStrip(overlay, e, INVALID));
        case 'wall':
          return drawEdgeStrip(overlay, t.target, INVALID);
        case 'opening':
          return openingRun(state, t.target).forEach((w) => drawEdgeStrip(overlay, w, INVALID));
      }
    });
  };

  // Strips under every wall segment an opening (or a whole span) would land on
  const drawOpeningPlan = (state: State): void => {
    const plan = openingPlan(state);
    plan?.edges.forEach((e) => drawEdgeStrip(overlay, e, plan.valid ? VALID : INVALID));
  };

  // Select: a held item shows where it would land; empty hands show what a click would pick up
  const drawSelectOverlay = (state: State): void => {
    const sel = state.selection;
    if (sel?.kind === 'marked') drawMarks(state, sel.targets);
    // a box being dragged: its outline, and what letting go would mark
    const area = boxArea(state);
    if (area) {
      drawFootprint(overlay, area, SELECTED_COLOR, 0.1);
      drawMarks(state, boxTargets(state));
    }
    // a held group: floors in their own color, footprints and strips in green or red
    const held = heldPlan(state);
    if (held) {
      const color = held.valid ? VALID : INVALID;
      held.ghost.tiles.forEach((t) => drawFootprint(overlay, { x: t.x, y: t.y, w: 1, h: 1 }, getTileDef(t.defId).color, 0.55));
      held.ghost.objects.forEach((o) => drawObjectFootprint(o, color));
      [...held.ghost.walls, ...held.ghost.culverts].forEach((e) => drawEdgeStrip(overlay, e, color));
      return;
    }
    if (sel?.kind === 'opening') return drawOpeningPlan(state);
    if (state.drag?.mode === 'box') return;
    if (sel?.kind === 'marked' && !state.shiftHeld) return; // a click lifts the marks, whatever is under it
    const hit = state.hover ? pickTarget(state, state.hover, state.point) : null;
    if (hit?.kind === 'object') drawObjectFootprint(hit.target, HOVER_COLOR, 0.3);
    if (hit?.kind === 'wall') drawEdgeStrip(overlay, hit.target, HOVER_COLOR);
    if (hit?.kind === 'opening') openingRun(state, hit.target).forEach((w) => drawEdgeStrip(overlay, w, HOVER_COLOR));
    if (hit?.kind === 'terrain') drawFootprint(overlay, { ...hit.target, w: 1, h: 1 }, HOVER_COLOR, 0.2);
  };

  // Marked things (or what a box would mark) outlined in the selection color
  const drawMarks = (state: State, targets: readonly EraseTarget[]): void =>
    targets.forEach((t) => {
      switch (t.kind) {
        case 'object':
          return drawObjectFootprint(t.target, SELECTED_COLOR, 0.35);
        case 'tile':
        case 'terrain':
          return drawFootprint(overlay, { ...t.target, w: 1, h: 1 }, SELECTED_COLOR, 0.35);
        case 'culvert':
        case 'wall':
        case 'opening':
          return drawEdgeStrip(overlay, t.target, SELECTED_COLOR);
      }
    });

  // Picker: outline what a click would copy
  const drawPickerOverlay = (state: State): void => {
    const hit = state.hover ? eraseTarget(state, state.hover, state.point) : null;
    switch (hit?.kind) {
      case 'object':
        return drawObjectFootprint(hit.target, HOVER_COLOR, 0.3);
      case 'tile':
      case 'terrain':
        return drawFootprint(overlay, { ...hit.target, w: 1, h: 1 }, HOVER_COLOR, 0.3);
      case 'wall':
        return drawEdgeStrip(overlay, hit.target, HOVER_COLOR);
      case 'opening':
        return openingRun(state, hit.target).forEach((w) => drawEdgeStrip(overlay, w, HOVER_COLOR));
      case 'culvert':
        return culvertRun(state, hit.target).forEach((e) => drawEdgeStrip(overlay, e, HOVER_COLOR));
    }
  };

  const drawOverlay = (state: State, ghostValid: boolean): void => {
    overlay.clear();
    if (state.tool === 'select') return drawSelectOverlay(state);
    if (state.tool === 'picker') return drawPickerOverlay(state);
    if (state.tool === 'guide') return; // the guide lines draw their own highlight
    if (!state.hover) return;
    const cell = { ...state.hover, w: 1, h: 1 };
    if (state.tool === 'bulldoze') return drawBulldozeTarget(state, cell);

    const item = getItem(state.selectedId);
    switch (item.kind) {
      case 'object':
      {
        const p = objectCandidate(state, state.hover);
        if (!p) return;
        // road pieces this one would replace light up red first, like the bulldoze's preview
        // (the ghost is then only outlined, so the red shows through it)
        const replaced = ghostValid ? buildPlan(state, p).replaced : [];
        replaced.forEach((o) => drawObjectFootprint(o, INVALID, 0.45));
        return drawObjectFootprint(p, ghostValid ? VALID : INVALID, replaced.length > 0 ? 0.04 : undefined);
      }
      case 'tile': {
        // Shift: every tile the fill reaches, in the floor's color
        const fill = floorFill(state);
        if (fill) return fill.cells.forEach((c) => drawFootprint(overlay, { ...c, w: 1, h: 1 }, item.color, 0.7));
        return canPaint(state, state.hover)
          ? drawFootprint(overlay, cell, item.color, 0.7)
          : drawFootprint(overlay, cell, INVALID);
      }
      case 'terrain': {
        // Shift: every tile the fill reaches, in the terrain's color
        const fill = terrainFill(state);
        if (fill) return fill.cells.forEach((c) => drawFootprint(overlay, { ...c, w: 1, h: 1 }, item.color, 0.6));
        if (!state.point) return;
        // the brush: a light wash on the tiles it paints, and its circle on the ground
        brushCells(state.point, state.brushSize)
          .filter((c) => cellInBounds(state.size, c))
          .forEach((c) => drawWash(overlay, { ...c, w: 1, h: 1 }, item.color, 0.35));
        const { center, radius } = brushCircle(state.point, state.brushSize);
        const ring = Array.from({ length: 49 }, (_, i) => {
          const a = (i / 48) * Math.PI * 2;
          const s = toScreen(center.x + radius * Math.cos(a), center.y + radius * Math.sin(a));
          return [s.sx, s.sy];
        }).flat();
        overlay.poly(ring, false).stroke({ width: 3, color: 0x000000, alpha: 0.25 });
        overlay.poly(ring, false).stroke({ width: 1.5, color: 0xffffff, alpha: 0.9 });
        return;
      }
      case 'culvert': {
        const plan = culvertPlan(state);
        return plan?.edges.forEach((e) => drawEdgeStrip(overlay, e, plan.valid ? VALID : INVALID));
      }
      case 'paint': {
        // A strip on the floor along the side being painted, in the paint's color
        const plan = paintPlan(state);
        const color = item.color ?? 0xe7e5e4;
        return plan?.targets.forEach((t) => drawFootprint(overlay, sideStrip(t.wall, t.side), color, 0.85));
      }
      case 'wall': {
        if (state.wallMode === 'square') {
          const square = squareDraft(state);
          if (!square) return drawFootprint(overlay, cell, 0xffffff, 0.2);
          drawFootprint(overlay, square, 0xffffff, 0.12);
        } else if (!state.drag) {
          const v = state.point ? nearestVertex(state.point) : null;
          return v ? drawVertex(overlay, v.x, v.y, 0xffffff) : undefined;
        }
        return wallDraft(state).forEach((e) => drawEdgeStrip(overlay, e, canPlaceWall(state, e) ? VALID : INVALID));
      }
      case 'opening':
        return drawOpeningPlan(state);
    }
  };

  // win: the part of the world to draw (null draws all of it)
  const render = (state: State, win: ScreenWindow | null = null): void => {
    drawGroundFor(state.size, state.ground);
    terrain.render(state, win);
    drawCanal(state, win);
    const { sorted, ghostsOnTop, ghostValid, flats: flatPieces } = buildDrawables(state, win);
    gridLines.alpha = gridAlpha(state);
    gridLines.visible = gridLines.alpha > 0;
    drawFloors(state, win);
    flats.clear();
    flatPieces.forEach((d) => drawObject(flats, d));
    drawOverlay(state, ghostValid);
    solids.clear();
    sorted.forEach((d) => drawDrawable(solids, d));
    ghostsOnTop.forEach((g) => drawObject(solids, g));
    guideLines.render(state);
  };

  return { render };
};
