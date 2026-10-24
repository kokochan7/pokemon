# Emulator (EmulatorJS)

Code: `js/app.js` (`launch()`, `pinMenuBar()`, speed button).

- Loaded from `https://cdn.emulatorjs.org/stable/data/` (v4.2.3 at time of writing).
- **DS core defaults to DeSmuME.** melonDS in this build wrote HGSS saves but could not read them back
  ("A communication error has occurred" on Continue). There is no picker in the UI any more; the core
  comes from localStorage `pp_nds_core` (default `desmume`).
- `EJS_Buttons = { restart: false }`: the built-in Restart is a bare core reset that skips saving.
  Restart = "Exit" then Play (page reload).
- `EJS_defaultOptions = { "save-save-interval": "30", "desmume_advanced_timing": "disabled" }`: EmulatorJS
  flushes the in-game save itself; advanced bus-level timing costs speed HGSS doesn't need. Advanced timing is
  also set again at game start, because EmulatorJS's remembered per-game settings override the defaults.
- Performance (audit 2026-10-24, real core + dummy ROM): the page's own timers (guide, save sync, Exp. Share)
  take about 0.5% of the main thread. Turning them off didn't change the frame rate, so the emulator is the
  bottleneck. Watch out for long tasks: anything that walks the whole ~160 MB wasm heap stalls the game for
  a good part of a second.
- The menu bar is kept visible on desktop via CSS overrides of `.ejs_menu_bar_hidden`, with
  `--ejs-bar` reserving space under the canvas (`pinMenuBar()`). EmulatorJS puts `ejs_big_screen`
  on the `#game` element itself.
- A **Speed** button (added by `addSpeedButton()` at game start) sits in the menu bar after the
  left-hand buttons and toggles 1x / 2x via EmulatorJS's `fastForward` / `ff-ratio` settings.
  The ratio is only a cap: DeSmuME in wasm is interpreter-only, so the CPU limits real speed. 2x also
  sets `desmume_frameskip` to 2 (1 frame in 3 drawn, 40 a second) so less time goes to drawing: on a
  weaker PC 2x felt like 1x (2026-10-24), and skipping drawing was the biggest lever measured. A 5x step was tried and removed: on
  Kenny's PC it felt no faster than 2x.
  It's inserted by hand because custom `EJS_Buttons` entries are rejected in 4.2.3. Every game boots at 2x.
- `tuneRetroArch()` (set as `EJS_ready`) patches `EJS_GameManager.prototype.getRetroArchCfg` to append
  `notification_show_fast_forward = "false"` (no "Fast-Forward." on-screen message).
- 2x audio uses RetroArch's default: normal pitch, with chunks dropped to keep up, so it can
  crackle. `audio_fastforward_speedup = "true"` (faster, higher-pitched) was tried and sounded worse
  to Kenny. Pitch-preserving time-stretch isn't available in this RetroArch build, and true 1x audio
  at 2x game speed can't exist (the game makes twice the sound per second). Muting at 2x is
  `audio_fastforward_mute = "true"`.
- Avoid calling `gameManager.loadSaveFiles()` or writing saves mid-game. Saves go in before boot.

