// Lane arrows that fit their road (#40). Pure: works on placed pieces in any one frame (the world or
// the turned view), since it only compares footprints and facings.
//
// An arrow keeps its 3 by 1 footprint in a tile row. What it lies on decides its look: on a straight
// road running the same way, it takes that road's paint (a size per road class) and slides across its
// row to the middle of the lane it is in; anywhere else (off road, a junction, a curve, a road running
// across it, a wide road's middle divider row) it keeps the off-road look in the middle of its row.
import { type ArrowPaint, type Rotation, getObjectDef, laneSpans } from './catalog';
import type { Cell, Point } from './geometry';

type Placed = Readonly<{ defId: string; rotation: Rotation; x: number; y: number; w: number; h: number }>;
export type ArrowLook = Readonly<{ paint: ArrowPaint; shift: number }>;
const OFF: ArrowLook = { paint: 'off', shift: 0 };

const alongX = (p: Placed): boolean => p.rotation % 2 === 0;
const covers = (p: Placed, c: Cell): boolean => c.x >= p.x && c.x < p.x + p.w && c.y >= p.y && c.y < p.y + p.h;

// The straight road with lanes under a cell, running the given way
const laneRoadAt = (roads: readonly Placed[], c: Cell, runsX: boolean): Placed | undefined =>
  roads.find((o) => getObjectDef(o.defId).lanes !== undefined && alongX(o) === runsX && covers(o, c));

// The lane (its middle, from the road's side) holding a point `at` across the road; a point on the
// line between two lanes counts in the first
const laneAt = (road: Placed, at: number): number | undefined => {
  const cls = getObjectDef(road.defId).lanes;
  if (!cls) return undefined;
  return laneSpans(cls).find(([from, to]) => at >= from - 1e-9 && at <= to + 1e-9)?.[2];
};

export const arrowLook = (arrow: Placed, roads: readonly Placed[]): ArrowLook => {
  if (!getObjectDef(arrow.defId).arrow) return OFF;
  const runsX = alongX(arrow);
  const mid: Cell = runsX ? { x: arrow.x + 1, y: arrow.y } : { x: arrow.x, y: arrow.y + 1 };
  const road = laneRoadAt(roads, mid, runsX);
  if (!road) return OFF;
  const cls = getObjectDef(road.defId).lanes ?? 'wide';
  // across the road: y for a road along x, x for one along y; lanes are symmetric, so the road's facing
  // does not matter
  const at = runsX ? arrow.y + 0.5 - road.y : arrow.x + 0.5 - road.x;
  const lane = laneAt(road, at);
  if (lane === undefined) return OFF;
  // the slide is across the world; in the arrow's own y it flips for facings 1 and 2 (see turnPoint)
  const d = lane - at;
  return { paint: cls, shift: arrow.rotation === 1 || arrow.rotation === 2 ? -d : d };
};

// Placing an arrow on a medium road's middle row (the center line runs along it, so it is no lane): it
// goes into the lane on the side of that row the pointer is on
export const snapArrow = <P extends Placed>(p: P, roads: readonly Placed[], point: Point | null): P => {
  if (!getObjectDef(p.defId).arrow || !point) return p;
  const runsX = alongX(p);
  const mid: Cell = runsX ? { x: p.x + 1, y: p.y } : { x: p.x, y: p.y + 1 };
  const road = laneRoadAt(roads, mid, runsX);
  if (!road || getObjectDef(road.defId).lanes !== 'medium') return p;
  const row = runsX ? p.y - road.y : p.x - road.x;
  if (row !== 1) return p;
  const frac = runsX ? point.y - Math.floor(point.y) : point.x - Math.floor(point.x);
  const step = frac < 0.5 ? -1 : 1;
  return runsX ? { ...p, y: p.y + step } : { ...p, x: p.x + step };
};
