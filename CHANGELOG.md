# Changelog

What's new in Isometric Sandbox, newest first, written for players.

An entry is added only when Deta says a finished todo is ready to log: a todo can be done but still buggy, or not quite as wished. Until then it waits under "Waiting to be logged" (in this file only, not shown to players).

Each entry has the date it was logged and the todo numbers it covers, so it can be traced back to the Done table in `Todos.md`.

## Waiting to be logged

Finished, not yet confirmed by Deta:
- #43a Biome ground (8 Terrain tabs, 17 new terrains) and a tidier New game dialog with a Biome choice (2026-11-28)
- #43b Grid lines take a shade of the ground under them, so they are soft on snow and sand (2026-11-28)
- #43c Desert and Cold plant tabs: cacti, agave, Joshua tree, dry bush, dead tree, boulder; snowy pines, bare tree, snowy bush and rock, log pile, snowman (2026-11-28)
- #43d Savanna and Tropical plant tabs: acacia, baobab, thorn bush, golden grass, termite mound, kopje rock; banana plant, fern, monstera, bird of paradise, jungle tree, tree fern, banyan, jackfruit tree, areca palm (2026-11-28)
- #49 Selecting, moving, copying and blueprints no longer take terrain or Canal and Stream water; they stay where they were painted (2026-11-28)

## Log

### 2026-11-27: Roads, tracks, school rooms, textured ground and wall finishes

**Roads** (#31, #31b, #31c)
- Roads now come in three widths: Wide, Medium (the old narrow roads) and a new Narrow road with edge lines on both sides.
- Dirt roads in packed earth, with two wheel tracks and a grassy strip; their junctions curve into each other, and Dirt to paved joins them to a paved road.
- Links between every width: T junctions (including one that joins only the near side of a wide road), crossings and tapers, each kept in the tab of the narrower road.
- Narrow corner and Dirt corner for the tightest turns.
- Lane arrows sit in the middle of a narrow road's lanes and cannot go on dirt roads.
- Bus stop box: a yellow outline with BUS that fits a bus bay, in its own Bus bay tab.

**Running track** (#32)
- A Track tab with straights you drag out, curves, a start line with lane numbers and a checkered finish line.
- Six lanes, two runners to a tile; a full oval is 26 by 14 tiles and a mini soccer court fits in the middle.

**Furniture** (#36, #42)
- Gym: gym bench, wall hoop, gym mat, vaulting box, wall bars, balance beam, scoreboard and ball cart.
- Dorm: bunk bed, single bed, wardrobe, study desk, desk chair, nightstand, wall shelf, locker row and waste basket.
- Laundry: washer, dryer, laundry desk, ironing stand and laundry rack.

**Floors and paths** (#11, #45, #45b)
- Every floor and path now has a texture: wood planks, stone slabs, tile grout, marble veins, terrazzo chips, brick, cobbles, concrete slabs, and fine grain on asphalt, carpets and turf. Patterns keep their direction when you turn the camera.
- Paths follow diagonals: lay them in steps and they get clean 45 degree edges.
- The Dirt path blends into the grass, with grass creeping in at its edges.
- New paths: Overgrown, Crazy paving, Leafy dirt, Diamond plate, Steel grating, Perforated metal and Rusty steel.
- Turf grass now comes in light and dark, for mowing stripes by hand.
- Path names are shorter (Stone, Dirt, Overgrown, Leafy dirt), and the Dirt terrain is now called Soil.

**Walls** (#11b, #11c)
- A new Finishes tab next to Paints: Brush painted, Brickwork, Stonework, Concrete block, Wood panels, Wainscot, Tiles, Striped paper and Diamond paper.
- Finishes and paints mix: paint a wall any color and its finish stays, so you can have painted brick or striped paper in navy. No finish takes the texture off again.
- On plain walls, brick, stone, block and wood keep their natural colors.
- Wainscot puts wood panelling on the lower part and the paint above it.
- Textures carry on from one wall to the next, stop neatly around doors and windows, and look the same from every side.

### 2026-11-22: Everything so far

The first entry: a summary of the whole game up to today.

**Building** (#2, #3, #6, #8, #9, #29)
- Build walls in a line or a square; enclosed spaces become rooms with roofs, and the roof view and 1st floor view show them.
- Wall materials, including glass panes and pole walls (posts with a beam that turn a room into a covered walkway).
- Paint each side of a wall separately, 12 colors plus Plain; paint on glass shows as a tint.
- Doors, windows and arches go into walls.
- Fences (picket, wooden, metal railing, chain-link, hedge row, low brick wall, pillar fence, rope fence) and gates, including a wide arched gate with stone pillars.

**Scenery** (#4, #16, #28, #33, #34, #35)
- Outdoor seating and tables, many trees and shrubs, flowers, rose and wooden arches, a floral clock, and dolphin and owl statues.
- Lamps and street furniture: a bus pole sign and a parking gate.
- Waterside things: footbridge, lily pads, reeds, stepping stones, rowboat, duck, fountain and pond.
- Sports: a basketball hoop, a soccer goal and a tennis net, each sized to stand right on its court's lines.

**Furniture** (#5)
- Eight room tabs for a school: Office, Canteen, Lab, Class, Hallway, Toilet, Lounge and Kitchen.

**Floors and paths** (#27, #33, #35)
- 20 floors, including wood, tile, marble, terrazzo, carpets, a gym floor, court colors (blue, green, red, yellow), turf grass, and mowed grass with stripes.
- Paths: asphalt, concrete, red brick, cobblestone, running track and more.

**Roads** (#8, #40)
- A road kit in two widths: wide roads (four lanes and a middle row for a median) and narrow roads (two lanes).
- Straights laid by dragging, with plain and dashed-side versions; bends, curves, T-junctions, crossroads and road ends.
- Links between the widths: T junctions, a mixed crossroads, narrowing pieces, and a bus bay.
- Junctions and links placed on a road swap out the road under them and line up with its lanes.
- Markings: crosswalks, a median strip that rounds its ends, car bays, a loading bay, and lane arrows that size themselves to the road and sit in the middle of their lane.

**Courts** (#33, #34, #35)
- Basketball court, half court, mini soccer court and tennis court, as white line markings over any floor you like.

**Water** (#4, #17)
- Canals with stone banks and water sunken below the ground, and natural streams with soft earthy banks.
- Culverts across a channel's end, and stone joints where a canal pours into a stream or a stream falls into a canal.
- Painting streams is quick, even on busy maps.

**Terrain** (#18)
- Paint the ground with a round brush: six kinds of grass plus dirt, mulch, clay, gravel and sand, blending softly into each other.
- Pick the ground a new map starts with.

**Tools** (#1, #10, #20, #21, #23, #24, #25, #26, #37)
- Bulldoze with a click or a box, filtered by kind (Scenery, Furniture, Flooring, Building, Terrain); Shift + click clears a whole room.
- Shift + click fills a floor or a paint across an area; Shift + Ctrl + click fills over everything.
- Select things with a box or Shift + click, then move them, turn them with R, or delete them.
- Copy (Ctrl + C) picks up a copy right away to place as many times as you like; cut (Ctrl + X) picks things up to move; Ctrl + V picks up the last copy again.
- Blueprints: save a selection with a name and place it again any time.
- Turn the camera to see from all four sides, and hide the grid with G.
- Undo and redo for every change.

**Games and saves** (#15)
- Start a new game with a name and a map size from 16 to 256 tiles a side.
- Save, Save as, load, rename and delete games kept in your browser, with autosave.
