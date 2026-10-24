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
  item balls, trainers and doors go on top. Tiles are shown at least 6px: a map that doesn't fit
  scrolls in its box and follows the player (paused 4s after you scroll it or pick a row).
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
  the newest slot of the current save file, every 5s until found, then reads the map id every second.
- The trainer name + ID also turns up in other structs (first live test locked onto one and showed
  "Mystery Zone, Map 0"). Each match is scored by how much of the save's general block it reproduces;
  only matches above 50% with a map id above 1 count.
- While the guide is still looking for the game (the GUIDE/"Waiting" screen) it shows a debug line, e.g.
  `1 RAM · 97%:33 r, 3%:0 r` (header copies found in RAM, then each match as score:map id, r = inside DS RAM).
  Kenny asked for it to be hidden once the map shows. Ask him for a screenshot if it misbehaves.
- The emulator also keeps the cartridge's save memory in the heap, which holds the same bytes but only
  changes on save. `Guide` keeps the match that lies inside DS main RAM: boot copies the ROM header to
  0x027FFE00, i.e. RAM base + 0x3FFE00 (checked in the real core with a stub ROM). If that can't be
  found it follows whichever match changed last.
- A brand-new game with no save yet shows "Save in-game once to start the guide."
- Map ids are the decomp's `MAP_*` constants (0-539).
- To rebuild the data: clone pret/pokeheartgold and run `python3 tools/guide_data.py <path> > guide/hgss.json`.
  Grass rates are the Gen 4 slot rates; rod and Rock Smash rows show levels only.

## NEXT: the story walkthrough

- Order in the left column: location, MAP, NEXT, ITEMS (Kenny wanted the map on top).
- Code: `js/story.js` (`Story`, loaded before `js/guide.js`). Steps: `guide/story.json`, written by hand in our own
  words (40 steps from the starter to Red). Each step is a title plus short to-do bullets, each with its own
  condition so it ticks itself; a bullet with no condition shows as a plain dot. Kenny wants everything visible at a
  glance: no fold, no long paragraphs, no trainer list, icons over words.
- Under the bullets: each boss (name, type icons, "Weak" + type icons, team sprites; dimmed with a tick once beaten)
  The step's "CATCH" grid (sprites + where) goes in the right panel between WILD and TRAINERS (`Story.catches()`). Type icons are PokeAPI's Gen IV HGSS type sprites
  (hot-linked, `sprites/types/generation-iv/heartgold-soulsilver/<type id>.png`).
- `guide/bosses.json` = `teams` (trainer id -> party) + `dex` (catch name -> dex number), generated by
  `python3 tools/story_data.py <pokeheartgold> > guide/bosses.json` from the ids and names story.json uses; rerun it
  after adding a boss or a catch. Trainer ids are the `TRAINER_*` numbers in trainers.h, not the constant's suffix
  (TRAINER_RIVAL_SILVER_8 is 267).
- Progress is read live from the save data in DS RAM (general block, same base the map id uses): `SaveVarsFlags`
  starts at +0xDE4 (u16 vars for ids 0x4000-0x416F), its flag bits at +0x10C4. Trainer N beaten = flag 0x550 + N.
  Fly-point flags 0x9B0-0x9D5 mark towns visited (0x9BD Violet, 0x9BF Goldenrod...). Johto/Kanto badges at
  +0x7E/+0x83. The player's starter species is var 0x4030 (picks the rival's team).
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
