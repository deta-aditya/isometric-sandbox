import { strict as assert } from 'node:assert';
import { CATALOG, CATEGORIES, itemsIn } from '../src/catalog.ts';
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);
const isSquare = (p: FloorPiece) => p.outline.length === 4 && p.outline.every(([u, v]) => (u === 0 || u === 1) && (v === 0 || v === 1));
const area = (pts: readonly (readonly [number, number])[]) => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]!; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const lab = (c: number) => {
  const f = (u: number) => (u > 0.04045 ? ((u + 0.055) / 1.055) ** 2.4 : u / 12.92);
  const [r, g, b] = [16, 8, 0].map((s) => f(((c >> s) & 255) / 255)) as [number, number, number];
  const h = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [x, y, z] = [(r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, r * 0.2126 + g * 0.7152 + b * 0.0722, (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883];
  return [116 * h(y) - 16, 500 * (h(x) - h(y)), 200 * (h(y) - h(z))];
};
const dist = (a: number, b: number) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]!));


// ===== Terrain tabs: one per biome (#43) =====
const tabs = CATEGORIES.find((c) => c.id === 'terrain')!.groups;
const names = (g: string) => itemsIn(g).map((i) => i.name);
assert.deepEqual(tabs.map((g) => g.name), ['Grassland', 'Desert', 'Savanna', 'Tropical', 'Wetland', 'Coastal', 'Cold', 'Alpine']);
assert.deepEqual(names('terrain-grassland'), ['Grass', 'Lush grass', 'Turf', 'Meadow', 'Flowery grass', 'Soil', 'Mulch', 'Gravel']);
assert.deepEqual(names('terrain-desert'), ['Sand', 'Red sand', 'Cracked earth']);
assert.deepEqual(names('terrain-savanna'), ['Savanna grass', 'Dry grass', 'Clay']);
assert.deepEqual(names('terrain-tropical'), ['Jungle floor', 'Leaf litter']);
assert.deepEqual(names('terrain-wetland'), ['Marsh grass', 'Mud', 'Peat', 'Moss']);
assert.deepEqual(names('terrain-coastal'), ['Wet sand', 'Pebbles', 'Dune grass']);
assert.deepEqual(names('terrain-cold'), ['Snow', 'Frost', 'Ice']);
assert.deepEqual(names('terrain-alpine'), ['Alpine meadow', 'Scree', 'Bare rock']);
assert.ok(tabs.every((g) => itemsIn(g.id).length <= 9 && itemsIn(g.id).every((i) => i.name.length <= 16)));
ok('Terrain has a tab per biome, Grassland first with Grass; 29 terrains, every tab 9 or fewer, names within 16 characters');

// ===== Colors =====
// New terrains keep a measured distance from every terrain, floor and path; the closest pairs among
// the twelve older terrains (Grass and Flowery grass, Grass and Lush grass) were there before #43
const OLD = new Set(['grass', 'lush-grass', 'dry-grass', 'turf', 'meadow', 'moss', 'flowery-grass', 'soil-dirt', 'mulch', 'clay', 'terrain-gravel', 'terrain-sand']);
const grounds = CATALOG.flatMap((i) => (i.kind === 'terrain' || i.kind === 'tile' ? [{ id: i.id, name: i.name, color: i.color }] : []));
const fresh = grounds.filter((g) => CATALOG.find((i) => i.id === g.id)!.kind === 'terrain' && !OLD.has(g.id));
assert.equal(fresh.length, 17);
const closest = fresh
  .flatMap((a) => grounds.filter((b) => b.id !== a.id).map((b) => ({ d: dist(a.color, b.color), pair: `${a.name} / ${b.name}` })))
  .sort((x, y) => x.d - y.d)[0]!;
assert.ok(closest.d >= 8.5, `closest new terrain pair ${closest.pair} at ${closest.d.toFixed(1)}`);
ok(`every new terrain keeps apart from all other grounds (closest ${closest.pair} at ${closest.d.toFixed(1)})`);
// ===== Plants: a Scenery tab per biome (#43) =====
{
  const scenery = CATEGORIES.find((c) => c.id === 'scenery')!.groups.map((g) => g.id);
  assert.deepEqual(scenery.slice(-2), ['desert', 'cold']);
  assert.deepEqual(names('desert'), ['Saguaro cactus', 'Barrel cactus', 'Prickly pear', 'Agave', 'Joshua tree', 'Dry bush', 'Dead tree', 'Boulder']);
  assert.deepEqual(names('cold'), ['Snowy pine', 'Snowy tall pine', 'Bare tree', 'Snowy bush', 'Snowy rock', 'Log pile', 'Snowman']);
  [...itemsIn('desert'), ...itemsIn('cold')].forEach((i) => {
    assert.equal(i.kind, 'object', i.id);
    assert.ok(i.name.length <= 16, i.id);
  });
  // bare trees are full of branches: eight limbs, each forking into two twigs
  const parts = (id: string) => (CATALOG.find((i) => i.id === id) as { parts: readonly unknown[] }).parts.length;
  assert.ok(parts('dead-tree') >= 8 * 3 + 1 && parts('bare-tree') > parts('dead-tree'));
}
ok('Scenery has Desert (8) and Cold (7) tabs after Sports, names within 16 characters; bare trees branch');
console.log('all passed');
