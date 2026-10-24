/* ---------- cloud save sync ---------- */
// DS games only. Each browser/device has its own cloud save (random device id in localStorage).
// The cloud keeps the plain (raw) save; DeSmuME's .dsv footer is stripped on upload, and a cloud
// save is handed to DeSmuME as a .sav it converts at boot.
const SaveSync = (() => {
  const INTERVAL_MS = 2000; // how often the running game's save is checked
  const IDB_NAME = "/data/saves", STORE = "FILE_DATA"; // EmulatorJS/Emscripten IDBFS layout
  let id = null, emuCore = null, lastHash = null, timer = null, busy = false, seen = null;

  function status(text, cls) {
    const el = $("sync");
    el.textContent = text;
    el.className = "sync" + (cls ? " " + cls : "");
  }
  const syncedKey = () => "pp_synced_" + id;
  function getSynced() { try { return localStorage.getItem(syncedKey()); } catch { return null; } }
  function setSynced(h) { lastHash = h; try { localStorage.setItem(syncedKey(), h); } catch {} }

  // This browser's own save slot in the cloud.
  let device = null;
  function deviceId() {
    if (device) return device;
    try { device = localStorage.getItem("pp_device"); } catch {}
    if (!device || !/^[A-Za-z0-9_-]{1,64}$/.test(device)) {
      const b = crypto.getRandomValues(new Uint8Array(12));
      device = "d" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
      try { localStorage.setItem("pp_device", device); } catch {}
    }
    return device;
  }
  // shared = the old save all devices used to share (only read once, to migrate).
  const saveUrl = (extra, shared) =>
    "/api/save?" + (extra || "") + (shared ? "" : "device=" + deviceId() + "&") + "id=" + encodeURIComponent(id);

  async function sha(buf) {
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
    return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const time = (d) => new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  // Same game = same save, whatever the file is called: use the DS game code (e.g. IPGE).
  async function idFor(name, blob) {
    const b = new Uint8Array(await blob.slice(12, 16).arrayBuffer());
    const code = String.fromCharCode(...b);
    if (/^[A-Z0-9]{4}$/.test(code)) return "nds-" + code;
    return "nds-" + (name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 56) || "game");
  }

  // DeSmuME .dsv = raw save + text/info footer ending in "|-DESMUME SAVE-|".
  const enc = new TextEncoder();
  const TAIL = enc.encode("|-DESMUME SAVE-|"), SNIP = enc.encode("|<--Snip above here");
  function toRaw(bytes) {
    if (!bytes) return null;
    const n = bytes.length;
    if (n < 64 || !TAIL.every((c, i) => bytes[n - 16 + i] === c)) return bytes;
    for (let i = n - 16 - SNIP.length; i >= 0 && i > n - 4096; i--) {
      let ok = true;
      for (let j = 0; j < SNIP.length; j++) if (bytes[i + j] !== SNIP[j]) { ok = false; break; }
      if (ok) return bytes.slice(0, i);
    }
    return bytes;
  }

  /* --- direct access to the emulator's save database (before it starts) --- */
  function idbOpen() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(IDB_NAME);
      r.onupgradeneeded = () => {
        const store = r.result.objectStoreNames.contains(STORE)
          ? r.transaction.objectStore(STORE) : r.result.createObjectStore(STORE);
        if (!store.indexNames.contains("timestamp")) store.createIndex("timestamp", "timestamp", { unique: false });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function idb(mode, fn) {
    const db = await idbOpen();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  }
  const idbGet = (p) => idb("readonly", (s) => s.get(p)).then((v) => (v && v.contents ? new Uint8Array(v.contents) : null));
  const idbPut = (p, bytes) => idb("readwrite", (s) => s.put({ timestamp: new Date(), mode: 33206, contents: bytes }, p));
  const idbDel = (p) => idb("readwrite", (s) => s.delete(p));

  // Each core keeps its saves in its own subfolder of the IDBFS mount.
  const dir = () => "/data/saves/" + (emuCore === "desmume" ? "DeSmuME" : "melonDS");
  const path = (ext) => `${dir()}/${id}.${ext}`;
  const nativeExt = () => (emuCore === "desmume" ? "dsv" : "sav");
  async function ensureDir() {
    const has = await idb("readonly", (s) => s.get(dir()));
    if (!has) await idb("readwrite", (s) => s.put({ timestamp: new Date(), mode: 16893 }, dir()));
  }

  async function readLocalRaw() {
    const native = await idbGet(path(nativeExt())).catch(() => null);
    if (native && native.length) return toRaw(native);
    if (emuCore === "desmume") { // a .sav waiting to be converted counts too
      const pending = await idbGet(path("sav")).catch(() => null);
      if (pending && pending.length) return pending;
    }
    return null;
  }

  async function installLocal(raw) {
    await ensureDir();
    if (emuCore === "desmume") {
      await idbDel(path("dsv")); // DeSmuME imports a .sav only when no .dsv exists
      await idbPut(path("sav"), raw);
    } else {
      await idbPut(path("sav"), raw);
    }
  }

  async function upload(raw, hash, backupOnly) {
    const res = await fetch(saveUrl(backupOnly ? "backup=1&" : ""), { method: "PUT", credentials: "same-origin", body: raw });
    if (res.status === 401) { stop(); status("Locked: saves stay in this browser", "warn"); return false; }
    if (!res.ok) throw new Error("HTTP " + res.status);
    if (backupOnly) return true;
    const data = await res.json();
    setSynced(hash);
    status("Saved to cloud " + time(data.uploaded), "ok");
    return true;
  }

  function askConflict(cloudWhen) {
    return new Promise((resolve) => {
      $("conflictMsg").textContent =
        "Two different saves found. Cloud: " + time(cloudWhen) + ". Which one?";
      $("conflict").hidden = false;
      $("useCloud").onclick = () => { $("conflict").hidden = true; resolve("cloud"); };
      $("useLocal").onclick = () => { $("conflict").hidden = true; resolve("local"); };
    });
  }

  // Runs before the emulator loads. Returns the save name to use as EJS_gameName (or null).
  async function prepare(name, blob, system, core) {
    if (system !== "nds") { id = null; status(""); return null; }
    emuCore = core;
    id = await idFor(name, blob);
    lastHash = getSynced();
    status("Checking cloud save…");

    const get = (shared) => fetch(saveUrl("", shared), { credentials: "same-origin", cache: "no-store" });
    let res, migrating = false;
    try {
      res = await get(false);
      // This browser synced with the old shared save before but has no slot of its own yet:
      // settle against the shared save one last time, then keep the result in its own slot.
      if (res.status === 404 && lastHash) { res = await get(true); migrating = true; }
    } catch { status("Offline: saves stay in this browser", "warn"); return id; }
    if (res.status === 401) { status("Locked: unlock My games to sync saves", "warn"); return id; }
    const isJson = (res.headers.get("content-type") || "").includes("json");
    if (res.status === 404 && !isJson) { status("Cloud saves only work on the deployed site", "warn"); id = null; return null; }

    const local = await readLocalRaw();
    const localHash = local ? await sha(local) : null;

    if (res.status === 404) {
      if (localHash) await upload(local, localHash).catch(() => status("Save sync failed, will retry", "warn"));
      else status("No save yet. It will sync after you save in-game.");
      return id;
    }
    if (!res.ok) { status("Save sync failed", "warn"); return id; }

    const cloud = new Uint8Array(await res.arrayBuffer());
    const cloudHash = await sha(cloud);
    const cloudWhen = res.headers.get("x-save-uploaded");

    let choice;
    if (localHash === cloudHash) choice = "same";
    else if (!localHash || localHash === lastHash) choice = "cloud";
    else choice = await askConflict(cloudWhen);

    if (choice === "cloud") {
      if (localHash && localHash !== lastHash) await upload(local, localHash, true).catch(() => {});
      await installLocal(cloud);
      setSynced(cloudHash);
      status("Loaded cloud save from " + time(cloudWhen), "ok");
    } else if (choice === "local") {
      await upload(local, localHash).catch(() => status("Save sync failed, will retry", "warn"));
    } else {
      setSynced(cloudHash);
      status("Save in sync (" + time(cloudWhen) + ")", "ok");
    }
    if (migrating && choice !== "local") { // copy the kept save into this device's own slot
      await upload(choice === "cloud" ? cloud : local, cloudHash).catch(() => status("Save sync failed, will retry", "warn"));
    }
    return id;
  }

  function gm() { return window.EJS_emulator && window.EJS_emulator.gameManager; }

  // flush: make the core write its in-memory save to the file first. now: upload a change at once;
  // otherwise wait until the save is the same on two checks in a row, so a save the game is still
  // writing isn't uploaded half-done.
  async function tick(flush, now) {
    if (!id || busy) return;
    const g = gm();
    if (!g || !g.FS) return;
    busy = true;
    try {
      let bytes = null;
      try { bytes = g.getSaveFile(flush); } catch {}
      const raw = toRaw(bytes);
      if (!raw || !raw.length) return;
      const h = await sha(raw);
      if (h === lastHash) { seen = h; return; }
      const stable = h === seen;
      seen = h;
      if (!now && !stable) return;
      status("Syncing save…");
      await upload(raw, h);
    } catch (e) {
      status("Save sync failed, will retry", "warn");
      console.warn("save sync", e);
    } finally { busy = false; }
  }

  function stop() { if (timer) clearInterval(timer); timer = null; }

  // Called once the game is running: sanity-check the save path, then sync periodically.
  function started() {
    if (!id) return;
    const g = gm();
    try {
      const p = g.getSaveFilePath();
      if (p !== path(nativeExt())) {
        console.warn("Unexpected save path", p, "expected", path(nativeExt()));
        status("Save path mismatch (" + p + "): cloud sync paused", "warn");
        id = null;
        return;
      }
    } catch {}
    stop();
    timer = setInterval(() => tick(true), INTERVAL_MS);
  }

  document.addEventListener("visibilitychange", () => { if (document.hidden) tick(true, true); });

  return { prepare, started, flush: () => tick(true, true) };
})();

