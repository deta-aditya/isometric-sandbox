// Composite drawing for catalog objects, built from the shape primitives.
import type { Graphics } from 'pixi.js';
import { type Rotation, getObjectDef, marksOf, partsOf } from '../catalog';
import { type Cell, toScreen } from '../geometry';
import { SHAPES } from './shapes';

// `joins` says which sides a smart piece meets a neighbor of its own kind: [-y, +x, +y, -x]
export type Joins = readonly [boolean, boolean, boolean, boolean];
// sink: pixels to lower the whole object by (something floating on sunken water)
export type ObjectLook = Cell & Readonly<{ defId: string; rotation: Rotation; alpha: number; joins?: Joins; paved?: boolean; sink?: number }>;

export const drawObject = (g: Graphics, item: ObjectLook): void => {
  const def = getObjectDef(item.defId);
  if (def.smart === 'median') return drawMedian(g, item, item.joins ?? [false, false, false, false]);
  if (def.marks) return drawMarks(g, item);
  const sink = item.sink ?? 0;
  partsOf(def, item.rotation).forEach((p) =>
    SHAPES[p.shape](g, { x: item.x + p.dx, y: item.y + p.dy, w: p.w, h: p.h }, p.z - sink, p.height, p.color, item.alpha),
  );
};

// A median tile: a curb around a planting bed. Sides that meet another median run on into it (no curb
// across the join); a corner where both of its sides are free is rounded, so a run ends in a round nose.
const CURB = 0xd6d3d1;
const BED = 0x4d7c0f;
const REFUGE = 0xc6c6c0; // paved, where a crosswalk crosses the median
const MARGIN = 0.08; // the curb's outer edge, in from a free side
const CURB_W = 0.12;
const NOSE = 0.42; // corner radius at a free corner
const drawMedian = (g: Graphics, item: ObjectLook, [n, e, s, w]: Joins): void => {
  const shape = (inset: number, radius: number) => {
    const x0 = item.x + (w ? 0 : inset);
    const x1 = item.x + 1 - (e ? 0 : inset);
    const y0 = item.y + (n ? 0 : inset);
    const y1 = item.y + 1 - (s ? 0 : inset);
    // corners clockwise from the top left: centre, start angle, radius (0 = square)
    const corners: readonly (readonly [number, number, number, number])[] = [
      [x0, y0, Math.PI, !n && !w ? radius : 0],
      [x1, y0, 1.5 * Math.PI, !n && !e ? radius : 0],
      [x1, y1, 0, !s && !e ? radius : 0],
      [x0, y1, 0.5 * Math.PI, !s && !w ? radius : 0],
    ];
    const pts = corners.flatMap(([cx, cy, a, r]) => {
      if (r === 0) return [[cx, cy] as const];
      // the arc's centre sits r in from the corner, on both axes
      const ox = cx + (cx === x0 ? r : -r);
      const oy = cy + (cy === y0 ? r : -r);
      return Array.from({ length: 7 }, (_, i) => [ox + r * Math.cos(a + (i * Math.PI) / 12), oy + r * Math.sin(a + (i * Math.PI) / 12)] as const);
    });
    return pts.flatMap(([x, y]) => {
      const p = toScreen(x, y);
      return [p.sx, p.sy];
    });
  };
  g.poly(shape(MARGIN, NOSE)).fill({ color: CURB, alpha: item.alpha });
  g.poly(shape(MARGIN + CURB_W, NOSE - CURB_W)).fill({ color: item.paved ? REFUGE : BED, alpha: item.alpha });
};

// A flat ground piece: its marks as polygons on the ground, in the order listed
const drawMarks = (g: Graphics, item: ObjectLook): void =>
  marksOf(getObjectDef(item.defId), item.rotation).forEach((m) => {
    const pts = m.pts.flatMap(([x, y]) => {
      const p = toScreen(item.x + x, item.y + y);
      return [p.sx, p.sy];
    });
    g.poly(pts).fill({ color: m.color, alpha: (m.alpha ?? 1) * item.alpha });
  });
