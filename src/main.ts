// Composition root: wires state, views and input together.
import { Application, Container } from 'pixi.js';
import './style.css';
import { type Camera, clampCamera, startCamera } from './camera';
import { DEFAULT_GRID } from './config';
import { sizeOf, toGridPoint, toScreen } from './geometry';
import { bindInput } from './input';
import { createGameMenu } from './render/gameMenu';
import { createHud } from './render/hud';
import { createIcons, toDataUrl } from './render/icons';
import { loadBlueprints, saveBlueprints } from './blueprintStore';
import { createScene, drawPiecesPreview } from './render/scene';
import type { ScreenWindow } from './render/drawables';
import { type HistoryAction, canRedo, canUndo, initialHistory, step } from './history';
import { type SaveEntry, deleteGame, newGameId, readGame, readIndex, readLast, readSettings, renameGame, writeGame, writeLast, writeSettings } from './saveStore';
import { type AutosaveMinutes, type Session, cleanName, freeGameName, isDirty, newSession, piecesLeftOut } from './session';
import { type View, pointFromView, pointToView, sizeInView, toView } from './view';
import { type Blueprint, type GameWorld, type State, emptyWorld, initialState } from './world';
import type { World } from './history';

const app = new Application();
await app.init({ background: '#1e293b', resizeTo: window, antialias: true });
document.body.prepend(app.canvas);

const world = new Container();
app.stage.addChild(world);
// Input is read on the stage (input.ts), so nothing in the world needs hit testing: on a big map,
// testing the pointer against every drawn shape on each move was most of the frame
world.eventMode = 'none';
world.interactiveChildren = false;
const screen = () => ({ w: app.screen.width, h: app.screen.height });
const setCamera = (c: Camera): void => {
  world.scale.set(c.scale);
  world.x = c.x;
  world.y = c.y;
};
// A fresh look at the map in the state's view: centered, zoomed for the screen (on a new game or load)
const resetCamera = (s: State): void => {
  setCamera(startCamera(sizeInView(s.size, s.view), screen()));
  drawn = null;
};

// ===== What part of the world is drawn =====
// The screen plus half a screen on every side, in the world container's own pixels. Panning, or
// zooming in, inside it needs no redraw; leaving it (a long pan, zooming out, a resize) draws afresh
// around the new view. A turn of the camera moves everything, so it starts a new window too.
let drawn: ScreenWindow | null = null;
const onScreen = (): ScreenWindow => {
  const a = world.toLocal({ x: 0, y: 0 }), b = world.toLocal({ x: app.screen.width, y: app.screen.height });
  return { left: a.x, top: a.y, right: b.x, bottom: b.y };
};
const holds = (outer: ScreenWindow, inner: ScreenWindow): boolean =>
  inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom;
const drawWindow = (): ScreenWindow => {
  const v = onScreen();
  if (drawn && holds(drawn, v)) return drawn;
  const [w, h] = [v.right - v.left, v.bottom - v.top];
  drawn = { left: v.left - w / 2, right: v.right + w / 2, top: v.top - h / 2, bottom: v.bottom + h / 2 };
  return drawn;
};

// The only mutable binding in the app: the history, which holds the current state
let history = initialHistory;

const dispatch = (action: HistoryAction): void => {
  const next = step(history, action);
  if (next === history) return;
  if (next.state.view !== history.state.view) {
    keepCenter(history.state.view, next.state.view);
    drawn = null;
  }
  if (next.state.blueprints !== history.state.blueprints) saveBlueprints(next.state.blueprints);
  history = next;
  view(history.state);
};

// Turning the view keeps the spot in the middle of the screen where it is, so the map turns in place
const keepCenter = (from: View, to: View): void => {
  const middle = { x: app.screen.width / 2, y: app.screen.height / 2 };
  const local = world.toLocal(middle);
  const size = history.state.size;
  const there = pointToView(pointFromView(toGridPoint(local.x, local.y), from, size), to, size);
  const s = toScreen(there.x, there.y);
  setCamera(clampCamera({ x: middle.x - s.sx * world.scale.x, y: middle.y - s.sy * world.scale.y, scale: world.scale.x }, sizeInView(size, to), screen()));
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
  scene.render(seen, drawWindow());
  hud.render(seen, { canUndo: canUndo(history), canRedo: canRedo(history) });
  refreshMenu();
};

// ===== The game being played =====
// The second mutable binding: which game this is and what was last written (see session.ts). Undo history
// stays apart from it. Saving always writes the committed world, so a group held mid-move is saved where
// it was picked up from.
let session: Session = newSession('Game 1', readSettings().autosaveMinutes);
let index: readonly SaveEntry[] = readIndex();
let notice: string | null = null;
let noticeTimer: number | undefined;

const committedGame = (): GameWorld => ({ ...history.committed, size: history.state.size, rotation: history.state.rotation });

const refreshMenu = (): void =>
  menu.render({
    session,
    dirty: isDirty(session, history.committed),
    saves: index,
    notice,
    now: Date.now(),
    suggestedName: freeGameName(index.map((e) => e.name)),
  });

const showNotice = (text: string): void => {
  notice = text;
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    notice = null;
    refreshMenu();
  }, 5000);
};

// One write: the first one gives the game its id. On a full store the old save stays and nothing else changes.
const writeSession = (id: number, name: string): 'ok' | 'full' => {
  const now = Date.now();
  const committed: World = history.committed;
  if (writeGame(id, name, committedGame(), now) === 'full') {
    session = { ...session, problem: 'full' };
    refreshMenu();
    return 'full';
  }
  writeLast(id);
  session = { ...session, gameId: id, name, saved: committed, savedAt: now, problem: null };
  index = readIndex();
  restartAutosave();
  refreshMenu();
  return 'ok';
};

const save = (): 'ok' | 'full' => writeSession(session.gameId ?? newGameId(), session.name);
const saveAs = (name: string): 'ok' | 'full' => writeSession(newGameId(), name);

// Autosave: one timer, restarted whenever the interval changes or a save happens. A drag in progress
// waits 10 seconds; leaving the page saves too (unless autosave is off).
let autosaveTimer: number | undefined;
const restartAutosave = (): void => {
  window.clearTimeout(autosaveTimer);
  if (session.autosaveMinutes === 0) return;
  autosaveTimer = window.setTimeout(autosave, session.autosaveMinutes * 60_000);
};
const autosave = (): void => {
  if (session.autosaveMinutes === 0) return;
  if (!isDirty(session, history.committed)) return restartAutosave();
  if (history.state.drag !== null) {
    autosaveTimer = window.setTimeout(autosave, 10_000);
    return;
  }
  if (save() === 'full') restartAutosave();
};
const saveOnLeave = (): void => {
  if (session.autosaveMinutes !== 0 && isDirty(session, history.committed)) save();
};
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && saveOnLeave());
window.addEventListener('pagehide', saveOnLeave);
window.setInterval(refreshMenu, 30_000); // keeps "N min ago" current

// Swaps in another world: new game or load. Fresh history, a fresh look at the map, panel closed.
const enter = (game: GameWorld, next: (committed: World) => Session): void => {
  history = step(history, { type: 'replaceWorld', world: game });
  session = next(history.committed);
  index = readIndex();
  if (session.gameId !== null) writeLast(session.gameId);
  resetCamera(history.state);
  restartAutosave();
  menu.closePanel();
  view(history.state);
};

// Asks to save first when there is something to lose; true when it is fine to go on
const leave = (): Promise<boolean> =>
  isDirty(session, history.committed) ? menu.askToSave({ name: session.name, neverSaved: session.saved === null, save }) : Promise.resolve(true);

const newGame = async (name: string, w: number, h: number): Promise<boolean> => {
  if (!(await leave())) return false;
  enter(emptyWorld(sizeOf(w, h)), () => newSession(name, session.autosaveMinutes));
  return true;
};

const load = async (id: number): Promise<boolean> => {
  const entry = readIndex().find((e) => e.id === id);
  const loaded = entry ? readGame(id) : null;
  if (!entry || !loaded) {
    showNotice("Couldn't open that save");
    refreshMenu();
    return false;
  }
  if (!(await leave())) return false;
  if (loaded.dropped > 0) showNotice(piecesLeftOut(loaded.dropped));
  else notice = null;
  enter(loaded.world, (committed) => ({ gameId: id, name: entry.name, saved: committed, savedAt: entry.savedAt, problem: null, autosaveMinutes: session.autosaveMinutes }));
  return true;
};

const menu = createGameMenu({
  save,
  saveAs,
  newGame,
  load,
  rename: (id, name) => {
    if (renameGame(id, name) === 'full') session = { ...session, problem: 'full' };
    else if (session.gameId === id) session = { ...session, name: cleanName(name, session.name) };
    index = readIndex();
    refreshMenu();
  },
  remove: (id) => {
    deleteGame(id);
    index = readIndex();
    // the game being played goes on, as one that was never saved
    if (session.gameId === id) session = { ...session, gameId: null, saved: null, savedAt: null, problem: null };
    refreshMenu();
  },
  setAutosave: (minutes: AutosaveMinutes) => {
    session = { ...session, autosaveMinutes: minutes };
    writeSettings({ autosaveMinutes: minutes });
    restartAutosave();
    refreshMenu();
  },
});

bindInput(app, world, dispatch, () => history.state);
// The camera moves outside dispatch (pan, zoom, keys); once it leaves the drawn window, draw again
app.ticker.add(() => {
  if (drawn && !holds(drawn, onScreen())) view(history.state);
});

// The blueprint library kept from earlier visits (not an undo step: it is not part of the world)
history = step(history, { type: 'loadBlueprints', blueprints: loadBlueprints() });

// Start where the player left off: the game played last, else the newest save, else a fresh Game 1
// that is not written until something is built or Save is pressed
const boot = (): void => {
  const order = [readLast(), ...index.map((e) => e.id)].filter((id): id is number => id !== null);
  for (const id of order) {
    const entry = index.find((e) => e.id === id);
    const loaded = entry ? readGame(id) : null;
    if (!entry || !loaded) continue;
    if (loaded.dropped > 0) showNotice(piecesLeftOut(loaded.dropped));
    return enter(loaded.world, (committed) => ({ gameId: id, name: entry.name, saved: committed, savedAt: entry.savedAt, problem: null, autosaveMinutes: session.autosaveMinutes }));
  }
  enter(emptyWorld(sizeOf(DEFAULT_GRID, DEFAULT_GRID)), () => newSession(freeGameName(index.map((e) => e.name)), session.autosaveMinutes));
};
boot();
