// The view angle comes only from the tile's shape. A 2:1 tile is classic isometric (grid lines
// slope about 26.6 degrees), so the width is derived from the height: scaling tiles keeps the angle.
// Grid size (below) only sets how many tiles there are and never affects the angle.
export const TILE_H = 32;
export const TILE_W = TILE_H * 2;
export const GRID_W = 64;
export const GRID_H = 64;

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
