# Guide panel (HeartGold / SoulSilver)

Code: `js/guide.js`. Data: `guide/hgss.json` (220 KB, built by `tools/guide_data.py`; query it with python/jq, don't read it whole).

- A panel on the right of the game (desktop, 900px+ wide) shows, for the current map: NEXT (the story step, see below), a MAP with its exits drawn on it (neighbouring
  overworld maps by direction, plus doors), items with hidden ones marked, wild Pokémon (grass by MORN/DAY/NITE, surfing, fishing (Old/Good/Super Rod merged into one list with level ranges), Rock
  Smash), and trainers with their teams. Hovering or tapping an item or
  trainer rings its spot on the map; the map sticks to the top while scrolling.
- Layout: one 300px panel on the right from 900px wide. From 1300px wide it splits around the game:
  `#guideL` on the left (location, map, next, items) and `#guide` on the right (wild Pokémon,
  trainers), 320px each. Both have class `.guide`. The map is scaled to the column width, up to ~55%
  of the screen height, keeping its shape.
- Auto-scale (Kenny's ask, 2026-10-26: tiny on a 24" 1080p screen at 100%): `fit()` in guide.js sets CSS
  `zoom` on both panels so they fill the width the game leaves free (the DS screens are stacked, so the
  game is 2/3 as wide as the screen area is tall). The zoom never goes below 1, and is capped at 2.5 and at
  screen-area height / 620 (`FIT_H`), so a short window (Kenny's 200% screen) keeps today's size and a
  big one doesn't turn the panels into a long scroll. It is redone on window resize. Everything inside the
  panels stays in unzoomed px; only window-based sizes divide by `zoom` (`mapBoxH()`), and the map canvas
  multiplies by it for sharp tiles.
- Kept compact so the panels need little scrolling (Kenny's ask): 13px text, tight spacing, wild Pokémon
  as three small tiles per row, 32px party sprites. NEXT shows only the step title, no "Step N of 40".
  The map and the next step have no MAP / NEXT headings (Kenny: they're implied).
- The mini map is drawn from the terrain in Kenny's own ROM, read in the browser (`Terrain`): NitroFS
  file `a/0/6/5` is the land-data NARC. Each member starts with four u32 section sizes, then (HGSS only)
  a background-sound section `0x1234, u16 length, data`; the 32x32 u16 terrain attributes follow it at
  +0x14+length (low byte = tile behaviour, bit 15 = wall). Reading them at a fixed +0x14 shifted the
  terrain under the item and trainer spots (fixed 2026-10-24). hgss.json says which land-data blocks make up each map (`blocks`,
  plus dimmed `near` blocks that its events spill into) and the colour class per behaviour (`tiles`).
  Nothing from the ROM is uploaded or committed.
- The map is drawn in game-style 16x16 tiles made in code (`tileArt()`, original art), picked by each tile's
  behaviour: path, grass, very tall grass, water, sand, ledges by jump direction, doors. Walls depend on the
  map: trees outdoors (headbutt trees marked), rock in caves (cave-floor tiles > 10%), plain walls indoors
  (no exits). Outdoors, the wall rectangle sitting on a door or warp is drawn as a house (roof + front
  with windows), and a lone blocked tile as a boulder. The terrain is painted once per map and cached;
  item balls, trainers and doors go on top.
  Every map has the same "looks 3D" style as the rooms (Kenny's ask, 2026-10-26), done cheaply in
  `relief()` as part of that one-time paint, so it costs nothing per frame (no WebGL or sprites):
  light from the top left, walls lit on top and dark on the right, cave walls facing the floor drawn as a
  cliff face, trees on the edge of a wood poke a round crown into the tile above, roofs get a lit ridge and
  shaded eaves, and walls cast a soft shadow down and right (wider for buildings). Water is shaded under
  its banks. A map with no edge exits counts as outdoors if it has 4+ land blocks or real grass/water
  (Ilex Forest, National Park, Pokéathlon Dome); before that they were drawn as rooms. Trainers are big purple squares with a white outline; a
  beaten one (trainer flag) is dimmed with a green tick. Items already picked up are left off the map and
  struck through in ITEMS: hgss.json gives each item its flag as a 4th value ([x, z, name, flag]), an item
  ball's `eventFlag` (FLAG_HIDE_ITEMBALL_*) or, for a hidden item, 800 + (script number - 8000). `poll()`
  redraws when those flags change for the current map (`mapState()`). The legend under the map shows small
  CSS copies of the real markers (dot, Poké Ball, gold ball, purple square, ticked square).
- Story, trainer and item flags are read from **every** in-RAM match, not just the one picked for the map
  id (`Story` takes a list of bases: a flag counts if any copy has it, a var is the highest). Kenny's game
  has two 95% matches in RAM: the live block and a buffer the game only fills when you save. After a save
  the picker switches to that buffer (its map id just changed), so reading only it showed trainers beaten
  since the save as not beaten (seen in Union Cave, 2026-10-24).
- Stuck guide (Kenny, Route 33, 2026-10-24: map stayed on Union Cave, ticks and NEXT frozen; not reproduced
  with fake RAM). Two safety nets: `poll()` catches errors and rescans, and when the player's position jumps
  (a warp) but the map id hasn't changed 3s later, the copies are taken as stale and DS RAM is scanned again.
  Tapping the location name shows a debug line: scan summary, picked copy, every copy's current map id,
  time since the last warp and the last poll error. Ask Kenny for a screenshot of it if the guide sticks. The whole map always fits its box and never scrolls
  (Kenny's choice, 2026-10-26: following the player moved it too much), so big maps get small tiles; markers are
  drawn bigger to stay visible. The map box is as tall as the map is shown, up to ~55% of the screen (a long wide route like Route 36
  left a big empty gap, 2026-10-26), and the map section is built once and reused by each render, so the previous map stays
  on screen until the new one is painted: no resizing or flicker when you change area.
- Rooms (indoor maps, `env` "in") are drawn by `paintRoom()` in a "looks 3D" style (Kenny liked the mockup,
  2026-10-25): light tops, dark front faces, soft shadows, original art. A room's furniture is part of its 3D
  model in the ROM, not a list we can read, so it is worked out:
  - Walls next to the outside, or below such a wall, are the room's walls. Other wall groups are furniture,
    and a lone tile is drawn as a plant.
  - Groups next to a member of staff are counters, and the wall behind the nurse is the healing machine.
    A Pokémon Center also gets the Poké Ball floor emblem three tiles in front of the nurse.
    `staff` in hgss.json is `[x, z, 0 nurse | 1 clerk | 2 receptionist]`, from the event objects' sprites.
  - PC (131), TV (134), town map (133), bookshelves, mart shelves, bin, stairs/ladders/escalators, mats
    and warp panels come from tile behaviours. Behaviour 128 is assumed to be a counter.
  - The colours follow the place name: Pokémon Center, Mart/Department Store, or home.
  - `cropRoom()` cuts the grid down to the floor you can reach from the room's warps, items and people,
    plus the walls around it. Floor shut in by walls (behind a counter) is kept, so it doesn't show as
    black holes; only floor joined to the edge of the box without passing a wall is left out. The rest of the 32x32 block is plain floor in the data, so it used to show
    as a big empty floor around the room. `layout()` keeps each map's (cropped) grid, with `ox`/`oz` as
    its top-left global tile.
  - Tested only with a dummy room built to match the Pokémon Center 1F events (all centres share land
    block 221: nurse at 8,11, exit 8,19, B1F stairs 14,17). Ask Kenny for screenshots of real rooms.
- Exits are HTML tags over the map (`placeExits()`), not a list. Each edge exit (`exits` in hgss.json) is an
  arrow tag at the widest walkable gap on the edge it shares with the neighbour's blocks; edge tags stay
  pinned inside the visible part of the map while it scrolls (`clampExits()`). Each warp gets a name tag
  over its door (8-9px text), moved under the door if the spot is taken, and left out if it would still
  cover another tag. Names come from `exitName()`.
- The panel's text uses Nunito (Google Fonts) for readability; the rest of the site keeps the pixel fonts.
- A blinking blue "you" dot shows the player live (5 reads a second). The saved position (+0x123C/+0x1240)
  only updates on warps, so it reads the player's map object (`LocalMapObject` in the decomp) in DS RAM
  instead: flags bit 0 set, id 255 at +0x08, movement 1 at +0x14, tile x/z at +0x64/+0x6C and the
  fixed-point position at +0x70/+0x78 (tile * 0x10000 + 0x8000). `player()` scans DS RAM for it and
  re-checks it on every read. Overworld coordinates are global, the same as hgss.json's.
  The **Guide** button in the top bar hides/shows it (localStorage `pp_guide`). Only for game codes IPK/IPG.
- Live position: the game keeps its save data in DS RAM with the same layout as the save file, and its
  current position lives there (general block +0x1234 = map id, u32; trainer name/ID at +0x64).
  EmulatorJS 4.2.3's DeSmuME core has no memory API, but `EJS_emulator.gameManager.Module.HEAPU8` (the
  whole wasm heap) is readable. `Guide` scans it (4-byte aligned) for the trainer name + ID taken from
  the newest slot of the current save file, every 5s until found, then reads the map id every second. `follow()` (5 a second) also checks
  the followed map ids and calls `poll()` as soon as one changes, so a new room shows within 0.2s. After
  a map is drawn, `prewarm()` builds the layouts of the maps its warps lead to in idle time, so walking
  into a building doesn't wait on ROM reads (the painted canvas is still made on entry, ~50ms).
- The trainer name + ID also turns up in other structs (first live test locked onto one and showed
  "Mystery Zone, Map 0"). Each match is scored by how much of the save's general block it reproduces;
  only matches above 50% with a map id above 1 count.
- While the guide is still looking for the game (the GUIDE/"Waiting" screen) it shows a debug line, e.g.
  `1 RAM · 97%:33 r, 3%:0 r` (header copies found in RAM, then each match as score:map id, r = inside DS RAM).
  Kenny asked for it to be hidden once the map shows. Ask him for a screenshot if it misbehaves.
- Speed: the ROM header copies (DS RAM areas) are looked for in the whole heap once and kept; later scans
  only search those 4 MB areas (the whole-heap pass took ~0.35s and stalled the game every 5s while the
  guide was searching). After 6 empty scans in a row the header copies are looked for again. The 5-a-second
  dot, the trainer marks and the 1-second poll all skip their work while the panel is off or the window
  is under 900px. Only the last 4 painted maps are kept, each drawn at about its shown size (8-16px per
  tile, not always 16px). Markers are still worked out in 16px-tile units under a canvas scale. Exit tags
  are measured once per map, and on scroll their boxes are worked out from position + size + the CSS
  offsets (`OFFSET` in guide.js), with no layout reads. Keep `OFFSET` in step with the `.exit` transforms
  in style.css.
- The emulator also keeps the cartridge's save memory in the heap, which holds the same bytes but only
  changes on save. `Guide` keeps the match that lies inside DS main RAM: boot copies the ROM header to
  0x027FFE00, i.e. RAM base + 0x3FFE00 (checked in the real core with a stub ROM). If that can't be
  found it follows whichever match changed last.
- A brand-new game with no save yet shows "Save in-game once to start the guide."
- Map ids are the decomp's `MAP_*` constants (0-539).
- To rebuild the data: clone pret/pokeheartgold and run `python3 tools/guide_data.py <path> > guide/hgss.json`.
  Grass rates are the Gen 4 slot rates; rod and Rock Smash rows show levels only.

## Trainers: who you're battling, who's beaten

- hgss.json trainer rows are `[x, z, name, party, trainer id]` (the id is the decomp's `TRAINER_*` number).
- Beaten trainers are dimmed with a tick: flag 0x550 + id in the save data in RAM (`Story.beaten()`).
- The trainer you're battling gets a red bar and a BATTLING tag, scrolls into view and is ringed on the map
  (`opponent()` / `markTrainers()` in guide.js, 4 times a second). It is the trainer map object standing next to the
  player: map objects sit in one array of 0x12C-byte `LocalMapObject`s with the player's (scriptId +0x20,
  tile x/z +0x64/+0x6C). A trainer's scriptId is 2999 + trainer id (`std_trainer`), or 4999 + id for the second of a
  pair. While the player object can't be read the last opponent stays marked. Tested only on fake RAM.

## NEXT: the story walkthrough

- Order in the left column: location, MAP, NEXT, ITEMS (Kenny wanted the map on top).
- Code: `js/story.js` (`Story`, loaded before `js/guide.js`). Steps: `guide/story.json`, written by hand in our own
  words (40 steps from the starter to Red). Each step is a title plus short to-do bullets, each with its own
  condition so it ticks itself; a bullet with no condition shows as a plain dot. Kenny wants everything visible at a
  glance: no fold, no long paragraphs, no trainer list, icons over words.
- ◀ ▶ beside the step title (Kenny's ask, 2026-10-26: check he didn't miss anything) page back through earlier
  steps and forward to the current one, with an "Earlier step (n of m)" note. `Story.nodes()` keeps the viewed
  step and redraws its own box; the view snaps back when the current step changes. Bullets there still show the
  way; the guide drops the picked way only when the current step changes (`navStep`).
- "Optional" (Kenny's ask, 2026-10-25): a step's `opt` list in story.json holds side quests worth doing at that
  point (in-game trades, Bike, Exp. Share for the Red Scale, Lapras, Snorlax, legendaries...), ticked the same way
  (–, ✓ when done; Kenny found ☆ looked too important, 2026-10-26). Flags come from the decomp's scripts (the SetFlag next to the GiveItem/GivePokemon). `c:N` =
  National Dex N caught: Pokédex at general block +0x12B8 (magic 0xBEEFCAFE, then caught bits, bit species-1).
  Conditions can be per version like text: `{f:0x117|f:0x116}` (HG's, then SS's).
- Places and the way there (Kenny's ask, 2026-10-26): a bullet's optional 3rd value in story.json is where it
  happens: a map id, `[map id, x, z]` for a spot, or `"HG id|SS id"`. The name isn't shown under the bullet (Kenny removed the 📍 tags,
  2026-10-26: he just clicks); `placeName()` (with `PLACES`/`NAMES` fixing decomp names) names stops in the bar. Clicking the bullet picks it (gold bar;
  click again or ✕ to stop, a new step clears it). Then `route()` finds the fewest-steps way over maps: edge
  exits and doors cost 1, Fly 3 (only with HM02 + Storm Badge, to fly points visited, `FLY` = flag -> town). An
  elevator (no warps in the data) links back to every floor that leads into it; the S.S. Aqua needs the ticket;
  `BLOCKED` lists neighbours you can't walk between (Route 44/Blackthorn, up the Route 45 ledges). The bar under
  the map lists the stops (maps with the same name, like a tower's floors or a route's gatehouse, are one stop).
  On the map, `walk()` finds the way from the player to the exit or door for the next stop (or, on the bullet's own
  map, to its spot), over the terrain: water costs 3, walls and wrong-way ledges (behaviours 56-59 = E, W, N, S) cost 40 rather
  than being ruled out, so a line always shows (Kenny saw it vanish at times, 2026-10-26: the terrain marks some
  walkable tiles as walls). Trap tiles cost 200: hgss.json's `traps` ([x, z, w, h], from step triggers whose
  script warps you back into the same map or runs `RocketTrapBattle`: the Ecruteak Gym's hidden pits, the Rocket
  Hideout's trap floor, a few in the Blackthorn and Saffron Gyms). Ice (behaviour 32) slides you until the next
  tile is blocked or you're off the ice, and slide tiles (64-67) turn you, so `slide()` makes the line solve the
  Mahogany Gym and the Ice Path (Kenny asked for maze solutions, 2026-10-26). Boulders and other objects aren't
  known. When the next stop is Fly, no line is drawn; the bar says "Fly to ...".
  It is drawn as a faded red band with white arrows moving along it (`moveArrows()`, Kenny's reference picture,
  2026-10-26; drawn bigger when tiles are under ~9px), and that exit's tag turns red.
- Spots: most bullets carry `[map, x, z]`, the person, object, sign or trigger that does what the bullet's
  condition checks, found with the decomp: the object whose script (following its GoTo/Call labels) runs that
  bullet's `SetFlag` or `TrainerBattle` (gym bullets use the step's boss), or the object hidden by a
  `FLAG_HIDE_*` flag; a few were picked by hand (Chuck's wife, Amphy, the Surf gentleman, Lance). "Reach town"
  bullets stay map-only. A bullet's optional 4th value is a small help line under it (quiz answers and puzzle
  tips taken from the decomp's scripts and messages: Radio Card quiz, Dragon's Den, Rocket Hideout passwords and
  switch, Vermilion trash cans), hidden once ticked. Redrawn when the player changes tile (`updateNav()` from `follow()`). It only knows which maps
  connect, not story blocks inside them (a Rocket in the way, a Strength boulder), and inside a multi-floor cave
  the line goes to the warp that leads on in the data. Tested with fake terrain and RAM only.
- Right under the step title, above the bullets (Kenny, 2026-10-26): each boss (name, type icons, "Weakness" + type
  icons, team sprites with levels). So no battle-tip bullets (types, levels): the box already says it. Styled as a
  dark battle card with red trim (Kenny wanted it to look like a boss): a red role strip on top (`ROLES` in story.js:
  GYM LEADER by default, RIVAL, ELITE FOUR, CHAMPION, ROCKET BOSS...), the name in gold pixel font, bigger sprites.
  Once beaten it goes grey with a tilted "DEFEATED" stamp.
  The step's "RECOMMEND CATCH" grid (sprites + where) goes in the right panel between WILD and TRAINERS (`Story.catches()`). Type icons are PokeAPI's Gen IV HGSS type sprites
  (hot-linked, `sprites/types/generation-iv/heartgold-soulsilver/<type id>.png`).
- `guide/bosses.json` = `teams` (trainer id -> party) + `dex` (catch name -> dex number), generated by
  `python3 tools/story_data.py <pokeheartgold> > guide/bosses.json` from the ids and names story.json uses; rerun it
  after adding a boss or a catch. Trainer ids are the `TRAINER_*` numbers in trainers.h, not the constant's suffix
  (TRAINER_RIVAL_SILVER_8 is 267).
- Progress is read live from the save data in DS RAM (general block, same base the map id uses): `SaveVarsFlags`
  starts at +0xDE4 (u16 vars for ids 0x4000-0x416F), its flag bits at +0x10C4. Trainer N beaten = flag 0x550 + N.
  Fly-point flags 0x9B0-0x9D5 mark towns visited, set on arrival from the `sSpawnMaps` table (asm/unk_0203BA5C.s).
  The decomp's FLAG_SYS_FLYPOINT_* names are wrong from 0x9BF to 0x9C2: really 0x9BF Cianwood, 0x9C0 Goldenrod,
  0x9C1 Olivine, 0x9C2 Ecruteak (go by the spawn table's first field). A todo bullet also ticks once any later
  todo bullet in its step is done, since they're in game order. Johto/Kanto badges at
  +0x7E/+0x83. The player's starter species is var 0x4030 (picks the rival's team).
- Trainer-beaten flags (0x550 + id) are only set for ordinary trainers (`std_trainer` objects, or a gym's
  `SetTrainerFlag` list). Scripted battles (rivals, gym leaders, Rocket executives, Elite Four, Red) never set
  their own flag (decomp `scrcmd_battle.c`: only ScrCmd_224 for the interacted object does), so `t:` on them
  never ticks (Kenny's Azalea rival, 2026-10-26). Bullets and each boss's `won` use what the script sets after the
  win instead: e.g. Azalea rival var 0x4075 >= 2, Burned Tower 0x1C6, Rocket hideout var 0x40AC >= 4 Petrel / >= 9 Ariana
  (not their FLAG_HIDE_* flags, which the B1F map script sets on the way in),
  tunnel rival var 0x40A0 >= 1, Radio Tower Petrel 0x2C7, Clair 0xD1, Victory Road 0x20A, Red 0x25F.
- Conditions: `f:` flag, `t:` trainer beaten, `b:`/`k:` Johto/Kanto badge bit, `v:4108>=3` var; `|` any, `&` all.
  The shown step is the first one not done; a step also counts as done once a later one is, except steps marked
  `free` (Kanto gyms, any order).
- Story vars/flags used (from the decomp's scripts): 0x4108 Elm's lab scene (1 starter, 3 after Mr. Pokémon,
  4 reported back, 6-7 Falkner + Togepi egg, 8 Dragon's Den, 9 Master Ball), 0x4073 Cherrygrove (2 tour, 4 rival
  beaten), 0x4074 Violet (3 egg collected), 0x4079 Ecruteak (1 gym empty, 2 Burned Tower beasts seen), 0x40A5
  lighthouse (1 met Jasmine, 2 medicine given), 0x4077 Radio Tower takeover, 0x410C Kimono Girls. Flags: 0x76 Elder
  Li, 0x7B Slowpoke Well, 0x80 HM01, 0xA2 HM03, 0xB9 SecretPotion, 0xC9 Red Scale, 0xCA hideout, 0xC6 Radio Tower,
  0x108/0x109 Ho-Oh/Lugia met, 0x964 Hall of Fame, 0xF2 S.S. Ticket, 0x11F EXPN Card, 0x12B Mt. Silver open.
- `{HeartGold text|SoulSilver text}` in story.json picks the running version.
- Tested only with synthetic RAM so far (flag offsets cross-checked with the decomp's save layout).

## Wild Pokémon IVs (js/ivs.js)

- While you battle a wild Pokémon, a "WILD POKÉMON IVs" box sits at the top of the right-hand panel: name,
  level, nature (▲/▼ on the stats it raises/lowers), the six IVs as bars (31 sparkling silver, 0 red) and a verdict from the
  IV total (0-186, a random Pokémon averages 93): EXCELLENT from 124, DECENT from 75, BAD below.
- How it's found: a battle's enemy side is a `Party` (maxCount 6, curCount, then 236-byte party Pokémon). Every
  4-byte spot in DS RAM holding 6 then 1-6 is checked; each Pokémon is decrypted the usual Gen 4 way (blocks
  shuffled by `((pid >> 13) & 31) % 24`, XOR with the LCRNG seeded by the checksum / the PID for the party
  part) and kept only if the checksum adds up. IVs are block B +0x10, level is party +0x8C.
- Left out: the player's own Pokémon (by PID, from the save's party at general block +0x90, the decomp's
  `SAVE_PARTY` right after `SAVE_PLAYERDATA`), eggs, parties of more than one, and trainer Pokémon (the game
  gives them six equal IVs). Wild doubles are two parties of one, so both show.
- Freed battle memory isn't cleared, so the box shows only Pokémon whose PID wasn't seen before, and hides once
  the player stands on a different tile than at the start (or after a catch, as it's then yours). The field is torn
  down during a battle and the player-object scan can lock onto a stale copy in freed memory, so a move only counts
  when the same object address reads a new tile (a stale copy at another address once hid the box mid-battle).
  Tap the location name: the debug line ends in `iv found/showing`.
- `node tools/test_ivs.js` checks the decryption and filters on fake RAM. Tested only with synthetic RAM so far.
