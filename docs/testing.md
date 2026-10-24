# Testing locally

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

