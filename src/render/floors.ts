// Floors and paths with their textures (#11). Worked out in the world's frame (u along world x, v along
// world y), so patterns, diagonal edges and grassy fringes are the same from every side; the caller
// turns the result to the view when drawing. floorPieces is pure (tested); drawFloorPieces paints.
import type { Graphics } from 'pixi.js';
import { getTileDef } from '../catalog';
import { type Near, type Segment, type Uv, bareFills, clip, onSegment, pathShape, squareShape } from './diagonals';
import { BLENDS_INTO_GROUND, PATTERNS, type PatternMark, fringe } from './patterns';
import { GRID_LINE, pt, shade } from './shapes';

export type WorldTile = Readonly<{ wx: number; wy: number; defId: string; color: number }>;
// One piece of floor in a world tile: its outline (convex), the marks painted on it (pattern and fringe,
// clipped to the outline) and each outline edge's line color
export type FloorPiece = Readonly<{
  wx: number; wy: number; defId: string; color: number;
  outline: readonly Uv[];
  marks: readonly PatternMark[];
  edges: readonly Readonly<{ a: Uv; b: Uv; color: number }>[];
}>;

// floors that keep the plain look: one square in their color, no pattern, no diagonal (the fast path)
export const isPlain = (defId: string): boolean => !PATTERNS[defId] && getTileDef(defId).group !== 'paths';

const piece = (t: WorldTile, outline: readonly Uv[], open: readonly Segment[], near: Near): FloorPiece => {
  const inside = (m: PatternMark): PatternMark[] => {
    const pts = clip(m.pts, outline);
    return pts.length >= 3 ? [{ ...m, pts }] : [];
  };
  const blends = BLENDS_INTO_GROUND.has(t.defId);
  const marks = [
    ...(PATTERNS[t.defId]?.(t.wx, t.wy, t.color, near) ?? []).flatMap(inside),
    ...(blends ? open.flatMap((seg) => fringe(t.wx, t.wy, seg, outline)).flatMap(inside) : []),
  ];
  // an edge facing bare ground takes the lawn's grid line on a floor that blends in, else the floor's
  // own darker outline
  const isOpen = (a: Uv, b: Uv) => open.some(([p, q]) => onSegment(p, q, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]));
  const edges = outline.map((a, i) => {
    const b = outline[(i + 1) % outline.length]!;
    return { a, b, color: blends && isOpen(a, b) ? GRID_LINE : shade(t.color, 0.85) };
  });
  return { ...t, outline, marks, edges };
};

// Every piece for these tiles: each tile's own shape (paths take diagonal edges where they step
// diagonally, other floors stay square), then the corners of path that bare tiles beside them take.
// floorAt says what lies on any world tile (bare ground is undefined).
// keep(wx, wy) limits the result to pieces in some world tiles (a chunk of the map): tiles outside it
// still count as neighbors, and their bare corners are left to whoever draws there.
export const floorPieces = (
  tiles: readonly WorldTile[], floorAt: (wx: number, wy: number) => string | undefined, keep: (wx: number, wy: number) => boolean = () => true,
): FloorPiece[] => {
  const out: FloorPiece[] = [];
  const bare = new Set<string>();
  tiles.forEach((t) => {
    const near: Near = (dx, dy) => floorAt(t.wx + dx, t.wy + dy);
    const isPath = getTileDef(t.defId).group === 'paths';
    if (keep(t.wx, t.wy)) {
      const shape = isPath ? pathShape(near, t.defId) : squareShape(near);
      out.push(piece(t, shape.poly, shape.open, near));
    }
    if (isPath) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (near(dx, dy) === undefined && keep(t.wx + dx, t.wy + dy)) bare.add(`${t.wx + dx},${t.wy + dy}`);
  });
  bare.forEach((key) => {
    const [wx, wy] = key.split(',').map(Number) as [number, number];
    const near: Near = (dx, dy) => floorAt(wx + dx, wy + dy);
    bareFills(near).forEach(({ id, tri, open }) => {
      if (getTileDef(id).group !== 'paths') return; // only paths take diagonals
      out.push(piece({ wx, wy, defId: id, color: getTileDef(id).color }, tri, [open], (dx, dy) => (dx === 0 && dy === 0 ? id : near(dx, dy))));
    });
  });
  return out;
};

// Paint pieces; toView turns a world point to the drawn (view) frame. lines is the outline alpha (0
// leaves outlines off, for when grid lines are hidden).
export const drawFloorPieces = (g: Graphics, pieces: readonly FloorPiece[], toView: (x: number, y: number) => Readonly<{ x: number; y: number }>, lines: number): void => {
  pieces.forEach((p) => {
    const screen = (pts: readonly Uv[]) => pts.flatMap(([u, v]) => { const q = toView(p.wx + u, p.wy + v); return pt([q.x, q.y, 0]); });
    g.poly(screen(p.outline)).fill(p.color);
    p.marks.forEach((m) => g.poly(screen(m.pts)).fill({ color: m.color, alpha: m.alpha ?? 1 }));
    if (lines > 0) p.edges.forEach(({ a, b, color }) => g.poly(screen([a, b]), false).stroke({ width: 1, color, alpha: lines }));
  });
};
