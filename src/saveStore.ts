// Saved games are kept by the browser between visits, one key per game so that loading parses only one
// save. Like blueprints, the format is versioned and reading is forgiving, checked piece by piece: what
// cannot be trusted is dropped and counted, and only a save that is unreadable as a whole gives null.
// Storage can be missing or refuse (private modes, a full quota): reading then finds nothing and writing
// reports 'full'.
import { MAX_GRID, MIN_GRID } from './config';
import { TILE_TO_TERRAIN, footprintOf, getObjectDef } from './catalog';
import { type Edge, edgeKey, sizeOf } from './geometry';
import { cleanName, AUTOSAVE_CHOICES, type AutosaveMinutes, DEFAULT_AUTOSAVE } from './session';
import { culvert, int, isKind, keep, list, object, oldTerrainTile, wall } from './pieceCodec';
import { type GameWorld, type ObjectEntity, type TerrainCell, type Tile, type WallSegment, cellInBounds, edgeInBounds, rectInBounds } from './world';

const INDEX_KEY = 'iso-sandbox:saves';
const GAME_KEY = (id: number): string => `iso-sandbox:save:${id}`;
const LAST_KEY = 'iso-sandbox:last';
const SETTINGS_KEY = 'iso-sandbox:settings';
// Version 2 added terrain (stored like tiles). Version 1 games still load: their gravel and sand tiles
// become terrain at the same cells. Version 3 added the map's ground (a terrain id); older saves are
// on grass. The saves index has its own, unchanged, version.
const VERSION = 3;
const INDEX_VERSION = 1;

export type SaveEntry = Readonly<{ id: number; name: string; w: number; h: number; savedAt: number }>;
export type Loaded = Readonly<{ world: GameWorld; dropped: number }>;

// ===== A game as text =====
// Tiles and terrain are run-length rows: flat quadruples [x, y, length, paletteIndex, ...] along x in row y, so a
// fully floored 256 by 256 map is a few thousand numbers instead of 65 thousand tiles.
const encodeTiles = (tiles: readonly (Tile | TerrainCell)[]): Readonly<{ palette: string[]; runs: number[] }> => {
  const palette: string[] = [];
  const runs: number[] = [];
  const sorted = [...tiles].sort((a, b) => a.y - b.y || a.x - b.x);
  let open: { x: number; y: number; length: number; id: number } | null = null;
  const close = () => open && runs.push(open.x, open.y, open.length, open.id);
  for (const t of sorted) {
    let id = palette.indexOf(t.defId);
    if (id < 0) id = palette.push(t.defId) - 1;
    if (open && open.y === t.y && open.id === id && open.x + open.length === t.x) open.length++;
    else {
      close();
      open = { x: t.x, y: t.y, length: 1, id };
    }
  }
  close();
  return { palette, runs };
};

export const encodeGame = (w: GameWorld): string =>
  JSON.stringify({
    version: VERSION,
    w: w.size.w,
    h: w.size.h,
    rotation: w.rotation,
    nextId: w.nextId,
    objects: w.objects,
    walls: w.walls,
    culverts: w.culverts,
    tiles: encodeTiles(w.tiles),
    ground: w.ground,
    terrain: encodeTiles(w.terrain),
  });

const gridSide = (n: unknown): n is number => int(n) && n >= MIN_GRID && n <= MAX_GRID;

// Reads a game. Null when the save as a whole cannot be read (wrong version, not JSON, no usable size).
export const decodeGame = (text: string | null): Loaded | null => {
  if (!text) return null;
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return null;
    data = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const version = data.version;
  if ((version !== 1 && version !== 2 && version !== VERSION) || !gridSide(data.w) || !gridSide(data.h)) return null;
  const size = sizeOf(data.w, data.h);
  let dropped = 0;
  const drop = (n = 1) => void (dropped += n);

  // Each reader keeps what it can trust and counts the rest
  const objectIds = new Set<number>();
  const objects: ObjectEntity[] = [];
  for (const raw of list(data.objects)) {
    const o = object(raw);
    const def = o && isKind(o.defId, 'object') ? getObjectDef(o.defId) : null;
    const fit = o && def ? footprintOf(def, o.rotation) : null;
    if (!o || !fit || o.w !== fit.w || o.h !== fit.h || !rectInBounds(size, o) || objectIds.has(o.id)) drop();
    else {
      objectIds.add(o.id);
      objects.push(o);
    }
  }

  const edges = new Set<string>();
  const walls: WallSegment[] = [];
  for (const raw of list(data.walls)) {
    const w = wall(raw);
    if (!w || !edgeInBounds(size, w) || edges.has(edgeKey(w))) drop();
    else {
      edges.add(edgeKey(w));
      walls.push(w);
    }
  }

  const banks = new Set<string>();
  const culverts: NonNullable<ReturnType<typeof culvert>>[] = [];
  for (const raw of list(data.culverts)) {
    const c = culvert(raw);
    if (!c || !edgeInBounds(size, c) || banks.has(edgeKey(c))) drop();
    else {
      banks.add(edgeKey(c));
      culverts.push(c);
    }
  }

  // Tiles and terrain are read the same way: runs of palette entries, one cell at a time. `accept` says
  // which ids this layer can hold; the rest are dropped, and so are cells off the map and doubles.
  const readLayer = (raw: unknown, accept: (defId: unknown) => string | null): { x: number; y: number; defId: string }[] => {
    const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const palette = list(data.palette);
    const runs = list(data.runs);
    const cells = new Set<string>();
    const out: { x: number; y: number; defId: string }[] = [];
    for (let i = 0; i + 3 < runs.length; i += 4) {
      const [x, y, length, id] = [runs[i], runs[i + 1], runs[i + 2], runs[i + 3]];
      const defId = int(id) ? accept(palette[id]) : null;
      if (!int(x) || !int(y) || !int(length) || length < 1 || defId === null) {
        drop(int(length) && length > 0 ? Math.min(length, MAX_GRID) : 1);
        continue;
      }
      // runs are clipped to the map; a run cannot honestly be longer than the widest map
      for (let cx = x; cx < x + Math.min(length, MAX_GRID); cx++) {
        const key = `${cx},${y}`;
        if (!cellInBounds(size, { x: cx, y }) || cells.has(key)) drop();
        else {
          cells.add(key);
          out.push({ x: cx, y, defId });
        }
      }
    }
    return out;
  };

  // A version 1 save may hold gravel and sand as tiles: they are read here and moved to terrain below
  const tileId = (defId: unknown): string | null => (isKind(defId, 'tile') || (version === 1 && oldTerrainTile({ defId }) !== null) ? (defId as string) : null);
  const held = readLayer(data.tiles, tileId);
  const tiles: Tile[] = held.filter((t) => isKind(t.defId, 'tile'));
  const moved: TerrainCell[] = held.flatMap((t) => (isKind(t.defId, 'tile') ? [] : [{ x: t.x, y: t.y, defId: TILE_TO_TERRAIN[t.defId] ?? '' }]));
  // The ground is a terrain id; a missing or unknown one (and every version 1 or 2 save) is grass
  const ground = version === VERSION && isKind(data.ground, 'terrain') ? data.ground : 'grass';
  // An entry equal to the ground says nothing and is never stored (`grass` on a sand map is a real entry)
  const terrain: TerrainCell[] = [
    ...moved,
    ...readLayer(version === 1 ? undefined : data.terrain, (defId) => (isKind(defId, 'terrain') && defId !== ground ? defId : null)),
  ];

  const highest = Math.max(0, ...objects.map((o) => o.id));
  const nextId = Math.max(int(data.nextId) ? data.nextId : 1, highest + 1);
  const rotation = [0, 1, 2, 3].includes(data.rotation as number) ? (data.rotation as 0 | 1 | 2 | 3) : 0;
  return { world: { size, objects, tiles, terrain, ground, walls, culverts, nextId, rotation }, dropped };
};

// ===== The browser's storage =====
const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, text: string): boolean => {
  try {
    localStorage.setItem(key, text);
    return true;
  } catch {
    return false;
  }
};

const remove = (key: string): void => {
  try {
    localStorage.removeItem(key);
  } catch {
    // nothing to do
  }
};

const entry = (e: unknown): SaveEntry | null => {
  const x = e as SaveEntry;
  return int(x?.id) && x.id >= 1 && typeof x.name === 'string' && gridSide(x.w) && gridSide(x.h) && typeof x.savedAt === 'number' && Number.isFinite(x.savedAt)
    ? { id: x.id, name: cleanName(x.name, 'Game'), w: x.w, h: x.h, savedAt: x.savedAt }
    : null;
};

// Newest first
export const readIndex = (): readonly SaveEntry[] => {
  const text = read(INDEX_KEY);
  if (!text) return [];
  try {
    const data = JSON.parse(text) as { version?: unknown; saves?: unknown };
    if (data.version !== INDEX_VERSION) return [];
    const seen = new Set<number>();
    return keep(list(data.saves).map(entry))
      .filter((e) => !seen.has(e.id) && seen.add(e.id))
      .sort((a, b) => b.savedAt - a.savedAt || b.id - a.id);
  } catch {
    return [];
  }
};

const writeIndex = (saves: readonly SaveEntry[]): boolean => write(INDEX_KEY, JSON.stringify({ version: INDEX_VERSION, saves }));

export const newGameId = (): number => Math.max(0, ...readIndex().map((e) => e.id)) + 1;

export const readGame = (id: number): Loaded | null => decodeGame(read(GAME_KEY(id)));

// The game first, then the index. setItem either replaces or throws, so an earlier save survives a failed
// write; if only the index fails, the game's earlier text is put back so the two stay together.
export const writeGame = (id: number, name: string, world: GameWorld, now: number): 'ok' | 'full' => {
  const earlier = read(GAME_KEY(id));
  if (!write(GAME_KEY(id), encodeGame(world))) return 'full';
  const others = readIndex().filter((e) => e.id !== id);
  const saved: SaveEntry = { id, name, w: world.size.w, h: world.size.h, savedAt: now };
  if (writeIndex([saved, ...others])) return 'ok';
  if (earlier === null) remove(GAME_KEY(id));
  else write(GAME_KEY(id), earlier);
  return 'full';
};

export const deleteGame = (id: number): void => {
  remove(GAME_KEY(id));
  writeIndex(readIndex().filter((e) => e.id !== id));
  if (readLast() === id) remove(LAST_KEY);
};

export const renameGame = (id: number, name: string): 'ok' | 'full' =>
  writeIndex(readIndex().map((e) => (e.id === id ? { ...e, name: cleanName(name, e.name) } : e))) ? 'ok' : 'full';

export const readLast = (): number | null => {
  const n = Number(read(LAST_KEY));
  return Number.isInteger(n) && n >= 1 ? n : null;
};

export const writeLast = (id: number): void => void write(LAST_KEY, String(id));

export type Settings = Readonly<{ autosaveMinutes: AutosaveMinutes }>;

export const readSettings = (): Settings => {
  try {
    const data = JSON.parse(read(SETTINGS_KEY) ?? '{}') as { autosaveMinutes?: unknown };
    const minutes = AUTOSAVE_CHOICES.find((m) => m === data.autosaveMinutes);
    return { autosaveMinutes: minutes ?? DEFAULT_AUTOSAVE };
  } catch {
    return { autosaveMinutes: DEFAULT_AUTOSAVE };
  }
};

export const writeSettings = (s: Settings): void => void write(SETTINGS_KEY, JSON.stringify(s));
