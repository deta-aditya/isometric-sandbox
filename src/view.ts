// The camera can look at the world from four sides. Everything the player sees and touches lives in
// view space: the world turned so the camera always looks from the same corner. The world itself is
// stored unturned. The update runs in view space (turn the state in, update, turn it back) and the
// scene draws the turned state, so every rule written for the one camera (which wall faces to show,
// face picking, cutaway, water banks, where a footprint grows from the pointer) holds in every view.
//
// One quarter turn T maps world (x, y) to view (H - y, x), the same turn objects use for their parts.
// A view is T applied 0 to 3 times; going back is the rest of the way round.
import { type Rotation, getItem, turn } from './catalog';
import { GRID_H } from './config';
import type { Cell, Edge, Point, Rect } from './geometry';
import type { Blueprint, Drag, EraseTarget, Guide, ObjectEntity, Pieces, Selection, State, Tile, WallSegment, WallSide } from './world';

export type View = 0 | 1 | 2 | 3;

// The grid is square today; a non-square grid (#15) swaps width and height on odd views
const H = GRID_H;

// ===== Quarter turns =====
// A quarter turn about any center: (x, y) goes to (k - y, x + m). The camera turns the whole grid
// (k = H, m = 0); a held group turns about the cell it was grabbed by (see turnAbout). Everything with
// a place or a facing turns the same way, so a turned world, view or group stays consistent.
const quarter = (k: number, m: number) => {
  const point = (p: Point): Point => ({ x: k - p.y, y: p.x + m });
  const vertex = (c: Cell): Cell => ({ x: k - c.y, y: c.x + m });
  const cell = (c: Cell): Cell => ({ x: k - 1 - c.y, y: c.x + m });
  const rect = <R extends Rect>(r: R): R => ({ ...r, x: k - r.y - r.h, y: r.x + m, w: r.h, h: r.w });
  // An edge along x turns into one along y, keeping its order; one along y turns into one along x, in
  // reverse order. Sides follow the cells: along x, the side toward +y ends up toward -x, so it swaps.
  const edge = <E extends Edge>(e: E): E =>
    e.axis === 'x' ? { ...e, axis: 'y', x: k - e.y, y: e.x + m } : { ...e, axis: 'x', x: k - e.y - 1, y: e.x + m };
  const wall = (w: WallSegment): WallSegment => ({
    ...edge(w),
    opening: reverses(w) ? swapEnd(w.opening) : w.opening,
    paint: sideSwaps(w) ? { before: w.paint.after, after: w.paint.before } : w.paint,
  });
  const object = (o: ObjectEntity): ObjectEntity => ({ ...rect(o), rotation: turn(o.rotation, 1) });
  const tile = (t: Tile): Tile => ({ ...t, ...cell(t) });
  return { point, vertex, cell, rect, edge, wall, object, tile };
};

const sideSwaps = (e: Edge): boolean => e.axis === 'x';
const reverses = (e: Edge): boolean => e.axis === 'y';
const side = (e: Edge, s: WallSide): WallSide => (sideSwaps(e) ? (s === 'after' ? 'before' : 'after') : s);

// A wide opening's first piece sits at the low end of its run. When a run turns around, its first
// piece is now at the high end, so start and end pieces trade places (single openings are symmetric).
const swapEnd = (openingId: string | null): string | null => {
  if (openingId === null) return null;
  const def = getItem(openingId);
  if (def.kind !== 'opening' || !def.parent || !def.role || def.role === 'middle') return openingId;
  const parent = getItem(def.parent);
  if (parent.kind !== 'opening' || !parent.pieces) return openingId;
  return def.role === 'start' ? parent.pieces.end : parent.pieces.start;
};

// The camera's quarter turn of the whole grid
const { point, vertex, cell, edge, wall, object, tile } = quarter(H, 0);

// A held group turns about the cell it was grabbed by, which stays put
export const turnAbout = (pivot: Cell, pieces: Pieces): Pieces => {
  const q = quarter(pivot.x + pivot.y + 1, pivot.y - pivot.x);
  return {
    objects: pieces.objects.map(q.object),
    walls: pieces.walls.map(q.wall),
    tiles: pieces.tiles.map(q.tile),
    culverts: pieces.culverts.map(q.edge),
  };
};

const turnTarget = (t: EraseTarget, dir: Dir): EraseTarget => {
  switch (t.kind) {
    case 'object':
      return { ...t, target: remembered(t.target, object, dir) };
    case 'tile':
      return { ...t, target: remembered(t.target, tile, dir) };
    case 'wall':
    case 'opening':
      return { ...t, target: remembered(t.target, wall, dir) };
    case 'culvert':
      return { ...t, target: remembered(t.target, edge, dir) };
  }
};

const turnPieces = (p: Pieces, dir: Dir): Pieces => ({
  objects: p.objects.map((o) => remembered(o, object, dir)),
  walls: p.walls.map((w) => remembered(w, wall, dir)),
  tiles: p.tiles.map((t) => remembered(t, tile, dir)),
  culverts: p.culverts.map((c) => remembered(c, edge, dir)),
});

// A blueprint keeps its world facing, like the clipboard: it turns with the view (where it sits does not
// matter, only its pieces' places relative to each other and to the cell it is held by)
const blueprint = (b: Blueprint): Blueprint => ({ ...b, pieces: turnPieces(b.pieces, 1), anchor: cell(b.anchor) });

// A guide line x = a turns into y' = a; a line y = a turns into x' = H - a
const guide = <G extends Guide>(g: G): G => (g.axis === 'x' ? { ...g, axis: 'y' } : { ...g, axis: 'x', at: H - g.at });

const drag = (d: Drag): Drag => {
  switch (d.mode) {
    case 'guide':
      return guide(d);
    case 'wall':
      return { ...d, start: vertex(d.start) };
    case 'square':
    case 'box':
    case 'run':
      return { ...d, start: cell(d.start) };
    case 'paint':
      return d;
    case 'erase':
      return { ...d, start: cell(d.start), point: d.point && point(d.point) };
    case 'span':
    case 'culvert':
      return { ...d, start: edge(d.start) };
    case 'wallPaint':
      return { ...d, start: edge(d.start), side: side(d.start, d.side) };
  }
};

// ===== Keeping identity =====
// Turning the same thing twice gives the same object back, and turning a turned thing back gives the
// original. That keeps hover cheap (nothing is rebuilt) and keeps undo from seeing changes that are
// not there. Each turn is remembered both ways: forward maps a thing to its quarter-turned self.
type Dir = 1 | -1;
const forward = new WeakMap<object, object>();
const backward = new WeakMap<object, object>();

// A quarter turn one way or the other (back is three turns forward)
const by = <T>(f: (x: T) => T, dir: Dir) => (dir === 1 ? f : (x: T) => f(f(f(x))));

const remembered = <T extends object>(x: T, f: (x: T) => T, dir: Dir): T => {
  const known = (dir === 1 ? forward : backward).get(x);
  if (known) return known as T;
  const y = by(f, dir)(x);
  if (dir === 1) { forward.set(x, y); backward.set(y, x); } else { backward.set(x, y); forward.set(y, x); }
  return y;
};

const selection = (s: Selection, dir: Dir): Selection => {
  switch (s.kind) {
    case 'marked':
      return { ...s, targets: s.targets.map((t) => turnTarget(t, dir)) };
    case 'group': // the pieces turn and so does the grabbed cell; the turns about it stay the same
      return { ...s, pieces: turnPieces(s.pieces, dir), anchor: by(cell, dir)(s.anchor) };
    case 'opening': {
      // a held span is kept in axis order; a run that turns around is listed the other way
      const turned = s.originals.map((w) => remembered(w, wall, dir));
      const flip = s.originals[0] !== undefined && turned[0] !== undefined && (dir === 1 ? reverses(s.originals[0]) : reverses(turned[0]));
      const ids = s.openingIds.map((id) => (flip ? (swapEnd(id) ?? id) : id));
      return { ...s, originals: flip ? [...turned].reverse() : turned, openingIds: flip ? [...ids].reverse() : ids };
    }
  }
};

// One quarter turn, either way, of everything in the state that has a place or a facing
const quarterState = (s: State, dir: Dir): State => ({
  ...s,
  objects: listTurn(s.objects, object, dir),
  tiles: listTurn(s.tiles, tile, dir),
  culverts: listTurn(s.culverts, edge, dir),
  walls: listTurn(s.walls, wall, dir),
  hover: s.hover && by(cell, dir)(s.hover),
  point: s.point && by(point, dir)(s.point),
  rotation: turn(s.rotation, dir),
  drag: s.drag && by(drag, dir)(s.drag),
  selection: s.selection && selection(s.selection, dir),
  blueprints: listTurn(s.blueprints, blueprint, dir),
  guides: listTurn(s.guides, guide, dir),
  clipboard: s.clipboard && {
    pieces: turnPieces(s.clipboard.pieces, dir),
    anchor: by(cell, dir)(s.clipboard.anchor),
    from: s.clipboard.from.map((t) => turnTarget(t, dir)),
  },
});

// Lists are remembered per direction too, so a list turned in and its turned-back self match up
const listTurn = <T extends object>(xs: readonly T[], f: (x: T) => T, dir: Dir): readonly T[] => {
  const known = (dir === 1 ? forward : backward).get(xs);
  if (known) return known as readonly T[];
  const ys = xs.map((x) => remembered(x, f, dir));
  if (dir === 1) { forward.set(xs, ys); backward.set(ys, xs); } else { backward.set(xs, ys); forward.set(ys, xs); }
  return ys;
};

// The state as the camera sees it
export const toView = (s: State, v: View = s.view): State => {
  let out = s;
  for (let i = 0; i < v; i++) out = quarterState(out, 1);
  return out;
};

// A state worked on in view space, back in the world
export const fromView = (s: State, v: View = s.view): State => {
  let out = s;
  for (let i = 0; i < v; i++) out = quarterState(out, -1);
  return out;
};

// The same turns for a single point, for the camera to keep its center while turning
export const pointToView = (p: Point, v: View): Point => {
  let out = p;
  for (let i = 0; i < v; i++) out = point(out);
  return out;
};
export const pointFromView = (p: Point, v: View): Point => {
  let out = p;
  for (let i = 0; i < v; i++) out = by(point, -1)(out);
  return out;
};

export const turnView = (v: View, step: number): View => turn(v as Rotation, step) as View;

// A grid line seen in a view, as the world names it (ruler labels and guide numbers stay in world terms)
export const guideFromView = (g: Guide, v: View): Guide => {
  let out = g;
  for (let i = 0; i < v; i++) out = by(guide, -1)(out);
  return out;
};
