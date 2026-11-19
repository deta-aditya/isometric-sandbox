// The terrain layer: soft blended ground drawn as pictures, one per chunk of 32 by 32 tiles.
// The pixels come from terrainField.ts; here each chunk's picture becomes a texture on a sprite laid
// on the ground with the isometric slant. The grid is a straight grid seen at a slant, so a chunk
// picture maps to the ground by one affine matrix: its x axis runs along the grid's x (right and down
// the screen) and its y axis along the grid's y (left and down).
//
// Like the rest of the scene it draws the turned state, so a camera turn simply redraws what shows.
// A chunk is redrawn only when its tiles (or the ring of tiles around it, which its blend reaches)
// changed, and only while it lies in the drawn window. Chunks with no terrain draw nothing: the
// grass ground fill under them is the same color.
import { Container, Matrix, Sprite, Texture } from 'pixi.js';
import { TILE_H, TILE_W } from '../config';
import type { Size } from '../geometry';
import type { State } from '../world';
import { type ScreenWindow, inWindow } from './drawables';
import { CHUNK, GRASS_KIND, TERRAIN_PX, type TerrainGrid, type TerrainLook, anyTerrain, chunkPixels, chunkSize, differs, terrainGrid } from './terrainField';

type Chunk = { sprite: Sprite; canvas: HTMLCanvasElement; texture: Texture; drawn: TerrainGrid };

export const createTerrainLayer = (lookOf: (defId: string) => TerrainLook | null, grass: number) => {
  const container = new Container();
  const chunks = new Map<string, Chunk>();
  // Terrain kinds are numbered as they are first seen, so the grid stays small integers
  const looks: TerrainLook[] = [];
  const kinds = new Map<string, number>();
  const kindOf = (defId: string): number => {
    const known = kinds.get(defId);
    if (known !== undefined) return known;
    const look = lookOf(defId);
    if (!look) return GRASS_KIND;
    looks.push(look);
    kinds.set(defId, looks.length - 1);
    return looks.length - 1;
  };

  let from: Readonly<{ terrain: State['terrain']; size: Size }> | null = null;
  let grid: TerrainGrid | null = null;

  const drop = (key: string): void => {
    const c = chunks.get(key);
    if (!c) return;
    c.sprite.destroy();
    c.texture.destroy(true);
    chunks.delete(key);
  };

  const paint = (key: string, cx: number, cy: number, g: TerrainGrid): void => {
    const { cw, ch } = chunkSize(g, cx, cy);
    const [pw, ph] = [cw * TERRAIN_PX, ch * TERRAIN_PX];
    let c = chunks.get(key);
    if (c && (c.canvas.width !== pw || c.canvas.height !== ph)) {
      drop(key);
      c = undefined;
    }
    const pixels = chunkPixels(g, cx, cy, looks, grass);
    if (!c) {
      const canvas = document.createElement('canvas');
      canvas.width = pw;
      canvas.height = ph;
      canvas.getContext('2d')!.putImageData(new ImageData(pixels, pw, ph), 0, 0);
      const texture = Texture.from(canvas);
      const sprite = new Sprite(texture);
      // grid (x, y) to the world container: ((x - y) * TILE_W / 2, (x + y) * TILE_H / 2)
      const [x0, y0] = [cx * CHUNK, cy * CHUNK];
      const [u, v] = [TILE_W / 2 / TERRAIN_PX, TILE_H / 2 / TERRAIN_PX];
      sprite.setFromMatrix(new Matrix(u, v, -u, v, (x0 - y0) * (TILE_W / 2), (x0 + y0) * (TILE_H / 2)));
      container.addChild(sprite);
      chunks.set(key, { sprite, canvas, texture, drawn: g });
      return;
    }
    c.canvas.getContext('2d')!.putImageData(new ImageData(pixels, pw, ph), 0, 0);
    c.texture.source.update();
    c.drawn = g;
  };

  // state is the turned state the scene draws; win the part of the world to draw (null: all of it)
  const render = (state: State, win: ScreenWindow | null): void => {
    if (!from || from.terrain !== state.terrain || from.size !== state.size) {
      if (from && from.size !== state.size) [...chunks.keys()].forEach(drop); // a new map, or a turn of a non-square one
      from = { terrain: state.terrain, size: state.size };
      grid = terrainGrid(state.terrain, state.size.w, state.size.h, kindOf);
    }
    const g = grid!;
    for (let cy = 0; cy * CHUNK < g.h; cy++)
      for (let cx = 0; cx * CHUNK < g.w; cx++) {
        const key = `${cx},${cy}`;
        const { cw, ch } = chunkSize(g, cx, cy);
        const [x0, y0] = [cx * CHUNK, cy * CHUNK];
        // the blend reaches a tile beyond the chunk, so its ring of neighbors counts too
        const [rx0, ry0, rx1, ry1] = [x0 - 1, y0 - 1, x0 + cw + 1, y0 + ch + 1];
        const known = chunks.get(key);
        if (!anyTerrain(g, rx0, ry0, rx1, ry1)) {
          drop(key);
          continue;
        }
        const seen = inWindow(win, { x: x0, y: y0, w: cw, h: ch }, 0);
        if (known) known.sprite.visible = seen;
        if (!seen) continue;
        if (!known || differs(known.drawn, g, rx0, ry0, rx1, ry1)) paint(key, cx, cy, g);
      }
  };

  return { container, render };
};
