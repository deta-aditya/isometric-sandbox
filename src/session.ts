// The game being played, kept apart from undo history: which game it is, what it is called, and what
// was last written to storage. Pure; the shell does the writing.
import { type World, sameWorld } from './history';

export type AutosaveMinutes = 0 | 1 | 2 | 3 | 5 | 10;
export const AUTOSAVE_CHOICES: readonly AutosaveMinutes[] = [0, 1, 2, 3, 5, 10];
export const DEFAULT_AUTOSAVE: AutosaveMinutes = 3;
export const NAME_MAX = 40;

export type Session = Readonly<{
  gameId: number | null; // null until first written to storage
  name: string; // shown in the chip from the start
  saved: World | null; // the history World as last written; null = never saved
  savedAt: number | null; // ms timestamp of that write
  problem: 'full' | null; // the last write failed for lack of storage
  autosaveMinutes: AutosaveMinutes; // 0 = off
}>;

export const newSession = (name: string, autosaveMinutes: AutosaveMinutes): Session => ({
  gameId: null,
  name,
  saved: null,
  savedAt: null,
  problem: null,
  autosaveMinutes,
});

// "Game 3": the lowest number not taken (the same rule as blueprints' names)
export const freeGameName = (names: readonly string[]): string => {
  const taken = new Set(names);
  let n = 1;
  while (taken.has(`Game ${n}`)) n++;
  return `Game ${n}`;
};

const EMPTY: World = { objects: [], tiles: [], terrain: [], walls: [], culverts: [], nextId: 1 };

// Dirty means there is something a close would lose. A game never written is clean while empty. Lifting
// a piece and putting it back is no change (sameWorld), and the build facing alone is not part of it.
// Hover re-renders the HUD often and comparing two big worlds is not free, so the last answer is kept.
let memo: Readonly<{ saved: World | null; committed: World; dirty: boolean }> | null = null;
export const isDirty = (session: Session, committed: World): boolean => {
  if (memo && memo.saved === session.saved && memo.committed === committed) return memo.dirty;
  const dirty = !sameWorld(committed, session.saved ?? EMPTY);
  memo = { saved: session.saved, committed, dirty };
  return dirty;
};

// Trimmed and capped; an empty name falls back
export const cleanName = (text: string, fallback: string): string => text.trim().slice(0, NAME_MAX).trim() || fallback;

const MINUTE = 60_000;
export const relativeTime = (savedAt: number, now: number): string => {
  const minutes = Math.floor(Math.max(0, now - savedAt) / MINUTE);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days < 2 ? 'yesterday' : `${days} days ago`;
};

// What the game chip says beside the name. A notice (after a load that left pieces out) takes the place
// of the state for a few seconds.
export type ChipState = Readonly<{ kind: 'saved' | 'unsaved' | 'problem' | 'notice'; text: string }>;
export const chipState = (session: Session, dirty: boolean, now: number, notice: string | null): ChipState => {
  if (notice) return { kind: 'notice', text: notice };
  if (session.problem) return { kind: 'problem', text: "Couldn't save, storage full" };
  if (dirty) return { kind: 'unsaved', text: 'Unsaved changes' };
  // a fresh game with nothing built yet has nothing to lose, but it is not saved either
  return { kind: 'saved', text: session.savedAt === null ? 'Not saved yet' : `Saved ${relativeTime(session.savedAt, now)}` };
};

export const piecesLeftOut = (n: number): string => `Loaded, ${n} ${n === 1 ? 'piece' : 'pieces'} left out`;
