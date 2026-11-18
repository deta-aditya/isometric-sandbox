// The camera (pan and zoom) as plain numbers, so its limits are pure and testable. The shell owns the
// Pixi container and copies these onto it. The camera works in the view's frame: on a non-square map
// width and height trade places on odd views, so its limits come from the turned state's size.
import { TILE_H, TILE_W } from './config';
import { type Size, toScreen } from './geometry';

export type Camera = Readonly<{ x: number; y: number; scale: number }>;
export type Screen = Readonly<{ w: number; h: number }>;

export const MAX_ZOOM = 3;
const MIN_ZOOM = 0.15; // the floor on small maps; big maps may go further out to fit on screen
const FIT = 0.9; // how much of the screen a whole map takes at the furthest zoom
const START_NUDGE = 60; // the start view sits a little above center, clear of the bottom bar

// The map's outline on screen (unscaled): the diamond from the top corner (0, 0) to the bottom (w, h),
// widest at the left corner (0, h) and right corner (w, 0)
export const mapBounds = (size: Size) => ({
  left: -size.h * (TILE_W / 2),
  right: size.w * (TILE_W / 2),
  top: 0,
  bottom: (size.w + size.h) * (TILE_H / 2),
});

// Zoomed all the way out, the whole map fits on screen
export const minZoom = (size: Size, screen: Screen): number => {
  const b = mapBounds(size);
  return Math.min(MIN_ZOOM, FIT * Math.min(screen.w / (b.right - b.left), screen.h / (b.bottom - b.top)));
};

export const clampZoom = (scale: number, size: Size, screen: Screen): number =>
  Math.min(MAX_ZOOM, Math.max(minZoom(size, screen), scale));

// The middle of the screen always stays over the map's outline, so the map cannot be lost off screen
// and any corner can still be brought to the middle
export const clampCamera = (cam: Camera, size: Size, screen: Screen): Camera => {
  const scale = clampZoom(cam.scale, size, screen);
  const b = mapBounds(size);
  const cx = Math.min(b.right, Math.max(b.left, (screen.w / 2 - cam.x) / scale));
  const cy = Math.min(b.bottom, Math.max(b.top, (screen.h / 2 - cam.y) / scale));
  return { x: screen.w / 2 - cx * scale, y: screen.h / 2 - cy * scale, scale };
};

// A fresh look at a map: centered on its middle, zoomed for the screen (phones start further out)
export const startCamera = (size: Size, screen: Screen): Camera => {
  const scale = clampZoom(Math.min(0.7, Math.max(0.32, screen.w / 1100)), size, screen);
  const center = toScreen(size.w / 2, size.h / 2);
  return { x: screen.w / 2 - center.sx * scale, y: screen.h / 2 - START_NUDGE - center.sy * scale, scale };
};
