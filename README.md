# Isometric Placement Prototype

A small isometric placement game built with PixiJS v8, TypeScript and Vite.

For architecture, checks and publishing, see `AGENTS.md`.

## Run

```bash
npm install
npm run dev
```

## Controls

- Click: place the selected object
- Shift + click: remove an object
- Drag: pan, mouse wheel: zoom
- 1 to 6: pick an object, R: rotate

## Structure

The code follows a functional core with an imperative shell.

| File | Layer | Role |
| --- | --- | --- |
| `src/geometry.ts` | Core | Grid and screen projection, cell and rect helpers |
| `src/catalog.ts` | Core | Object definitions as plain data |
| `src/world.ts` | Core | `State`, `Action` and the pure `update` function |
| `src/depthSort.ts` | Core | Draw order for multi-tile objects |
| `src/render/shapes.ts` | Shell | Box and pyramid primitives on Pixi `Graphics` |
| `src/render/scene.ts` | Shell | Draws the world from `State` |
| `src/render/hud.ts` | Shell | Draws the side panel from `State` |
| `src/input.ts` | Shell | Turns pointer and keyboard events into `Action`s, handles the camera |
| `src/main.ts` | Shell | Wires everything together |

Nothing in the core imports Pixi or touches the DOM, so it can be unit tested on its own.

## Adding an object

Add an entry to `OBJECT_DEFS` in `src/catalog.ts`. Each object has a footprint (`w` x `h` tiles)
and a list of parts. Each part is a `box` or a `pyramid` with offsets in tile units and
elevation and height in pixels.
