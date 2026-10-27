# Kenny's Pokémon Player

Kenny's personal, bring-your-own-ROM Pokémon emulator site: one static page plus a few Cloudflare
Pages Functions. Focused on Gen 4 DS (HeartGold / SoulSilver).

- Live: https://pokemon-90a.pages.dev (Cloudflare Pages project `pokemon`).
- Every push to `main` auto-deploys. No build step, output dir `/`: plain files only, no bundler.
- Kenny works on Windows (repo in `Documents\pokemon`).

## Hard rules

- **IMPORTANT: never commit ROMs or save files** (`.gitignore` blocks `*.nds *.gba *.gb *.gbc *.zip *.sav *.state`).
  The site must never host or serve a ROM publicly. ROMs live only in the private R2 bucket `pokemon-roms`
  (binding `ROMS`) and are served only to a password-authenticated session.
- Never put the password anywhere in code, commits or chat. It lives only in the Cloudflare secret
  `SITE_PASSWORD`, which Kenny sets himself.
- Ask before changing Cloudflare billing, subscriptions or account settings.
- Original art only, except the guide panel's hot-linked PokeAPI sprites. Never commit sprites.
- Tests use dummy bytes for ROMs and saves, never real game files.

## Where things are

```
_headers            COOP/COEP (credentialless) so the threaded multi-core emulator can run
index.html          Markup only; loads css/style.css, scene.svg and the js/ files below (in this order)
js/app.js           Constants (NDS_GAMES, CORES), IndexedDB helpers, launch(), menu bar, Speed button
js/savesync.js      SaveSync: per-device cloud save backup for DS games
js/story.js         Story: NEXT walkthrough steps, story progress from DS RAM flags/vars
js/guide.js         Guide: HGSS guide panel (live map from DS RAM, mini map, encounters, trainers)
js/ivs.js           WildIVs: decrypts the wild Pokémon you're battling from DS RAM and rates its IVs (guide box)
js/expshare.js      ExpShare: always-on Exp. Share (fighter 100%, benched 50%) and +5 trainer levels, patched in DS RAM
js/library.js       GAMES (cloud) and STORED (local) lists, login, clock; runs the page start-up
css/style.css       All styles
scene.svg           Generated background art. Don't read it; regenerate with python3 tools/scene.py
lib/auth.js         Password check + HMAC-signed session cookie
functions/api/      login, logout, roms (list), romfile (?key=), save (?id=, backups)
guide/hgss.json     Generated guide data (220 KB). Don't read it whole; query it with python or jq
guide/story.json    Hand-written story steps for NEXT; guide/bosses.json = their teams (tools/story_data.py)
tools/              scene.py (background art), guide_data.py (builds hgss.json from pret/pokeheartgold), story_data.py,
                    test_expshare.js, test_ivs.js (node, fake RAM)
```

The js/ files are classic scripts sharing one global scope (no modules), so a top-level name in one
file is visible in the others. Keep the load order in `index.html`.

## Read the matching doc before working on an area

- `docs/design.md`: look and feel, GAMES/STORED behaviour, adding games, the background scene.
- `docs/emulator.md`: EmulatorJS setup, why DeSmuME, menu bar, Speed button. Read before touching `launch()`.
- `docs/save-sync.md`: save ids, IDBFS paths, .dsv handling, conflict rule, HGSS save layout.
- `docs/guide-panel.md`: guide layout, RAM scanning, terrain from the ROM, rebuilding hgss.json.
- `docs/exp-share.md`: the Exp. Share and trainer-level RAM patches (addresses, what each instruction change does).
- `docs/testing.md`: wrangler dev server, testing with the real emulator offline, gotchas.
- `docs/ideas.md`: backlog.

## Must-know gotchas

- DS core defaults to DeSmuME; keep it the default. A main-page picker offers melonDS, but real HGSS saves made in it don't load back (see docs/emulator.md).
- Never call `gameManager.loadSaveFiles()` or write saves mid-game. Saves go in before boot (`SaveSync.prepare()`).
- The built-in Restart skips saving, so it's disabled (`EJS_Buttons = { restart: false }`).

## Checking a change

- Quick look: `python3 -m http.server 8000` and open http://localhost:8000 (API calls 404 there).
- With the API: `npx wrangler pages dev . --r2 ROMS=roms-test --binding SITE_PASSWORD=testpw123 --port 8788`.
- Playwright and Chromium are usually available: load the page, check for console errors and take a screenshot.

## Working on this project

- Keep CLAUDE.md short. Put details in the matching `docs/*.md`, and update it in the same commit as
  the behaviour or layout change.
- Read only the part of a file you need (grep for the function first); `js/guide.js` is the largest file.
