# Emulator (EmulatorJS)

Code: `js/app.js` (`launch()`, `pinMenuBar()`, speed button).

- Loaded from `https://cdn.emulatorjs.org/stable/data/` (v4.2.3 at time of writing).
- **DS core defaults to DeSmuME.** melonDS in this build wrote HGSS saves but could not read them back
  ("A communication error has occurred" on Continue). There is no picker in the UI any more; the core
  comes from localStorage `pp_nds_core` (default `desmume`).
- `EJS_Buttons = { restart: false }`: the built-in Restart is a bare core reset that skips saving.
  Restart = "Exit" then Play (page reload).
- `EJS_defaultOptions = { "save-save-interval": "30" }`: EmulatorJS flushes the in-game save itself.
- The menu bar is kept visible on desktop via CSS overrides of `.ejs_menu_bar_hidden`, with
  `--ejs-bar` reserving space under the canvas (`pinMenuBar()`). EmulatorJS puts `ejs_big_screen`
  on the `#game` element itself.
- A **Speed** button (added by `addSpeedButton()` at game start) sits in the menu bar after the
  left-hand buttons and toggles 1x / 2x via EmulatorJS's `fastForward` / `ff-ratio` settings.
  The ratio is only a cap: DeSmuME in wasm is interpreter-only, so the CPU limits real speed. 2x also
  sets `desmume_frameskip` to 1 so less time goes to drawing. A 5x step was tried and removed: on
  Kenny's PC it felt no faster than 2x.
  It's inserted by hand because custom `EJS_Buttons` entries are rejected in 4.2.3. Every game boots at 2x.
- Avoid calling `gameManager.loadSaveFiles()` or writing saves mid-game. Saves go in before boot.

