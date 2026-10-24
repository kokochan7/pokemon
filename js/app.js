const DATA_PATH = "https://cdn.emulatorjs.org/stable/data/";
const CORES = { gb: "gb", gbc: "gb", gba: "gba", nds: "nds" };
const LABEL = { gb: "Game Boy / Color", gba: "Game Boy Advance", nds: "Nintendo DS" };

// The first 3 letters of an NDS game code (4 bytes at offset 0x0C of the ROM header)
// identify the game; the 4th is the region. Add more Pokémon games here as you go.
const NDS_GAMES = {
  IPK: { title: "Pokémon HeartGold", tint: "#d4a017" },
  IPG: { title: "Pokémon SoulSilver", tint: "#aab4c4" },
  ADA: { title: "Pokémon Diamond", tint: "#7aa7e0" },
  APA: { title: "Pokémon Pearl", tint: "#e0a0c0" },
  CPU: { title: "Pokémon Platinum", tint: "#9a9a9a" },
};
const REGION = { E: "English", J: "Japan", P: "Europe", D: "Germany", F: "France", I: "Italy", S: "Spain", K: "Korea" };

// Games stored before the rename have region "USA" saved with them.
function gameLabel(g) {
  const region = g.region === "USA" ? "English" : g.region;
  return g.title + (region ? " (" + region + ")" : "");
}

async function identify(file) {
  if (!/\.nds$/i.test(file.name)) return null;
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const code = String.fromCharCode(...bytes.slice(12, 16));
  const g = NDS_GAMES[code.slice(0, 3)];
  return g ? { title: g.title, tint: g.tint, region: REGION[code[3]] || "" } : null;
}

const $ = (id) => document.getElementById(id);

function ndsCore() {
  try { return localStorage.getItem("pp_nds_core") || "desmume"; } catch { return "desmume"; }
}
const menu = $("menu"), player = $("player"), err = $("err");

/* ---------- tiny IndexedDB library ---------- */
const DB = "rom-library", STORE = "roms";
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function dbDo(mode, fn) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
const dbAll = () => dbDo("readonly", (s) => s.getAll());
const dbGet = (id) => dbDo("readonly", (s) => s.get(id));
const dbPut = (rec) => dbDo("readwrite", (s) => s.put(rec));
const dbDel = (id) => dbDo("readwrite", (s) => s.delete(id));

/* ---------- helpers ---------- */
function detectCore(name, override) {
  if (override && override !== "auto") return override;
  const ext = name.split(".").pop().toLowerCase();
  return CORES[ext] || null;
}
const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";

/* ---------- launch ---------- */
async function launch(name, blob, core, label) {
  document.body.classList.add("playing");
  menu.hidden = true;
  player.hidden = false;
  $("title").textContent = label || name;

  window.EJS_player = "#game";
  // DS games: use the chosen core. melonDS in this EmulatorJS build can fail to read
  // HeartGold/SoulSilver saves ("A communication error has occurred"); DeSmuME handles them.
  const emuCore = core === "nds" ? ndsCore() : core;
  window.EJS_core = emuCore;

  // Put the right save in place BEFORE the emulator boots (DS games), so the game reads it
  // at power-on like a real cartridge. Returns the fixed save name to use as the game name.
  const saveName = await SaveSync.prepare(name, blob, core, emuCore);
  window.EJS_gameName = saveName || name.replace(/\.[^.]+$/, "");
  if (core === "nds") { Guide.prepare(blob); ExpShare.prepare(blob); }

  window.EJS_gameUrl = new Blob([blob]);
  window.EJS_pathtodata = DATA_PATH;
  window.EJS_startOnLoaded = true;
  window.EJS_color = "#e3350d";
  window.EJS_ready = tuneRetroArch;
  window.EJS_onGameStart = () => {
    SaveSync.started();
    Guide.started();
    ExpShare.started();
    pinMenuBar();
    addSpeedButton();
  };
  // The emulator's Restart is a bare core reset that skips saving and can leave DS games
  // unable to read their save ("A communication error has occurred"). Use ← Library instead.
  window.EJS_Buttons = { restart: false };
  // Let EmulatorJS write the in-game save to its file every 30s (its own supported path);
  // the cloud sync just reads that file.
  window.EJS_defaultOptions = { "save-save-interval": "30" };

  const s = document.createElement("script");
  s.src = DATA_PATH + "loader.js";
  s.onerror = () => {
    player.hidden = true; menu.hidden = false;
    document.body.classList.remove("playing");
    err.textContent = "Couldn't load the emulator from the CDN. Check your internet connection.";
  };
  document.body.appendChild(s);
}

// Reserve room under the game for the (always-visible) EmulatorJS menu bar.
function pinMenuBar() {
  const update = () => {
    const bar = window.EJS_emulator && window.EJS_emulator.elements && window.EJS_emulator.elements.menu;
    if (bar) $("game").style.setProperty("--ejs-bar", bar.offsetHeight + "px");
  };
  update();
  setTimeout(update, 500);
  window.addEventListener("resize", () => setTimeout(update, 100));
}

// Extra RetroArch settings, appended to the retroarch.cfg EmulatorJS writes before the core
// boots (4.2.3 has no option for this): no "Fast-Forward." on-screen message.
// Audio at 2x is left as RetroArch's default (normal pitch, chunks dropped to keep up);
// audio_fastforward_speedup = "true" was tried and Kenny found it sounded worse.
const RETROARCH_CFG = 'notification_show_fast_forward = "false"\n';
function tuneRetroArch() {
  const GM = window.EJS_GameManager;
  if (!GM || GM.prototype.ppTuned) return;
  const base = GM.prototype.getRetroArchCfg;
  GM.prototype.getRetroArchCfg = function () { return base.call(this) + RETROARCH_CFG; };
  GM.prototype.ppTuned = true;
}

// Speed button in the emulator's menu bar: each click toggles 1x / 2x.
// Added by hand because custom EJS_Buttons are rejected in EmulatorJS 4.2.3. It drives
// EmulatorJS's own fast-forward settings, so Settings > Speed Options stay in step.
// The ratio is only a cap: DeSmuME in the browser has no JIT, so the CPU sets the real top
// speed. Skipping the drawing of most frames (FRAMESKIP) leaves more of it for the game.
const SPEEDS = [1, 2];
const FRAMESKIP = { 1: "0", 2: "1" };
let speedIdx = 0;
function addSpeedButton() {
  const emu = window.EJS_emulator, bar = emu && emu.elements && emu.elements.menu;
  if (!bar || $("speedLabel")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ejs_menu_button";
  btn.innerHTML = '<svg viewBox="0 0 24 24" role="presentation" focusable="false"><text id="speedLabel" ' +
    'x="12" y="17" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="bold">1x</text></svg>' +
    '<span class="ejs_menu_text">Speed</span>';
  btn.onclick = () => setSpeed(speedIdx + 1);
  bar.insertBefore(btn, bar.querySelector(".ejs_menu_bar_spacer"));
  setSpeed(1); // EmulatorJS remembers fast-forward per game; always boot at 2x
}
function setSpeed(i) {
  const emu = window.EJS_emulator;
  speedIdx = i % SPEEDS.length;
  const x = SPEEDS[speedIdx];
  emu.changeSettingOption("desmume_frameskip", FRAMESKIP[x]);
  if (x > 1) {
    emu.changeSettingOption("ff-ratio", x.toFixed(1));
    emu.changeSettingOption("fastForward", "enabled");
  } else {
    emu.changeSettingOption("fastForward", "disabled");
  }
  $("speedLabel").textContent = x + "x";
}

// The emulator can't be cleanly torn down, so going back is a page reload.
// Push any unsynced save first.
$("back").onclick = async () => {
  $("back").disabled = true;
  await SaveSync.flush().catch(() => {});
  location.reload();
};

