import { TILE_H } from './config';
import type { Rect } from './geometry';

// A lies on the far side of B when it is entirely past B along x or along y.
export const isBehind = (a: Rect, b: Rect): boolean => a.x + a.w <= b.x || a.y + a.h <= b.y;

// Horizontal screen extent in half-tile units: left corner (x, y + h), right corner (x + w, y).
// Two objects can only cover each other when these extents overlap.
export const overlapsOnScreen = (a: Rect, b: Rect): boolean =>
  Math.max(a.x - a.y - a.h, b.x - b.y - b.h) < Math.min(a.x + a.w - a.y, b.x + b.w - b.y);

// Diagonal neighbors can be "behind" each other on different axes, which forms a cycle.
// Only pairs that actually overlap on screen get an ordering constraint.
export const drawsBefore = (a: Rect, b: Rect): boolean => overlapsOnScreen(a, b) && isBehind(a, b);

// Topological order over drawsBefore (DFS). Local mutation only;
// the function itself is pure from the caller's point of view.
export const depthSort = <T extends Rect>(items: readonly T[]): readonly T[] => {
  const done = new Set<T>();
  const visiting = new Set<T>();
  const out: T[] = [];

  const visit = (n: T): void => {
    if (done.has(n) || visiting.has(n)) return;
    visiting.add(n);
    items.forEach((m) => m !== n && drawsBefore(m, n) && visit(m));
    visiting.delete(n);
    done.add(n);
    out.push(n);
  };

  [...items].sort((a, b) => a.x + a.y - (b.x + b.y)).forEach(visit);
  return out;
};

// ===== Boxes in 3D (the parts inside one object) =====
// A box: footprint in tiles plus a height range in pixels
export type Box = Rect & Readonly<{ z: number; height: number }>;

// A box's screen outline is a hexagon. Its edges run along three directions (vertical, and along each
// grid axis as drawn), so it is exactly the overlap of three bands: screen x, and the two lines
// sy - sx/2 = TILE_H*y - z and sy + sx/2 = TILE_H*x - z. Two hexagons overlap exactly when all
// three bands overlap, which is far tighter than comparing bounding rectangles.
type Band = readonly [number, number];
const bandsOf = (b: Box): readonly [Band, Band, Band] => [
  [b.x - b.y - b.h, b.x + b.w - b.y],
  [TILE_H * b.x - (b.z + b.height), TILE_H * (b.x + b.w) - b.z],
  [TILE_H * b.y - (b.z + b.height), TILE_H * (b.y + b.h) - b.z],
];
const EPS = 1e-6;
const boxesOverlapOnScreen = (a: Box, b: Box): boolean => {
  const [p, q] = [bandsOf(a), bandsOf(b)];
  return p.every(([lo, hi], i) => {
    const [qlo, qhi] = q[i] ?? [0, 0];
    return Math.max(lo, qlo) < Math.min(hi, qhi) - EPS;
  });
};

// Whether box a must be drawn before box b. Only boxes that overlap on screen need an order.
// Separated on the ground, the one behind goes first; separated only in height, the lower one;
// both kinds at once can disagree (a backrest behind but above the legs), and then the ground
// decides. Boxes that truly intersect get no answer here: the caller keeps the author's order.
export const boxDrawsBefore = (a: Box, b: Box): boolean | null => {
  if (!boxesOverlapOnScreen(a, b)) return false;
  // Faces that touch count as separated. Turned parts are computed (1 - dy - h), so two faces that
  // meet exactly can land a rounding error apart: compare with a small tolerance.
  const behind = a.x + a.w <= b.x + EPS || a.y + a.h <= b.y + EPS;
  const ahead = b.x + b.w <= a.x + EPS || b.y + b.h <= a.y + EPS;
  if (behind || ahead) return behind && !ahead;
  if (a.z + a.height <= b.z + EPS) return true;
  if (b.z + b.height <= a.z + EPS) return false;
  return null;
};
