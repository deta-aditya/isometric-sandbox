// Diagonal paths: where path tiles step diagonally, the path is drawn with 45 degree edges instead of
// a staircase. Worked out per tile in the tile's world frame (u along world x, v along world y), from
// which neighbors hold the same path:
// - a corner of a path tile is cut (from the middle of one side to the middle of the other) when both
//   tiles beside that corner are bare ground and the edge carries on diagonally: the tile one step along
//   the cut has the same cut corner (a band of steps), or the cut runs on into a notch beside it (a single
//   jog). A lone tile, a straight path's end, a right-angle turn and the corners of a square plaza stay
//   square.
// - a bare tile beside such an edge gets a triangle of path in its corner, where both tiles beside that
//   corner are the same path: across a gap where two path tiles touch only at a corner (a one-tile
//   diagonal), in the notch of a band of steps (the next notch along carries on), or at a single jog
//   (the path tile beside it has its corner cut).
// Cuts and triangles together turn a staircase into one straight diagonal edge.
export type Uv = readonly [number, number];
export type Segment = readonly [Uv, Uv];
export type Shape = Readonly<{ poly: readonly Uv[]; open: readonly Segment[] }>;
// what lies on the world tile at an offset: the floor id, or undefined for bare ground
export type Near = (dx: number, dy: number) => string | undefined;

type Corner = readonly [0 | 1, 0 | 1]; // (cu, cv)
const CORNERS: readonly Corner[] = [[0, 0], [1, 0], [1, 1], [0, 1]]; // clockwise with v pointing down
const side = (cu: 0 | 1, cv: 0 | 1) => ({ hx: cu === 1 ? 1 : -1, vy: cv === 1 ? 1 : -1 });
// the cut line runs from the middle of the side before the corner to the middle of the side after it
const cutPoints = ([cu, cv]: Corner): readonly [Uv, Uv] => {
  // going clockwise: (0,0) comes off the left side onto the top, (1,0) off the top onto the right,
  // (1,1) off the right onto the bottom, (0,1) off the bottom onto the left
  const prev: Uv = cu === cv ? [cu, 0.5] : [0.5, cv];
  const next: Uv = cu === cv ? [0.5, cv] : [cu, 0.5];
  return [prev, next];
};
// the direction a cut line runs, as a tile step: down-right for (1,0) and (0,1), up-right otherwise
const along = ([cu, cv]: Corner): readonly [number, number] => (cu !== cv ? [1, 1] : [1, -1]);

// a corner of the tile at (dx, dy) is convex: that tile is the path, both tiles beside the corner bare,
// and the tile across the corner is not the path (else it is a one-tile diagonal: kept, and bridged)
const convexAt = (near: Near, id: string, dx: number, dy: number, c: Corner): boolean => {
  const { hx, vy } = side(...c);
  return near(dx, dy) === id && near(dx + hx, dy) === undefined && near(dx, dy + vy) === undefined && near(dx + hx, dy + vy) !== id;
};
// the corner opposite c in a tile: where the cut line through c meets the next tile along
const opposite = ([cu, cv]: Corner): Corner => [(1 - cu) as 0 | 1, (1 - cv) as 0 | 1];
const cut = (near: Near, id: string, c: Corner): boolean => {
  if (!convexAt(near, id, 0, 0, c)) return false;
  const [sx, sy] = along(c);
  const { hx, vy } = side(...c);
  // a band of steps (the same cut one step along), or a single jog: the cut line runs on into a notch
  // in the bare tile beside this corner
  return convexAt(near, id, sx, sy, c) || convexAt(near, id, -sx, -sy, c)
    || notchAt(near, hx, 0, opposite(c)) === id || notchAt(near, 0, vy, opposite(c)) === id;
};

// a bare tile at (dx, dy) whose corner c sits between two tiles of the same path
const notchAt = (near: Near, dx: number, dy: number, c: Corner): string | undefined => {
  const { hx, vy } = side(...c);
  if (near(dx, dy) !== undefined) return undefined;
  const a = near(dx + hx, dy), b = near(dx, dy + vy);
  return a !== undefined && a === b ? a : undefined;
};
// the path that fills corner c of this bare tile, if any
export const fillAt = (near: Near, c: Corner): string | undefined => {
  const id = notchAt(near, 0, 0, c);
  if (id === undefined) return undefined;
  const { hx, vy } = side(...c);
  if (near(hx, vy) !== id) return id; // a one-tile diagonal: bridge the gap
  const [sx, sy] = along(c);
  // a band of steps (the next notch along), or a single jog: the cut corner of the path tile beside it
  return notchAt(near, sx, sy, c) === id || notchAt(near, -sx, -sy, c) === id
    || convexAt(near, id, hx, 0, opposite(c)) || convexAt(near, id, 0, vy, opposite(c)) ? id : undefined;
};

// The shape of a path tile: its outline (convex) and the parts of it that face bare ground
export const pathShape = (near: Near, id: string): Shape => {
  const cuts = CORNERS.map((c) => cut(near, id, c));
  const poly: Uv[] = [];
  CORNERS.forEach((c, i) => {
    if (cuts[i]) poly.push(...cutPoints(c));
    else poly.push(c);
  });
  // open parts: each cut, and each half side whose neighbor is bare and not filled at that corner
  const open: Segment[] = [];
  CORNERS.forEach((c, i) => { if (cuts[i]) open.push(cutPoints(c)); });
  // the four sides as (neighbor offset, from corner index, to corner index)
  const sides: readonly [number, number, number, number][] = [[0, -1, 0, 1], [1, 0, 1, 2], [0, 1, 2, 3], [-1, 0, 3, 0]];
  sides.forEach(([dx, dy, i, j]) => {
    if (near(dx, dy) !== undefined) return;
    const a = CORNERS[i]!, b = CORNERS[j]!;
    const mid: Uv = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    // each half: from a corner to the middle; gone if that corner is cut; covered if the bare neighbor
    // fills its own corner there (the same point, seen from the neighbor)
    ([[i, a], [j, b]] as const).forEach(([k, corner]) => {
      if (cuts[k]) return;
      const nc: Corner = [(dx === 0 ? corner[0] : 1 - corner[0]) as 0 | 1, (dy === 0 ? corner[1] : 1 - corner[1]) as 0 | 1];
      const nearN: Near = (ex, ey) => near(dx + ex, dy + ey);
      if (fillAt(nearN, nc) === id) return;
      open.push(k === i ? [corner, mid] : [mid, corner]);
    });
  });
  return { poly: dedupe(poly), open };
};

// The triangles of path a bare tile takes in its corners: (path id, triangle, its open edge)
export const bareFills = (near: Near): readonly Readonly<{ id: string; tri: readonly Uv[]; open: Segment }>[] =>
  CORNERS.flatMap((c) => {
    const id = fillAt(near, c);
    if (id === undefined) return [];
    const [p, q] = cutPoints(c);
    return [{ id, tri: [p, c, q], open: [p, q] as Segment }];
  });

const dedupe = (pts: Uv[]): Uv[] => pts.filter((p, i) => { const q = pts[(i + pts.length - 1) % pts.length]!; return p[0] !== q[0] || p[1] !== q[1]; });

// Clip a polygon to a convex one (Sutherland-Hodgman); both clockwise or both counterclockwise
export const clip = (subject: readonly Uv[], clipper: readonly Uv[]): Uv[] => {
  let out: Uv[] = [...subject];
  const n = clipper.length;
  // the clipper's winding decides which side is inside
  const area = clipper.reduce((s, p, i) => { const q = clipper[(i + 1) % n]!; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
  const sign = area > 0 ? 1 : -1;
  for (let i = 0; i < n && out.length > 0; i++) {
    const a = clipper[i]!, b = clipper[(i + 1) % n]!;
    const inside = (p: Uv) => sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) >= -1e-9;
    const cross = (p: Uv, q: Uv): Uv => {
      const d1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      const d2 = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
      const t = d1 / (d1 - d2);
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    };
    const input = out;
    out = [];
    input.forEach((p, k) => {
      const q = input[(k + 1) % input.length]!;
      if (inside(p)) { out.push(p); if (!inside(q)) out.push(cross(p, q)); }
      else if (inside(q)) out.push(cross(p, q));
    });
  }
  return out;
};

// A plain square tile: every side facing bare ground is open
export const squareShape = (near: Near): Shape => {
  const sides: readonly [number, number, Uv, Uv][] = [[0, -1, [0, 0], [1, 0]], [1, 0, [1, 0], [1, 1]], [0, 1, [1, 1], [0, 1]], [-1, 0, [0, 1], [0, 0]]];
  return { poly: CORNERS, open: sides.filter(([dx, dy]) => near(dx, dy) === undefined).map(([, , a, b]) => [a, b] as Segment) };
};
export const onSegment = (a: Uv, b: Uv, p: Uv): boolean => {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  if (Math.abs(cross) > 1e-9) return false;
  const dot = (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]);
  return dot >= -1e-9 && dot <= (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + 1e-9;
};
