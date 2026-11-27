// Reading pieces back from storage, shared by blueprints and saved games. Every reader is forgiving
// and checks one piece at a time: what does not parse, or names an item the catalog no longer has, is
// dropped (null) instead of breaking the load. An unknown door leaves its wall; an unknown wall goes.
import { CATALOG, type CatalogItem, OLD_FINISHES, TILE_TO_TERRAIN, isFinish } from './catalog';
import type { Cell, Edge } from './geometry';
import type { ObjectEntity, TerrainCell, Tile, WallSegment } from './world';

const byId = new Map<string, CatalogItem>(CATALOG.map((i) => [i.id, i]));
export const isKind = (id: unknown, kind: CatalogItem['kind']): id is string => typeof id === 'string' && byId.get(id)?.kind === kind;
export const int = (n: unknown): n is number => Number.isInteger(n);
export const cell = (c: unknown): c is Cell => typeof c === 'object' && c !== null && int((c as Cell).x) && int((c as Cell).y);
export const edge = (e: unknown): e is Edge => cell(e) && ((e as Edge).axis === 'x' || (e as Edge).axis === 'y');
export const list = (xs: unknown): readonly unknown[] => (Array.isArray(xs) ? xs : []);
export const keep = <T>(xs: readonly (T | null)[]): T[] => xs.filter((x): x is T => x !== null);

export const object = (o: unknown): ObjectEntity | null => {
  const x = o as ObjectEntity;
  return cell(x) && isKind(x.defId, 'object') && int(x.w) && int(x.h) && [0, 1, 2, 3].includes(x.rotation)
    ? { id: int(x.id) ? x.id : 0, defId: x.defId, x: x.x, y: x.y, w: x.w, h: x.h, rotation: x.rotation }
    : null;
};

// A side's coats: its paint (a color) and its finish (#11b). A finish saved by the first build of #11b sits in
// the paint and reads as that finish plus its closest color; a finish saved on its own wins over that.
const coatsOf = (paint: unknown, finish: unknown): readonly [string | null, string | null] => {
  const old = typeof paint === 'string' && Object.hasOwn(OLD_FINISHES, paint) ? OLD_FINISHES[paint] : undefined;
  const color = old ? old[1] : isKind(paint, 'paint') && !isFinish(paint) ? paint : null;
  const texture = isKind(finish, 'paint') && isFinish(finish) && finish !== 'finish-none' ? finish : (old?.[0] ?? null);
  return [color, texture];
};
export const wall = (w: unknown): WallSegment | null => {
  const x = w as WallSegment;
  if (!edge(x) || !isKind(x.styleId, 'wall')) return null;
  const opening = isKind(x.opening, 'opening') ? x.opening : null;
  const [pb, fb] = coatsOf(x.paint?.before, x.finish?.before);
  const [pa, fa] = coatsOf(x.paint?.after, x.finish?.after);
  return { axis: x.axis, x: x.x, y: x.y, styleId: x.styleId, opening, paint: { before: pb, after: pa }, finish: { before: fb, after: fa } };
};

export const tile = (t: unknown): Tile | null => {
  const x = t as Tile;
  return cell(x) && isKind(x.defId, 'tile') ? { x: x.x, y: x.y, defId: x.defId } : null;
};

// Terrain is every tile's ground. `grass` is an entry like any other (on a sand map it is painted over the sand);
// dropping entries that equal a map's ground happens where the pieces land
export const terrain = (t: unknown): TerrainCell | null => {
  const x = t as TerrainCell;
  return cell(x) && isKind(x.defId, 'terrain') ? { x: x.x, y: x.y, defId: x.defId } : null;
};

// Gravel and sand were path tiles before terrain existed. Older saves and blueprints get terrain at the
// same cell instead (and the tile leaves the tiles).
export const oldTerrainTile = (t: unknown): string | null => {
  const id = (t as { defId?: unknown } | null)?.defId;
  return typeof id === 'string' && Object.hasOwn(TILE_TO_TERRAIN, id) ? (TILE_TO_TERRAIN[id] ?? null) : null;
};

// A culvert edge keeps its kind (a canal outlet or inlet); an unknown kind reads as a plain culvert
export const culvert = (e: unknown): (Edge & { kind?: 'outlet' | 'inlet' }) | null => {
  if (!edge(e)) return null;
  const kind = (e as { kind?: unknown }).kind;
  return kind === 'outlet' || kind === 'inlet' ? { axis: e.axis, x: e.x, y: e.y, kind } : { axis: e.axis, x: e.x, y: e.y };
};
