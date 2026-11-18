// The round terrain brush, as pure geometry on the grid. Painting goes by tiles (terrain is one kind
// per tile), so the brush is the set of tiles whose centers lie inside a circle. Its center snaps:
// to a tile's center for odd sizes and to a grid corner for even ones, so each size keeps one stable
// round shape wherever it is (a 4 is a 12-tile disc, a 5 a 21-tile one) and a stroke steps tile by tile.
import type { Cell, Point } from './geometry';

// How many tiles across the brush is
export const BRUSH_SIZES = [1, 2, 3, 4, 5, 7, 9, 12] as const;
export type BrushSize = (typeof BRUSH_SIZES)[number];
export const DEFAULT_BRUSH: BrushSize = 3;

// One size up or down the list, staying at its ends
export const stepBrush = (size: BrushSize, step: 1 | -1): BrushSize => {
  const i = BRUSH_SIZES.indexOf(size);
  return BRUSH_SIZES[Math.max(0, Math.min(BRUSH_SIZES.length - 1, i + step))]!;
};

// Where the brush sits for a pointer at p
export const brushCenter = (p: Point, size: BrushSize): Point =>
  size % 2 === 1 ? { x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 } : { x: Math.round(p.x), y: Math.round(p.y) };

// The circle the cursor shows (in grid units, centered where the brush sits)
export const brushCircle = (p: Point, size: BrushSize): Readonly<{ center: Point; radius: number }> => ({
  center: brushCenter(p, size),
  radius: size / 2,
});

const EPS = 1e-9;

// The tiles a brush at p covers, in row order
export const brushCells = (p: Point, size: BrushSize): readonly Cell[] => {
  const c = brushCenter(p, size);
  const r = size / 2;
  const out: Cell[] = [];
  for (let y = Math.floor(c.y - r); y <= Math.ceil(c.y + r); y++)
    for (let x = Math.floor(c.x - r); x <= Math.ceil(c.x + r); x++)
      if ((x + 0.5 - c.x) ** 2 + (y + 0.5 - c.y) ** 2 <= r * r + EPS) out.push({ x, y });
  return out;
};

// The tiles a stroke from a to b covers: the brush stamped every half tile along the way (and at both
// ends), so a quick drag leaves no gaps. Each tile once, in the order the stroke reaches it.
export const strokeCells = (a: Point, b: Point, size: BrushSize): readonly Cell[] => {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.5));
  const seen = new Set<string>();
  const out: Cell[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    brushCells({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, size).forEach((c) => {
      const k = `${c.x},${c.y}`;
      if (seen.has(k)) return;
      seen.add(k);
      out.push(c);
    });
  }
  return out;
};
