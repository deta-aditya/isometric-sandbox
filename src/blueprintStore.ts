// Blueprints are kept by the browser between visits. The format is versioned, and reading is
// forgiving: anything that does not parse, or names an item the catalog no longer has, is dropped
// rather than breaking the game (a door that no longer exists leaves its wall; an unknown wall goes).
import { cell, culvert, int, keep, list, object, oldTerrainTile, terrain, tile, wall } from './pieceCodec';
import type { Blueprint, Pieces } from './world';

const KEY = 'iso-sandbox:blueprints';
// Version 2 added terrain. Version 1 blueprints still load: their gravel and sand tiles become terrain.
const VERSION = 2;

const pieces = (p: unknown, version: number): Pieces => {
  const x = (p ?? {}) as Record<string, unknown>;
  const tiles = list(x.tiles);
  // from version 1, the old gravel and sand tiles are terrain at the same cells
  const upgraded = version < 2 ? tiles.map((t) => ({ ...(t as object), defId: oldTerrainTile(t) })).filter((t) => t.defId !== null) : [];
  return {
    objects: keep(list(x.objects).map(object)),
    walls: keep(list(x.walls).map(wall)),
    tiles: keep(tiles.map(tile)),
    terrain: keep([...list(x.terrain), ...upgraded].map(terrain)),
    culverts: keep(list(x.culverts).map(culvert)),
  };
};

const blueprint = (version: number) => (b: unknown): Blueprint | null => {
  const x = b as Blueprint;
  if (!int(x?.id) || typeof x.name !== 'string' || !cell(x.anchor)) return null;
  const p = pieces(x.pieces, version);
  const count = p.objects.length + p.walls.length + p.tiles.length + p.terrain.length + p.culverts.length;
  return count > 0 ? { id: x.id, name: x.name.slice(0, 40) || 'Blueprint', pieces: p, anchor: { x: x.anchor.x, y: x.anchor.y } } : null;
};

export const encodeBlueprints = (bs: readonly Blueprint[]): string => JSON.stringify({ version: VERSION, blueprints: bs });

export const decodeBlueprints = (text: string | null): readonly Blueprint[] => {
  if (!text) return [];
  try {
    const data = JSON.parse(text) as { version?: unknown; blueprints?: unknown };
    const version = data.version;
    if (version !== 1 && version !== VERSION) return [];
    const seen = new Set<number>();
    return keep(list(data.blueprints).map(blueprint(version))).filter((b) => !seen.has(b.id) && seen.add(b.id));
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
