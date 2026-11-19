// The terrain look as plain numbers: a grid of terrain kinds turns into the pixels of a chunk picture.
// No Pixi here, so it runs (and is tested) in node.
//
// Each tile has one terrain (the map's ground when none). At any point on the ground, every terrain gets
// a weight: its share of the tiles around the point, counted with a Gaussian falloff (a blur of "this
// tile is that terrain"), raised to a power. The color is the weighted mix. Deep inside a patch one
// terrain has all the weight; a tile with other terrains around it only gets part of it, so lone tiles
// and thin paths read softer than a well-surrounded patch, and every border is a gradient. Terrains
// blend straight into each other, corners come out round, and there is no stacking order to get wrong.

export const TERRAIN_PX = 8; // pixels per tile in a chunk picture
export const CHUNK = 32; // tiles per chunk side
const SIGMA = 0.8; // spread of the Gaussian, in tiles: how far a tile's color reaches
export const REACH = 3; // tiles beyond which a tile's share is too small to count (about 3.75 sigma)
// The weights are raised to the power 1.5 (w * sqrt(w)): higher is crisper, 1 is a plain average
const SPECK_DENSITY = 0.07; // share of a fully flowery pixel that is a speck

// No entry: the map's own ground
export const GROUND_KIND = -1;
export type TerrainLook = Readonly<{ color: number; specks?: readonly number[] }>;
// kinds[y * w + x] is an index into the looks, or GROUND_KIND
export type TerrainGrid = Readonly<{ w: number; h: number; kinds: Int16Array }>;

export const terrainGrid = (
  cells: readonly Readonly<{ x: number; y: number; defId: string }>[],
  w: number,
  h: number,
  kindOf: (defId: string) => number,
): TerrainGrid => {
  const kinds = new Int16Array(w * h).fill(GROUND_KIND);
  cells.forEach((c) => {
    if (c.x >= 0 && c.y >= 0 && c.x < w && c.y < h) kinds[c.y * w + c.x] = kindOf(c.defId);
  });
  return { w, h, kinds };
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
    for (let x = Math.max(0, x0); x < Math.min(a.w, x1); x++) if (a.kinds[y * a.w + x] !== b.kinds[y * a.w + x]) return true;
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
const share = (p: number, t: number): number => phi((t + 1 - p) / SIGMA) - phi((t - p) / SIGMA);

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

  // For each pixel row and column: the tiles within reach and each one's share along that axis
  const spans = (n: number, origin: number) =>
    Array.from({ length: n * TERRAIN_PX }, (_, i) => {
      const p = origin + (i + 0.5) / TERRAIN_PX;
      const parts: [number, number][] = [];
      for (let t = Math.floor(p) - REACH; t <= Math.floor(p) + REACH; t++) {
        const o = share(p, t);
        if (o > 1e-4) parts.push([t, o]);
      }
      return parts;
    });
  const xs = spans(cw, x0), ys = spans(ch, y0);
  // the terrains within one pixel's reach and their shares (at most 7 by 7 tiles, so small arrays)
  const wk = new Int16Array(49), wv = new Float64Array(49);
  let wn = 0;
  const add = (kk: number, v: number) => {
    for (let j = 0; j < wn; j++) if (wk[j] === kk) { wv[j]! += v; return; }
    wk[wn] = kk; wv[wn] = v; wn++;
  };

  for (let ty = 0; ty < ch; ty++)
    for (let tx = 0; tx < cw; tx++) {
      const gx = x0 + tx, gy = y0 + ty;
      const k = kindAt(g, gx, gy);
      // a tile with only its own terrain within reach is one flat color (most tiles)
      let uniform = true;
      for (let dy = -REACH; dy <= REACH && uniform; dy++) for (let dx = -REACH; dx <= REACH; dx++) if (kindAt(g, gx + dx, gy + dy) !== k) { uniform = false; break; }
      const specks = lookOf(k).specks;
      for (let py = ty * TERRAIN_PX; py < (ty + 1) * TERRAIN_PX; py++)
        for (let px = tx * TERRAIN_PX; px < (tx + 1) * TERRAIN_PX; px++) {
          const i = (py * pw + px) * 4;
          if (uniform && !specks) {
            const c = colorOf(k);
            put(i, c[0], c[1], c[2]);
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
            const wx = x0 * TERRAIN_PX + px, wy = y0 * TERRAIN_PX + py;
            const part = (speckWeight * Math.sqrt(speckWeight)) / total;
            if (hash(wx, wy) < SPECK_DENSITY * part) {
              const list = lookOf(speckKind).specks!;
              const c = list[Math.floor(hash(wy, wx) * list.length)]!;
              r = (c >> 16) & 255; gr = (c >> 8) & 255; b = c & 255;
            }
          }
          put(i, r, gr, b);
        }
    }
  return out;
};
