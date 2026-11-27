// Floor and path textures (#11): each pattern is drawn per tile as flat marks in the tile's world
// frame (u along world x, v along world y, 0 to 1), so a directional pattern (planks, bricks) keeps its
// direction in the world as the camera turns, and any randomness comes from a hash of the world tile,
// so it is the same from every side and after a reload.
import type { Near } from './diagonals';
import { shade } from './shapes';

export type PatternMark = Readonly<{ pts: readonly (readonly [number, number])[]; color: number; alpha?: number }>;
// a pattern gets its world tile, its color and what lies around it (near(dx, dy): the floor on the world
// tile at that offset, if any)
type Pattern = (wx: number, wy: number, color: number, near: Near) => PatternMark[];

// a stable 0..1 number for a world tile and a salt
const mix = (h: number, v: number): number => {
  h = Math.imul(h ^ v, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  return h ^ (h >>> 13);
};
const hash = (x: number, y: number, k: number): number => {
  const h = mix(mix(mix(0x27d4eb2f, x | 0), y | 0), k | 0);
  return (Math.imul(h ^ (h >>> 16), 0xc2b2ae35) >>> 0) / 4294967296;
};
const rect = (u0: number, v0: number, u1: number, v1: number, color: number, alpha = 1): PatternMark =>
  ({ pts: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], color, alpha });
const lighten = (c: number, f: number): number => {
  const ch = (s: number) => Math.min(255, Math.round(((c >> s) & 255) + (255 - ((c >> s) & 255)) * f));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};
const blob = (cu: number, cv: number, r: number, n: number, color: number, alpha = 1): PatternMark =>
  ({ pts: Array.from({ length: n }, (_, i) => [cu + r * Math.cos((i / n) * Math.PI * 2), cv + r * Math.sin((i / n) * Math.PI * 2)] as const), color, alpha });

// Planks along world x: n boards across the tile, each a touch lighter or darker, with seams between
// and an end joint at a hashed place in each board, so the joints stagger
const planks = (n: number, seam: number, joint = true): Pattern => (wx, wy, color) => {
  const out: PatternMark[] = [];
  for (let k = 0; k < n; k++) {
    const v0 = k / n, v1 = (k + 1) / n;
    const t = hash(wx, wy, k) - 0.5;
    out.push(rect(0, v0, 1, v1, t > 0 ? lighten(color, t * 0.16) : shade(color, 1 + t * 0.16)));
    if (joint && hash(wx, wy, k + 50) < 0.55) {
      const u = 0.1 + hash(wx, wy, k + 20) * 0.8;
      out.push(rect(u - seam / 2, v0, u + seam / 2, v1, shade(color, 0.72)));
    }
    out.push(rect(0, v1 - seam / 2, 1, Math.min(1, v1 + seam / 2), shade(color, 0.72)));
  }
  return out;
};

// Square tiles with grout, n by n per tile
const grid = (n: number, grout: number, groutColor?: number): Pattern => (_wx, _wy, color) => {
  const g = groutColor ?? shade(color, 0.8);
  const out: PatternMark[] = [];
  for (let k = 0; k <= n; k++) {
    const a = k / n;
    out.push(rect(Math.max(0, a - grout / 2), 0, Math.min(1, a + grout / 2), 1, g));
    out.push(rect(0, Math.max(0, a - grout / 2), 1, Math.min(1, a + grout / 2), g));
  }
  return out;
};

// Small specks scattered by hash: aggregate, carpet fibre, grains
const specks = (n: number, size: number, tones: readonly number[], alpha = 1): Pattern => (wx, wy, color) =>
  Array.from({ length: n }, (_, i) => {
    const u = hash(wx, wy, i * 3), v = hash(wx, wy, i * 3 + 1);
    const tone = tones[Math.floor(hash(wx, wy, i * 3 + 2) * tones.length)]!;
    const c = tone >= 1 ? lighten(color, tone - 1) : shade(color, tone);
    const s = size * (0.7 + hash(wx, wy, i + 99) * 0.6);
    return rect(u * (1 - s), v * (1 - s), u * (1 - s) + s, v * (1 - s) + s, c, alpha);
  });

// Bricks in running bond along world x: rows of bricks half a tile long, every other row shifted
const bricks = (rows: number, mortar: number): Pattern => (wx, wy, color) => {
  const m = shade(color, 0.62);
  const out: PatternMark[] = [rect(0, 0, 1, 1, lighten(m, 0.35))];
  const len = 0.5;
  for (let r = 0; r < rows; r++) {
    const v0 = r / rows + mortar / 2, v1 = (r + 1) / rows - mortar / 2;
    const off = (r + wy * rows) % 2 === 0 ? 0 : len / 2;
    for (let s = -1; s < 3; s++) {
      const u0 = Math.max(0, s * len + off + mortar / 2), u1 = Math.min(1, (s + 1) * len + off - mortar / 2);
      if (u1 <= u0) continue;
      // keyed by where the brick starts in the world, so a brick cut by the tile edge keeps one tone
      const t = hash(Math.round((wx + s * len + off) * 4), wy * rows + r, 7) - 0.5;
      out.push(rect(u0, v0, u1, v1, t > 0 ? lighten(color, t * 0.18) : shade(color, 1 + t * 0.2)));
    }
  }
  return out;
};

// Cobbles: 3 by 3 rounded setts in dark joints, each a touch different
const cobbles: Pattern = (wx, wy, color) => {
  const out: PatternMark[] = [rect(0, 0, 1, 1, shade(color, 0.62))];
  const n = 3;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const t = hash(wx * n + i, wy * n + j, 3) - 0.5;
    const c = t > 0 ? lighten(color, t * 0.3) : shade(color, 1 + t * 0.3);
    const cu = (i + 0.5) / n + (hash(wx * n + i, wy * n + j, 4) - 0.5) * 0.04;
    const cv = (j + 0.5) / n + (hash(wx * n + i, wy * n + j, 5) - 0.5) * 0.04;
    out.push(blob(cu, cv, 0.15, 8, c));
  }
  return out;
};

// Flagstones: four stones per tile split at a hashed point, with joints between
const flagstones = (joint: number, jointColor?: (c: number) => number): Pattern => (wx, wy, color) => {
  const cu = 0.35 + hash(wx, wy, 1) * 0.3, cv = 0.35 + hash(wx, wy, 2) * 0.3;
  const out: PatternMark[] = [rect(0, 0, 1, 1, jointColor ? jointColor(color) : shade(color, 0.7))];
  const g = joint / 2;
  const quads: [number, number, number, number][] = [[0, 0, cu, cv], [cu, 0, 1, cv], [0, cv, cu, 1], [cu, cv, 1, 1]];
  quads.forEach(([u0, v0, u1, v1], k) => {
    const t = hash(wx, wy, k + 10) - 0.5;
    out.push(rect(u0 + g, v0 + g, u1 - g, v1 - g, t > 0 ? lighten(color, t * 0.2) : shade(color, 1 + t * 0.2)));
  });
  return out;
};

// Terrazzo: chips of a few stones in a pale ground
const TERRAZZO_CHIPS = [0x8a6f5e, 0xf5efe6, 0x6b7280, 0xb07a5a, 0xe7d3b8] as const;
const terrazzo: Pattern = (wx, wy) =>
  Array.from({ length: 22 }, (_, i) => {
    const u = 0.05 + hash(wx, wy, i * 4) * 0.9, v = 0.05 + hash(wx, wy, i * 4 + 1) * 0.9;
    const r = 0.018 + hash(wx, wy, i * 4 + 2) * 0.03;
    return blob(u, v, r, 5, TERRAZZO_CHIPS[Math.floor(hash(wx, wy, i * 4 + 3) * TERRAZZO_CHIPS.length)]!, 0.9);
  });

// Marble: a couple of soft veins wandering across, continued from tile to tile along world x
const marble: Pattern = (wx, wy, color) => {
  const vein = shade(color, 0.8);
  const out: PatternMark[] = [];
  for (let k = 0; k < 2; k++) {
    const y0 = hash(wx, wy, k) * 0.8 + 0.1;
    const y1 = hash(wx + 1, wy, k) * 0.8 + 0.1;
    const steps = 6;
    for (let s = 0; s < steps; s++) {
      const a = s / steps, b = (s + 1) / steps;
      const ya = y0 + (y1 - y0) * a + Math.sin((wx + a) * 7 + k) * 0.05;
      const yb = y0 + (y1 - y0) * b + Math.sin((wx + b) * 7 + k) * 0.05;
      const w = 0.012;
      out.push({ pts: [[a, ya - w], [b, yb - w], [b, yb + w], [a, ya + w]], color: vein, alpha: 0.7 });
    }
  }
  return out;
};

// Overgrown path: old flagstones with grass in the joints and tufts creeping over the edges
const OG_GRASS = [0x4f8a3c, 0x5f9a46, 0x3f7a34] as const;
const overgrown: Pattern = (wx, wy, color) => {
  const out = flagstones(0.1, () => 0x4a7d36)(wx, wy, color, () => undefined);
  const n = 3 + Math.floor(hash(wx, wy, 77) * 5);
  for (let i = 0; i < n; i++) {
    const cu = hash(wx, wy, i * 5 + 30), cv = hash(wx, wy, i * 5 + 31);
    const r = 0.07 + hash(wx, wy, i * 5 + 32) * 0.12;
    const g = OG_GRASS[Math.floor(hash(wx, wy, i * 5 + 33) * OG_GRASS.length)]!;
    // a tuft: a few overlapping blobs (clipped to the tile's shape when drawn)
    for (let b = 0; b < 3; b++) {
      const du = (hash(wx, wy, i * 5 + 40 + b) - 0.5) * r * 1.4, dv = (hash(wx, wy, i * 5 + 50 + b) - 0.5) * r * 1.4;
      out.push(blob(cu + du, cv + dv, r * (0.6 + b * 0.15), 7, b === 1 ? lighten(g, 0.1) : g));
    }
  }
  return out;
};

// Dirt path: packed earth with specks and a few sprouts; grass creeps in over every edge that faces
// bare ground (fringe below)
const GRASS_EDGE = [0x3a7d44, 0x447f42, 0x4b8f4f] as const;
const dirtPath: Pattern = (wx, wy, color, near) => {
  const out = specks(16, 0.05, [0.78, 1.1, 1.18])(wx, wy, color, near);
  const sprouts = Math.floor(hash(wx, wy, 90) * 3);
  for (let i = 0; i < sprouts; i++)
    out.push(blob(0.25 + hash(wx, wy, 91 + i) * 0.5, 0.25 + hash(wx, wy, 95 + i) * 0.5, 0.035 + hash(wx, wy, 99 + i) * 0.04, 6, GRASS_EDGE[1 + (i % 2)]!));
  return out;
};

// Grass creeping in over an edge that faces bare ground (a straight side or a diagonal cut): a ragged
// band reaching in from the edge, with tufts. Keyed by where the edge lies in the world, so it is the
// same from every side.
export const fringe = (wx: number, wy: number, [a, b]: readonly [readonly [number, number], readonly [number, number]], outline: readonly (readonly [number, number])[]): PatternMark[] => {
  const cx = outline.reduce((s, p) => s + p[0], 0) / outline.length, cy = outline.reduce((s, p) => s + p[1], 0) / outline.length;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  if ((cx - mx) * nx + (cy - my) * ny < 0) { nx = -nx; ny = -ny; } // point inward
  const kx = Math.round((wx + mx) * 8), ky = Math.round((wy + my) * 8);
  const n = Math.max(3, Math.round(len * 8));
  const depth = (i: number) => 0.06 + hash(kx, ky, i) * 0.16;
  const at = (t: number, d: number) => [a[0] + (b[0] - a[0]) * t + nx * d, a[1] + (b[1] - a[1]) * t + ny * d] as const;
  const pts: (readonly [number, number])[] = [at(0, -0.01)];
  for (let i = 0; i <= n; i++) pts.push(at(i / n, depth(i)));
  pts.push(at(1, -0.01));
  const out: PatternMark[] = [{ pts, color: GRASS_EDGE[0] }];
  for (let i = 0; i < Math.max(2, Math.round(len * 4)); i++) {
    const t = hash(kx, ky, 40 + i), d = depth(Math.round(t * n)) * (0.6 + hash(kx, ky, 60 + i) * 0.7);
    const [u, v] = at(t, d);
    out.push(blob(u, v, 0.04 + hash(kx, ky, 80 + i) * 0.05, 7, GRASS_EDGE[1 + (i % 2)]!));
  }
  return out;
};

// floors whose edges blend into the ground: grass creeps in over every edge facing bare ground, and
// those edges take the lawn's grid line instead of a darker shade of the floor
export const BLENDS_INTO_GROUND: ReadonlySet<string> = new Set(['dirt', 'leafy-dirt']);

// Crazy paving: irregular stones of every size and angle in mortar. The stones are the Voronoi cells of
// points jittered on a world lattice (3 per tile each way), so a stone cut by a tile edge carries on into
// the next tile with the same outline and shade
const CP_N = 3;
const crazySite = (gx: number, gy: number): readonly [number, number] =>
  [(gx + 0.15 + hash(gx, gy, 311) * 0.7) / CP_N, (gy + 0.15 + hash(gx, gy, 312) * 0.7) / CP_N];
const halfPlaneClip = (poly: (readonly [number, number])[], px: number, py: number, nx: number, ny: number): (readonly [number, number])[] => {
  // keep the side where (p - P) . n <= 0
  const out: (readonly [number, number])[] = [];
  const d = (q: readonly [number, number]) => (q[0] - px) * nx + (q[1] - py) * ny;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length]!;
    const da = d(a), db = d(b);
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  });
  return out;
};
const crazyPaving: Pattern = (wx, wy, color) => {
  const out: PatternMark[] = [rect(0, 0, 1, 1, shade(color, 0.66))];
  const gap = 0.022;
  for (let gx = wx * CP_N - 1; gx <= wx * CP_N + CP_N; gx++) for (let gy = wy * CP_N - 1; gy <= wy * CP_N + CP_N; gy++) {
    const [sx, sy] = crazySite(gx, gy);
    let cell: (readonly [number, number])[] = [[wx - 0.5, wy - 0.5], [wx + 1.5, wy - 0.5], [wx + 1.5, wy + 1.5], [wx - 0.5, wy + 1.5]];
    for (let ox = -2; ox <= 2 && cell.length; ox++) for (let oy = -2; oy <= 2 && cell.length; oy++) {
      if (ox === 0 && oy === 0) continue;
      const [tx, ty] = crazySite(gx + ox, gy + oy);
      const nx = tx - sx, ny = ty - sy, len = Math.hypot(nx, ny);
      // the bisector moved toward this site by half the mortar gap
      const mx = (sx + tx) / 2 - (nx / len) * gap, my = (sy + ty) / 2 - (ny / len) * gap;
      cell = halfPlaneClip(cell, mx, my, nx / len, ny / len);
    }
    if (cell.length < 3) continue;
    const t = hash(gx, gy, 313) - 0.5;
    const c = t > 0 ? lighten(color, t * 0.3) : shade(color, 1 + t * 0.3);
    out.push({ pts: cell.map(([x, y]) => [x - wx, y - wy] as const), color: c });
  }
  return out;
};

// A lens: a pointed oval at an angle, half-length len and half-width len * fat (leaves, diamond plate lugs)
const lens = (cu: number, cv: number, len: number, angle: number, color: number, fat = 0.42, alpha = 1): PatternMark => {
  const n = 10, ca = Math.cos(angle), sa = Math.sin(angle);
  return { pts: Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    // pointed at both ends: the width falls off toward the tips
    const x = Math.cos(a) * len, y = Math.sin(a) * len * fat * Math.abs(Math.sin(a)) ** 0.4;
    return [cu + x * ca - y * sa, cv + x * sa + y * ca] as const;
  }), color, alpha };
};
// Leafy dirt path: the dirt path almost covered by fallen leaves, the earth showing between them. Leaves
// belong to the world tile they fall on but reach over its edges, so the tiles around lend theirs too and
// a leaf is never cut at a tile edge; overlaps stack in one order everywhere. Muted colors, more greens
// than yellows (picked evenly, so the list sets the mix: 3 yellows, 5 greens)
const LEAVES = [0xd6c467, 0xc7b158, 0xb5a352, 0xa8b25e, 0x8fa553, 0x7a974c, 0x667f48, 0x8aa36a] as const;
const LEAVES_PER_TILE = 40;
const leavesOf = (tx: number, ty: number) =>
  Array.from({ length: LEAVES_PER_TILE }, (_, i) => ({
    u: tx + hash(tx, ty, 121 + i * 5), v: ty + hash(tx, ty, 122 + i * 5),
    len: 0.08 + hash(tx, ty, 123 + i * 5) * 0.05, a: hash(tx, ty, 124 + i * 5) * Math.PI,
    c: LEAVES[Math.floor(hash(tx, ty, 125 + i * 5) * LEAVES.length)]!, order: hash(tx, ty, 126 + i * 5),
  }));
const leafyDirt: Pattern = (wx, wy, color, near) => {
  const leaves = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].flatMap((dy) => leavesOf(wx + dx, wy + dy)))
    .filter((l) => l.u > wx - l.len && l.u < wx + 1 + l.len && l.v > wy - l.len && l.v < wy + 1 + l.len)
    .sort((a, b) => a.order - b.order);
  return [...dirtPath(wx, wy, color, near), ...leaves.map((l) => lens(l.u - wx, l.v - wy, l.len, l.a, l.c, 0.48))];
};

// Diamond plate: tread plate with small raised lugs, 7 by 7 per tile
const diamondPlate: Pattern = (wx, wy, color) => {
  const out: PatternMark[] = [rect(0, 0, 1, 0.02, shade(color, 0.8)), rect(0, 0, 0.02, 1, shade(color, 0.8))];
  // lugs on a square lattice, each turned a quarter from its neighbors, lying along the plate's edges so
  // they slant on screen like a tread plate seen straight on; each lug is a raised lens: a shadow below,
  // the body, a bright ridge on top
  const n = 7, step = 1 / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const cu = (i + 0.5) * step, cv = (j + 0.5) * step;
    const a = (i + j) % 2 === 0 ? 0 : Math.PI / 2;
    const len = step * 0.4;
    out.push(lens(cu + 0.008, cv + 0.008, len, a, shade(color, 0.32), 0.4));
    out.push(lens(cu, cv, len, a, shade(color, 0.78), 0.4));
    out.push(lens(cu - 0.004, cv - 0.004, len * 0.8, a, lighten(color, 0.7), 0.2));
  }
  return out;
};

// Steel grating: bars along world x tied by cross bars, with the dark gaps of the open grid between
const steelGrating: Pattern = (_wx, _wy, color) => {
  const out: PatternMark[] = [rect(0, 0, 1, 1, 0x1f2328)];
  const bars = 7;
  for (let k = 0; k < bars; k++) {
    const v = (k + 0.5) / bars;
    out.push(rect(0, v - 0.03, 1, v + 0.03, color));
  }
  for (let k = 0; k < 3; k++) {
    const u = (k + 0.5) / 3;
    out.push(rect(u - 0.018, 0, u + 0.018, 1, shade(color, 0.85)));
  }
  out.push(rect(0, 0, 1, 0.035, lighten(color, 0.15)), rect(0, 0.965, 1, 1, shade(color, 0.7)));
  return out;
};

// Perforated metal: a plate with rows of round holes, offset row to row
const perforated: Pattern = (_wx, wy, color) => {
  const out: PatternMark[] = [];
  const n = 6;
  for (let j = 0; j < n; j++) {
    const off = ((j + wy * n) % 2) * 0.5;
    for (let i = 0; i < n; i++) {
      const cu = (i + 0.25 + off) / n, cv = (j + 0.5) / n;
      if (cu > 1 - 0.03) continue;
      out.push(blob(cu, cv, 0.035, 8, 0x2a2f35));
    }
  }
  out.push(rect(0, 0, 1, 0.015, shade(color, 0.75)), rect(0, 0, 0.015, 1, shade(color, 0.75)));
  return out;
};

// Rusty steel: weathered plates (two per tile) with blotches of darker and brighter rust and a rivet
// at each plate corner
const rustySteel: Pattern = (wx, wy, color) => {
  const out: PatternMark[] = [];
  for (let i = 0; i < 9; i++) {
    const c = hash(wx, wy, 200 + i) < 0.5 ? shade(color, 0.82) : lighten(color, 0.12);
    out.push(blob(hash(wx, wy, 210 + i), hash(wx, wy, 220 + i), 0.06 + hash(wx, wy, 230 + i) * 0.12, 9, c, 0.55));
  }
  out.push(rect(0, 0.49, 1, 0.51, shade(color, 0.6)), rect(0, 0, 1, 0.02, shade(color, 0.6)), rect(0, 0, 0.02, 1, shade(color, 0.6)));
  [[0.08, 0.08], [0.92, 0.08], [0.08, 0.42], [0.92, 0.42], [0.08, 0.58], [0.92, 0.58], [0.08, 0.92], [0.92, 0.92]].forEach(([u, v]) =>
    out.push(blob(u!, v!, 0.022, 6, lighten(color, 0.22))));
  return out;
};

export const PATTERNS: Readonly<Record<string, Pattern>> = {
  // floors
  'wood-floor': planks(4, 0.025),
  'light-oak': planks(4, 0.022),
  'dark-wood': planks(3, 0.03),
  'stone-floor': flagstones(0.04),
  'white-tile': grid(2, 0.04, 0xc9d1d9),
  marble: marble,
  terrazzo: terrazzo,
  linoleum: specks(14, 0.05, [0.92, 1.06], 0.8),
  carpet: specks(30, 0.035, [0.88, 1.06], 0.7),
  'blue-carpet': specks(30, 0.035, [0.85, 1.08], 0.7),
  'grey-carpet': specks(30, 0.035, [0.88, 1.08], 0.7),
  'gym-floor': planks(5, 0.018, false),
  'turf-grass': specks(26, 0.03, [0.85, 1.08]),
  'turf-grass-dark': specks(26, 0.03, [0.85, 1.1]),
  // paths
  stone: flagstones(0.05),
  dirt: dirtPath,
  deck: planks(3, 0.05),
  asphalt: specks(40, 0.025, [0.82, 1.12, 1.2]),
  concrete: (wx, wy, c, near) => [...grid(1, 0.025)(wx, wy, c, near), ...specks(14, 0.025, [0.92, 1.05], 0.8)(wx, wy, c, near)],
  'red-brick': bricks(4, 0.04),
  cobblestone: cobbles,
  'overgrown-path': overgrown,
  'crazy-paving': crazyPaving,
  'leafy-dirt': leafyDirt,
  'diamond-plate': diamondPlate,
  'steel-grating': steelGrating,
  'perforated-metal': perforated,
  'rusty-steel': rustySteel,
};
