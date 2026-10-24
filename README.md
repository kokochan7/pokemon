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

## Deploy

Static site with no build step. On Cloudflare Pages, use framework preset "None",
leave the build command empty, and set the output directory to `/`.
