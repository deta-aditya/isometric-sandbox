// The terrain look as plain numbers: a grid of terrain kinds turns into the pixels of a chunk picture.
// No Pixi here, so it runs (and is tested) in node.
//
// Each tile has one terrain (the map's ground when none). At any point on the ground, every terrain gets
// a weight: its share of the tiles around the point, counted with a Gaussian falloff (a blur of "this
// tile is that terrain"), raised to a power. The color is the weighted mix. Deep inside a patch one
// terrain has all the weight; a tile with other terrains around it only gets part of it, so lone tiles
// and thin paths read softer than a well-surrounded patch, and every border is a gradient. Terrains
// blend straight into each other, corners come out round, and there is no stacking order to get wrong.

import { TILE_H } from '../config';

export const TERRAIN_PX = 8; // pixels per tile in a chunk picture
export const CHUNK = 32; // tiles per chunk side
const SIGMA = 0.8; // spread of the Gaussian, in tiles: how far a tile's color reaches
export const REACH = 3; // tiles beyond which a tile's share is too small to count (about 3.75 sigma)
// The weights are raised to the power 1.5 (w * sqrt(w)): higher is crisper, 1 is a plain average
const SPECK_DENSITY = 0.07; // share of a fully flowery pixel that is a speck

// ===== The stream =====
// A stream sinks into the ground as a gentle bed: its field (a blur of its tiles plus a slow wobble)
// gives a depth, the edge slopes from the ground around through damp earth with a few pebbles into
// shallow water, then deeper and darker water in the middle. The picture is warped so each point shows
// where a lowered surface would really appear on screen: a surface lowered by z pixels shows z / TILE_H
// tiles further along both +x and +y, so the far bank's slope faces the camera and the near bank's
// tucks away behind its rim.
const STREAM_SIGMA = 0.62;
const WOBBLE = 0.2; // how far the edge wanders (in field units)
const WOBBLE_SCALE = 0.8; // how slowly it wanders (per tile)
const STREAM_DEPTH_PX = 16;
const SINK = STREAM_DEPTH_PX / TILE_H;
const BANK_END = 0.72; // depth where the slope gives way to water
const EARTH = [126, 98, 66] as const, WET = [96, 80, 58] as const, PEBBLE = [138, 128, 114] as const;
const SHALLOW = [59, 147, 168] as const, DEEP = [40, 120, 140] as const;
const streamDepth = (f: number): number => {
  const t = Math.max(0, Math.min(1, (f - 0.14) / 0.6));
  return t * t * (3 - 2 * t);
};
// Smooth value noise in [0, 1], fixed per place
const valueNoise = (x: number, y: number): number => {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const h = (a: number, b: number) => hash(a, b);
  const top = h(i, j) + (h(i + 1, j) - h(i, j)) * sx, bottom = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * sx;
  return top + (bottom - top) * sy;
};

// No entry: the map's own ground
export const GROUND_KIND = -1;
export type TerrainLook = Readonly<{ color: number; specks?: readonly number[] }>;
// kinds[y * w + x] is an index into the looks, or GROUND_KIND
// stream[y * w + x] is 1 where a stream tile lies; pins[y * w + x] marks the sides of a stream tile that
// have stonework on them (a culvert's headwall, a canal outlet or inlet): 1 west, 2 north, 4 east, 8 south.
// The stream is flattened against them: its water reaches straight up to the stone.
export type TerrainGrid = Readonly<{ w: number; h: number; kinds: Int16Array; stream: Uint8Array; pins: Uint8Array }>;
export type StreamPin = Readonly<{ x: number; y: number; side: 'west' | 'north' | 'east' | 'south' }>;
const PIN_BIT = { west: 1, north: 2, east: 4, south: 8 } as const;

export const terrainGrid = (
  cells: readonly Readonly<{ x: number; y: number; defId: string }>[],
  w: number,
  h: number,
  kindOf: (defId: string) => number,
  streams: readonly Readonly<{ x: number; y: number }>[] = [],
  streamPins: readonly StreamPin[] = [],
): TerrainGrid => {
  const kinds = new Int16Array(w * h).fill(GROUND_KIND);
  cells.forEach((c) => {
    if (c.x >= 0 && c.y >= 0 && c.x < w && c.y < h) kinds[c.y * w + c.x] = kindOf(c.defId);
  });
  const stream = new Uint8Array(w * h);
  streams.forEach((c) => {
    if (c.x >= 0 && c.y >= 0 && c.x < w && c.y < h) stream[c.y * w + c.x] = 1;
  });
  const pins = new Uint8Array(w * h);
  streamPins.forEach((p) => {
    if (p.x >= 0 && p.y >= 0 && p.x < w && p.y < h) pins[p.y * w + p.x]! |= PIN_BIT[p.side];
  });
  return { w, h, kinds, stream, pins };
};

// Off the map, a stream at the edge carries on, like terrain
const streamAt = (g: TerrainGrid, x: number, y: number): boolean =>
  g.stream[Math.min(g.h - 1, Math.max(0, y)) * g.w + Math.min(g.w - 1, Math.max(0, x))] === 1;
export const anyStream = (g: TerrainGrid, x0: number, y0: number, x1: number, y1: number): boolean => {
  for (let y = Math.max(0, y0); y < Math.min(g.h, y1); y++)
    for (let x = Math.max(0, x0); x < Math.min(g.w, x1); x++) if (g.stream[y * g.w + x] === 1) return true;
  return false;
};

// Off the map, the edge's own terrain carries on (so a patch at the edge does not fade to the ground there)
const kindAt = (g: TerrainGrid, x: number, y: number): number =>
  g.kinds[Math.min(g.h - 1, Math.max(0, y)) * g.w + Math.min(g.w - 1, Math.max(0, x))]!;

// Whether any tile in the rectangle (clipped to the map) has terrain other than the ground
export const anyTerrain = (g: TerrainGrid, x0: number, y0: number, x1: number, y1: number): boolean => {
  for (let y = Math.max(0, y0); y < Math.min(g.h, y1); y++)
    for (let x = Math.max(0, x0); x < Math.min(g.w, x1); x++) if (g.kinds[y * g.w + x] !== GROUND_KIND) return true;
  return false;
};

// Whether two grids differ anywhere in the rectangle
export const differs = (a: TerrainGrid, b: TerrainGrid, x0: number, y0: number, x1: number, y1: number): boolean => {
  if (a.w !== b.w || a.h !== b.h) return true;
  for (let y = Math.max(0, y0); y < Math.min(a.h, y1); y++)
    for (let x = Math.max(0, x0); x < Math.min(a.w, x1); x++) {
      const i = y * a.w + x;
      if (a.kinds[i] !== b.kinds[i] || a.stream[i] !== b.stream[i] || a.pins[i] !== b.pins[i]) return true;
    }
  return false;
};

// The normal distribution's cumulative function (Abramowitz and Stegun 7.1.26, error under 1.5e-7)
const phi = (x: number): number => {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const e = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + (x >= 0 ? e : -e));
};
// How much of a Gaussian centered at p falls on the tile from t to t + 1 (along one axis)
const share = (p: number, t: number, sigma = SIGMA): number => phi((t + 1 - p) / sigma) - phi((t - p) / sigma);

// A fixed pseudo-random number in [0, 1) per pixel of the whole map, so specks stay put across chunks
const hash = (x: number, y: number): number => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// The picture of one chunk (chunk column cx, row cy): RGBA, (cw * TERRAIN_PX) by (ch * TERRAIN_PX),
// where cw and ch are the chunk's tiles clipped to the map
export const chunkSize = (g: TerrainGrid, cx: number, cy: number) => ({
  cw: Math.max(0, Math.min(CHUNK, g.w - cx * CHUNK)),
  ch: Math.max(0, Math.min(CHUNK, g.h - cy * CHUNK)),
});

export const chunkPixels = (g: TerrainGrid, cx: number, cy: number, looks: readonly TerrainLook[], ground: TerrainLook): Uint8ClampedArray<ArrayBuffer> => {
  const { cw, ch } = chunkSize(g, cx, cy);
  const pw = cw * TERRAIN_PX, ph = ch * TERRAIN_PX;
  const out = new Uint8ClampedArray(pw * ph * 4);
  const lookOf = (k: number): TerrainLook => (k === GROUND_KIND ? ground : looks[k]!);
  const rgb = (k: number): readonly [number, number, number] => {
    const c = lookOf(k).color;
    return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  };
  const colors = new Map<number, readonly [number, number, number]>();
  const colorOf = (k: number) => colors.get(k) ?? (colors.set(k, rgb(k)), colors.get(k)!);
  const put = (i: number, r: number, gr: number, b: number) => {
    out[i] = r; out[i + 1] = gr; out[i + 2] = b; out[i + 3] = 255;
  };
  const x0 = cx * CHUNK, y0 = cy * CHUNK;

  // A stream sinks: each pixel shows a lowered point up to half a tile up and to the left of it, so a
  // chunk with a stream near is worked out over one more tile on those sides (M), then the stream pass
  // writes the chunk's own pixels. Without a stream near, the extended picture is the chunk itself.
  const near = anyStream(g, x0 - REACH - 1, y0 - REACH - 1, x0 + cw + REACH, y0 + ch + REACH);
  const M = near ? 1 : 0;
  const ex0 = x0 - M, ey0 = y0 - M, ecw = cw + M, ech = ch + M, epw = ecw * TERRAIN_PX, eph = ech * TERRAIN_PX;
  const ext = near ? new Uint8ClampedArray(epw * eph * 4) : out;
  const putE = (i: number, r: number, gr: number, b: number) => {
    ext[i] = r; ext[i + 1] = gr; ext[i + 2] = b; ext[i + 3] = 255;
  };

  // For each pixel row and column: the tiles within reach and each one's share along that axis
  const spans = (n: number, origin: number, sigma: number, reach: number) =>
    Array.from({ length: n * TERRAIN_PX }, (_, i) => {
      const p = origin + (i + 0.5) / TERRAIN_PX;
      const parts: [number, number][] = [];
      for (let t = Math.floor(p) - reach; t <= Math.floor(p) + reach; t++) {
        const o = share(p, t, sigma);
        if (o > 1e-4) parts.push([t, o]);
      }
      return parts;
    });
  const xs = spans(ecw, ex0, SIGMA, REACH), ys = spans(ech, ey0, SIGMA, REACH);
  // the terrains within one pixel's reach and their shares (at most 7 by 7 tiles, so small arrays)
  const wk = new Int16Array(49), wv = new Float64Array(49);
  let wn = 0;
  const add = (kk: number, v: number) => {
    for (let j = 0; j < wn; j++) if (wk[j] === kk) { wv[j]! += v; return; }
    wk[wn] = kk; wv[wn] = v; wn++;
  };

  for (let ty = 0; ty < ech; ty++)
    for (let tx = 0; tx < ecw; tx++) {
      const gx = ex0 + tx, gy = ey0 + ty;
      const k = kindAt(g, gx, gy);
      // a tile with only its own terrain within reach is one flat color (most tiles)
      let uniform = true;
      for (let dy = -REACH; dy <= REACH && uniform; dy++) for (let dx = -REACH; dx <= REACH; dx++) if (kindAt(g, gx + dx, gy + dy) !== k) { uniform = false; break; }
      const specks = lookOf(k).specks;
      for (let py = ty * TERRAIN_PX; py < (ty + 1) * TERRAIN_PX; py++)
        for (let px = tx * TERRAIN_PX; px < (tx + 1) * TERRAIN_PX; px++) {
          const i = (py * epw + px) * 4;
          if (uniform && !specks) {
            const c = colorOf(k);
            putE(i, c[0], c[1], c[2]);
            continue;
          }
          wn = 0;
          if (uniform) add(k, 1);
          else
            for (const [yy, oy] of ys[py]!) for (const [xx, ox] of xs[px]!) add(kindAt(g, xx, yy), ox * oy);
          let r = 0, gr = 0, b = 0, total = 0;
          let speckWeight = 0, speckKind: number | null = null;
          for (let j = 0; j < wn; j++) {
            const kk = wk[j]!, w = wv[j]!;
            const s = w * Math.sqrt(w); // the weight to the power 1.5
            const c = colorOf(kk);
            r += c[0] * s; gr += c[1] * s; b += c[2] * s; total += s;
            if (lookOf(kk).specks && w > speckWeight) { speckWeight = w; speckKind = kk; }
          }
          r /= total; gr /= total; b /= total;
          // specks: a few pixels take a flower color, more of them the more of the terrain is there
          if (speckKind !== null) {
            const wx = ex0 * TERRAIN_PX + px, wy = ey0 * TERRAIN_PX + py;
            const part = (speckWeight * Math.sqrt(speckWeight)) / total;
            if (hash(wx, wy) < SPECK_DENSITY * part) {
              const list = lookOf(speckKind).specks!;
              const c = list[Math.floor(hash(wy, wx) * list.length)]!;
              r = (c >> 16) & 255; gr = (c >> 8) & 255; b = c & 255;
            }
          }
          putE(i, r, gr, b);
        }
    }
  if (!near) return out;

  // ===== The stream pass =====
  // The stream's own field at every pixel of the extended picture: a blur of its tiles plus a gentle
  // wobble, so its edge wanders instead of following the tiles. Its depth comes from the field.
  const sxs = spans(ecw, ex0, STREAM_SIGMA, 2), sys = spans(ech, ey0, STREAM_SIGMA, 2);
  // the strips of water pinned against stonework near this chunk (0.6 of a tile in from the pinned side)
  const strips: [number, number, number, number][] = [], dry: [number, number, number, number][] = [];
  for (let y = Math.max(0, ey0 - 2); y < Math.min(g.h, ey0 + ech + 2); y++)
    for (let x = Math.max(0, ex0 - 2); x < Math.min(g.w, ex0 + ecw + 2); x++) {
      const bits = g.pins[y * g.w + x]!;
      if (bits & 1) strips.push([x, y, x + 0.6, y + 1]);
      if (bits & 2) strips.push([x, y, x + 1, y + 0.6]);
      if (bits & 4) strips.push([x + 0.4, y, x + 1, y + 1]);
      if (bits & 8) strips.push([x, y + 0.4, x + 1, y + 1]);
      // and the ground on the other side of the stonework stays level: no bank slopes down past a wall
      if (bits & 1) dry.push([x - 1, y, x, y + 1]);
      if (bits & 2) dry.push([x, y - 1, x + 1, y]);
      if (bits & 4) dry.push([x + 1, y, x + 2, y + 1]);
      if (bits & 8) dry.push([x, y + 1, x + 1, y + 2]);
    }
  const field = new Float32Array(epw * eph);
  for (let py = 0; py < eph; py++)
    for (let px = 0; px < epw; px++) {
      let f = 0;
      for (const [yy, oy] of sys[py]!) for (const [xx, ox] of sxs[px]!) if (streamAt(g, xx, yy)) f += ox * oy;
      const wx = ex0 + (px + 0.5) / TERRAIN_PX, wy = ey0 + (py + 0.5) / TERRAIN_PX;
      let wobble = (valueNoise(wx * WOBBLE_SCALE, wy * WOBBLE_SCALE) - 0.5) * WOBBLE;
      // near stonework the edge is straight: the wobble fades out, and the strip itself is deep water
      for (const [x0s, y0s, x1s, y1s] of strips) {
        const d = Math.hypot(Math.max(x0s - wx, 0, wx - x1s), Math.max(y0s - wy, 0, wy - y1s));
        if (d === 0) f = Math.max(f, 1.05);
        if (d < 1.2) wobble *= 1 - (1 - d / 1.2) ** 2;
      }
      field[py * epw + px] = dry.some(([a, b, c, d]) => wx >= a && wx < c && wy >= b && wy < d) && !streamAt(g, Math.floor(wx), Math.floor(wy)) ? -1 : f + wobble;
    }
  // bilinear reads of the extended picture at a grid point (clamped to it)
  const at = (qx: number, qy: number) => {
    const u = Math.min(epw - 1, Math.max(0, (qx - ex0) * TERRAIN_PX - 0.5)), v = Math.min(eph - 1, Math.max(0, (qy - ey0) * TERRAIN_PX - 0.5));
    const i0 = Math.floor(u), j0 = Math.floor(v), i1 = Math.min(epw - 1, i0 + 1), j1 = Math.min(eph - 1, j0 + 1);
    return { i0, j0, i1, j1, fu: u - i0, fv: v - j0 };
  };
  const fieldAt = (qx: number, qy: number) => {
    const { i0, j0, i1, j1, fu, fv } = at(qx, qy);
    const a = field[j0 * epw + i0]! + (field[j0 * epw + i1]! - field[j0 * epw + i0]!) * fu;
    const b = field[j1 * epw + i0]! + (field[j1 * epw + i1]! - field[j1 * epw + i0]!) * fu;
    return a + (b - a) * fv;
  };
  const colorAt = (qx: number, qy: number, n: number) => {
    const { i0, j0, i1, j1, fu, fv } = at(qx, qy);
    const c = (i: number, j: number) => ext[(j * epw + i) * 4 + n]!;
    const a = c(i0, j0) + (c(i1, j0) - c(i0, j0)) * fu, b = c(i0, j1) + (c(i1, j1) - c(i0, j1)) * fu;
    return a + (b - a) * fv;
  };
  const depthAt = (qx: number, qy: number) => streamDepth(fieldAt(qx, qy));

  for (let ty = 0; ty < ch; ty++)
    for (let tx = 0; tx < cw; tx++) {
      const gx = x0 + tx, gy = y0 + ty;
      const wet = anyStream(g, gx - 3, gy - 3, gx + 4, gy + 4);
      for (let py = ty * TERRAIN_PX; py < (ty + 1) * TERRAIN_PX; py++)
        for (let px = tx * TERRAIN_PX; px < (tx + 1) * TERRAIN_PX; px++) {
          const i = (py * pw + px) * 4;
          if (!wet) {
            const e = ((py + M * TERRAIN_PX) * epw + px + M * TERRAIN_PX) * 4;
            put(i, ext[e]!, ext[e + 1]!, ext[e + 2]!);
            continue;
          }
          // the lowered point that shows here: q + SINK * depth(q) * (1, 1) = p
          const wx = x0 + (px + 0.5) / TERRAIN_PX, wy = y0 + (py + 0.5) / TERRAIN_PX;
          let qx = wx, qy = wy;
          for (let n = 0; n < 4; n++) {
            const d = depthAt(qx, qy);
            qx = wx - SINK * d; qy = wy - SINK * d;
          }
          // stonework on the near side of a stream (its east or south edge) stands in front of the water,
          // so the ground just past it is not covered by the lowered water behind it
          const cx = Math.floor(wx), cy = Math.floor(wy), qcx = Math.floor(qx), qcy = Math.floor(qy);
          if ((qcx !== cx || qcy !== cy) && !streamAt(g, cx, cy) && qcx >= 0 && qcy >= 0 && qcx < g.w && qcy < g.h) {
            const bits = g.pins[qcy * g.w + qcx]!;
            if ((qcx < cx && bits & 4) || (qcy < cy && bits & 8)) {
              const e = ((py + M * TERRAIN_PX) * epw + px + M * TERRAIN_PX) * 4;
              put(i, ext[e]!, ext[e + 1]!, ext[e + 2]!);
              continue;
            }
          }
          const d = depthAt(qx, qy);
          let r = colorAt(qx, qy, 0), gr = colorAt(qx, qy, 1), b = colorAt(qx, qy, 2);
          if (d > 0) {
            // a slope that goes down toward the camera (+x and +y) faces it and is lit; one going down away is in shade
            const slope = (depthAt(qx - 0.08, qy - 0.08) - depthAt(qx + 0.08, qy + 0.08)) / 0.16;
            const raw = Math.min(1.14, Math.max(0.74, 1 - slope * 0.25));
            if (d < BANK_END) {
              const band = d / BANK_END;
              // light and shade come in with the slope, so the grass where it starts is not brightened
              const light = 1 + (raw - 1) * Math.min(1, band * 1.8);
              // the ground around fades into damp earth over the first part of the slope, then darker wet earth
              const toEarth = Math.min(1, band / 0.55);
              let [er, eg, eb] = [r + (EARTH[0] - r) * toEarth, gr + (EARTH[1] - gr) * toEarth, b + (EARTH[2] - b) * toEarth];
              if (band > 0.55) {
                const t = (band - 0.55) / 0.45;
                [er, eg, eb] = [EARTH[0] + (WET[0] - EARTH[0]) * t, EARTH[1] + (WET[1] - EARTH[1]) * t, EARTH[2] + (WET[2] - EARTH[2]) * t];
              }
              [r, gr, b] = [er * light, eg * light, eb * light];
              // a few pebbles in the lower part of the slope
              if (band > 0.55 && band < 0.95 && hash(Math.floor(qx * 16), Math.floor(qy * 16)) > 0.975) [r, gr, b] = [PEBBLE[0] * light, PEBBLE[1] * light, PEBBLE[2] * light];
            } else {
              const t = (d - BANK_END) / (1 - BANK_END);
              const sh = Math.min(1, t * 2.2), dp = Math.max(0, t - 0.45) / 0.55;
              const s0 = [WET[0] + (SHALLOW[0] - WET[0]) * sh, WET[1] + (SHALLOW[1] - WET[1]) * sh, WET[2] + (SHALLOW[2] - WET[2]) * sh];
              [r, gr, b] = [s0[0]! + (DEEP[0] - s0[0]!) * dp, s0[1]! + (DEEP[1] - s0[1]!) * dp, s0[2]! + (DEEP[2] - s0[2]!) * dp];
            }
          }
          put(i, r, gr, b);
        }
    }
  return out;
};
