// Guide lines across the map. Drawn from the turned (view) state, so they turn with the camera.
// They show in every tool; with the guide tool the line it points at lights up: a guide there
// brightens (a click removes it, a drag moves it), or else a faint preview shows on the grid line
// where a click would add one. While dragging, the guide is shown where it would land.
import { Container, Graphics } from 'pixi.js';
import { type Size, toScreen } from '../geometry';
import { type Guide, type State, guideDragTarget, guideUnder } from '../world';

export const GUIDE = 0x22d3ee;
const BRIGHT = 0xf8fafc;

const ends = (g: Guide, size: Size): number[] => {
  const [a, b] = g.axis === 'x' ? [toScreen(g.at, 0), toScreen(g.at, size.h)] : [toScreen(0, g.at), toScreen(size.w, g.at)];
  return [a.sx, a.sy, b.sx, b.sy];
};

export const createGuides = (layer: Container) => {
  const lines = new Graphics();
  const lit = new Graphics();
  layer.addChild(lines, lit);

  const render = (state: State): void => {
    const drag = state.drag?.mode === 'guide' ? state.drag : null;
    const target = guideDragTarget(state);
    const hit = state.tool === 'guide' && !drag ? guideUnder(state, state.point) : null;
    // the dragged guide leaves its old place; the one pointed at is drawn by the highlight instead
    const hidden = drag?.index ?? hit?.index ?? null;

    lines.clear();
    state.guides.forEach((g, i) => i !== hidden && lines.poly(ends(g, state.size), false));
    lines.stroke({ width: 1.5, color: GUIDE, alpha: 0.8 });

    lit.clear();
    if (target && target !== 'remove') lit.poly(ends(target, state.size), false).stroke({ width: 2.5, color: BRIGHT, alpha: 0.95 });
    else if (hit?.index != null) lit.poly(ends(hit.guide, state.size), false).stroke({ width: 2.5, color: BRIGHT, alpha: 0.95 });
    else if (hit) lit.poly(ends(hit.guide, state.size), false).stroke({ width: 2, color: GUIDE, alpha: 0.6 });
  };

  return { render };
};
