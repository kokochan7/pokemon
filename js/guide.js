/* ---------- guide panel (HeartGold / SoulSilver) ---------- */
// Shows the wild Pokémon, items and trainers of the map the player is on. The game keeps its
// live position inside its save data in DS RAM (general block +0x1234 = current map id, the
// same layout as the save file). The page finds that block in the emulator's memory by
// looking for the trainer name + ID from the save file, then reads the map id every second.
// Map data comes from guide/hgss.json, built by tools/guide_data.py.
const Guide = (() => {
  const GAMES = { IPK: "hg", IPG: "ss" };
  const SLOTS = [0, 0x40000];            // HGSS keeps two 256 KB save slots
  const TRAINER = 0x64, MAP = 0x1234;    // offsets in the general block
  const RAM_SIZE = 0x400000, HEADER_IN_RAM = 0x3FFE00; // boot copies the ROM header to 0x027FFE00
  const SPRITE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-iv/heartgold-soulsilver/";
  const ITEM_ICON = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/";
  const METHODS = { surf: "Surfing", rock: "Rock Smash" };
  const RODS = ["oldrod", "goodrod", "superrod"];
  let ver = null, header = null, data = null, tiles = {}, shown = null, timer = null, scans = 0, tod = null, story = null, storyBase = null;
  const el = () => $("guide");
  const wide = matchMedia("(min-width: 1300px)");

  function visible() { try { return localStorage.getItem("pp_guide") !== "off"; } catch { return true; } }
  function setVisible(on) {
    try { localStorage.setItem("pp_guide", on ? "on" : "off"); } catch {}
    el().hidden = !on;
    $("guideL").hidden = !on || !$("guideL").firstChild;
    setTimeout(() => window.dispatchEvent(new Event("resize")), 0); // let the emulator refit
  }

  // The panels grow to fill the width the game leaves free (Kenny, 2026-10-26: tiny on a 24" monitor at
  // 100% scaling). The DS screens are stacked (256x384), so the game is 2/3 as wide as it is tall; the
  // rest of the width goes to the panels, zoomed up from their normal size (never down). The zoom is also
  // kept to the screen's height over FIT_H, so a tall panel doesn't turn into a long scroll; at FIT_H or
  // less (Kenny's 200% screen) the panels keep their normal size.
  // Sizes inside the panels stay in their own unzoomed px; only window sizes need dividing by `zoom`.
  const ZOOM_MAX = 2.5, FIT_H = 620;
  let zoom = 1;
  function fit() {
    const g = el(), gl = $("guideL"), scr = g.parentElement;
    if (!scr || !scr.clientHeight) return;
    const bar = parseFloat(getComputedStyle($("game")).getPropertyValue("--ejs-bar")) || 0;
    const gameW = Math.min(1100, (scr.clientHeight - bar) * 2 / 3);
    const split = wide.matches, panelW = split ? 320 : 300;
    const room = (scr.clientWidth - gameW - 8) / (split ? 2 : 1);
    const z = Math.max(1, Math.floor(Math.min(ZOOM_MAX, room / panelW, scr.clientHeight / FIT_H) * 20) / 20);
    if (z === zoom) return;
    zoom = z;
    g.style.zoom = gl.style.zoom = z === 1 ? "" : z;
    if (shown != null) render(shown);
    setTimeout(() => window.dispatchEvent(new Event("resize")), 0); // let the emulator refit
  }
  addEventListener("resize", () => setTimeout(fit, 150)); // after app.js has measured the menu bar

  async function prepare(blob) {
    const h = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    ver = GAMES[String.fromCharCode(...h.slice(12, 15))] || null;
    if (!ver) return;
    header = h;
    $("guideBtn").hidden = false;
    $("guideBtn").onclick = () => setVisible(el().hidden);
    el().hidden = !visible();
    wide.addEventListener("change", () => { if (shown != null) render(shown); });
    render(null, "Loading…");
    Terrain.open(blob).then(() => { if (shown != null) render(shown); });
    Story.load(ver).then(() => { if (shown != null) render(shown); });
    try { ({ maps: data, tiles } = await (await fetch("guide/hgss.json")).json()); }
    catch { render(null, "Couldn't load the guide data."); ver = null; }
  }

  // Nothing to update while the panel is off or the window is too narrow to show it.
  const narrow = matchMedia("(max-width: 899px)");
  const idle = () => el().hidden || narrow.matches;

  function started() {
    if (!ver) return;
    render(null, "Waiting for the game…");
    fit();
    timer = setInterval(poll, 1000);
    setInterval(follow, 200);
    setInterval(markTrainers, 250);
    setInterval(wildTick, 1000);
  }

  // The player's map object in DS RAM: active (flag bit 0), id 255 (player) and movement 1 as the
  // game creates it, current tile at +0x64/+0x6C and a fixed-point position (1 tile = 0x10000) at +0x70/+0x78
  // that moves smoothly between tiles. It is found by scanning DS RAM and checked on every read.
  let me = -1, meScan = 0;
  function playerAt(h, o) {
    if (o < 0 || o + 0x7c > h.length) return null;
    const v = new DataView(h.buffer, h.byteOffset + o, 0x7c);
    if (!(v.getUint32(0, true) & 1) || v.getUint32(8, true) !== 255 || v.getUint32(0x14, true) !== 1) return null;
    const cx = v.getUint32(0x64, true), cz = v.getUint32(0x6c, true);
    const x = v.getInt32(0x70, true) / 0x10000, z = v.getInt32(0x78, true) / 0x10000;
    if (cx > 4096 || cz > 4096 || Math.abs(x - cx - 0.5) > 1.5 || Math.abs(z - cz - 0.5) > 1.5) return null;
    return [x, z];
  }
  function player(h) {
    let p = playerAt(h, me);
    if (p || ram == null || meScan++ % 5) return p;
    const u32 = new Uint32Array(h.buffer, h.byteOffset + ram, RAM_SIZE >> 2);
    for (let i = 2; i < u32.length; i++) {
      if (u32[i] === 255 && (p = playerAt(h, ram + (i - 2) * 4))) { me = ram + (i - 2) * 4; return p; }
    }
    me = -1;
    return null;
  }
  function follow() {
    if (idle()) return;
    const h = heap(), dot = document.querySelector(".guide .me"), c = dot && dot.parentElement.querySelector("canvas");
    // A new map id shows within 0.2s instead of waiting for the next poll.
    if (h && cands.length && cands.some((b, i) => mapAt(h, b) !== last[i])) poll();
    if (!h || !dot || !c || !c.geo) return;
    const p = player(h), g = c.geo;
    if (p && lastPos && Math.abs(p[0] - lastPos[0]) + Math.abs(p[1] - lastPos[1]) > 3 && !warpAt) { warpAt = Date.now(); warpFrom = shown; }
    if (p) lastPos = p;
    const inside = p && p[0] >= g.x0 && p[1] >= g.z0 && p[0] < g.x0 + g.w && p[1] < g.z0 + g.h;
    dot.hidden = !inside;
    if (!inside) return;
    const x = c.offsetLeft + c.clientLeft + (p[0] - g.x0) * g.k, y = c.offsetTop + c.clientTop + (p[1] - g.z0) * g.k;
    dot.style.left = x + "px";
    dot.style.top = y + "px";
    updateNav();
  }
  let lastPos = null;

  // The trainer you're battling: the one standing next to you. The field's map objects sit in one array
  // (0x12C bytes each) with the player's; a trainer's script id is 3000 + trainer id - 1 (std_trainer, or
  // 5000 + ... for the second of a pair). Returns undefined when the player object isn't readable
  // (e.g. during the battle itself), so the last opponent stays highlighted.
  const MAP_OBJECT = 0x12C;
  function opponent(h) {
    if (!playerAt(h, me)) return undefined;
    const u32 = (o) => (h[o] | h[o + 1] << 8 | h[o + 2] << 16 | h[o + 3] << 24) >>> 0;
    const px = u32(me + 0x64), pz = u32(me + 0x6c);
    for (let k = -64; k <= 64; k++) {
      const o = me + k * MAP_OBJECT;
      if (!k || o < 0 || o + MAP_OBJECT > h.length || !(h[o] & 1)) continue;
      const s = u32(o + 0x20), tid = s >= 3000 && s < 3740 ? s - 2999 : s >= 5000 && s < 5740 ? s - 4999 : 0;
      if (tid && Math.abs(u32(o + 0x64) - px) + Math.abs(u32(o + 0x6c) - pz) === 1) return tid;
    }
    return null;
  }
  // Mark the trainer list: the one you're battling, and the ones already beaten (their flags in the save data).
  let fighting = null;
  function markTrainers() {
    const h = heap();
    if (!h || idle()) return;
    const t = opponent(h), was = fighting;
    if (t !== undefined) fighting = t;
    for (const li of document.querySelectorAll(".guide .trainers li[data-tid]")) {
      const id = +li.dataset.tid;
      li.classList.toggle("fight", id === fighting);
      if (storyBase != null) li.classList.toggle("beaten", Story.beaten(h, storyBase, id));
      if (id === fighting && was !== fighting) {
        li.scrollIntoView({ block: "nearest", behavior: "smooth" });
        if (li.onclick) li.onclick(); // ring it on the mini map too
      }
    }
  }

  function heap() {
    const m = window.EJS_emulator && window.EJS_emulator.gameManager && window.EJS_emulator.gameManager.Module;
    return m && m.HEAPU8;
  }

  // The newest save slot's general block. Its last 0x14 bytes are a footer: save counters
  // (major, minor) at -0x14 / -0x10 and the magic at -8.
  const GENERAL = 0xF628, MAGIC = 0x20060623;
  function general() {
    let save = null;
    try { save = window.EJS_emulator.gameManager.getSaveFile(false); } catch {}
    if (!save || save.length < 0x80000) return null;
    const u32 = (o) => (save[o] | save[o + 1] << 8 | save[o + 2] << 16 | save[o + 3] << 24) >>> 0;
    let best = null, bestKey = -1;
    for (const slot of SLOTS) {
      const end = slot + GENERAL;
      if (u32(end - 8) !== MAGIC || u32(end - 0x14) === 0xffffffff) continue;
      const key = u32(end - 0x14) * 2 ** 32 + u32(end - 0x10);
      if (key > bestKey) { bestKey = key; best = save.slice(slot, end); }
    }
    return best;
  }
  // Trainer name + ID (20 bytes).
  function signature(gen) {
    const sig = gen.slice(TRAINER, TRAINER + 0x14);
    const id = sig[16] | sig[17] << 8 | sig[18] << 16 | sig[19] << 24;
    return sig[0] !== 0xff && (sig[0] | sig[1]) && id ? sig : null;
  }

  function matches(h, at, bytes) {
    if (at < 0 || at + bytes.length > h.length) return false;
    for (let i = 0; i < bytes.length; i++) if (h[at + i] !== bytes[i]) return false;
    return true;
  }
  // Every 4-byte aligned spot in the heap (or in from..to) where `bytes` occurs, using the word at keyAt as a key.
  function findAll(h, bytes, keyAt, from = 0, to = h.length) {
    const u32 = new Uint32Array(h.buffer, h.byteOffset, h.length >> 2);
    const key = (bytes[keyAt] | bytes[keyAt + 1] << 8 | bytes[keyAt + 2] << 16 | bytes[keyAt + 3] << 24) >>> 0;
    const out = [];
    for (let i = Math.max(0, from >> 2), end = Math.min(u32.length, to >> 2); i < end; i++) {
      if (u32[i] === key && matches(h, i * 4 - keyAt, bytes)) out.push(i * 4 - keyAt);
    }
    return out;
  }
  // Share of the save's non-zero general-block bytes that are the same at heap offset b. The game's
  // live copy is mostly unchanged since the last save; other copies of the trainer card are not.
  function score(h, b, gen) {
    if (b < 0 || b + GENERAL > h.length) return 0;
    let same = 0, n = 0;
    for (let i = 0; i < GENERAL; i += 4) if (gen[i]) { n++; if (h[b + i] === gen[i]) same++; }
    return n ? same / n : 0;
  }

  // The emulator also holds a copy of the save file (the cartridge's memory), which only
  // changes when you save. Use the copy that sits inside DS main RAM, found via the ROM header
  // the console copies to the end of RAM at boot. If that header can't be found, follow every
  // copy and show whichever changed last.
  // Going over the whole heap (~160 MB) takes a good part of a second and stalls the game, so the
  // ROM header copies (DS RAM) are looked for once and kept; later scans only search those 4 MB areas.
  // They are looked for again after 6 scans in a row find nothing.
  let debug = "", ram, rams = [], misses = 0;
  function scan() {
    const h = heap(), gen = general(), sig = gen && signature(gen);
    if (!h || !sig) { debug = gen ? "no trainer in save" : "no save"; return []; }
    if (!rams.length || misses >= 6) { rams = findAll(h, header, 12).map((x) => x - HEADER_IN_RAM); misses = 0; }
    const areas = rams.length ? rams.map((r) => [r + TRAINER, r + RAM_SIZE]) : [[0, h.length]];
    const all = areas.flatMap(([a, b]) => findAll(h, sig, 16, a, b)).map((t) => t - TRAINER).map((b) => [b, score(h, b, gen)]);
    const found = all.filter(([b, sc]) => sc > 0.5 && mapAt(h, b) > 1 && mapAt(h, b) in data).map(([b]) => b);
    const inRam = found.filter((b) => rams.some((r) => b >= r && b < r + RAM_SIZE));
    misses = inRam.length ? 0 : misses + 1;
    // e.g. "3 RAM · 97%:33 r, 12%:0" = match score : map id, r = inside DS RAM
    debug = rams.length + " RAM · " + (all.map(([b, sc]) => Math.round(sc * 100) + "%:" + mapAt(h, b) +
      (rams.some((r) => b >= r && b < r + RAM_SIZE) ? " r" : "")).join(", ") || "no match");
    ram = rams.find((r) => inRam.some((b) => b >= r && b < r + RAM_SIZE));
    return rams.length ? inRam : found;
  }

  function mapAt(h, b) {
    const a = b + MAP;
    if (a < 0 || a + 4 > h.length) return -1;
    return (h[a] | h[a + 1] << 8 | h[a + 2] << 16 | h[a + 3] << 24) >>> 0;
  }

  let cands = [], last = [], pick = 0, mstate = null, pollError = "", warpAt = 0, warpFrom = null;
  function poll() {
    if (idle()) return;
    try { pollOnce(); pollError = ""; } catch (e) { pollError = String(e && e.message || e); cands = []; scans = 0; }
    const d = document.querySelector(".guide .dbg");
    if (d) d.textContent = debugLine();
  }
  // Shown under the location name when you tap it: what the guide is reading, for screenshots.
  function debugLine() {
    const h = heap();
    return (debug || "no scan") + " · pick " + pick + " · now " + (h ? cands.map((b) => mapAt(h, b)).join("/") : "-") +
      (wildDebug ? " · " + wildDebug : "") + (warpAt ? " · warp " + Math.round((Date.now() - warpAt) / 1000) + "s" : "") + (pollError ? " · ERR " + pollError : "");
  }
  function pollOnce() {
    const h = heap();
    if (!h || !data) return;
    if (!cands.length) {
      if (scans++ % 5) return; // full scan every 5s until the save is loaded in game
      cands = scan(); last = cands.map((b) => mapAt(h, b)); pick = 0;
      if (!cands.length) {
        render(null, general() ? "Waiting for the game…" : "Save in-game once to start the guide.");
        return;
      }
    }
    const ids = cands.map((b) => mapAt(h, b));
    ids.forEach((v, i) => { if (v !== last[i]) pick = i; });
    last = ids;
    const id = ids[pick];
    // The player jumped (a door, a cave exit) but no copy's map id changed: the copies we follow have gone
    // stale, so look for the save data again.
    if (warpAt && Date.now() - warpAt > 3000) {
      const stuck = id === warpFrom;
      warpAt = 0;
      if (stuck) { cands = []; scans = 0; return; }
    }
    if (!(id in data) || id <= 1) { cands = []; return; }
    const t = timeOfDay(), st = Story.key(h, cands); // story progress from flags, vars and badges
    if (id !== shown) highlight = null;
    // Story and map flags are read from every match (see Story), not just the one picked for the map id.
    if (id !== shown || t !== tod || st !== story || cands !== storyBase) {
      tod = t; story = st; storyBase = cands; mstate = mapState(data[id]); render(id);
    } else if (mapState(data[id]) !== mstate) { mstate = mapState(data[id]); render(id); } // item taken, trainer beaten
  }

  // HGSS: morning 4-10, day 10-20, night 20-4 (the game uses the console clock).
  function timeOfDay() {
    const h = new Date().getHours();
    return h >= 4 && h < 10 ? "morn" : h >= 10 && h < 20 ? "day" : "nite";
  }

  const node = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const slug = (name) => name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[.'’]/g, "").replace(/\s+/g, "-");

  function monList(rows) {
    const ul = node("ul", "mons");
    for (const [dex, name, lo, hi, pct] of rows) {
      const li = node("li");
      const img = node("img");
      img.src = SPRITE + dex + ".png"; img.alt = ""; img.loading = "lazy";
      img.onerror = () => { img.style.visibility = "hidden"; };
      li.append(img, node("span", "n", name),
        node("span", "lv", "Lv" + (lo === hi ? lo : lo + "-" + hi) + (pct != null ? "  " + pct + "%" : "")));
      ul.append(li);
    }
    return ul;
  }

  /* --- terrain for the mini map, read from the ROM in this browser (never uploaded) --- */
  // NitroFS: FNT at header 0x40, FAT at 0x48. Land data is the NARC at a/0/6/5; each member
  // holds a 32x32 grid of u16 terrain attributes after its header (low byte = behaviour, bit 15 = wall).
  const Terrain = (() => {
    let rom = null, narc = null;
    const cache = new Map();
    const read = async (off, len) => new DataView(await rom.slice(off, off + len).arrayBuffer());
    async function fileOffset(path) {
      const hd = await read(0x40, 0x10);
      const fnt = hd.getUint32(0, true), fntSize = hd.getUint32(4, true), fat = hd.getUint32(8, true);
      const t = new Uint8Array(await rom.slice(fnt, fnt + fntSize).arrayBuffer());
      const dv = new DataView(t.buffer);
      let dir = 0;
      for (const [i, part] of path.split("/").entries()) {
        let p = dv.getUint32(dir * 8, true), id = dv.getUint16(dir * 8 + 4, true), next = -1;
        for (;;) {
          const len = t[p++];
          if (!len) break;
          const name = String.fromCharCode(...t.subarray(p, p + (len & 0x7f)));
          p += len & 0x7f;
          if (len & 0x80) {
            const sub = dv.getUint16(p, true) & 0xfff; p += 2;
            if (name === part && i < path.split("/").length - 1) { next = sub; break; }
          } else if (name === part) { next = id; break; }
          else id++;
        }
        if (next < 0) return null;
        if (i === path.split("/").length - 1) {
          const f = await read(fat + next * 8, 8);
          return [f.getUint32(0, true), f.getUint32(4, true)];
        }
        dir = next;
      }
      return null;
    }
    async function open(blob) {
      rom = blob; narc = null;
      try {
        const f = await fileOffset("a/0/6/5");
        if (!f) return;
        const h = await read(f[0], 0x20);
        if (h.getUint32(0, true) !== 0x4352414e) return; // "NARC"
        const btaf = f[0] + h.getUint16(0x0c, true);
        const b = await read(btaf, 12);
        const size = b.getUint32(4, true), count = b.getUint16(8, true);
        const table = await read(btaf + 12, count * 8);
        const btnf = btaf + size;
        const gmif = btnf + (await read(btnf, 8)).getUint32(4, true);
        narc = { table, count, data: gmif + 8 };
      } catch (e) { console.warn("guide terrain", e); }
    }
    async function block(id) {
      if (!narc || id >= narc.count) return null;
      if (!cache.has(id)) {
        const start = narc.data + narc.table.getUint32(id * 8, true);
        // Header: four section sizes, then (HGSS) a background-sound section: 0x1234, its length, data.
        // The terrain attributes come right after it.
        cache.set(id, read(start, 0x14).then((hd) => {
          const skip = hd.getUint16(0x10, true) === 0x1234 ? hd.getUint16(0x12, true) : 0;
          return read(start + 0x14 + skip, 0x800);
        }).then((v) => new Uint16Array(v.buffer.slice(v.byteOffset, v.byteOffset + 0x800))).catch(() => null));
      }
      return cache.get(id);
    }
    return { open, block, ready: () => !!narc };
  })();

  /* --- mini map: game-style 16x16 tiles drawn from each tile's behaviour --- */
  // Terrain classes come from "tiles" in hgss.json: 0 floor/path, 1 grass, 2 water, 3 ledge, 4 door
  // or warp, 5 sand. A few raw behaviours get their own look: 3 very tall grass, 6 headbutt tree,
  // 8 cave floor, 56-59 ledges by jump direction (E, W, N, S).
  const T = 16;
  const ROOFS = [["#d84830", "#f07050"], ["#3870c8", "#6898e8"], ["#409848", "#68c068"], ["#a050a8", "#c878c8"]];
  const tileArt = (() => {
    let cache = null;
    const make = (draw) => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = T;
      const c = cv.getContext("2d");
      const px = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
      draw(px, c);
      return cv;
    };
    const ground = (px) => { px(0, 0, 16, 16, "#f0e0a8"); px(3, 4, 1, 1, "#d8c088"); px(11, 9, 1, 1, "#d8c088"); px(7, 13, 1, 1, "#d8c088"); };
    const grassBase = (px) => { px(0, 0, 16, 16, "#88d070"); px(2, 3, 1, 1, "#70b858"); px(12, 6, 1, 1, "#70b858"); px(6, 12, 1, 1, "#70b858"); };
    const tuft = (px, x, y, dark, light) => {
      px(x, y + 2, 1, 3, dark); px(x + 2, y, 1, 5, dark); px(x + 4, y + 2, 1, 3, dark);
      px(x + 1, y + 3, 1, 2, light); px(x + 3, y + 1, 1, 4, light); px(x, y + 5, 5, 1, dark);
    };
    const tree = (px) => {
      px(0, 0, 16, 16, "#306830");
      px(2, 1, 12, 11, "#204818"); px(3, 2, 10, 9, "#48a040"); px(4, 3, 4, 3, "#78c860"); px(5, 4, 2, 1, "#a8e090");
      px(9, 7, 3, 2, "#388830"); px(4, 9, 8, 2, "#388830");
      px(6, 12, 4, 3, "#704828"); px(7, 12, 1, 3, "#906038"); px(2, 15, 12, 1, "#204818");
    };
    function build() {
      cache = {
        path: make(ground),
        grass: make((px) => { px(0, 0, 16, 16, "#58b048"); tuft(px, 1, 1, "#287828", "#90d870"); tuft(px, 9, 2, "#287828", "#90d870"); tuft(px, 4, 9, "#287828", "#90d870"); tuft(px, 11, 10, "#287828", "#90d870"); }),
        tall: make((px) => { px(0, 0, 16, 16, "#3c8c38"); tuft(px, 0, 0, "#185818", "#68b050"); tuft(px, 8, 1, "#185818", "#68b050"); tuft(px, 3, 8, "#185818", "#68b050"); tuft(px, 11, 9, "#185818", "#68b050"); }),
        water: [0, 1].map((v) => make((px) => {
          px(0, 0, 16, 16, "#4888e8");
          const y = v ? 3 : 9, x = v ? 2 : 8;
          px(x, y, 6, 1, "#a8d0f8"); px(x + 1, y - 1, 4, 1, "#78b0f0"); px((x + 8) % 16, y + 6 & 15, 4, 1, "#78b0f0");
        })),
        sand: make((px) => { px(0, 0, 16, 16, "#f0d890"); for (const [x, y] of [[2, 2], [9, 4], [5, 9], [13, 11], [1, 13], [10, 14]]) px(x, y, 1, 1, "#c8a860"); }),
        cave: make((px) => { px(0, 0, 16, 16, "#c0a070"); px(3, 3, 2, 1, "#987850"); px(10, 8, 2, 1, "#987850"); px(5, 12, 1, 1, "#987850"); }),
        rock: make((px) => { px(0, 0, 16, 16, "#705838"); px(0, 0, 16, 2, "#886c48"); px(2, 5, 5, 3, "#584428"); px(9, 10, 5, 3, "#584428"); px(3, 4, 3, 1, "#a08458"); }),
        floor: make((px) => { px(0, 0, 16, 16, "#e8c890"); px(0, 7, 16, 1, "#c8a070"); px(0, 15, 16, 1, "#c8a070"); px(5, 0, 1, 7, "#c8a070"); px(12, 8, 1, 7, "#c8a070"); }),
        wall: make((px) => { px(0, 0, 16, 16, "#606878"); px(0, 0, 16, 3, "#808898"); px(0, 13, 16, 3, "#404858"); }),
        tree: make(tree),
        headbutt: make((px) => { tree(px); px(3, 2, 10, 1, "#204818"); px(10, 4, 2, 2, "#f8d048"); }),
        boulder: make((px) => { grassBase(px); px(3, 4, 10, 10, "#606060"); px(4, 3, 8, 1, "#606060"); px(4, 4, 7, 7, "#a0a0a0"); px(5, 5, 3, 2, "#d0d0d0"); }),
        door: make((px) => { ground(px); px(3, 0, 10, 14, "#502818"); px(4, 1, 8, 13, "#885030"); px(10, 7, 1, 2, "#f8d048"); }),
        ledge: ["E", "W", "N", "S"].map((d) => make((px, c) => {
          grassBase(px);
          // the ledge lip sits on the side you jump towards
          c.save(); c.translate(8, 8); c.rotate({ S: 0, W: Math.PI / 2, N: Math.PI, E: -Math.PI / 2 }[d]); c.translate(-8, -8);
          px(0, 10, 16, 3, "#a87838"); px(0, 13, 16, 2, "#704820"); px(0, 9, 16, 1, "#c89850"); c.restore();
        })),
      };
      cache.roof = ROOFS.map(([dark, light]) => make((px) => { px(0, 0, 16, 16, dark); for (let y = 2; y < 16; y += 4) px(0, y, 16, 1, light); }));
      cache.front = make((px) => { px(0, 0, 16, 16, "#f0e8d8"); px(0, 0, 16, 2, "#383838"); px(4, 5, 8, 6, "#5070a8"); px(4, 5, 8, 1, "#383838"); px(7, 5, 1, 6, "#f0e8d8"); px(0, 15, 16, 1, "#a09888"); });
      return cache;
    }
    return () => cache || build();
  })();

  // The whole map's terrain as one grid; -1 where no block was drawn.
  async function terrainGrid(blocks, bx0, bz0, W, H) {
    const grid = new Int32Array(W * H).fill(-1), dim = new Uint8Array(W * H);
    let any = false;
    for (const [bx, bz, land, isNear] of blocks) {
      const t = await Terrain.block(land);
      if (!t) continue;
      any = true;
      const ox = (bx - bx0) * 32, oz = (bz - bz0) * 32;
      for (let i = 0; i < 1024; i++) {
        const at = (oz + (i >> 5)) * W + ox + (i & 31);
        grid[at] = t[i]; dim[at] = isNear ? 1 : 0;
      }
    }
    return any ? { grid, dim } : null;
  }

  // Each map's terrain laid out once: one grid over all its blocks, with ox/oz = the global tile
  // coordinates of its top-left corner. Indoors, a room only fills part of its 32x32 block and the
  // rest is plain floor in the data, so the grid is cut down to the room (see cropRoom()).
  const layouts = new Map();
  const layout = (m) => { if (!layouts.has(m)) layouts.set(m, buildLayout(m)); return layouts.get(m); };
  async function buildLayout(m) {
    const blocks = (m.blocks || []).map((b) => [...b, false]).concat((m.near || []).map((b) => [...b, true]));
    if (!blocks.length) return null;
    const bx0 = Math.min(...blocks.map((b) => b[0])), bz0 = Math.min(...blocks.map((b) => b[1]));
    const W = (Math.max(...blocks.map((b) => b[0])) - bx0 + 1) * 32, H = (Math.max(...blocks.map((b) => b[1])) - bz0 + 1) * 32;
    const tg = await terrainGrid(blocks, bx0, bz0, W, H);
    if (!tg) return null;
    let caveTiles = 0, green = 0;
    for (const v of tg.grid) if (v >= 0) { if ((v & 0xff) === 8) caveTiles++; else if (!(v & 0x8000) && (tiles[v & 0xff] === 1 || tiles[v & 0xff] === 2)) green++; }
    // Outdoors: edge exits, or (for parks and forests with only doors out, like Ilex Forest or the
    // Pokéathlon Dome) four or more blocks or real grass/water. Rooms are one or two blocks of floor.
    const env = m.exits && m.exits.length ? "out" : caveTiles > tg.grid.length / 10 ? "cave"
      : blocks.length >= 4 || green > tg.grid.length / 50 ? "out" : "in";
    const L = { ...tg, W, H, ox: bx0 * 32, oz: bz0 * 32, env };
    return env === "in" ? cropRoom(m, L) : L;
  }
  // The room is the floor you can walk to from its doors, items and people, plus the walls around it.
  // Everything else is left out (-1) and the grid is cropped to what's left.
  function cropRoom(m, L) {
    const { grid, W, H } = L, seen = new Uint8Array(W * H), stack = [];
    const floor = (i) => grid[i] >= 0 && !(grid[i] & 0x8000);
    for (const [x, z] of [...(m.warps || []), ...(m.items || []), ...(m.trainers || []), ...(m.staff || [])]) {
      const lx = x - L.ox, lz = z - L.oz, i = lz * W + lx;
      if (lx >= 0 && lz >= 0 && lx < W && lz < H && floor(i) && !seen[i]) { seen[i] = 1; stack.push(i); }
    }
    if (!stack.length) return L;
    while (stack.length) {
      const i = stack.pop(), x = i % W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (j >= 0 && j < W * H && !seen[j] && floor(j)) { seen[j] = 1; stack.push(j); }
      }
    }
    let x0 = W, z0 = H, x1 = -1, z1 = -1;
    for (let i = 0; i < W * H; i++) {
      if (!seen[i]) continue;
      const x = i % W, z = (i / W) | 0;
      x0 = Math.min(x0, x - 1); x1 = Math.max(x1, x + 1); z0 = Math.min(z0, z - 1); z1 = Math.max(z1, z + 1);
    }
    x0 = Math.max(0, x0); z0 = Math.max(0, z0); x1 = Math.min(W - 1, x1); z1 = Math.min(H - 1, z1);
    // Left out: floor joined to the edge of the box without passing a wall (the unused rest of the block).
    // Floor shut in by walls (behind a counter) stays, so it doesn't show as holes in the room.
    const keep = new Uint8Array(W * H).fill(1), out = [];
    const inBox = (x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const i = z * W + x;
      if ((x === x0 || x === x1 || z === z0 || z === z1) && !seen[i] && floor(i)) { keep[i] = 0; out.push(i); }
    }
    while (out.length) {
      const i = out.pop(), x = i % W, z = (i / W) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = (z + dz) * W + x + dx;
        if (inBox(x + dx, z + dz) && keep[j] && !seen[j] && floor(j)) { keep[j] = 0; out.push(j); }
      }
    }
    // Walls with no room floor next to them (outside the room's own walls) go too.
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const i = z * W + x;
      if (!keep[i] || floor(i)) continue;
      let near = false;
      for (let dz = -1; dz <= 1 && !near; dz++) for (let dx = -1; dx <= 1; dx++) {
        const j = (z + dz) * W + x + dx;
        if (inBox(x + dx, z + dz) && keep[j] && floor(j)) { near = true; break; }
      }
      if (!near) keep[i] = 0;
    }
    const w = x1 - x0 + 1, h = z1 - z0 + 1, g = new Int32Array(w * h), dim = new Uint8Array(w * h);
    for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
      const i = (z + z0) * W + x + x0;
      g[z * w + x] = keep[i] ? grid[i] : -1;
      dim[z * w + x] = L.dim[i];
    }
    return { ...L, grid: g, dim, W: w, H: h, ox: L.ox + x0, oz: L.oz + z0 };
  }

  // Draw the terrain once per map; markers go on top of this cached copy. The tile art is 16px (T),
  // drawn at ts px per tile: about the size the map is shown at, so big maps don't hold big canvases.
  function paintTerrain(m, L, ts) {
    const { grid, dim, W, H, env } = L, art = tileArt();
    const at = (x, z) => x < 0 || z < 0 || x >= W || z >= H ? -1 : grid[z * W + x];
    const wall = (x, z) => { const v = at(x, z); return v >= 0 && (v & 0x8000) !== 0; };
    const cls = (v) => tiles[v & 0xff] || 0;

    // Outdoors, the block of walls right above a door or warp is a building (rows above its bottom
    // row are roof); a lone blocked tile is a sign or boulder; other walls are trees.
    const house = new Int8Array(W * H); // 0 none, 1.. roof colour + 1 for the front row, -1 boulder
    if (env === "out") {
      const doors = (m.warps || []).map(([x, z]) => [x - L.ox, z - L.oz]);
      for (let i = 0; i < grid.length; i++) if (grid[i] >= 0 && !(grid[i] & 0x8000) && cls(grid[i]) === 4) doors.push([i % W, (i / W) | 0]);
      doors.forEach(([dx, dz], n) => {
        if (!wall(dx, dz - 1) || house[(dz - 1) * W + dx]) return;
        // The widest-by-tallest wall rectangle sitting on the door, at most 6 tall and 13 wide.
        let top = dz - 1, l = dx, r = dx, best = 0;
        for (let t = dz - 1; t >= dz - 6 && wall(dx, t); t--) {
          const col = (x) => { for (let z = t; z < dz; z++) if (!wall(x, z)) return false; return true; };
          let a = dx, b = dx;
          while (a > dx - 6 && col(a - 1)) a--;
          while (b < dx + 6 && col(b + 1)) b++;
          const area = (b - a + 1) * (dz - t) * (b > a ? 1 : 0.5); // prefer a real building over a 1-wide post
          if (area > best) { best = area; top = t; l = a; r = b; }
        }
        for (let z = top; z < dz; z++) for (let x = l; x <= r; x++) house[z * W + x] = z === dz - 1 && top < dz - 1 ? 1 : 2 + (n % ROOFS.length);
      });
      for (let i = 0; i < grid.length; i++) {
        const x = i % W, z = (i / W) | 0;
        if (!house[i] && wall(x, z) && !wall(x - 1, z) && !wall(x + 1, z) && !wall(x, z - 1) && !wall(x, z + 1)) house[i] = -1;
      }
    }

    const cv = document.createElement("canvas");
    cv.width = W * ts; cv.height = H * ts;
    const c = cv.getContext("2d");
    c.scale(ts / T, ts / T);
    c.fillStyle = "#181820"; c.fillRect(0, 0, W * T, H * T);
    if (env === "in") paintRoom(c, m, L);
    else for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const v = grid[z * W + x];
      if (v < 0) continue;
      const b = v & 0xff, k = cls(v);
      let img;
      if (v & 0x8000) {
        if (env === "in") img = art.wall;
        else if (env === "cave") img = art.rock;
        else {
          const h = house[z * W + x];
          img = h === 1 ? art.front : h > 1 ? art.roof[h - 2] : h < 0 ? art.boulder : b === 6 ? art.headbutt : art.tree;
        }
      } else if (k === 2) img = art.water[(x + z) & 1];
      else if (k === 1) img = b === 3 ? art.tall : art.grass;
      else if (k === 3) img = art.ledge[b >= 56 && b <= 59 ? b - 56 : 3];
      else if (k === 4) img = art.door;
      else if (k === 5) img = art.sand;
      else img = env === "in" ? art.floor : env === "cave" || b === 8 ? art.cave : art.path;
      c.drawImage(img, x * T, z * T);
    }
    relief(c, L, house);
    c.fillStyle = "rgba(24,24,32,.45)";
    for (let i = 0; i < dim.length; i++) if (dim[i] && grid[i] >= 0) c.fillRect((i % W) * T, ((i / W) | 0) * T, T, T);
    cv.grid = grid;
    return cv;
  }

  // The "looks 3D" pass for every map, painted once with its terrain so it costs nothing per frame.
  // Light comes from the top left: walls get a lit top edge and a dark right side, raised things
  // (cave cliffs, tree tops, roofs) show a front face, and cast a soft shadow down and to the right
  // onto the ground. Water sits below its banks, so it is shaded under its top and left edges.
  function relief(c, L, house) {
    const { grid, W, H, env } = L;
    const R = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
    const at = (x, z) => x < 0 || z < 0 || x >= W || z >= H ? -1 : grid[z * W + x];
    const wall = (x, z) => { const v = at(x, z); return v >= 0 && (v & 0x8000) !== 0; };
    const open = (x, z) => { const v = at(x, z); return v >= 0 && !(v & 0x8000); };
    const water = (x, z) => open(x, z) && tiles[at(x, z) & 0xff] === 2;
    const hs = (x, z) => x < 0 || z < 0 || x >= W || z >= H ? 0 : house[z * W + x];
    const shade = env === "out" ? "rgba(16,40,16," : env === "cave" ? "rgba(30,18,6," : "rgba(40,30,20,";
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const X = x * T, Z = z * T;
      if (wall(x, z)) {
        const h = hs(x, z), lone = !wall(x - 1, z) && !wall(x + 1, z) && !wall(x, z - 1) && !wall(x, z + 1);
        if (env === "out" && h === 0) {
          // A tree on the edge of a wood pokes its crown up into the tile above it.
          if (open(x, z - 1)) {
            const disc = (y, r, col) => { c.fillStyle = col; c.beginPath(); c.ellipse(X + 8, Z + y, r, r - 1, 0, Math.PI, 0); c.fill(); };
            disc(5, 7, "#204818"); disc(5, 6, "#48a040"); disc(3, 3, "#78c860"); R(X + 6, Z, 2, 1, "#a8e090");
          }
          if (!wall(x + 1, z)) R(X + T - 3, Z + 1, 3, T - 2, "rgba(0,0,0,.25)");
          continue;
        }
        if (h > 1) { // roof: lit ridge, shaded eaves over the front wall, dark gable end on the right
          if (hs(x, z - 1) < 2) R(X, Z, T, 3, "rgba(255,255,255,.28)");
          if (hs(x, z + 1) === 1) R(X, Z + T - 3, T, 3, "rgba(0,0,0,.3)");
          if (hs(x + 1, z) < 2) R(X + T - 3, Z, 3, T, "rgba(0,0,0,.22)");
          if (hs(x - 1, z) < 2) R(X, Z, 2, T, "rgba(255,255,255,.18)");
          continue;
        }
        if (h === 1) { if (hs(x + 1, z) !== 1) R(X + T - 3, Z, 3, T, "rgba(0,0,0,.18)"); continue; }
        if (lone) continue; // boulders and indoor plants are already drawn round
        if (env === "cave") {
          if (open(x, z + 1)) { // the cliff face you see from the cave floor: the whole tile, lit along its top
            R(X, Z, T, T, "#4c3a22"); R(X, Z, T, 2, "#b09468"); R(X, Z + 2, T, 1, "#2e2010");
            R(X + 3, Z + 4, 1, 9, "#382814"); R(X + 9, Z + 6, 1, 8, "#382814"); R(X + 13, Z + 3, 1, 6, "#382814");
            R(X + 4, Z + 4, 1, 9, "#60482c"); R(X + 10, Z + 6, 1, 8, "#60482c");
            R(X, Z + T - 2, T, 2, "#241808");
          } else if (open(x, z - 1)) R(X, Z, T, 3, "rgba(255,240,200,.35)");
          else R(X, Z, T, T, "rgba(255,230,180,.08)"); // plateau tops sit higher than the floor
        } else if (open(x, z - 1)) R(X, Z, T, 2, "rgba(255,255,255,.3)");
        if (open(x - 1, z)) R(X, Z, 2, T, "rgba(255,255,255,.2)");
        if (open(x + 1, z)) R(X + T - 2, Z, 2, T, "rgba(0,0,0,.18)");
        continue;
      }
      if (!open(x, z)) continue;
      // Shadows cast by whatever stands north, west or north-west of this tile (rooms already shade
      // under their north walls in paintRoom()).
      const n = wall(x, z - 1), w = wall(x - 1, z), nw = wall(x - 1, z - 1);
      const deep = hs(x - 1, z) > 0 || hs(x, z - 1) > 0; // buildings are taller than trees and rocks
      if (n && env !== "in") { R(X, Z, T, deep ? 9 : 7, shade + ".24)"); R(X, Z, T, 3, shade + ".18)"); }
      if (w) { R(X, Z, deep ? 7 : 5, T, shade + ".22)"); R(X, Z, 2, T, shade + ".12)"); }
      else if (nw) R(X, Z, deep ? 7 : 5, n ? 3 : 7, shade + ".18)");
      if (water(x, z)) {
        if (!water(x, z - 1)) { R(X, Z, T, 4, "rgba(16,40,110,.3)"); R(X, Z, T, 1, "rgba(16,40,110,.3)"); }
        if (!water(x - 1, z)) R(X, Z, 3, T, "rgba(16,40,110,.22)");
        if (!water(x, z + 1)) R(X, Z + T - 2, T, 2, "rgba(255,255,255,.45)");
      }
    }
  }

  /* --- rooms: original art in a "looks 3D" style (light tops, dark front faces, soft shadows) --- */
  // The data only says wall or floor plus each tile's behaviour, so the furniture is worked out:
  // walls joined to the room's outline are its walls; other wall groups are furniture (a lone tile
  // is a plant); groups next to someone working a counter (hgss.json "staff") are counters, and the
  // wall behind the nurse is the healing machine. PCs, TVs, shelves, stairs and mats come from
  // their tile behaviours (decomp metatile_behavior.h). Painted once per room like the other maps.
  const ROOM = {
    center: { floor: ["#f4ead2", "#ecdfc0"], cap: "#b83c30", rim: "#c8b4a4", face: "#f0e6d8", stripe: "#d04838", top: "#c89060", front: "#8a5a30", desk: ["#f8f0e0", "#d05040"] },
    mart: { floor: ["#e8eef8", "#d8e2f0"], cap: "#3860a8", rim: "#a8b4c8", face: "#eef2f8", stripe: "#4878c8", top: "#c89060", front: "#8a5a30", desk: ["#f8f8f0", "#4878c8"] },
    home: { floor: ["#e8c890", "#dcb87c"], cap: "#806048", rim: "#a08468", face: "#f0e2c8", stripe: "#c8a070", top: "#b07848", front: "#704828", desk: ["#e8d0a8", "#906038"] },
  };
  const STAIRS = new Set([60, 61, 62, 94, 95, 106, 107]), MATS = new Set([98, 99, 100, 101]);
  const SHELVES = new Set([224, 225, 226, 234]), MART_SHELVES = new Set([229, 235, 236]);
  function paintRoom(c, m, L) {
    const { grid, W, H } = L, place = m.place || "";
    const th = /Pok.mon Center/.test(place) ? ROOM.center : /Mart|Department Store|Shop/.test(place) ? ROOM.mart : ROOM.home;
    const R = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
    const at = (x, z) => x < 0 || z < 0 || x >= W || z >= H ? -1 : grid[z * W + x];
    const isWall = (x, z) => { const v = at(x, z); return v >= 0 && (v & 0x8000) !== 0; };
    // Wall groups: 1 = the room's own walls (next to the outside, or below such a wall: the back wall
    // is two tiles deep), 2+ = a piece of furniture (so a plant against a wall stays a plant).
    const group = new Int32Array(W * H), size = [0, 0];
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      if (!isWall(x, z)) continue;
      let out = group[(z - 1) * W + x] === 1 && z > 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (at(x + dx, z + dz) < 0) out = true;
      if (out) group[z * W + x] = 1;
    }
    let next = 2;
    for (let i = 0; i < W * H; i++) {
      if (!isWall(i % W, (i / W) | 0) || group[i]) continue;
      const tiles = [i], id = next++;
      group[i] = id;
      for (let n = 0; n < tiles.length; n++) {
        const x = tiles[n] % W, z = (tiles[n] / W) | 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const j = (z + dz) * W + x + dx;
          if (isWall(x + dx, z + dz) && !group[j]) { group[j] = id; tiles.push(j); }
        }
      }
      size[id] = tiles.length;
    }
    // Counters: furniture next to a member of staff. The nurse's healing machine is the wall behind her.
    const counter = new Set(), machines = [];
    for (const [sx, sz, kind] of m.staff || []) {
      const x = sx - L.ox, z = sz - L.oz;
      for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) { const gid = group[(z + dz) * W + x + dx]; if (isWall(x + dx, z + dz) && gid > 1) counter.add(gid); }
      if (kind === 0 && isWall(x, z - 1) && isWall(x, z + 1)) machines.push([x, z - 1]);
    }
    const kindOf = (x, z) => { const gid = group[z * W + x]; return gid === 1 ? "wall" : counter.has(gid) || (at(x, z) & 0xff) === 128 ? "desk" : size[gid] === 1 ? "plant" : "furniture"; };

    // Floor, with a soft shadow under anything standing north of it.
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const v = at(x, z);
      if (v < 0) continue;
      const X = x * T, Z = z * T, b = v & 0xff;
      R(X, Z, T, T, th.floor[(x + z) & 1]);
      R(X, Z, T, 1, "rgba(0,0,0,.05)"); R(X, Z, 1, T, "rgba(0,0,0,.05)");
      if (v & 0x8000) continue;
      if (MATS.has(b) || tiles[b] === 4) { R(X + 1, Z + 3, 14, 11, "#c84838"); R(X + 3, Z + 5, 10, 7, "#e86858"); }
      if (STAIRS.has(b)) { R(X, Z, T, T, "#b8a888"); for (let i = 0; i < 4; i++) R(X + 1, Z + 1 + i * 4, 14, 2, i % 2 ? "#a09070" : "#d8c8a8"); }
      if (b === 103) { R(X + 2, Z + 2, 12, 12, "#60b0e8"); R(X + 5, Z + 5, 6, 6, "#c0e8f8"); } // warp panel
      if (isWall(x, z - 1)) { R(X, Z, T, 4, "rgba(40,30,20,.16)"); R(X, Z, T, 2, "rgba(40,30,20,.12)"); }
    }
    // The Poké Ball on the floor in front of a Pokémon Center's nurse.
    for (const [sx, sz, kind] of th === ROOM.center ? m.staff || [] : []) {
      const X = (sx - L.ox) * T + 8, Z = (sz - L.oz + 3) * T + 8, r = 20;
      if (kind || at(sx - L.ox, sz - L.oz + 3) < 0) continue;
      c.fillStyle = "rgba(255,255,255,.35)"; c.beginPath(); c.arc(X, Z, r + 2, 0, 7); c.fill();
      c.fillStyle = "#e86870"; c.beginPath(); c.arc(X, Z, r, Math.PI, 0); c.fill();
      c.fillStyle = "#f4f0f0"; c.beginPath(); c.arc(X, Z, r, 0, Math.PI); c.fill();
      R(X - r, Z - 2, 2 * r, 4, "#704850");
      c.fillStyle = "#704850"; c.beginPath(); c.arc(X, Z, 6, 0, 7); c.fill();
      c.fillStyle = "#f4f0f0"; c.beginPath(); c.arc(X, Z, 4, 0, 7); c.fill();
    }
    // Walls and furniture.
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      if (!isWall(x, z)) continue;
      const X = x * T, Z = z * T, b = at(x, z) & 0xff, kind = kindOf(x, z);
      const front = at(x, z + 1) >= 0 && !isWall(x, z + 1); // the face you'd see from the room
      const sameAbove = isWall(x, z - 1) && group[(z - 1) * W + x] === group[z * W + x];
      if (kind === "wall") {
        if (front) { R(X, Z, T, T, th.face); R(X, Z, T, 3, th.cap); R(X, Z + 5, T, 2, th.stripe); R(X, Z + T - 2, T, 2, "rgba(0,0,0,.12)"); }
        else { R(X, Z, T, T, th.rim); R(X, Z, T, 1, "rgba(255,255,255,.3)"); R(X, Z + T - 2, T, 2, "rgba(0,0,0,.15)"); }
      } else if (kind === "plant") {
        R(X + 5, Z + 10, 6, 5, "#a86838"); R(X + 5, Z + 14, 6, 1, "#704828");
        c.fillStyle = "#3c9040"; c.beginPath(); c.arc(X + 8, Z + 7, 6, 0, 7); c.fill();
        c.fillStyle = "#68c060"; c.beginPath(); c.arc(X + 6, Z + 5, 3, 0, 7); c.fill();
      } else {
        const [top, face] = kind === "desk" ? th.desk : [th.top, th.front];
        R(X, Z, T, T - (front ? 5 : 0), top);
        if (!sameAbove) R(X, Z, T, 1, "rgba(255,255,255,.4)");
        if (front) { R(X, Z + T - 5, T, 5, face); if (kind === "desk") R(X, Z + T - 6, T, 1, "#f8d048"); }
      }
      // Objects from tile behaviours, drawn on whatever is there.
      if (b === 131) { R(X + 2, Z + 2, 12, 9, "#606878"); R(X + 3, Z + 3, 10, 6, "#68c0e8"); R(X + 6, Z + 11, 4, 2, "#606878"); } // PC
      else if (b === 134) { R(X + 2, Z + 3, 12, 9, "#303038"); R(X + 3, Z + 4, 10, 6, "#78a8d8"); } // TV
      else if (b === 133) { R(X + 2, Z + 2, 12, 9, "#f8f0d8"); R(X + 3, Z + 3, 10, 7, "#78b868"); R(X + 6, Z + 5, 4, 2, "#5888d0"); } // town map
      else if (SHELVES.has(b)) { R(X + 1, Z + 1, 14, 13, "#8a5a30"); for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) R(X + 2 + j * 3, Z + 2 + i * 4, 2, 3, ["#d05040", "#4878c8", "#58a048", "#e0b030"][(i + j + x) % 4]); }
      else if (MART_SHELVES.has(b)) { R(X + 1, Z + 1, 14, 13, "#d8dce8"); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R(X + 2 + j * 4, Z + 2 + i * 4, 3, 3, ["#e05848", "#f0c040", "#58a8e0"][(i + j) % 3]); }
      else if (b === 228) { R(X + 4, Z + 4, 8, 10, "#7880a0"); R(X + 3, Z + 3, 10, 2, "#a0a8c0"); } // bin
    }
    // The healing machine: six Poké Balls in a white case.
    for (const [x, z] of machines) {
      const X = x * T, Z = z * T;
      R(X - 3, Z + 1, T + 6, 12, "#d8dce8"); R(X - 3, Z + 13, T + 6, 2, "#9098b0");
      for (let i = 0; i < 6; i++) { R(X - 1 + (i % 3) * 7, Z + 3 + (i / 3 | 0) * 5, 4, 4, "#e04848"); R(X - 1 + (i % 3) * 7, Z + 5 + (i / 3 | 0) * 5, 4, 2, "#f8f8f8"); }
    }
    // The people at the counters: a little figure each (nurse, clerk, receptionist).
    for (const [sx, sz, kind] of m.staff || []) {
      const X = (sx - L.ox) * T, Z = (sz - L.oz) * T;
      if (at(sx - L.ox, sz - L.oz) < 0) continue;
      const [hair, body] = [["#f088a8", "#f8f8f8"], ["#604028", "#4878c8"], ["#f088a8", "#e86878"]][kind] || ["#604028", "#888"];
      c.fillStyle = "rgba(40,30,20,.25)"; c.beginPath(); c.ellipse(X + 8, Z + 14, 5, 2, 0, 0, 7); c.fill();
      R(X + 4, Z + 7, 8, 7, body);
      c.fillStyle = "#f8d0b0"; c.beginPath(); c.arc(X + 8, Z + 5, 3.5, 0, 7); c.fill();
      R(X + 4, Z + 1, 8, 3, hair);
    }
  }

  // Name of the map an exit leads to, as short as it can be: "Route 31", or just "Mart" for a
  // building in the same town.
  function exitName(m, to) {
    const t = data[to];
    if (!t) return null;
    return t.name === m.name ? t.place || t.name : t.place && !t.blocks ? t.place : t.name;
  }

  // A door tag's name, short: "1F Northwest Rooms" -> "NW Rooms" (a floor alone, like "B1F", stays).
  const COMPASS = { Northwest: "NW", Northeast: "NE", Southwest: "SW", Southeast: "SE" };
  const shortName = (name) => name.replace(/^B?\d+F (?=\S)/, "").replace(/\b(Northwest|Northeast|Southwest|Southeast)\b(?= \S)/g, (w) => COMPASS[w]);

  // Exits as labels on the map: one at each edge that leads to a neighbouring map (placed at the
  // widest walkable gap on that edge), and one over each door.
  const DIR = { N: [0, -1, "▲"], S: [0, 1, "▼"], W: [-1, 0, "◀"], E: [1, 0, "▶"] };
  function placeExits(m, canvas, L) {
    const box = canvas.parentElement;
    if (!box) return;
    for (const el of box.querySelectorAll(".exit")) el.remove();
    const g = canvas.geo, W = g.w, H = g.h, grid = L.grid;
    const ox = canvas.offsetLeft + canvas.clientLeft, oy = canvas.offsetTop + canvas.clientTop;
    const open = (x, z) => x >= 0 && z >= 0 && x < W && z < H && grid[z * W + x] >= 0 && !(grid[z * W + x] & 0x8000);
    const own = new Set((m.blocks || []).map(([bx, bz]) => bx + "," + bz));
    const label = (cls, text, x, z, title) => {
      const el = node("div", "exit " + cls, text);
      if (title) el.title = title;
      el.x = ox + x * g.k; el.y = oy + z * g.k;
      el.style.left = el.x + "px";
      el.style.top = el.y + "px";
      box.append(el);
      return el;
    };
    for (const [d, to] of m.exits || []) {
      const name = exitName(m, to), t = data[to], [dx, dz, arrow] = DIR[d] || [];
      if (!name || !t || !t.blocks || dx == null) continue;
      const theirs = new Set(t.blocks.map(([bx, bz]) => bx + "," + bz));
      // Our blocks with one of theirs on that side, and the longest open run along the shared edge.
      let best = null, edge = null;
      for (const [bx, bz] of m.blocks) {
        if (!theirs.has(bx + dx + "," + (bz + dz)) || !own.has(bx + "," + bz)) continue;
        const lx = bx * 32 - L.ox, lz = bz * 32 - L.oz;
        const along = (i) => dz ? [lx + i, dz < 0 ? lz : lz + 31] : [dx < 0 ? lx : lx + 31, lz + i];
        edge = edge || along(16);
        for (let i = 0, run = 0; i <= 32; i++) {
          if (i < 32 && open(...along(i))) { run++; continue; }
          if (run && (!best || run > best[0])) best = [run, along(i - run / 2)];
          run = 0;
        }
      }
      const at = best ? best[1] : edge;
      if (!at) continue;
      // Keep the label just inside the map on that side.
      const x = dx ? (dx < 0 ? 0 : W) : at[0], z = dz ? (dz < 0 ? 0 : H) : at[1];
      const tag = label("edge " + d, d === "E" ? name + " " + arrow : arrow + " " + name, x, z);
      tag.side = d; tag.to = to;
    }
    // One tag per place the doors lead to (Kenny, 2026-10-29: the S.S. Aqua's cabin doors each had
    // their own "1F Northwest Rooms" tag and covered the map), over the door nearest the middle of
    // that place's doors, with a shortened name. The full name is the tag's tooltip.
    const doors = new Map();
    for (const [x, z, to] of m.warps || []) {
      if (!doors.has(to)) doors.set(to, []);
      doors.get(to).push([x - L.ox, z - L.oz]);
    }
    for (const [to, list] of doors) {
      const name = exitName(m, to);
      if (!name) continue;
      const cx = list.reduce((a, d) => a + d[0], 0) / list.length, cz = list.reduce((a, d) => a + d[1], 0) / list.length;
      const [x, z] = list.reduce((a, d) => Math.hypot(d[0] - cx, d[1] - cz) < Math.hypot(a[0] - cx, a[1] - cz) ? d : a);
      const tag = label("door", shortName(name), x + 0.5, z, name);
      tag.k = g.k; tag.to = to;
    }
    // Tag sizes, measured once (one layout) so scrolling never has to read the page again.
    const tags = [...box.querySelectorAll(".exit")];
    for (const t of tags) { t.w = t.offsetWidth; t.h = t.offsetHeight; }
    clampExits(box);
    if (!box.clamps) { box.clamps = true; box.addEventListener("scroll", () => clampExits(box), { passive: true }); }
  }
  // Edge arrows stay in view while the map scrolls, pinned to the side they point to. Tag boxes are
  // worked out from their position, measured size and CSS offsets (in the map box's coordinates)
  // instead of read back from the page, so this only writes styles.
  const OFFSET = { N: [-0.5, 0, 0, 2], S: [-0.5, -1, 0, -2], W: [0, -0.5, 2, 0], E: [-1, -0.5, -2, 0] };
  const rect = (x, y, w, h, [fx, fy, dx, dy]) => {
    const left = x + fx * w + dx, top = y + fy * h + dy;
    return { left, top, right: left + w, bottom: top + h };
  };
  function clampExits(box) {
    const L = box.scrollLeft, T0 = box.scrollTop, R = L + box.clientWidth, B = T0 + box.clientHeight;
    const taken = [];
    for (const el of box.querySelectorAll(".exit.edge")) {
      const w = el.w / 2 + 4, h = el.h / 2 + 4;
      let x = el.x, y = el.y;
      if (el.side === "N" || el.side === "S") x = Math.max(L + w, Math.min(R - w, x));
      else y = Math.max(T0 + h, Math.min(B - h, y));
      if (el.side === "N") y = Math.max(y, T0); if (el.side === "S") y = Math.min(y, B);
      if (el.side === "W") x = Math.max(x, L); if (el.side === "E") x = Math.min(x, R);
      el.style.left = x + "px"; el.style.top = y + "px";
      taken.push(rect(x, y, el.w, el.h, OFFSET[el.side]));
    }
    // Door tags go above their door, or under it if that spot is taken. One that would still cover an
    // edge arrow or another tag is left out (its door keeps its outline), so tags never pile up.
    const hits = (r) => taken.some((q) => r.left < q.right + 2 && q.left < r.right + 2 && r.top < q.bottom + 2 && q.top < r.bottom + 2);
    for (const el of box.querySelectorAll(".exit.door")) {
      let below = false, r = rect(el.x, el.y, el.w, el.h, [-0.5, -1, 0, -1]);
      if (hits(r)) { below = true; r = rect(el.x, el.y + el.k, el.w, el.h, [-0.5, 0, 0, 1]); }
      const hide = hits(r);
      if (el.hidden !== hide) el.hidden = hide;
      if (el.below !== below) { el.below = below; el.classList.toggle("below", below); el.style.top = el.y + (below ? el.k : 0) + "px"; }
      if (!hide) taken.push(r);
    }
  }

  /* --- the way to a NEXT bullet's place: click a bullet, get the route and a path on the map --- */
  // Fly points (FLAG_SYS_FLYPOINT_*) and the town map each one lands in.
  const FLY = { 0x9B0: 49, 0x9B1: 50, 0x9B2: 51, 0x9B3: 52, 0x9B4: 53, 0x9B5: 54, 0x9B6: 55, 0x9B7: 56, 0x9B8: 57,
    0x9B9: 58, 0x9BA: 59, 0x9BB: 60, 0x9BC: 67, 0x9BD: 73, 0x9BE: 74, 0x9BF: 75, 0x9C0: 76, 0x9C1: 77, 0x9C2: 78,
    0x9C3: 87, 0x9C4: 88, 0x9C5: 89, 0x9C6: 90 };
  // Neighbouring maps you can't walk between: Route 44 and Blackthorn (the Ice Path is the way), and up the
  // Route 45 ledges from Route 46.
  const BLOCKED = new Set(["46>89", "89>46", "48>47"]);
  const CAN_FLY = "f:0xBB&b:4", SHIP = 307, SS_TICKET = "f:0xF2"; // HM02 + Storm Badge; the S.S. Aqua needs the ticket
  // hgss.json names come from the decomp's constants; a few read better fixed up.
  const NAMES = { "Dragons Den": "Dragon's Den", "Team Rocket Hq": "Rocket Hideout", "Mt Silver": "Mt. Silver",
    "Mt Silver Cave": "Mt. Silver Cave", "Mt Mortar": "Mt. Mortar", "Mt Moon": "Mt. Moon", "Digletts Cave": "Diglett's Cave",
    "Victory Road Jk": "Victory Road", "Pokeathlon Dome": "Pokéathlon Dome" };
  const PLACES = { 299: "Pokémon League Gate", 330: "Olivine Port", 387: "Vermilion Port", 240: "Olivine Port",
    386: "Vermilion Port", 489: "Power Plant", 467: "Power Plant", 106: "Diglett's Cave" };
  const areaName = (id) => data[id] ? NAMES[data[id].name] || data[id].name : "?";
  function placeName(id) {
    const m = data[id];
    if (!m) return "?";
    if (PLACES[id]) return PLACES[id];
    const name = areaName(id), town = /(.*) (City|Town|Island)$/.exec(name);
    const p = (m.place || "").replace(/^(Goldenrod|Olivine|Mount Silver Cave|Mount Silver|Headquarters) ?/, "");
    if (!p) return name;
    if (town) return town[1] + " " + p;
    if (/^(Pokémon Center|Poké Mart)/.test(p)) return name + " " + p.replace(/ 1F$/, "");
    return /^(B?\d+F|Entrance|Roof|Shrine|Summit|Interior)\b/.test(p) ? name + " " + p : p;
  }

  let nav = null; // { key, to, x, z } while a bullet is picked
  let navStep = -1;
  function pickNav(key, at, li) {
    nav = key ? { key, to: at[0], x: at[1], z: at[2] } : null;
    for (const x of document.querySelectorAll(".guide .todo li.go")) x.classList.toggle("nav", !!nav && x === li);
    updateNav(true);
  }

  // Fewest steps from map to map: edge exits and doors cost 1, flying 3 (so a short walk beats it).
  // Returns [{ to, how: "exit" | "warp" | "fly" }...], [] when already there, or null.
  function route(from, to) {
    const h = heap(), ok = (c) => !!(h && storyBase != null && Story.test(h, storyBase, c));
    const towns = ok(CAN_FLY) ? Object.keys(FLY).filter((f) => Story.flag(h, storyBase, +f)).map((f) => FLY[f]) : [];
    const ship = ok(SS_TICKET), cost = new Map([[from, 0]]), prev = new Map(), open = [from];
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (cost.get(open[i]) < cost.get(open[bi])) bi = i;
      const id = open.splice(bi, 1)[0], m = data[id];
      if (id === to) break;
      if (!m) continue;
      const out = (m.exits || []).filter(([, t]) => !BLOCKED.has(id + ">" + t)).map(([, t]) => [t, 1, "exit"]);
      for (const [, , t] of m.warps || []) if (t !== SHIP || ship) out.push([t, 1, "warp"]);
      // An elevator has no warps of its own in the data: it goes back to every floor that leads into it.
      if (!m.warps && !m.exits) for (const t of into(id)) out.push([t, 1, "warp"]);
      if (m.exits) for (const t of towns) out.push([t, 3, "fly"]);
      for (const [t, c, how] of out) {
        const nc = cost.get(id) + c;
        if (!data[t] || !data[t].blocks || (cost.has(t) && cost.get(t) <= nc)) continue;
        if (!cost.has(t)) open.push(t);
        cost.set(t, nc); prev.set(t, [id, how]);
      }
    }
    if (from !== to && !prev.has(to)) return null;
    const path = [];
    for (let t = to; t !== from; t = prev.get(t)[0]) path.unshift({ to: t, how: prev.get(t)[1] });
    return path;
  }
  let intoMap = null;
  function into(id) {
    if (!intoMap) {
      intoMap = new Map();
      for (const k in data) for (const [, , t] of data[k].warps || []) {
        if (!intoMap.has(t)) intoMap.set(t, []);
        intoMap.get(t).push(+k);
      }
    }
    return intoMap.get(id) || [];
  }
  // The route as text: areas in a row with the same name (a tower's floors, a route and its gatehouse)
  // are one stop, the area you're in is left out, and the last stop is the place itself.
  function routeText(from, path) {
    const stops = [];
    let area = data[from].name;
    for (const { to, how } of path) {
      if (how !== "fly" && data[to].name === area) continue;
      area = data[to].name;
      stops.push((how === "fly" ? "Fly to " : "") + areaName(to));
    }
    const last = path[path.length - 1].to, final = placeName(last);
    if (stops.length && data[last].name === area && !stops[stops.length - 1].startsWith("Fly")) stops[stops.length - 1] = final;
    else if (stops[stops.length - 1] !== "Fly to " + final) stops.push(final);
    return stops;
  }

  // Tiles to head for on this map: where the edge exit or door to the next map is, or the spot itself.
  function goals(m, L, next) {
    const set = new Set(), { W, H, grid } = L;
    const open = (x, z) => x >= 0 && z >= 0 && x < W && z < H && grid[z * W + x] >= 0 && !(grid[z * W + x] & 0x8000);
    if (!next) {
      if (nav.x != null) set.add((nav.z - L.oz) * W + nav.x - L.ox);
      return set;
    }
    for (const [x, z, to] of m.warps || []) if (to === next) set.add((z - L.oz) * W + x - L.ox);
    for (const [d, to] of m.exits || []) {
      const t = data[to], [dx, dz] = DIR[d] || [];
      if (to !== next || !t || !t.blocks || dx == null) continue;
      const theirs = new Set(t.blocks.map(([bx, bz]) => bx + "," + bz));
      for (const [bx, bz] of m.blocks) {
        if (!theirs.has(bx + dx + "," + (bz + dz))) continue;
        const lx = bx * 32 - L.ox, lz = bz * 32 - L.oz;
        for (let i = 0; i < 32; i++) {
          const [x, z] = dz ? [lx + i, dz < 0 ? lz : lz + 31] : [dx < 0 ? lx : lx + 31, lz + i];
          if (open(x, z)) set.add(z * W + x);
        }
      }
    }
    // No shared block edge found (the neighbour only touches a corner, or via dimmed blocks): head for
    // that whole side of the map.
    if (!set.size) for (const [d, to] of m.exits || []) {
      const [dx, dz] = DIR[d] || [];
      if (to !== next || dx == null) continue;
      for (let i = 0; i < (dz ? W : H); i++) {
        const [x, z] = dz ? [i, dz < 0 ? 0 : H - 1] : [dx < 0 ? 0 : W - 1, i];
        if (open(x, z)) set.add(z * W + x);
      }
    }
    return set;
  }
  // Cheapest walk on the map's terrain: walls are a last resort, water costs more (Surf), ledges go the way
  // you jump (behaviours 56-59 = east, west, north, south), and trap tiles (the Ecruteak Gym's hidden pits,
  // the Rocket Hideout's trap battles) are avoided harder than walls. Returns tile points, corners only.
  const STEPS = [[1, 0, 56], [-1, 0, 57], [0, -1, 58], [0, 1, 59]];
  // Ice (behaviour 32) keeps you sliding the same way until the next tile is blocked or you're off the ice;
  // slide arrows (64-67 = east, west, north, south) turn you their way. Returns [tile you stop on, steps].
  const ICE = 32, SLIDES = { 64: [1, 0], 65: [-1, 0], 66: [0, -1], 67: [0, 1] };
  function slide(L, j, dx, dz) {
    const { grid, W, H } = L;
    for (let k = 1; k < W * H; k++) {
      const b = grid[j] & 0xff;
      if (SLIDES[b]) [dx, dz] = SLIDES[b];
      else if (b !== ICE) return [j, k];
      const x = j % W + dx, z = ((j / W) | 0) + dz, n = z * W + x;
      if (x < 0 || z < 0 || x >= W || z >= H || grid[n] < 0 || grid[n] & 0x8000) return [j, k];
      j = n;
    }
    return [j, W * H];
  }
  // Warp pads into the same map (`hops`, the Saffron Gym's rooms) take you to their other pad for one step.
  // Returned points can carry .pad (a pad to step on, the next point is where you land: .hop) and .slide
  // (reached by sliding on ice).
  function walk(L, sx, sz, ends, traps, hops) {
    const { grid, W, H } = L;
    if (!ends.size || sx < 0 || sz < 0 || sx >= W || sz >= H) return null;
    const local = (x, z) => x - L.ox >= 0 && z - L.oz >= 0 && x - L.ox < W && z - L.oz < H ? (z - L.oz) * W + x - L.ox : -1;
    const hop = new Map();
    for (const [x, z, tx, tz] of hops || []) if (local(x, z) >= 0 && local(tx, tz) >= 0) hop.set(local(x, z), local(tx, tz));
    const via = new Int32Array(W * H).fill(-1), slid = new Uint8Array(W * H);
    // With warp pads the walls between rooms are real (Kenny's Saffron Gym: four pads cost more than one
    // wall at 40, so the line went straight through), so a wall is a much later resort there.
    const wall = hop.size ? 1000 : 40;
    const trap = new Uint8Array(W * H);
    for (const [x, z, w, h] of traps || [])
      for (let j = z; j < z + h; j++) for (let i = x; i < x + w; i++) {
        const gx = i - L.ox, gz = j - L.oz;
        if (gx >= 0 && gz >= 0 && gx < W && gz < H) trap[gz * W + gx] = 1;
      }
    const cost = new Int32Array(W * H).fill(1e9), from = new Int32Array(W * H).fill(-1), start = sz * W + sx;
    cost[start] = 0;
    const buckets = [[start]];
    let end = -1;
    for (let c = 0; c < buckets.length && end < 0; c++) for (const i of buckets[c] || []) {
      if (cost[i] !== c) continue;
      if (ends.has(i)) { end = i; break; }
      const x = i % W, z = (i / W) | 0;
      for (const [dx, dz, ledge] of STEPS) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
        let j = nz * W + nx, v = grid[j], k = 1, pad = -1, sl = 0;
        // A warp costs a few steps (the fade), so fewer pads win over a slightly shorter walk.
        if (!ends.has(j) && hop.has(j)) [pad, j, k] = [j, hop.get(j), 8];
        else if (!ends.has(j)) {
          if (v < 0) continue;
          const b = v & 0xff;
          // A wall or a ledge the wrong way is very dear but not ruled out: the terrain data marks some
          // walkable tiles (bridges, gaps by people) as walls, and no line at all helps nobody.
          if (trap[j]) k = 200;
          else if (v & 0x8000 || (b >= 56 && b <= 59 && b !== ledge)) k = wall;
          else if (tiles[b] === 2) k = 3;
          else if (b === ICE || (b >= 64 && b <= 67)) { [j, k] = slide(L, j, dx, dz); sl = 1; }
        }
        // On a tie, the way that keeps going straight wins, so the line (and the steps) turn less.
        const p = from[i], straight = p >= 0 && via[i] < 0 && i - p === j - i;
        if (c + k > cost[j] || (c + k === cost[j] && !straight)) continue;
        if (c + k < cost[j]) (buckets[c + k] = buckets[c + k] || []).push(j);
        cost[j] = c + k; from[j] = i; via[j] = pad; slid[j] = sl;
      }
    }
    if (end < 0) return null;
    const pts = [], at = (i) => [i % W, (i / W) | 0];
    for (let i = end; i >= 0; i = from[i]) {
      const p = at(i);
      p.slide = !!slid[i];
      pts.unshift(p);
      if (via[i] >= 0) { p.hop = true; const q = at(via[i]); q.pad = true; pts.unshift(q); }
    }
    const keep = (p) => p.hop || p.pad || p.slide;
    return pts.filter((p, n) => n === 0 || n === pts.length - 1 || keep(p) || keep(pts[n + 1]) ||
      (pts[n - 1][0] === p[0]) !== (pts[n + 1][0] === p[0]) || (pts[n - 1][1] === p[1]) !== (pts[n + 1][1] === p[1]));
  }

  // The line as written steps, one per warp pad (Kenny got lost in the Saffron Gym, 2026-10-29):
  // "3 down, 4 left onto pad 1", ..., "2 up, then press A". Pads are numbered in the order you take them.
  const WAYS = { "0,-1": "up", "0,1": "down", "-1,0": "left", "1,0": "right" };
  function steps(pts, end) {
    const out = [];
    let legs = [], pads = 0;
    const flush = (to) => { out.push(legs.map(([k, w]) => (k ? k + " " : "") + w).join(", ") + (legs.length ? " " : "") + to); legs = []; };
    for (let n = 1; n < pts.length; n++) {
      const p = pts[n], dx = p[0] - pts[n - 1][0], dz = p[1] - pts[n - 1][1];
      if (p.hop) continue; // the warp itself
      const big = Math.abs(dx) >= Math.abs(dz), w = WAYS[big ? Math.sign(dx) + ",0" : "0," + Math.sign(dz)];
      const last = legs[legs.length - 1];
      if (p.slide) legs.push([0, "slide " + w]);
      else if (last && last[1] === w && last[0]) last[0] += Math.abs(dx) + Math.abs(dz);
      else legs.push([Math.abs(dx) + Math.abs(dz), w]);
      if (p.pad) flush("onto pad " + ++pads);
    }
    // Ending on a person: stop on the tile in front of them.
    const last = legs[legs.length - 1];
    if (end === "person" && last && last[0]) if (!--last[0]) legs.pop();
    flush(end === "person" ? (legs.length ? "then " : "") + "face them and press A" : end);
    return out;
  }

  // Redraws the way when the map, the player's tile or the pick changes (called from follow() and drawMap()).
  let navDrawn = null;
  function updateNav(force) {
    const c = mapWrap && mapWrap.canvas;
    if (!c) return;
    const { svg, bar } = mapWrap, m = c.m, L = c.L, g = c.geo;
    if (!nav || !m || !L || !g || m !== data[shown]) {
      svg.style.display = "none"; bar.hidden = true; mapWrap.steps.hidden = true;
      for (const t of c.parentElement.querySelectorAll(".exit.go")) t.classList.remove("go");
      navDrawn = null;
      return;
    }
    const tx = lastPos ? Math.floor(lastPos[0]) - L.ox : -1, tz = lastPos ? Math.floor(lastPos[1]) - L.oz : -1;
    const k = [nav.key, shown, tx, tz, story].join(":");
    if (!force && k === navDrawn) return;
    navDrawn = k;
    const path = route(shown, nav.to), next = path && path[0];
    // The bar under the map: where to, and the stops on the way.
    const where = placeName(nav.to);
    bar.replaceChildren(node("b", null, "➜"), node("span", null, !path ? "No way found to " + where + " from here" :
      path.length ? routeText(shown, path).join(" › ") : "You're at " + where + (nav.x != null ? ": follow the line" : "")));
    const x = node("button", null, "✕");
    x.title = "Stop showing the way";
    x.onclick = () => pickNav(null);
    bar.append(x);
    bar.hidden = false;
    for (const t of c.parentElement.querySelectorAll(".exit")) t.classList.toggle("go", !!next && next.how !== "fly" && t.to === next.to);
    const pts = path && (!next || next.how !== "fly") && walk(L, tx, tz, goals(m, L, next && next.to), m.traps, m.hops);
    const list = mapWrap.steps;
    if (!pts || pts.length < 2) { svg.style.display = "none"; svg.pts = null; list.hidden = true; return; }
    // Written steps where the line alone is hard to follow: gyms, warp pads, ice.
    const hard = /Gym/.test(m.place || "") || pts.some((p) => p.pad || p.slide);
    list.replaceChildren(...(hard ? steps(pts, next ? "to the way to " + placeName(next.to) : nav.x != null ? "person" : "to the spot")
      .map((t) => node("li", null, t)) : []));
    list.hidden = !hard;
    svg.style.display = "";
    svg.setAttribute("viewBox", "0 0 " + g.w + " " + g.h);
    Object.assign(svg.style, { left: c.offsetLeft + c.clientLeft + "px", top: c.offsetTop + c.clientTop + "px", width: c.style.width, height: c.style.height });
    // The leg up to the first pad is the one to walk now: drawn bold with the moving arrows. Later legs
    // are fainter, each warp is a dotted hop, and each pad gets its number from the written steps.
    const xy = ([px, pz]) => px + 0.5 + "," + (pz + 0.5), first = pts.findIndex((p) => p.pad) + 1 || pts.length;
    const now = pts.slice(0, first), later = pts.slice(first);
    svg.querySelector(".band").setAttribute("d", "M" + now.map(xy).join("L"));
    svg.querySelector(".later").setAttribute("d", later.map((p) => (p.hop ? "M" : "L") + xy(p)).join(""));
    svg.querySelector(".jump").setAttribute("d", pts.map((p, n) => p.hop ? "M" + xy(pts[n - 1]) + "L" + xy(p) : "").join(""));
    const [ex, ez] = pts[pts.length - 1], dot = svg.querySelector("circle.end");
    dot.setAttribute("cx", ex + 0.5); dot.setAttribute("cy", ez + 0.5);
    // Arrows ride along the band like a conveyor (moveArrows()); the distance along it at each corner.
    // Drawn bigger when the map is shown small (under ~9px a tile), like the markers.
    svg.grow = Math.max(1, 9 / g.k);
    for (const b of svg.querySelectorAll(".band, .later")) b.style.strokeWidth = 1.1 * svg.grow;
    svg.querySelector(".jump").style.strokeWidth = 0.3 * svg.grow;
    dot.setAttribute("r", 0.55 * svg.grow);
    svg.querySelector(".pads").innerHTML = pts.filter((p) => p.pad).map(([px, pz], n) =>
      '<g transform="translate(' + (px + 0.5) + " " + (pz + 0.5) + ") scale(" + svg.grow + ')"><circle r="0.75"/>' +
      '<text dy="0.32">' + (n + 1) + "</text></g>").join("");
    svg.pts = now; svg.at = [0];
    for (let n = 1; n < now.length; n++) svg.at.push(svg.at[n - 1] + Math.abs(now[n][0] - now[n - 1][0]) + Math.abs(now[n][1] - now[n - 1][1]));
    if (!svg.moving) { svg.moving = true; requestAnimationFrame(moveArrows); }
  }
  // White arrows every ARROW_GAP tiles, moving ARROW_SPEED tiles a second toward the goal.
  const ARROW_GAP = 1.6, ARROW_SPEED = 2.5, ARROW = "M-.4,-.13H.02V-.32L.4,0L.02,.32V.13H-.4Z";
  function moveArrows(now) {
    const svg = mapWrap && mapWrap.svg, pts = svg && svg.pts;
    if (!pts || !nav || svg.style.display === "none" || idle()) { if (svg) svg.moving = false; return; }
    const at = svg.at, len = at[at.length - 1], g = svg.querySelector(".arrows");
    const grow = svg.grow, gap = ARROW_GAP * grow, count = Math.min(300, Math.floor(len / gap));
    while (g.childElementCount < count) {
      const a = document.createElementNS("http://www.w3.org/2000/svg", "path");
      a.setAttribute("d", ARROW);
      g.append(a);
    }
    const shift = (now / 1000 * ARROW_SPEED * grow) % gap;
    [...g.children].forEach((a, k) => {
      if (k >= count) { a.setAttribute("visibility", "hidden"); return; }
      const d = k * gap + shift;
      let n = 1;
      while (n < at.length - 1 && at[n] < d) n++;
      const [x0, z0] = pts[n - 1], [x1, z1] = pts[n], f = Math.min(1, (d - at[n - 1]) / (at[n] - at[n - 1] || 1));
      const angle = Math.atan2(z1 - z0, x1 - x0) * 180 / Math.PI;
      a.setAttribute("visibility", d > len - 0.6 * grow ? "hidden" : "visible");
      a.setAttribute("transform", "translate(" + (x0 + (x1 - x0) * f + 0.5) + " " + (z0 + (z1 - z0) * f + 0.5) + ") rotate(" + angle + ") scale(" + grow + ")");
    });
    requestAnimationFrame(moveArrows);
  }

  // The last few painted maps (each up to a few MB), oldest first.
  const painted = new Map(), PAINTED_MAX = 4;
  // Save-data flags for the map: items picked up (their flag, from hgss.json) and trainers beaten.
  const got = (f) => { const h = heap(); return !!(f && h && storyBase != null && Story.flag(h, storyBase, f)); };
  const beaten = (tid) => { const h = heap(); return !!(tid && h && storyBase != null && Story.beaten(h, storyBase, tid)); };
  // A trainer whose hide flag is set isn't there (the S.S. Aqua swaps its trainers each trip, Rockets leave).
  // Hide flags get cleared again, so unlike the story flags this reads only the live copy, not the save buffer.
  const away = (t) => { const h = heap(); return !!(t[5] && h && cands[pick] != null && Story.flag(h, cands[pick], t[5])); };
  const mapState = (m) => [...(m.items || []), ...(m.hidden || [])].map((it) => got(it[3]) ? 1 : 0).join("") + ":" +
    (m.trainers || []).map((t) => away(t) ? 2 : beaten(t[4]) ? 1 : 0).join("");
  const mapBoxH = () => Math.max(260, Math.min(560, innerHeight * 0.55 / zoom));
  // The rooms you can walk into next are read from the ROM ahead of time, so they show at once.
  const prewarm = (m) => (window.requestIdleCallback || setTimeout)(() => {
    for (const [, , to] of m.warps || []) if (data[to]) layout(data[to]);
  });
  async function drawMap(m, canvas, highlight) {
    canvas.want = m;
    const L = await layout(m);
    if (canvas.want !== m) return; // a newer map was asked for while this one was loading
    if (!L) return false;
    prewarm(m);
    const { W, H } = L;
    // The whole map always fits its box, so it never scrolls (Kenny's choice, 2026-10-26: following the
    // player moved it too much). The box is as tall as the map is shown, up to mapBoxH(), so a long
    // wide route like Route 36 doesn't leave a big empty gap above and below it.
    const box = canvas.parentElement;
    const boxW = (box && box.clientWidth || 268) - 6;
    const boxH = mapBoxH();
    const fit = Math.min(boxW / W, boxH / H);
    const k = fit;
    const ts = Math.max(8, Math.min(T, Math.ceil(k * zoom * (window.devicePixelRatio || 1))));
    let p = painted.get(m);
    if (p && p.ts !== ts) p = null;
    if (p) painted.delete(m); // move to the newest end
    else p = { ts, base: paintTerrain(m, L, ts) };
    painted.set(m, p);
    while (painted.size > PAINTED_MAX) painted.delete(painted.keys().next().value);
    const base = p.base;
    if (box) box.style.height = Math.min(boxH, Math.round(H * k)) + 6 + "px";
    if (canvas.width !== W * ts || canvas.height !== H * ts) { canvas.width = W * ts; canvas.height = H * ts; }
    canvas.style.width = Math.round(W * k) + "px";
    canvas.style.height = Math.round(H * k) + "px";
    canvas.style.imageRendering = k >= ts ? "pixelated" : "auto";
    canvas.geo = { x0: L.ox, z0: L.oz, w: W, h: H, k: Math.round(W * k) / W };
    const c = canvas.getContext("2d");
    // Markers are worked out in 16px-tile units, scaled down to the canvas.
    c.setTransform(ts / T, 0, 0, ts / T, 0, 0);
    c.drawImage(base, 0, 0, W * T, H * T);
    // Markers, drawn bigger when the map is shown small so they stay visible.
    const grow = Math.max(1, 8 / k);
    const at = (x, z) => [(x - L.ox + 0.5) * T, (z - L.oz + 0.5) * T];
    const ring = (x, y, r) => { c.strokeStyle = "#e0b030"; c.lineWidth = 3 * grow; c.strokeRect(x - r, y - r, 2 * r, 2 * r); };
    const ball = ([x, z], i, key, hidden) => {
      const [cx, cy] = at(x, z), r = 5 * grow;
      c.fillStyle = "#181820"; c.beginPath(); c.arc(cx, cy, r + grow, 0, 2 * Math.PI); c.fill();
      c.fillStyle = hidden ? "#e0b030" : "#d83820"; c.beginPath(); c.arc(cx, cy, r, Math.PI, 2 * Math.PI); c.fill();
      c.fillStyle = "#f8f8f0"; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI); c.fill();
      c.fillStyle = "#181820"; c.fillRect(cx - r, cy - grow / 2, 2 * r, grow);
      c.fillStyle = "#f8f8f0"; c.fillRect(cx - 1.5 * grow, cy - 1.5 * grow, 3 * grow, 3 * grow);
      if (highlight === key + i) ring(cx, cy, r + 6 * grow);
    };
    for (const [x, z] of m.warps || []) {
      const [cx, cy] = at(x, z), r = 3 * grow;
      c.strokeStyle = "#f8f8f0"; c.lineWidth = 2 * grow; c.strokeRect(cx - r, cy - r, 2 * r, 2 * r);
    }
    // Trainers: a big square with a white outline; a beaten one is dimmed and gets a green tick.
    (m.trainers || []).forEach((t, i) => {
      if (away(t)) return;
      const [x, z, , , tid] = t, [cx, cy] = at(x, z), r = 9 * grow, won = beaten(tid);
      c.globalAlpha = won ? 0.6 : 1;
      c.fillStyle = "#f8f8f0"; c.fillRect(cx - r - 2 * grow, cy - r - 2 * grow, 2 * r + 4 * grow, 2 * r + 4 * grow);
      c.fillStyle = "#181820"; c.fillRect(cx - r - grow, cy - r - grow, 2 * r + 2 * grow, 2 * r + 2 * grow);
      c.fillStyle = "#6040b0"; c.fillRect(cx - r, cy - r, 2 * r, 2 * r);
      c.fillStyle = "#f8f8f0"; c.fillRect(cx - r / 2, cy - r / 2, r, r);
      c.globalAlpha = 1;
      if (won) {
        c.lineCap = c.lineJoin = "round";
        for (const [w, color] of [[5 * grow, "#181820"], [3 * grow, "#48c058"]]) {
          c.strokeStyle = color; c.lineWidth = w; c.beginPath();
          c.moveTo(cx - r * 0.7, cy); c.lineTo(cx - r * 0.15, cy + r * 0.6); c.lineTo(cx + r * 0.8, cy - r * 0.6); c.stroke();
        }
      }
      if (highlight === "t" + i) ring(cx, cy, r + 6 * grow);
    });
    // Items you've picked up are left off.
    (m.hidden || []).forEach((it, i) => { if (!got(it[3])) ball(it, i, "h", true); });
    (m.items || []).forEach((it, i) => { if (!got(it[3])) ball(it, i, "i", false); });
    placeExits(m, canvas, L);
    canvas.L = L; canvas.m = m;
    updateNav(true);
    return true;
  }

  let pickedTime = null, highlight = null, mapWrap = null, showDebug = false;
  // The wild Pokémon you're battling, with its IVs (js/ivs.js). A Pokémon whose PID wasn't seen before
  // starts a new encounter; the box then shows that encounter's Pokémon for as long as they can still be
  // read in DS RAM (a caught one counts as yours and drops out). Hiding on the player's first step after
  // the battle was tried (PR #64/#65) but the field's memory is reused during a battle, so it hid the box
  // mid-fight in Kenny's game.
  let wildSeen = new Set(), wildLooked = false, wildNow = [], wildPids = [], wildBox = null, dexNames = null, wildDebug = "", wildKey = "";
  function wildTick() {
    const h = heap();
    if (idle() || !h || ram == null || !cands.length) return;
    // The heap can hold more than one DS RAM image (e.g. after loading a state), and `ram` may be a stale
    // one, so look in all of them.
    const found = [...new Map((rams.length ? rams : [ram]).filter((r) => r >= 0 && r + RAM_SIZE <= h.length).flatMap((r) => WildIVs.wild(h, r, RAM_SIZE, cands))
      .map((m) => [m.pid, m])).values()];
    // On the first look, older battles' Pokémon may still be in RAM too, so if some are in a battle's array
    // next to the player's Pokémon (`live`), only those count; after that, any Pokémon not seen before does.
    const first = !wildLooked;
    wildLooked = true;
    const fresh = found.filter((m) => !wildSeen.has(m.pid) && (!first || m.live || !found.some((x) => x.live)));
    for (const m of found) wildSeen.add(m.pid);
    if (fresh.length) wildPids = fresh.map((m) => m.pid);
    wildNow = found.filter((m) => wildPids.includes(m.pid));
    wildDebug = "iv " + found.length + "/" + wildNow.length + " in " + rams.length;
    const key = wildNow.map((m) => m.pid + ":" + m.level).join();
    if (key !== wildKey) { wildKey = key; drawWild(); }
  }
  function drawWild() {
    if (!wildBox) wildBox = node("div", "ivbox");
    wildBox.replaceChildren();
    wildBox.hidden = !wildNow.length;
    if (!dexNames) {
      dexNames = {};
      for (const m of Object.values(data || {})) for (const enc of [m.hg, m.ss]) {
        for (const rows of Object.values(enc || {})) for (const [dex, name] of rows) dexNames[dex] = name;
      }
    }
    for (const m of wildNow) {
      const { total, grade } = WildIVs.rate(m.ivs), nat = WildIVs.natureStats(m.nature);
      const head = node("div", "ivhead"), img = node("img");
      img.src = SPRITE + m.species + ".png"; img.alt = ""; img.loading = "lazy";
      img.onerror = () => { img.style.visibility = "hidden"; };
      const who = node("div", "ivwho");
      who.append(node("b", null, (dexNames[m.species] || "#" + m.species) + " Lv " + m.level),
        node("span", "ivnat", WildIVs.NATURES[m.nature] + (nat ? " (+" + WildIVs.STATS[nat[0]] + " \u2212" + WildIVs.STATS[nat[1]] + ")" : "")));
      head.append(img, who, node("span", "ivgrade " + grade, grade.toUpperCase()));
      const bars = node("ul", "ivbars");
      m.ivs.forEach((v, i) => {
        const li = node("li", v === 31 ? "max" : v === 0 ? "zero" : null);
        const label = node("span", "ivk" + (nat && nat[0] === i ? " up" : nat && nat[1] === i ? " down" : ""), WildIVs.STATS[i]);
        const bar = node("span", "ivbar"), fill = node("i");
        fill.style.width = Math.max(3, v / 31 * 100) + "%";
        bar.append(fill);
        li.append(label, bar, node("span", "ivv", String(v)));
        bars.append(li);
      });
      wildBox.append(head, bars, node("div", "ivsum", "IV total " + total + " / 186 (average 93)"));
    }
    if (wildNow.length) wildBox.prepend(node("h3", null, "WILD POKÉMON IVs"));
    if (!wildBox.isConnected && shown != null) el().prepend(wildBox);
  }

  // Debug data for fixing RAM readers against the real game: a JSON line (what the guide is following),
  // then each DS RAM image in the heap (4 MB each). It holds the game's live memory, save data included,
  // so it is only downloaded to Kenny's own computer; never commit one.
  function saveDump() {
    const h = heap();
    if (!h) return;
    const imgs = (rams.length ? rams : ram != null ? [ram] : []).filter((r) => r >= 0 && r + RAM_SIZE <= h.length);
    const info = JSON.stringify({ when: new Date().toISOString(), map: shown, rams: imgs, ram, cands, me, debug: debugLine() }) + "\n";
    const blob = new Blob([info, ...imgs.map((r) => h.slice(r, r + RAM_SIZE))], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pokemon-ram-" + Date.now() + ".bin";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  function render(id, msg) {
    shown = id;
    const g = el(), gl = $("guideL");
    g.replaceChildren(); gl.replaceChildren();
    gl.hidden = true;
    if (id == null) {
      g.append(node("h3", null, "GUIDE"), node("div", "note", msg || ""), node("div", "src", debug));
      return;
    }
    const m = data[id];
    // main: map (with its exits), next step, items. side: wild Pokémon, trainers. On wide screens main
    // goes in its own panel on the left of the game.
    const main = node("div", "gcol"), side = node("div", "gcol");
    if (wide.matches) { gl.append(main); gl.hidden = g.hidden; } else g.append(main);
    g.append(side);
    if (wildBox) g.prepend(wildBox); // top of the right-hand panel, in both layouts
    const loc = node("div", "loc", m.name || "???"), dbg = node("div", "dbg", debugLine());
    dbg.hidden = !showDebug;
    loc.onclick = () => { showDebug = !showDebug; dbg.hidden = dump.hidden = !showDebug; };
    const dump = node("button", "dump", "Save debug data");
    dump.hidden = !showDebug;
    dump.onclick = saveDump;
    main.append(loc, dbg, dump);
    main.append(node("div", "place", m.place || "\u00a0")); // always there, so the map below doesn't shift

    let canvas = null;
    if (m.blocks && Terrain.ready()) {
      // The map section is built once and moved into each new render, so it keeps its size and
      // the old map stays on screen until the new one is drawn (no flicker between areas).
      if (!mapWrap) {
        const c = node("canvas", "minimap");
        c.setAttribute("aria-hidden", "true");
        const box = node("div", "mapbox");
        box.style.height = mapBoxH() + 6 + "px";
        const dot = node("div", "me");
        dot.hidden = true;
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("class", "navpath");
        svg.setAttribute("preserveAspectRatio", "none");
        svg.innerHTML = '<path class="later"/><path class="jump"/><path class="band"/><g class="arrows"></g><circle class="end" r="0.55"/><g class="pads"></g>';
        box.append(c, svg, dot);
        const legend = node("div", "legend");
        // Each key is a small CSS copy of the marker drawn on the map.
        for (const label of ["you", "item", "hidden", "trainer", "beaten"]) legend.append(node("span", "key " + label, label));
        const bar = node("div", "navbar");
        bar.hidden = true;
        const list = node("ol", "navsteps");
        list.hidden = true;
        mapWrap = node("div", "mapwrap");
        mapWrap.append(box, bar, list, legend);
        mapWrap.canvas = c; mapWrap.svg = svg; mapWrap.bar = bar; mapWrap.steps = list;
      }
      const wrap = mapWrap;
      canvas = wrap.canvas;
      main.append(wrap);
      drawMap(m, canvas, highlight).then((ok) => { if (ok === false && shown === id) { wrap.remove(); canvas = null; } });
    }

    if (story != null) {
      const cur = Story.step(heap(), storyBase);
      if (cur !== navStep) { nav = null; navStep = cur; } // a new step: the old way is done
      main.append(...Story.nodes(heap(), storyBase, SPRITE, { key: nav && nav.key, pick: pickNav }));
    }

    const enc = m[ver];
    if (enc) {
      side.append(node("h3", null, "WILD"));
      if (enc.grass_morn) {
        const t = pickedTime || tod;
        const tabs = node("div", "tabs");
        for (const [k, label] of [["morn", "MORN"], ["day", "DAY"], ["nite", "NITE"]]) {
          const b = node("button", k === t ? "on" : "", label);
          b.onclick = () => { pickedTime = k === tod ? null : k; render(id); };
          tabs.append(b);
        }
        side.append(node("div", "method", "Grass"), tabs, monList(enc["grass_" + t]));
      }
      for (const k in METHODS) if (enc[k]) side.append(node("div", "method", METHODS[k]), monList(enc[k]));
      // Old, Good and Super Rod in one list: each Pokémon once, with its level range over all rods.
      const fish = new Map();
      for (const k of RODS) for (const [dex, name, lo, hi] of enc[k] || []) {
        const f = fish.get(dex);
        fish.set(dex, f ? [dex, name, Math.min(f[2], lo), Math.max(f[3], hi)] : [dex, name, lo, hi]);
      }
      if (fish.size) side.append(node("div", "method", "Fishing"), monList([...fish.values()]));
    }
    if (story != null) side.append(...Story.catches(heap(), storyBase, SPRITE));

    // Hover or tap a row to ring its spot on the mini map.
    const spot = (li, key) => {
      li.classList.add("spot");
      li.dataset.spot = key;
      if (highlight === key) li.classList.add("on");
      li.onmouseenter = li.onclick = () => {
        if (highlight === key || !canvas) return;
        highlight = key;
        for (const x of document.querySelectorAll(".guide .spot")) x.classList.toggle("on", x.dataset.spot === key);
        drawMap(m, canvas, key);
      };
    };

    const items = (m.items || []).map((it, i) => [it[2], false, "i" + i, it[3]]).concat((m.hidden || []).map((it, i) => [it[2], true, "h" + i, it[3]]));
    if (items.length) {
      main.append(node("h3", null, "ITEMS"));
      const ul = node("ul", "items");
      for (const [name, hidden, key, flag] of items) {
        const li = node("li", got(flag) ? "got" : null);
        const img = node("img");
        img.src = ITEM_ICON + slug(name.replace(/^([TH]M)\d+ .*/, (x, tm) => tm.toLowerCase() + "-normal")) + ".png";
        img.alt = ""; img.loading = "lazy";
        img.onerror = () => { img.style.visibility = "hidden"; };
        li.append(img, node("span", null, name));
        if (hidden) li.append(node("span", "h", "hidden"));
        spot(li, key);
        ul.append(li);
      }
      main.append(ul);
    }

    const here = (m.trainers || []).filter((t) => !away(t));
    if (here.length) {
      side.append(node("h3", null, "TRAINERS"));
      const ul = node("ul", "trainers");
      m.trainers.forEach((t, i) => {
        if (away(t)) return;
        const [, , who, party, tid] = t, li = node("li");
        li.dataset.tid = tid;
        li.append(node("div", "who", who));
        const p = node("div", "party");
        for (const [dex, name, lv] of party) {
          const mon = node("span", "pm");
          const img = node("img");
          img.src = SPRITE + dex + ".png"; img.alt = name; img.title = name; img.loading = "lazy";
          img.onerror = () => { img.style.visibility = "hidden"; };
          mon.append(img, node("span", null, name + " " + (lv + ExpShare.LEVEL_UP)));
          p.append(mon);
        }
        li.append(p);
        spot(li, "t" + i);
        ul.append(li);
      });
      side.append(ul);
    }
    if (!enc && !here.length) side.append(node("div", "note", "No wild Pokémon or trainers here."));

  }

  return { prepare, started };
})();

