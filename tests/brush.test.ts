import { strict as assert } from 'node:assert';
import { BRUSH_SIZES, brushCells, brushCenter, brushCircle, stepBrush, strokeCells } from '../src/brush.ts';
let n = 0; const ok = (m: string) => console.log(`ok ${++n} - ${m}`);
const keys = (cs: readonly { x: number; y: number }[]) => cs.map((c) => `${c.x},${c.y}`).sort();

// sizes and their tile counts: small ones are squares, bigger ones round discs
const counts = Object.fromEntries(BRUSH_SIZES.map((s) => [s, brushCells({ x: 10.3, y: 10.7 }, s).length]));
assert.deepEqual(counts, { 1: 1, 2: 4, 3: 9, 4: 12, 5: 21, 7: 37, 9: 69, 12: 112 });
ok('each brush size covers a fixed round set of tiles (1, 4, 9, 12, 21, 37, 69, 112)');

// the shape does not depend on where inside its snap the pointer is
BRUSH_SIZES.forEach((s) => {
  const a = brushCells({ x: 10.05, y: 10.05 }, s), b = brushCells({ x: 10.45, y: 10.45 }, s);
  if (s % 2 === 1) assert.deepEqual(keys(a), keys(b), `size ${s}`);
  // the disc is symmetric about its center
  const c = brushCenter({ x: 10.3, y: 10.3 }, s);
  const cells = brushCells({ x: 10.3, y: 10.3 }, s);
  const mirrored = cells.map((t) => ({ x: Math.round(2 * c.x - t.x - 1), y: Math.round(2 * c.y - t.y - 1) }));
  assert.deepEqual(keys(mirrored), keys(cells), `size ${s} symmetric`);
});
assert.deepEqual(keys(brushCells({ x: 3.9, y: 7.1 }, 1)), ['3,7']);
assert.deepEqual(brushCenter({ x: 3.6, y: 7.4 }, 2), { x: 4, y: 7 });
assert.deepEqual(brushCircle({ x: 3.2, y: 7.8 }, 5), { center: { x: 3.5, y: 7.5 }, radius: 2.5 });
ok('odd sizes center on the tile under the pointer, even sizes on the nearest grid corner; the disc is symmetric');

// a 4 is round: no corners
const four = keys(brushCells({ x: 10, y: 10 }, 4));
assert.ok(!four.includes('8,8') && !four.includes('11,11') && four.includes('9,8') && four.includes('8,9'));
ok('a size 4 brush leaves its corners out');

// strokes: no gaps, each tile once
const line = strokeCells({ x: 2.5, y: 2.5 }, { x: 20.5, y: 2.5 }, 1);
assert.equal(line.length, 19);
assert.equal(new Set(keys(line)).size, line.length);
const diag = strokeCells({ x: 2.5, y: 2.5 }, { x: 12.5, y: 12.5 }, 3);
for (let i = 2; i <= 12; i++) assert.ok(keys(diag).includes(`${i},${i}`));
assert.equal(new Set(keys(diag)).size, diag.length);
assert.deepEqual(keys(strokeCells({ x: 5.2, y: 5.2 }, { x: 5.2, y: 5.2 }, 5)), keys(brushCells({ x: 5.2, y: 5.2 }, 5)));
ok('a stroke covers every tile along the way once, and a click is one stamp');

assert.equal(stepBrush(3, 1), 4); assert.equal(stepBrush(12, 1), 12); assert.equal(stepBrush(1, -1), 1); assert.equal(stepBrush(7, -1), 5);
ok('[ and ] step through the sizes and stop at the ends');
