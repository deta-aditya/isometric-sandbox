// The terrain look as plain numbers: a grid of terrain kinds turns into the pixels of a chunk picture.
// No Pixi here, so it runs (and is tested) in node.
//
// Each tile has one terrain (the map's ground when none). At any point on the ground, every terrain gets
// a weight: its share of the tiles around the point, counted with a Gaussian falloff (a blur of "this
// tile is that terrain"), raised to a power. The color is the weighted mix. Deep inside a patch one
// terrain has all the weight; a tile with other terrains around it only gets part of it, so lone tiles
// and thin paths read softer than a well-surrounded patch, and every border is a gradient. Terrains
// blend straight into each other, corners come out round, and there is no stacking order to get wrong.

import { INLET_RAISE, STREAM_DEPTH, TILE_H } from '../config';

export const TERRAIN_PX = 8; // pixels per tile in a chunk picture
// A chunk with a stream near is drawn finer, so the water's edge stays crisp up close. Only the last
// pass runs at this size: the terrain blend and the stream's depth are worked out at TERRAIN_PX and read
// smoothly between their pixels.
export const STREAM_PX = 16;
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
const WOBBLE = 0.13; // how far the edge wanders (in field units)
const WOBBLE_SCALE = 0.8; // how slowly it wanders (per tile)
const SINK = STREAM_DEPTH / TILE_H;
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
// side 'pool' marks a tile whose water is deep right across (inside a culvert), easing off around it
// side 'raise' marks an inlet's tile: the stream's water is lowered less near it, rising to the inlet
export type StreamPin = Readonly<{ x: number; y: number; side: 'west' | 'north' | 'east' | 'south' | 'pool' | 'raise' }>;
const PIN_BIT = { west: 1, north: 2, east: 4, south: 8, pool: 16, raise: 32 } as const;

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

// The picture of one chunk (chunk column cx, row cy): RGBA, (cw * px) by (ch * px), where cw and ch are
// the chunk's tiles clipped to the map and px is chunkPx (STREAM_PX near a stream, else TERRAIN_PX)
export const chunkSize = (g: TerrainGrid, cx: number, cy: number) => ({
  cw: Math.max(0, Math.min(CHUNK, g.w - cx * CHUNK)),
  ch: Math.max(0, Math.min(CHUNK, g.h - cy * CHUNK)),
});

const streamNear = (g: TerrainGrid, x0: number, y0: number, cw: number, ch: number): boolean =>
  anyStream(g, x0 - REACH - 1, y0 - REACH - 1, x0 + cw + REACH, y0 + ch + REACH);
export const chunkPx = (g: TerrainGrid, cx: number, cy: number): number => {
  const { cw, ch } = chunkSize(g, cx, cy);
  return streamNear(g, cx * CHUNK, cy * CHUNK, cw, ch) ? STREAM_PX : TERRAIN_PX;
};

export const chunkPixels = (g: TerrainGrid, cx: number, cy: number, looks: readonly TerrainLook[], ground: TerrainLook): Uint8ClampedArray<ArrayBuffer> => {
  const { cw, ch } = chunkSize(g, cx, cy);
  const P = chunkPx(g, cx, cy);
  const pw = cw * P, ph = ch * P;
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
  const near = streamNear(g, x0, y0, cw, ch);
  const M = near ? 1 : 0;
  const ex0 = x0 - M, ey0 = y0 - M, ecw = cw + M, ech = ch + M, epw = ecw * TERRAIN_PX, eph = ech * TERRAIN_PX;
  const ext = near ? new Uint8ClampedArray(epw * eph * 4) : out;
  const putE = (i: number, r: number, gr: number, b: number) => {
    ext[i] = r; ext[i + 1] = gr; ext[i + 2] = b; ext[i + 3] = 255;
  };

  // For each pixel row and column: the tiles within reach and each one's share along that axis
  const spans = (n: number, origin: number, sigma: number, reach: number, perTile = TERRAIN_PX) =>
    Array.from({ length: n * perTile }, (_, i) => {
      const p = origin + (i + 0.5) / perTile;
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
  // (worked out at the picture's own finer size, so the water's edge has no kinks where coarse pixels meet)
  const fw = ecw * P, fh = ech * P;
  const sxs = spans(ecw, ex0, STREAM_SIGMA, 2, P), sys = spans(ech, ey0, STREAM_SIGMA, 2, P);
  // the strips of water pinned against stonework near this chunk (0.6 of a tile in from the pinned side)
  const strips: [number, number, number, number][] = [], dry: [number, number, number, number][] = [], pools: [number, number][] = [], raises: [number, number][] = [];
  for (let y = Math.max(0, ey0 - 2); y < Math.min(g.h, ey0 + ech + 2); y++)
    for (let x = Math.max(0, ex0 - 2); x < Math.min(g.w, ex0 + ecw + 2); x++) {
      const bits = g.pins[y * g.w + x]!;
      if (bits & 1) strips.push([x, y, x + 0.6, y + 1]);
      if (bits & 2) strips.push([x, y, x + 1, y + 0.6]);
      if (bits & 4) strips.push([x + 0.4, y, x + 1, y + 1]);
      if (bits & 8) strips.push([x, y + 0.4, x + 1, y + 1]);
      if (bits & 16) pools.push([x, y]);
      if (bits & 32) raises.push([x, y]);
      // and the ground on the other side of the stonework stays level: no bank slopes down past a wall
      if (bits & 1) dry.push([x - 1, y, x, y + 1]);
      if (bits & 2) dry.push([x, y - 1, x + 1, y]);
      if (bits & 4) dry.push([x + 1, y, x + 2, y + 1]);
      if (bits & 8) dry.push([x, y + 1, x + 1, y + 2]);
    }
  // the blur in two passes: first along x for every tile row in reach, then those rows down y
  const ry0 = ey0 - 3, rows = ech + 6;
  const across = new Float32Array(rows * fw);
  for (let r = 0; r < rows; r++)
    for (let px = 0; px < fw; px++) {
      let sum = 0;
      for (const [xx, ox] of sxs[px]!) if (streamAt(g, xx, ry0 + r)) sum += ox;
      across[r * fw + px] = sum;
    }
  const field = new Float32Array(fw * fh);
  for (let py = 0; py < fh; py++)
    for (let px = 0; px < fw; px++) {
      let f = 0;
      for (const [yy, oy] of sys[py]!) f += oy * across[(yy - ry0) * fw + px]!;
      const wx = ex0 + (px + 0.5) / P, wy = ey0 + (py + 0.5) / P;
      let wobble = (valueNoise(wx * WOBBLE_SCALE, wy * WOBBLE_SCALE) - 0.5) * WOBBLE;
      // near stonework the edge is straight: the wobble fades out, and the strip itself is deep water
      for (const [x0s, y0s, x1s, y1s] of strips) {
        const d = Math.hypot(Math.max(x0s - wx, 0, wx - x1s), Math.max(y0s - wy, 0, wy - y1s));
        if (d === 0) f = Math.max(f, 1.05);
        if (d < 1.2) wobble *= 1 - (1 - d / 1.2) ** 2;
      }
      // a pool: deep across its tile, easing back to the stream's own depth over a tile and a half (only
      // on the stream's own tiles, so it never spreads onto the land around)
      if (pools.length && streamAt(g, Math.floor(wx), Math.floor(wy))) for (const [px0, py0] of pools) {
        const d = Math.hypot(Math.max(px0 - wx, 0, wx - px0 - 1), Math.max(py0 - wy, 0, wy - py0 - 1));
        if (d >= 1.5) continue;
        // outside the pool's own tile it eases off toward land, so the stream keeps its earth bank there
        let shore = 1;
        if (d > 0) {
          const cx = Math.floor(wx), cy = Math.floor(wy);
          let near = 1;
          for (let ny = cy - 1; ny <= cy + 1; ny++)
            for (let nx = cx - 1; nx <= cx + 1; nx++)
              if (!streamAt(g, nx, ny)) near = Math.min(near, Math.hypot(Math.max(nx - wx, 0, wx - nx - 1), Math.max(ny - wy, 0, wy - ny - 1)));
          shore = Math.min(1, near / 0.9) ** 2;
        }
        f = Math.max(f, 1.05 * (1 - (d / 1.5) ** 1.5) * shore);
      }
      field[py * fw + px] = dry.some(([a, b, c, d]) => wx >= a && wx < c && wy >= b && wy < d) && !streamAt(g, Math.floor(wx), Math.floor(wy)) ? -1 : f + wobble;
    }
  // bilinear reads of the extended picture at a grid point (clamped to it)
  const at = (qx: number, qy: number) => {
    const u = Math.min(epw - 1, Math.max(0, (qx - ex0) * TERRAIN_PX - 0.5)), v = Math.min(eph - 1, Math.max(0, (qy - ey0) * TERRAIN_PX - 0.5));
    const i0 = Math.floor(u), j0 = Math.floor(v), i1 = Math.min(epw - 1, i0 + 1), j1 = Math.min(eph - 1, j0 + 1);
    return { i0, j0, i1, j1, fu: u - i0, fv: v - j0 };
  };
  const fieldAt = (qx: number, qy: number) => {
    const u = Math.min(fw - 1, Math.max(0, (qx - ex0) * P - 0.5)), v = Math.min(fh - 1, Math.max(0, (qy - ey0) * P - 0.5));
    const i0 = Math.floor(u), j0 = Math.floor(v), i1 = Math.min(fw - 1, i0 + 1), j1 = Math.min(fh - 1, j0 + 1);
    const fu = u - i0, fv = v - j0;
    const a = field[j0 * fw + i0]! + (field[j0 * fw + i1]! - field[j0 * fw + i0]!) * fu;
    const b = field[j1 * fw + i0]! + (field[j1 * fw + i1]! - field[j1 * fw + i0]!) * fu;
    return a + (b - a) * fv;
  };
  // all three channels at once (one set of weights), into mix
  const mix: [number, number, number] = [0, 0, 0];
  const rgbAt = (qx: number, qy: number) => {
    const { i0, j0, i1, j1, fu, fv } = at(qx, qy);
    const a0 = (j0 * epw + i0) * 4, a1 = (j0 * epw + i1) * 4, b0 = (j1 * epw + i0) * 4, b1 = (j1 * epw + i1) * 4;
    for (let n = 0; n < 3; n++) {
      const top = ext[a0 + n]! + (ext[a1 + n]! - ext[a0 + n]!) * fu, bottom = ext[b0 + n]! + (ext[b1 + n]! - ext[b0 + n]!) * fu;
      mix[n] = top + (bottom - top) * fv;
    }
    return mix;
  };
  const depthAt = (qx: number, qy: number) => streamDepth(fieldAt(qx, qy));
  // How much of the full lowering applies at a point: near an inlet the stream rises to the inlet's
  // raised water, easing back to its own level over two tiles
  const RAISED = INLET_RAISE / STREAM_DEPTH;
  const lowering = (qx: number, qy: number) => {
    let k = 1;
    for (const [rx, ry] of raises) {
      const d = Math.hypot(Math.max(rx - qx, 0, qx - rx - 1), Math.max(ry - qy, 0, qy - ry - 1));
      if (d < 2) {
        const t = d / 2;
        k = Math.min(k, RAISED + (1 - RAISED) * t * t * (3 - 2 * t));
      }
    }
    return k;
  };

  // One sample of the stream pass at a grid point: its color into col; 1 when it shows water, else 0
  const col: [number, number, number] = [0, 0, 0];
  const sample = (wx: number, wy: number): number => {
    // the plain ground at this point, read smoothly from the coarser picture
    const plain = () => {
      const c = rgbAt(wx, wy);
      col[0] = c[0]; col[1] = c[1]; col[2] = c[2];
      return 0;
    };
    // the lowered point that shows here: q + SINK * depth(q) * (1, 1) = p
    let qx = wx, qy = wy;
    // found by repeated steps; each step goes only part way, so on a steep bank it settles instead of
    // jumping back and forth (which left a jagged edge)
    for (let n = 0; n < 8; n++) {
      const d = depthAt(qx, qy);
      const k = raises.length ? lowering(qx, qy) : 1;
      qx += (wx - SINK * d * k - qx) * 0.6; qy += (wy - SINK * d * k - qy) * 0.6;
    }
    // stonework on the far side of a stream (its west or north edge): the lowered point would lie past
    // the stone, on the level ground behind it, so the water here reaches right up to the stone instead
    const cx = Math.floor(wx), cy = Math.floor(wy);
    if (streamAt(g, cx, cy)) {
      const own = g.pins[cy * g.w + cx]!;
      // (one coarse pixel in, where the depth no longer mixes with the level ground behind the stone)
      const inset = 1.5 / TERRAIN_PX;
      if (own & 1 && qx < cx + inset) qx = Math.max(qx, cx + inset);
      if (own & 2 && qy < cy + inset) qy = Math.max(qy, cy + inset);
    }
    // stonework on the near side of a stream (its east or south edge) stands in front of the water,
    // so the ground just past it is not covered by the lowered water behind it
    const qcx = Math.floor(qx), qcy = Math.floor(qy);
    if ((qcx !== cx || qcy !== cy) && !streamAt(g, cx, cy) && qcx >= 0 && qcy >= 0 && qcx < g.w && qcy < g.h) {
      const bits = g.pins[qcy * g.w + qcx]!;
      if ((qcx < cx && bits & 4) || (qcy < cy && bits & 8)) return plain();
    }
    const d = depthAt(qx, qy);
    const [r0, g0, b0] = rgbAt(qx, qy);
    let [r, gr, b] = [r0, g0, b0];
    if (d > 0) {
      // a slope that goes down toward the camera (+x and +y) faces it and is lit; one going down away is in shade
      const slope = (depthAt(qx - 0.08, qy - 0.08) - depthAt(qx + 0.08, qy + 0.08)) / 0.16;
      const raw = Math.min(1.14, Math.max(0.74, 1 - slope * 0.25));
      const bankColor = (dd: number): [number, number, number] => {
        const band = dd / BANK_END;
        // light and shade come in with the slope, so the grass where it starts is not brightened
        const light = 1 + (raw - 1) * Math.min(1, band * 1.8);
        // the ground turns to earth quickly at the top of the slope (a crisp edge), then darker wet earth
        const toEarth = Math.min(1, band / 0.3);
        let [er, eg, eb] = [r0 + (EARTH[0] - r0) * toEarth, g0 + (EARTH[1] - g0) * toEarth, b0 + (EARTH[2] - b0) * toEarth];
        if (band > 0.55) {
          const t = (band - 0.55) / 0.45;
          [er, eg, eb] = [EARTH[0] + (WET[0] - EARTH[0]) * t, EARTH[1] + (WET[1] - EARTH[1]) * t, EARTH[2] + (WET[2] - EARTH[2]) * t];
        }
        // a few pebbles in the lower part of the slope
        if (band > 0.55 && band < 0.95 && hash(Math.floor(qx * 16), Math.floor(qy * 16)) > 0.975) return [PEBBLE[0] * light, PEBBLE[1] * light, PEBBLE[2] * light];
        return [er * light, eg * light, eb * light];
      };
      // the water starts with a clear edge, straight at the shallow color, and darkens only a little
      // toward the middle, so the stream reads as one even color
      const waterColor = (dd: number): [number, number, number] => {
        const t = (dd - BANK_END) / (1 - BANK_END);
        const dp = Math.min(1, Math.max(0, t - 0.3) / 0.5) * 0.6;
        return [SHALLOW[0] + (DEEP[0] - SHALLOW[0]) * dp, SHALLOW[1] + (DEEP[1] - SHALLOW[1]) * dp, SHALLOW[2] + (DEEP[2] - SHALLOW[2]) * dp];
      };
      // across the waterline the two blend over about a pixel, so the edge is crisp but not a staircase
      const EDGE = 0.05;
      if (d < BANK_END - EDGE) [r, gr, b] = bankColor(d);
      else if (d > BANK_END + EDGE) [r, gr, b] = waterColor(d);
      else {
        const t = (d - (BANK_END - EDGE)) / (2 * EDGE), lo = bankColor(Math.min(d, BANK_END - 1e-3)), hi = waterColor(Math.max(d, BANK_END));
        [r, gr, b] = [lo[0] + (hi[0] - lo[0]) * t, lo[1] + (hi[1] - lo[1]) * t, lo[2] + (hi[2] - lo[2]) * t];
      }
    }
    col[0] = r; col[1] = gr; col[2] = b;
    return d > BANK_END ? 1 : 0;
  };

  // Every pixel near the stream takes one sample at its middle. Where water meets the bank (a pixel that
  // shows water next to one that does not), the near bank's edge is a hard fold in the lowered picture,
  // so those pixels are taken again as the average of four samples, which smooths the edge.
  const kind = new Int8Array(pw * ph).fill(-1);
  for (let ty = 0; ty < ch; ty++)
    for (let tx = 0; tx < cw; tx++) {
      const gx = x0 + tx, gy = y0 + ty;
      const wet = anyStream(g, gx - 3, gy - 3, gx + 4, gy + 4);
      for (let py = ty * P; py < (ty + 1) * P; py++)
        for (let px = tx * P; px < (tx + 1) * P; px++) {
          const i = (py * pw + px) * 4;
          const wx = x0 + (px + 0.5) / P, wy = y0 + (py + 0.5) / P;
          if (!wet) {
            const c = rgbAt(wx, wy);
            put(i, c[0], c[1], c[2]);
            continue;
          }
          kind[py * pw + px] = sample(wx, wy);
          put(i, col[0], col[1], col[2]);
        }
    }
  const Q = 0.25 / P;
  for (let py = 0; py < ph; py++)
    for (let px = 0; px < pw; px++) {
      const k = kind[py * pw + px]!;
      if (k < 0) continue;
      const differs = (x: number, y: number) => x >= 0 && y >= 0 && x < pw && y < ph && kind[y * pw + x]! >= 0 && kind[y * pw + x] !== k;
      if (!differs(px - 1, py) && !differs(px + 1, py) && !differs(px, py - 1) && !differs(px, py + 1)) continue;
      const wx = x0 + (px + 0.5) / P, wy = y0 + (py + 0.5) / P;
      let sr = 0, sg = 0, sb = 0;
      for (const [ox, oy] of [[-Q, -Q], [Q, -Q], [-Q, Q], [Q, Q]] as const) {
        sample(wx + ox, wy + oy);
        sr += col[0]; sg += col[1]; sb += col[2];
      }
      put((py * pw + px) * 4, sr / 4, sg / 4, sb / 4);
    }
  return out;
};
