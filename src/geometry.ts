import { TILE_H, TILE_W } from './config';

export type Cell = Readonly<{ x: number; y: number }>; // integer cell, or integer grid vertex
export type Point = Readonly<{ x: number; y: number }>; // fractional grid position
export type Rect = Readonly<{ x: number; y: number; w: number; h: number }>;
export type ScreenPoint = Readonly<{ sx: number; sy: number }>;

// How many tiles a map has along x (w) and y (h). One object per size, so sizes compare by identity
// and can key caches (a view frame of a non-square map is the same map with w and h swapped).
export type Size = Readonly<{ w: number; h: number }>;
const sizes = new Map<string, Size>();
export const sizeOf = (w: number, h: number): Size => {
  const key = `${w}x${h}`;
  const known = sizes.get(key);
  if (known) return known;
  const made: Size = Object.freeze({ w, h });
  sizes.set(key, made);
  return made;
};
export const swapped = (s: Size): Size => sizeOf(s.h, s.w);

// A unit segment of a grid line. Axis 'x' runs from (x, y) to (x + 1, y); axis 'y' from (x, y) to (x, y + 1).
export type Edge = Readonly<{ axis: 'x' | 'y'; x: number; y: number }>;

// Grid point -> screen point. (x, y) maps to the TOP vertex of that cell's diamond.
export const toScreen = (x: number, y: number): ScreenPoint => ({
  sx: (x - y) * (TILE_W / 2),
  sy: (x + y) * (TILE_H / 2),
});

// Screen point -> fractional grid position
export const toGridPoint = (sx: number, sy: number): Point => ({
  x: (sx / (TILE_W / 2) + sy / (TILE_H / 2)) / 2,
  y: (sy / (TILE_H / 2) - sx / (TILE_W / 2)) / 2,
});

export const cellOf = (p: Point): Cell => ({ x: Math.floor(p.x), y: Math.floor(p.y) });

export const sameCell = (a: Cell | null, b: Cell | null): boolean =>
  a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y);

export const range = (n: number): readonly number[] => Array.from({ length: n }, (_, i) => i);

export const cellKey = (c: Cell): string => `${c.x},${c.y}`;

export const cellsOf = ({ x, y, w, h }: Rect): readonly Cell[] =>
  range(w * h).map((i) => ({ x: x + (i % w), y: y + Math.floor(i / w) }));

export const covers = (rect: Rect, { x, y }: Cell): boolean =>
  x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;

// Interiors overlap (sharing only an edge does not count)
export const rectsOverlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Rectangle spanning two corner cells, in any drag direction
export const rectBetween = (a: Cell, b: Cell): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(a.x - b.x) + 1,
  h: Math.abs(a.y - b.y) + 1,
});

// ===== Edges =====
export const edgeKey = (e: Edge): string => `${e.axis}:${e.x},${e.y}`;

export const sameEdge = (a: Edge, b: Edge): boolean => a.axis === b.axis && a.x === b.x && a.y === b.y;

// A zero-thickness rect along the edge, used for depth sorting
export const edgeRect = (e: Edge): Rect => ({ x: e.x, y: e.y, w: e.axis === 'x' ? 1 : 0, h: e.axis === 'y' ? 1 : 0 });

export const nearestVertex = (p: Point): Cell => ({ x: Math.round(p.x), y: Math.round(p.y) });

// The grid-line segment closest to a point, and how far the point is from it (in tiles)
export const nearestEdge = (p: Point): Readonly<{ edge: Edge; dist: number }> => {
  const dy = Math.abs(p.y - Math.round(p.y));
  const dx = Math.abs(p.x - Math.round(p.x));
  return dy <= dx
    ? { edge: { axis: 'x', x: Math.floor(p.x), y: Math.round(p.y) }, dist: dy }
    : { edge: { axis: 'y', x: Math.round(p.x), y: Math.floor(p.y) }, dist: dx };
};

// Unit edges on a straight run between two vertices, locked to the dominant axis
export const edgesBetween = (a: Cell, b: Cell): readonly Edge[] => {
  if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) {
    const lo = Math.min(a.x, b.x);
    return range(Math.abs(b.x - a.x)).map((i) => ({ axis: 'x', x: lo + i, y: a.y }));
  }
  const lo = Math.min(a.y, b.y);
  return range(Math.abs(b.y - a.y)).map((i) => ({ axis: 'y', x: a.x, y: lo + i }));
};

// True when the edge cuts through the inside of the rect (edges on its border do not count)
export const edgeInsideRect = (e: Edge, r: Rect): boolean =>
  e.axis === 'x'
    ? e.y > r.y && e.y < r.y + r.h && e.x >= r.x && e.x < r.x + r.w
    : e.x > r.x && e.x < r.x + r.w && e.y >= r.y && e.y < r.y + r.h;

// Every unit edge around the outside of a rect
export const perimeterEdges = (r: Rect): readonly Edge[] => [
  ...range(r.w).map((i): Edge => ({ axis: 'x', x: r.x + i, y: r.y })),
  ...range(r.w).map((i): Edge => ({ axis: 'x', x: r.x + i, y: r.y + r.h })),
  ...range(r.h).map((j): Edge => ({ axis: 'y', x: r.x, y: r.y + j })),
  ...range(r.h).map((j): Edge => ({ axis: 'y', x: r.x + r.w, y: r.y + j })),
];
