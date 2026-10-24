# Pokémon Player

A single-page, bring-your-own-ROM player for Pokémon games, built on [EmulatorJS](https://emulatorjs.org).
Currently focused on Gen 4 (HeartGold / SoulSilver), with Diamond, Pearl and Platinum also recognized.

- No ROMs are included in this repo or uploaded anywhere. You load your own file in the browser.
- ROMs you choose to keep, plus saves and save states, are stored in your browser (IndexedDB).
- The emulator and cores load from the EmulatorJS CDN.

## Run locally

```
py -m http.server 8000    # or: python3 -m http.server 8000
```

Then open http://localhost:8000.

## Private cloud ROMs

ROMs can live in a private Cloudflare R2 bucket and show up under "My games" after you enter a password.

- `functions/api/*` (Cloudflare Pages Functions) serve the list and the files only to a signed-in session.
- Pages project settings need an R2 binding named `ROMS` and an encrypted variable `SITE_PASSWORD`.
- Sessions last 30 days in an HttpOnly cookie. Changing `SITE_PASSWORD` signs out every device.
- Upload ROMs to the bucket from the Cloudflare dashboard (R2 > bucket > Upload). Never commit them here.

## Save sync

In-game saves sync to the same bucket under `saves/<game id>.sav` while you're unlocked.
The game id comes from the DS header (for example `nds-IPGE` for SoulSilver USA), so the same game
shares one save no matter what the ROM file is called.

- Loaded at game start, then uploaded every 30 seconds when the save changed, when the tab is hidden,
  and when you go back to the library.
- If this browser has an unsynced save that differs from the cloud, the page asks which to keep.
- Every overwrite keeps the previous version in `saves/backups/<game id>/` (last 20).
- Save states (quick-save slots) are not synced.

## Deploy

Static site with no build step. On Cloudflare Pages, use framework preset "None",
leave the build command empty, and set the output directory to `/`.
