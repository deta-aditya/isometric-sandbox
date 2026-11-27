// The camera can look at the world from four sides. Everything the player sees and touches lives in
// view space: the world turned so the camera always looks from the same corner. The world itself is
// stored unturned. The update runs in view space (turn the state in, update, turn it back) and the
// scene draws the turned state, so every rule written for the one camera (which wall faces to show,
// face picking, cutaway, water banks, where a footprint grows from the pointer) holds in every view.
//
// One quarter turn T maps (x, y) in a frame w wide and h tall to (h - y, x) in a frame h wide and w
// tall, the same turn objects use for their parts. A view is T applied 0 to 3 times, each from the
// frame the last one left; going back is the rest of the way round. On a square map every frame is
// the same; on a non-square one width and height trade places on odd views.
import { type Rotation, getItem, turn as spin } from './catalog';
import { type Cell, type Edge, type Point, type Rect, type Size, swapped } from './geometry';
import type { Blueprint, Drag, EraseTarget, Guide, ObjectEntity, Pieces, Selection, State, Tile, WallSegment, WallSide } from './world';

export type View = 0 | 1 | 2 | 3;

// ===== Quarter turns =====
// A quarter turn about any center: (x, y) goes to (k - y, x + m). The camera turns the whole grid
// (k = the frame's height, m = 0); a held group turns about the cell it was grabbed by (see turnAbout). Everything with
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
    finish: sideSwaps(w) ? { before: w.finish.after, after: w.finish.before } : w.finish,
  });
  const object = (o: ObjectEntity): ObjectEntity => ({ ...rect(o), rotation: spin(o.rotation, 1) });
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

type Turns = ReturnType<typeof quarter>;
type Dir = 1 | -1;

// Back one turn is three turns forward, each from the frame the one before left: from a frame w by h
// that is turns about h, then w, then h
const thrice = (a: Turns, b: Turns): Turns => ({
  point: (p) => a.point(b.point(a.point(p))),
  vertex: (c) => a.vertex(b.vertex(a.vertex(c))),
  cell: (c) => a.cell(b.cell(a.cell(c))),
  rect: (r) => a.rect(b.rect(a.rect(r))),
  edge: (e) => a.edge(b.edge(a.edge(e))),
  wall: (w) => a.wall(b.wall(a.wall(w))),
  object: (o) => a.object(b.object(a.object(o))),
  tile: (t) => a.tile(b.tile(a.tile(t))),
});

// The camera's quarter turn of the whole grid, one way or the other, from a frame of this size
const turnsMade = new Map<string, Turns>();
const turnsFrom = (frame: Size, dir: Dir): Turns => {
  const key = `${frame.w}x${frame.h}:${dir}`;
  const known = turnsMade.get(key);
  if (known) return known;
  const made = dir === 1 ? quarter(frame.h, 0) : thrice(quarter(frame.h, 0), quarter(frame.w, 0));
  turnsMade.set(key, made);
  return made;
};

// A held group turns about the cell it was grabbed by, which stays put
export const turnAbout = (pivot: Cell, pieces: Pieces): Pieces => {
  const q = quarter(pivot.x + pivot.y + 1, pivot.y - pivot.x);
  return {
    objects: pieces.objects.map(q.object),
    walls: pieces.walls.map(q.wall),
    tiles: pieces.tiles.map(q.tile),
    terrain: pieces.terrain.map(q.tile),
    culverts: pieces.culverts.map(q.edge),
  };
};

// ===== Keeping identity =====
// Turning the same thing twice gives the same object back, and turning a turned thing back gives the
// original. That keeps hover cheap (nothing is rebuilt) and keeps undo from seeing changes that are
// not there. Each turn is remembered both ways, per map size: a clipboard or blueprint carried into a
// game of another size must not pick up a turn made in a frame it no longer sits in.
type Caches = Readonly<{ forward: WeakMap<object, object>; backward: WeakMap<object, object> }>;
type Turn = Readonly<{
  t: Turns;
  dir: Dir;
  frame: Size; // the frame turned from
  there: WeakMap<object, object>; // this direction's memory
  back: WeakMap<object, object>; // the other direction's
}>;

// Caches are keyed by the frame a forward turn starts from, so a forward turn and its way back share them
const caches = new Map<Size, Caches>();
const turns = new Map<string, Turn>();
const turnOf = (frame: Size, dir: Dir): Turn => {
  const key = `${frame.w}x${frame.h}:${dir}`;
  const known = turns.get(key);
  if (known) return known;
  const source = dir === 1 ? frame : swapped(frame);
  const c = caches.get(source) ?? { forward: new WeakMap(), backward: new WeakMap() };
  caches.set(source, c);
  const made: Turn = {
    t: turnsFrom(frame, dir),
    dir,
    frame,
    there: dir === 1 ? c.forward : c.backward,
    back: dir === 1 ? c.backward : c.forward,
  };
  turns.set(key, made);
  return made;
};

const remembered = <T extends object>(x: T, f: (x: T) => T, turn: Turn): T => {
  const known = turn.there.get(x);
  if (known) return known as T;
  const y = f(x);
  turn.there.set(x, y);
  turn.back.set(y, x);
  return y;
};

// Lists are remembered per direction too, so a list turned in and its turned-back self match up
const listTurn = <T extends object>(xs: readonly T[], f: (x: T) => T, turn: Turn): readonly T[] =>
  remembered(xs, (list) => list.map((x) => remembered(x, f, turn)), turn);

const turnTarget = (target: EraseTarget, turn: Turn): EraseTarget => {
  const { t } = turn;
  switch (target.kind) {
    case 'object':
      return { ...target, target: remembered(target.target, t.object, turn) };
    case 'tile':
    case 'terrain': // terrain cells turn like tiles
      return { ...target, target: remembered(target.target, t.tile, turn) };
    case 'wall':
    case 'opening':
      return { ...target, target: remembered(target.target, t.wall, turn) };
    case 'culvert':
      return { ...target, target: remembered(target.target, t.edge, turn) };
  }
};

const turnPieces = (p: Pieces, turn: Turn): Pieces => ({
  objects: p.objects.map((o) => remembered(o, turn.t.object, turn)),
  walls: p.walls.map((w) => remembered(w, turn.t.wall, turn)),
  tiles: p.tiles.map((x) => remembered(x, turn.t.tile, turn)),
  terrain: p.terrain.map((x) => remembered(x, turn.t.tile, turn)),
  culverts: p.culverts.map((c) => remembered(c, turn.t.edge, turn)),
});

// A blueprint keeps its world facing, like the clipboard: it turns with the view (where it sits does not
// matter, only its pieces' places relative to each other and to the cell it is held by)
const blueprint = (turn: Turn) => (b: Blueprint): Blueprint => ({ ...b, pieces: turnPieces(b.pieces, turn), anchor: turn.t.cell(b.anchor) });

// Forward from a frame w by h, a guide line x = a turns into y = a and a line y = a into x = h - a.
// Back, from that turned frame, y = a returns to x = a and x = b to y = w - b.
const guide = (turn: Turn) => <G extends Guide>(g: G): G =>
  turn.dir === 1
    ? g.axis === 'x' ? { ...g, axis: 'y' } : { ...g, axis: 'x', at: turn.frame.h - g.at }
    : g.axis === 'y' ? { ...g, axis: 'x' } : { ...g, axis: 'y', at: turn.frame.w - g.at };

// A drag going back takes three forward turns, so a painted side flips as many times as its edge turns
const drag = (d: Drag, turn: Turn): Drag => {
  if (turn.dir === -1) {
    const there = swapped(turn.frame);
    return dragForward(dragForward(dragForward(d, turnOf(turn.frame, 1)), turnOf(there, 1)), turnOf(turn.frame, 1));
  }
  return dragForward(d, turn);
};
const dragForward = (d: Drag, turn: Turn): Drag => {
  const { t } = turn;
  switch (d.mode) {
    case 'guide':
      return guide(turn)(d);
    case 'wall':
      return { ...d, start: t.vertex(d.start) };
    case 'square':
    case 'box':
    case 'run':
      return { ...d, start: t.cell(d.start) };
    case 'paint':
      return d;
    case 'brush':
      return { ...d, last: t.point(d.last) };
    case 'erase':
      return { ...d, start: t.cell(d.start), point: d.point && t.point(d.point) };
    case 'span':
    case 'culvert':
      return { ...d, start: t.edge(d.start) };
    case 'wallPaint':
      return { ...d, start: t.edge(d.start), side: side(d.start, d.side) };
  }
};

const selection = (s: Selection, turn: Turn): Selection => {
  switch (s.kind) {
    case 'marked':
      return { ...s, targets: s.targets.map((x) => turnTarget(x, turn)) };
    case 'group': // the pieces turn and so does the grabbed cell; the turns about it stay the same
      return { ...s, pieces: turnPieces(s.pieces, turn), anchor: turn.t.cell(s.anchor) };
    case 'opening': {
      // a held span is kept in axis order; a run that turns around is listed the other way
      const turned = s.originals.map((w) => remembered(w, turn.t.wall, turn));
      const flip = s.originals[0] !== undefined && turned[0] !== undefined && (turn.dir === 1 ? reverses(s.originals[0]) : reverses(turned[0]));
      const ids = s.openingIds.map((id) => (flip ? (swapEnd(id) ?? id) : id));
      return { ...s, originals: flip ? [...turned].reverse() : turned, openingIds: flip ? [...ids].reverse() : ids };
    }
  }
};

// One quarter turn, either way, of everything in the state that has a place or a facing. The state's
// size is the frame it is in, so a turned state of a non-square map has width and height swapped.
const quarterState = (s: State, dir: Dir): State => {
  const turn = turnOf(s.size, dir);
  const { t } = turn;
  return {
    ...s,
    size: swapped(s.size),
    objects: listTurn(s.objects, t.object, turn),
    tiles: listTurn(s.tiles, t.tile, turn),
    terrain: listTurn(s.terrain, t.tile, turn),
    culverts: listTurn(s.culverts, t.edge, turn),
    walls: listTurn(s.walls, t.wall, turn),
    hover: s.hover && t.cell(s.hover),
    point: s.point && t.point(s.point),
    rotation: spin(s.rotation, dir),
    drag: s.drag && drag(s.drag, turn),
    selection: s.selection && selection(s.selection, turn),
    blueprints: listTurn(s.blueprints, blueprint(turn), turn),
    guides: listTurn(s.guides, guide(turn), turn),
    clipboard: s.clipboard && {
      pieces: turnPieces(s.clipboard.pieces, turn),
      anchor: t.cell(s.clipboard.anchor),
      from: s.clipboard.from.map((x) => turnTarget(x, turn)),
    },
  };
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

// The frame a view of a map this size is in: width and height trade places on odd views
export const sizeInView = (size: Size, v: View): Size => (v % 2 === 1 ? swapped(size) : size);

// The same turns for a single point, for the camera to keep its center while turning. size is the
// world's size; a point coming back from a view is in that view's frame.
export const pointToView = (p: Point, v: View, size: Size): Point => {
  let out = p, frame = size;
  for (let i = 0; i < v; i++) { out = turnsFrom(frame, 1).point(out); frame = swapped(frame); }
  return out;
};
export const pointFromView = (p: Point, v: View, size: Size): Point => {
  let out = p, frame = sizeInView(size, v);
  for (let i = 0; i < v; i++) { out = turnsFrom(frame, -1).point(out); frame = swapped(frame); }
  return out;
};

export const turnView = (v: View, step: number): View => spin(v as Rotation, step) as View;

// A grid line seen in a view, as the world names it (ruler labels and guide numbers stay in world terms).
// frame is the view's own size (the turned state's size).
export const guideFromView = (g: Guide, v: View, frame0: Size): Guide => {
  let out = g, frame = frame0;
  for (let i = 0; i < v; i++) { out = guide(turnOf(frame, -1))(out); frame = swapped(frame); }
  return out;
};
