// Sunken water: the canal as a shallow channel cut into the ground, and culverts set into its banks.
// (The stream is drawn as part of the ground picture, in terrainField.ts.)
//
// Everything below ground level (the water surface, the bank wall faces, shadows on the water) can only
// be seen through the canal's opening at ground level, so it is drawn into its own layer and shown
// through a mask of the canal tiles. That one rule keeps walls from hanging past a canal's end, makes
// inside corners close, and hides the near banks' walls the way the ground in front would. The stone
// coping along every bank and the corner posts lie at ground level, on top, outside the mask.
//
// Like everything else this works from the turned state: the far banks are always west and north.
import { Container, Graphics } from 'pixi.js';
import { getTerrainDef, getTileDef, isTerrain } from '../catalog';
import { CANAL_DEPTH, STREAM_SINK } from '../config';
import type { State } from '../world';
import { bankOf, canalStreamOf } from '../world';
import { type ScreenWindow, inWindow } from './drawables';
import { type P3, drawBox, poly, quad, shade } from './shapes';
import { type TerrainLook } from './terrainField';
import { createTerrainLayer } from './terrainLayer';

const COP = 0.1; // coping width, in tiles
const PIPE = 0x0e1422;
const SHADOW = 0x0a2846;

type Cells = ReadonlySet<string>;
const key = (x: number, y: number) => `${x},${y}`;

// The canal tiles (by cell), and the ones in the window to draw
export const canalCells = (state: State): Cells => new Set(state.tiles.filter((t) => t.defId === 'canal').map((t) => key(t.x, t.y)));
const inView = (state: State, win: ScreenWindow | null) =>
  state.tiles.filter((t) => t.defId === 'canal' && inWindow(win, { x: t.x, y: t.y, w: 1, h: 1 }, 0)).sort((a, b) => a.x + a.y - (b.x + b.y));

type Side = 'west' | 'north' | 'east' | 'south';
// u: distance in from the bank edge into the water cell, v: position along the bank
const along = (x: number, y: number, side: Side) =>
  ({
    west: (u: number, v: number, z = 0): P3 => [x + u, y + v, z],
    north: (u: number, v: number, z = 0): P3 => [x + v, y + u, z],
    east: (u: number, v: number, z = 0): P3 => [x + 1 - u, y + v, z],
    south: (u: number, v: number, z = 0): P3 => [x + v, y + 1 - u, z],
  })[side];

// The culverts on canal banks, with where their run starts and ends (for the V where the side banks close in)
const canalCulverts = (state: State, wet: Cells) =>
  state.culverts.flatMap((e) => {
    if (e.kind) return [];
    const b = bankOf(state, e);
    if (!b || !wet.has(key(b.cell.x, b.cell.y))) return [];
    const { x, y } = b.cell;
    const across = b.side === 'west' || b.side === 'east';
    const start = across ? !wet.has(key(x, y - 1)) : !wet.has(key(x - 1, y));
    const end = across ? !wet.has(key(x, y + 1)) : !wet.has(key(x + 1, y));
    return [{ x, y, side: b.side as Side, start, end }];
  });

// Canal outlets and inlets, by the canal cell they open and the side the stream is on, with where their
// run starts and ends (for the wing walls)
type Joint = Readonly<{ x: number; y: number; side: Side; kind: 'outlet' | 'inlet'; start: boolean; end: boolean }>;
const sideOf = (from: Readonly<{ x: number; y: number }>, to: Readonly<{ x: number; y: number }>): Side =>
  to.x < from.x ? 'west' : to.x > from.x ? 'east' : to.y < from.y ? 'north' : 'south';
export const canalJoints = (state: State): readonly Joint[] => {
  const all = state.culverts.flatMap((e) => {
    if (!e.kind) return [];
    const cs = canalStreamOf(state, e);
    return cs ? [{ ...cs.canal, side: sideOf(cs.canal, cs.stream), kind: e.kind }] : [];
  });
  const has = (x: number, y: number, side: Side, kind: string) => all.some((j) => j.x === x && j.y === y && j.side === side && j.kind === kind);
  return all.map((j) => {
    const across = j.side === 'west' || j.side === 'east';
    const [px, py, nx, ny] = across ? [j.x, j.y - 1, j.x, j.y + 1] : [j.x - 1, j.y, j.x + 1, j.y];
    return { ...j, start: !has(px, py, j.side, j.kind), end: !has(nx, ny, j.side, j.kind) };
  });
};
const STREAM_WATER = 0x287888;
const FOAM = 0xe2eef2;

// The opening: every canal tile at ground level (the mask the sunken layer is seen through)
export const drawCanalOpening = (g: Graphics, state: State, win: ScreenWindow | null): void => {
  inView(state, win).forEach((t) => poly(g, quad({ x: t.x, y: t.y, w: 1, h: 1 }, 0), 0xffffff, 1));
};

// Below ground: the water, the far banks' wall faces and their shadow on the water, culvert mouths
export const drawCanalSunk = (g: Graphics, state: State, win: ScreenWindow | null): void => {
  const cells = inView(state, win);
  if (cells.length === 0) return;
  const wet = canalCells(state);
  const w = (x: number, y: number) => wet.has(key(x, y));
  const { color, bank = 0xa8a29e } = getTileDef('canal');
  const D = -CANAL_DEPTH;
  const joints = canalJoints(state);
  const open = (x: number, y: number, side: Side) => joints.some((j) => j.x === x && j.y === y && j.side === side);
  cells.forEach(({ x, y }) => {
    poly(g, quad({ x, y, w: 1, h: 1 }, D), color, 1);
    if ((x + y) % 2 === 0) poly(g, quad({ x: x + 0.32, y: y + 0.52, w: 0.32, h: 0.04 }, D), shade(color, 1.32), 0.6);
  });
  cells.forEach(({ x, y }) => {
    // a soft shadow on the water under each far wall
    const north = !w(x, y - 1) && !open(x, y, 'north'), west = !w(x - 1, y) && !open(x, y, 'west');
    if (north) poly(g, quad({ x, y: y + COP, w: 1, h: 0.3 }, D), SHADOW, 0.22);
    if (west) poly(g, quad({ x: x + COP, y, w: 0.26, h: 1 }, D), SHADOW, 0.17);
    // the far walls, from the coping's inner edge down to the water
    if (north) poly(g, [[x, y + COP, 0], [x + 1, y + COP, 0], [x + 1, y + COP, D], [x, y + COP, D]], shade(bank, 0.74), 1);
    if (west) poly(g, [[x + COP, y, 0], [x + COP, y + 1, 0], [x + COP, y + 1, D], [x + COP, y, D]], shade(bank, 0.56), 1);
    // an inside corner (land only at the diagonal) shows the land block's corner: two short faces
    if (w(x - 1, y) && w(x, y - 1) && !w(x - 1, y - 1)) {
      poly(g, [[x, y + COP, 0], [x + COP, y + COP, 0], [x + COP, y + COP, D], [x, y + COP, D]], shade(bank, 0.74), 1);
      poly(g, [[x + COP, y, 0], [x + COP, y + COP, 0], [x + COP, y + COP, D], [x + COP, y, D]], shade(bank, 0.56), 1);
    }
  });
  // Outlets and inlets. The stream's water carries on into the opening (seen past the edge), then:
  // an outlet is a ribbed stone apron sloping from the canal's water down to the stream's at the edge;
  // an inlet is a weir: on a far side, a sheet of water pours down the face from its lip into the canal,
  // with foam at its foot (on a near side the face looks away, so only the foam shows)
  const S = -STREAM_SINK;
  joints.forEach((j) => {
    if (!inWindow(win, { x: j.x, y: j.y, w: 1, h: 1 }, 0)) return;
    const L = along(j.x, j.y, j.side);
    const far = j.side === 'west' || j.side === 'north';
    poly(g, [L(-1, 0, S), L(0, 0, S), L(0, 1, S), L(-1, 1, S)], STREAM_WATER, 1);
    if (j.kind === 'outlet') {
      poly(g, [L(0, 0, S), L(0, 1, S), L(0.55, 1, D), L(0.55, 0, D)], shade(bank, 0.92), 1);
      [0.14, 0.28, 0.42].forEach((u) => {
        const z = S + (D - S) * (u / 0.55);
        poly(g, [L(u, 0.02, z), L(u, 0.98, z), L(u + 0.025, 0.98, z), L(u + 0.025, 0.02, z)], shade(bank, 0.7), 1);
      });
      poly(g, [L(0, 0.06, S), L(0, 0.94, S), L(0.55, 0.94, D), L(0.55, 0.06, D)], 0x4696c8, 0.42);
    } else {
      const lip = COP * 1.4;
      if (far) {
        poly(g, [L(lip, 0, -2), L(lip, 1, -2), L(lip, 1, D), L(lip, 0, D)], 0x96c8e1, 0.85);
        [0.15, 0.37, 0.59, 0.81].forEach((v) => poly(g, [L(lip, v, -3), L(lip, v + 0.03, -3), L(lip, v + 0.12, D + 1), L(lip, v + 0.09, D + 1)], FOAM, 0.6));
      }
      poly(g, [L(far ? lip : 0.32, 0.04, D), L(far ? lip : 0.32, 0.96, D), L(0.5, 0.96, D), L(0.5, 0.04, D)], FOAM, 0.55);
    }
  });
  canalCulverts(state, wet).forEach(({ x, y, side, start, end }) => {
    if (!inWindow(win, { x, y, w: 1, h: 1 }, 0)) return;
    const L = along(x, y, side);
    if (side === 'west' || side === 'north') {
      // a far bank: two arched pipe mouths in the wall face, each in a stone ring
      const face = shade(bank, side === 'west' ? 0.5 : 0.66);
      const arch = (vc: number, r: number, h: number): P3[] =>
        Array.from({ length: 13 }, (_, k) => {
          const t = (k * Math.PI) / 12;
          return L(COP, vc + r * Math.cos(t), D - D * h * Math.sin(t));
        });
      [0.3, 0.7].forEach((vc) => {
        poly(g, arch(vc, 0.19, 0.9), face, 1);
        poly(g, arch(vc, 0.14, 0.7), PIPE, 1);
      });
      // where the side banks close in, the bank slopes down in a stone wedge
      if (start) poly(g, [L(COP, 0), L(COP + 0.45, 0), L(COP, 0.32, D)], shade(bank, 0.66), 1);
      if (end) poly(g, [L(COP, 1), L(COP + 0.45, 1), L(COP, 0.68, D)], shade(bank, 0.6), 1);
    } else {
      // a near bank: its wall is hidden, so the dark of the mouth shows on the water behind the lintel
      // (the lowered water shows up to about a third of a tile short of the near edge)
      poly(g, [L(0.32, 0, D), L(0.8, 0, D), L(0.8, 1, D), L(0.32, 1, D)], PIPE, 0.28);
      poly(g, [L(0.32, 0.08, D), L(0.58, 0.08, D), L(0.58, 0.92, D), L(0.32, 0.92, D)], PIPE, 0.6);
    }
  });
};

// At ground level, on top: coping along every bank, a post on every land corner, culvert lintels
export const drawCanalTop = (g: Graphics, state: State, win: ScreenWindow | null): void => {
  const cells = inView(state, win);
  if (cells.length === 0) return;
  const wet = canalCells(state);
  const w = (x: number, y: number) => wet.has(key(x, y));
  const { bank = 0xa8a29e } = getTileDef('canal');
  const lintels = new Set(canalCulverts(state, wet).filter((c) => c.side === 'south' || c.side === 'east').map((c) => `${c.x},${c.y},${c.side}`));
  const joints = canalJoints(state);
  const open = (x: number, y: number, side: Side) => joints.some((j) => j.x === x && j.y === y && j.side === side);
  cells.forEach(({ x, y }) => {
    if (!w(x, y - 1) && !open(x, y, 'north')) poly(g, quad({ x, y, w: 1, h: COP }, 0), bank, 1);
    if (!w(x - 1, y) && !open(x, y, 'west')) poly(g, quad({ x, y, w: COP, h: 1 }, 0), bank, 1);
    if (!w(x, y + 1) && !open(x, y, 'south')) poly(g, quad({ x, y: y + 1 - COP, w: 1, h: COP }, 0), bank, 1);
    if (!w(x + 1, y) && !open(x, y, 'east')) poly(g, quad({ x: x + 1 - COP, y, w: COP, h: 1 }, 0), bank, 1);
    ([[-1, -1, x, y], [1, -1, x + 1 - COP, y], [1, 1, x + 1 - COP, y + 1 - COP], [-1, 1, x, y + 1 - COP]] as const).forEach(([dx, dy, cx, cy]) => {
      if (!w(x + dx, y + dy)) poly(g, quad({ x: cx, y: cy, w: COP, h: COP }, 0), bank, 1);
    });
    // a near-bank culvert: a wider, lighter lintel stone where the coping would be
    if (lintels.has(`${x},${y},south`)) poly(g, quad({ x, y: y + 1 - COP * 1.5, w: 1, h: COP * 1.5 }, 0), shade(bank, 1.12), 1);
    if (lintels.has(`${x},${y},east`)) poly(g, quad({ x: x + 1 - COP * 1.5, y, w: COP * 1.5, h: 1 }, 0), shade(bank, 1.12), 1);
  });
};

// Outlet and inlet stonework at ground level: an inlet's weir lip, and low wing walls along both ends of
// a run, reaching from the canal's coping a little way along the stream's bank
export const drawJointTops = (g: Graphics, state: State, win: ScreenWindow | null): void => {
  const { bank = 0xa8a29e } = getTileDef('canal');
  canalJoints(state).forEach((j) => {
    if (!inWindow(win, { x: j.x, y: j.y, w: 1, h: 1 })) return;
    const L = along(j.x, j.y, j.side);
    if (j.kind === 'inlet') poly(g, [L(0, 0), L(0, 1), L(COP * 1.4, 1), L(COP * 1.4, 0)], shade(bank, 1.08), 1);
    // a wing wall: a thin box across the edge at a run's end, from inside the canal to past the bank
    const wing = (v: number) => {
      const [a, b] = [L(-0.7, v - 0.05), L(0.25, v + 0.05)];
      const rect = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) };
      drawBox(g, rect, 0, 3, shade(bank, 1.04), 1);
    };
    if (j.start) wing(0.05);
    if (j.end) wing(0.95);
  });
};

// A culvert on a stream bank: a stone headwall set into the bank, its top flush with the ground. On a far
// bank its face drops to the stream's water, and the water line cuts across the pipe mouths about a
// third of the way up, so the water runs into them; on a near bank the face looks away and only the
// top shows. The stream is flattened against it (terrainField.ts), so the water reaches the stone.
export const drawStreamCulverts = (g: Graphics, state: State, win: ScreenWindow | null): void => {
  const stone = 0xa8a29e;
  const S = -STREAM_SINK - 3; // the face reaches a little below the water line
  const WL = -STREAM_SINK + 2; // the water line on the face
  state.culverts.forEach((e) => {
    if (e.kind) return;
    const b = bankOf(state, e);
    if (!b) return;
    const water = state.tiles.find((t) => t.x === b.cell.x && t.y === b.cell.y);
    if (!water || water.defId !== 'stream') return;
    const { x, y } = b.cell;
    if (!inWindow(win, { x, y, w: 1, h: 1 })) return;
    const L = along(x, y, b.side);
    const T = 0.1; // the top's depth into the stream cell
    poly(g, [L(0, 0), L(0, 1), L(T, 1), L(T, 0)], stone, 1);
    if (b.side !== 'west' && b.side !== 'north') return;
    poly(g, [L(T, 0), L(T, 1), L(T, 1, S), L(T, 0, S)], shade(stone, b.side === 'west' ? 0.58 : 0.74), 1);
    const arch = (vc: number, r: number, h: number): P3[] =>
      Array.from({ length: 13 }, (_, k) => {
        const t = (k * Math.PI) / 12;
        return L(T, vc + r * Math.cos(t), WL - 5 + h * Math.sin(t));
      });
    [0.3, 0.7].forEach((vc) => {
      poly(g, arch(vc, 0.2, 15), shade(stone, 0.6), 1);
      poly(g, arch(vc, 0.15, 11), PIPE, 1);
    });
    // the water against the face, over the arches' feet, with a light ripple on top
    poly(g, [L(T, -0.02, WL), L(T, 1.02, WL), L(T, 1.02, S - 1), L(T, -0.02, S - 1)], STREAM_WATER, 0.94);
    poly(g, [L(T, 0, WL + 1), L(T, 1, WL + 1), L(T, 1, WL - 0.5), L(T, 0, WL - 0.5)], 0xaad7e1, 0.8);
  });
};

// All the water of a small state as its own layers, for pictures outside the game view (tray icons,
// blueprint cards): the stream through the terrain layer, the canal through its masked layers. ground
// sets the color around a stream (cards use a lighter grass than the game).
export const waterLayers = (state: State, ground?: number): Container => {
  const out = new Container();
  if (state.tiles.some((t) => t.defId === 'stream')) {
    const look = (id: string): TerrainLook | null =>
      id === state.ground && ground !== undefined ? { color: ground } : isTerrain(id) ? getTerrainDef(id) : null;
    const terrain = createTerrainLayer(look);
    terrain.render(state, null);
    out.addChild(terrain.container);
  }
  const sunk = new Graphics(), opening = new Graphics(), top = new Graphics(), box = new Container();
  drawCanalSunk(sunk, state, null);
  drawCanalOpening(opening, state, null);
  drawCanalTop(top, state, null);
  drawJointTops(top, state, null);
  drawStreamCulverts(top, state, null);
  box.addChild(sunk);
  box.mask = opening;
  out.addChild(box, opening, top);
  return out;
};
