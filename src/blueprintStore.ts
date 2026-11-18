// Blueprints are kept by the browser between visits. The format is versioned, and reading is
// forgiving: anything that does not parse, or names an item the catalog no longer has, is dropped
// rather than breaking the game (a door that no longer exists leaves its wall; an unknown wall goes).
import { CATALOG, type CatalogItem } from './catalog';
import type { Cell, Edge } from './geometry';
import type { Blueprint, ObjectEntity, Pieces, Tile, WallSegment } from './world';

const KEY = 'iso-sandbox:blueprints';
const VERSION = 1;

const byId = new Map<string, CatalogItem>(CATALOG.map((i) => [i.id, i]));
const isKind = (id: unknown, kind: CatalogItem['kind']): id is string => typeof id === 'string' && byId.get(id)?.kind === kind;
const int = (n: unknown): n is number => Number.isInteger(n);
const cell = (c: unknown): c is Cell => typeof c === 'object' && c !== null && int((c as Cell).x) && int((c as Cell).y);
const edge = (e: unknown): e is Edge => cell(e) && ((e as Edge).axis === 'x' || (e as Edge).axis === 'y');
const list = (xs: unknown): readonly unknown[] => (Array.isArray(xs) ? xs : []);

const object = (o: unknown): ObjectEntity | null => {
  const x = o as ObjectEntity;
  return cell(x) && isKind(x.defId, 'object') && int(x.w) && int(x.h) && [0, 1, 2, 3].includes(x.rotation)
    ? { id: int(x.id) ? x.id : 0, defId: x.defId, x: x.x, y: x.y, w: x.w, h: x.h, rotation: x.rotation }
    : null;
};
const paintOf = (p: unknown): string | null => (isKind(p, 'paint') ? p : null);
const wall = (w: unknown): WallSegment | null => {
  const x = w as WallSegment;
  if (!edge(x) || !isKind(x.styleId, 'wall')) return null;
  const opening = isKind(x.opening, 'opening') ? x.opening : null;
  return { axis: x.axis, x: x.x, y: x.y, styleId: x.styleId, opening, paint: { before: paintOf(x.paint?.before), after: paintOf(x.paint?.after) } };
};
const tile = (t: unknown): Tile | null => {
  const x = t as Tile;
  return cell(x) && isKind(x.defId, 'tile') ? { x: x.x, y: x.y, defId: x.defId } : null;
};
const keep = <T>(xs: readonly (T | null)[]): T[] => xs.filter((x): x is T => x !== null);

const pieces = (p: unknown): Pieces => {
  const x = (p ?? {}) as Record<string, unknown>;
  return {
    objects: keep(list(x.objects).map(object)),
    walls: keep(list(x.walls).map(wall)),
    tiles: keep(list(x.tiles).map(tile)),
    culverts: list(x.culverts).filter(edge).map((e) => ({ axis: e.axis, x: e.x, y: e.y })),
  };
};

const blueprint = (b: unknown): Blueprint | null => {
  const x = b as Blueprint;
  if (!int(x?.id) || typeof x.name !== 'string' || !cell(x.anchor)) return null;
  const p = pieces(x.pieces);
  const count = p.objects.length + p.walls.length + p.tiles.length + p.culverts.length;
  return count > 0 ? { id: x.id, name: x.name.slice(0, 40) || 'Blueprint', pieces: p, anchor: { x: x.anchor.x, y: x.anchor.y } } : null;
};

export const encodeBlueprints = (bs: readonly Blueprint[]): string => JSON.stringify({ version: VERSION, blueprints: bs });

export const decodeBlueprints = (text: string | null): readonly Blueprint[] => {
  if (!text) return [];
  try {
    const data = JSON.parse(text) as { version?: unknown; blueprints?: unknown };
    if (data.version !== VERSION) return [];
    const seen = new Set<number>();
    return keep(list(data.blueprints).map(blueprint)).filter((b) => !seen.has(b.id) && seen.add(b.id));
  } catch {
    return [];
  }
};

// Browser storage can be missing or refuse (private modes, a sandboxed frame): then the library
// simply lasts for this visit
export const loadBlueprints = (): readonly Blueprint[] => {
  try {
    return decodeBlueprints(localStorage.getItem(KEY));
  } catch {
    return [];
  }
};

export const saveBlueprints = (bs: readonly Blueprint[]): void => {
  try {
    localStorage.setItem(KEY, encodeBlueprints(bs));
  } catch {
    // keep going without saving
  }
};
