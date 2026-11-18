// The game chip (top left), the Game panel under it, and the dialogs (new game, save first). DOM only:
// it shows what main.ts gives it and reports what the player asked for; main.ts does the saving.
import { MAX_GRID, MIN_GRID } from '../config';
import type { SaveEntry } from '../saveStore';
import { AUTOSAVE_CHOICES, type AutosaveMinutes, NAME_MAX, type Session, chipState, cleanName, relativeTime } from '../session';

export type MenuActions = Readonly<{
  save: () => 'ok' | 'full';
  saveAs: (name: string) => 'ok' | 'full';
  newGame: (name: string, w: number, h: number) => Promise<boolean>; // true once the new game has started
  load: (id: number) => Promise<boolean>;
  rename: (id: number, name: string) => void;
  remove: (id: number) => void;
  setAutosave: (minutes: AutosaveMinutes) => void;
}>;

// What the menu shows, given anew on every render
export type MenuInfo = Readonly<{
  session: Session;
  dirty: boolean;
  saves: readonly SaveEntry[];
  notice: string | null;
  now: number;
  suggestedName: string; // for a new game
}>;

export type SavePrompt = Readonly<{ name: string; neverSaved: boolean; save: () => 'ok' | 'full' }>;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, html?: string) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

// Names are typed by the player: always set as text, never as HTML
const textEl = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string) => {
  const e = el(tag, className);
  e.textContent = text;
  return e;
};

const button = (className: string, html: string, onClick: () => void): HTMLButtonElement => {
  const b = el('button', className, html);
  b.type = 'button';
  b.addEventListener('click', () => {
    onClick();
    b.blur(); // keep keyboard shortcuts (Space, digits) away from focused buttons
  });
  return b;
};

const svg = (paths: string, size = 16): string =>
  `<svg viewBox='0 0 24 24' width='${size}' height='${size}' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${paths}</svg>`;
const GAMEPAD_SVG = svg(
  "<path d='M7 8 h10 a4.5 4.5 0 0 1 4.4 5.4 l-.8 3.8 a2.4 2.4 0 0 1 -4 1.2 L14.5 16.5 h-5 l-2.1 1.9 a2.4 2.4 0 0 1 -4 -1.2 l-.8 -3.8 A4.5 4.5 0 0 1 7 8 z'/>" +
    "<path d='M8 10.5 v3 M6.5 12 h3'/><path d='M15.5 11 h.01 M17.5 13 h.01'/>",
);
const CHEVRON_SVG = svg("<path d='M6 9 l6 6 6 -6'/>", 12);
const PENCIL_SVG = svg("<path d='M4 20 l1 -4 L16 5 a2 2 0 0 1 3 3 L8 19 z'/><path d='M14 7 l3 3'/>", 14);
const TRASH_SVG = svg("<path d='M4 7 h16'/><path d='M9 7 V4 h6 v3'/><path d='M6 7 l1 13 h10 l1 -13'/><path d='M10 11 v6 M14 11 v6'/>", 14);

const AUTOSAVE_LABEL = (m: AutosaveMinutes): string => (m === 0 ? 'Off' : `Every ${m} min`);
const GRID_ERROR = `Use a whole number from ${MIN_GRID} to ${MAX_GRID}`;
const FULL_ERROR = "Couldn't save, storage is full";

// A side as typed: digits only, within the limits
const sideOf = (text: string): number | null => {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text);
  return n >= MIN_GRID && n <= MAX_GRID ? n : null;
};

const isTyping = (t: EventTarget | null): boolean => t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;

export const createGameMenu = (actions: MenuActions) => {
  let info: MenuInfo | null = null;

  // Open things, oldest first. Esc closes the topmost only, and while anything is open the game's own
  // shortcuts stay off.
  const layers: { close: () => void }[] = [];
  const pushLayer = (close: () => void) => {
    const layer = { close: () => { popLayer(layer); close(); } };
    layers.push(layer);
    return layer;
  };
  const popLayer = (layer: { close: () => void }) => {
    const i = layers.indexOf(layer);
    if (i >= 0) layers.splice(i, 1);
  };

  // ----- The chip -----
  const chip = el('button', '', `${GAMEPAD_SVG}<span class="game-name"></span><span class="game-dot"></span><span class="game-state"></span><span class="game-chevron">${CHEVRON_SVG}</span>`);
  chip.id = 'game-chip';
  chip.type = 'button';
  chip.setAttribute('aria-haspopup', 'true');
  chip.setAttribute('aria-expanded', 'false');
  const chipName = chip.querySelector<HTMLElement>('.game-name')!;
  const chipDot = chip.querySelector<HTMLElement>('.game-dot')!;
  const chipText = chip.querySelector<HTMLElement>('.game-state')!;

  // ----- The panel -----
  const panel = el('div');
  panel.id = 'game-panel';
  panel.hidden = true;
  const saveButton = button('game-primary', 'Save', () => actions.save());
  const saveAsButton = button('game-action', 'Save as', () => openSaveAs());
  const newButton = button('game-action', 'New game', () => openNewGame());
  const actionRow = el('div', 'game-actions');
  actionRow.append(saveButton, saveAsButton, newButton);

  const saveAsRow = el('div', 'game-saveas');
  saveAsRow.hidden = true;
  const saveAsInput = el('input', 'game-input');
  saveAsInput.maxLength = NAME_MAX;
  saveAsInput.setAttribute('aria-label', 'Name of the copy');
  const saveAsError = textEl('div', 'game-error', FULL_ERROR);
  saveAsError.hidden = true;
  const saveAsFields = el('div', 'game-saveas-fields');
  saveAsFields.append(
    saveAsInput,
    button('game-primary', 'Save', () => commitSaveAs()),
    button('game-action', 'Cancel', () => saveAsLayer?.close()),
  );
  saveAsRow.append(saveAsFields, saveAsError);

  const listLabel = textEl('div', 'game-label', 'Saves in this browser');
  const list = el('div', 'game-list');
  const autosaveRow = el('div', 'game-autosave');
  const autosaveSelect = el('select', 'game-select');
  autosaveSelect.setAttribute('aria-label', 'Autosave');
  AUTOSAVE_CHOICES.forEach((m) => {
    const o = el('option');
    o.value = String(m);
    o.textContent = AUTOSAVE_LABEL(m);
    autosaveSelect.append(o);
  });
  autosaveSelect.addEventListener('change', () => {
    actions.setAutosave(Number(autosaveSelect.value) as AutosaveMinutes);
    autosaveSelect.blur();
  });
  autosaveRow.append(textEl('span', 'game-autosave-label', 'Autosave'), autosaveSelect);
  panel.append(actionRow, saveAsRow, listLabel, list, autosaveRow);

  let panelLayer: { close: () => void } | null = null;
  const openPanel = () => {
    if (panelLayer) return;
    panel.hidden = false;
    chip.setAttribute('aria-expanded', 'true');
    chip.classList.add('open');
    panelLayer = pushLayer(() => {
      panelLayer = null;
      panel.hidden = true;
      chip.setAttribute('aria-expanded', 'false');
      chip.classList.remove('open');
      saveAsLayer?.close();
    });
    paint();
  };
  const closePanel = () => panelLayer?.close();
  chip.addEventListener('click', () => {
    if (panelLayer) closePanel();
    else openPanel();
    chip.blur();
  });

  // ----- Save as: an inline row -----
  let saveAsLayer: { close: () => void } | null = null;
  function openSaveAs(): void {
    if (saveAsLayer || !info) return;
    saveAsRow.hidden = false;
    saveAsError.hidden = true;
    saveAsInput.value = `${info.session.name} copy`.slice(0, NAME_MAX).trim();
    saveAsLayer = pushLayer(() => {
      saveAsLayer = null;
      saveAsRow.hidden = true;
    });
    saveAsInput.focus();
    saveAsInput.select();
  }
  function commitSaveAs(): void {
    const name = cleanName(saveAsInput.value, `${info?.session.name ?? 'Game'} copy`.slice(0, NAME_MAX).trim());
    if (actions.saveAs(name) === 'ok') saveAsLayer?.close();
    else saveAsError.hidden = false;
  }
  saveAsInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') commitSaveAs();
  });
  saveAsInput.addEventListener('keyup', (e) => e.stopPropagation());

  // ----- The list of saves -----
  let renaming = false; // a name is being typed: leave the rows as they are until it is done
  let shownRows = '';

  const startRename = (row: HTMLElement, entry: SaveEntry): void => {
    const title = row.querySelector<HTMLElement>('.game-title');
    if (!title || renaming) return;
    renaming = true;
    const input = el('input', 'game-input game-rename');
    input.value = entry.name;
    input.maxLength = NAME_MAX;
    input.setAttribute('aria-label', 'Game name');
    row.classList.add('renaming');
    let done = false;
    const layer = pushLayer(() => finish(false));
    const finish = (keepName: boolean) => {
      if (done) return;
      done = true;
      renaming = false;
      popLayer(layer);
      const name = cleanName(input.value, entry.name);
      input.remove();
      row.classList.remove('renaming');
      if (keepName && name !== entry.name) actions.rename(entry.id, name);
      paint();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing a name is not a game shortcut
      if (e.key === 'Enter') finish(true);
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    input.addEventListener('blur', () => finish(true));
    title.after(input);
    input.focus();
    input.select();
  };

  const row = (entry: SaveEntry, current: boolean, now: number): HTMLElement => {
    const r = el('div', current ? 'game-row current' : 'game-row');
    const text = el('div', 'game-text');
    const sub = `${entry.w} × ${entry.h} · ${current ? 'now playing' : relativeTime(entry.savedAt, now)}`;
    text.append(textEl('div', 'game-title', entry.name), textEl('div', 'game-sub', sub));
    r.append(text);
    if (!current) r.append(button('game-load', 'Load', () => void actions.load(entry.id)));
    const rename = button('game-icon', PENCIL_SVG, () => startRename(r, entry));
    rename.title = 'Rename';
    rename.setAttribute('aria-label', `Rename ${entry.name}`);
    let armed = 0;
    const remove = button('game-icon remove', TRASH_SVG, () => {
      if (Date.now() - armed < 3000) return actions.remove(entry.id);
      armed = Date.now();
      remove.classList.add('armed');
      remove.title = 'Click again to delete';
      setTimeout(() => {
        remove.classList.remove('armed');
        remove.title = 'Delete';
      }, 3000);
    });
    remove.title = 'Delete';
    remove.setAttribute('aria-label', `Delete ${entry.name}`);
    r.append(rename, remove);
    return r;
  };

  // ----- Painting -----
  const paint = (): void => {
    if (!info) return;
    const { session, dirty, notice, now, saves } = info;
    const state = chipState(session, dirty, now, notice);
    if (chipName.textContent !== session.name) chipName.textContent = session.name;
    if (chipText.textContent !== state.text) chipText.textContent = state.text;
    if (chip.dataset.state !== state.kind) chip.dataset.state = state.kind;
    const title = `${session.name} · ${state.text}`;
    if (chip.title !== title) chip.title = title;
    if (!panelLayer) return;
    if (document.activeElement !== autosaveSelect) autosaveSelect.value = String(session.autosaveMinutes);
    // rows are rebuilt only when what they show has changed (this runs on every pointer move)
    const rows = JSON.stringify([session.gameId, saves.map((e) => [e.id, e.name, e.w, e.h, session.gameId === e.id ? 0 : relativeTime(e.savedAt, now)])]);
    if (rows === shownRows || renaming) return;
    shownRows = rows;
    list.replaceChildren(...(saves.length === 0 ? [textEl('div', 'game-empty', 'Your saves show up here once you build something.')] : saves.map((e) => row(e, e.id === session.gameId, now))));
  };

  // ----- Dialogs -----
  const backdrop = (dialog: HTMLElement): HTMLElement => {
    const b = el('div', 'game-backdrop');
    b.append(dialog);
    document.body.append(b);
    return b;
  };

  // New game: a name, a width and a height (or a square pick) with a preview of the map's shape
  let newGameLayer: { close: () => void } | null = null;
  function openNewGame(): void {
    if (newGameLayer || !info) return;
    const dialog = el('div', 'game-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'New game');
    const name = el('input', 'game-input');
    name.maxLength = NAME_MAX;
    name.value = info.suggestedName;
    name.setAttribute('aria-label', 'Name');
    const side = (label: string): { input: HTMLInputElement; field: HTMLElement } => {
      const input = el('input', 'game-input game-number');
      input.type = 'number';
      input.min = String(MIN_GRID);
      input.max = String(MAX_GRID);
      input.step = '1';
      input.value = '64';
      const field = el('label', 'game-field');
      field.append(textEl('span', 'game-field-label', label), input);
      return { input, field };
    };
    const width = side('Width');
    const height = side('Height');
    const squares = el('div', 'game-squares');
    squares.append(textEl('span', 'game-field-label', 'Square:'));
    [32, 64, 128, 256].forEach((n) =>
      squares.append(
        button('game-action', String(n), () => {
          width.input.value = String(n);
          height.input.value = String(n);
          update();
        }),
      ),
    );
    const shape = el('div', 'game-shape');
    const box = el('div', 'game-shape-box');
    shape.append(box);
    const error = textEl('div', 'game-error', GRID_ERROR);
    error.hidden = true;

    // The preview fits the map's proportions into a 64 by 48 box
    const update = (): boolean => {
      const w = sideOf(width.input.value);
      const h = sideOf(height.input.value);
      error.hidden = w !== null && h !== null;
      if (w !== null && h !== null) {
        const fit = Math.min(64 / w, 48 / h);
        box.style.width = `${Math.round(w * fit)}px`;
        box.style.height = `${Math.round(h * fit)}px`;
      }
      return w !== null && h !== null;
    };
    width.input.addEventListener('input', update);
    height.input.addEventListener('input', update);

    let busy = false;
    const start = async (): Promise<void> => {
      const w = sideOf(width.input.value);
      const h = sideOf(height.input.value);
      update();
      if (busy || w === null || h === null || !info) return;
      busy = true;
      const started = await actions.newGame(cleanName(name.value, info.suggestedName), w, h);
      busy = false;
      if (started) newGameLayer?.close();
    };
    const buttons = el('div', 'game-buttons');
    buttons.append(button('game-action', 'Cancel', () => newGameLayer?.close()), button('game-primary', 'Start', () => void start()));
    const sizes = el('div', 'game-sizes');
    const fields = el('div', 'game-size-fields');
    fields.append(width.field, height.field);
    const left = el('div', 'game-size-left');
    left.append(fields, squares);
    sizes.append(left, shape);
    const nameField = el('label', 'game-field wide');
    nameField.append(textEl('span', 'game-field-label', 'Name'), name);
    dialog.append(
      textEl('h2', 'game-dialog-title', 'New game'),
      nameField,
      sizes,
      error,
      textEl('div', 'game-hint', `${MIN_GRID} to ${MAX_GRID} tiles each side. Starts on empty grass.`),
      buttons,
    );
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
        e.preventDefault();
        void start();
      }
    });
    const back = backdrop(dialog);
    newGameLayer = pushLayer(() => {
      newGameLayer = null;
      back.remove();
    });
    update();
    name.focus();
    name.select();
  }

  // Save first? Resolves true when the player may go on (saved, or chose not to) and false on cancel
  const askToSave = (prompt: SavePrompt): Promise<boolean> =>
    new Promise((resolve) => {
      const dialog = el('div', 'game-dialog prompt');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      const error = textEl('div', 'game-error', FULL_ERROR);
      error.hidden = true;
      let answered = false;
      const answer = (go: boolean) => {
        if (answered) return;
        answered = true;
        layer.close();
        resolve(go);
      };
      const save = button('game-primary', 'Save', () => {
        if (prompt.save() === 'ok') answer(true);
        else error.hidden = false;
      });
      const buttons = el('div', 'game-buttons');
      buttons.append(button('game-action', 'Cancel', () => answer(false)), button('game-action', "Don't save", () => answer(true)), save);
      dialog.append(
        textEl('h2', 'game-dialog-title', `Save ${prompt.name} first?`),
        textEl('p', 'game-body', prompt.neverSaved ? 'It has never been saved.' : 'It has changes since it was last saved.'),
        error,
        buttons,
      );
      const back = backdrop(dialog);
      const layer = pushLayer(() => {
        back.remove();
        answer(false); // Esc cancels
      });
      save.focus();
    });

  // ----- Keys and clicks -----
  // Captured before the game sees them: Ctrl/Cmd + S always saves, Esc closes the topmost open thing only,
  // and with anything open the game's other shortcuts stay off (typing goes to the field as usual).
  window.addEventListener(
    'keydown',
    (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        e.stopPropagation();
        actions.save();
        return;
      }
      if (layers.length === 0) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        layers.at(-1)?.close();
        return;
      }
      if (!isTyping(e.target)) e.stopPropagation();
    },
    true,
  );

  // A click outside the panel closes it, and is not also a click on the map (a stray build)
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!panelLayer || document.querySelector('.game-backdrop')) return;
      const t = e.target as Node;
      if (panel.contains(t) || chip.contains(t)) return;
      closePanel();
      e.stopPropagation();
    },
    true,
  );

  document.body.append(chip, panel);

  return {
    render: (next: MenuInfo): void => {
      info = next;
      paint();
    },
    askToSave,
    closePanel,
    isOpen: (): boolean => layers.length > 0,
  };
};
