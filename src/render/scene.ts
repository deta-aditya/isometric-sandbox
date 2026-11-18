// Scene view: State -> Pixi drawing. Owns the Graphics layers, nothing else.
import { Container, Graphics } from 'pixi.js';
import { type Rotation, footprintOf, getItem, getTileDef, isFlat, occupiedCells } from '../catalog';
import { GRID_H, GRID_W, ROOF_T, WALL_H } from '../config';
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
} from '../world';
import { drawObject } from './draw';
import { createGuides } from './guides';
import { type Drawable, HOVER_COLOR, SELECTED_COLOR, buildDrawables, culvertEnds, gridAlpha, waterLookup, waterSides } from './drawables';
import { drawBox, drawCulvertBank, drawEdgeStrip, drawFootprint, drawGridLines, drawGround, drawTile, drawVertex, drawWall, drawWash, drawWaterTile, shade } from './shapes';

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
const drawFloorsInto = (g: Graphics, state: State, lines: number): void => {
  const wet = waterLookup(state.tiles);
  state.tiles.forEach((t) => {
    const { color, bank } = getTileDef(t.defId);
    if (bank !== undefined) drawWaterTile(g, t.x, t.y, color, bank, waterSides(wet, t.x, t.y));
    else drawTile(g, t.x, t.y, color, shade(color, 0.85), lines);
  });
  // Culverts go on top of the water they belong to (one whose water was painted over just isn't shown)
  state.culverts.forEach((e) => {
    const b = bankOf(state, e);
    const water = b && tileAt(state, b.cell);
    if (!b || !water) return;
    const { x, y } = b.cell;
    drawCulvertBank(g, x, y, b.side, getTileDef(water.defId).bank ?? 0, culvertEnds(wet, x, y, b.side));
  });
};

// A set of pieces drawn on their own on a patch of grass, as the game would show them (for blueprint cards)
const PREVIEW_GRASS = 0x4b8f55;
export const drawPiecesPreview = (g: Graphics, base: State, p: Pieces): void => {
  const state: State = { ...base, objects: p.objects, walls: p.walls, tiles: p.tiles, culverts: p.culverts, selection: null, drag: null, hover: null, point: null, tool: 'select', level: 0 };
  const box = piecesBounds(p);
  for (let x = box.x; x < box.x + box.w; x++) for (let y = box.y; y < box.y + box.h; y++) drawTile(g, x, y, PREVIEW_GRASS, shade(PREVIEW_GRASS, 0.85));
  drawFloorsInto(g, state, 1);
  const { sorted, flats } = buildDrawables(state);
  flats.forEach((d) => drawObject(g, d)); // roads and bays first, on the ground
  sorted.forEach((d) => drawDrawable(g, d));
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
  world.addChild(ground, gridLines, floors, flats, guides, overlay, solids);
  const guideLines = createGuides(guides);

  drawGround(ground, GRID_W, GRID_H);
  drawGridLines(gridLines, GRID_W, GRID_H);

  const drawFloors = (state: State): void => {
    floors.clear();
    drawFloorsInto(floors, state, gridAlpha(state)); // painted floors outline their tiles only while the grid shows
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
  };

  // Marked things (or what a box would mark) outlined in the selection color
  const drawMarks = (state: State, targets: readonly EraseTarget[]): void =>
    targets.forEach((t) => {
      switch (t.kind) {
        case 'object':
          return drawObjectFootprint(t.target, SELECTED_COLOR, 0.35);
        case 'tile':
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

  const render = (state: State): void => {
    const { sorted, ghostsOnTop, ghostValid, flats: flatPieces } = buildDrawables(state);
    gridLines.alpha = gridAlpha(state);
    gridLines.visible = gridLines.alpha > 0;
    drawFloors(state);
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
