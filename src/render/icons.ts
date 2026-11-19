// Icons are rendered from the catalog with the same drawing code as the game,
// so every item (including new ones) gets an icon that matches what gets placed.
import { Container, Graphics, type Renderer } from 'pixi.js';
import { CATALOG, type CatalogItem, type OpeningDef, type OpeningLook, getOpeningDef, getTileDef, getWallStyle, isPiece } from '../catalog';
import { CUT_WALL_H, WALL_H } from '../config';
import { cellsOf, sizeOf, toScreen } from '../geometry';
import { type State, initialState } from '../world';
import { waterLayers } from './water';
import { drawObject } from './draw';
import { drawBox, drawTile, drawWall, shade } from './shapes';

export type Icons = ReadonlyMap<string, string>; // item or tool id -> image data URL

// Tool icons live alongside item icons under their own keys
export const BULLDOZE_ICON = 'tool:bulldoze';
// The select tool's pointer arrow is plain SVG rather than a rendered scene
export const SELECT_ICON = 'tool:select';
const SELECT_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>" +
  "<path d='M9 4 L9 26 L14.5 20.5 L18.5 29 L22 27.5 L18 19 L25.5 19 Z' " +
  "fill='#f8fafc' stroke='#0f172a' stroke-width='1.6' stroke-linejoin='round'/></svg>";

export const PICKER_ICON = 'tool:picker';
const PICKER_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>" +
  "<path d='M20.5 4.5 a3.5 3.5 0 0 1 5 5 L22 13 L24 15 L21.5 17.5 L19.5 15.5 L9.5 25.5 L5.5 26.5 L6.5 22.5 L16.5 12.5 L14.5 10.5 L17 8 L19 10 Z' " +
  "fill='#e2e8f0' stroke='#0f172a' stroke-width='1.4' stroke-linejoin='round'/>" +
  "<path d='M7.6 23.4 L16.5 14.5 L17.5 15.5 L8.6 24.4 Z' fill='#38bdf8'/></svg>";

// Guides: two helper lines crossing on a grid tile
export const GUIDE_ICON = 'tool:guide';
const GUIDE_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>" +
  "<path d='M16 6 L28 13 L16 20 L4 13 Z' fill='#1e293b' stroke='#64748b' stroke-width='1.2' stroke-linejoin='round'/>" +
  "<path d='M7 8 L25 18.5 M25 8 L7 18.5' stroke='#22d3ee' stroke-width='2' stroke-linecap='round'/>" +
  "<circle cx='16' cy='13.2' r='2' fill='#f8fafc'/></svg>";

// Blueprints: a rolled-out plan sheet with a little floor plan on it (and a plus for saving one)
export const BLUEPRINT_ICON = 'tool:blueprint';
export const SAVE_BLUEPRINT_ICON = 'tool:save-blueprint';
const sheet = (extra: string): string =>
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>" +
  "<rect x='4' y='6' width='24' height='20' rx='2' fill='#1d4ed8' stroke='#0f172a' stroke-width='1.2'/>" +
  "<path d='M4 11 H28 M4 16 H28 M4 21 H28 M9 6 V26 M14 6 V26 M19 6 V26 M24 6 V26' stroke='#60a5fa' stroke-width='0.5' opacity='0.7'/>" +
  "<path d='M8 10 H20 V22 H8 Z M14 10 V16 H20 M8 16 H11' fill='none' stroke='#eff6ff' stroke-width='1.4' stroke-linejoin='round'/>" +
  extra + '</svg>';
const BLUEPRINT_SVG = sheet('');
const SAVE_BLUEPRINT_SVG = sheet(
  "<circle cx='24' cy='23' r='6' fill='#22c55e' stroke='#0f172a' stroke-width='1.2'/><path d='M24 20 V26 M21 23 H27' stroke='#f0fdf4' stroke-width='1.8' stroke-linecap='round'/>",
);

// Square-mode preview for each wall style, shown on the wall card's mode switch
export const squareIcon = (wallId: string): string => `square:${wallId}`;

const GRASS = 0x4b8f55;
const ICON_WALL = 0xe7e5e4;

// (a striped floor alternates its second color by column, as in the game)
const patch = (g: Graphics, w: number, h: number, color: number, stripe?: number): void =>
  cellsOf({ x: 0, y: 0, w, h }).forEach((c) => {
    const k = stripe !== undefined && c.x % 2 === 1 ? stripe : color;
    drawTile(g, c.x, c.y, k, shade(k, 0.85));
  });

// Terrain: a soft round patch of the item's color on a grass tile (rings fading out to the grass),
// with a few specks on it for flowery grass. The game's own look is drawn elsewhere; this is the tray's.
const ring = (cx: number, cy: number, r: number): number[] =>
  Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    const p = toScreen(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    return [p.sx, p.sy];
  }).flat();
const SPECK_AT: readonly (readonly [number, number])[] = [[0.7, 0.9], [1.25, 0.75], [0.95, 1.3], [1.4, 1.2], [0.6, 1.25], [1.1, 1.0]];
const terrainPatch = (g: Graphics, color: number, specks: readonly number[] = []): void => {
  patch(g, 2, 2, GRASS);
  [[0.95, 0.3], [0.8, 0.5], [0.65, 0.8], [0.5, 1]].forEach(([r, alpha]) => g.poly(ring(1, 1, r ?? 0)).fill({ color, alpha: alpha ?? 1 }));
  SPECK_AT.forEach(([x, y], i) => {
    const c = specks[i % Math.max(1, specks.length)];
    if (c === undefined) return;
    const p = toScreen(x, y);
    g.ellipse(p.sx, p.sy, 3, 1.8).fill(c);
  });
};

// Water icons are little scenes drawn the way the game draws water (sunken, see water.ts)
const waterScene = (g: Graphics, size: number, tiles: readonly Readonly<{ x: number; y: number; defId: string }>[], culverts: State['culverts'] = []): Container => {
  patch(g, size, size, GRASS);
  return waterLayers({ ...initialState, size: sizeOf(size, size), tiles, culverts });
};
// A 2x2 pool in a patch of grass, for the canal and stream icons
const waterPatch = (g: Graphics, id: string): Container =>
  waterScene(g, 4, cellsOf({ x: 1, y: 1, w: 2, h: 2 }).map((c) => ({ ...c, defId: id })));
// A canal meeting a stream, with an outlet or inlet on the edge between them
const jointPatch = (g: Graphics, kind: 'outlet' | 'inlet'): Container =>
  waterScene(g, 4, [
    ...[0, 1].flatMap((x) => [1, 2].map((y) => ({ x, y, defId: kind === 'outlet' ? 'canal' : 'stream' }))),
    ...[2, 3].flatMap((x) => [1, 2].map((y) => ({ x, y, defId: kind === 'outlet' ? 'stream' : 'canal' }))),
  ], [{ axis: 'y', x: 2, y: 1, kind }, { axis: 'y', x: 2, y: 2, kind }]);
// The end of a short canal with a culvert on its far bank
const culvertPatch = (g: Graphics): Container =>
  waterScene(g, 3, [{ x: 1, y: 0, defId: 'canal' }, { x: 1, y: 1, defId: 'canal' }, { x: 1, y: 2, defId: 'canal' }], [{ axis: 'x', x: 1, y: 0 }]);

// Fences show off better as a longer run than as a corner
const PREVIEW_FENCE = 'picket-fence';

// A wall piece in a style (a fence draws from its look)
const piece = (styleId: string, axis: 'x' | 'y', x: number, y: number, height: number, opening: OpeningLook | null = null, color?: number) => {
  const style = getWallStyle(styleId);
  return { axis, x, y, height: style.fence?.height ?? height, color: color ?? style.color, opening, alpha: 1, fence: style.fence, glass: style.glass };
};

// A corner of wall along the two front edges of a tile; a fence gets an L of three segments
const wallCorner = (g: Graphics, styleId: string): void => {
  const pole = getWallStyle(styleId).pole;
  if (pole) {
    // a short covered walkway: a row of poles behind, the canopy, and a row in front
    patch(g, 2, 1, GRASS);
    const row = (y: number) =>
      [0, 1].forEach((i) => drawWall(g, { ...piece(styleId, 'x', i, y, WALL_H), pole: { look: pole, posts: [true, i === 1] as const } }));
    row(0);
    drawBox(g, { x: 0, y: 0, w: 2, h: 1 }, WALL_H, 3, pole.canopy, 1);
    row(1);
    return;
  }
  if (getWallStyle(styleId).fence) {
    patch(g, 2, 2, GRASS);
    [0, 1].forEach((i) => drawWall(g, piece(styleId, 'x', i, 2, 0)));
    drawWall(g, piece(styleId, 'y', 2, 1, 0));
    return;
  }
  patch(g, 1, 1, GRASS);
  drawWall(g, piece(styleId, 'x', 0, 1, WALL_H));
  drawWall(g, piece(styleId, 'y', 1, 0, WALL_H));
};

// A paint: a corner of plaster wall in that color (Plain shows the bare plaster)
const paintPreview = (g: Graphics, color: number | null): void => {
  patch(g, 1, 1, GRASS);
  drawWall(g, piece('plaster', 'x', 0, 1, WALL_H, null, color ?? undefined));
  drawWall(g, piece('plaster', 'y', 1, 0, WALL_H, null, color ?? undefined));
};

// One wall segment showing the opening, seen from the front; a gate hangs in a picket fence
const wallWithOpening = (g: Graphics, opening: OpeningDef): void => {
  patch(g, 1, 1, GRASS);
  drawWall(g, opening.gate ? piece(PREVIEW_FENCE, 'x', 0, 1, 0, opening) : piece('plaster', 'x', 0, 1, WALL_H, opening, ICON_WALL));
};

// A small 2x2 room in cutaway: floor, tall back walls, low front walls
const roomPreview = (g: Graphics, wallId: string): void => {
  const style = getWallStyle(wallId);
  if (style.fence) {
    // a fenced square: no floor, no cutaway, just the fence all round
    patch(g, 2, 2, GRASS);
    [0, 1].forEach((i) => [0, 2].forEach((y) => drawWall(g, piece(wallId, 'x', i, y, 0))));
    [0, 1].forEach((j) => [0, 2].forEach((x) => drawWall(g, piece(wallId, 'y', x, j, 0))));
    return;
  }
  patch(g, 2, 2, getTileDef(style.floor ?? 'wood-floor').color);
  const wall = (axis: 'x' | 'y', x: number, y: number, height: number) =>
    drawWall(g, { axis, x, y, height, color: style.color, opening: null, alpha: 1 });
  [0, 1].forEach((i) => wall('x', i, 0, WALL_H));
  [0, 1].forEach((j) => wall('y', 0, j, WALL_H));
  [0, 1].forEach((i) => wall('x', i, 2, CUT_WALL_H));
  [0, 1].forEach((j) => wall('y', 2, j, CUT_WALL_H));
};

// A wide opening across three wall segments: start, middle, end
const spanPreview = (g: Graphics, item: OpeningDef): void => {
  patch(g, 3, 1, GRASS);
  const pieces = item.pieces ? [item.pieces.start, item.pieces.middle, item.pieces.end] : [];
  pieces.forEach((id, i) =>
    drawWall(g, item.gate ? piece(PREVIEW_FENCE, 'x', i, 1, 0, getOpeningDef(id)) : piece('plaster', 'x', i, 1, WALL_H, getOpeningDef(id), ICON_WALL)),
  );
};

const drawPreview = (g: Graphics, item: CatalogItem): Container | void => {
  switch (item.kind) {
    case 'object':
      patch(g, item.w, item.h, GRASS);
      return drawObject(g, { defId: item.id, rotation: 0, x: 0, y: 0, alpha: 1 });
    case 'culvert':
      return item.piece ? jointPatch(g, item.piece) : culvertPatch(g);
    case 'paint':
      return paintPreview(g, item.color);
    case 'terrain':
      return terrainPatch(g, item.color, item.specks);
    case 'tile':
      return item.bank === undefined ? patch(g, 2, 2, item.color, item.stripe) : waterPatch(g, item.id);
    case 'wall':
      return wallCorner(g, item.id);
    case 'opening':
      return item.pieces ? spanPreview(g, item) : wallWithOpening(g, item);
  }
};

// A little bulldozer built from boxes: tracks, body, cab and a blade on the front
const drawBulldozer = (g: Graphics): void => {
  patch(g, 1, 1, GRASS);
  const box = (x: number, y: number, w: number, h: number, z: number, height: number, color: number) =>
    drawBox(g, { x, y, w, h }, z, height, color, 1);
  box(0.12, 0.12, 0.7, 0.18, 0, 8, 0x1f2937); // far track
  box(0.12, 0.62, 0.7, 0.18, 0, 8, 0x1f2937); // near track
  box(0.16, 0.2, 0.62, 0.52, 8, 10, 0xfacc15); // body
  box(0.18, 0.26, 0.32, 0.4, 18, 14, 0xeab308); // cab
  box(0.22, 0.3, 0.24, 0.32, 26, 5, 0x7dd3fc); // window band
  box(0.86, 0.06, 0.08, 0.86, 0, 14, 0x9ca3af); // blade
};

// draw paints into one Graphics, and may hand back layers to put on top of it (masked or picture
// layers, like sunken water, cannot live in a single Graphics)
export const toDataUrl = (renderer: Renderer, draw: (g: Graphics) => Container | void): string => {
  const g = new Graphics();
  const extra = draw(g);
  const target = extra ? new Container() : g;
  if (extra) (target as Container).addChild(g, extra);
  const canvas = renderer.extract.canvas({ target, resolution: 2, antialias: true }) as HTMLCanvasElement;
  target.destroy({ children: true });
  return canvas.toDataURL();
};

export const createIcons = (renderer: Renderer): Icons =>
  new Map([
    ...CATALOG.filter((item) => !isPiece(item)).map((item) => [item.id, toDataUrl(renderer, (g) => drawPreview(g, item))] as const),
    ...CATALOG.filter((i) => i.kind === 'wall').map(
      (w) => [squareIcon(w.id), toDataUrl(renderer, (g) => roomPreview(g, w.id))] as const,
    ),
    [BULLDOZE_ICON, toDataUrl(renderer, drawBulldozer)] as const,
    [SELECT_ICON, `data:image/svg+xml,${encodeURIComponent(SELECT_SVG)}`] as const,
    [PICKER_ICON, `data:image/svg+xml,${encodeURIComponent(PICKER_SVG)}`] as const,
    [BLUEPRINT_ICON, `data:image/svg+xml,${encodeURIComponent(BLUEPRINT_SVG)}`] as const,
    [GUIDE_ICON, `data:image/svg+xml,${encodeURIComponent(GUIDE_SVG)}`] as const,
    [SAVE_BLUEPRINT_ICON, `data:image/svg+xml,${encodeURIComponent(SAVE_BLUEPRINT_SVG)}`] as const,
  ]);
