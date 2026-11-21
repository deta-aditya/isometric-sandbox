// Catalog: pure data describing everything that can be built.
// Four kinds of items, each placed differently:
//   object:  click to place, has a footprint and visual parts
//   tile:    drag to paint ground cells (paths outside, floors inside)
//   wall:    drag along grid lines to build wall segments, or drag a rectangle to build a room
//            (the building mode lives in State, not in the catalog)
//   opening: click a wall segment to put a door, window or arch in it
import { type Box, boxDrawsBefore } from './depthSort';
import type { Cell } from './geometry';

// Two levels of grouping: categories (bottom bar) contain groups (tabs in the tray).
export type CategoryId = 'scenery' | 'furniture' | 'flooring' | 'terrain' | 'building';
export type GroupId =
  | 'decor'
  | 'outdoor'
  | 'garden'
  | 'trees'
  | 'shrubs'
  | 'lamps'
  | 'waterside'
  | 'sports'
  | 'office'
  | 'canteen'
  | 'lab'
  | 'class'
  | 'hallway'
  | 'toilet'
  | 'lounge'
  | 'kitchen'
  | 'paths'
  | 'roads'
  | 'narrow'
  | 'links'
  | 'markings'
  | 'courts'
  | 'water'
  | 'walls'
  | 'doors'
  | 'windows'
  | 'arches'
  | 'fences'
  | 'gates'
  | 'paints'
  | 'floors'
  | 'grass'
  | 'ground';

export type Group = Readonly<{ id: GroupId; name: string }>;
export type Category = Readonly<{ id: CategoryId; name: string; icon: string; groups: readonly Group[] }>;

export const CATEGORIES: readonly Category[] = [
  {
    id: 'scenery',
    name: 'Scenery',
    icon: 'pine',
    groups: [
      { id: 'decor', name: 'Decor' },
      { id: 'outdoor', name: 'Outdoor' },
      { id: 'trees', name: 'Trees' },
      { id: 'shrubs', name: 'Shrubs' },
      { id: 'garden', name: 'Garden' }, // flowers first, then arches, the clock and statues
      { id: 'lamps', name: 'Lamps' },
      { id: 'waterside', name: 'Waterside' },
      { id: 'sports', name: 'Sports' },
    ],
  },
  {
    id: 'furniture',
    name: 'Furniture',
    icon: 'sofa',
    groups: [
      { id: 'office', name: 'Office' },
      { id: 'canteen', name: 'Canteen' },
      { id: 'lab', name: 'Lab' },
      { id: 'class', name: 'Class' },
      { id: 'hallway', name: 'Hallway' },
      { id: 'toilet', name: 'Toilet' },
      { id: 'lounge', name: 'Lounge' },
      { id: 'kitchen', name: 'Kitchen' },
    ],
  },
  {
    id: 'flooring',
    name: 'Flooring',
    icon: 'wood-floor',
    groups: [
      { id: 'floors', name: 'Floors' },
      { id: 'paths', name: 'Paths' },
      { id: 'roads', name: 'Wide roads' },
      { id: 'narrow', name: 'Narrow roads' },
      { id: 'links', name: 'Road links' },
      { id: 'markings', name: 'Markings' },
      { id: 'courts', name: 'Courts' },
      { id: 'water', name: 'Water' },
    ],
  },
  {
    id: 'terrain',
    name: 'Terrain',
    icon: 'soil-dirt',
    groups: [
      { id: 'grass', name: 'Grass' },
      { id: 'ground', name: 'Ground' },
    ],
  },
  {
    id: 'building',
    name: 'Building',
    icon: 'wooden-door',
    groups: [
      { id: 'walls', name: 'Walls' },
      { id: 'paints', name: 'Paints' }, // next to Walls: paints go on walls
      { id: 'doors', name: 'Doors' },
      { id: 'windows', name: 'Windows' },
      { id: 'arches', name: 'Arches' },
      { id: 'fences', name: 'Fences' },
      { id: 'gates', name: 'Gates' },
    ],
  },
];

// The order of the bulldoze and select filter toggles and their number keys. It is its own list so
// that Terrain, which sits after Flooring in the category bar, takes the fifth key and the first four
// keep the numbers they always had.
export const FILTER_ORDER: readonly CategoryId[] = ['scenery', 'furniture', 'flooring', 'building', 'terrain'];

export const groupsOf = (category: CategoryId): readonly Group[] =>
  CATEGORIES.find((c) => c.id === category)?.groups ?? [];

export const categoryOf = (group: GroupId): CategoryId =>
  CATEGORIES.find((c) => c.groups.some((g) => g.id === group))?.id ?? 'scenery';

// Round shapes fill the ellipse inside their footprint
export type Shape = 'box' | 'pyramid' | 'cylinder' | 'cone';

// Positioned in tile units relative to the footprint's top corner: dx/dy/w/h in tiles,
// z/height in pixels.
export type Part = Readonly<{
  shape: Shape;
  dx: number;
  dy: number;
  w: number;
  h: number;
  z: number;
  height: number;
  color: number;
}>;

type Base = Readonly<{ id: string; name: string; group: GroupId }>;

// A flat ground piece (a road, a parking bay) is an object drawn as marks instead of parts: polygons
// lying on the ground, in footprint coordinates (0..w, 0..h), drawn back to front as listed. It may
// occupy only some cells of its footprint (`cells`, also in footprint terms), so a curve leaves its
// inside free. Marks and cells turn with the object like parts do.
export type MarkPoint = readonly [number, number];
export type Mark = Readonly<{ pts: readonly MarkPoint[]; color: number; alpha?: number }>;
// Flat pieces lie in one of two ground layers, like floors: road surfaces, and markings painted on top.
// Nothing that stands (furniture, trees, gates) or any wall minds them; a piece only keeps clear of
// pieces in its own layer.
// The median lies above markings, so a crosswalk can run under it (the median shows a refuge there)
export type GroundLayer = 'road' | 'marking' | 'median';
export type ObjectDef = Base &
  Readonly<{
    kind: 'object'; w: number; h: number; parts: readonly Part[];
    marks?: readonly Mark[]; cells?: readonly Cell[]; layer?: GroundLayer;
    // a smart piece draws itself from its neighbors of the same kind (a median joins up and rounds its
    // ends), and is laid by dragging, a tile at a time
    smart?: 'median';
    // laid by dragging along a straight run (the 1-tile road straights and the bus bay middle)
    run?: true;
    // a median under this marking shows a paved refuge (crosswalks)
    refuge?: true;
  }>;
// A tile with a bank color is water: it joins up with neighboring water and draws banks where it doesn't
// stripe: a second color for every other tile, in rows that keep their direction in the world as the
// camera turns (mowed grass)
export type TileDef = Base & Readonly<{ kind: 'tile'; color: number; bank?: number; stripe?: number }>;
// Terrain is the ground itself, one kind per tile, under floors, paths, water and roads. No entry means
// plain grass (the `grass` item is the eraser). The look (soft blended edges) is drawn from the color.
export type TerrainDef = Base & Readonly<{ kind: 'terrain'; color: number; specks?: readonly number[] }>;
// A culvert sits on a canal bank (a grid edge between water and land), like a door sits on a wall:
// holes in the bank wall and the bank closing in at a V, so the water reads as running under the ground
// An edge piece on water: a plain culvert on a bank, or (#17c) a canal outlet or inlet on the edge where a
// canal meets a stream. `piece` is the kind stored on the edge (none for a plain culvert).
export type CulvertPiece = 'outlet' | 'inlet';
export type CulvertDef = Base & Readonly<{ kind: 'culvert'; piece?: CulvertPiece }>;
// Paint is a color layer on one side of a wall, over the wall's material. A null color is Plain:
// it strips the paint so the side shows its material again.
export type PaintDef = Base & Readonly<{ kind: 'paint'; color: number | null }>;
// `floor` is the tile laid automatically when walls of this style close off a room
// A fence is a wall style with a fence look. It is built like a wall but never forms a room, stays low
// whatever the wall view, and takes gates instead of doors and windows. The look is plain data that one
// drawer turns into pickets, railings, hedges and so on.
export type FenceLook = Readonly<{
  height: number;
  post: number | null; // post color; posts stand at both ends of every segment
  rails: readonly number[]; // elevations of horizontal rails
  pickets: number; // upright boards or bars per segment
  panel: Readonly<{ alpha: number; thick: number }> | null; // a filled panel: boards, mesh, hedge
  postSize?: number; // thicker posts become capped pillars
  base?: Readonly<{ height: number; color: number; thick: number }>; // a low wall the bars stand on
  rope?: Readonly<{ z: number; sag: number; color: number }>; // hangs from post to post, dipping `sag` in the middle
}>;
// A wall style is a material. Its color shows on any side that has no paint.
// Glass is a see-through material: the pane at `alpha`, with a thin `frame` around it
export type GlassLook = Readonly<{ alpha: number; frame: number }>;
// A pole wall is posts and a beam along the top, no panel: it encloses like a wall (so a walkway ringed
// with poles, or poles against a building, is a room) and any room it bounds gets a canopy on top
export type PoleLook = Readonly<{ post: number; beam: number; canopy: number }>;
export type WallStyle = Base & Readonly<{ kind: 'wall'; color: number; floor?: string; fence?: FenceLook; glass?: GlassLook; pole?: PoleLook }>;
// An opening is a hole in one wall segment: it spans `from`..`to` along the segment (0..1) and
// `bottom`..`top` in height (pixels). The hole holds a door leaf or glass, or stays open (arch).
// Doors, windows and arches are all the same shape of data, differing only in these numbers.
export type OpeningFill = Readonly<{ color: number; alpha: number }>;
// An arched gate (on fences): tall pillars at the run's outer ends and an arch between them. Each piece
// of the span draws its own slice, from its role alone: the start piece rises from its pillar in a
// quarter curve, middle pieces carry the arch's flat top, and the end piece comes down to its pillar.
// Elevations in pixels: the arch springs from the pillars at `spring` and is `rise` higher at the top.
export type ArchLook = Readonly<{ color: number; pillar: number; pillarSize: number; pillarHeight: number; spring: number; rise: number }>;
export type OpeningLook = Readonly<{ from: number; to: number; bottom: number; top: number; fill: OpeningFill | null; role?: SpanRole; arch?: ArchLook }>;
// A wide opening spans several wall segments. The catalog item (shown in the tray) names its three
// pieces; each piece is its own hidden opening that knows its parent and its role in the span.
export type SpanRole = 'start' | 'middle' | 'end';
export type SpanPieces = Readonly<{ start: string; middle: string; end: string }>;
export type OpeningDef = Base &
  OpeningLook &
  Readonly<{ kind: 'opening'; pieces?: SpanPieces; parent?: string; role?: SpanRole; gate?: true }>; // gates go on fences only
export type CatalogItem = ObjectDef | TileDef | TerrainDef | WallStyle | OpeningDef | CulvertDef | PaintDef;

// Small helpers to keep the table below readable
const box = (dx: number, dy: number, w: number, h: number, z: number, height: number, color: number): Part =>
  ({ shape: 'box', dx, dy, w, h, z, height, color });
const cyl = (dx: number, dy: number, w: number, h: number, z: number, height: number, color: number): Part => ({
  shape: 'cylinder', dx, dy, w, h, z, height, color,
});
const cone = (dx: number, dy: number, w: number, h: number, z: number, height: number, color: number): Part => ({
  shape: 'cone', dx, dy, w, h, z, height, color,
});
const pyr = (dx: number, dy: number, w: number, h: number, z: number, height: number, color: number): Part =>
  ({ shape: 'pyramid', dx, dy, w, h, z, height, color });
// A stem with a flower head on top, centered on (cx, cy), growing up from height `base`
// (0 for the ground; the top of the soil for a planter)
// A round crown: five thin round slices sized like a ball (narrow, wide, widest, wide, narrow),
// darker underneath and lighter on top. A ball as tall as it is wide reads full from the camera;
// in pixels that is about 45 per tile of diameter.
const BALL = [0.6, 0.92, 1, 0.92, 0.6];
const crown = (cx: number, cy: number, r: number, z: number, dark: number, mid: number, light: number): Part[] => {
  const height = r * 2 * 45;
  const slice = height / BALL.length;
  const colors = [dark, mid, mid, light, light];
  return BALL.map((k, i) => {
    const rr = r * k;
    return cyl(cx - rr, cy - rr, rr * 2, rr * 2, z + slice * i, slice + 0.5, colors[i] ?? mid);
  });
};

// A conifer: stacked cones, each tier narrower than the one below
const pine = (cx: number, cy: number, r: number, z: number, height: number, color: number, light: number): Part[] =>
  [1, 0.78, 0.55].map((k, i) => {
    const rr = r * k;
    return cone(cx - rr, cy - rr, rr * 2, rr * 2, z + height * 0.27 * i, height * 0.46, i === 1 ? light : color);
  });

const flower = (cx: number, cy: number, stem: number, color: number, head: number, base = 0): Part[] => [
  box(cx - 0.025, cy - 0.025, 0.05, 0.05, base, stem, 0x16a34a),
  box(cx - head / 2, cy - head / 2, head, head, base + stem, Math.max(4, head * 30), color),
];
const fence = (id: string, name: string, color: number, look: FenceLook): WallStyle => ({ kind: 'wall', group: 'fences', id, name, color, fence: look });
const WOOD: OpeningFill = { color: 0x78350f, alpha: 1 };
const GLASS: OpeningFill = { color: 0x7dd3fc, alpha: 0.9 };
const opening = (
  group: GroupId,
  id: string,
  name: string,
  from: number,
  to: number,
  bottom: number,
  top: number,
  fill: OpeningFill | null,
): OpeningDef => ({ kind: 'opening', group, id, name, from, to, bottom, top, fill });
// A spanning opening: the tray item plus its start, middle and end pieces. `margin` is the solid wall
// left at the outer end of the first and last segment; inner ends are open so the run reads as one.
const spanning = (
  group: GroupId,
  id: string,
  name: string,
  bottom: number,
  top: number,
  fill: OpeningFill | null,
  margin: number,
  arch?: ArchLook,
): OpeningDef[] => {
  const piece = (role: SpanRole, from: number, to: number): OpeningDef =>
    ({ ...opening(group, `${id}:${role}`, name, from, to, bottom, top, fill), parent: id, role, ...(arch ? { arch } : {}) });
  return [
    { ...opening(group, id, name, 0, 1, bottom, top, fill), pieces: { start: `${id}:start`, middle: `${id}:middle`, end: `${id}:end` }, ...(arch ? { arch } : {}) },
    piece('start', margin, 1),
    piece('middle', 0, 1),
    piece('end', 0, 1 - margin),
  ];
};
const obj = (group: GroupId,id: string, name: string, w: number, h: number, parts: Part[]): ObjectDef =>
  ({ kind: 'object', group, id, name, w, h, parts });


// ===== Garden pieces =====
const STONE = 0xa8a29e;
const STONE_DARK = 0x78716c;

// An arch across a 2x1 footprint (along x), from x = a to x = b, springing at `spring` and `rise`
// higher in the middle. Steps along x each cover the height the curve passes through, so the band has
// no gaps where it is steep; `top` says where each step's top is, for things set on the arch.
const archSteps = (a: number, b: number, y: number, depth: number, spring: number, rise: number, band: number, color: number, n = 16) =>
  Array.from({ length: n }, (_, i) => {
    const [x0, x1] = [a + ((b - a) * i) / n, a + ((b - a) * (i + 1)) / n];
    const z = (x: number) => spring + rise * Math.sqrt(Math.max(0, 1 - ((2 * (x - a)) / (b - a) - 1) ** 2));
    const [lo, hi] = [Math.min(z(x0), z(x1)), Math.max(z(x0), z(x1)) + band];
    return { part: box(x0, y, x1 - x0, depth, lo, hi - lo, color), x0, x1, top: hi };
  });

// A garden clock in stone on one tile: a dark stone ring under a pale stone face, twelve dark hour
// marks (the 12 a little bigger), iron hands showing three o'clock with a brass cap, and a clump of
// flowers in each corner of the tile. "12" is at the top of the screen when unturned. The hands are
// chains of small squares touching at their corners, so they run along the screen's up and right.
const floralClock = (): Part[] => {
  const c = 0.5;
  const up: readonly [number, number] = [-Math.SQRT1_2, -Math.SQRT1_2]; // screen up, in grid terms
  const right: readonly [number, number] = [Math.SQRT1_2, -Math.SQRT1_2]; // screen right
  const R = 0.25;
  const marks = Array.from({ length: 12 }, (_, h) => {
    const t = (h * Math.PI) / 6;
    const [x, y] = [c + R * (up[0] * Math.cos(t) + right[0] * Math.sin(t)), c + R * (up[1] * Math.cos(t) + right[1] * Math.sin(t))];
    const s = h === 0 ? 0.07 : 0.05;
    return box(x - s / 2, y - s / 2, s, s, 9, 1.5, h === 0 ? 0x292524 : 0x57534e);
  });
  const S = 0.04;
  const hand = (dx: number, dy: number, n: number) =>
    Array.from({ length: n }, (_, k) => box(c + dx * S * (k + 0.5) - S / 2, c + dy * S * (k + 0.5) - S / 2, S, S, 9, 1.2, 0x1c1917));
  const clump = (x: number, y: number) => [
    box(x, y, 0.1, 0.1, 0, 4, 0x15803d),
    box(x + 0.01, y + 0.01, 0.04, 0.04, 4, 3, 0xec4899),
    box(x + 0.055, y + 0.055, 0.035, 0.035, 4, 3, 0xfbbf24),
  ];
  return [
    ...clump(0.005, 0.005), // flowers in the corners, outside the stone
    ...clump(0.89, 0.005),
    ...clump(0.005, 0.89),
    ...clump(0.89, 0.89),
    cyl(0.12, 0.12, 0.76, 0.76, 0, 7, STONE_DARK), // stone drum
    cyl(0.17, 0.17, 0.66, 0.66, 7, 2, 0xe7e5e4), // pale stone face
    ...marks,
    ...hand(-1, -1, 3), // minute hand to 12
    ...hand(1, -1, 2), // hour hand to 3
    cyl(0.465, 0.465, 0.07, 0.07, 10.2, 1.5, 0xb45309),
  ];
};


// ===== Road pieces =====
// Two families: wide roads, 5 tiles across (two lanes of 2 and a middle row that holds a median), and
// narrow roads, 3 across. Every piece has white edge lines 0.22 in from its sides and a dashed white
// center line, dashes half a tile on and half off, so pieces line up in any order. A straight is one
// tile long and runs along x; a curve enters at x = 0 (the outer edge at y = 0) and turns toward +y.
const ASPHALT = 0x44444c; // the Asphalt path's color, so roads and asphalt paths join without a seam
const ROAD_LINE = 0xf1f5f9;
const BAY_YELLOW = 0xfacc15;
const LINE = 0.08; // line width, in tiles
const EDGE = [0.18, 0.26] as const; // where an edge line lies, in from the road's side
const WIDE = 5;
const NARROW = 3;

const rectMark = (x0: number, y0: number, x1: number, y1: number, color: number, alpha?: number): Mark =>
  ({ pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], color, ...(alpha !== undefined ? { alpha } : {}) });

// A band about (cx, cy) between two radii that may change along it (r0(t), r1(t) for t from 0 to 1),
// from angle a0 to a1 (radians; 0 is +x, -PI/2 is -y), sampled finely enough to look round
const band = (cx: number, cy: number, r0: (t: number) => number, r1: (t: number) => number, a0: number, a1: number, color: number): Mark => {
  const n = Math.max(4, Math.ceil(Math.abs(a1 - a0) * r1(0.5) * 4));
  const at = (r: (t: number) => number, i: number): MarkPoint => {
    const t = i / n;
    const a = a0 + (a1 - a0) * t;
    return [cx + r(t) * Math.cos(a), cy + r(t) * Math.sin(a)];
  };
  const outer = Array.from({ length: n + 1 }, (_, i) => at(r1, i));
  const inner = Array.from({ length: n + 1 }, (_, i) => at(r0, n - i));
  return { pts: [...outer, ...inner], color };
};
// A ring sector of fixed radii
const sector = (cx: number, cy: number, r0: number, r1: number, a0: number, a1: number, color: number): Mark =>
  band(cx, cy, () => r0, () => r1, a0, a1, color);

// The cells a piece stands on: those with some sample point inside its asphalt
const cellsWhere = (w: number, h: number, inside: (x: number, y: number) => boolean): Cell[] =>
  Array.from({ length: w * h }, (_, i) => ({ x: i % w, y: Math.floor(i / w) })).filter(({ x, y }) =>
    [0.1, 0.35, 0.65, 0.9].some((sx) => [0.1, 0.35, 0.65, 0.9].some((sy) => inside(x + sx, y + sy))));

// The lines inside a road, across its width from y = 0: a narrow road has a dashed center line; a
// wide road has four 1-tile lanes, dashed lane lines 1 tile in from each side, and a middle divider row
// between two solid lines (where a median goes)
type LaneLine = Readonly<{ at: number; dashed: boolean }>;
const laneLines = (width: number): readonly LaneLine[] =>
  width === WIDE
    ? [{ at: 1, dashed: true }, { at: 2, dashed: false }, { at: 3, dashed: false }, { at: 4, dashed: true }]
    : [{ at: width / 2, dashed: true }];

// A quarter turn about (0, cy) whose inner and outer radii (rIn(t), rOut(t), t from 0 at the entry to
// 1 at the exit) may change along it: a plain curve keeps them, a turn transition narrows the road.
// Edge lines follow both sides; `lines` gives the lines inside, each at a radius along the turn, dashed
// ones half a tile on, half off.
type TurnLine = Readonly<{ r: (t: number) => number; dashed: boolean }>;
const quarterTurn = (
  cy: number, rIn: (t: number) => number, rOut: (t: number) => number,
  lines: readonly TurnLine[] = [{ r: (t) => (rIn(t) + rOut(t)) / 2, dashed: true }],
): { marks: Mark[]; inside: (x: number, y: number) => boolean } => {
  const [a0, a1] = [-Math.PI / 2, 0];
  const lineMarks = lines.flatMap(({ r, dashed }) => {
    if (!dashed) return [band(0, cy, (t) => r(t) - LINE / 2, (t) => r(t) + LINE / 2, a0, a1, ROAD_LINE)];
    const length = ((r(0) + r(1)) / 2) * (Math.PI / 2);
    return Array.from({ length: Math.ceil(length) }, (_, k) => [0.25 + k, 0.75 + k] as const)
      .filter(([, b]) => b <= length - 0.1)
      .map(([a, b]) => {
        // a dash covers t from ta to tb of the turn; the band walks its own 0..1, so map it back
        const [ta, tb] = [a / length, b / length];
        const at = (u: number) => r(ta + (tb - ta) * u);
        return band(0, cy, (u) => at(u) - LINE / 2, (u) => at(u) + LINE / 2, a0 + ta * (a1 - a0), a0 + tb * (a1 - a0), ROAD_LINE);
      });
  });
  const marks = [
    band(0, cy, rIn, rOut, a0, a1, ASPHALT),
    band(0, cy, (t) => rOut(t) - EDGE[1], (t) => rOut(t) - EDGE[0], a0, a1, ROAD_LINE),
    band(0, cy, (t) => Math.max(0, rIn(t) + EDGE[0]), (t) => rIn(t) + EDGE[1], a0, a1, ROAD_LINE),
    ...lineMarks,
  ];
  const inside = (x: number, y: number) => {
    const a = Math.atan2(y - cy, x);
    if (a < a0 || a > a1) return false;
    const t = (a - a0) / (a1 - a0);
    const r = Math.hypot(x, y - cy);
    return r > rIn(t) && r < rOut(t);
  };
  return { marks, inside };
};
// A plain curve of a road `width` wide with the given inner radius, on a square footprint
const curve = (width: number, inner: number) => {
  const size = inner + width;
  // y = 0 of a straight is the outer side of the curve, so a line `at` in lies at radius size - at
  const lines = laneLines(width).map(({ at, dashed }) => ({ r: () => size - at, dashed }));
  const { marks, inside } = quarterTurn(size, () => inner, () => size, lines);
  return { marks, cells: cellsWhere(size, size, inside), size };
};
// A turn that narrows a wide road to a narrow one about a tight inside corner: it enters wide at x = 0
// and leaves narrow through y = 5, turning right (toward +y). Mirrored, it turns left.
const turnTransition = (() => {
  // the outer edge draws in from 5 to 3, but never past x = 3, so near the exit it runs straight
  const out = (t: number) => Math.min(WIDE - (WIDE - NARROW) * t, NARROW / Math.max(1e-6, Math.sin((t * Math.PI) / 2)));
  const { marks, inside } = quarterTurn(WIDE, () => 0, out);
  return { marks, cells: cellsWhere(NARROW, WIDE, inside) };
})();
const mirrorY = (h: number) => (m: Mark): Mark => ({ ...m, pts: m.pts.map(([x, y]) => [x, h - y] as MarkPoint) });

// A straight line of width w from (x0, y0) to (x1, y1), as a thin quad
const segMark = (x0: number, y0: number, x1: number, y1: number, w: number, color: number): Mark => {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const [nx, ny] = [(-(y1 - y0) / len) * (w / 2), ((x1 - x0) / len) * (w / 2)];
  return { pts: [[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]], color };
};
// A road edge line turning a junction's corner at (cx, cy): a quarter ring at the edge line's
// distance, starting at angle a0 (0 is +x, PI/2 is +y)
const cornerLine = (cx: number, cy: number, a0: number): Mark => sector(cx, cy, EDGE[0], EDGE[1], a0, a0 + Math.PI / 2, ROAD_LINE);
const flat = (layer: GroundLayer, group: GroupId, id: string, name: string, w: number, h: number, marks: Mark[], cells?: Cell[]): ObjectDef =>
  ({ kind: 'object', group, id, name, w, h, parts: [], marks, layer, ...(cells ? { cells } : {}) });

// Road pieces of a width: one tile long straights (with the +y side, or both sides, dashed where a
// bay opens off them), a junction square with edge lines turning its open corners, and a road end
// with rounded corners
const edgeLine = (y0: number, y1: number, dashed: boolean): Mark => (dashed ? rectMark(0.25, y0, 0.75, y1, ROAD_LINE) : rectMark(0, y0, 1, y1, ROAD_LINE));
const straight = (width: number, dashed: 0 | 1 | 2 = 0): Mark[] => [
  rectMark(0, 0, 1, width, ASPHALT),
  edgeLine(EDGE[0], EDGE[1], dashed === 2),
  edgeLine(width - EDGE[1], width - EDGE[0], dashed >= 1),
  ...laneLines(width).map(({ at, dashed: d }) => edgeLine(at - LINE / 2, at + LINE / 2, d)),
];
// A junction of w along x by h along y. `closedTop` keeps the edge line along y = 0 (a T); the open
// corners get small curves joining the edge lines of the roads that meet there.
const junction = (w: number, h: number, closedTop: boolean): Mark[] => [
  rectMark(0, 0, w, h, ASPHALT),
  ...(closedTop ? [rectMark(0, EDGE[0], w, EDGE[1], ROAD_LINE)] : [cornerLine(0, 0, 0), cornerLine(w, 0, 0.5 * Math.PI)]),
  cornerLine(w, h, Math.PI),
  cornerLine(0, h, 1.5 * Math.PI),
];
// Points along an arc about (cx, cy) of radius r from angle a0 to a1
const arcPoints = (cx: number, cy: number, r: number, a0: number, a1: number, n = 8): MarkPoint[] =>
  Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos(a0 + ((a1 - a0) * i) / n), cy + r * Math.sin(a0 + ((a1 - a0) * i) / n)]);
// The end of a road: one tile long, its far corners rounded with radius r, the edge lines following
const roadEnd = (width: number, r: number): Mark[] => {
  const a = Math.PI / 2;
  return [
    { pts: [[0, 0], ...arcPoints(1 - r, r, r, -a, 0), ...arcPoints(1 - r, width - r, r, 0, a), [0, width]], color: ASPHALT },
    rectMark(0, EDGE[0], 1 - r, EDGE[1], ROAD_LINE),
    sector(1 - r, r, r - EDGE[1], r - EDGE[0], -a, 0, ROAD_LINE),
    rectMark(1 - EDGE[1], r, 1 - EDGE[0], width - r, ROAD_LINE),
    sector(1 - r, width - r, r - EDGE[1], r - EDGE[0], 0, a, ROAD_LINE),
    rectMark(0, width - EDGE[1], 1 - r, width - EDGE[0], ROAD_LINE),
  ];
};
const wideSharp = curve(WIDE, 1);
const wideGentle = curve(WIDE, 4);
const narrowSharp = curve(NARROW, 1);
const narrowGentle = curve(NARROW, 4);


// Sports court markings (#33): white lines only, painted over whatever floor is under them (a court
// floor, the gym floor, asphalt, grass). A real court is 28 by 15 m; here it is 12 by 6 tiles, so lengths
// along the court scale by CX and across by CY, and circles by CR (between the two). The court runs along
// x; its baskets sit on the center line (y = 3) at each end.
const CX = 12 / 28, CY = 6 / 15, CR = 0.41, CL = 0.07;
const courtEnd = (bx: number, dir: 1 | -1): Mark[] => {
  const x = (m: number) => bx + dir * m * CX;
  const [k0, k1] = [Math.min(x(0), x(5.8)), Math.max(x(0), x(5.8))];
  const [kTop, kBot] = [(7.5 - 2.45) * CY, (7.5 + 2.45) * CY];
  const ft = x(5.8);
  // the three-point line: straight along each side, 0.9 m in, then an arc about the basket
  const bk = x(1.575), r = 6.75 * CR, side = 0.9 * CY, ang = Math.asin((3 - side) / r);
  const xs = bk + dir * Math.cos(ang) * r;
  const [c0, c1] = [Math.min(x(0), xs), Math.max(x(0), xs)];
  const face = dir > 0 ? 0 : Math.PI; // toward the middle of the court
  return [
    rectMark(k0, kTop, k1, kTop + CL, ROAD_LINE),
    rectMark(k0, kBot - CL, k1, kBot, ROAD_LINE),
    rectMark(ft - CL / 2, kTop, ft + CL / 2, kBot, ROAD_LINE),
    sector(ft, 3, 1.8 * CR - CL / 2, 1.8 * CR + CL / 2, face - Math.PI / 2, face + Math.PI / 2, ROAD_LINE),
    rectMark(c0, side - CL / 2, c1, side + CL / 2, ROAD_LINE),
    rectMark(c0, 6 - side - CL / 2, c1, 6 - side + CL / 2, ROAD_LINE),
    sector(bk, 3, r - CL / 2, r + CL / 2, face - ang, face + ang, ROAD_LINE),
  ];
};
// the outline of a court l long and 6 wide
const courtOutline = (l: number): Mark[] => [
  rectMark(0, 0, l, CL, ROAD_LINE), rectMark(0, 6 - CL, l, 6, ROAD_LINE),
  rectMark(0, 0, CL, 6, ROAD_LINE), rectMark(l - CL, 0, l, 6, ROAD_LINE),
];
// Mini soccer (#34): the same 12 by 6 as the basketball court; its lines are a small pitch's scaled by
// 3/4 (penalty box 2.5 deep, goal box 1, penalty spot 2, center circle 1.4, corner arcs 0.4)
const SK = 0.75;
const NET = 0xd6d9de;
const soccerEnd = (bx: number, dir: 1 | -1): Mark[] => {
  const box = (depth: number, half: number): Mark[] => {
    const x1 = bx + dir * depth;
    const [a, b] = [Math.min(bx, x1), Math.max(bx, x1)];
    return [rectMark(a, 3 - half, b, 3 - half + CL, ROAD_LINE), rectMark(a, 3 + half - CL, b, 3 + half, ROAD_LINE), rectMark(x1 - CL / 2, 3 - half, x1 + CL / 2, 3 + half, ROAD_LINE)];
  };
  const spotX = bx + dir * 2 * SK, r = 1.2 * SK;
  // the arc outside the penalty box, about the penalty spot: it starts on the box's front line
  const ang = Math.acos((2.5 * SK - 2 * SK) / r), face = dir > 0 ? 0 : Math.PI;
  return [
    ...box(2.5 * SK, 2.5 * SK),
    ...box(1 * SK, 1.5 * SK),
    sector(spotX, 3, 0, 0.07, 0, Math.PI * 2, ROAD_LINE),
    sector(spotX, 3, r - CL / 2, r + CL / 2, face - ang, face + ang, ROAD_LINE),
  ];
};
const corner = (x: number, y: number, a: number): Mark => sector(x, y, 0.3 - CL / 2, 0.3 + CL / 2, a, a + Math.PI / 2, ROAD_LINE);

const COURTS: readonly ObjectDef[] = [
  flat('marking', 'courts', 'basketball-court', 'Basketball court', 12, 6, [
    ...courtOutline(12),
    rectMark(6 - CL / 2, 0, 6 + CL / 2, 6, ROAD_LINE),
    sector(6, 3, 1.8 * CR - CL / 2, 1.8 * CR + CL / 2, 0, Math.PI * 2, ROAD_LINE),
    ...courtEnd(0, 1),
    ...courtEnd(12, -1),
  ]),
  // half a court: one end, and half the center circle on its far line
  flat('marking', 'courts', 'half-basketball-court', 'Half court', 6, 6, [
    ...courtOutline(6),
    sector(6, 3, 1.8 * CR - CL / 2, 1.8 * CR + CL / 2, Math.PI / 2, Math.PI * 1.5, ROAD_LINE),
    ...courtEnd(0, 1),
  ]),
  flat('marking', 'courts', 'mini-soccer-court', 'Mini soccer court', 12, 6, [
    ...courtOutline(12),
    rectMark(6 - CL / 2, 0, 6 + CL / 2, 6, ROAD_LINE),
    sector(6, 3, 1.4 * SK - CL / 2, 1.4 * SK + CL / 2, 0, Math.PI * 2, ROAD_LINE),
    sector(6, 3, 0, 0.08, 0, Math.PI * 2, ROAD_LINE),
    ...soccerEnd(0, 1),
    ...soccerEnd(12, -1),
    corner(0, 0, 0), corner(12, 0, Math.PI / 2), corner(12, 6, Math.PI), corner(0, 6, Math.PI * 1.5),
  ]),
];


const ITEMS: readonly CatalogItem[] = [
  // Scenery: decor
  obj('decor', 'crate', 'Crate', 1, 1, [box(0.15, 0.15, 0.7, 0.7, 0, 22, 0xb7791f)]),
  obj('decor', 'rock', 'Rock', 1, 1, [pyr(0.15, 0.2, 0.7, 0.6, 0, 16, 0x9ca3af), pyr(0.5, 0.45, 0.35, 0.35, 0, 9, 0x6b7280)]),
  obj('outdoor', 'bench', 'Park bench', 2, 1, [
    box(0.25, 0.35, 0.15, 0.3, 0, 8, 0x57534e),
    box(1.6, 0.35, 0.15, 0.3, 0, 8, 0x57534e),
    box(0.15, 0.3, 1.7, 0.4, 8, 5, 0xa16207),
  ]),
  obj('outdoor', 'picnic-table', 'Picnic table', 2, 1, [
    // benches on both long sides of the table, all one piece
    box(0.25, 0.08, 0.08, 0.14, 0, 7, 0x8b5a2b),
    box(1.67, 0.08, 0.08, 0.14, 0, 7, 0x8b5a2b),
    box(0.15, 0.05, 1.7, 0.2, 7, 2, 0xb7794b),
    box(0.3, 0.4, 0.08, 0.2, 0, 14, 0x8b5a2b),
    box(1.62, 0.4, 0.08, 0.2, 0, 14, 0x8b5a2b),
    box(0.05, 0.28, 1.9, 0.44, 14, 2, 0xb7794b),
    box(0.25, 0.78, 0.08, 0.14, 0, 7, 0x8b5a2b),
    box(1.67, 0.78, 0.08, 0.14, 0, 7, 0x8b5a2b),
    box(0.15, 0.75, 1.7, 0.2, 7, 2, 0xb7794b),
  ]),
  obj('outdoor', 'stone-bench', 'Stone bench', 2, 1, [
    box(0.2, 0.35, 0.25, 0.3, 0, 8, 0x78716c),
    box(1.55, 0.35, 0.25, 0.3, 0, 8, 0x78716c),
    box(0.1, 0.3, 1.8, 0.4, 8, 4, 0xa8a29e),
  ]),
  obj('outdoor', 'wooden-bench', 'Wooden bench', 2, 1, [
    // a traditional slatted bench: back posts and slats first, then legs, seat slats, armrests
    box(0.15, 0.24, 0.1, 0.07, 8, 18, 0x6b3e1f),
    box(1.75, 0.24, 0.1, 0.07, 8, 18, 0x6b3e1f),
    box(0.25, 0.26, 1.5, 0.04, 14, 3, 0x9a5b2b),
    box(0.25, 0.26, 1.5, 0.04, 20, 3, 0x9a5b2b),
    box(0.15, 0.31, 0.1, 0.4, 0, 8, 0x6b3e1f),
    box(1.75, 0.31, 0.1, 0.4, 0, 8, 0x6b3e1f),
    ...[0.32, 0.45, 0.58].map((y) => box(0.15, y, 1.7, 0.11, 8, 2, 0x9a5b2b)),
    box(0.12, 0.3, 0.16, 0.44, 15, 2, 0x6b3e1f),
    box(1.72, 0.3, 0.16, 0.44, 15, 2, 0x6b3e1f),
  ]),
  obj('outdoor', 'umbrella-table', 'Umbrella table', 2, 2, [
    cyl(0.2, 0.75, 0.38, 0.38, 0, 7, 0xf5f5f4), // far chairs: round seats with a back
    box(0.18, 0.82, 0.05, 0.24, 7, 9, 0xe7e5e4),
    cyl(0.75, 0.2, 0.38, 0.38, 0, 7, 0xf5f5f4),
    box(0.82, 0.18, 0.24, 0.05, 7, 9, 0xe7e5e4),
    cyl(0.94, 0.94, 0.12, 0.12, 0, 12, 0x374151), // table: pedestal and round top
    cyl(0.55, 0.55, 0.9, 0.9, 12, 2, 0xf5f5f4),
    cyl(0.97, 0.97, 0.06, 0.06, 14, 30, 0xd6d3d1), // pole
    cyl(1.42, 0.81, 0.38, 0.38, 0, 7, 0xf5f5f4), // near chair
    box(1.77, 0.88, 0.05, 0.24, 7, 9, 0xe7e5e4),
    cone(0.12, 0.12, 1.76, 1.76, 42, 10, 0xdc2626), // umbrella
    cyl(0.96, 0.96, 0.08, 0.08, 52, 3, 0xf5f5f4), // finial
  ]),
  obj('outdoor', 'park-bin', 'Park bin', 1, 1, [
    box(0.32, 0.32, 0.36, 0.36, 0, 18, 0x166534),
    box(0.32, 0.68, 0.36, 0.01, 5, 2, 0x14532d),
    box(0.32, 0.68, 0.36, 0.01, 12, 2, 0x14532d),
    box(0.3, 0.3, 0.4, 0.4, 18, 3, 0x14532d), // lid
    box(0.4, 0.4, 0.2, 0.2, 21, 2, 0x14532d),
  ]),
  obj('outdoor', 'bird-bath', 'Bird bath', 1, 1, [
    box(0.42, 0.42, 0.16, 0.16, 0, 12, 0xa8a29e),
    box(0.25, 0.25, 0.5, 0.5, 12, 4, 0xd6d3d1),
    box(0.3, 0.3, 0.4, 0.4, 14, 2.5, 0x7dd3fc),
  ]),
  obj('outdoor', 'small-bench', 'Small bench', 1, 1, [
    box(0.2, 0.35, 0.1, 0.3, 0, 8, 0x57534e),
    box(0.7, 0.35, 0.1, 0.3, 0, 8, 0x57534e),
    box(0.12, 0.3, 0.76, 0.4, 8, 5, 0xa16207),
  ]),
  obj('outdoor', 'small-table', 'Small table', 1, 1, [
    box(0.2, 0.2, 0.08, 0.08, 0, 14, 0x8b5a2b),
    box(0.72, 0.2, 0.08, 0.08, 0, 14, 0x8b5a2b),
    box(0.2, 0.72, 0.08, 0.08, 0, 14, 0x8b5a2b),
    box(0.72, 0.72, 0.08, 0.08, 0, 14, 0x8b5a2b),
    box(0.15, 0.15, 0.7, 0.7, 14, 2, 0xb7794b),
  ]),

  // Scenery: garden (flowers first, parts listed back to front)
  obj('garden', 'flowerbed', 'Flower bed', 1, 1, [
    box(0.1, 0.1, 0.8, 0.8, 0, 6, 0x78350f),
    box(0.2, 0.2, 0.15, 0.15, 6, 7, 0xf472b6),
    box(0.6, 0.25, 0.15, 0.15, 6, 7, 0xfacc15),
    box(0.3, 0.6, 0.15, 0.15, 6, 7, 0xf87171),
    box(0.65, 0.65, 0.15, 0.15, 6, 7, 0xa78bfa),
  ]),
  obj('garden', 'tulips', 'Tulips', 1, 1, [
    ...flower(0.25, 0.3, 10, 0xef4444, 0.12),
    ...flower(0.6, 0.25, 12, 0xfacc15, 0.12),
    ...flower(0.3, 0.65, 11, 0xec4899, 0.12),
    ...flower(0.65, 0.6, 9, 0xf97316, 0.12),
  ]),
  obj('garden', 'flower-pot', 'Flower pot', 1, 1, [
    box(0.3, 0.3, 0.4, 0.4, 0, 12, 0xc2410c),
    box(0.33, 0.33, 0.34, 0.34, 12, 2, 0x422006),
    // grow from the soil, not the ground; offset along one grid axis so they stay side by side on screen
    // whichever way the pot is turned
    ...flower(0.39, 0.5, 9, 0xf472b6, 0.1, 14),
    ...flower(0.61, 0.5, 7, 0xfacc15, 0.1, 14),
  ]),
  obj('garden', 'sunflowers', 'Sunflowers', 1, 1, [
    ...flower(0.3, 0.42, 28, 0xfacc15, 0.2),
    ...flower(0.66, 0.52, 22, 0xfacc15, 0.2),
  ]),
  // A rose arch to walk under: white lattice sides wrapped in vines, a white arch with leaves and roses on top
  obj('garden', 'rose-arch', 'Rose arch', 2, 1, (() => {
    const steps = archSteps(0.2, 1.8, 0.36, 0.28, 30, 18, 4, 0xf5f5f4);
    return [
      box(0.02, 0.4, 0.06, 0.2, 2, 26, 0x15803d), // vines on the outer sides
      box(1.92, 0.4, 0.06, 0.2, 2, 26, 0x15803d),
      ...[8, 17, 24].flatMap((z) => [box(0.005, 0.44, 0.015, 0.12, z, 3, 0xec4899), box(1.98, 0.44, 0.015, 0.12, z, 3, 0xec4899)]),
      box(0.08, 0.36, 0.12, 0.28, 0, 34, 0xf5f5f4), // lattice sides
      box(1.8, 0.36, 0.12, 0.28, 0, 34, 0xf5f5f4),
      ...steps.map((st) => st.part),
      ...steps.map((st, i) =>
        i % 2 === 0
          ? box(st.x0, 0.38, st.x1 - st.x0, 0.24, st.top, 3, 0x16a34a)
          : box(st.x0 + 0.03, 0.42, st.x1 - st.x0 - 0.06, 0.16, st.top, 4, 0xec4899),
      ),
    ];
  })()),
  // A wooden pergola arch: four posts, two beams along it and rafters across
  obj('garden', 'wooden-arch', 'Wooden arch', 2, 1, [
    box(0.1, 0.22, 0.1, 0.1, 0, 36, 0x8b5a2b),
    box(1.8, 0.22, 0.1, 0.1, 0, 36, 0x8b5a2b),
    box(0.1, 0.68, 0.1, 0.1, 0, 36, 0x8b5a2b),
    box(1.8, 0.68, 0.1, 0.1, 0, 36, 0x8b5a2b),
    box(0.04, 0.21, 1.92, 0.12, 36, 4, 0xa0693a),
    box(0.04, 0.67, 1.92, 0.12, 36, 4, 0xa0693a),
    ...[0.15, 0.48, 0.81, 1.14, 1.47, 1.8].map((x) => box(x, 0.12, 0.06, 0.76, 40, 3, 0xb7794b)),
  ]),
  obj('garden', 'floral-clock', 'Floral clock', 1, 1, floralClock()),
  // A dolphin leaping from a wave, on a stone plinth: tail low at the back, back arched up with a
  // dorsal fin, head coming down at the front (+x), held up by a rod in the middle of the wave
  obj('garden', 'dolphin-statue', 'Dolphin statue', 1, 1, [
    box(0.18, 0.18, 0.64, 0.64, 0, 4, STONE_DARK),
    box(0.22, 0.22, 0.56, 0.56, 4, 8, STONE),
    box(0.34, 0.3, 0.32, 0.4, 12, 6, 0x93c5fd), // the wave
    box(0.36, 0.34, 0.28, 0.32, 18, 2, 0xdbeafe), // foam
    box(0.47, 0.47, 0.06, 0.06, 20, 7, STONE_DARK), // the rod
    box(0.12, 0.3, 0.08, 0.4, 20, 3, 0x64748b), // tail flukes
    box(0.2, 0.44, 0.12, 0.12, 21, 7, 0x64748b),
    box(0.32, 0.41, 0.12, 0.18, 25, 9, 0x64748b),
    box(0.44, 0.4, 0.14, 0.2, 27, 10, 0x64748b), // the top of the arc
    box(0.48, 0.48, 0.06, 0.04, 37, 5, 0x475569), // dorsal fin
    box(0.58, 0.41, 0.12, 0.18, 25, 9, 0x64748b),
    box(0.7, 0.43, 0.08, 0.14, 22, 7, 0x64748b), // head
    box(0.78, 0.47, 0.06, 0.06, 22, 3, 0x64748b), // beak
  ]),
  // An owl on a plinth: round body and head, ear tufts on both sides, and on the front (+x) a pale
  // face disc with big amber eyes, a beak and a pale belly
  obj('garden', 'owl-statue', 'Owl statue', 1, 1, [
    box(0.2, 0.2, 0.6, 0.6, 0, 4, STONE_DARK),
    box(0.25, 0.25, 0.5, 0.5, 4, 8, STONE),
    cyl(0.3, 0.3, 0.4, 0.4, 12, 15, 0x8b7355),
    cyl(0.29, 0.29, 0.4, 0.4, 27, 12, 0x9c8463),
    box(0.4, 0.31, 0.08, 0.07, 39, 6, 0x8b7355), // ear tufts
    box(0.4, 0.6, 0.08, 0.07, 39, 6, 0x8b7355),
    box(0.7, 0.4, 0.02, 0.2, 14, 11, 0xd6c7a1), // belly
    box(0.69, 0.33, 0.02, 0.32, 28, 10, 0xe7dcc0), // face disc
    box(0.71, 0.36, 0.02, 0.11, 31, 6, 0xfbbf24), // eyes
    box(0.71, 0.51, 0.02, 0.11, 31, 6, 0xfbbf24),
    box(0.73, 0.39, 0.012, 0.05, 32, 4, 0x1c1917),
    box(0.73, 0.54, 0.012, 0.05, 32, 4, 0x1c1917),
    box(0.71, 0.475, 0.035, 0.05, 28, 3, 0xd97706), // beak
  ]),
  obj('waterside', 'pond', 'Pond', 2, 2, [
    box(0.1, 0.1, 1.8, 1.8, 0, 3, 0xa8a29e),
    box(0.25, 0.25, 1.5, 1.5, 0, 4, 0x38bdf8),
  ]),

  // Trees
  // Trees vary in height against a wall (56px, one storey): small ornamentals around 1.2 storeys,
  // everyday trees about 1.5, the tallest about 2. Crowns fill nearly the whole tile so they read full.
  obj('trees', 'pine', 'Pine', 1, 1, [
    cyl(0.44, 0.44, 0.12, 0.12, 0, 14, 0x7c4a1e),
    ...pine(0.5, 0.5, 0.46, 10, 76, 0x15803d, 0x16a34a),
  ]),
  obj('trees', 'tall-pine', 'Tall pine', 1, 1, [
    cyl(0.44, 0.44, 0.12, 0.12, 0, 20, 0x7c4a1e),
    ...pine(0.5, 0.5, 0.44, 16, 102, 0x166534, 0x15803d),
  ]),
  obj('trees', 'oak', 'Round tree', 1, 1, [
    cyl(0.43, 0.43, 0.14, 0.14, 0, 40, 0x7c4a1e),
    ...crown(0.5, 0.5, 0.46, 36, 0x16a34a, 0x22c55e, 0x4ade80),
  ]),
  obj('trees', 'birch', 'Birch', 1, 1, [
    cyl(0.45, 0.45, 0.1, 0.1, 0, 64, 0xf5f5f4),
    box(0.45, 0.54, 0.1, 0.01, 10, 2, 0x1f2937), // bark marks
    box(0.45, 0.54, 0.1, 0.01, 22, 2, 0x1f2937),
    box(0.45, 0.54, 0.1, 0.01, 34, 2, 0x1f2937),
    box(0.45, 0.54, 0.1, 0.01, 46, 2, 0x1f2937),
    ...crown(0.5, 0.5, 0.36, 60, 0x65a30d, 0x84cc16, 0xa3e635),
  ]),
  obj('trees', 'palm', 'Palm', 1, 1, [
    cyl(0.46, 0.46, 0.08, 0.08, 0, 30, 0x92400e), // trunk, slimmer toward the top
    cyl(0.465, 0.465, 0.07, 0.07, 30, 30, 0xa16207),
    cyl(0.47, 0.47, 0.06, 0.06, 60, 30, 0x92400e),
    box(0.0, 0.43, 1.0, 0.14, 86, 3, 0x16a34a), // fronds
    box(0.43, 0.0, 0.14, 1.0, 87, 3, 0x22c55e),
    box(0.15, 0.15, 0.7, 0.7, 88, 1, 0x15803d),
    cyl(0.38, 0.38, 0.24, 0.24, 88, 6, 0x166534),
    cyl(0.42, 0.56, 0.08, 0.08, 82, 5, 0x78350f), // coconuts
    cyl(0.55, 0.44, 0.08, 0.08, 82, 5, 0x78350f),
  ]),
  obj('trees', 'cherry-blossom', 'Cherry blossom', 1, 1, [
    cyl(0.43, 0.43, 0.14, 0.14, 0, 26, 0x5b3a29),
    ...crown(0.5, 0.5, 0.48, 22, 0xf472b6, 0xf9a8d4, 0xfbcfe8),
  ]),
  obj('trees', 'maple', 'Maple', 1, 1, [
    cyl(0.43, 0.43, 0.14, 0.14, 0, 40, 0x5b3a29),
    ...crown(0.5, 0.5, 0.46, 36, 0xc2410c, 0xea580c, 0xf59e0b),
  ]),
  obj('trees', 'cypress', 'Cypress', 1, 1, [
    cyl(0.45, 0.45, 0.1, 0.1, 0, 8, 0x5b3a29),
    cyl(0.3, 0.3, 0.4, 0.4, 6, 70, 0x14532d),
    cyl(0.33, 0.33, 0.34, 0.34, 76, 18, 0x166534),
    cone(0.35, 0.35, 0.3, 0.3, 94, 10, 0x166534),
  ]),
  obj('trees', 'shade-tree', 'Shade tree', 2, 2, [
    // a broad crown up high, so the trunk still shows under it from the camera
    cyl(0.86, 0.86, 0.28, 0.28, 0, 52, 0x6b4423),
    ...crown(1, 1, 0.8, 46, 0x166534, 0x15803d, 0x22c55e),
  ]),

  // Scenery: shrubs
  obj('shrubs', 'bush', 'Bush', 1, 1, [
    box(0.15, 0.15, 0.7, 0.7, 0, 14, 0x16a34a),
    box(0.27, 0.27, 0.46, 0.46, 14, 6, 0x22c55e),
  ]),
  obj('shrubs', 'round-shrub', 'Round shrub', 1, 1, [
    box(0.25, 0.25, 0.5, 0.5, 0, 10, 0x166534),
    box(0.32, 0.32, 0.36, 0.36, 10, 6, 0x22c55e),
  ]),
  obj('shrubs', 'hedge', 'Hedge', 2, 1, [
    box(0.05, 0.2, 1.9, 0.6, 0, 18, 0x15803d),
    box(0.1, 0.25, 1.8, 0.5, 18, 4, 0x16a34a),
  ]),
  obj('shrubs', 'boxwood', 'Boxwood', 1, 1, [
    box(0.2, 0.2, 0.6, 0.6, 0, 16, 0x166534),
    box(0.22, 0.22, 0.56, 0.56, 16, 1, 0x15803d),
  ]),
  obj('shrubs', 'flowering-bush', 'Flowering bush', 1, 1, [
    box(0.15, 0.15, 0.7, 0.7, 0, 14, 0x15803d),
    box(0.25, 0.25, 0.5, 0.5, 14, 5, 0x16a34a),
    ...[[0.2, 0.6], [0.55, 0.2], [0.65, 0.6], [0.4, 0.4]].map(([x = 0, y = 0]) => box(x, y, 0.12, 0.12, 15, 4, 0xf9a8d4)),
  ]),
  obj('shrubs', 'tall-grass', 'Tall grass', 1, 1, [
    ...[[0.2, 0.25, 16], [0.45, 0.2, 20], [0.7, 0.3, 15], [0.3, 0.5, 18], [0.6, 0.55, 21], [0.4, 0.72, 14], [0.7, 0.72, 17]].map(
      ([x = 0, y = 0, h = 0]) => box(x, y, 0.06, 0.06, 0, h, h > 18 ? 0xa3e635 : 0x84cc16),
    ),
  ]),
  obj('shrubs', 'bamboo', 'Bamboo', 1, 1, [
    ...[[0.25, 0.25, 50], [0.55, 0.2, 56], [0.35, 0.5, 46], [0.65, 0.5, 52], [0.45, 0.72, 44]].flatMap(([x = 0, y = 0, h = 0]) => [
      box(x, y, 0.07, 0.07, 0, h, 0x65a30d),
      box(x - 0.08, y - 0.02, 0.23, 0.11, h - 6, 3, 0x4d7c0f), // leaf tuft
    ]),
  ]),
  obj('shrubs', 'topiary', 'Topiary', 1, 1, [
    box(0.3, 0.3, 0.4, 0.4, 0, 8, 0x9a3412),
    box(0.47, 0.47, 0.06, 0.06, 8, 8, 0x7c4a1e),
    box(0.25, 0.25, 0.5, 0.5, 16, 16, 0x15803d),
    box(0.33, 0.33, 0.34, 0.34, 32, 10, 0x22c55e),
  ]),

  // Lamps
  obj('lamps', 'lamp-post', 'Lamp post', 1, 1, [
    box(0.38, 0.38, 0.24, 0.24, 0, 4, 0x334155),
    box(0.45, 0.45, 0.1, 0.1, 4, 50, 0x475569),
    box(0.36, 0.36, 0.28, 0.28, 54, 10, 0xfde047),
  ]),
  obj('lamps', 'lantern', 'Lantern', 1, 1, [
    box(0.3, 0.3, 0.4, 0.4, 0, 6, 0x334155),
    box(0.35, 0.35, 0.3, 0.3, 6, 14, 0xfde047),
    pyr(0.3, 0.3, 0.4, 0.4, 20, 8, 0x334155),
  ]),
  obj('lamps', 'street-lamp', 'Street lamp', 1, 1, [
    box(0.38, 0.38, 0.24, 0.24, 0, 4, 0x334155),
    box(0.45, 0.45, 0.1, 0.1, 4, 56, 0x475569),
    box(0.12, 0.45, 0.76, 0.1, 56, 4, 0x475569),
    box(0.1, 0.4, 0.2, 0.2, 46, 10, 0xfde047),
    box(0.7, 0.4, 0.2, 0.2, 46, 10, 0xfde047),
  ]),
  // A bus stop sign: a pole with a blue plate (a white panel on its face, toward +x) and a route plate under it
  obj('lamps', 'bus-sign', 'Bus pole sign', 1, 1, [
    box(0.38, 0.38, 0.24, 0.24, 0, 3, 0x9ca3af),
    box(0.47, 0.47, 0.06, 0.06, 3, 47, 0x64748b),
    box(0.53, 0.25, 0.04, 0.5, 36, 18, 0x2563eb),
    box(0.57, 0.32, 0.012, 0.36, 39, 12, 0xf8fafc),
    box(0.53, 0.35, 0.04, 0.3, 24, 9, 0xf1f5f9),
  ]),
  // A parking gate: a yellow housing and a red and white boom arm reaching across a lane (along +x),
  // resting on a short post at its tip
  obj('lamps', 'parking-gate', 'Parking gate', 3, 1, [
    box(0.1, 0.3, 0.35, 0.4, 0, 22, 0xfacc15),
    box(0.08, 0.28, 0.39, 0.44, 22, 2, 0x334155),
    box(2.75, 0.44, 0.1, 0.12, 0, 15, 0x9ca3af),
    ...Array.from({ length: 10 }, (_, i) => box(0.45 + i * 0.25, 0.46, 0.25, 0.08, 16, 3, i % 2 === 0 ? 0xdc2626 : 0xf8fafc)),
  ]),

  // Waterside (parts listed back to front, bottom to top)
  obj('waterside', 'footbridge', 'Footbridge', 1, 3, [
    // an arch built from five deck steps, each with a rail on both sides
    ...[2, 5, 8, 5, 2].flatMap((top, i) => {
      const y = i * 0.6;
      return [
        box(0.1, y, 0.06, 0.6, top, 9, 0x78350f), // far rail
        box(0.12, y, 0.76, 0.6, top - 3, 3, 0xa16207), // deck
        box(0.84, y, 0.06, 0.6, top, 9, 0x78350f), // near rail
      ];
    }),
  ]),
  obj('waterside', 'lily-pads', 'Lily pads', 1, 1, [
    box(0.15, 0.2, 0.3, 0.28, 0, 1, 0x15803d),
    box(0.55, 0.15, 0.25, 0.25, 0, 1, 0x16a34a),
    box(0.35, 0.55, 0.32, 0.3, 0, 1, 0x15803d),
    box(0.45, 0.63, 0.12, 0.12, 1, 4, 0xf9a8d4), // flower
  ]),
  obj('waterside', 'reeds', 'Reeds', 1, 1, [
    ...[[0.2, 0.25, 26], [0.5, 0.2, 32], [0.35, 0.5, 22], [0.65, 0.45, 28], [0.5, 0.7, 24]].flatMap(([x = 0, y = 0, h = 0]) => [
      box(x, y, 0.06, 0.06, 0, h, 0x65a30d),
      box(x - 0.01, y - 0.01, 0.08, 0.08, h - 8, 6, 0x78350f), // cattail head
    ]),
  ]),
  obj('waterside', 'stepping-stones', 'Stepping stones', 1, 1, [
    box(0.1, 0.12, 0.26, 0.24, 0, 3, 0x9ca3af),
    box(0.4, 0.4, 0.24, 0.22, 0, 3, 0xa8a29e),
    box(0.66, 0.68, 0.24, 0.24, 0, 3, 0x9ca3af),
  ]),
  obj('waterside', 'rowboat', 'Rowboat', 1, 2, [
    box(0.28, 0.2, 0.44, 1.6, 0, 7, 0x92400e), // hull
    box(0.34, 0.28, 0.32, 1.44, 4, 3, 0x451a03), // inside
    box(0.28, 0.85, 0.44, 0.12, 7, 2, 0xb45309), // seat
    box(0.1, 0.9, 0.18, 0.04, 6, 1, 0xd6b38a), // oars
    box(0.72, 0.9, 0.18, 0.04, 6, 1, 0xd6b38a),
  ]),
  obj('waterside', 'duck', 'Duck', 1, 1, [
    box(0.36, 0.4, 0.3, 0.2, 1, 6, 0xf8fafc), // body
    box(0.36, 0.42, 0.08, 0.16, 5, 4, 0xe5e7eb), // tail
    box(0.58, 0.44, 0.12, 0.12, 7, 6, 0x166534), // head
    box(0.7, 0.47, 0.08, 0.06, 9, 2, 0xf59e0b), // beak
  ]),
  obj('waterside', 'fountain', 'Fountain', 2, 2, [
    box(0.1, 0.1, 1.8, 1.8, 0, 6, 0xa8a29e), // basin rim
    box(0.22, 0.22, 1.56, 1.56, 0, 7, 0x38bdf8), // water
    box(0.85, 0.85, 0.3, 0.3, 7, 16, 0x9ca3af), // pillar
    box(0.65, 0.65, 0.7, 0.7, 23, 3, 0xa8a29e), // upper bowl
    box(0.72, 0.72, 0.56, 0.56, 24, 3, 0x7dd3fc),
    box(0.94, 0.94, 0.12, 0.12, 26, 10, 0xbae6fd), // spout
  ]),

  // Scenery: sports (#33). A basketball hoop, 1 by 2 so it sits on a court's center line: a post on the
  // baseline at the back (-x), an arm reaching over the court, a white backboard facing +x, and an orange
  // rim with a white net hanging under it. Sized to the small 12 by 6 court rather than to real meters.
  obj('sports', 'basketball-hoop', 'Basketball hoop', 1, 2, [
    box(0.04, 0.84, 0.2, 0.32, 0, 2, 0x4b5563),
    box(0.09, 0.94, 0.1, 0.12, 2, 23, 0x5b6470),
    box(0.19, 0.96, 0.33, 0.08, 20, 2, 0x5b6470),
    box(0.52, 0.62, 0.04, 0.76, 15, 11, 0xf4f4f0),
    box(0.6, 0.94, 0.14, 0.12, 9, 6, 0xe5e7eb),
    box(0.56, 0.9, 0.22, 0.03, 15, 1, 0xe0662a),
    box(0.56, 1.07, 0.22, 0.03, 15, 1, 0xe0662a),
    box(0.75, 0.9, 0.03, 0.2, 15, 1, 0xe0662a),
  ]),

  // A soccer goal (#34), 1 by 2 so it sits on a 6-deep pitch's center line. It stands behind the goal
  // line with its mouth facing +x: white posts and crossbar at the front edge, and a net reaching back into
  // the tile drawn as strands only (solid panels read as a walled pen), lower at the back as a real net
  // slopes, and open on top.
  obj('sports', 'soccer-goal', 'Soccer goal', 1, 2, [
    // the net: strands only, so the grass shows through. Back (11 high), then each side stepping up from
    // 11 at the back to 14 at the front, with a strand along the middle height of each
    ...[0.22, 0.48, 0.74, 1.0, 1.26, 1.52, 1.76].map((y) => box(0.22, y, 0.02, 0.02, 0, 11, NET)),
    box(0.22, 0.22, 0.02, 1.56, 5.5, 0.4, NET),
    box(0.22, 0.22, 0.02, 1.56, 10.6, 0.4, NET),
    ...[0.22, 1.76].flatMap((y) => [
      box(0.42, y, 0.02, 0.02, 0, 11, NET),
      box(0.62, y, 0.02, 0.02, 0, 14, NET),
      box(0.24, y, 0.36, 0.02, 10.6, 0.4, NET),
      box(0.6, y, 0.32, 0.02, 13.6, 0.4, NET),
      box(0.24, y, 0.68, 0.02, 5.5, 0.4, NET),
    ]),
    // white posts and crossbar on the goal line
    box(0.92, 0.18, 0.07, 0.07, 0, 16, 0xf4f4f0),
    box(0.92, 1.75, 0.07, 0.07, 0, 16, 0xf4f4f0),
    box(0.92, 0.18, 0.07, 1.64, 15, 1, 0xf4f4f0),
  ]),

  // Furniture: office (parts listed back to front, bottom to top)
  obj('office', 'office-desk', 'Office desk', 2, 1, [
    box(0.08, 0.2, 0.1, 0.6, 0, 16, 0x57534e),
    box(1.82, 0.2, 0.1, 0.6, 0, 16, 0x57534e),
    box(0.05, 0.15, 1.9, 0.7, 16, 3, 0xa8a29e),
    box(0.95, 0.3, 0.1, 0.1, 19, 4, 0x374151), // monitor stand
    box(0.75, 0.26, 0.5, 0.06, 23, 14, 0x1f2937), // monitor
  ]),
  obj('office', 'office-chair', 'Office chair', 1, 1, [
    box(0.32, 0.32, 0.36, 0.36, 0, 3, 0x1f2937),
    box(0.46, 0.46, 0.08, 0.08, 3, 9, 0x374151),
    box(0.25, 0.25, 0.5, 0.5, 12, 4, 0x1e40af),
    box(0.25, 0.2, 0.5, 0.08, 16, 16, 0x1e3a8a),
  ]),
  obj('office', 'filing-cabinet', 'Filing cabinet', 1, 1, [
    box(0.2, 0.2, 0.6, 0.5, 0, 36, 0x9ca3af),
    box(0.3, 0.7, 0.4, 0.02, 6, 3, 0x4b5563),
    box(0.3, 0.7, 0.4, 0.02, 18, 3, 0x4b5563),
    box(0.3, 0.7, 0.4, 0.02, 30, 3, 0x4b5563),
  ]),
  obj('office', 'printer', 'Printer', 1, 1, [
    box(0.2, 0.25, 0.6, 0.5, 0, 14, 0xe5e7eb),
    box(0.25, 0.3, 0.5, 0.35, 14, 3, 0x374151),
    box(0.3, 0.72, 0.4, 0.06, 6, 2, 0xf8fafc), // paper tray
  ]),
  obj('office', 'water-cooler', 'Water cooler', 1, 1, [
    box(0.3, 0.3, 0.4, 0.4, 0, 24, 0xe5e7eb),
    box(0.33, 0.33, 0.34, 0.34, 24, 16, 0x7dd3fc),
  ]),

  // Furniture: canteen
  obj('canteen', 'dining-table', 'Dining table', 2, 1, [
    box(0.15, 0.25, 0.1, 0.5, 0, 14, 0x78716c),
    box(1.75, 0.25, 0.1, 0.5, 0, 14, 0x78716c),
    box(0.1, 0.2, 1.8, 0.6, 14, 3, 0xd6d3d1),
  ]),
  obj('canteen', 'canteen-bench', 'Canteen bench', 2, 1, [
    box(0.2, 0.4, 0.1, 0.2, 0, 8, 0x57534e),
    box(1.7, 0.4, 0.1, 0.2, 0, 8, 0x57534e),
    box(0.1, 0.35, 1.8, 0.3, 8, 3, 0x0e7490),
  ]),
  obj('canteen', 'stool', 'Stool', 1, 1, [
    box(0.43, 0.43, 0.14, 0.14, 0, 11, 0x6b7280),
    box(0.3, 0.3, 0.4, 0.4, 11, 3, 0xdc2626),
  ]),
  obj('canteen', 'counter', 'Counter', 2, 1, [
    box(0.05, 0.15, 1.9, 0.75, 0, 22, 0xa8a29e),
    box(0, 0.1, 2, 0.85, 22, 3, 0xf5f5f4),
  ]),
  obj('canteen', 'vending-machine', 'Vending machine', 1, 1, [
    box(0.15, 0.25, 0.7, 0.6, 0, 46, 0xdc2626),
    box(0.22, 0.85, 0.42, 0.02, 18, 22, 0x7dd3fc), // window
    box(0.7, 0.85, 0.1, 0.02, 24, 10, 0x1f2937), // buttons
  ]),
  obj('canteen', 'buffet-table', 'Buffet table', 3, 1, [
    box(0.05, 0.2, 2.9, 0.6, 0, 16, 0x9ca3af),
    box(0, 0.15, 3, 0.7, 16, 2, 0xd1d5db),
    ...[0.15, 0.85, 1.55, 2.25].map((x, i) => box(x, 0.3, 0.6, 0.4, 18, 3, [0xf59e0b, 0x16a34a, 0xdc2626, 0xfde68a][i] ?? 0)), // food trays
    box(0.05, 0.75, 0.04, 0.04, 18, 14, 0x6b7280), // sneeze guard: posts at both ends, glass on top
    box(2.91, 0.75, 0.04, 0.04, 18, 14, 0x6b7280),
    box(0.05, 0.75, 2.9, 0.04, 30, 2, 0xbae6fd),
  ]),
  obj('canteen', 'trash-bins', 'Trash bins', 1, 1, [
    box(0.1, 0.3, 0.38, 0.4, 0, 22, 0x4b5563), // general waste
    box(0.52, 0.3, 0.38, 0.4, 0, 22, 0x15803d), // recycling
    box(0.08, 0.28, 0.42, 0.44, 22, 3, 0x374151),
    box(0.5, 0.28, 0.42, 0.44, 22, 3, 0x166534),
  ]),

  // Furniture: lab
  obj('lab', 'lab-bench', 'Lab bench', 2, 1, [
    box(0.05, 0.15, 1.9, 0.7, 0, 18, 0xe5e7eb),
    box(0, 0.1, 2, 0.8, 18, 3, 0x1f2937),
  ]),
  obj('lab', 'fume-hood', 'Fume hood', 2, 1, [
    box(0.05, 0.2, 1.9, 0.7, 0, 18, 0xd1d5db),
    box(0.05, 0.2, 1.9, 0.35, 18, 28, 0x9ca3af), // solid back half
    box(0.05, 0.55, 1.9, 0.3, 18, 28, 0xbae6fd), // glass sash at the front
    box(0.05, 0.2, 1.9, 0.65, 46, 6, 0x9ca3af),
  ]),
  obj('lab', 'chemical-shelf', 'Chemical shelf', 1, 1, [
    box(0.15, 0.15, 0.7, 0.35, 0, 40, 0xf3f4f6),
    box(0.22, 0.25, 0.12, 0.12, 40, 9, 0x22c55e),
    box(0.44, 0.25, 0.12, 0.12, 40, 7, 0xa855f7),
    box(0.66, 0.25, 0.12, 0.12, 40, 10, 0xf97316),
  ]),
  obj('lab', 'lab-sink', 'Lab sink', 1, 1, [
    box(0.15, 0.2, 0.7, 0.6, 0, 18, 0xe5e7eb),
    box(0.25, 0.3, 0.5, 0.4, 18, 2, 0x94a3b8),
    box(0.47, 0.22, 0.06, 0.06, 20, 10, 0x6b7280),
  ]),
  obj('lab', 'lab-stool', 'Lab stool', 1, 1, [
    box(0.43, 0.43, 0.14, 0.14, 0, 13, 0x9ca3af),
    box(0.3, 0.3, 0.4, 0.4, 13, 3, 0x1d4ed8),
  ]),

  // Furniture: class
  obj('class', 'student-desk', 'Student desk', 1, 1, [
    box(0.18, 0.25, 0.06, 0.4, 0, 14, 0x6b7280),
    box(0.76, 0.25, 0.06, 0.4, 0, 14, 0x6b7280),
    box(0.15, 0.2, 0.7, 0.5, 14, 3, 0xd6b38a),
  ]),
  obj('class', 'student-chair', 'Student chair', 1, 1, [
    box(0.33, 0.38, 0.34, 0.34, 0, 9, 0x9ca3af),
    box(0.3, 0.35, 0.4, 0.4, 9, 3, 0x2563eb),
    box(0.3, 0.3, 0.4, 0.06, 12, 12, 0x2563eb),
  ]),
  obj('class', 'teacher-desk', "Teacher's desk", 2, 1, [
    box(0.05, 0.2, 1.9, 0.6, 0, 16, 0x92400e),
    box(0, 0.15, 2, 0.7, 16, 3, 0xb45309),
  ]),
  obj('class', 'teacher-chair', "Teacher's chair", 1, 1, [
    box(0.3, 0.3, 0.4, 0.4, 0, 3, 0x1f2937), // base
    box(0.46, 0.46, 0.08, 0.08, 3, 9, 0x374151),
    box(0.22, 0.25, 0.56, 0.52, 12, 5, 0x7f1d1d), // padded seat
    box(0.22, 0.17, 0.56, 0.1, 17, 20, 0x991b1b), // tall back
    box(0.2, 0.3, 0.06, 0.42, 17, 6, 0x374151), // armrests
    box(0.74, 0.3, 0.06, 0.42, 17, 6, 0x374151),
  ]),
  obj('class', 'blackboard', 'Blackboard', 2, 1, [
    box(0.1, 0.3, 0.08, 0.3, 0, 14, 0x6b7280),
    box(1.82, 0.3, 0.08, 0.3, 0, 14, 0x6b7280),
    box(0.05, 0.4, 1.9, 0.08, 14, 30, 0x14532d),
    box(0.05, 0.4, 1.9, 0.08, 44, 2, 0x92400e),
  ]),
  obj('class', 'whiteboard', 'Whiteboard', 2, 1, [
    // wall-mounted: no legs, hung against the back edge so it sits flush on a wall behind it
    box(0.05, 0.02, 1.9, 0.05, 16, 32, 0xf8fafc),
    box(0.05, 0.02, 1.9, 0.07, 48, 2, 0x9ca3af),
    box(0.4, 0.09, 1.2, 0.04, 14, 2, 0x9ca3af), // marker tray
    box(0.5, 0.09, 0.1, 0.02, 16, 1, 0xdc2626),
    box(0.65, 0.09, 0.1, 0.02, 16, 1, 0x2563eb),
  ]),
  obj('class', 'lectern', 'Lectern', 1, 1, [
    box(0.25, 0.3, 0.5, 0.4, 0, 24, 0x92400e),
    box(0.2, 0.25, 0.6, 0.18, 24, 7, 0xb45309), // reading top, stepped down toward the speaker
    box(0.2, 0.43, 0.6, 0.16, 24, 5, 0xb45309),
    box(0.2, 0.59, 0.6, 0.16, 24, 3, 0xb45309),
    box(0.2, 0.72, 0.6, 0.03, 27, 2, 0x92400e), // lip that holds the notes
  ]),
  obj('class', 'bookshelf', 'Bookshelf', 1, 1, [
    box(0.1, 0.1, 0.8, 0.35, 0, 42, 0x92400e),
    ...[5, 18, 31].flatMap((z) => [
      box(0.18, 0.45, 0.18, 0.01, z, 9, 0x2563eb), // book spines
      box(0.4, 0.45, 0.14, 0.01, z, 8, 0xdc2626),
      box(0.58, 0.45, 0.22, 0.01, z, 9, 0x16a34a),
    ]),
  ]),

  // Furniture: hallway (parts listed back to front, bottom to top)
  obj('hallway', 'lockers', 'Lockers', 1, 1, [
    box(0.1, 0.15, 0.8, 0.45, 0, 50, 0x2563eb),
    box(0.1, 0.6, 0.8, 0.01, 24, 1, 0x1e40af), // split between the two lockers
    box(0.7, 0.6, 0.06, 0.02, 8, 8, 0xcbd5e1), // handles
    box(0.7, 0.6, 0.06, 0.02, 32, 8, 0xcbd5e1),
  ]),
  obj('hallway', 'hallway-bench', 'Hallway bench', 1, 1, [
    box(0.15, 0.4, 0.1, 0.2, 0, 8, 0x6b7280),
    box(0.75, 0.4, 0.1, 0.2, 0, 8, 0x6b7280),
    box(0.08, 0.35, 0.84, 0.3, 8, 3, 0xa16207),
    box(0.08, 0.3, 0.84, 0.06, 11, 10, 0xa16207), // backrest
  ]),
  obj('hallway', 'notice-board', 'Notice board', 2, 1, [
    box(0.1, 0.3, 0.08, 0.3, 0, 14, 0x6b7280),
    box(1.82, 0.3, 0.08, 0.3, 0, 14, 0x6b7280),
    box(0.05, 0.4, 1.9, 0.08, 14, 28, 0xb7794b), // cork
    box(0.05, 0.4, 1.9, 0.08, 42, 2, 0x78350f),
    box(0.3, 0.48, 0.3, 0.01, 24, 12, 0xf8fafc), // pinned notes
    box(0.8, 0.48, 0.25, 0.01, 28, 10, 0xfde68a),
    box(1.3, 0.48, 0.35, 0.01, 22, 14, 0xbfdbfe),
  ]),
  obj('hallway', 'trash-can', 'Trash can', 1, 1, [
    box(0.32, 0.32, 0.36, 0.36, 0, 20, 0x4b5563),
    box(0.32, 0.68, 0.36, 0.01, 8, 4, 0x22c55e), // recycling stripe
    box(0.3, 0.3, 0.4, 0.4, 20, 3, 0x374151), // lid
  ]),
  obj('hallway', 'drinking-fountain', 'Drinking fountain', 1, 1, [
    box(0.3, 0.25, 0.4, 0.35, 0, 22, 0xd1d5db),
    box(0.27, 0.22, 0.46, 0.45, 22, 4, 0x9ca3af),
    box(0.47, 0.3, 0.06, 0.06, 26, 4, 0x6b7280),
  ]),

  // Furniture: toilet
  obj('toilet', 'toilet', 'Toilet', 1, 1, [
    box(0.3, 0.15, 0.4, 0.15, 0, 26, 0xf8fafc), // tank
    box(0.36, 0.32, 0.28, 0.4, 0, 10, 0xe5e7eb),
    box(0.32, 0.3, 0.36, 0.46, 10, 3, 0xf8fafc), // seat
  ]),
  obj('toilet', 'urinal', 'Urinal', 1, 1, [
    box(0.35, 0.12, 0.3, 0.18, 10, 22, 0xf8fafc),
    box(0.4, 0.3, 0.2, 0.04, 10, 3, 0xe5e7eb),
  ]),
  obj('toilet', 'washbasin', 'Washbasin', 1, 1, [
    box(0.3, 0.08, 0.4, 0.03, 30, 18, 0xbae6fd), // mirror
    box(0.44, 0.3, 0.12, 0.12, 0, 16, 0xe5e7eb), // pedestal
    box(0.25, 0.2, 0.5, 0.35, 16, 6, 0xf8fafc),
    box(0.47, 0.2, 0.06, 0.06, 22, 6, 0x9ca3af), // tap
  ]),
  obj('toilet', 'toilet-stall', 'Toilet stall', 1, 2, [
    box(0.04, 0.02, 0.92, 0.04, 4, 32, 0x94a3b8), // back panel
    box(0.04, 0.06, 0.04, 1.86, 4, 32, 0x94a3b8), // far side panel
    box(0.3, 0.1, 0.4, 0.15, 0, 26, 0xf8fafc), // toilet tank
    box(0.36, 0.27, 0.28, 0.4, 0, 10, 0xe5e7eb),
    box(0.32, 0.25, 0.36, 0.46, 10, 3, 0xf8fafc), // seat
    box(0.92, 0.06, 0.04, 1.86, 4, 32, 0x94a3b8), // near side panel
    box(0.08, 1.88, 0.84, 0.04, 4, 31, 0x64748b), // door, with a gap underneath
    box(0.08, 1.88, 0.84, 0.04, 35, 1, 0x475569), // door top edge
    box(0.74, 1.92, 0.08, 0.01, 16, 3, 0xe5e7eb), // handle
    box(0.56, 1.92, 0.08, 0.01, 26, 2, 0x22c55e), // vacant indicator
  ]),
  obj('toilet', 'pedal-bin', 'Pedal bin', 1, 1, [
    box(0.38, 0.38, 0.24, 0.24, 0, 14, 0xe5e7eb),
    box(0.45, 0.62, 0.1, 0.05, 0, 2, 0x6b7280), // pedal
    box(0.36, 0.36, 0.28, 0.28, 14, 2, 0x9ca3af), // lid
  ]),

  // Furniture: teachers' lounge
  obj('lounge', 'armchair', 'Armchair', 1, 1, [
    box(0.15, 0.25, 0.7, 0.6, 0, 10, 0x7c2d12),
    box(0.15, 0.15, 0.7, 0.12, 10, 16, 0x9a3412), // back
    box(0.15, 0.25, 0.12, 0.6, 10, 7, 0x9a3412), // far arm
    box(0.27, 0.27, 0.46, 0.56, 10, 3, 0xc2410c), // cushion
    box(0.73, 0.25, 0.12, 0.6, 10, 7, 0x9a3412), // near arm
  ]),
  obj('lounge', 'coffee-table', 'Coffee table', 2, 1, [
    box(0.15, 0.3, 0.08, 0.4, 0, 8, 0x57534e),
    box(1.77, 0.3, 0.08, 0.4, 0, 8, 0x57534e),
    box(0.1, 0.25, 1.8, 0.5, 8, 3, 0x78350f),
    box(0.5, 0.4, 0.1, 0.1, 11, 4, 0xf8fafc), // mugs
    box(1.3, 0.45, 0.1, 0.1, 11, 4, 0xdc2626),
  ]),
  obj('lounge', 'coffee-station', 'Coffee station', 1, 1, [
    box(0.15, 0.2, 0.7, 0.6, 0, 18, 0x78350f),
    box(0.12, 0.17, 0.76, 0.66, 18, 2, 0xd6d3d1),
    box(0.3, 0.25, 0.3, 0.3, 20, 14, 0x1f2937), // machine
    box(0.62, 0.45, 0.1, 0.1, 20, 4, 0xf8fafc), // cup
  ]),
  obj('lounge', 'mailboxes', 'Mailboxes', 1, 1, [
    box(0.1, 0.15, 0.8, 0.35, 0, 44, 0xa16207),
    ...[10, 22, 34].flatMap((z) => [0.2, 0.45, 0.7].map((x) => box(x, 0.5, 0.15, 0.01, z, 6, 0x451a03))),
  ]),
  obj('lounge', 'meeting-table', 'Meeting table', 2, 2, [
    box(0.9, 0.9, 0.2, 0.2, 0, 14, 0x57534e),
    box(0.15, 0.15, 1.7, 1.7, 14, 3, 0xd6b38a),
  ]),
  obj('lounge', 'chair', 'Chair', 1, 1, [
    box(0.3, 0.3, 0.4, 0.4, 0, 8, 0x57534e),
    box(0.27, 0.27, 0.46, 0.46, 8, 2, 0xd6b38a),
    box(0.27, 0.22, 0.46, 0.08, 10, 12, 0xb7926a), // backrest
  ]),
  obj('lounge', 'sofa', 'Sofa', 2, 1, [
    box(0.15, 0.25, 1.7, 0.6, 0, 10, 0x7c2d12),
    box(0.15, 0.15, 1.7, 0.12, 10, 16, 0x9a3412), // back
    box(0.15, 0.25, 0.12, 0.6, 10, 7, 0x9a3412), // far arm
    box(0.27, 0.27, 0.71, 0.56, 10, 3, 0xc2410c), // cushions, same as the armchair
    box(1.02, 0.27, 0.71, 0.56, 10, 3, 0xc2410c),
    box(1.73, 0.25, 0.12, 0.6, 10, 7, 0x9a3412), // near arm
  ]),
  obj('lounge', 'tv', 'TV', 2, 1, [
    box(0.1, 0.25, 1.8, 0.5, 0, 12, 0x44403c), // low cabinet
    box(0.9, 0.4, 0.2, 0.15, 12, 3, 0x1f2937), // stand
    box(0.3, 0.45, 1.4, 0.05, 15, 26, 0x111827), // screen
    box(0.34, 0.5, 1.32, 0.01, 18, 20, 0x1e3a5f),
  ]),

  // Furniture: kitchen
  obj('kitchen', 'fridge', 'Fridge', 1, 1, [
    box(0.15, 0.2, 0.7, 0.6, 0, 52, 0xe5e7eb),
    box(0.15, 0.8, 0.7, 0.01, 32, 1, 0x9ca3af), // door split
    box(0.72, 0.8, 0.04, 0.02, 12, 14, 0x6b7280), // handles
    box(0.72, 0.8, 0.04, 0.02, 36, 10, 0x6b7280),
  ]),
  obj('kitchen', 'stove', 'Stove', 1, 1, [
    box(0.1, 0.15, 0.8, 0.7, 0, 20, 0xf3f4f6),
    box(0.25, 0.85, 0.5, 0.01, 6, 9, 0x374151), // oven window
    box(0.1, 0.15, 0.8, 0.7, 20, 1, 0x1f2937),
    ...[[0.2, 0.25], [0.55, 0.25], [0.2, 0.55], [0.55, 0.55]].map(([x = 0, y = 0]) => box(x, y, 0.22, 0.2, 21, 1, 0x6b7280)),
  ]),
  obj('kitchen', 'kitchen-counter', 'Kitchen counter', 1, 1, [
    box(0.05, 0.1, 0.9, 0.8, 0, 20, 0xb45309),
    box(0.4, 0.9, 0.2, 0.01, 14, 3, 0xd6d3d1), // drawer handle
    box(0.02, 0.07, 0.96, 0.86, 20, 2, 0xe7e5e4),
  ]),
  obj('kitchen', 'sink-counter', 'Sink counter', 1, 1, [
    box(0.05, 0.1, 0.9, 0.8, 0, 20, 0xb45309),
    box(0.02, 0.07, 0.96, 0.86, 20, 2, 0xe7e5e4),
    box(0.25, 0.25, 0.5, 0.45, 22, 1, 0x94a3b8), // basin
    box(0.47, 0.12, 0.06, 0.06, 22, 8, 0x9ca3af), // tap
  ]),
  obj('kitchen', 'pantry', 'Pantry', 1, 1, [
    box(0.05, 0.1, 0.9, 0.8, 0, 50, 0xb45309), // same wood and depth as the counters
    box(0.02, 0.07, 0.96, 0.86, 50, 2, 0xe7e5e4), // stone cap like the countertops
    box(0.495, 0.9, 0.01, 0.01, 2, 44, 0x451a03), // door split
    box(0.43, 0.9, 0.03, 0.01, 18, 10, 0xd6d3d1), // handles, same metal as the drawer handle
    box(0.54, 0.9, 0.03, 0.01, 18, 10, 0xd6d3d1),
  ]),

  // Paths
  { kind: 'tile', group: 'paths', id: 'stone', name: 'Stone path', color: 0xa39a90 },
  { kind: 'tile', group: 'paths', id: 'dirt', name: 'Dirt path', color: 0x9a7b4f },
  { kind: 'tile', group: 'paths', id: 'deck', name: 'Wood deck', color: 0xb45309 },
  { kind: 'tile', group: 'paths', id: 'asphalt', name: 'Asphalt', color: 0x44444c },
  { kind: 'tile', group: 'paths', id: 'concrete', name: 'Concrete', color: 0xc6c6c0 },
  { kind: 'tile', group: 'paths', id: 'red-brick', name: 'Red brick', color: 0x9a3f28 },
  { kind: 'tile', group: 'paths', id: 'cobblestone', name: 'Cobblestone', color: 0x77716a },
  { kind: 'tile', group: 'paths', id: 'running-track', name: 'Running track', color: 0xcf5f3c },
  { kind: 'tile', group: 'water', id: 'canal', name: 'Canal', color: 0x2f7fb8, bank: 0xa8a29e },
  { kind: 'tile', group: 'water', id: 'stream', name: 'Stream', color: 0x3b93a8, bank: 0xc8b07a },
  { kind: 'culvert', group: 'waterside', id: 'culvert', name: 'Culvert' },
  { kind: 'culvert', group: 'waterside', id: 'canal-outlet', name: 'Canal outlet', piece: 'outlet' },
  { kind: 'culvert', group: 'waterside', id: 'canal-inlet', name: 'Canal inlet', piece: 'inlet' },

  // Building: walls
  { kind: 'wall', group: 'walls', id: 'plaster', name: 'Plaster wall', color: 0xe7e5e4, floor: 'wood-floor' },
  { kind: 'wall', group: 'walls', id: 'brick', name: 'Brick wall', color: 0xb4532a, floor: 'stone-floor' },
  { kind: 'wall', group: 'walls', id: 'timber', name: 'Timber wall', color: 0xd4a373, floor: 'wood-floor' },
  {
    kind: 'wall', group: 'walls', id: 'glass', name: 'Glass wall', color: 0xbae6fd, floor: 'stone-floor',
    glass: { alpha: 0.35, frame: 0x475569 }, // paint tints the pane
  },
  { kind: 'wall', group: 'walls', id: 'pole', name: 'Pole wall', color: 0x475569, pole: { post: 0x475569, beam: 0x334155, canopy: 0x7aa2c7 } },

  // Paints: one side of a wall at a time
  ...(
    [
      ['plain', 'Plain', null],
      ['white', 'White', 0xf8fafc],
      ['cream', 'Cream', 0xfef3c7],
      ['butter', 'Butter yellow', 0xfde68a],
      ['peach', 'Peach', 0xfdba74],
      ['terracotta', 'Terracotta', 0xc2410c],
      ['rose', 'Rose', 0xfda4af],
      ['lavender', 'Lavender', 0xc4b5fd],
      ['sky', 'Sky blue', 0x93c5fd],
      ['navy', 'Navy', 0x1e3a8a],
      ['mint', 'Mint', 0x86efac],
      ['sage', 'Sage green', 0x84a98c],
      ['charcoal', 'Charcoal', 0x374151],
    ] as const
  ).map(([id, name, color]): PaintDef => ({ kind: 'paint', group: 'paints', id: `paint-${id}`, name, color })),

  // Fences
  fence('picket-fence', 'Picket fence', 0xf8fafc, { height: 16, post: 0xe5e7eb, rails: [5, 11], pickets: 5, panel: null }),
  fence('wooden-fence', 'Wooden fence', 0xa16207, { height: 20, post: 0x78350f, rails: [], pickets: 0, panel: { alpha: 1, thick: 0.05 } }),
  fence('metal-railing', 'Metal railing', 0x374151, { height: 14, post: 0x1f2937, rails: [3, 12], pickets: 4, panel: null }),
  fence('chain-link', 'Chain-link fence', 0x9ca3af, { height: 24, post: 0x6b7280, rails: [22], pickets: 0, panel: { alpha: 0.35, thick: 0.02 } }),
  fence('hedge-row', 'Hedge row', 0x15803d, { height: 20, post: null, rails: [], pickets: 0, panel: { alpha: 1, thick: 0.3 } }),
  fence('pillar-fence', 'Pillar fence', 0x1f2937, {
    height: 32, post: 0xd6d3d1, postSize: 0.22, rails: [14, 29], pickets: 6, panel: null,
    base: { height: 10, color: 0xa8a29e, thick: 0.16 },
  }),
  fence('rope-fence', 'Rope fence', 0xf5f0e1, {
    height: 20, post: 0xc4935c, postSize: 0.14, rails: [], pickets: 0, panel: null,
    rope: { z: 17, sag: 7, color: 0xf5f0e1 },
  }),
  fence('low-wall', 'Low brick wall', 0xb4532a, { height: 10, post: null, rails: [], pickets: 0, panel: { alpha: 1, thick: 0.16 } }),

  // Building: doors
  opening('doors', 'wooden-door', 'Wooden door', 0.25, 0.75, 0, 38, WOOD),
  opening('doors', 'painted-door', 'Painted door', 0.25, 0.75, 0, 38, { color: 0x0f766e, alpha: 1 }),
  opening('doors', 'glass-door', 'Glass door', 0.25, 0.75, 0, 40, GLASS),
  opening('doors', 'double-door', 'Double door', 0.1, 0.9, 0, 40, { color: 0x92400e, alpha: 1 }),
  ...spanning('doors', 'long-door', 'Long door', 0, 40, { color: 0x92400e, alpha: 1 }, 0.25),

  // Building: windows
  opening('windows', 'window', 'Window', 0.2, 0.8, 16, 42, GLASS),
  opening('windows', 'wide-window', 'Wide window', 0.08, 0.92, 16, 42, GLASS),
  opening('windows', 'tall-window', 'Tall window', 0.3, 0.7, 6, 48, GLASS),
  opening('windows', 'small-window', 'Small window', 0.35, 0.65, 26, 42, GLASS),
  ...spanning('windows', 'long-window', 'Long window', 14, 44, GLASS, 0.15),

  // Building: arches (open passages)
  opening('arches', 'arch', 'Arch', 0.2, 0.8, 0, 44, null),
  opening('arches', 'wide-arch', 'Wide arch', 0.05, 0.95, 0, 46, null),
  opening('arches', 'narrow-arch', 'Narrow arch', 0.32, 0.68, 0, 42, null),
  ...spanning('arches', 'long-arch', 'Long arch', 0, 46, null, 0.2),

  // Gates (openings that only go on fences)
  ...[
    opening('gates', 'garden-gate', 'Garden gate', 0.2, 0.8, 1, 14, { color: 0x92400e, alpha: 1 }),
    opening('gates', 'metal-gate', 'Metal gate', 0.15, 0.85, 0, 16, { color: 0x1f2937, alpha: 0.85 }),
    opening('gates', 'double-gate', 'Double gate', 0.05, 0.95, 0, 16, { color: 0x7c2d12, alpha: 1 }),
    opening('gates', 'fence-gap', 'Fence gap', 0.1, 0.9, 0, 30, null),
    ...spanning('gates', 'wide-gate', 'Wide gate', 0, 16, { color: 0x1f2937, alpha: 0.85 }, 0.1),
    ...spanning('gates', 'arched-gate', 'Arched gate', 0, 24, { color: 0x1f2937, alpha: 0.9 }, 0.15, {
      color: 0x1f2937, pillar: 0xd6d3d1, pillarSize: 0.2, pillarHeight: 50, spring: 42, rise: 20,
    }),
  ].map((o): OpeningDef => ({ ...o, gate: true })),

  // Flooring: wide roads (5 across; flat road surfaces that turn with R and join end to end)
  { ...flat('road', 'roads', 'wide-straight', 'Straight road', 1, WIDE, straight(WIDE)), run: true },
  { ...flat('road', 'roads', 'wide-dashed', '1 side dashed', 1, WIDE, straight(WIDE, 1)), run: true },
  { ...flat('road', 'roads', 'wide-dashed2', '2 sides dashed', 1, WIDE, straight(WIDE, 2)), run: true },
  flat('road', 'roads', 'wide-sharp', 'Sharp curve', wideSharp.size, wideSharp.size, wideSharp.marks, wideSharp.cells),
  flat('road', 'roads', 'wide-gentle', 'Gentle curve', wideGentle.size, wideGentle.size, wideGentle.marks, wideGentle.cells),
  flat('road', 'roads', 'wide-t', 'T-junction', WIDE, WIDE, junction(WIDE, WIDE, true)),
  flat('road', 'roads', 'wide-cross', 'Crossroads', WIDE, WIDE, junction(WIDE, WIDE, false)),
  flat('road', 'roads', 'wide-end', 'Road end', 1, WIDE, roadEnd(WIDE, 0.8)),

  // Flooring: narrow roads (3 across)
  { ...flat('road', 'narrow', 'narrow-straight', 'Narrow road', 1, NARROW, straight(NARROW)), run: true },
  { ...flat('road', 'narrow', 'narrow-dashed', 'Narrow, 1 dashed', 1, NARROW, straight(NARROW, 1)), run: true },
  { ...flat('road', 'narrow', 'narrow-dashed2', 'Narrow, 2 dashed', 1, NARROW, straight(NARROW, 2)), run: true },
  flat('road', 'narrow', 'narrow-sharp', 'Narrow bend', narrowSharp.size, narrowSharp.size, narrowSharp.marks, narrowSharp.cells),
  flat('road', 'narrow', 'narrow-gentle', 'Narrow curve', narrowGentle.size, narrowGentle.size, narrowGentle.marks, narrowGentle.cells),
  flat('road', 'narrow', 'narrow-t', 'Narrow T', NARROW, NARROW, junction(NARROW, NARROW, true)),
  flat('road', 'narrow', 'narrow-cross', 'Narrow cross', NARROW, NARROW, junction(NARROW, NARROW, false)),
  flat('road', 'narrow', 'narrow-end', 'Narrow end', 1, NARROW, roadEnd(NARROW, 0.6)),

  // Flooring: road links, where the two widths meet, and the bus bay
  // a narrow road ending into the side of a wide one: the wide road runs along x, the narrow road
  // leaves through +y; and the other way round, a wide road ending into a narrow one
  flat('road', 'links', 'link-narrow-t', 'T into wide', NARROW, WIDE, junction(NARROW, WIDE, true)),
  flat('road', 'links', 'link-wide-t', 'T into narrow', WIDE, NARROW, junction(WIDE, NARROW, true)),
  // a narrow road crossing a wide one: the wide road along x, the narrow one along y
  flat('road', 'links', 'link-cross', 'Mixed crossroads', NARROW, WIDE, junction(NARROW, WIDE, false)),
  // a straight piece where both sides taper in, from 5 across at x = 0 to 3 across at x = 3
  flat('road', 'links', 'link-taper', 'Narrowing road', 3, WIDE, [
    { pts: [[0, 0], [3, 1], [3, 4], [0, 5]], color: ASPHALT },
    { pts: [[0, EDGE[0]], [3, 1 + EDGE[0]], [3, 1 + EDGE[1]], [0, EDGE[1]]], color: ROAD_LINE },
    { pts: [[0, 5 - EDGE[1]], [3, 4 - EDGE[1]], [3, 4 - EDGE[0]], [0, 5 - EDGE[0]]], color: ROAD_LINE },
    ...[0, 1, 2].map((x) => rectMark(x + 0.25, 2.5 - LINE / 2, x + 0.75, 2.5 + LINE / 2, ROAD_LINE)),
  ]),
  // a tight turn that narrows as it goes: in wide at x = 0, out narrow through y = 5 (a right turn);
  // the left turn is its mirror image, out through y = 0
  flat('road', 'links', 'link-turn-right', 'Narrowing right', NARROW, WIDE, turnTransition.marks, turnTransition.cells),
  flat('road', 'links', 'link-turn-left', 'Narrowing left', NARROW, WIDE, turnTransition.marks.map(mirrorY(WIDE)),
    turnTransition.cells.map((c) => ({ x: c.x, y: WIDE - 1 - c.y }))),
  // a bus bay, built in pieces beside a road (on the road's dashed side, the bay's y = 0): an opening
  // that tapers out over 4 tiles, as many 1-tile middles as needed, and a closing that tapers back in
  flat('road', 'links', 'bay-start', 'Bus bay opening', 4, 2, [
    { pts: [[0, 0], [4, 0], [4, 2]], color: ASPHALT },
    segMark(0.5, 0.04, 3.96, 1.78, LINE, ROAD_LINE),
  ], [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 2, y: 1 }, { x: 3, y: 1 }]),
  { ...flat('road', 'links', 'bay-middle', 'Bus bay middle', 1, 2, [rectMark(0, 0, 1, 2, ASPHALT), rectMark(0, 1.74, 1, 1.82, ROAD_LINE)]), run: true },
  flat('road', 'links', 'bay-end', 'Bus bay closing', 4, 2, [
    { pts: [[0, 0], [4, 0], [0, 2]], color: ASPHALT },
    segMark(0.04, 1.78, 3.5, 0.04, LINE, ROAD_LINE),
  ], [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]),

  // Flooring: markings (paint laid over roads or paths)
  // zebra crossings, one tile deep: bars along the traffic, spread across a wide or a narrow road.
  // Each clears the lane lines under it (asphalt between the edge lines) so the bars read cleanly; a
  // median it crosses shows a paved refuge instead of its planting
  { ...flat('marking', 'markings', 'crosswalk', 'Crosswalk', 1, WIDE, [
    rectMark(0, 0.3, 1, WIDE - 0.3, ASPHALT),
    ...Array.from({ length: 10 }, (_, i) => rectMark(0.1, 0.4 + 0.45 * i, 0.9, 0.65 + 0.45 * i, ROAD_LINE)),
  ]), refuge: true },
  { ...flat('marking', 'markings', 'crosswalk-narrow', 'Narrow crosswalk', 1, NARROW, [
    rectMark(0, 0.3, 1, NARROW - 0.3, ASPHALT),
    ...Array.from({ length: 5 }, (_, i) => rectMark(0.1, 0.45 + 0.45 * i, 0.9, 0.7 + 0.45 * i, ROAD_LINE)),
  ]), refuge: true },
  // a median strip, one tile at a time: a curb around a planting bed that joins its neighbors like a
  // canal does, rounding off wherever it ends. Drag it along the middle of a wide road; plant trees on it
  { kind: 'object', group: 'markings', id: 'median', name: 'Median strip', w: 1, h: 1, parts: [], marks: [], layer: 'median', smart: 'median' },
  // lane arrows, pointing along +x, each inside its own 1 by 3 row with space around it (a wide road's
  // lanes are 1 tile)
  flat('marking', 'markings', 'arrow-straight', 'Straight arrow', 3, 1, [
    rectMark(0.45, 0.45, 2, 0.55, ROAD_LINE),
    { pts: [[2, 0.28], [2.55, 0.5], [2, 0.72]], color: ROAD_LINE },
  ]),
  flat('marking', 'markings', 'arrow-left', 'Left turn arrow', 3, 1, [
    rectMark(0.45, 0.45, 1.78, 0.55, ROAD_LINE),
    rectMark(1.68, 0.3, 1.78, 0.55, ROAD_LINE),
    { pts: [[1.56, 0.3], [1.9, 0.3], [1.73, 0.12]], color: ROAD_LINE },
  ]),
  flat('marking', 'markings', 'arrow-right', 'Right turn arrow', 3, 1, [
    rectMark(0.45, 0.45, 1.78, 0.55, ROAD_LINE),
    rectMark(1.68, 0.45, 1.78, 0.7, ROAD_LINE),
    { pts: [[1.56, 0.7], [1.9, 0.7], [1.73, 0.88]], color: ROAD_LINE },
  ]),
  // a car bay, open at +y: half-width side lines, so bays side by side share one full line
  flat('marking', 'markings', 'car-bay', 'Car bay', 2, 4, [
    rectMark(0, 0, 0.06, 4, ROAD_LINE),
    rectMark(1.94, 0, 2, 4, ROAD_LINE),
    rectMark(0, 0, 2, 0.08, ROAD_LINE),
    rectMark(0.85, 0.6, 1.15, 0.7, ROAD_LINE), // a wheel stop line near the back
  ]),
  // a truck loading bay, open at +y: yellow side and back lines, a hatched keep-clear strip at the
  // dock end and an arrow pointing in, for backing up to the dock
  flat('marking', 'markings', 'loading-bay', 'Loading bay', 4, 8, [
    rectMark(0, 0, 0.1, 8, BAY_YELLOW),
    rectMark(3.9, 0, 4, 8, BAY_YELLOW),
    rectMark(0, 0, 4, 0.1, BAY_YELLOW),
    rectMark(0.1, 1.4, 3.9, 1.5, BAY_YELLOW),
    ...Array.from({ length: 8 }, (_, i): Mark => ({
      pts: [[0.3 + i * 0.45, 0.2], [0.55 + i * 0.45, 0.2], [0.35 + i * 0.45, 1.3], [0.1 + i * 0.45, 1.3]],
      color: BAY_YELLOW,
    })).filter((m) => m.pts.every(([x]) => x <= 3.85)),
    rectMark(1.92, 3.2, 2.08, 6, BAY_YELLOW),
    { pts: [[2, 2.4], [2.6, 3.3], [1.4, 3.3]], color: BAY_YELLOW },
  ]),

  ...COURTS,

  // Building: floors
  { kind: 'tile', group: 'floors', id: 'wood-floor', name: 'Wood floor', color: 0xd6b38a },
  { kind: 'tile', group: 'floors', id: 'stone-floor', name: 'Stone floor', color: 0xcbd5e1 },
  { kind: 'tile', group: 'floors', id: 'carpet', name: 'Carpet', color: 0x9f1239 },
  // A floor for every kind of room: wood for offices and halls, hard floors for classrooms and
  // corridors, tile and stone for toilets and lobbies, epoxy for labs, rubber for the gym
  { kind: 'tile', group: 'floors', id: 'light-oak', name: 'Light oak', color: 0xeccb96 },
  { kind: 'tile', group: 'floors', id: 'dark-wood', name: 'Dark wood', color: 0x7f4f27 },
  { kind: 'tile', group: 'floors', id: 'linoleum', name: 'Linoleum', color: 0xb5c7ae },
  { kind: 'tile', group: 'floors', id: 'white-tile', name: 'White tile', color: 0xf3f6f9 },
  { kind: 'tile', group: 'floors', id: 'marble', name: 'Marble', color: 0xece2cf },
  { kind: 'tile', group: 'floors', id: 'terrazzo', name: 'Terrazzo', color: 0xd9b8a8 },
  { kind: 'tile', group: 'floors', id: 'epoxy', name: 'Epoxy', color: 0x8fb3ad },
  { kind: 'tile', group: 'floors', id: 'gym-floor', name: 'Gym floor', color: 0x3e6db0 },
  { kind: 'tile', group: 'floors', id: 'blue-carpet', name: 'Blue carpet', color: 0x253f7a },
  { kind: 'tile', group: 'floors', id: 'grey-carpet', name: 'Grey carpet', color: 0x5f6b80 },
  // sports floors (#33), colors chosen by measured distance from every floor, path, water and terrain
  { kind: 'tile', group: 'floors', id: 'court-blue', name: 'Court blue', color: 0x3966bf },
  { kind: 'tile', group: 'floors', id: 'court-green', name: 'Court green', color: 0x5a9f80 },
  { kind: 'tile', group: 'floors', id: 'court-red', name: 'Court red', color: 0xc0504a },
  { kind: 'tile', group: 'floors', id: 'mowed-grass', name: 'Mowed grass', color: 0x5fa04a, stripe: 0x4f8c3d },
  { kind: 'tile', group: 'floors', id: 'turf-grass', name: 'Turf grass', color: 0x34a865 },

  // Terrain. `grass` is the eraser: painting it takes the terrain away, so the tile is plain grass again.
  { kind: 'terrain', group: 'grass', id: 'grass', name: 'Grass', color: 0x3a7d44 },
  { kind: 'terrain', group: 'grass', id: 'lush-grass', name: 'Lush grass', color: 0x2c6834 },
  { kind: 'terrain', group: 'grass', id: 'dry-grass', name: 'Dry grass', color: 0x96974e },
  { kind: 'terrain', group: 'grass', id: 'turf', name: 'Turf', color: 0x529e48 },
  { kind: 'terrain', group: 'grass', id: 'meadow', name: 'Meadow', color: 0x709240 },
  { kind: 'terrain', group: 'grass', id: 'moss', name: 'Moss', color: 0x3e6c54 },
  { kind: 'terrain', group: 'grass', id: 'flowery-grass', name: 'Flowery grass', color: 0x4a8a46, specks: [0xf4f1ea, 0xf2c94c, 0xe98fb5, 0xb69ae8] },
  // 'dirt' is the Dirt path tile, so the terrain keeps its own id
  { kind: 'terrain', group: 'ground', id: 'soil-dirt', name: 'Dirt', color: 0x7a5536 },
  { kind: 'terrain', group: 'ground', id: 'mulch', name: 'Mulch', color: 0x5b3a24 },
  { kind: 'terrain', group: 'ground', id: 'clay', name: 'Clay', color: 0xb8613a },
  { kind: 'terrain', group: 'ground', id: 'terrain-gravel', name: 'Gravel', color: 0xb09c70 },
  { kind: 'terrain', group: 'ground', id: 'terrain-sand', name: 'Sand', color: 0xf0d77a },
];

// Gravel and sand used to be path tiles. Saves and blueprints that still hold them get terrain instead.
export const TILE_TO_TERRAIN: Readonly<Record<string, string>> = { gravel: 'terrain-gravel', sand: 'terrain-sand' };

export const CATALOG: readonly CatalogItem[] = ITEMS;

const BY_ID: ReadonlyMap<string, CatalogItem> = new Map(CATALOG.map((i) => [i.id, i]));

export const getItem = (id: string): CatalogItem => {
  const item = BY_ID.get(id);
  if (!item) throw new Error(`Unknown catalog item: ${id}`);
  return item;
};

const getOfKind = <K extends CatalogItem['kind']>(kind: K, id: string): Extract<CatalogItem, { kind: K }> => {
  const item = getItem(id);
  if (item.kind !== kind) throw new Error(`${id} is a ${item.kind}, expected ${kind}`);
  return item as Extract<CatalogItem, { kind: K }>;
};

export const getObjectDef = (id: string) => getOfKind('object', id);
export const getTileDef = (id: string) => getOfKind('tile', id);
export const getTerrainDef = (id: string) => getOfKind('terrain', id);
export const isTerrain = (id: string): boolean => BY_ID.get(id)?.kind === 'terrain';
export const isWaterTile = (id: string): boolean => getTileDef(id).bank !== undefined;

// Things that float sit down at the water's surface when they are on water (#17); on land they stand
// on the ground as before. The footbridge spans at ground level, so it does not float.
const FLOATING: ReadonlySet<string> = new Set(['lily-pads', 'reeds', 'stepping-stones', 'rowboat', 'duck']);
export const floats = (id: string): boolean => FLOATING.has(id);
export const getWallStyle = (id: string) => getOfKind('wall', id);
export const getPaint = (id: string) => getOfKind('paint', id);
// Walls take paint (on glass it tints the pane); fences do not
export const isPaintable = (styleId: string): boolean => getWallStyle(styleId).fence === undefined && getWallStyle(styleId).pole === undefined;
export const isPole = (styleId: string): boolean => getWallStyle(styleId).pole !== undefined;
export const isFence = (styleId: string): boolean => getWallStyle(styleId).fence !== undefined;
export const getOpeningDef = (id: string) => getOfKind('opening', id);


// Span pieces are placed through their parent item, so they never show in the tray
export const isPiece = (item: CatalogItem): boolean => item.kind === 'opening' && item.parent !== undefined;

export const itemsIn = (group: GroupId): readonly CatalogItem[] =>
  CATALOG.filter((i) => i.group === group && !isPiece(i));

// The tray item a placed opening belongs to (the parent for a span piece)
export const trayItemOf = (id: string): string => {
  const item = getItem(id);
  return item.kind === 'opening' && item.parent ? item.parent : id;
};

export const swatchOf = (item: CatalogItem): number => {
  switch (item.kind) {
    case 'object':
      return item.parts.at(-1)?.color ?? 0xffffff;
    case 'tile':
    case 'terrain':
    case 'wall':
      return item.color;
    case 'opening':
      return item.fill?.color ?? 0x94a3b8;
    case 'culvert':
      return 0x57534e;
    case 'paint':
      return item.color ?? 0xe7e5e4;
  }
};

// Rotation swaps the footprint axes. Parts are transposed to match
// (a mirror across the diagonal, which reads as a turn for these symmetric objects).
// ===== Rotation =====
// Objects face one of four ways: quarter turns clockwise seen from above (north to east to south to west).
// Turns are plain data: each part's box turns about the footprint, and odd turns swap the footprint.
export type Rotation = 0 | 1 | 2 | 3;
export const turn = (r: Rotation, by: number): Rotation => ((((r + by) % 4) + 4) % 4) as Rotation;

export const footprintOf = (def: ObjectDef, r: Rotation) => (r % 2 === 1 ? { w: def.h, h: def.w } : { w: def.w, h: def.h });

// One part turned r quarter turns inside a W by H footprint
const turnPart = (p: Part, W: number, H: number, r: Rotation): Part => {
  switch (r) {
    case 0:
      return p;
    case 1:
      return { ...p, dx: H - p.dy - p.h, dy: p.dx, w: p.h, h: p.w };
    case 2:
      return { ...p, dx: W - p.dx - p.w, dy: H - p.dy - p.h };
    case 3:
      return { ...p, dx: p.dy, dy: W - p.dx - p.w, w: p.h, h: p.w };
  }
};

// Draw order for parts after a turn. Parts are written back to front and bottom to top for the
// unturned object; once turned, each pair of parts that overlaps on screen is ordered again as 3D
// boxes (behind first, then lower first), and boxes that truly intersect keep the written order.
// A topological order over those rules, visiting in written order so ties keep the author's intent.
const boxOf = (p: Part): Box => ({ x: p.dx, y: p.dy, w: p.w, h: p.h, z: p.z, height: p.height });
export const orderParts = (parts: readonly Part[]): readonly Part[] => {
  const indexed = parts.map((part, i) => ({ part, i, box: boxOf(part) }));
  // boxes that intersect (a seat set inside its arms) keep the written order
  const before = (a: (typeof indexed)[number], b: (typeof indexed)[number]): boolean =>
    boxDrawsBefore(a.box, b.box) ?? a.i < b.i;
  const done = new Set<number>();
  const visiting = new Set<number>();
  const out: Part[] = [];
  const visit = (n: (typeof indexed)[number]): void => {
    if (done.has(n.i) || visiting.has(n.i)) return;
    visiting.add(n.i);
    indexed.forEach((m) => m !== n && before(m, n) && visit(m));
    visiting.delete(n.i);
    done.add(n.i);
    out.push(n.part);
  };
  indexed.forEach(visit);
  return out;
};

// A point of a mark turned r quarter turns inside a W by H footprint (the same turn as parts)
const turnPoint = ([x, y]: MarkPoint, W: number, H: number, r: Rotation): MarkPoint => {
  switch (r) {
    case 0:
      return [x, y];
    case 1:
      return [H - y, x];
    case 2:
      return [W - x, H - y];
    case 3:
      return [y, W - x];
  }
};

const turnedMarks = new Map<string, readonly Mark[]>();
export const marksOf = (def: ObjectDef, r: Rotation): readonly Mark[] => {
  if (!def.marks) return [];
  const key = `${def.id}:${r}`;
  const cached = turnedMarks.get(key);
  if (cached) return cached;
  const marks = def.marks.map((m) => ({ ...m, pts: m.pts.map((p) => turnPoint(p, def.w, def.h, r)) }));
  turnedMarks.set(key, marks);
  return marks;
};

// The cells an object stands on, in the world: its whole footprint unless it lists its cells
const turnedCells = new Map<string, readonly Cell[] | null>();
const ownCells = (def: ObjectDef, r: Rotation): readonly Cell[] | null => {
  const key = `${def.id}:${r}`;
  const cached = turnedCells.get(key);
  if (cached !== undefined) return cached;
  // a cell turns like a 1 by 1 part
  const cells = def.cells?.map((c) => turnPart({ shape: 'box', dx: c.x, dy: c.y, w: 1, h: 1, z: 0, height: 0, color: 0 }, def.w, def.h, r)).map((p) => ({ x: p.dx, y: p.dy })) ?? null;
  turnedCells.set(key, cells);
  return cells;
};
type Placed = Readonly<{ defId: string; rotation: Rotation; x: number; y: number; w: number; h: number }>;
export const occupiedCells = (p: Placed): readonly Cell[] => {
  const own = ownCells(getObjectDef(p.defId), p.rotation);
  return own
    ? own.map((c) => ({ x: p.x + c.x, y: p.y + c.y }))
    : Array.from({ length: p.w * p.h }, (_, i) => ({ x: p.x + (i % p.w), y: p.y + Math.floor(i / p.w) }));
};
export const isFlat = (defId: string): boolean => getObjectDef(defId).marks !== undefined;
export const isSmart = (defId: string): boolean => getObjectDef(defId).smart !== undefined;
export const isRun = (defId: string): boolean => getObjectDef(defId).run === true;
// The layer an object lives in: a ground layer for flat pieces, null for things that stand
export const layerOf = (defId: string): GroundLayer | null => getObjectDef(defId).layer ?? null;

// Turned and ordered parts, worked out once per object and direction
const turnedParts = new Map<string, readonly Part[]>();
export const partsOf = (def: ObjectDef, r: Rotation): readonly Part[] => {
  const key = `${def.id}:${r}`;
  const cached = turnedParts.get(key);
  if (cached) return cached;
  const parts = orderParts(def.parts.map((p) => turnPart(p, def.w, def.h, r)));
  turnedParts.set(key, parts);
  return parts;
};

// The catalog item for a culvert edge by its stored kind
export const culvertItemOf = (piece: CulvertPiece | undefined): string => (piece === 'outlet' ? 'canal-outlet' : piece === 'inlet' ? 'canal-inlet' : 'culvert');
