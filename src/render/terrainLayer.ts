// The terrain layer: soft blended ground drawn as pictures, one per chunk of 32 by 32 tiles.
// The pixels come from terrainField.ts; here each chunk's picture becomes a texture on a sprite laid
// on the ground with the isometric slant. The grid is a straight grid seen at a slant, so a chunk
// picture maps to the ground by one affine matrix: its x axis runs along the grid's x (right and down
// the screen) and its y axis along the grid's y (left and down).
//
// Like the rest of the scene it draws the turned state, so a camera turn simply redraws what shows.
// A chunk is redrawn only when its tiles (or the ring of tiles around it, which its blend reaches)
// changed, and only while it lies in the drawn window. Chunks of bare ground draw nothing: the ground
// fill under them is the same color (unless the ground has specks, which only the pictures show).
import { Container, Matrix, Sprite, Texture } from 'pixi.js';
import { TILE_H, TILE_W } from '../config';
import type { Size } from '../geometry';
import { type State, bankOf, canalStreamOf } from '../world';
import { type ScreenWindow, inWindow } from './drawables';
import { CHUNK, GROUND_KIND, REACH, TERRAIN_PX, type StreamPin, type TerrainGrid, type TerrainLook, anyStream, anyTerrain, chunkPixels, chunkSize, differs, terrainGrid } from './terrainField';

// The stream sides with stonework on them: plain culverts on a stream bank, canal outlets and inlets
const streamPins = (state: State): readonly StreamPin[] =>
  state.culverts.flatMap((e): StreamPin[] => {
    if (e.kind) {
      const cs = canalStreamOf(state, e);
      if (!cs) return [];
      const { stream: st, canal: c } = cs;
      return [{ ...st, side: c.x < st.x ? 'west' : c.x > st.x ? 'east' : c.y < st.y ? 'north' : 'south' }];
    }
    const b = bankOf(state, e);
    if (!b) return [];
    return state.tiles.some((t) => t.x === b.cell.x && t.y === b.cell.y && t.defId === 'stream') ? [{ ...b.cell, side: b.side }] : [];
  });

type Chunk = { sprite: Sprite; canvas: HTMLCanvasElement; texture: Texture; drawn: TerrainGrid };

export const createTerrainLayer = (lookOf: (defId: string) => TerrainLook | null) => {
  const container = new Container();
  const chunks = new Map<string, Chunk>();
  // Terrain kinds are numbered as they are first seen, so the grid stays small integers
  const looks: TerrainLook[] = [];
  const kinds = new Map<string, number>();
  const kindOf = (defId: string): number => {
    const known = kinds.get(defId);
    if (known !== undefined) return known;
    const look = lookOf(defId);
    if (!look) return GROUND_KIND;
    looks.push(look);
    kinds.set(defId, looks.length - 1);
    return looks.length - 1;
  };

  let from: Readonly<{ terrain: State['terrain']; tiles: State['tiles']; culverts: State['culverts']; size: Size; ground: string }> | null = null;
  let grid: TerrainGrid | null = null;
  let ground: TerrainLook = { color: 0 };

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
    const pixels = chunkPixels(g, cx, cy, looks, ground);
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
    if (!from || from.terrain !== state.terrain || from.tiles !== state.tiles || from.culverts !== state.culverts || from.size !== state.size || from.ground !== state.ground) {
      // a new map or ground, or a turn of a non-square one: every picture starts over
      if (from && (from.size !== state.size || from.ground !== state.ground)) [...chunks.keys()].forEach(drop);
      from = { terrain: state.terrain, tiles: state.tiles, culverts: state.culverts, size: state.size, ground: state.ground };
      ground = lookOf(state.ground) ?? { color: 0 };
      // streams are drawn in the ground picture too (they sink into it, see terrainField.ts)
      grid = terrainGrid(state.terrain, state.size.w, state.size.h, kindOf, state.tiles.filter((t) => t.defId === 'stream'), streamPins(state));
    }
    const g = grid!;
    for (let cy = 0; cy * CHUNK < g.h; cy++)
      for (let cx = 0; cx * CHUNK < g.w; cx++) {
        const key = `${cx},${cy}`;
        const { cw, ch } = chunkSize(g, cx, cy);
        const [x0, y0] = [cx * CHUNK, cy * CHUNK];
        // the blend reaches a few tiles beyond the chunk, so that ring of neighbors counts too
        const [rx0, ry0, rx1, ry1] = [x0 - REACH, y0 - REACH, x0 + cw + REACH, y0 + ch + REACH];
        const known = chunks.get(key);
        if (!ground.specks && !anyTerrain(g, rx0, ry0, rx1, ry1) && !anyStream(g, rx0 - 1, ry0 - 1, rx1 + 1, ry1 + 1)) {
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
