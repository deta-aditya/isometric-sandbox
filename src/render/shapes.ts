// Low-level drawing primitives on a Pixi Graphics. Grid units in, pixels out.
import type { Graphics } from 'pixi.js';
import type { ArchLook, FenceLook, GlassLook, OpeningLook, PoleLook, Shape } from '../catalog';
import { WALL_T } from '../config';
import type { Rect } from '../geometry';
import { toScreen } from '../geometry';

export const shade = (c: number, f: number): number =>
  ((((c >> 16) & 255) * f) << 16) | ((((c >> 8) & 255) * f) << 8) | (((c & 255) * f) | 0);

type P3 = readonly [number, number, number]; // grid x, grid y, elevation in pixels

// Grid point at an elevation -> [sx, sy]
const pt = ([gx, gy, gz]: P3): [number, number] => {
  const { sx, sy } = toScreen(gx, gy);
  return [sx, sy - gz];
};

const poly = (g: Graphics, points: readonly P3[], color: number, alpha: number): void => {
  g.poly(points.flatMap(pt)).fill({ color, alpha });
};

const quad = ({ x, y, w, h }: Rect, z: number): P3[] => [
  [x, y, z],
  [x + w, y, z],
  [x + w, y + h, z],
  [x, y + h, z],
];

// ===== Ground =====
export const GRASS = 0x3a7d44;
const GRID_LINE = 0x2d5e34;

// lineAlpha 0 leaves the outline off, for when grid lines are hidden
export const drawTile = (g: Graphics, x: number, y: number, color = GRASS, line = GRID_LINE, lineAlpha = 1): void => {
  g.poly(quad({ x, y, w: 1, h: 1 }, 0).flatMap(pt)).fill(color);
  if (lineAlpha > 0) g.poly(quad({ x, y, w: 1, h: 1 }, 0).flatMap(pt)).stroke({ width: 1, color: line, alpha: lineAlpha });
};

// The open ground: one fill for the whole map, and the grid as long lines on their own layer,
// so hiding the grid is just hiding that layer (and it is far cheaper than an outline per tile)
export const drawGround = (g: Graphics, w: number, h: number, color = GRASS): void => {
  g.poly(quad({ x: 0, y: 0, w, h }, 0).flatMap(pt)).fill(color);
};

export const drawGridLines = (g: Graphics, w: number, h: number): void => {
  const line = (a: P3, b: P3) => g.poly([...pt(a), ...pt(b)], false);
  for (let x = 0; x <= w; x++) line([x, 0, 0], [x, h, 0]);
  for (let y = 0; y <= h; y++) line([0, y, 0], [w, y, 0]);
  g.stroke({ width: 1, color: GRID_LINE });
};

// Water: the surface, the inner bank walls on the two far sides (the only ones the camera can see
// into), then the coping along every side that faces land
const COPING = 0.08;
const BANK_FACE = 0.14;

export const drawWaterTile = (
  g: Graphics, x: number, y: number, water: number, bank: number,
  sides: Readonly<Record<'west' | 'north' | 'east' | 'south' | 'nw' | 'ne' | 'se' | 'sw', boolean>>,
): void => {
  poly(g, quad({ x, y, w: 1, h: 1 }, 0), water, 1);
  if ((x + y) % 2 === 0) poly(g, quad({ x: x + 0.35, y: y + 0.45, w: 0.3, h: 0.05 }, 0), shade(water, 1.35), 0.6);
  if (sides.west) poly(g, quad({ x: x + COPING, y, w: BANK_FACE, h: 1 }, 0), shade(bank, 0.55), 1);
  if (sides.north) poly(g, quad({ x, y: y + COPING, w: 1, h: BANK_FACE }, 0), shade(bank, 0.75), 1);
  if (sides.west) poly(g, quad({ x, y, w: COPING, h: 1 }, 0), bank, 1);
  if (sides.north) poly(g, quad({ x, y, w: 1, h: COPING }, 0), bank, 1);
  if (sides.east) poly(g, quad({ x: x + 1 - COPING, y, w: COPING, h: 1 }, 0), bank, 1);
  if (sides.south) poly(g, quad({ x, y: y + 1 - COPING, w: 1, h: COPING }, 0), bank, 1);
  const post = (px: number, py: number) => poly(g, quad({ x: px, y: py, w: COPING, h: COPING }, 0), bank, 1);
  if (sides.nw) post(x, y);
  if (sides.ne) post(x + 1 - COPING, y);
  if (sides.se) post(x + 1 - COPING, y + 1 - COPING);
  if (sides.sw) post(x, y + 1 - COPING);
};

// Culvert: drawn on the water cell, along the bank it sits on. The bank closes in at a V at each end
// (where the side banks meet it) and the bank wall gets two holes the water runs into. On a far side the
// bank wall face is visible, so the holes go on that dark border; on a near side they go in the coping.
type Side = 'west' | 'north' | 'east' | 'south';
const PIPE = 0x0b1220;
const HOLES: readonly (readonly [number, number])[] = [[0.38, 0.48], [0.52, 0.62]];

export const drawCulvertBank = (
  g: Graphics, x: number, y: number, side: Side, bank: number, ends: Readonly<{ start: boolean; end: boolean }>,
): void => {
  // u: distance in from the bank edge, v: position along it
  const L = {
    west: (u: number, v: number): P3 => [x + u, y + v, 0],
    north: (u: number, v: number): P3 => [x + v, y + u, 0],
    east: (u: number, v: number): P3 => [x + 1 - u, y + v, 0],
    south: (u: number, v: number): P3 => [x + v, y + 1 - u, 0],
  }[side];
  const rect = (u0: number, u1: number, v0: number, v1: number): P3[] => [L(u0, v0), L(u1, v0), L(u1, v1), L(u0, v1)];
  const far = side === 'west' || side === 'north';
  const face = shade(bank, side === 'west' ? 0.55 : 0.75);
  const wall = far ? COPING + BANK_FACE : COPING;
  // the V: the bank slopes in from the side banks, so its visible faces use the bank wall shade
  if (ends.start) poly(g, [L(0, 0), L(0.6, 0), L(0, 0.34)], far ? face : bank, 1);
  if (ends.end) poly(g, [L(0, 1), L(0.6, 1), L(0, 0.66)], far ? face : bank, 1);
  if (far) poly(g, rect(COPING, wall, 0, 1), face, 1);
  poly(g, rect(0, COPING, 0, 1), bank, 1);
  HOLES.forEach(([v0, v1]) => poly(g, far ? rect(COPING + 0.02, wall - 0.01, v0, v1) : rect(0.015, COPING - 0.015, v0, v1), PIPE, 1));
};

// A faint wash with no outline, for showing an area's reach without marking anything in it
export const drawWash = (g: Graphics, rect: Rect, color: number, alpha: number): void => {
  g.poly(quad(rect, 0).flatMap(pt)).fill({ color, alpha });
};

export const drawFootprint = (g: Graphics, rect: Rect, color: number, fillAlpha = 0.35): void => {
  g.poly(quad(rect, 0).flatMap(pt)).fill({ color, alpha: fillAlpha }).stroke({ width: 2, color, alpha: 0.9 });
};

// ===== Solids =====
type ShapeDrawer = (g: Graphics, r: Rect, z: number, height: number, color: number, alpha: number) => void;

export const drawBox: ShapeDrawer = (g, { x, y, w, h }, z, height, color, alpha) => {
  const t = z + height;
  // front-left face (y + h edge), front-right face (x + w edge), then top
  poly(g, [[x, y + h, t], [x + w, y + h, t], [x + w, y + h, z], [x, y + h, z]], shade(color, 0.75), alpha);
  poly(g, [[x + w, y + h, t], [x + w, y, t], [x + w, y, z], [x + w, y + h, z]], shade(color, 0.55), alpha);
  poly(g, quad({ x, y, w, h }, t), color, alpha);
};

// Back faces first so the front faces paint over them when the slope is shallow
export const drawPyramid: ShapeDrawer = (g, { x, y, w, h }, z, height, color, alpha) => {
  const apex: P3 = [x + w / 2, y + h / 2, z + height];
  poly(g, [[x, y, z], [x + w, y, z], apex], shade(color, 0.95), alpha);
  poly(g, [[x, y, z], [x, y + h, z], apex], shade(color, 0.9), alpha);
  poly(g, [[x, y + h, z], [x + w, y + h, z], apex], shade(color, 0.85), alpha);
  poly(g, [[x + w, y, z], [x + w, y + h, z], apex], shade(color, 0.6), alpha);
};

// Round shapes are a 16-sided ring around the footprint's ellipse. Light comes from the same
// direction as the boxes: faces turned toward +y read lighter than faces turned toward +x.
const RING = 16;
const ring = ({ x, y, w, h }: Rect, z: number): P3[] =>
  Array.from({ length: RING }, (_, i) => {
    const a = (i / RING) * Math.PI * 2;
    return [x + w / 2 + (Math.cos(a) * w) / 2, y + h / 2 + (Math.sin(a) * h) / 2, z] as const;
  });
// how lit a face turned toward angle `a` is (0 faces +x, pi/2 faces +y)
const lightAt = (a: number): number => 0.55 + 0.2 * (Math.sin(a) + 1) / 2 + 0.1 * Math.max(0, -Math.cos(a));

export const drawCylinder: ShapeDrawer = (g, r, z, height, color, alpha) => {
  const bottom = ring(r, z);
  const top = ring(r, z + height);
  for (let i = 0; i < RING; i++) {
    const j = (i + 1) % RING;
    const mid = ((i + 0.5) / RING) * Math.PI * 2;
    // only sides facing the camera (toward +x+y) show
    if (Math.cos(mid) + Math.sin(mid) <= 0) continue;
    poly(g, [bottom[i] ?? [0, 0, 0], bottom[j] ?? [0, 0, 0], top[j] ?? [0, 0, 0], top[i] ?? [0, 0, 0]], shade(color, lightAt(mid)), alpha);
  }
  poly(g, top, color, alpha);
};

export const drawCone: ShapeDrawer = (g, r, z, height, color, alpha) => {
  const base = ring(r, z);
  const apex: P3 = [r.x + r.w / 2, r.y + r.h / 2, z + height];
  // slices further from the camera first, so nearer ones paint over them
  const order = Array.from({ length: RING }, (_, i) => i).sort((a, b) => {
    const at = (i: number) => { const m = ((i + 0.5) / RING) * Math.PI * 2; return Math.cos(m) + Math.sin(m); };
    return at(a) - at(b);
  });
  order.forEach((i) => {
    const mid = ((i + 0.5) / RING) * Math.PI * 2;
    poly(g, [base[i] ?? apex, base[(i + 1) % RING] ?? apex, apex], shade(color, lightAt(mid) + 0.15), alpha);
  });
};

export const SHAPES: Readonly<Record<Shape, ShapeDrawer>> = {
  box: drawBox,
  pyramid: drawPyramid,
  cylinder: drawCylinder,
  cone: drawCone,
};

// Hip roof: ridge runs along the longer side, sloped ends on the shorter sides.
export const drawHipRoof: ShapeDrawer = (g, { x, y, w, h }, z, height, color, alpha) => {
  const top = z + height;
  const alongX = w >= h;
  const r1: P3 = alongX ? [x + h / 2, y + h / 2, top] : [x + w / 2, y + w / 2, top];
  const r2: P3 = alongX ? [x + w - h / 2, y + h / 2, top] : [x + w / 2, y + h - w / 2, top];
  const tl: P3 = [x, y, z];
  const tr: P3 = [x + w, y, z];
  const br: P3 = [x + w, y + h, z];
  const bl: P3 = [x, y + h, z];
  // back (y edge), back-left (x edge), front-left (y + h edge), front-right (x + w edge)
  poly(g, alongX ? [tl, tr, r2, r1] : [tl, tr, r1], shade(color, 1), alpha);
  poly(g, alongX ? [tl, bl, r1] : [tl, bl, r2, r1], shade(color, 0.92), alpha);
  poly(g, alongX ? [bl, br, r2, r1] : [bl, br, r2], shade(color, 0.85), alpha);
  poly(g, alongX ? [tr, br, r2] : [tr, br, r2, r1], shade(color, 0.62), alpha);
};

// ===== Walls =====
// A wall piece sits on one grid edge: axis 'x' runs along x at a fixed y, axis 'y' along y at a fixed x.
export type WallPiece = Readonly<{
  axis: 'x' | 'y';
  x: number;
  y: number;
  height: number;
  color: number;
  opening: OpeningLook | null;
  alpha: number;
  fence?: FenceLook; // set for fences, which draw from their look instead of as a slab
  glass?: GlassLook; // set for glass walls: a see-through pane in a thin frame
  tint?: number; // a highlight (hover, bulldoze, ghost) that recolors everything, the arch included
  // set for pole walls: which ends get a post (every 2 tiles along a run, plus run ends and corners)
  pole?: Readonly<{ look: PoleLook; posts: readonly [boolean, boolean] }>;
}>;

// A box along an edge: `from`..`to` in tile units along it, z..zTop in pixels, `t` thick across it
const edgeBox = (
  g: Graphics, axis: 'x' | 'y', x: number, y: number, from: number, to: number, z: number, zTop: number, color: number, alpha: number, t: number,
): void => {
  if (zTop <= z || to <= from) return;
  const rect: Rect = axis === 'x' ? { x: x + from, y: y - t / 2, w: to - from, h: t } : { x: x - t / 2, y: y + from, w: t, h: to - from };
  drawBox(g, rect, z, zTop - z, color, alpha);
};

// A fence segment from its look. Gaps for a gate leave the fence out between `from` and `to`, put a post
// on each side, and hang the gate (if it has one) between them.
const POST = 0.08;
const drawFence = (g: Graphics, piece: WallPiece, look: FenceLook): void => {
  const { axis, x, y, color, alpha } = piece;
  const box = (from: number, to: number, z: number, zTop: number, c: number, t: number, a = alpha) =>
    edgeBox(g, axis, x, y, from, to, z, zTop, c, a, t);
  const size = look.postSize ?? POST;
  const post = (at: number, extra = 2) => {
    if (look.post === null) return;
    box(at - size / 2, at + size / 2, 0, look.height + extra, look.post, size);
    // a pillar gets a cap a little wider than itself
    if (look.postSize) box(at - size / 2 - 0.03, at + size / 2 + 0.03, look.height + extra, look.height + extra + 3, shade(look.post, 1.1), size + 0.06);
  };
  const run = (a: number, b: number) => {
    if (b <= a) return;
    const floor = look.base?.height ?? 0;
    if (look.base) box(a, b, 0, floor, look.base.color, look.base.thick);
    if (look.panel) box(a, b, floor, look.height, color, look.panel.thick, alpha * look.panel.alpha);
    for (let i = 0; i < look.pickets; i++) {
      const at = (i + 0.5) / look.pickets;
      const w = look.base ? 0.02 : 0.035; // bars on a base wall are thinner than wooden pickets
      if (at > a && at < b) box(at - w, at + w, floor, look.height, color, look.base ? 0.03 : 0.04);
    }
    look.rails.forEach((z) => box(a, b, z, z + 2, color, 0.05));
    // the rope sags over the whole segment (post to post); only the part inside a..b is drawn
    if (look.rope) {
      const { z, sag, color: rope } = look.rope;
      const STEPS = 10;
      for (let i = 0; i < STEPS; i++) {
        const [t0, t1] = [Math.max(a, i / STEPS), Math.min(b, (i + 1) / STEPS)];
        const mid = (t0 + t1) / 2;
        const zAt = z - sag * 4 * mid * (1 - mid);
        if (t1 > t0) box(t0, t1, zAt - 1.5, zAt + 1.5, rope, 0.05);
      }
    }
  };
  const o = piece.opening;
  // an arched gate's outer ends get its pillars instead of fence posts
  const gatePost = (at: number) => (o?.arch ? pillar(box, o.arch, at, piece.tint) : post(at, 4));
  // a gate running right to a segment's end (the inside of a wide gate) has no post there
  if (!o || o.from > 0) post(0);
  if (!o) run(0, 1);
  else {
    run(0, o.from);
    if (o.from > 0) gatePost(o.from);
    if (o.fill && o.arch) ironLeaves(box, o, o.fill.color, alpha * o.fill.alpha);
    else if (o.fill) {
      box(o.from + POST / 2, o.to - POST / 2, o.bottom, o.top, o.fill.color, 0.04, alpha * o.fill.alpha);
      box(o.from + POST / 2, o.to - POST / 2, o.top - 2, o.top, shade(o.fill.color, 1.3), 0.05);
    }
    if (o.to < 1) gatePost(o.to);
    run(o.to, 1);
    if (o.arch) drawArch(box, o, o.arch, piece.tint);
  }
  if (!o || o.to < 1) post(1);
};

type EdgeBoxFn = (from: number, to: number, z: number, zTop: number, c: number, t: number, a?: number) => void;

// Wrought iron leaves: rails at the foot, the middle and the top, bars between them, and a spike on
// every other bar. Bars are spaced along the piece; a leaf ends short of a pillar, not of an inner joint.
const ironLeaves = (box: EdgeBoxFn, o: OpeningLook, color: number, alpha: number): void => {
  const a = o.from > 0 ? o.from + 0.12 : o.from;
  const b = o.to < 1 ? o.to - 0.12 : o.to;
  [o.bottom + 2, (o.bottom + o.top) / 2, o.top - 2].forEach((z) => box(a, b, z - 1.5, z + 1.5, color, 0.05, alpha));
  const BARS = 8;
  for (let i = 0; i <= BARS; i++) {
    const at = i / BARS;
    if (at < a || at > b) continue;
    box(at - 0.012, at + 0.012, o.bottom, o.top, color, 0.03, alpha);
    if (i % 2 === 0) box(at - 0.025, at + 0.025, o.top, o.top + 4, color, 0.035, alpha);
  }
};

// A gate pillar: a stone column with a plinth, a cap and a ball on top
const pillar = (box: EdgeBoxFn, arch: ArchLook, at: number, tint?: number): void => {
  const s = arch.pillarSize;
  const c = tint ?? arch.pillar;
  const h = arch.pillarHeight;
  box(at - s / 2 - 0.03, at + s / 2 + 0.03, 0, 4, shade(c, 0.85), s + 0.06);
  box(at - s / 2, at + s / 2, 4, h, c, s);
  box(at - s / 2 - 0.03, at + s / 2 + 0.03, h, h + 3, shade(c, 1.08), s + 0.06);
  box(at - 0.05, at + 0.05, h + 3, h + 9, shade(c, 0.95), 0.1);
};

// This piece's slice of the arch. Along the piece, `lift` (0..1) says how far up the curve the arch
// is: the start piece rises from its pillar in a quarter ellipse (steep at the pillar, level at the
// piece's inner end), middle pieces stay at the top, and the end piece is the start piece mirrored.
// Two curved bands (the arch and a thinner one under it) are tied by short bars, like wrought iron.
const ARCH_STEPS = 12;
const drawArch = (box: EdgeBoxFn, o: OpeningLook, arch: ArchLook, tint?: number): void => {
  const c = tint ?? arch.color;
  const [a, b] = [o.from, o.to];
  const lift = (t: number): number => {
    if (o.role === 'start') {
      const u = (b - t) / (b - a);
      return Math.sqrt(Math.max(0, 1 - u * u));
    }
    if (o.role === 'end') {
      const u = (t - a) / (b - a);
      return Math.sqrt(Math.max(0, 1 - u * u));
    }
    return 1;
  };
  const zAt = (t: number) => arch.spring + arch.rise * lift(t);
  for (let i = 0; i < ARCH_STEPS; i++) {
    const t0 = a + ((b - a) * i) / ARCH_STEPS;
    const t1 = a + ((b - a) * (i + 1)) / ARCH_STEPS;
    const [z0, z1] = [zAt(t0), zAt(t1)];
    // a step covers the height the curve passes through, so the band has no gaps where it is steep
    box(t0, t1, Math.min(z0, z1) - 2, Math.max(z0, z1) + 2, c, 0.07);
    box(t0, t1, Math.min(z0, z1) - 10, Math.min(z0, z1) - 8, c, 0.04);
    if (i % 3 === 1) box((t0 + t1) / 2 - 0.012, (t0 + t1) / 2 + 0.012, Math.min(z0, z1) - 9, Math.min(z0, z1) - 2, c, 0.04);
  }
};

// A pole wall: a beam along the top and posts where it was told to put them
const POLE = 0.14;
const drawPole = (g: Graphics, piece: WallPiece, pole: NonNullable<WallPiece['pole']>): void => {
  const { axis, x, y, alpha, height } = piece;
  const post = piece.tint ?? pole.look.post;
  const beam = piece.tint ?? pole.look.beam;
  const box = (from: number, to: number, z: number, zTop: number, c: number, t: number) => edgeBox(g, axis, x, y, from, to, z, zTop, c, alpha, t);
  if (pole.posts[0]) box(-POLE / 2, POLE / 2, 0, height, post, POLE);
  box(0, 1, height - 5, height, beam, 0.08);
  if (pole.posts[1]) box(1 - POLE / 2, 1 + POLE / 2, 0, height, post, POLE);
};

export const drawWall = (g: Graphics, wall: WallPiece): void => {
  if (wall.fence) return drawFence(g, wall, wall.fence);
  if (wall.pole) return drawPole(g, wall, wall.pole);
  const top = wall.height;
  // A slab from `from` to `to` (tile units along the edge), between elevations z and zTop
  const pane = wall.alpha * (wall.glass?.alpha ?? 1); // glass is see-through, other walls solid
  const slab = (from: number, to: number, z: number, zTop: number, color = wall.color, alpha = pane, t = WALL_T) => {
    const clipped = Math.min(zTop, top); // a cut-down wall clips everything above its height
    if (clipped <= z || to <= from) return;
    const rect: Rect =
      wall.axis === 'x'
        ? { x: wall.x + from, y: wall.y - t / 2, w: to - from, h: t }
        : { x: wall.x - t / 2, y: wall.y + from, w: t, h: to - from };
    drawBox(g, rect, z, clipped - z, color, alpha);
  };

  // Glass: a sill, a top rail and posts at the ends, solid, so the pane reads as glass in a frame
  const frame = () => {
    if (!wall.glass) return;
    const f = wall.glass.frame;
    const bar = (from: number, to: number, z: number, zTop: number) => slab(from, to, z, zTop, f, wall.alpha, WALL_T * 1.2);
    const o = wall.opening;
    // the sill stops at a door (an opening down to the floor) so the doorway stays clear
    if (o && o.bottom === 0) {
      bar(0, o.from, 0, 3);
      bar(o.to, 1, 0, 3);
    } else bar(0, 1, 0, 3);
    bar(0, 1, top - 3, top);
    bar(0, 0.04, 0, top);
    bar(0.96, 1, 0, top);
  };

  const o = wall.opening;
  if (!o) {
    slab(0, 1, 0, top);
    return frame();
  }
  // Wall all around the hole, then whatever fills the hole (door leaf, glass, or nothing)
  slab(0, o.from, 0, top);
  slab(o.from, o.to, 0, o.bottom);
  if (o.fill) slab(o.from, o.to, o.bottom, o.top, o.fill.color, wall.alpha * o.fill.alpha, WALL_T * 0.5);
  slab(o.from, o.to, o.top, top);
  slab(o.to, 1, 0, top);
  frame();
};

// A thin strip on the ground along an edge, for previews
export const drawEdgeStrip = (g: Graphics, e: Readonly<{ axis: 'x' | 'y'; x: number; y: number }>, color: number): void => {
  const t = 0.16;
  const rect = e.axis === 'x' ? { x: e.x, y: e.y - t / 2, w: 1, h: t } : { x: e.x - t / 2, y: e.y, w: t, h: 1 };
  drawFootprint(g, rect, color, 0.6);
};

// A dot on the ground at a grid vertex
export const drawVertex = (g: Graphics, x: number, y: number, color: number): void => {
  const { sx, sy } = toScreen(x, y);
  g.circle(sx, sy, 5).fill({ color, alpha: 0.9 }).stroke({ width: 2, color: 0x0f172a, alpha: 0.6 });
};
