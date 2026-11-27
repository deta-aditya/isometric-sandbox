import { strict as assert } from 'node:assert';
import { type History, type HistoryAction, initialHistory, step } from '../src/history.ts';
import { sizeOf } from '../src/geometry.ts';
import { decodeGame, deleteGame, encodeGame, newGameId, readGame, readIndex, readLast, readSettings, renameGame, writeGame, writeLast, writeSettings } from '../src/saveStore.ts';
import { type GameWorld, type Tile, gameWorldOf, initialState } from '../src/world.ts';

// A Map-backed localStorage that can be told to refuse writes (a full quota) for some or all keys
const store = new Map<string, string>();
let refuse: (key: string) => boolean = () => false;
const quota = () => Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { if (refuse(k)) throw quota(); store.set(k, v); },
  removeItem: (k: string) => void store.delete(k),
};
const reset = () => { store.clear(); refuse = () => false; };

const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
const pt = (x: number, y: number) => ({ cell: { x: Math.floor(x), y: Math.floor(y) }, point: { x, y } });
const drag = (a: [number, number], b: [number, number]): HistoryAction[] =>
  [{ type: 'hover', ...pt(...a) }, { type: 'press', ...pt(...a) }, { type: 'hover', ...pt(...b) }, { type: 'release' }];
const click = (x: number, y: number) => drag([x, y], [x, y]);
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);
const byPlace = (a: Tile, b: Tile) => a.y - b.y || a.x - b.x;
const normal = (w: GameWorld) => ({ ...w, tiles: [...w.tiles].sort(byPlace) });

// ===== A non-square world with every kind of piece =====
const WIDE = sizeOf(40, 20);
const canalCells = [0, 1, 2].flatMap((y) => [2, 3, 4, 5, 6, 7].map((x) => [x, y] as const)); // painted cell by cell
let h: History = { ...initialHistory, state: { ...initialState, size: WIDE } };
h = run(h,
  // a room with a wide opening along its south side, a plain door on the west, and paint on both sides
  { type: 'select', id: 'plaster' }, { type: 'setWallMode', mode: 'square' }, ...drag([20.5, 4.5], [29.5, 9.5]),
  { type: 'select', id: 'long-door' }, { type: 'setWallMode', mode: 'line' }, ...drag([22.5, 10], [25.5, 10]),
  { type: 'select', id: 'wooden-door' }, ...click(20.02, 6.5),
  { type: 'select', id: 'paint-sky' }, { type: 'setShift', held: true }, ...click(24.5, 4.1), { type: 'setShift', held: false },
  { type: 'select', id: 'paint-mint' }, ...click(27.5, 9.9),
  // floors and a canal with a culvert on its end bank
  { type: 'select', id: 'wood-floor' }, ...drag([1.5, 14.5], [6.5, 15.5]),
  { type: 'select', id: 'canal' }, { type: 'hover', ...pt(2.5, 0.5) }, { type: 'press', ...pt(2.5, 0.5) },
  ...canalCells.map(([x, y]): HistoryAction => ({ type: 'hover', ...pt(x + 0.5, y + 0.5) })), { type: 'release' },
  { type: 'select', id: 'culvert' }, ...drag([2.03, 0.5], [1.98, 2.4]),
  // one sofa in each of the four facings, ending the build facing on the last turn
  { type: 'select', id: 'sofa' }, ...click(12.5, 2.5), { type: 'rotate' }, ...click(12.5, 6.5), { type: 'rotate' }, ...click(12.5, 12.5), { type: 'rotate' }, ...click(12.5, 17.5),
  { type: 'cancel' });
const built = gameWorldOf(h.state);
assert.ok(built.walls.some((w) => w.opening?.startsWith('long-door:')), 'wide opening');
assert.ok(built.walls.some((w) => w.opening === 'wooden-door'), 'door');
assert.ok(built.walls.some((w) => w.paint.before && w.paint.after), 'paint on both sides');
assert.ok(built.tiles.some((t) => t.defId === 'wood-floor') && built.tiles.some((t) => t.defId === 'canal'), 'floors and water');
assert.ok(built.culverts.length > 0, 'culverts');
assert.deepEqual(built.objects.map((o) => o.rotation).sort(), [0, 1, 2, 3], 'four facings');
assert.equal(built.rotation, 3);
assert.deepEqual(built.size, WIDE);

const back = decodeGame(encodeGame(built));
assert.ok(back);
assert.equal(back.dropped, 0);
assert.equal(back.world.size, WIDE); // the very same size object
assert.deepEqual(normal(back.world), normal(built));
assert.equal(decodeGame(encodeGame(back.world))?.world.walls.length, built.walls.length);
ok('a non-square world with every piece kind reads back exactly, build facing included');

// ===== Compact tiles =====
const full = sizeOf(256, 256);
const floor = (x: number, y: number, defId: string): Tile => ({ x, y, defId });
const tiles = Array.from({ length: 256 * 256 }, (_, i) => floor(i % 256, Math.floor(i / 256), i % 256 < 128 ? 'wood-floor' : 'stone'));
const fullWorld: GameWorld = { size: full, objects: [], tiles, terrain: [], ground: 'grass', walls: [], culverts: [], nextId: 1, rotation: 0 };
const text = encodeGame(fullWorld);
assert.ok(text.length < 20_000, `a floored 256x256 map is ${text.length} bytes`);
const read = decodeGame(text);
assert.equal(read?.world.tiles.length, 65536);
assert.equal(read?.dropped, 0);
assert.equal(read?.world.tiles.find((t) => t.x === 200 && t.y === 7)?.defId, 'stone');
ok('a fully floored 256 by 256 map is under 20 KB and reads back whole');

// ===== Validation =====
const valid = JSON.parse(encodeGame(built));
const tamper = (edit: (d: any) => void): ReturnType<typeof decodeGame> => { const d = JSON.parse(JSON.stringify(valid)); edit(d); return decodeGame(JSON.stringify(d)); };
assert.equal(decodeGame(null), null);
assert.equal(decodeGame('not json'), null);
assert.equal(decodeGame('7'), null);
assert.equal(tamper((d) => (d.version = 5)), null);
assert.equal(tamper((d) => (d.version = 0)), null);
[15, 257, 40.5, '40', null, 0, -20].forEach((bad) => assert.equal(tamper((d) => (d.w = bad)), null, `w ${String(bad)}`));
assert.equal(tamper((d) => (d.h = 15)), null);
assert.equal(tamper((d) => { d.w = 16; d.h = 256; })?.world.size, sizeOf(16, 256));
ok('a wrong version, bad JSON, or a size that is not a whole number from 16 to 256 is unreadable');

const some = (xs: any[], f: (x: any) => boolean) => xs.find(f);
const dropOne = (what: string, edit: (d: any) => void, count = 1): void => {
  const r = tamper(edit);
  assert.ok(r, what);
  assert.equal(r.dropped, count, `${what}: dropped`);
};
// unknown ids: an unknown object goes; an unknown wall goes; an unknown door leaves its wall
dropOne('unknown object', (d) => (d.objects[0].defId = 'no-such-thing'));
dropOne('unknown wall', (d) => (d.walls[0].styleId = 'no-such-wall'));
{
  const r = tamper((d) => (some(d.walls, (w) => w.opening === 'wooden-door').opening = 'no-such-door'));
  assert.equal(r?.dropped, 0);
  assert.equal(r?.world.walls.length, built.walls.length);
  assert.equal(r?.world.walls.filter((w) => w.opening === 'wooden-door').length, 0);
}
// pieces off the map (this one is 40 by 20)
dropOne('object off the map', (d) => (d.objects[0].x = 39));
dropOne('wall off the map', (d) => (d.walls[0] = { ...d.walls[0], axis: 'x', x: 40, y: 0 }));
dropOne('wall off the map in y', (d) => (d.walls[0] = { ...d.walls[0], axis: 'y', x: 0, y: 20 }));
dropOne('culvert off the map', (d) => d.culverts.push({ axis: 'y', x: 41, y: 0 }));
// an object whose size does not fit its catalog footprint for its facing
dropOne('footprint', (d) => { const o = some(d.objects, (x: any) => x.w !== x.h); o.w = o.h; });
// duplicates: a second wall on an edge, a second object with an id
dropOne('second wall on an edge', (d) => d.walls.push({ ...d.walls[0], styleId: 'timber' }));
dropOne('second object with an id', (d) => d.objects.push({ ...d.objects[0], x: 30, y: 15 }));
{
  const first = decodeGame(JSON.stringify({ ...valid, walls: [...valid.walls, { ...valid.walls[0], styleId: 'timber' }] }));
  assert.equal(first?.world.walls.find((w) => w.x === valid.walls[0].x && w.y === valid.walls[0].y && w.axis === valid.walls[0].axis)?.styleId, valid.walls[0].styleId, 'the first one stays');
}
// tiles: a palette entry that is not a tile drops its runs; runs are clipped to the map; one tile per cell
{
  const small = { version: 2, w: 16, h: 16, rotation: 0, nextId: 1, objects: [], walls: [], culverts: [], tiles: { palette: ['wood-floor', 'crate'], runs: [] as number[] } };
  const read = (runs: number[]) => decodeGame(JSON.stringify({ ...small, tiles: { ...small.tiles, runs } }));
  assert.equal(read([0, 0, 4, 0])?.world.tiles.length, 4);
  const bad = read([0, 1, 4, 1]); // palette entry 1 is an object
  assert.equal(bad?.world.tiles.length, 0); assert.equal(bad?.dropped, 4);
  const clipped = read([14, 0, 5, 0, 0, 16, 3, 0, -2, 3, 4, 0]); // runs off the east edge, a row off the map, off the west edge
  assert.equal(clipped?.world.tiles.length, 2 + 2); assert.equal(clipped?.dropped, 3 + 3 + 2);
  const twice = read([0, 0, 4, 0, 2, 0, 4, 0]); // the second run overlaps two cells
  assert.equal(twice?.world.tiles.length, 6); assert.equal(twice?.dropped, 2);
  assert.equal(read([0, 0, 1_000_000_000, 0])?.world.tiles.length, 16); // a silly length is just clipped
  assert.equal(read([0, 0, 2.5, 0, 'x', 0, 1, 0, 0, 0, 2, 7])?.world.tiles.length, 0); // junk and an index with no palette entry
}
ok('every validation rule drops only what it must and counts it');

// nextId is repaired to stay above every object id
assert.equal(tamper((d) => (d.nextId = 1))?.world.nextId, Math.max(...built.objects.map((o) => o.id)) + 1);
assert.equal(tamper((d) => (d.nextId = 500))?.world.nextId, 500);
assert.equal(tamper((d) => delete d.nextId)?.world.nextId, Math.max(...built.objects.map((o) => o.id)) + 1);
assert.equal(tamper((d) => (d.rotation = 9))?.world.rotation, 0);
ok('nextId stays above the highest object id; a bad build facing falls back to 0');

// ===== The browser's storage =====
reset();
assert.deepEqual(readIndex(), []);
assert.equal(newGameId(), 1);
assert.equal(readLast(), null);
assert.equal(writeGame(1, 'First', built, 1000), 'ok');
assert.equal(newGameId(), 2);
assert.equal(writeGame(2, 'Second', fullWorld, 2000), 'ok');
assert.equal(writeGame(3, 'Third', built, 1500), 'ok');
assert.deepEqual(readIndex().map((e) => e.name), ['Second', 'Third', 'First'], 'newest first');
assert.deepEqual(readIndex()[0], { id: 2, name: 'Second', w: 256, h: 256, savedAt: 2000 });
assert.equal(writeGame(1, 'First', built, 3000), 'ok');
assert.deepEqual(readIndex().map((e) => e.id), [1, 2, 3], 'saving again moves a game to the top without adding a row');
assert.equal(newGameId(), 4);
assert.deepEqual(normal(readGame(1)!.world), normal(built));
assert.equal(readGame(9), null);
assert.ok(store.has('iso-sandbox:save:1') && store.has('iso-sandbox:saves'));
ok('saves are listed newest first, one key per game, and a new id is above every id in the index');

assert.equal(renameGame(3, '  Renamed  '), 'ok');
assert.equal(readIndex().find((e) => e.id === 3)?.name, 'Renamed');
renameGame(3, 'y'.repeat(80)); assert.equal(readIndex().find((e) => e.id === 3)?.name.length, 40);
renameGame(3, '   '); assert.equal(readIndex().find((e) => e.id === 3)?.name.length, 40, 'a blank name keeps the old one');
writeLast(3); assert.equal(readLast(), 3);
deleteGame(3);
assert.ok(!store.has('iso-sandbox:save:3'));
assert.deepEqual(readIndex().map((e) => e.id), [1, 2]);
assert.equal(readLast(), null, 'deleting the last game played forgets it');
writeLast(2); deleteGame(1); assert.equal(readLast(), 2);
ok('rename trims and caps, delete removes both keys, last follows');

assert.deepEqual(readSettings(), { autosaveMinutes: 3 });
writeSettings({ autosaveMinutes: 0 }); assert.deepEqual(readSettings(), { autosaveMinutes: 0 });
writeSettings({ autosaveMinutes: 10 }); assert.deepEqual(readSettings(), { autosaveMinutes: 10 });
store.set('iso-sandbox:settings', JSON.stringify({ autosaveMinutes: 4 })); assert.deepEqual(readSettings(), { autosaveMinutes: 3 });
store.set('iso-sandbox:settings', '{{'); assert.deepEqual(readSettings(), { autosaveMinutes: 3 });
ok('settings default to autosave every 3 minutes and ignore values that are not a choice');

// a corrupt index is an empty one; a bad save is unreadable without touching the others
store.set('iso-sandbox:saves', 'nope'); assert.deepEqual(readIndex(), []);
store.set('iso-sandbox:saves', JSON.stringify({ version: 1, saves: [{ id: 5, name: 'ok', w: 64, h: 64, savedAt: 1 }, { id: 5, name: 'dup', w: 64, h: 64, savedAt: 2 }, { id: 'x' }, { id: 6, name: 'tiny', w: 4, h: 4, savedAt: 3 }] }));
assert.deepEqual(readIndex().map((e) => e.name), ['ok']);
store.set('iso-sandbox:save:5', '{broken'); assert.equal(readGame(5), null);

// ===== A refused write keeps the earlier save =====
reset();
assert.equal(writeGame(1, 'Keep', built, 1000), 'ok');
const keptGame = store.get('iso-sandbox:save:1'), keptIndex = store.get('iso-sandbox:saves');
refuse = () => true;
assert.equal(writeGame(1, 'Keep', fullWorld, 2000), 'full');
assert.equal(writeGame(2, 'New', fullWorld, 2000), 'full');
refuse = () => false;
assert.equal(store.get('iso-sandbox:save:1'), keptGame);
assert.equal(store.get('iso-sandbox:saves'), keptIndex);
assert.ok(!store.has('iso-sandbox:save:2'));
assert.deepEqual(normal(readGame(1)!.world), normal(built));
// the game fits but the index does not: the game goes back as it was, and a new game leaves nothing behind
refuse = (k) => k === 'iso-sandbox:saves';
assert.equal(writeGame(1, 'Keep', fullWorld, 3000), 'full');
assert.equal(writeGame(2, 'New', fullWorld, 3000), 'full');
refuse = () => false;
assert.equal(store.get('iso-sandbox:save:1'), keptGame);
assert.ok(!store.has('iso-sandbox:save:2'));
ok('a refused write reports full and leaves the earlier save and the index as they were');

// no storage at all: nothing to read, writes fail, nothing throws
delete (globalThis as { localStorage?: unknown }).localStorage;
assert.deepEqual(readIndex(), []);
assert.equal(readGame(1), null);
assert.equal(readLast(), null);
assert.equal(writeGame(1, 'x', built, 1), 'full');
assert.deepEqual(readSettings(), { autosaveMinutes: 3 });
writeLast(1); writeSettings({ autosaveMinutes: 1 }); deleteGame(1);
ok('with no browser storage, reading finds nothing and writing reports full');
console.log('all passed');

// ===== Terrain =====
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { if (refuse(k)) throw quota(); store.set(k, v); },
  removeItem: (k: string) => void store.delete(k),
};
reset();
{
  // a world with terrain, floors on top of some of it, in a non-square map: reads back exactly
  const wide = sizeOf(40, 20);
  const ground = [0, 1, 2].flatMap((y) => [3, 4, 5, 6].map((x) => ({ x, y, defId: y === 1 ? 'moss' : 'clay' })));
  const withGround: GameWorld = { ...built, size: wide, terrain: [...ground, { x: 39, y: 19, defId: 'flowery-grass' }, { x: 30, y: 7, defId: 'terrain-sand' }] };
  const text2 = encodeGame(withGround);
  assert.equal(JSON.parse(text2).version, 4);
  const read2 = decodeGame(text2);
  assert.equal(read2?.dropped, 0);
  const byCell = (a: { x: number; y: number }, b: { x: number; y: number }) => a.y - b.y || a.x - b.x;
  assert.deepEqual([...read2!.world.terrain].sort(byCell), [...withGround.terrain].sort(byCell));
  assert.deepEqual(normal(read2!.world), normal({ ...withGround, terrain: [...read2!.world.terrain] }));
  // it is stored in runs, like tiles
  const stored = JSON.parse(text2).terrain;
  assert.deepEqual(stored.palette.sort(), ['clay', 'flowery-grass', 'moss', 'terrain-sand']);
  assert.ok(stored.runs.length <= 4 * 5);
  assert.equal(writeGame(1, 'Ground', withGround, 5), 'ok');
  assert.equal(readGame(1)?.world.terrain.length, withGround.terrain.length);
  // a fully terrained 256 by 256 map stays small
  const big = sizeOf(256, 256);
  const all = Array.from({ length: 256 * 256 }, (_, i) => ({ x: i % 256, y: Math.floor(i / 256), defId: i % 256 < 128 ? 'turf' : 'dry-grass' }));
  assert.ok(encodeGame({ ...fullWorld, size: big, tiles: [], terrain: all }).length < 20_000);
  assert.equal(decodeGame(encodeGame({ ...fullWorld, size: big, tiles: [], terrain: all }))?.world.terrain.length, 65536);
  ok('a save round trips terrain (runs, palette) on a non-square map, and a full map stays small');

  // a save without a terrain field (version 2 written by hand) has none
  assert.deepEqual(decodeGame(JSON.stringify({ ...JSON.parse(text2), terrain: undefined }))?.world.terrain, []);

  // validation: unknown ids, grass, tiles used as terrain, off the map and doubles are dropped and counted
  const small = { version: 2, w: 16, h: 16, rotation: 0, nextId: 1, objects: [], walls: [], culverts: [], tiles: { palette: [], runs: [] }, terrain: { palette: ['moss', 'grass', 'no-such-ground', 'wood-floor', 'crate'], runs: [] as number[] } };
  const readT = (runs: number[]) => decodeGame(JSON.stringify({ ...small, terrain: { ...small.terrain, runs } }));
  assert.equal(readT([0, 0, 4, 0])?.world.terrain.length, 4);
  [1, 2, 3, 4].forEach((i) => { const r = readT([0, 0, 4, i]); assert.equal(r?.world.terrain.length, 0, `palette ${i}`); assert.equal(r?.dropped, 4, `palette ${i}`); });
  const clipped2 = readT([14, 0, 5, 0, 0, 16, 3, 0, -2, 3, 4, 0]); // off the east edge, a row off the map, off the west edge
  assert.equal(clipped2?.world.terrain.length, 2 + 2); assert.equal(clipped2?.dropped, 3 + 3 + 2);
  const twice2 = readT([0, 0, 4, 0, 2, 0, 4, 0]); // the second run overlaps two cells
  assert.equal(twice2?.world.terrain.length, 6); assert.equal(twice2?.dropped, 2);
  assert.equal(readT([0, 0, 1_000_000_000, 0])?.world.terrain.length, 16);
  assert.equal(readT([0, 0, 2.5, 0, 'x' as unknown as number, 0, 1, 0, 0, 0, 2, 7])?.world.terrain.length, 0);
  // the first of two terrains on a cell stays
  assert.equal(readT([0, 0, 2, 0, 0, 0, 2, 1])?.world.terrain.every((t) => t.defId === 'moss'), true);
  // a version 2 save does not turn gravel tiles into terrain: that is only for version 1
  const gravel = decodeGame(JSON.stringify({ ...small, tiles: { palette: ['gravel'], runs: [0, 0, 3, 0] } }));
  assert.equal(gravel?.world.terrain.length, 0); assert.equal(gravel?.world.tiles.length, 0); assert.equal(gravel?.dropped, 3);
  ok('terrain is checked piece by piece: unknown ids, grass, tiles, off the map and doubles are dropped and counted');

  // a version 1 save (before terrain) loads, and its gravel and sand tiles are terrain at the same cells
  const v1 = {
    version: 1, w: 16, h: 16, rotation: 0, nextId: 1, objects: [], walls: [], culverts: [],
    tiles: { palette: ['stone', 'gravel', 'sand', 'no-such-tile'], runs: [0, 0, 2, 0, 2, 0, 3, 1, 5, 0, 2, 2, 7, 0, 1, 3, 0, 1, 1, 1] },
  };
  const old = decodeGame(JSON.stringify(v1));
  assert.ok(old);
  assert.deepEqual(old.world.tiles.map((t) => `${t.x},${t.y}:${t.defId}`), ['0,0:stone', '1,0:stone']);
  assert.deepEqual([...old.world.terrain].sort(byCell).map((t) => `${t.x},${t.y}:${t.defId}`), ['2,0:terrain-gravel', '3,0:terrain-gravel', '4,0:terrain-gravel', '5,0:terrain-sand', '6,0:terrain-sand', '0,1:terrain-gravel']);
  assert.equal(old.dropped, 1); // the unknown tile
  // a version 1 game with no terrain field at all is fine, and writes back as the current version (4)
  const plain = decodeGame(JSON.stringify({ ...v1, tiles: { palette: ['stone'], runs: [0, 0, 2, 0] } }));
  assert.equal(plain?.world.terrain.length, 0);
  assert.equal(JSON.parse(encodeGame(old.world)).version, 4);
  assert.deepEqual(normal(decodeGame(encodeGame(old.world))!.world), normal(old.world));
  // a version 1 save kept in the browser loads as before, through the index
  reset();
  store.set('iso-sandbox:saves', JSON.stringify({ version: 1, saves: [{ id: 1, name: 'Old', w: 16, h: 16, savedAt: 1 }] }));
  store.set('iso-sandbox:save:1', JSON.stringify(v1));
  assert.equal(readIndex().length, 1);
  assert.equal(readGame(1)?.world.terrain.length, 6);
  ok('a version 1 save loads with its gravel and sand tiles as terrain, and is written again as the current version');

  // version 3 holds the map's ground: it round trips, and versions 1 and 2 (and unknown grounds) are grass
  const sandy: GameWorld = { ...fullWorld, size: sizeOf(20, 20), tiles: [], ground: 'terrain-sand', terrain: [{ x: 1, y: 1, defId: 'grass' }, { x: 2, y: 1, defId: 'moss' }] };
  const sandText = encodeGame(sandy);
  assert.equal(JSON.parse(sandText).ground, 'terrain-sand');
  const sandBack = decodeGame(sandText);
  assert.equal(sandBack?.world.ground, 'terrain-sand'); assert.equal(sandBack?.dropped, 0);
  assert.deepEqual(sandBack?.world.terrain.map((t) => t.defId).sort(), ['grass', 'moss']); // grass is an entry on a sand map
  assert.equal(writeGame(3, 'Sandy', sandy, 9), 'ok'); assert.equal(readGame(3)?.world.ground, 'terrain-sand');
  const asGround = (ground: unknown, version = 3) => decodeGame(JSON.stringify({ ...JSON.parse(sandText), version, ground }))?.world.ground;
  assert.equal(asGround('no-such-ground'), 'grass'); assert.equal(asGround('wood-floor'), 'grass'); assert.equal(asGround(7), 'grass'); assert.equal(asGround(undefined), 'grass');
  assert.equal(asGround('terrain-sand', 2), 'grass'); assert.equal(asGround('terrain-sand', 1), 'grass');
  assert.equal(decodeGame(JSON.stringify({ ...small, version: 2 }))?.world.ground, 'grass');
  // entries equal to the ground are dropped (and counted) when reading
  const same = decodeGame(JSON.stringify({ ...JSON.parse(sandText), terrain: { palette: ['terrain-sand', 'moss'], runs: [0, 0, 3, 0, 0, 1, 2, 1] } }));
  assert.deepEqual(same?.world.terrain.map((t) => t.defId), ['moss', 'moss']); assert.equal(same?.dropped, 3);
  ok('a version 3 save round trips the ground; versions 1 and 2 and unknown grounds load as grass; entries equal to the ground are dropped');
}
