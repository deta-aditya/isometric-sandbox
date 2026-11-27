// Textured wall paints (#11b). A texture is drawn as flat marks on the face of a wall the camera sees,
// in face coordinates: s along the wall in world tiles, z up the wall in pixels. s is the world position
// along the wall's line, so a pattern (brick courses, boards, stripes) carries on from one segment to the
// next and looks the same from every camera side; any variation comes from a hash of the world line.
import { shade } from './shapes';

export type Sz = readonly [number, number];
export type WallMark = Readonly<{ pts: readonly Sz[]; color: number; alpha?: number }>;
export type WallTextureId = 'brick' | 'stone' | 'block' | 'boards' | 'wainscot' | 'tiles' | 'stripes' | 'diamonds' | 'brushed';
// a texture gets the world span of the segment (s0..s0 + 1), a key for the world line it lies on,
// the wall's height in pixels and its color
type WallTexture = (s0: number, line: number, height: number, color: number) => WallMark[];

const mix = (h: number, v: number): number => {
  h = Math.imul(h ^ v, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  return h ^ (h >>> 13);
};
const hash = (a: number, b: number, k: number): number => {
  const h = mix(mix(mix(0x27d4eb2f, a | 0), b | 0), k | 0);
  return (Math.imul(h ^ (h >>> 16), 0xc2b2ae35) >>> 0) / 4294967296;
};
const lighten = (c: number, f: number): number => {
  const ch = (s: number) => Math.min(255, Math.round(((c >> s) & 255) + (255 - ((c >> s) & 255)) * f));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};
const rect = (s0: number, z0: number, s1: number, z1: number, color: number, alpha = 1): WallMark =>
  ({ pts: [[s0, z0], [s1, z0], [s1, z1], [s0, z1]], color, alpha });
const vary = (c: number, t: number, amount: number): number => (t > 0 ? lighten(c, t * amount) : shade(c, 1 + t * amount));

// Running bond: courses `course` pixels tall, bricks `len` tiles long, every other course shifted by half
// a brick; each brick a touch lighter or darker, mortar lines between
const bond = (len: number, course: number, mortar: (c: number) => number, spread: number, joint = 0.012, bed = 0.8): WallTexture =>
  (s0, line, height, color) => {
    const out: WallMark[] = [];
    const m = mortar(color);
    for (let k = 0; k * course < height; k++) {
      const z0 = k * course, z1 = Math.min(height, z0 + course);
      const off = k % 2 === 0 ? 0 : len / 2;
      for (let i = Math.floor((s0 - off) / len) - 1; i * len + off < s0 + 1; i++) {
        const a = i * len + off;
        out.push(rect(a, z0, a + len, z1, vary(color, hash(i, k, line) - 0.5, spread)));
        out.push(rect(a - joint / 2, z0, a + joint / 2, z1, m));
      }
      out.push(rect(s0 - 0.01, z1 - bed / 2, s0 + 1.01, z1 + bed / 2, m));
    }
    return out;
  };

// Ashlar stone: courses of hashed heights, blocks of hashed lengths with a joint at a jittered spot
const stone: WallTexture = (s0, line, height, color) => {
  const out: WallMark[] = [];
  const m = shade(color, 0.7);
  let z0 = 0;
  for (let k = 0; z0 < height; k++) {
    const z1 = Math.min(height, z0 + 9 + Math.floor(hash(k, line, 7) * 6));
    const step = 0.42;
    for (let i = Math.floor(s0 / step) - 1; i * step < s0 + 1.5; i++) {
      const a = i * step + (hash(i, k, line) - 0.5) * 0.22;
      const b = (i + 1) * step + (hash(i + 1, k, line) - 0.5) * 0.22;
      out.push(rect(a, z0, b, z1, vary(color, hash(i, k, line + 3) - 0.5, 0.22)));
      out.push(rect(a - 0.012, z0, a + 0.012, z1, m));
    }
    out.push(rect(s0 - 0.01, z1 - 0.5, s0 + 1.01, z1 + 0.5, m));
    z0 = z1;
  }
  return out;
};

// Vertical boards `w` tiles wide between z0 and z1, with dark seams
const boards = (s0: number, line: number, z0: number, z1: number, color: number, w: number): WallMark[] => {
  const out: WallMark[] = [];
  for (let i = Math.floor(s0 / w) - 1; i * w < s0 + 1; i++) {
    out.push(rect(i * w, z0, (i + 1) * w, z1, vary(color, hash(i, line, 11) - 0.5, 0.14)));
    out.push(rect(i * w - 0.008, z0, i * w + 0.008, z1, shade(color, 0.7)));
  }
  return out;
};

// Brush strokes: short, soft, slightly slanted swipes a touch lighter or darker than the paint, laid on a
// jittered lattice so they overlap like hand-painted plaster
const brushed: WallTexture = (s0, line, height, color) => {
  const out: WallMark[] = [];
  const w = 0.2, h = 4.5;
  for (let k = 0; k * h < height + h; k++)
    for (let i = Math.floor(s0 / w) - 2; i * w < s0 + 1 + w; i++) {
      const r = hash(i, k, line + 17);
      const cs = i * w + hash(i, k, line + 19) * w, cz = k * h + hash(i, k, line + 23) * h;
      const len = 0.22 + r * 0.16, tilt = (hash(i, k, line + 31) - 0.5) * 9;
      const c = r > 0.5 ? lighten(color, 0.08 + (r - 0.5) * 0.2) : shade(color, 0.93 - (0.5 - r) * 0.1);
      // a swipe: thick in the middle, tapering to both ends, along a slight slant
      const n = 6, half = 0.7 + hash(i, k, line + 29) * 0.7;
      const top: Sz[] = [], bottom: Sz[] = [];
      for (let j = 0; j <= n; j++) {
        const t = j / n, sc = cs - len / 2 + len * t, zc = cz + tilt * (t - 0.5);
        const th = half * Math.sin(Math.PI * t) + 0.05;
        top.push([sc, zc + th]);
        bottom.unshift([sc, zc - th]);
      }
      out.push({ pts: [...top, ...bottom], color: c, alpha: 0.6 });
    }
  return out;
};

const WOOD = 0x9a6b42;
const RAIL = 20; // wainscot height in pixels

export const WALL_TEXTURES: Readonly<Record<WallTextureId, WallTexture>> = {
  brick: bond(0.25, 4, (c) => lighten(c, 0.45), 0.2),
  block: bond(0.5, 8, (c) => shade(c, 0.78), 0.08, 0.014, 0.9),
  stone,
  brushed,
  boards: (s0, line, height, color) => boards(s0, line, 0, height, color, 1 / 6),
  // wood panelling up to a rail, the paint above
  wainscot: (s0, line, height, color) => [
    ...boards(s0, line, 0, Math.min(height, RAIL), WOOD, 1 / 8),
    rect(s0 - 0.01, RAIL - 1, s0 + 1.01, RAIL + 2, shade(WOOD, 0.85)),
    rect(s0 - 0.01, 0, s0 + 1.01, 2, shade(WOOD, 0.7)),
  ],
  // square tiles with grout
  tiles: (s0, _line, height, color) => {
    const out: WallMark[] = [];
    const g = shade(color, 0.82);
    const n = 5, h = 7;
    for (let i = Math.floor(s0 * n); i <= Math.ceil((s0 + 1) * n); i++) out.push(rect(i / n - 0.01, 0, i / n + 0.01, height, g));
    for (let z = h; z < height; z += h) out.push(rect(s0 - 0.01, z - 0.5, s0 + 1.01, z + 0.5, g));
    return out;
  },
  // wallpaper stripes, a lighter band and a thin line between the paint's own
  stripes: (s0, _line, height, color) => {
    const out: WallMark[] = [];
    const w = 1 / 8;
    for (let i = Math.floor(s0 / w); i * w < s0 + 1; i++) {
      if (i % 2 === 0) out.push(rect(i * w, 0, (i + 1) * w, height, lighten(color, 0.35)));
      else out.push(rect(i * w + w / 2 - 0.006, 0, i * w + w / 2 + 0.006, height, shade(color, 0.85)));
    }
    return out;
  },
  // wallpaper with a small diamond print on a lattice
  diamonds: (s0, _line, height, color) => {
    const out: WallMark[] = [];
    const w = 1 / 5, h = 8, ds = 0.035, dz = 2.6;
    const c = lighten(color, 0.45);
    for (let k = 0; k * h < height + h; k++)
      for (let i = Math.floor(s0 / w) - 1; i * w < s0 + 1.2; i++) {
        const cs = i * w + (k % 2 === 0 ? 0 : w / 2), cz = k * h + h / 2;
        out.push({ pts: [[cs - ds, cz], [cs, cz + dz], [cs + ds, cz], [cs, cz - dz]], color: c });
      }
    return out;
  },
};
