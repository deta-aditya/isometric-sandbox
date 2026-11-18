// Undo/redo as a pure layer around the world update. Only the world (what is built) is recorded,
// never UI state, so undo does not touch the tool, tray, floor or camera.
import { edgeKey } from './geometry';
import { type Action, type State, initialState, settle, update } from './world';

export type World = Pick<State, 'objects' | 'tiles' | 'walls' | 'culverts' | 'nextId'>;

export type History = Readonly<{
  past: readonly World[];
  committed: World; // the world as of the last finished change
  future: readonly World[];
  state: State;
}>;

export type HistoryAction = Action | { type: 'undo' } | { type: 'redo' };

const LIMIT = 100;

const worldOf = (s: State): World => ({ objects: s.objects, tiles: s.tiles, walls: s.walls, culverts: s.culverts, nextId: s.nextId });

// Order-independent fingerprint, so lifting an object and putting it back counts as no change
const fingerprint = (w: World): string =>
  [
    w.objects.map((o) => `${o.id}:${o.defId}:${o.x},${o.y}:${o.rotation}`).sort().join('|'),
    w.tiles.map((t) => `${t.x},${t.y}:${t.defId}`).sort().join('|'),
    w.walls.map((x) => `${edgeKey(x)}:${x.styleId}:${x.opening ?? ''}:${x.paint.before ?? ''}/${x.paint.after ?? ''}`).sort().join('|'),
    w.culverts.map(edgeKey).sort().join('|'),
  ].join('#');

const sameWorld = (a: World, b: World): boolean =>
  (a.objects === b.objects && a.tiles === b.tiles && a.walls === b.walls && a.culverts === b.culverts) || fingerprint(a) === fingerprint(b);

// A change is only committed once nothing is in progress: no drag, nothing being carried.
// That makes a whole paint stroke, wall run, room or move a single undo step.
// Marks leave the world as it is; a held group or opening is out of it until dropped. A held paste
// took nothing out, so each drop of it is a step of its own.
const isSettled = (s: State): boolean =>
  s.drag === null && (s.selection === null || s.selection.kind === 'marked' || (s.selection.kind === 'group' && s.selection.copy));

export const initialHistory: History = { past: [], committed: worldOf(initialState), future: [], state: initialState };

export const canUndo = (h: History): boolean => h.past.length > 0;
export const canRedo = (h: History): boolean => h.future.length > 0;

// Swaps in a recorded world; anything in progress is settled first and selection is cleared
const restore = (s: State, world: World): State => ({ ...settle(s), ...world, selection: null });

export const step = (h: History, action: HistoryAction): History => {
  switch (action.type) {
    case 'undo': {
      const previous = h.past.at(-1);
      if (!previous) return h;
      return {
        past: h.past.slice(0, -1),
        committed: previous,
        future: [h.committed, ...h.future],
        state: restore(h.state, previous),
      };
    }
    case 'redo': {
      const next = h.future[0];
      if (!next) return h;
      return {
        past: [...h.past, h.committed],
        committed: next,
        future: h.future.slice(1),
        state: restore(h.state, next),
      };
    }
    default: {
      const state = update(h.state, action);
      if (state === h.state) return h;
      if (!isSettled(state)) return { ...h, state };
      const world = worldOf(state);
      if (sameWorld(world, h.committed)) return { ...h, state, committed: world };
      return { past: [...h.past, h.committed].slice(-LIMIT), committed: world, future: [], state };
    }
  }
};
