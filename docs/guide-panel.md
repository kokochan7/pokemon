# Guide panel (HeartGold / SoulSilver)

Code: `js/guide.js`. Data: `guide/hgss.json` (220 KB, built by `tools/guide_data.py`; query it with python/jq, don't read it whole).

- A panel on the right of the game (desktop, 900px+ wide) shows, for the current map: NEXT (the story
  step for the badges you have, read live from the save data in RAM: trainer block +0x1A Johto,
  +0x1F Kanto; the step text is written by us in `JOHTO`/`KANTO`/`nextStep()`), a MAP, EXITS (neighbouring
  overworld maps by direction, plus doors), items with hidden ones marked, wild Pokémon (grass by MORN/DAY/NITE, surfing, rods, Rock
  Smash), and trainers with their teams. Hovering or tapping an item or
  trainer rings its spot on the map; the map sticks to the top while scrolling.
- Layout: one 300px panel on the right from 900px wide. From 1300px wide it splits around the game:
  `#guideL` on the left (location, next, map, items, exits) and `#guide` on the right (wild Pokémon,
  trainers), 320px each. Both have class `.guide`. The map is scaled to the column width, up to ~55%
  of the screen height, keeping its shape.
- The mini map is drawn from the terrain in Kenny's own ROM, read in the browser (`Terrain`): NitroFS
  file `a/0/6/5` is the land-data NARC. Each member starts with four u32 section sizes, then (HGSS only)
  a background-sound section `0x1234, u16 length, data`; the 32x32 u16 terrain attributes follow it at
  +0x14+length (low byte = tile behaviour, bit 15 = wall). Reading them at a fixed +0x14 shifted the
  terrain under the item and trainer spots (fixed 2026-10-24). hgss.json says which land-data blocks make up each map (`blocks`,
  plus dimmed `near` blocks that its events spill into) and the colour class per behaviour (`tiles`).
  Nothing from the ROM is uploaded or committed.
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
- The panel footer shows a debug line, e.g. `Map 33 · 1 RAM · 97%:33 r, 3%:0 r` (header copies found in
  RAM, then each match as score:map id, r = inside DS RAM). Ask Kenny for a screenshot if it misbehaves.
- The emulator also keeps the cartridge's save memory in the heap, which holds the same bytes but only
  changes on save. `Guide` keeps the match that lies inside DS main RAM: boot copies the ROM header to
  0x027FFE00, i.e. RAM base + 0x3FFE00 (checked in the real core with a stub ROM). If that can't be
  found it follows whichever match changed last.
- A brand-new game with no save yet shows "Save in-game once to start the guide."
- Map ids are the decomp's `MAP_*` constants (0-539).
- To rebuild the data: clone pret/pokeheartgold and run `python3 tools/guide_data.py <path> > guide/hgss.json`.
  Grass rates are the Gen 4 slot rates; rod and Rock Smash rows show levels only.

