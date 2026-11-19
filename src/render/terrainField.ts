// The terrain look as plain numbers: a grid of terrain kinds turns into the pixels of a chunk picture.
// No Pixi here, so it runs (and is tested) in node.
//
// Each tile has one terrain (grass when none). At any point on the ground, every terrain gets a weight:
// its share of a small square around the point (a box blur of "this tile is that terrain"), raised to
// a power so the blend stays soft but not muddy. The color is the weighted mix. Inside a patch one
// terrain has all the weight; at a border the weight slides from one to the other, so terrains blend
// into each other directly, corners come out round, and there is no stacking order to get wrong.

export const TERRAIN_PX = 8; // pixels per tile in a chunk picture
export const CHUNK = 32; // tiles per chunk side
const BLUR = 0.6; // half-width of the blur square, in tiles: how far a border's blend reaches
// The weights are cubed (a power of 3): higher is crisper, 1 is a plain average
const SPECK_DENSITY = 0.07; // share of a fully flowery pixel that is a speck

export const GRASS_KIND = -1;
export type TerrainLook = Readonly<{ color: number; specks?: readonly number[] }>;
// kinds[y * w + x] is an index into the looks, or GRASS_KIND
export type TerrainGrid = Readonly<{ w: number; h: number; kinds: Int16Array }>;

export const terrainGrid = (
  cells: readonly Readonly<{ x: number; y: number; defId: string }>[],
  w: number,
  h: number,
  kindOf: (defId: string) => number,
): TerrainGrid => {
  const kinds = new Int16Array(w * h).fill(GRASS_KIND);
  cells.forEach((c) => {
    if (c.x >= 0 && c.y >= 0 && c.x < w && c.y < h) kinds[c.y * w + c.x] = kindOf(c.defId);
  });
  return { w, h, kinds };
};

// Off the map, the edge's own terrain carries on (so a patch at the edge does not fade to grass there)
const kindAt = (g: TerrainGrid, x: number, y: number): number =>
  g.kinds[Math.min(g.h - 1, Math.max(0, y)) * g.w + Math.min(g.w - 1, Math.max(0, x))]!;

// Whether any tile in the rectangle (clipped to the map) has terrain
export const anyTerrain = (g: TerrainGrid, x0: number, y0: number, x1: number, y1: number): boolean => {
  for (let y = Math.max(0, y0); y < Math.min(g.h, y1); y++)
    for (let x = Math.max(0, x0); x < Math.min(g.w, x1); x++) if (g.kinds[y * g.w + x] !== GRASS_KIND) return true;
  return false;
};

// Whether two grids differ anywhere in the rectangle
export const differs = (a: TerrainGrid, b: TerrainGrid, x0: number, y0: number, x1: number, y1: number): boolean => {
  if (a.w !== b.w || a.h !== b.h) return true;
  for (let y = Math.max(0, y0); y < Math.min(a.h, y1); y++)
    for (let x = Math.max(0, x0); x < Math.min(a.w, x1); x++) if (a.kinds[y * a.w + x] !== b.kinds[y * a.w + x]) return true;
  return false;
};

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

export const chunkPixels = (g: TerrainGrid, cx: number, cy: number, looks: readonly TerrainLook[], grass: number): Uint8ClampedArray<ArrayBuffer> => {
  const { cw, ch } = chunkSize(g, cx, cy);
  const pw = cw * TERRAIN_PX, ph = ch * TERRAIN_PX;
  const out = new Uint8ClampedArray(pw * ph * 4);
  const rgb = (k: number): readonly [number, number, number] => {
    const c = k === GRASS_KIND ? grass : looks[k]!.color;
    return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  };
  const colors = new Map<number, readonly [number, number, number]>();
  const colorOf = (k: number) => colors.get(k) ?? (colors.set(k, rgb(k)), colors.get(k)!);
  const put = (i: number, r: number, gr: number, b: number) => {
    out[i] = r; out[i + 1] = gr; out[i + 2] = b; out[i + 3] = 255;
  };
  const x0 = cx * CHUNK, y0 = cy * CHUNK;

  // For each pixel row and column: the (up to 3) tiles the blur square overlaps and by how much
  const spans = (n: number, origin: number) =>
    Array.from({ length: n * TERRAIN_PX }, (_, i) => {
      const p = origin + (i + 0.5) / TERRAIN_PX;
      const parts: [number, number][] = [];
      for (let t = Math.floor(p - BLUR); t <= Math.floor(p + BLUR); t++) {
        const o = Math.min(t + 1, p + BLUR) - Math.max(t, p - BLUR);
        if (o > 1e-9) parts.push([t, o / (2 * BLUR)]);
      }
      return parts;
    });
  const xs = spans(cw, x0), ys = spans(ch, y0);
  // the terrains under one pixel's blur square and their shares (at most 9 tiles, so small arrays)
  const wk = new Int16Array(9), wv = new Float64Array(9);
  let wn = 0;
  const add = (kk: number, v: number) => {
    for (let j = 0; j < wn; j++) if (wk[j] === kk) { wv[j]! += v; return; }
    wk[wn] = kk; wv[wn] = v; wn++;
  };

  for (let ty = 0; ty < ch; ty++)
    for (let tx = 0; tx < cw; tx++) {
      const gx = x0 + tx, gy = y0 + ty;
      const k = kindAt(g, gx, gy);
      // a tile whose neighbors are all the same terrain is one flat color (most tiles)
      let uniform = true;
      for (let dy = -1; dy <= 1 && uniform; dy++) for (let dx = -1; dx <= 1; dx++) if (kindAt(g, gx + dx, gy + dy) !== k) { uniform = false; break; }
      const specks = k === GRASS_KIND ? undefined : looks[k]!.specks;
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
          let speckWeight = 0, speckKind = GRASS_KIND;
          for (let j = 0; j < wn; j++) {
            const kk = wk[j]!, w = wv[j]!;
            const s = w * w * w; // the weight cubed
            const c = colorOf(kk);
            r += c[0] * s; gr += c[1] * s; b += c[2] * s; total += s;
            if (kk !== GRASS_KIND && looks[kk]!.specks && w > speckWeight) { speckWeight = w; speckKind = kk; }
          }
          r /= total; gr /= total; b /= total;
          // specks: a few pixels take a flower color, more of them the more of the terrain is there
          if (speckKind !== GRASS_KIND) {
            const wx = x0 * TERRAIN_PX + px, wy = y0 * TERRAIN_PX + py;
            const share = (speckWeight * speckWeight * speckWeight) / total;
            if (hash(wx, wy) < SPECK_DENSITY * share) {
              const list = looks[speckKind]!.specks!;
              const c = list[Math.floor(hash(wy, wx) * list.length)]!;
              r = (c >> 16) & 255; gr = (c >> 8) & 255; b = c & 255;
            }
          }
          put(i, r, gr, b);
        }
    }
  return out;
};
