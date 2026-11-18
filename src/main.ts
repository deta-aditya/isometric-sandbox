// Composition root: wires state, views and input together.
import { Application, Container } from 'pixi.js';
import './style.css';
import { GRID_H, GRID_W } from './config';
import { toGridPoint, toScreen } from './geometry';
import { bindInput } from './input';
import { createHud } from './render/hud';
import { createIcons, toDataUrl } from './render/icons';
import { loadBlueprints, saveBlueprints } from './blueprintStore';
import { createScene, drawPiecesPreview } from './render/scene';
import { type HistoryAction, canRedo, canUndo, initialHistory, step } from './history';
import { type View, pointFromView, pointToView, toView } from './view';
import { type Blueprint, type State, initialState } from './world';

const app = new Application();
await app.init({ background: '#1e293b', resizeTo: window, antialias: true });
document.body.prepend(app.canvas);

// Start zoomed out a bit, centered on the middle of the grid (nudged right of the panel)
const world = new Container();
// Phones start further out so a good part of the grid is on screen
const START_ZOOM = Math.min(0.7, Math.max(0.32, app.screen.width / 1100));
const center = toScreen(GRID_W / 2, GRID_H / 2);
world.scale.set(START_ZOOM);
world.x = app.screen.width / 2 - center.sx * START_ZOOM;
world.y = app.screen.height / 2 - 60 - center.sy * START_ZOOM; // nudged up, clear of the bottom bar
app.stage.addChild(world);

// The only mutable binding in the app: the history, which holds the current state
let history = initialHistory;

const dispatch = (action: HistoryAction): void => {
  const next = step(history, action);
  if (next === history) return;
  if (next.state.view !== history.state.view) keepCenter(history.state.view, next.state.view);
  if (next.state.blueprints !== history.state.blueprints) saveBlueprints(next.state.blueprints);
  history = next;
  view(history.state);
};

// Turning the view keeps the spot in the middle of the screen where it is, so the map turns in place
const keepCenter = (from: View, to: View): void => {
  const middle = { x: app.screen.width / 2, y: app.screen.height / 2 };
  const local = world.toLocal(middle);
  const there = pointToView(pointFromView(toGridPoint(local.x, local.y), from), to);
  const s = toScreen(there.x, there.y);
  world.x = middle.x - s.sx * world.scale.x;
  world.y = middle.y - s.sy * world.scale.y;
};

const scene = createScene(world);

// Blueprint cards show their pieces drawn as the game would, rendered once per blueprint and facing.
// The library itself is drawn in the turned (view) state, so a turned view gets its own picture.
const previews = new WeakMap<Blueprint, string>();
const preview = (b: Blueprint): string => {
  const known = previews.get(b);
  if (known) return known;
  const url = toDataUrl(app.renderer, (g) => drawPiecesPreview(g, { ...initialState, wallView: 'cutaway' }, b.pieces));
  previews.set(b, url);
  return url;
};

const hud = createHud(dispatch, createIcons(app.renderer), preview);
// Both draw the world as the camera sees it (see view.ts)
const view = (s: State): void => {
  const seen = toView(s);
  scene.render(seen);
  hud.render(seen, { canUndo: canUndo(history), canRedo: canRedo(history) });
};

bindInput(app, world, dispatch, () => history.state);

// The blueprint library kept from earlier visits (not an undo step: it is not part of the world)
history = step(history, { type: 'loadBlueprints', blueprints: loadBlueprints() });
view(history.state);
