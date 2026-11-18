# Agent notes

Read this first. It replaces exploring the code to learn how things fit together.

## The project

An isometric sandbox for building a school campus (walls, floors, furniture, roads, water). PixiJS v8 + TypeScript + Vite, no framework. Published as a claude.ai artifact. The owner (Deta) is a senior TypeScript engineer who prefers functional programming and immutable data. Plans live in `Todos.md` (also the project doc "Todos").

## Rules for any change

- **Functional core, imperative shell.** Core files are pure: no Pixi, no DOM, no mutation. Everything returns new readonly data.
- **Every world change goes through `update(state, action)`** in `world.ts`, wrapped by `history.ts` for undo. Never mutate state in the shell.
- **One user action is one undo step.** History records only the world (`objects`, `tiles`, `walls`, `culverts`, `nextId`). UI state (tool, tray, camera, filters, clipboard, blueprints, guides) is never undone.
- **View space.** The world is stored unturned. `view.ts` turns the state into the camera's view (`toView`), `update` runs there, then it is turned back (`fromView`). So all rules are written for one camera direction and work from all four. Anything new in state that has a position or direction needs a case in `view.ts`.
- **Write user-facing text without em dashes.** That includes labels, help, chip text and docs.
- **Text must fit.** Any HUD or label change runs the UI sweep (`./check.sh --ui`).
- **Keep files' style.** Small pure helpers, `Readonly<...>` types, discriminated unions, short comments explaining why, not what.

## Files

| File | Layer | What it holds |
| --- | --- | --- |
| `src/config.ts` | core | Constants: tile size, `GRID_W`/`GRID_H` (64), wall heights, levels, feature flags |
| `src/geometry.ts` | core | `Cell`, `Point`, `Rect`, `Edge` (walls sit on grid edges, `axis` x or y), screen projection, cell/edge helpers |
| `src/catalog.ts` | core | Every item as data: objects (boxes, or flat `marks` lying on the ground), floors/paths/water tiles, wall styles, openings, paints. Categories > groups (tray tabs) > items. Helpers like `marksOf`, `occupiedCells`, `layerOf`, `isFlat`, `isRun`, `isSmart` |
| `src/world.ts` | core | `State`, `Action`, `initialState`, `update`, and all placement rules (`objectCandidate`, `buildPlan`, `canPlaceObject`, wall/opening/paint/fill/culvert plans, bulldoze, select, copy/paste, blueprints) |
| `src/history.ts` | core | Undo/redo around `update` (`step`, `initialHistory`) |
| `src/view.ts` | core | Quarter turns of state, points, cells, edges, pieces between world and view space |
| `src/depthSort.ts` | core | Draw order for multi-tile objects |
| `src/blueprintStore.ts` | shell edge | Versioned, validated blueprint storage in `localStorage` (the model for any future save format) |
| `src/input.ts` | shell | Pointer and keyboard to actions |
| `src/main.ts` | shell | Composition root: Pixi app, camera, dispatch loop |
| `src/render/drawables.ts` | shell (pure) | State to a sorted list of things to draw (objects, walls, roofs, canopies, flat pieces) |
| `src/render/scene.ts` | shell | Pixi layers (ground, flats, solids, overlays) and the build/select overlays |
| `src/render/draw.ts`, `shapes.ts` | shell | Drawing primitives: boxes, walls, poles, arches, marks, medians |
| `src/render/hud.ts` | shell | DOM HUD: category bar, tray, tool chip, filters, blueprint tray, help |
| `src/render/icons.ts` | shell | Tray icons rendered from the game's own drawing |

## Things that are easy to get wrong

- **Flat ground pieces** (roads, markings) live in layers `road`, `marking`, `median` (`layerOf`). They collide only within their own layer; standing objects and walls ignore them. Click picking order: standing, median, marking, road.
- **Placement of objects** goes through `buildPlan` (which may replace road pieces). Paste, blueprints and group drops use the strict `canPlaceObject`.
- **Drags** (`state.drag`) have modes; painting drags fill gaps with `cellsBetween`. A drag is one undo step.
- **Rotation** (R) belongs to the world and persists across item picks.
- **Grid size** is still the constants `GRID_W`/`GRID_H` (todo #15 moves it into the world). `view.ts` assumes a square grid today.

## Checks

```bash
./check.sh          # typecheck + every test in tests/ + build. Prints only failures and one summary line.
./check.sh --ui     # also the text overflow sweep at 1280, 1101, 1024, 900, 700, 390, 360 px (needs a build)
```

Run `./check.sh` after every change and keep going until it says `ALL GREEN`. Do not paste passing output into reports.

**Tests** are plain scripts with `node:assert` in `tests/*.test.ts`, run with `cd tests && npx tsx name.test.ts`. They drive the game through `history.step` with real actions (hover, press, release, rotate, keys), so they test behavior, not internals. Copy the helpers at the top of an existing test (`roads.test.ts` is a good model: `click`, `drag`, `turns`). Add a test file or cases for every new behavior, including undo and all four camera views when positions are involved.

**Screenshots** (only when asked to check a look): Playwright in Python against `npx vite preview --port 4173`. Screen position of grid point (x, y) at default zoom on a 1280x720 page: `(640 + (x - y) * 22.4, 340 + (x + y - 64) * 11.2)`.

## Publishing (the lead agent does this, not helpers)

1. `./check.sh` is green (the build is in `dist/`).
2. `python3 tools/publish_plan.py` prints the slug, base version, files to send and files to remove.
3. Call the artifact `publish_files` tool with exactly that.
4. `python3 tools/publish_plan.py --record <new version>` with the version the publish returned.
5. Add a Done row to `Todos.md` and write it to the project doc "Todos".

## Working as a helper

You get a spec from the lead agent. Build exactly that; if the spec is unclear or conflicts with the code, stop and say so instead of guessing. Report back in a few lines: what changed (files and functions), tests added, `check.sh` result, and anything you were unsure about. Do not publish, and do not edit `Todos.md`.
