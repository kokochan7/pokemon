# Emulator (EmulatorJS)

Code: `js/app.js` (`launch()`, `pinMenuBar()`, speed button, `fixCheatToggle()`).

- Loaded from `https://cdn.emulatorjs.org/stable/data/` (v4.2.3 at time of writing).
- **DS core defaults to DeSmuME.** An early melonDS test showed "A communication error has occurred" on
  Continue, back when saves were injected mid-game. Retested 2026-10-24 with a dummy ROM that reads and writes
  the save chip through the HGSS IR passthrough: melonDS reads a save put in place before boot, writes it,
  and keeps it across reloads, same as DeSmuME. **But with Kenny's real HeartGold it still fails** (2026-10-24):
  fresh save in melonDS, Exit after the save had synced, reopen, Continue → communication error. So it isn't
  the save file plumbing or Exit timing; the libretro melonDS core's save/IR code matches upstream, cause unknown.
  The core note on the main page says HGSS saves don't load in melonDS. A **DS CORE** picker in the GAMES box
  (back at Kenny's request, 2026-10-24) stores the choice in localStorage `pp_nds_core` (default `desmume`).
  Choosing melonDS shows a short note to switch back if Continue fails. The Speed button's frameskip and the
  advanced-timing option apply only to DeSmuME. The guide and Exp. Share find DS RAM through the ROM header
  copy, which should work with either core, but they have only been tested with DeSmuME.
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
- **Multi-core (threads).** `_headers` serves every page with `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: credentialless`, so the page is cross-origin isolated and gets SharedArrayBuffer.
  `launch()` then sets `EJS_threads`, EmulatorJS loads `desmume-thread-wasm.data`, and `desmume_num_cores`
  (DeSmuME's 3D rasterizer threads) defaults to cores - 1, at most 3 (the core's thread pool is 4).
  `credentialless` lets no-cors requests through without cookies, so the hot-linked PokeAPI sprites and type icons,
  Google Fonts and the EmulatorJS CDN keep working without being hosted here (checked in Chromium, 2026-10-24).
  Browsers without credentialless COEP (Safari) aren't isolated and silently get the normal single-thread build.
  Guide, Exp. Share and save sync work the same on the shared heap. The speed gain could only be checked with a stub ROM
  (no 3D), which showed no change. The gain is in HGSS's 3D overworld on a real game, so it is unmeasured here.
- Avoid calling `gameManager.loadSaveFiles()` or writing saves mid-game. Saves go in before boot.

- **Cheats menu: switching a cheat off.** EmulatorJS sends each toggle straight to the core's `retro_cheat_set(index,
  enabled, code)`, and libretro DeSmuME ignores `enabled` and always adds the code, so "off" just added a second copy
  and the code kept writing RAM. `fixCheatToggle()` (run at game start) replaces `EJS_emulator.cheatChanged`: every
  toggle or delete calls `resetCheat()` and re-adds only the cheats still on. Whatever a code already wrote stays
  in RAM until the game changes it (e.g. a Repel counter just counts down). Checked 2026-10-27 with a stub ROM:
  AR codes only run on the ARM7 VBlank IRQ, so the stub's ARM7 must enable it (DISPSTAT bit 3, IE bit 0).
