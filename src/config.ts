// The view angle comes only from the tile's shape. A 2:1 tile is classic isometric (grid lines
// slope about 26.6 degrees), so the width is derived from the height: scaling tiles keeps the angle.
// Map size only sets how many tiles there are and never affects the angle.
export const TILE_H = 32;
export const TILE_W = TILE_H * 2;
// Map size is part of each world (set when a new game starts); these bound what a new game may pick
export const DEFAULT_GRID = 64;
export const MIN_GRID = 16;
export const MAX_GRID = 256;

// Walls (heights in pixels, thickness in tiles)
export const WALL_H = 56;
export const CUT_WALL_H = 10;
export const WALL_T = 0.08;
export const ROOF_T = 3;

// How close (in tiles) the pointer must be to a grid line to target the wall on it
export const EDGE_PICK = 0.22;

// Guide lines (#22) are turned off for now: grabbing a thin line on an isometric grid was too fiddly.
// The core (guide tool, guides in state, drawing) is kept and tested; this hides the way in.
export const GUIDES_ENABLED = false;

// Floors you can switch between. Index 0 is the ground floor.
export const LEVELS = ['1st floor', 'Roof'] as const;
export const LEVEL_SHORT_NAMES: readonly string[] = ['1F', 'Roof']; // for narrow screens
export const ROOF_LEVEL = LEVELS.length - 1;

// Sunken water (#17): how far below the ground the canal's water lies, and how far something floating
// on a stream sits down (the stream bed itself reaches 16 px at its deepest, see terrainField.ts)
export const CANAL_DEPTH = 11;
export const STREAM_SINK = 13;
export const INLET_RAISE = 3; // how far below the ground an inlet's raised stream water lies, in pixels
export const STREAM_DEPTH = 16; // how far down the stream's deepest water shows, in pixels
