// HUD view: State -> DOM. Bottom bar with category icons, an item tray above it,
// a current-tool chip, floor switcher, help popover and a small status pill.
import { guideFromView, pointFromView, sizeInView } from '../view';
import { isCutLow } from './drawables';
import {
  CATEGORIES,
  type CatalogItem,
  type CategoryId,
  type GroupId,
  footprintOf,
  getItem,
  groupsOf,
  trayItemOf,
  itemsIn,
} from '../catalog';
import { GUIDES_ENABLED, LEVELS, LEVEL_SHORT_NAMES } from '../config';
import type { HistoryAction } from '../history';
import { type Blueprint, type Guide, type State, type WallMode, type WallView, boxTargets, canSaveBlueprint, guideDragTarget, guideUnder, bulldozePlan, justCopied, pieceCount, culvertPlan, eraseTarget, floorFill, openingPlan, paintPlan, sourceItem, squareDraft, wallAt, wallDraft } from '../world';
import { BLUEPRINT_ICON, BULLDOZE_ICON, GUIDE_ICON, type Icons, PICKER_ICON, SAVE_BLUEPRINT_ICON, SELECT_ICON, squareIcon } from './icons';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, html?: string) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

const button = (className: string, html: string, onClick: () => void): HTMLButtonElement => {
  const b = el('button', className, html);
  b.addEventListener('click', () => {
    onClick();
    b.blur(); // keep keyboard shortcuts (Space, digits) away from focused buttons
  });
  return b;
};

const icon = (icons: Icons, id: string): string => `<img src="${icons.get(id) ?? ''}" alt="" draggable="false" />`;

const hint = (item: CatalogItem, state: State): string => {
  // Shift with a floor: a fill (Ctrl: over every floor)
  const fill = floorFill(state);
  if (fill) return `${fill.mode === 'all' ? 'Fill all' : 'Fill'} · ${fill.cells.length} tiles`;
  switch (item.kind) {
    case 'paint': {
      // the far side of a back wall faces away from the camera, so say so rather than show nothing
      const plan = paintPlan(state);
      if (plan?.fill) {
        return plan.targets.length === 0
          ? 'Shift: point at a wall'
          : `${plan.fill === 'all' ? 'Fill all' : 'Fill'} · ${plan.targets.length} sides`;
      }
      const first = plan?.targets[0];
      return first && first.side === 'before' && !isCutLow(state, first.wall)
        ? 'paints the hidden side'
        : 'click or drag along walls';
    }
    case 'object': {
      const fp = footprintOf(item, state.rotation);
      return `${fp.w}x${fp.h}`;
    }
    case 'tile':
      return 'drag to paint';
    case 'culvert':
      return 'drag along a bank';
    case 'wall':
      return state.wallMode === 'square' ? 'Square · drag a rectangle' : 'Line · drag along grid lines';
    case 'opening':
      return item.pieces ? 'drag along a wall' : 'click a wall';
  }
};

const MODES: readonly { mode: WallMode; label: string }[] = [
  { mode: 'line', label: 'Line' },
  { mode: 'square', label: 'Square' },
];

// What the chip on the left of the bar says for the current tool and selection
const toolChip = (state: State): Readonly<{ icon: string; title: string; detail: string }> => {
  const named = (g: Guide) => {
    const w = guideFromView(g, state.view, state.size);
    return `${w.axis} ${w.at}`;
  };
  switch (state.tool) {
    case 'bulldoze': {
      const plan = bulldozePlan(state);
      const n = plan?.targets.length ?? 0;
      const count = `${n} to remove`;
      const detail = plan?.outdoors
        ? 'Shift: not in a room'
        : plan?.room
          ? `Room · ${count}`
          : plan?.area
            ? `${plan.area.w}x${plan.area.h} · ${count}`
            : 'drag a box · Shift room';
      return { icon: BULLDOZE_ICON, title: 'Bulldoze', detail };
    }
    case 'guide': {
      const title = state.guides.length > 0 ? `Guides · ${state.guides.length}` : 'Guides';
      if (state.drag?.mode === 'guide') {
        const target = guideDragTarget(state);
        return { icon: GUIDE_ICON, title, detail: target === 'remove' || !target ? 'let go to remove' : `move to ${named(target)}` };
      }
      const hit = guideUnder(state, state.point);
      if (!hit) return { icon: GUIDE_ICON, title, detail: 'point at a grid line' };
      return hit.index === null
        ? { icon: GUIDE_ICON, title, detail: `click to add ${named(hit.guide)}` }
        : { icon: GUIDE_ICON, title: `Guide ${named(hit.guide)}`, detail: 'drag · click removes' };
    }
    case 'picker': {
      const hit = state.hover ? eraseTarget(state, state.hover, state.point) : null;
      return { icon: PICKER_ICON, title: 'Picker', detail: hit ? `copy ${getItem(sourceItem(hit)).name}` : 'click an item' };
    }
    case 'select': {
      const sel = state.selection;
      // a box being dragged says how much it would mark
      if (state.drag?.mode === 'box') {
        const n = boxTargets(state).length;
        return { icon: SELECT_ICON, title: 'Select', detail: n ? `Box · ${n} ${n === 1 ? 'thing' : 'things'}` : 'drag a box' };
      }
      switch (sel?.kind) {
        case undefined:
          return { icon: SELECT_ICON, title: 'Select', detail: 'click or drag a box' };
        case 'group': {
          const n = pieceCount(sel.pieces);
          const only = sel.pieces.objects[0];
          const detail = sel.copy ? 'Pasting · click to place' : 'Moving · click to drop';
          if (sel.name) return { icon: BLUEPRINT_ICON, title: sel.name, detail };
          if (n === 1 && only) {
            const def = getItem(only.defId);
            return { icon: def.id, title: def.name, detail };
          }
          return { icon: SELECT_ICON, title: `${n} things`, detail };
        }
        case 'opening': {
          const def = getItem(trayItemOf(sel.openingIds[0] ?? ''));
          return { icon: def.id, title: def.name, detail: 'Moving · click a wall' };
        }
        case 'marked': {
          const n = sel.targets.length;
          const only = sel.targets[0];
          const copied = justCopied(state) ? 'Copied · Ctrl+V to paste' : null;
          if (n === 1 && only) {
            const def = getItem(sourceItem(only));
            return { icon: def.id, title: def.name, detail: copied ?? 'Del to remove' };
          }
          return { icon: SELECT_ICON, title: `${n} selected`, detail: copied ?? 'click to move' };
        }
      }
    }
    case 'build': {
      const item = getItem(state.selectedId);
      const draft =
        state.drag?.mode === 'span'
          ? (openingPlan(state)?.edges.length ?? 0)
          : state.drag?.mode === 'culvert'
            ? (culvertPlan(state)?.edges.length ?? 0)
            : state.drag?.mode === 'wallPaint'
              ? (paintPlan(state)?.targets.length ?? 0)
              : wallDraft(state).length;
      const square = squareDraft(state);
      const detail = square
        ? `Square · ${square.w}x${square.h}`
        : draft
          ? `${draft} segment${draft === 1 ? '' : 's'}`
          : hint(item, state);
      return { icon: item.id, title: item.name, detail };
    }
  }
};

const UNDO_SVG =
  "<svg viewBox='0 0 24 24' width='16' height='16' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'>" +
  "<path d='M9 14 L4 9 L9 4'/><path d='M4 9 H14 a6 6 0 0 1 0 12 H11'/></svg>";
const REDO_SVG =
  "<svg viewBox='0 0 24 24' width='16' height='16' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'>" +
  "<path d='M15 14 L20 9 L15 4'/><path d='M20 9 H10 a6 6 0 0 0 0 12 H13'/></svg>";

// Any row that scrolls sideways fades the side that has more to reveal, so it is clear you can swipe.
// Returns a refresh function for when the row's contents change.
const scrollHints = (row: HTMLElement): (() => void) => {
  const sync = () => {
    const more = row.scrollWidth - row.clientWidth;
    row.classList.toggle('more-left', more > 1 && row.scrollLeft > 1);
    row.classList.toggle('more-right', more > 1 && row.scrollLeft < more - 1);
  };
  row.addEventListener('scroll', sync, { passive: true });
  new ResizeObserver(sync).observe(row);
  sync();
  return sync;
};

// Wall view icons: a tall wall, a tall back wall with a low front wall, and a low wall
// A circular arrow, turning one way or the other (mirrored for counterclockwise)
const turnSvg = (clockwise: boolean): string =>
  "<svg viewBox='0 0 24 24' width='14' height='14' fill='none' stroke='currentColor' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'>" +
  `<g${clockwise ? '' : " transform='translate(24 0) scale(-1 1)'"}>` +
  "<path d='M20 12 a8 8 0 1 1 -2.6 -5.9'/><path d='M20 3.5 V8 H15.5'/></g></svg>";
const TURN_LEFT_SVG = turnSvg(false);
const TURN_RIGHT_SVG = turnSvg(true);

// Two lines crossing on a tile: the guide tool
const GUIDE_SVG =
  "<svg viewBox='0 0 24 24' width='16' height='16' fill='none' stroke='currentColor' stroke-width='1.6' stroke-linecap='round'>" +
  "<path d='M12 5 L21 10 L12 15 L3 10 Z' opacity='0.45'/><path d='M5 4 L19 16'/><path d='M19 4 L5 16'/></svg>";

const GRID_SVG =
  "<svg viewBox='0 0 24 24' width='16' height='16' fill='none' stroke='currentColor' stroke-width='1.6'>" +
  "<path d='M12 3 L21 8 L12 13 L3 8 Z'/><path d='M7.5 5.5 L16.5 10.5'/><path d='M16.5 5.5 L7.5 10.5'/>" +
  "<path d='M3 13 L12 18 L21 13' opacity='0.5'/></svg>";

const wallViewSvg = (paths: string): string =>
  `<svg viewBox='0 0 24 16' width='20' height='14' fill='currentColor'>${paths}</svg>`;
const WALL_VIEWS: readonly { view: WallView; label: string; svg: string }[] = [
  { view: 'up', label: 'Walls up', svg: wallViewSvg("<rect x='5' y='1' width='14' height='14' rx='1'/>") },
  {
    view: 'cutaway',
    label: 'Cutaway',
    svg: wallViewSvg("<rect x='3' y='1' width='8' height='14' rx='1'/><rect x='13' y='10' width='8' height='5' rx='1'/>"),
  },
  { view: 'down', label: 'Walls down', svg: wallViewSvg("<rect x='3' y='10' width='18' height='5' rx='1'/>") },
];

export type HistoryFlags = Readonly<{ canUndo: boolean; canRedo: boolean }>;

export const createHud = (dispatch: (a: HistoryAction) => void, icons: Icons, preview: (b: Blueprint) => string) => {
  const bar = document.getElementById('bar')!;
  const tray = document.getElementById('tray')!;
  const status = document.getElementById('status')!;
  const help = document.getElementById('help')!;

  // ----- Left: current tool chip -----
  const tool = el('div', 'tool');
  const toolIcon = el('img');
  toolIcon.alt = '';
  const toolText = el('div', 'tool-text');
  const toolTitle = el('b');
  const toolDetail = el('span');
  // Filters: one toggle per category, shown while bulldozing (keys 1 to 4) or selecting (Shift + 1 to 4).
  // Each tool keeps its own setting; the same buttons show whichever tool is in use.
  const filters = el('div', 'bulldoze-filters');
  const filterButtons = CATEGORIES.map((c, i) => {
    const b = button('filter-toggle', icon(icons, c.icon), () =>
      dispatch(currentTool === 'select' ? { type: 'toggleSelectFilter', category: c.id } : { type: 'toggleBulldozeFilter', category: c.id }));
    return { id: c.id, name: c.name, key: i + 1, el: b };
  });
  let currentTool: State['tool'] = 'select';
  filters.append(...filterButtons.map((f) => f.el));
  // The guide tool's one action besides pointing: take every guide away
  const clearGuides = button('chip-action', 'Clear all', () => dispatch({ type: 'clearGuides' }));
  clearGuides.title = 'Remove every guide line';
  toolText.append(toolTitle, toolDetail, filters, clearGuides);
  tool.append(toolIcon, toolText);

  // ----- Center: one icon per category -----
  const categories = CATEGORIES.map((c) => ({
    id: c.id,
    el: button('category', `${icon(icons, c.icon)}<span>${c.name}</span>`, () =>
      dispatch({ type: 'selectCategory', category: c.id }),
    ),
  }));
  // Tool buttons sit in the same row but switch modes instead of opening a tray
  const bulldoze = button('category tool-button', `${icon(icons, BULLDOZE_ICON)}<span>Bulldoze</span>`, () =>
    dispatch({ type: 'toggleBulldoze' }),
  );
  const selectButton = button('category tool-button select-button', `${icon(icons, SELECT_ICON)}<span>Select</span>`, () =>
    dispatch({ type: 'useSelect' }),
  );
  const pickerButton = button('category tool-button picker-button', `${icon(icons, PICKER_ICON)}<span>Picker</span>`, () =>
    dispatch({ type: 'togglePicker' }),
  );
  // Blueprints sit with the categories: they open a tray of saved groups to place
  const blueprintsButton = button('category blueprints-button', `${icon(icons, BLUEPRINT_ICON)}<span>Blueprints</span>`, () =>
    dispatch({ type: 'toggleBlueprints' }),
  );
  const categoryRow = el('div', 'categories');
  categoryRow.append(
    selectButton,
    pickerButton,
    el('div', 'divider'),
    ...categories.map((c) => c.el),
    blueprintsButton,
    el('div', 'divider'),
    bulldoze,
  );

  // ----- Right: floor switcher and help -----
  const floors = LEVELS.map((name, level) => ({
    level,
    // Full name on wide screens, short name on phones (CSS picks one)
    el: button('floor', `<span class="long">${name}</span><span class="short">${LEVEL_SHORT_NAMES[level] ?? name}</span>`, () =>
      dispatch({ type: 'setLevel', level }),
    ),
  }));
  const floorGroup = el('div', 'floors');
  floorGroup.append(...[...floors].reverse().map((f) => f.el)); // highest floor first
  const helpButton = button('help-toggle', '?', () => help.toggleAttribute('hidden'));
  const undoButton = button('history-button', UNDO_SVG, () => dispatch({ type: 'undo' }));
  const redoButton = button('history-button', REDO_SVG, () => dispatch({ type: 'redo' }));
  undoButton.title = 'Undo (Ctrl+Z)';
  redoButton.title = 'Redo (Ctrl+Shift+Z)';
  const historyGroup = el('div', 'history');
  historyGroup.append(undoButton, redoButton);

  // Wall view switch, next to undo/redo
  const wallViews = WALL_VIEWS.map(({ view, label, svg }) => {
    const b = button('wall-view-button', svg, () => dispatch({ type: 'setWallView', view }));
    b.title = label;
    b.setAttribute('aria-label', label);
    return { view, el: b };
  });
  const wallViewGroup = el('div', 'wall-view');
  wallViewGroup.append(...wallViews.map((w) => w.el));

  // Grid lines on or off, and the guide tool under it, next to the wall view switch
  const gridButton = button('grid-button', GRID_SVG, () => dispatch({ type: 'toggleGrid' }));
  gridButton.setAttribute('aria-label', 'Grid lines');
  const guideButton = button('grid-button guide-button', GUIDE_SVG, () => dispatch({ type: 'toggleGuideTool' }));
  guideButton.setAttribute('aria-label', 'Guide lines');
  const viewAids = el('div', 'view-aids');
  viewAids.append(gridButton);
  if (GUIDES_ENABLED) viewAids.append(guideButton);

  // Turn the camera, next to the grid toggle
  const turnLeft = button('turn-button', TURN_LEFT_SVG, () => dispatch({ type: 'rotateView', dir: -1 }));
  const turnRight = button('turn-button', TURN_RIGHT_SVG, () => dispatch({ type: 'rotateView', dir: 1 }));
  turnLeft.title = 'Turn the view counterclockwise (,)';
  turnRight.title = 'Turn the view clockwise (.)';
  turnLeft.setAttribute('aria-label', 'Turn the view counterclockwise');
  turnRight.setAttribute('aria-label', 'Turn the view clockwise');
  const turnGroup = el('div', 'turn');
  turnGroup.append(turnLeft, turnRight);

  const right = el('div', 'bar-right');
  right.append(historyGroup, wallViewGroup, viewAids, turnGroup, floorGroup, helpButton);

  bar.append(tool, categoryRow, right);

  // The tray and help panel sit above the bar; its height changes between layouts (one row on wide
  // screens, two on phones), so publish the real height for the CSS to use
  const syncBarHeight = () => document.documentElement.style.setProperty('--bar-height', `${bar.offsetHeight}px`);
  new ResizeObserver(syncBarHeight).observe(bar);
  syncBarHeight();

  scrollHints(categoryRow);

  // ----- Tray: a tab strip on top, items below. Single-group categories still show their one tab,
  // so the tray keeps the same shape everywhere.
  // Rebuilt only when the category or group changes, so buttons survive hover re-renders.
  const tabsEl = el('div', 'tabs');
  const itemsEl = el('div', 'items');
  tray.append(tabsEl, itemsEl);
  const refreshTabHints = scrollHints(tabsEl);
  const refreshItemHints = scrollHints(itemsEl);

  let shownCategory: CategoryId | null = null;
  let tabs: { id: GroupId; el: HTMLButtonElement }[] = [];
  const showCategory = (category: CategoryId): void => {
    tabs = groupsOf(category).map((g) => ({
      id: g.id,
      el: button('tab', `${icon(icons, itemsIn(g.id)[0]?.id ?? '')}<span>${g.name}</span>`, () =>
        dispatch({ type: 'selectGroup', group: g.id }),
      ),
    }));
    tabsEl.replaceChildren(...tabs.map((t) => t.el));
    tabsEl.scrollLeft = 0;
    refreshTabHints();
    shownCategory = category;
  };

  // Each item is a card. Wall cards also carry a Line | Square switch, shown on hover and on the
  // selected card; picking a mode selects that wall style in that mode.
  let shownGroup: GroupId | null = null;
  let items: { id: string; card: HTMLElement; modes: { mode: WallMode; el: HTMLButtonElement }[] }[] = [];
  const showGroup = (group: GroupId): void => {
    items = itemsIn(group).map((item, i) => {
      const card = el('div', 'item-card');
      card.append(
        button('item', `${icon(icons, item.id)}<span class="name">${item.name}</span><kbd>${i + 1}</kbd>`, () =>
          dispatch({ type: 'select', id: item.id }),
        ),
      );
      const modes =
        item.kind === 'wall'
          ? MODES.map(({ mode, label }) => ({
              mode,
              el: button('mode', `${icon(icons, mode === 'square' ? squareIcon(item.id) : item.id)}<span>${label}</span>`, () => {
                dispatch({ type: 'select', id: item.id });
                dispatch({ type: 'setWallMode', mode });
              }),
            }))
          : [];
      if (modes.length > 0) {
        const switcher = el('div', 'modes');
        switcher.append(...modes.map((m) => m.el));
        card.append(switcher);
      }
      return { id: item.id, card, modes };
    });
    itemsEl.replaceChildren(...items.map((i) => i.card));
    itemsEl.scrollLeft = 0;
    refreshItemHints();
    shownGroup = group;
  };

  // ----- Blueprint tray: a Save card, then one card per saved blueprint (its picture, its name, and
  // small rename and delete buttons). Clicking a card holds a copy to place, like a paste. A new
  // blueprint opens its name for editing right away. Delete asks for a second click.
  let shownBlueprints: readonly Blueprint[] | null = null;
  let saveButton: HTMLButtonElement | null = null;
  let blueprintCards: { name: string; card: HTMLElement }[] = [];
  let renameNext = false; // set by Save: the next rebuild opens the new card's name
  let editing = false; // a name is being typed: keep the tray as it is until it is done
  let canSave = false; // something is marked, so the first card saves it

  // The name field sits over the card's name, beside its button rather than inside it (a key released
  // inside a button would press it), and the button rests while the name is typed
  const startRename = (card: HTMLElement, b: Blueprint): void => {
    const place = card.querySelector<HTMLButtonElement>('.item');
    if (!place || card.querySelector('.blueprint-name')) return;
    editing = true;
    const input = el('input', 'blueprint-name');
    input.value = b.name;
    input.maxLength = 40;
    input.setAttribute('aria-label', 'Blueprint name');
    place.disabled = true;
    card.classList.add('renaming');
    let done = false;
    const finish = (keep: boolean) => {
      if (done) return;
      done = true;
      editing = false;
      const name = input.value.trim();
      input.remove();
      place.disabled = false;
      card.classList.remove('renaming');
      if (keep && name && name !== b.name) dispatch({ type: 'renameBlueprint', id: b.id, name });
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing a name is not a game shortcut
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    input.addEventListener('blur', () => finish(true));
    card.append(input);
    input.focus();
    input.select();
  };

  const showBlueprints = (state: State): void => {
    tabsEl.replaceChildren(button('tab active', `${icon(icons, BLUEPRINT_ICON)}<span>Blueprints</span>`, () => undefined));
    refreshTabHints();
    const saveCard = el('div', 'item-card');
    // With things marked it saves them; with nothing marked it says what to do and switches to select
    saveButton = button('item', `${icon(icons, SAVE_BLUEPRINT_ICON)}<span class="name"></span>`, () => {
      renameNext = canSave;
      dispatch({ type: 'saveBlueprint' });
    });
    saveCard.append(saveButton);
    blueprintCards = state.blueprints.map((b, i) => {
      const card = el('div', 'item-card blueprint-card');
      const place = button('item', `<img src="${preview(b)}" alt="" draggable="false" /><span class="name"></span><kbd>${i + 1}</kbd>`, () =>
        dispatch({ type: 'placeBlueprint', id: b.id }),
      );
      place.querySelector('.name')!.textContent = b.name; // names are typed by the player: text, not HTML
      place.title = b.name;
      const rename = button('blueprint-action', '✎', () => startRename(card, b));
      rename.title = 'Rename';
      rename.setAttribute('aria-label', `Rename ${b.name}`);
      let armed = 0;
      const remove = button('blueprint-action remove', '✕', () => {
        if (Date.now() - armed < 3000) return dispatch({ type: 'deleteBlueprint', id: b.id });
        armed = Date.now();
        remove.classList.add('armed');
        remove.title = 'Click again to delete';
        setTimeout(() => { remove.classList.remove('armed'); remove.title = 'Delete'; }, 3000);
      });
      remove.title = 'Delete';
      remove.setAttribute('aria-label', `Delete ${b.name}`);
      const actions = el('div', 'blueprint-actions');
      actions.append(rename, remove);
      card.append(place, actions);
      return { name: b.name, card };
    });
    itemsEl.replaceChildren(saveCard, ...blueprintCards.map((c) => c.card));
    refreshItemHints();
    // a just-saved blueprint is the last one: scroll to it and open its name for typing
    const last = blueprintCards.at(-1);
    const newest = state.blueprints.at(-1);
    if (renameNext && last && newest) {
      renameNext = false;
      itemsEl.scrollLeft = itemsEl.scrollWidth;
      startRename(last.card, newest);
    }
    shownBlueprints = state.blueprints;
  };

  const render = (state: State, flags: HistoryFlags): void => {
    undoButton.disabled = !flags.canUndo;
    redoButton.disabled = !flags.canRedo;
    // The roof view always shows full walls, so the switch only applies on the 1st floor
    const roofView = state.level === LEVELS.length - 1;
    wallViews.forEach((w) => {
      w.el.classList.toggle('active', w.view === state.wallView);
      w.el.disabled = roofView;
      w.el.title = roofView ? `${WALL_VIEWS.find((v) => v.view === w.view)?.label} (1st floor only)` : (WALL_VIEWS.find((v) => v.view === w.view)?.label ?? '');
    });
    gridButton.classList.toggle('active', state.showGrid);
    gridButton.setAttribute('aria-pressed', String(state.showGrid));
    gridButton.title = state.showGrid ? 'Hide grid lines (G)' : 'Show grid lines (G)';
    const guiding = state.tool === 'guide';
    guideButton.classList.toggle('active', guiding);
    guideButton.setAttribute('aria-pressed', String(guiding));
    guideButton.title = guiding ? 'Stop adding guide lines (Shift+G)' : 'Add, move or remove guide lines (Shift+G)';
    clearGuides.toggleAttribute('hidden', !guiding || state.guides.length === 0);
    if (state.blueprintTray) {
      if (state.blueprints !== shownBlueprints && !editing) showBlueprints(state);
      shownCategory = null;
      shownGroup = null;
      canSave = canSaveBlueprint(state);
      if (saveButton) {
        const label = saveButton.querySelector('.name');
        if (label) label.textContent = canSave ? 'Save as blueprint' : 'Select things to save';
        saveButton.classList.toggle('hint', !canSave);
        saveButton.title = canSave
          ? 'Save the marked things as a blueprint'
          : 'Drag a box (or Shift + click) with the select tool to mark what the blueprint should hold';
      }
      const placing = state.selection?.kind === 'group' && state.selection.copy ? state.selection.name : undefined;
      blueprintCards.forEach((c) => c.card.classList.toggle('active', c.name === placing));
    } else {
      shownBlueprints = null;
      if (state.category !== shownCategory) showCategory(state.category);
      if (state.group !== shownGroup) showGroup(state.group);
    }
    blueprintsButton.classList.toggle('open', state.blueprintTray && state.trayOpen);
    tray.toggleAttribute('hidden', !state.trayOpen);
    tabs.forEach((t) => t.el.classList.toggle('active', t.id === state.group));

    const building = state.tool === 'build';
    categories.forEach((c) => {
      c.el.classList.toggle('active', building && c.id === state.category);
      c.el.classList.toggle('open', c.id === state.category && state.trayOpen && !state.blueprintTray);
    });
    bulldoze.classList.toggle('active', state.tool === 'bulldoze');
    selectButton.classList.toggle('active', state.tool === 'select');
    pickerButton.classList.toggle('active', state.tool === 'picker');
    items.forEach((i) => {
      const selected = building && i.id === state.selectedId; // browsing in select mode marks nothing
      i.card.classList.toggle('active', selected);
      i.modes.forEach((m) => m.el.classList.toggle('active', selected && m.mode === state.wallMode));
    });
    floors.forEach((f) => f.el.classList.toggle('active', f.level === state.level));

    // Current tool chip
    const chip = toolChip(state);
    const src = icons.get(chip.icon) ?? '';
    if (toolIcon.src !== src) toolIcon.src = src;
    toolTitle.textContent = chip.title;
    toolDetail.textContent = chip.detail;
    currentTool = state.tool;
    const selecting = state.tool === 'select';
    filters.toggleAttribute('hidden', !selecting && state.tool !== 'bulldoze');
    filters.classList.toggle('for-select', selecting);
    filterButtons.forEach((f) => {
      const on = (selecting ? state.selectFilter : state.bulldozeFilter)[f.id];
      f.el.classList.toggle('active', on);
      f.el.setAttribute('aria-pressed', String(on));
      f.el.setAttribute('aria-label', `${selecting ? 'Select' : 'Bulldoze'} ${f.name}`);
      f.el.title = selecting
        ? `${f.name}: ${on ? 'picked' : 'skipped'} (Shift+${f.key})`
        : `${f.name}: ${on ? 'removed' : 'kept'} (${f.key})`;
    });

    // the cell under the pointer as the world names it, so it reads the same from every side
    const at = state.hover && pointFromView({ x: state.hover.x + 0.5, y: state.hover.y + 0.5 }, state.view, sizeInView(state.size, state.view));
    const hover = at ? `(${Math.floor(at.x)}, ${Math.floor(at.y)})` : '';
    status.textContent = `${LEVELS[state.level]}  ·  ${state.objects.length} objects  ·  ${state.walls.length} walls  ${hover}`;
  };

  return { render };
};
