// Lane arrows paint themselves to fit the road under them (#40)
import { strict as assert } from 'node:assert';
import { type ArrowKind, type Rotation, getObjectDef, laneSpans, marksOf } from '../src/catalog.ts';
import { arrowLook } from '../src/arrows.ts';
import { type History, type HistoryAction, initialHistory, step } from '../src/history.ts';
const run = (h: History, ...a: HistoryAction[]) => a.reduce(step, h);
const pt = (x: number, y: number) => ({ cell: { x: Math.floor(x), y: Math.floor(y) }, point: { x, y } });
const click = (x: number, y: number): HistoryAction[] => [{ type: 'hover', ...pt(x, y) }, { type: 'press', ...pt(x, y) }, { type: 'release' }];
const turns = (n: number): HistoryAction[] => Array.from({ length: n }, () => ({ type: 'rotate', dir: 1 }));
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);
const KINDS: readonly ArrowKind[] = ['straight', 'left', 'right'];
const ARROWS = KINDS.map((k) => `arrow-${k}`);
const LINE = 0.08;

// a piece placed at (x, y) facing r, with its turned footprint
const piece = (defId: string, r: Rotation, x: number, y: number) => {
  const d = getObjectDef(defId);
  const [w, h] = r % 2 ? [d.h, d.w] : [d.w, d.h];
  return { defId, rotation: r, x, y, w, h };
};
// an arrow's marks in the world, as it is drawn
const drawn = (a: ReturnType<typeof piece>, roads: ReturnType<typeof piece>[]) => {
  const look = arrowLook(a, roads);
  return { look, pts: marksOf(getObjectDef(a.defId), a.rotation, look.paint, look.shift).flatMap((m) => m.pts.map(([x, y]) => [a.x + x, a.y + y] as const)) };
};

// ===== On every straight, in every facing and lane row: the arrow lies inside its lane =====
const STRAIGHTS = ['wide-straight', 'wide-dashed', 'wide-dashed2', 'narrow-straight', 'narrow-dashed', 'narrow-dashed2'];
let checked = 0;
for (const id of STRAIGHTS) {
  const cls = getObjectDef(id).lanes!;
  const W = getObjectDef(id).h;
  for (const rr of [0, 1, 2, 3] as const) {
    const road = (k: number) => (rr % 2 === 0 ? piece(id, rr, 10 + k, 10) : piece(id, rr, 10, 10 + k));
    const roads = [0, 1, 2].map(road);
    for (const ar of (rr % 2 === 0 ? [0, 2] : [1, 3]) as Rotation[]) {
      for (let row = 0; row < W; row++) {
        for (const aid of ARROWS) {
          const a = rr % 2 === 0 ? piece(aid, ar, 10, 10 + row) : piece(aid, ar, 10 + row, 10);
          const { look, pts } = drawn(a, roads);
          const across = pts.map(([x, y]) => (rr % 2 === 0 ? y : x) - 10);
          const along = pts.map(([x, y]) => (rr % 2 === 0 ? x : y) - 10);
          if (cls === 'wide' && row === 2) { assert.equal(look.paint, 'off', 'the divider row is no lane'); continue; }
          assert.equal(look.paint, cls, `${id} r${rr} ${aid} r${ar} row ${row}`);
          const lane = laneSpans(cls).find(([from, to]) => Math.min(...across) >= from && Math.max(...across) <= to);
          assert.ok(lane, `${id} r${rr} ${aid} r${ar} row ${row}: inside one lane`);
          // clear of the lines bounding it, and centered in it
          assert.ok(Math.min(...across) >= lane[0] + LINE / 2 && Math.max(...across) <= lane[1] - LINE / 2, `${id} ${aid} row ${row}: clear of the lines`);
          assert.ok(Math.abs((Math.min(...across) + Math.max(...across)) / 2 - lane[2]) < 1e-6, `${id} ${aid} r${ar} row ${row}: centered (${Math.min(...across)}, ${Math.max(...across)})`);
          // within its own three tiles along the road
          assert.ok(Math.min(...along) >= 0 && Math.max(...along) <= 3);
          checked++;
        }
      }
    }
  }
}
ok(`on all six straights, every facing and lane row, arrows sit centered in their lane, clear of its lines (${checked} cases)`);

// the arrow points the way it faces: its head lies ahead of its middle along its facing
for (const r of [0, 1, 2, 3] as const) {
  const a = piece('arrow-straight', r, 10, 10);
  const tri = marksOf(getObjectDef(a.defId), r, 'off').find((m) => m.pts.length === 3)!;
  const cx = tri.pts.reduce((t, p) => t + p[0], 0) / 3 - a.w / 2;
  const cy = tri.pts.reduce((t, p) => t + p[1], 0) / 3 - a.h / 2;
  const ahead = [cx, cy, -cx, -cy][r]!;
  assert.ok(ahead > 0.4, `facing ${r}: ${ahead}`);
}
ok('an arrow points along its facing');

// ===== Off road, and road that is not a straight running the same way =====
const wide = [0, 1, 2].map((k) => piece('wide-straight', 0, 10 + k, 10));
for (const aid of ARROWS) {
  assert.deepEqual(arrowLook(piece(aid, 0, 30, 30), wide), { paint: 'off', shift: 0 }, 'off road');
  assert.deepEqual(arrowLook(piece(aid, 1, 11, 9), wide), { paint: 'off', shift: 0 }, 'across a road');
  assert.deepEqual(arrowLook(piece(aid, 0, 20, 20), [piece('wide-cross', 0, 20, 18)]), { paint: 'off', shift: 0 }, 'on a junction');
  assert.deepEqual(arrowLook(piece(aid, 0, 20, 20), [piece('wide-gentle', 0, 18, 18)]), { paint: 'off', shift: 0 }, 'on a curve');
}
ok('off road, across a road, on a junction or a curve, an arrow keeps the off-road look in its row');

// ===== Shapes: one head per paint; smaller than before =====
for (const paint of ['wide', 'medium', 'off'] as const) {
  const heads = KINDS.map((k) => {
    const marks = marksOf(getObjectDef(`arrow-${k}`), 0, paint);
    const tri = marks.find((m) => m.pts.length === 3)!;
    const [[ax, ay], [bx, by], [cx, cy]] = tri.pts as [number, number][];
    return Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
  });
  assert.ok(heads.every((a) => Math.abs(a - heads[0]!) < 1e-9), `${paint}: all heads the same size`);
  for (const k of KINDS) {
    const pts = marksOf(getObjectDef(`arrow-${k}`), 0, paint).flatMap((m) => m.pts);
    const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
    assert.ok(Math.max(...xs) - Math.min(...xs) <= 1.71 && Math.max(...ys) - Math.min(...ys) <= 0.57, `${paint} ${k} small`);
  }
}
ok('all three arrows share one head per paint, and fit 1.7 by 0.56 at most');

// ===== Placing on a medium road's middle row goes into the lane the pointer is in =====
const narrowRoad = run(initialHistory, { type: 'select', id: 'narrow-straight' }, { type: 'hover', ...pt(10.5, 11.5) },
  { type: 'press', ...pt(10.5, 11.5) }, { type: 'hover', ...pt(16.5, 11.5) }, { type: 'release' });
const rowOf = (h: History) => h.state.objects.find((o) => o.defId === 'arrow-straight')!.y;
assert.equal(rowOf(run(narrowRoad, { type: 'select', id: 'arrow-straight' }, ...click(13.5, 11.3))), 10);
assert.equal(rowOf(run(narrowRoad, { type: 'select', id: 'arrow-straight' }, ...click(13.5, 11.7))), 12);
assert.equal(rowOf(run(narrowRoad, { type: 'select', id: 'arrow-straight' }, ...click(13.5, 10.5))), 10);
// turned along y on a road along y
const narrowY = run(initialHistory, { type: 'select', id: 'narrow-straight' }, ...turns(1), { type: 'hover', ...pt(11.5, 10.5) },
  { type: 'press', ...pt(11.5, 10.5) }, { type: 'hover', ...pt(11.5, 16.5) }, { type: 'release' });
const colOf = (h: History) => h.state.objects.find((o) => o.defId === 'arrow-left')!.x;
assert.equal(colOf(run(narrowY, { type: 'select', id: 'arrow-left' }, ...click(11.8, 13.5))), 12);
assert.equal(colOf(run(narrowY, { type: 'select', id: 'arrow-left' }, ...click(11.2, 13.5))), 10);
// on a wide road the middle row is not moved
const wideRoad = run(initialHistory, { type: 'select', id: 'wide-straight' }, { type: 'hover', ...pt(10.5, 12.5) },
  { type: 'press', ...pt(10.5, 12.5) }, { type: 'hover', ...pt(16.5, 12.5) }, { type: 'release' });
assert.equal(rowOf(run(wideRoad, { type: 'select', id: 'arrow-straight' }, ...click(13.5, 12.3))), 12);
ok("an arrow placed on a medium road's middle row goes into the lane on the pointer's side");
