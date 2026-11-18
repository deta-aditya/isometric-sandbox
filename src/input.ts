import { CATEGORIES } from './catalog';
import { GUIDES_ENABLED } from './config';
// Input: Pixi/DOM events -> Actions. Camera (pan/zoom) is view state handled here directly.
import type { Application, Container, FederatedPointerEvent } from 'pixi.js';
import { type Cell, type Point, cellOf, toGridPoint } from './geometry';
import type { HistoryAction } from './history';
import { clampCamera, clampZoom } from './camera';
import { sizeInView } from './view';
import type { State } from './world';

const PAN_SPEED = 720; // screen pixels per second while a pan key is held
const CLICK_SLOP = 4; // a right-button press that moves less than this is a click, not a pan

// Held keys that pan the camera, and which way each one moves the view
const PAN_KEYS: Readonly<Record<string, readonly [number, number]>> = {
  w: [0, 1],
  arrowup: [0, 1],
  s: [0, -1],
  arrowdown: [0, -1],
  a: [1, 0],
  arrowleft: [1, 0],
  d: [-1, 0],
  arrowright: [-1, 0],
};

export const bindInput = (
  app: Application,
  world: Container,
  dispatch: (a: HistoryAction) => void,
  getState: () => State,
): void => {
  // Pan and zoom stay within the map's limits for the view being looked at
  const keepOnMap = (): void => {
    const s = getState();
    const c = clampCamera({ x: world.x, y: world.y, scale: world.scale.x }, sizeInView(s.size, s.view), { w: app.screen.width, h: app.screen.height });
    world.scale.set(c.scale);
    world.x = c.x;
    world.y = c.y;
  };

  // Exact grid position under the pointer, and the cell containing it
  const pointerAt = (e: FederatedPointerEvent): { cell: Cell; point: Point } => {
    const local = world.toLocal(e.global);
    const point = toGridPoint(local.x, local.y);
    return { cell: cellOf(point), point };
  };

  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;
  app.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Pan with right or middle drag, or Space + left drag. Left button alone is for building.
  let spaceHeld = false;
  let pan: { button: number; startX: number; startY: number; worldX: number; worldY: number; moved: boolean } | null =
    null;

  app.stage.on('pointerdown', (e) => {
    if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceHeld)) {
      pan = { button: e.button, startX: e.global.x, startY: e.global.y, worldX: world.x, worldY: world.y, moved: false };
      app.canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button === 0) dispatch({ type: 'press', ...pointerAt(e) });
  });

  app.stage.on('pointermove', (e) => {
    lastPointer = { x: e.global.x, y: e.global.y };
    if (pan) {
      const dx = e.global.x - pan.startX;
      const dy = e.global.y - pan.startY;
      if (Math.hypot(dx, dy) > CLICK_SLOP) pan.moved = true;
      world.x = pan.worldX + dx;
      world.y = pan.worldY + dy;
      keepOnMap();
    }
    dispatch({ type: 'hover', ...pointerAt(e) });
  });

  const release = (): void => {
    if (pan) {
      // A right click (not a drag) leaves build, picker or bulldoze, like Esc,
      const rightClick = pan.button === 2 && !pan.moved;
      pan = null;
      app.canvas.style.cursor = spaceHeld ? 'grab' : '';
      // ...and in select it lets go of marks, a moved group or a paste, also like Esc
      const s = getState();
      if (rightClick && (s.tool !== 'select' || s.selection !== null)) dispatch({ type: 'cancel' }); // exactly what Esc does
      return;
    }
    dispatch({ type: 'release' });
  };
  app.stage.on('pointerup', release);
  app.stage.on('pointerupoutside', release);

  app.canvas.addEventListener('pointerleave', () => {
    if (!getState().drag) dispatch({ type: 'hover', cell: null, point: null });
  });

  // Zoom anchored on the cursor
  app.canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const cursor = { x: e.offsetX, y: e.offsetY };
      const anchor = world.toLocal(cursor);
      const s = getState();
      const scale = clampZoom(world.scale.x * (e.deltaY < 0 ? 1.1 : 0.9), sizeInView(s.size, s.view), { w: app.screen.width, h: app.screen.height });
      world.scale.set(scale);
      const moved = world.toGlobal(anchor);
      world.x += cursor.x - moved.x;
      world.y += cursor.y - moved.y;
      keepOnMap();
    },
    { passive: false },
  );

  // ----- Keyboard panning: WASD or arrows, smooth while held -----
  const heldPanKeys = new Set<string>();
  let lastPointer: { x: number; y: number } | null = null;

  app.ticker.add((ticker) => {
    if (heldPanKeys.size === 0) return;
    const step = (PAN_SPEED * ticker.deltaMS) / 1000;
    heldPanKeys.forEach((k) => {
      const [dx, dy] = PAN_KEYS[k] ?? [0, 0];
      world.x += dx * step;
      world.y += dy * step;
    });
    keepOnMap();
    refreshHover();
  });

  // The world slid (or turned) under a still pointer, so the hovered cell may have changed
  const refreshHover = (): void => {
    if (!lastPointer) return;
    const local = world.toLocal(lastPointer);
    const point = toGridPoint(local.x, local.y);
    dispatch({ type: 'hover', cell: cellOf(point), point });
  };

  window.addEventListener('blur', () => {
    heldPanKeys.clear();
    dispatch({ type: 'setShift', held: false });
    dispatch({ type: 'setCtrl', held: false });
  });
  app.canvas.addEventListener('pointerleave', () => (lastPointer = null));

  window.addEventListener('keyup', (e) => {
    heldPanKeys.delete(e.key.toLowerCase());
    if (e.key === 'Shift') dispatch({ type: 'setShift', held: false });
    if (e.key === 'Control' || e.key === 'Meta') dispatch({ type: 'setCtrl', held: false });
    if (e.key === ' ') {
      spaceHeld = false;
      if (!pan) app.canvas.style.cursor = '';
    }
  });

  window.addEventListener('keydown', (e) => {
    // Typing into a text field (a blueprint's name) is not a game shortcut
    if (e.target instanceof HTMLInputElement) return;
    // Shift turns a bulldoze click into clearing the room under the cursor
    if (e.key === 'Shift') return dispatch({ type: 'setShift', held: true });
    // Ctrl (or Cmd) with Shift makes a fill spread over every floor or paint
    if (e.key === 'Control' || e.key === 'Meta') return dispatch({ type: 'setCtrl', held: true });
    // Undo: Ctrl/Cmd+Z; redo: Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      const redo = e.key === 'y' || e.key === 'Y' || e.shiftKey;
      return dispatch({ type: redo ? 'redo' : 'undo' });
    }
    // Ctrl (or Cmd) + C, X, V: copy, cut and paste what is marked
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const key = e.key.toLowerCase();
      const clip = key === 'c' ? 'copy' : key === 'x' ? 'cut' : key === 'v' ? 'paste' : null;
      if (clip) {
        e.preventDefault();
        dispatch({ type: clip });
        if (clip === 'paste') refreshHover();
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) return; // leave other browser shortcuts alone
    const panKey = e.key.toLowerCase();
    if (PAN_KEYS[panKey]) {
      e.preventDefault();
      heldPanKeys.add(panKey);
      return;
    }
    const level = getState().level;
    switch (e.key) {
      case ' ':
        e.preventDefault();
        spaceHeld = true;
        if (!pan) app.canvas.style.cursor = 'grab';
        return;
      // Q: in select mode, build more of the hovered thing; elsewhere, previous category
      case 'q':
      case 'Q':
        return dispatch(getState().tool === 'select' ? { type: 'pickHovered' } : { type: 'cycleCategory', dir: -1 });
      case 'e':
      case 'E':
        return dispatch({ type: 'cycleCategory', dir: 1 });
      case 'Tab':
        e.preventDefault();
        return dispatch({ type: 'cycleGroup', dir: e.shiftKey ? -1 : 1 });
      // R turns a quarter clockwise; Shift + R turns back
      case 'r':
      case 'R':
        return dispatch({ type: 'rotate', dir: e.shiftKey ? -1 : 1 });
      case 'b':
      case 'B':
        return dispatch({ type: 'toggleBulldoze' });
      case 'm':
      case 'M':
        return dispatch({ type: 'toggleWallMode' });
      case 'v':
      case 'V':
        return dispatch({ type: 'useSelect' });
      case 'i':
      case 'I':
        return dispatch({ type: 'togglePicker' });
      case 'g':
      case 'G':
        // G: grid lines; Shift + G: the guide tool (when guides are turned on)
        if (e.shiftKey) return GUIDES_ENABLED ? dispatch({ type: 'toggleGuideTool' }) : undefined;
        return dispatch({ type: 'toggleGrid' });
      // , and . turn the view (also < and >, as in other builder games)
      case ',':
      case '<':
        dispatch({ type: 'rotateView', dir: -1 });
        return refreshHover();
      case '.':
      case '>':
        dispatch({ type: 'rotateView', dir: 1 });
        return refreshHover();
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        return dispatch({ type: 'deleteSelection' });
      case 'PageUp':
      case ']':
        e.preventDefault();
        return dispatch({ type: 'setLevel', level: level + 1 });
      case 'PageDown':
      case '[':
        e.preventDefault();
        return dispatch({ type: 'setLevel', level: level - 1 });
      case 'Escape':
        return dispatch({ type: 'cancel' });
    }
    // Shift + 1 to 4 switch the select filter (with Shift the key reads !, @ ..., so go by the key's position)
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (e.shiftKey && digit && getState().tool === 'select') {
      const category = CATEGORIES[Number(digit[1]) - 1];
      return category ? dispatch({ type: 'toggleSelectFilter', category: category.id }) : undefined;
    }
    const index = Number(e.key) - 1;
    if (!Number.isInteger(index) || index < 0) return;
    // While bulldozing, 1 to 4 switch the filter for each category instead of picking items
    const category = CATEGORIES[index];
    if (getState().tool === 'bulldoze') return category ? dispatch({ type: 'toggleBulldozeFilter', category: category.id }) : undefined;
    dispatch({ type: 'selectIndex', index });
  });
};
