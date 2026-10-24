# Save sync (DS games)

Code: `js/savesync.js` (front end), `functions/api/save.js` (server).

- Save id = `nds-<4-char game code>` from the ROM header at 0x0C (e.g. `nds-IPGE` = SoulSilver USA), so
  one save per game regardless of file name. `EJS_gameName` is set to this id, which fixes the file name.
- **Each browser/device has its own save.** A random device id is kept in localStorage `pp_device`, and the
  cloud copy lives at `saves/devices/<device>/<id>.sav` (API: `/api/save?device=<device>&id=<id>`), backups in
  `saves/backups/devices/<device>/<id>/`. The cloud copy is a backup of that browser's save, not shared.
  Clearing site data gives the browser a new id and an empty slot; the old slot stays in R2.
- Before 2026-10-24 all devices shared one save at `saves/<id>.sav` (no `device=`). It is left in place.
  A browser that synced with it before (`pp_synced_<id>` set) and has no slot yet settles against the shared
  save one last time (same conflict rule), then stores the result in its own slot. New browsers start empty.
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
- Server keeps the previous version on every overwrite in the slot's backups folder (last 20).
- `SaveSync.started()` checks `getSaveFilePath()` matches the expected path and pauses sync if not.
- While the game runs, every 2s the page makes the core flush its save to the file
  (`gameManager.functions.saveSaveFiles()` = `cmd_savefiles`, then `getSaveFile(false)`, which reads it once;
  `getSaveFile(true)` would read it twice) and hashes it. A change is uploaded once it is the same on two
  checks in a row (the game writes a save over a few seconds), so an in-game save reaches the cloud in
  about 2 to 4 seconds. Tab hide and "Exit" flush and upload at once.
- Save states are not synced (core-specific, browser-only).

HGSS save sanity check: 512 KB, two 256 KB slots. General block 0xF628 bytes, storage block at
+0xF700 (0x12310 bytes). Footer magic 0x20060623, CRC-16-CCITT (init 0xFFFF) over block minus 0x10 bytes.

