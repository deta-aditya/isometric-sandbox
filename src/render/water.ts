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
import { CANAL_DEPTH, INLET_RAISE, STREAM_DEPTH } from '../config';
import type { State } from '../world';
import { type CulvertShape, canalStreamOf, culvertShape } from '../world';
import { type ScreenWindow, inWindow } from './drawables';
import { type P3, drawBox, poly, quad, shade } from './shapes';
import type { Rect } from '../geometry';
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
const STREAM_WATER = 0x308398; // the stream's own water color in its middle (terrainField)
const FOAM = 0xe2eef2;

// The opening: every canal tile at ground level (the mask the sunken layer is seen through)
export const drawCanalOpening = (g: Graphics, state: State, win: ScreenWindow | null): void => {
  inView(state, win).forEach((t) => poly(g, quad({ x: t.x, y: t.y, w: 1, h: 1 }, 0), 0xffffff, 1));
};

// Below ground: the water, the far banks' wall faces and their shadow on the water, and the canal's side
// of outlets and inlets
export const drawCanalSunk = (g: Graphics, state: State, win: ScreenWindow | null): void => {
  const cells = inView(state, win);
  if (cells.length === 0) return;
  const wet = canalCells(state);
  const w = (x: number, y: number) => wet.has(key(x, y));
  const { color, bank = 0xa8a29e } = getTileDef('canal');
  const D = -CANAL_DEPTH;
  const joints = canalJoints(state);
  const open = (x: number, y: number, side: Side) => joints.some((j) => j.x === x && j.y === y && j.side === side);
  // past a joint with the stream behind, the lined tile's water shows beyond the lip (under the canal's)
  joints.forEach((j) => inWindow(win, { x: j.x, y: j.y, w: 1, h: 1 }, 0) && drawJointBeyond(g, j));
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
  joints.forEach((j) => inWindow(win, { x: j.x, y: j.y, w: 1, h: 1 }, 0) && drawJointInCanal(g, j));
};

// At ground level, on top: coping along every bank, a post on every land corner
export const drawCanalTop = (g: Graphics, state: State, win: ScreenWindow | null): void => {
  const cells = inView(state, win);
  if (cells.length === 0) return;
  const wet = canalCells(state);
  const w = (x: number, y: number) => wet.has(key(x, y));
  const { bank = 0xa8a29e } = getTileDef('canal');
  const joints = canalJoints(state);
  const open = (x: number, y: number, side: Side) => joints.some((j) => j.x === x && j.y === y && j.side === side);
  cells.forEach(({ x, y }) => {
    if (!w(x, y - 1) && !open(x, y, 'north')) poly(g, quad({ x, y, w: 1, h: COP }, 0), bank, 1);
    if (!w(x - 1, y) && !open(x, y, 'west')) poly(g, quad({ x, y, w: COP, h: 1 }, 0), bank, 1);
    if (!w(x, y + 1) && !open(x, y, 'south')) poly(g, quad({ x, y: y + 1 - COP, w: 1, h: COP }, 0), bank, 1);
    if (!w(x + 1, y) && !open(x, y, 'east')) poly(g, quad({ x: x + 1 - COP, y, w: COP, h: 1 }, 0), bank, 1);
    ([[-1, -1, x, y], [1, -1, x + 1 - COP, y], [1, 1, x + 1 - COP, y + 1 - COP], [-1, 1, x, y + 1 - COP]] as const).forEach(([dx, dy, cx, cy]) => {
      // no post in the middle of a joint (the corner lies on an open side, with canal along it)
      const sx = dx < 0 ? 'west' : 'east', sy = dy < 0 ? 'north' : 'south';
      if ((open(x, y, sx) && w(x, y + dy)) || (open(x, y, sy) && w(x + dx, y))) return;
      if (!w(x + dx, y + dy)) poly(g, quad({ x: cx, y: cy, w: COP, h: COP }, 0), bank, 1);
    });
  });
};

// Canal outlets and inlets (#17f). The stream tile at a joint is lined with stone: its walls carry the
// canal's own walls straight on (flush coping, one line from canal to stream) and end in a small post on
// each side where the natural bank begins. A run of joints shares its walls, like culvert pieces: a wall
// stands only where the next tile along is not part of the run. The water falls across the joint:
//   outlet (canal into stream): the canal's end drops to a lip just above the canal's water, and the
//     water falls into the lined tile at the stream's level, foaming on the stream;
//   inlet (stream into canal): the stream is raised in the lined tile to just under the ground, held by
//     a lip, and falls into the canal, foaming on the canal (the stream rises toward it: terrainField).
// The falling face looks toward the low side, so it shows only when the low side is nearer the camera;
// the foam always shows where the water lands.
//
// Everything is placed with along() from the canal cell: u = 0 is the joint, u > 0 the canal, u < 0 the
// lined stream tile (u = -1 its open end); v runs along the joint.
const LIP = 1.5; // a lip's top above the water it holds back
const SHEET = 0x9fcde0;
const jointLevels = (j: Joint) => {
  const lined = j.kind === 'inlet' ? -INLET_RAISE : -STREAM_DEPTH;
  const high = j.kind === 'inlet' ? lined : -CANAL_DEPTH, low = j.kind === 'inlet' ? -CANAL_DEPTH : lined;
  // +u (the canal) is nearer the camera when the stream lies west or north of it
  const streamFront = j.side === 'east' || j.side === 'south';
  const lowFront = j.kind === 'inlet' ? !streamFront : streamFront;
  return { lined, high, low, streamFront, lowFront };
};

// The lined tile's water and the inside face of its walls that looks toward the camera (+v always does)
const drawLinedWater = (g: Graphics, j: Joint, bank: number) => {
  const L = along(j.x, j.y, j.side);
  const { lined } = jointLevels(j);
  poly(g, [L(-1, 0, lined), L(0, 0, lined), L(0, 1, lined), L(-1, 1, lined)], STREAM_WATER, 1);
  if (j.start) poly(g, [L(-1, COP), L(0, COP), L(0, COP, lined), L(-1, COP, lined)], shade(bank, 0.6), 1);
};

// The falling water at the joint: the stone face from the lip down to the low water, the higher water
// seen over the lip, the sheet and its streaks
const drawFall = (g: Graphics, j: Joint, bank: number) => {
  const L = along(j.x, j.y, j.side);
  const { high, low } = jointLevels(j);
  const lip = high + LIP;
  poly(g, [L(0, 0, 0), L(0, 1, 0), L(0, 1, lip), L(0, 0, lip)], j.kind === 'inlet' ? STREAM_WATER : getTileDef('canal').color, 1);
  poly(g, [L(0, 0, lip), L(0, 1, lip), L(0, 1, low), L(0, 0, low)], shade(bank, 0.7), 1);
  // the sheet runs on unbroken across a run of joints, stopping just short of the walls at its two ends
  const [v0, v1] = [j.start ? 0.04 : 0, j.end ? 0.96 : 1];
  poly(g, [L(0, v0, high - 0.3), L(0, v1, high - 0.3), L(0, v1, low), L(0, v0, low)], SHEET, 0.92);
  for (let v = 0.1; v < 0.95; v += 0.17) poly(g, [L(0, v, high - 0.5), L(0, v + 0.035, high - 0.5), L(0, v + 0.05, low + 0.4), L(0, v + 0.015, low + 0.4)], FOAM, 0.75);
};

// Foam where the water lands, on the low side (further in when the low side is behind, where the joint
// would hide the water right next to it)
const drawLanding = (g: Graphics, j: Joint) => {
  const L = along(j.x, j.y, j.side);
  const { low, lowFront } = jointLevels(j);
  const dir = j.kind === 'inlet' ? 1 : -1; // the low side: the canal (+u) or the stream (-u)
  const [a, b] = lowFront ? [0.02, 0.42] : [0.35, 1];
  poly(g, [L(dir * a, 0.03, low), L(dir * a, 0.97, low), L(dir * b, 0.97, low), L(dir * b, 0.03, low)], FOAM, 0.5);
  for (let v = 0.08; v < 0.95; v += 0.21) poly(g, [L(dir * a, v, low), L(dir * a, v + 0.07, low), L(dir * b, v + 0.05, low), L(dir * b, v + 0.02, low)], FOAM, 0.7);
};

// In the canal's masked layer, before its water: with the stream behind, the lined tile shows past the lip
const drawJointBeyond = (g: Graphics, j: Joint) => {
  if (jointLevels(j).streamFront) return;
  drawLinedWater(g, j, getTileDef('canal').bank ?? 0xa8a29e);
};

// In the canal's masked layer, after its walls: the outlet's lip, and the fall and foam when the canal is
// the low side (an inlet)
const drawJointInCanal = (g: Graphics, j: Joint) => {
  const bank = getTileDef('canal').bank ?? 0xa8a29e;
  const L = along(j.x, j.y, j.side);
  const { high, lowFront } = jointLevels(j);
  if (j.kind === 'outlet') poly(g, [L(0, 0, high + LIP), L(0, 1, high + LIP), L(0.12, 1, high + LIP), L(0.12, 0, high + LIP)], shade(bank, 1.05), 1);
  if (j.kind === 'inlet') {
    if (lowFront) drawFall(g, j, bank);
    drawLanding(g, j);
  }
};

// The lined tiles' opening: what is drawn in drawJointSunk shows only there
export const drawJointOpening = (g: Graphics, state: State, win: ScreenWindow | null): void => {
  canalJoints(state).forEach((j) => {
    if (!inWindow(win, { x: j.x, y: j.y, w: 1, h: 1 }, 1)) return;
    const L = along(j.x, j.y, j.side);
    poly(g, [L(-1, 0), L(0, 0), L(0, 1), L(-1, 1)], 0xffffff, 1);
  });
};

// Below ground in the lined tiles: the water, the walls' inside face, the joint's face toward the stream
// when the stream is in front (the fall for an outlet, plain stone holding an inlet's raised water), and
// for an outlet the foam on the stream
export const drawJointSunk = (g: Graphics, state: State, win: ScreenWindow | null): void => {
  const bank = getTileDef('canal').bank ?? 0xa8a29e;
  canalJoints(state).forEach((j) => {
    if (!inWindow(win, { x: j.x, y: j.y, w: 1, h: 1 }, 1)) return;
    const L = along(j.x, j.y, j.side);
    const { lined, streamFront, lowFront } = jointLevels(j);
    drawLinedWater(g, j, bank);
    if (streamFront) {
      if (j.kind === 'outlet' && lowFront) drawFall(g, j, bank);
      else poly(g, [L(0, 0, 0), L(0, 1, 0), L(0, 1, lined), L(0, 0, lined)], shade(bank, 0.7), 1);
    }
    if (j.kind === 'outlet') drawLanding(g, j);
  });
};

// At ground level: the lined tile's coping along its walls, a post where each wall ends at the natural
// bank, and an inlet's lip (it lies just under the ground, so it needs no mask)
export const drawJointTops = (g: Graphics, state: State, win: ScreenWindow | null): void => {
  const bank = getTileDef('canal').bank ?? 0xa8a29e;
  canalJoints(state).forEach((j) => {
    if (!inWindow(win, { x: j.x, y: j.y, w: 1, h: 1 }, 1)) return;
    const L = along(j.x, j.y, j.side);
    if (j.kind === 'inlet') {
      const z = jointLevels(j).lined + LIP;
      poly(g, [L(-0.12, 0, z), L(0, 0, z), L(0, 1, z), L(-0.12, 1, z)], shade(bank, 1.05), 1);
    }
    const rectOf = (u0: number, v0: number, u1: number, v1: number) => {
      const [a, b] = [L(u0, v0), L(u1, v1)];
      return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) };
    };
    const POST = 0.16;
    if (j.start) {
      poly(g, quad(rectOf(-1, 0, 0, COP), 0), bank, 1);
      drawBox(g, rectOf(-1, -0.03, -1 + POST, POST - 0.03), 0, 3, shade(bank, 1.04), 1);
    }
    if (j.end) {
      poly(g, quad(rectOf(-1, 1 - COP, 0, 1), 0), bank, 1);
      drawBox(g, rectOf(-1, 1 - POST + 0.03, -1 + POST, 1.03), 0, 3, shade(bank, 1.04), 1);
    }
  });
};

// Culverts: stonework on the water tile at a channel's end (the shape comes from culvertShape in
// world.ts). A back wall stands along the bank with a wall at either side where the bank turns, so the
// channel's sides always end against stone: a U on a 1-wide channel, Ls at the corners of a wider end,
// the back wall alone in between. The walls rise a little above the ground; their faces toward the water
// drop to the water's surface, and two pipe mouths in the back wall sit half under water.
//
// Each wall is an upright box. What lies below ground is drawn into the masked sunk layer (it shows only
// over water, like the canal's own walls); what stands above ground is drawn on top.
const WALL = 0.14; // wall thickness, in tiles
const RISE = 6; // how far the back wall stands above the ground, in pixels
const RISE_END = 1; // the side walls slope down from the back wall's height to this at the open end
const STONE = 0xb4ada3;
// joined: the next tile along the edge (the after side) has a piece with the same back, so the back
// walls run on and the end face between them is not drawn
// Each wall is a box; a side wall's top slopes (from the back wall's height at the corner down toward the
// open end), and top gives the height of a wall's top at a grid point
type Wall = Readonly<{ r: Rect; slope: boolean }>;
type Piece = CulvertShape & Readonly<{ depth: number; boxes: readonly Wall[]; joined: boolean; top: (w: Wall, gx: number, gy: number) => number }>;
const culvertPieces = (state: State, win: ScreenWindow | null): readonly Piece[] =>
  state.culverts.flatMap((e) => {
    if (e.kind) return [];
    const p = culvertShape(state, e);
    if (!p || !inWindow(win, { x: p.cell.x, y: p.cell.y, w: 1, h: 1 })) return [];
    const water = state.tiles.find((t) => t.x === p.cell.x && t.y === p.cell.y)?.defId;
    const L = along(p.cell.x, p.cell.y, p.back);
    // a box between two (u, v) corners, as a grid rect
    const box = (u0: number, v0: number, u1: number, v1: number): Rect => {
      const [a, b] = [L(u0, v0), L(u1, v1)];
      return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) };
    };
    // v runs along the edge from the before side (v = 0) to the after side
    const boxes: Wall[] = [{ r: box(0, 0, WALL, 1), slope: false }];
    if (p.before) boxes.push({ r: box(0, 0, 1, WALL), slope: true });
    if (p.after) boxes.push({ r: box(0, 1 - WALL, 1, 1), slope: true });
    const { x, y } = p.cell;
    // how far a point lies in from the back edge
    const inward = (gx: number, gy: number) => ({ west: gx - x, north: gy - y, east: x + 1 - gx, south: y + 1 - gy })[p.back];
    const top = (w: Wall, gx: number, gy: number) =>
      w.slope ? RISE_END + (RISE - RISE_END) * Math.min(1, Math.max(0, (1 - inward(gx, gy)) / (1 - WALL))) : RISE;
    const [ax, ay] = p.back === 'north' || p.back === 'south' ? [1, 0] : [0, 1];
    const joined = state.culverts.some((c) => {
      if (c.kind) return false;
      const q = culvertShape(state, c);
      return q !== null && q.back === p.back && q.cell.x === p.cell.x + ax && q.cell.y === p.cell.y + ay;
    });
    return [{ ...p, depth: water === 'stream' ? STREAM_DEPTH : CANAL_DEPTH, boxes, joined, top }];
  });

// The two faces of a box that look toward the camera (+y, then +x), each with whether water lies in
// front of it (then it reaches down to the water) and the shade it takes
const facesOf = (state: State, p: Piece, w: Wall) => {
  const r = w.r;
  const wet = (x: number, y: number) => state.tiles.some((t) => t.x === x && t.y === y && (t.defId === 'canal' || t.defId === 'stream'));
  const { x, y } = p.cell;
  const y1 = r.y + r.h, x1 = r.x + r.w;
  // a face inside the tile looks onto the piece's own water; one on the tile's edge onto the neighbor
  const southWet = y1 < y + 1 - 1e-6 || wet(Math.floor(r.x + r.w / 2), y + 1);
  const eastWet = x1 < x + 1 - 1e-6 || wet(x + 1, Math.floor(r.y + r.h / 2));
  // the back wall's end face toward a joined neighbor is hidden inside the wall that runs on
  const back = w === p.boxes[0] && p.joined;
  const across = p.back === 'north' || p.back === 'south';
  return [
    // a face's corners: from z0 up to z1, or up to the wall's own top when z1 is not given
    { pts: (z0: number, z1?: number): P3[] => [[r.x, y1, z1 ?? p.top(w, r.x, y1)], [x1, y1, z1 ?? p.top(w, x1, y1)], [x1, y1, z0], [r.x, y1, z0]], wet: southWet, tone: 0.76, hidden: back && !across },
    { pts: (z0: number, z1?: number): P3[] => [[x1, y1, z1 ?? p.top(w, x1, y1)], [x1, r.y, z1 ?? p.top(w, x1, r.y)], [x1, r.y, z0], [x1, y1, z0]], wet: eastWet, tone: 0.58, hidden: back && across },
  ].filter((f) => !f.hidden);
};

// Where pieces stand the sunk layer must show: the piece's tile, and the water just in front of it (the
// side walls' faces reach a little over it, the way the water lies lower than the ground)
export const drawCulvertOpening = (g: Graphics, state: State, win: ScreenWindow | null): void => {
  culvertPieces(state, win).forEach((p) => {
    const L = along(p.cell.x, p.cell.y, p.back);
    const [fx, fy] = L(1.5, 0.5);
    const front = state.tiles.some((t) => t.x === Math.floor(fx) && t.y === Math.floor(fy) && (t.defId === 'canal' || t.defId === 'stream'));
    poly(g, [L(0, 0), L(0, 1), L(front ? 2 : 1, 1), L(front ? 2 : 1, 0)], 0xffffff, 1);
  });
};

// Below ground: the wall faces down to the water, the pipe mouths in the back wall, a little foam
export const drawCulvertSunk = (g: Graphics, state: State, win: ScreenWindow | null): void => {
  culvertPieces(state, win).forEach((p) => {
    const D = -p.depth;
    p.boxes.forEach((w) => facesOf(state, p, w).forEach((f) => f.wet && poly(g, f.pts(D, 0), shade(STONE, f.tone * 0.9), 1)));
    // the mouths show only where the back wall's inner face looks toward the camera (a far bank)
    if (p.back !== 'west' && p.back !== 'north') return;
    const L = along(p.cell.x, p.cell.y, p.back);
    const lo = p.before ? WALL : 0, hi = p.after ? 1 - WALL : 1;
    const zc = D - 1; // the mouths' middle is just under the water, so a bit under half of each shows
    const arch = (vc: number, r: number, h: number): P3[] =>
      Array.from({ length: 13 }, (_, k) => {
        const t = (k * Math.PI) / 12;
        return L(WALL, vc + r * Math.cos(t), Math.max(D, zc + h * Math.sin(t)));
      });
    const span = hi - lo;
    [lo + span * 0.3, lo + span * 0.7].forEach((vc) => {
      poly(g, arch(vc, span * 0.2, p.depth * 0.95), shade(STONE, 0.62), 1);
      poly(g, arch(vc, span * 0.15, p.depth * 0.78), PIPE, 1);
      // a ripple where the water comes out of the mouth
      poly(g, [L(WALL, vc - span * 0.12, D), L(WALL, vc + span * 0.12, D), L(WALL + 0.07, vc + span * 0.12, D), L(WALL + 0.07, vc - span * 0.12, D)], FOAM, 0.45);
    });
  });
};

// Above ground: each wall's faces up to its top, then the top
export const drawCulvertTops = (g: Graphics, state: State, win: ScreenWindow | null): void => {
  culvertPieces(state, win).forEach((p) => {
    // back to front, so where walls meet at a corner the nearer one lies on top
    const depth = (w: Wall) => w.r.x + w.r.w / 2 + w.r.y + w.r.h / 2;
    [...p.boxes].sort((m, n) => depth(m) - depth(n)).forEach((w) => {
      facesOf(state, p, w).forEach((f) => poly(g, f.pts(0), shade(STONE, f.tone), 1));
      poly(g, quad(w.r, 0).map(([gx, gy]): P3 => [gx, gy, p.top(w, gx, gy)]), STONE, 1);
    });
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
  const lined = new Graphics(), linedMask = new Graphics(), linedBox = new Container();
  drawJointSunk(lined, state, null);
  drawJointOpening(linedMask, state, null);
  linedBox.addChild(lined);
  linedBox.mask = linedMask;
  drawCulvertSunk(sunk, state, null);
  drawCulvertOpening(opening, state, null);
  drawCulvertTops(top, state, null);
  box.addChild(sunk);
  box.mask = opening;
  out.addChild(box, opening, linedBox, linedMask, top);
  return out;
};
