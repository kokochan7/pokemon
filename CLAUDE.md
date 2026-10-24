# Pokémon Player

Kenny's personal, bring-your-own-ROM Pokémon emulator site. One static page plus a few
Cloudflare Pages Functions. Currently focused on Gen 4 DS (HeartGold / SoulSilver).

- Live: https://pokemon-90a.pages.dev (Cloudflare Pages project `pokemon`)
- Repo: github.com/kokochan7/pokemon. Every push to `main` auto-deploys. No build step, output dir `/`.

## Hard rules

- **Never commit ROMs or save files** (`.gitignore` blocks `*.nds *.gba *.gb *.gbc *.zip *.sav *.state`).
  The site must never host or serve a ROM publicly. ROMs live only in the private R2 bucket and are
  served only to a password-authenticated session.
- Never put the password anywhere in code, commits or chat. It lives only in the Cloudflare secret
  `SITE_PASSWORD`, which Kenny sets himself.
- Ask before changing Cloudflare billing, subscriptions or account settings.

## Layout

```
index.html              The whole front end (UI, EmulatorJS launcher, local library, cloud games, save sync)
lib/auth.js             Password check, HMAC-signed session cookie (pp_session, 30 days, HttpOnly)
functions/api/login.js  POST {password} -> sets cookie (1s delay on failure)
functions/api/logout.js POST -> clears cookie
functions/api/roms.js   GET -> list ROMs in R2 (hides the saves/ prefix)
functions/api/romfile.js GET ?key=<R2 key> -> stream a ROM (auth required)
functions/api/save.js   GET/PUT ?id=<save id> -> in-game save; PUT keeps backups; ?backup=1 = backup only
```

Cloudflare config (dashboard, not in the repo):
- R2 bucket `pokemon-roms`, public access disabled, bound to the Pages project as `ROMS`.
- Encrypted variable `SITE_PASSWORD`. Changing it signs out every device.

## Emulator (EmulatorJS)

- Loaded from `https://cdn.emulatorjs.org/stable/data/` (v4.2.3 at time of writing).
- **DS core defaults to DeSmuME.** melonDS in this build wrote HGSS saves but could not read them back
  ("A communication error has occurred" on Continue). A "DS core" picker on the main page stores the
  choice in localStorage `pp_nds_core`.
- `EJS_Buttons = { restart: false }`: the built-in Restart is a bare core reset that skips saving.
  Restart = "← Library" then Play (page reload).
- `EJS_defaultOptions = { "save-save-interval": "30" }`: EmulatorJS flushes the in-game save itself.
- The menu bar is kept visible on desktop via CSS overrides of `.ejs_menu_bar_hidden`, with
  `--ejs-bar` reserving space under the canvas (`pinMenuBar()`). EmulatorJS puts `ejs_big_screen`
  on the `#game` element itself.
- Avoid calling `gameManager.loadSaveFiles()` or writing saves mid-game. Saves go in before boot.

## Save sync (DS games)

- Save id = `nds-<4-char game code>` from the ROM header at 0x0C (e.g. `nds-IPGE` = SoulSilver USA), so
  one save per game regardless of file name. `EJS_gameName` is set to this id, which fixes the file name.
- EmulatorJS saves live in IndexedDB database `/data/saves`, store `FILE_DATA` (Emscripten IDBFS),
  keyed by full path, value `{timestamp, mode, contents}`. Each core uses its own folder:
  `/data/saves/DeSmuME/<id>.dsv` and `/data/saves/melonDS/<id>.sav`.
- `SaveSync.prepare()` runs **before** the emulator loads: it fetches the cloud save, compares it with the
  local one, and writes the chosen save straight into IDBFS. For DeSmuME it deletes the `.dsv` and writes
  a raw `.sav`, which DeSmuME converts at boot.
- The cloud always stores the **raw** save. DeSmuME's `.dsv` footer (`|<--Snip above here...` through
  `|-DESMUME SAVE-|`) is stripped on upload (`toRaw()`).
- Conflict rule: if the local save changed since the last sync (hash in localStorage `pp_synced_<id>`)
  and differs from the cloud, the page asks which to keep. The loser is uploaded as a backup.
- Server keeps the previous version on every overwrite in `saves/backups/<id>/` (last 20).
- `SaveSync.started()` checks `getSaveFilePath()` matches the expected path and pauses sync if not.
- Periodic sync reads passively every 30s, and also syncs on tab hide and on "← Library".
- Save states are not synced (core-specific, browser-only).

HGSS save sanity check: 512 KB, two 256 KB slots. General block 0xF628 bytes, storage block at
+0xF700 (0x12310 bytes). Footer magic 0x20060623, CRC-16-CCITT (init 0xFFFF) over block minus 0x10 bytes.

## Testing locally

```
npm i -D wrangler@3
npx wrangler pages dev . --r2 ROMS=roms-test --binding SITE_PASSWORD=testpw123 --port 8788
```

- Use dummy bytes for ROMs and saves in tests, never real game files.
- To test against the real emulator offline: `npm pack @emulatorjs/emulatorjs` and
  `@emulatorjs/core-desmume` / `core-melonds` (cores are 7z `.data` files), serve them, and use Playwright
  `route()` to map `cdn.emulatorjs.org/stable/data/**` to the local copies. A stub ROM with game code
  `IPGE` at 0x0C is enough to check save paths and injection.
- Gotcha: `wrangler r2 object put` with spaces in the key stores `%20` literally.
- Gotcha: Pages Functions path params arrive URL-encoded, which is why ROMs are fetched with `?key=`.

## Ideas not done yet

- Gen 5 / GBA games: add header codes to `NDS_GAMES`, and handle save paths for non-DS cores.
- Sync save states.
- Cloudflare Access instead of the password (needs Zero Trust onboarding).
