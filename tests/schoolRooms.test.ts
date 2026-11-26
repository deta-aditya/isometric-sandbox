import { strict as assert } from 'node:assert';
import { CATALOG, getItem, groupsOf, itemsIn } from '../src/catalog.ts';
import { type History, type HistoryAction, initialHistory, step } from '../src/history.ts';
const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
const pt = (x: number, y: number): Omit<Extract<HistoryAction, { type: 'press' }>, 'type'> => ({ cell: { x: Math.floor(x), y: Math.floor(y) }, point: { x, y } });
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);

// #36 and #42: three new Furniture tabs after Kitchen
const TABS = {
  gym: ['gym-bench', 'wall-hoop', 'gym-mat', 'vaulting-box', 'wall-bars', 'balance-beam', 'scoreboard', 'ball-cart'],
  dorm: ['bunk-bed', 'single-bed', 'wardrobe', 'study-desk', 'desk-chair', 'nightstand', 'wall-shelf', 'locker-row', 'waste-basket'],
  laundry: ['washer', 'dryer', 'laundry-desk', 'ironing-stand', 'laundry-rack'],
} as const;
{
  const ids = groupsOf('furniture').map((g) => g.id);
  const k = ids.indexOf('kitchen');
  assert.deepEqual(ids.slice(k + 1, k + 4), ['gym', 'dorm', 'laundry']);
  assert.deepEqual(groupsOf('furniture').slice(k + 1, k + 4).map((g) => g.name), ['Gym', 'Dorm', 'Laundry']);
  for (const [group, items] of Object.entries(TABS)) {
    assert.deepEqual(itemsIn(group as keyof typeof TABS).map((i) => i.id), [...items], group);
    assert.ok(items.length <= 9, `${group} keeps a number key per item`);
  }
}
ok('Furniture has Gym (8), Dorm (9) and Laundry (5) after Kitchen, in order');

// no bleachers (they will come from the platform kit, #44); names are unique and short enough for phones
{
  assert.ok(!CATALOG.some((i) => i.id === 'bleachers'));
  const names = CATALOG.map((i) => i.name);
  for (const id of Object.values(TABS).flat()) {
    const item = getItem(id);
    assert.ok(item.name.length <= 16, `${item.name} fits a tray card`);
    assert.equal(names.filter((nm) => nm === item.name).length, 1, `${item.name} is unique`);
  }
  assert.equal(new Set(CATALOG.map((i) => i.id)).size, CATALOG.length, 'ids are unique');
}
ok('no bleachers; every new name is unique and at most 16 characters');

// footprints, and the wall-mounted items hang on the back edge of their tile
{
  const sizes: Record<string, [number, number]> = {
    'gym-bench': [2, 1], 'wall-hoop': [1, 1], 'gym-mat': [2, 1], 'vaulting-box': [2, 1], 'wall-bars': [2, 1],
    'balance-beam': [3, 1], scoreboard: [2, 1], 'ball-cart': [1, 1], 'bunk-bed': [2, 1], 'single-bed': [2, 1],
    wardrobe: [1, 1], 'study-desk': [2, 1], 'desk-chair': [1, 1], nightstand: [1, 1], 'wall-shelf': [2, 1],
    'locker-row': [2, 1], 'waste-basket': [1, 1], washer: [1, 1], dryer: [1, 1], 'laundry-desk': [2, 1],
    'ironing-stand': [2, 1], 'laundry-rack': [2, 1],
  };
  for (const [id, [w, h]] of Object.entries(sizes)) {
    const item = getItem(id);
    assert.ok(item.kind === 'object' && !item.layer, `${id} stands`);
    assert.equal(item.w, w, id); assert.equal(item.h, h, id);
  }
  for (const id of ['wall-hoop', 'scoreboard', 'wall-shelf', 'wall-bars']) {
    const item = getItem(id);
    assert.ok(item.kind === 'object');
    const back = Math.min(...item.parts.map((p) => p.dy));
    assert.ok(back <= 0.05, `${id} hangs on the back edge`);
    assert.ok(Math.max(...item.parts.map((p) => p.z)) > 20, `${id} is raised up the wall`);
  }
}
ok('footprints as previewed; the hoop, scoreboard, wall shelf and wall bars hang on the back edge');

// the washer loads from the front and the dryer from the top: the dryer's front is plain below its lid
{
  const washer = getItem('washer'), dryer = getItem('dryer');
  assert.ok(washer.kind === 'object' && dryer.kind === 'object');
  const door = (parts: typeof washer.parts) => parts.filter((p) => p.dy >= 0.85 && p.z < 18);
  assert.ok(door(washer.parts).length >= 7, 'the washer has a round door on its front');
  assert.ok(dryer.parts.some((p) => p.z >= 22 && p.dy > 0.3 && p.w > 0.5 && p.h > 0.4), 'the dryer has a lid on top');
  assert.ok(dryer.parts.some((p) => p.z >= 22 && p.dy < 0.2 && p.height > 5), 'and a console at the back');
  assert.ok(!dryer.parts.some((p) => p.dy >= 0.85 && p.z > 3), 'no front door on the dryer');
}
ok('the washer is a front loader, the dryer a top loader with a console at the back');

// everything places in a room, and a desk chair fits in front of the study desk
{
  let h = initialHistory;
  let x = 4;
  for (const id of Object.values(TABS).flat()) {
    const item = getItem(id);
    h = run(h, { type: 'select', id }, { type: 'hover', ...pt(x + 0.5, 10.5) }, { type: 'press', ...pt(x + 0.5, 10.5) }, { type: 'release' });
    x += item.kind === 'object' ? item.w + 1 : 2;
  }
  assert.equal(h.state.objects.length, Object.values(TABS).flat().length);
  const desk = h.state.objects.find((o) => o.defId === 'study-desk')!;
  const before = h.state.objects.length;
  h = run(h, { type: 'select', id: 'desk-chair' }, { type: 'hover', ...pt(desk.x + 0.5, desk.y + 1.5) }, { type: 'press', ...pt(desk.x + 0.5, desk.y + 1.5) }, { type: 'release' });
  assert.equal(h.state.objects.length, before + 1);
}
ok('all 22 items place, and a desk chair fits in front of the study desk');
