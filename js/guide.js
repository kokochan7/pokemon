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

  function started() {
    if (!ver) return;
    render(null, "Waiting for the game…");
    timer = setInterval(poll, 1000);
    setInterval(follow, 200);
    setInterval(markTrainers, 250);
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
    const h = heap(), dot = document.querySelector(".guide .me"), c = dot && dot.parentElement.querySelector("canvas");
    if (!h || !dot || !c || !c.geo) return;
    const p = player(h), g = c.geo;
    const inside = p && p[0] >= g.x0 && p[1] >= g.z0 && p[0] < g.x0 + g.w && p[1] < g.z0 + g.h;
    dot.hidden = !inside;
    if (!inside) return;
    const x = c.offsetLeft + c.clientLeft + (p[0] - g.x0) * g.k, y = c.offsetTop + c.clientTop + (p[1] - g.z0) * g.k;
    dot.style.left = x + "px";
    dot.style.top = y + "px";
    // Keep the player in the middle of the box when the map is bigger than it (the browser stops the
    // scroll at the map's edges), unless you just scrolled it yourself.
    const box = c.parentElement;
    if (Date.now() < followPause) return;
    box.scrollLeft = x - box.clientWidth / 2;
    box.scrollTop = y - box.clientHeight / 2;
  }
  let followPause = 0;

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
    if (!h) return;
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
  // Every 4-byte aligned spot in the heap where `bytes` occurs, using the word at keyAt as a key.
  function findAll(h, bytes, keyAt) {
    const u32 = new Uint32Array(h.buffer, h.byteOffset, h.length >> 2);
    const key = (bytes[keyAt] | bytes[keyAt + 1] << 8 | bytes[keyAt + 2] << 16 | bytes[keyAt + 3] << 24) >>> 0;
    const out = [];
    for (let i = 0; i < u32.length; i++) {
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
  let debug = "", ram;
  function scan() {
    const h = heap(), gen = general(), sig = gen && signature(gen);
    if (!h || !sig) { debug = gen ? "no trainer in save" : "no save"; return []; }
    const all = findAll(h, sig, 16).map((t) => t - TRAINER).map((b) => [b, score(h, b, gen)]);
    const found = all.filter(([b, sc]) => sc > 0.5 && mapAt(h, b) > 1 && mapAt(h, b) in data).map(([b]) => b);
    const rams = findAll(h, header, 12).map((x) => x - HEADER_IN_RAM);
    const inRam = found.filter((b) => rams.some((r) => b >= r && b < r + RAM_SIZE));
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

  let cands = [], last = [], pick = 0;
  function poll() {
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
    if (!(id in data) || id <= 1) { cands = []; return; }
    const t = timeOfDay(), st = Story.key(h, cands[pick]); // story progress from flags, vars and badges
    if (id !== shown) highlight = null;
    if (id !== shown || t !== tod || st !== story || cands[pick] !== storyBase) { tod = t; story = st; storyBase = cands[pick]; render(id); }
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

  // Draw the terrain once per map; markers go on top of this cached copy.
  async function paintTerrain(m, blocks, bx0, bz0, W, H) {
    const tg = await terrainGrid(blocks, bx0, bz0, W, H);
    if (!tg) return null;
    const { grid, dim } = tg, art = tileArt();
    const at = (x, z) => x < 0 || z < 0 || x >= W || z >= H ? -1 : grid[z * W + x];
    const wall = (x, z) => { const v = at(x, z); return v >= 0 && (v & 0x8000) !== 0; };
    const cls = (v) => tiles[v & 0xff] || 0;
    let caveTiles = 0;
    for (const v of grid) if (v >= 0 && (v & 0xff) === 8) caveTiles++;
    const env = m.exits && m.exits.length ? "out" : caveTiles > grid.length / 10 ? "cave" : "in";

    // Outdoors, the block of walls right above a door or warp is a building (rows above its bottom
    // row are roof); a lone blocked tile is a sign or boulder; other walls are trees.
    const house = new Int8Array(W * H); // 0 none, 1.. roof colour + 1 for the front row, -1 boulder
    if (env === "out") {
      const doors = (m.warps || []).map(([x, z]) => [x - bx0 * 32, z - bz0 * 32]);
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
    cv.width = W * T; cv.height = H * T;
    const c = cv.getContext("2d");
    c.fillStyle = "#181820"; c.fillRect(0, 0, cv.width, cv.height);
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
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
    c.fillStyle = "rgba(24,24,32,.45)";
    for (let i = 0; i < dim.length; i++) if (dim[i] && grid[i] >= 0) c.fillRect((i % W) * T, ((i / W) | 0) * T, T, T);
    cv.grid = grid;
    return cv;
  }

  // Name of the map an exit leads to, as short as it can be: "Route 31", or just "Mart" for a
  // building in the same town.
  function exitName(m, to) {
    const t = data[to];
    if (!t) return null;
    return t.name === m.name ? t.place || t.name : t.place && !t.blocks ? t.place : t.name;
  }

  // Exits as labels on the map: one at each edge that leads to a neighbouring map (placed at the
  // widest walkable gap on that edge), and one over each door.
  const DIR = { N: [0, -1, "▲"], S: [0, 1, "▼"], W: [-1, 0, "◀"], E: [1, 0, "▶"] };
  function placeExits(m, canvas, base, bx0, bz0) {
    const box = canvas.parentElement;
    if (!box) return;
    for (const el of box.querySelectorAll(".exit")) el.remove();
    const g = canvas.geo, W = g.w, H = g.h, grid = base.grid;
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
        const lx = (bx - bx0) * 32, lz = (bz - bz0) * 32;
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
      label("edge " + d, d === "E" ? name + " " + arrow : arrow + " " + name, x, z).side = d;
    }
    for (const [x, z, to] of m.warps || []) {
      const name = exitName(m, to);
      if (name) label("door", name, x - bx0 * 32 + 0.5, z - bz0 * 32, name).k = g.k;
    }
    clampExits(box);
    if (!box.clamps) { box.clamps = true; box.addEventListener("scroll", () => clampExits(box), { passive: true }); }
  }
  // Edge arrows stay in view while the map scrolls, pinned to the side they point to.
  function clampExits(box) {
    const L = box.scrollLeft, T0 = box.scrollTop, R = L + box.clientWidth, B = T0 + box.clientHeight;
    for (const el of box.querySelectorAll(".exit.edge")) {
      const w = el.offsetWidth / 2 + 4, h = el.offsetHeight / 2 + 4;
      let x = el.x, y = el.y;
      if (el.side === "N" || el.side === "S") x = Math.max(L + w, Math.min(R - w, x));
      else y = Math.max(T0 + h, Math.min(B - h, y));
      if (el.side === "N") y = Math.max(y, T0); if (el.side === "S") y = Math.min(y, B);
      if (el.side === "W") x = Math.max(x, L); if (el.side === "E") x = Math.min(x, R);
      el.style.left = x + "px"; el.style.top = y + "px";
    }
    // Door tags go above their door, or under it if that spot is taken. One that would still cover an
    // edge arrow or another tag is left out (its door keeps its outline), so tags never pile up.
    const taken = [...box.querySelectorAll(".exit.edge")].map((e) => e.getBoundingClientRect());
    const hits = (r) => taken.some((q) => r.left < q.right + 2 && q.left < r.right + 2 && r.top < q.bottom + 2 && q.top < r.bottom + 2);
    for (const el of box.querySelectorAll(".exit.door")) {
      el.hidden = false; el.classList.remove("below"); el.style.top = el.y + "px";
      let r = el.getBoundingClientRect();
      if (hits(r)) { el.classList.add("below"); el.style.top = el.y + el.k + "px"; r = el.getBoundingClientRect(); }
      if (hits(r)) el.hidden = true;
      else taken.push(r);
    }
  }

  const painted = new Map();
  const mapBoxH = () => Math.max(260, Math.min(560, innerHeight * 0.55));
  async function drawMap(m, canvas, highlight) {
    const blocks = (m.blocks || []).map((b) => [...b, false]).concat((m.near || []).map((b) => [...b, true]));
    if (!blocks.length) return false;
    const bx0 = Math.min(...blocks.map((b) => b[0])), bz0 = Math.min(...blocks.map((b) => b[1]));
    const bw = Math.max(...blocks.map((b) => b[0])) - bx0 + 1, bh = Math.max(...blocks.map((b) => b[1])) - bz0 + 1;
    const W = bw * 32, H = bh * 32;
    if (!painted.has(m)) painted.set(m, paintTerrain(m, blocks, bx0, bz0, W, H));
    canvas.want = m;
    const base = await painted.get(m);
    if (canvas.want !== m) return; // a newer map was asked for while this one was painting
    if (!base) return false;
    // Fill the column. Tiles stay at least 6px so they read; a bigger map scrolls in its box and
    // follows the player (see follow()). The box is always the same height, so the panel doesn't
    // jump when you change area; a shorter map sits in the middle of it.
    const box = canvas.parentElement;
    const boxW = (box && box.clientWidth || 268) - 6;
    const boxH = mapBoxH();
    if (box) box.style.height = boxH + 6 + "px";
    const fit = Math.min(boxW / W, boxH / H);
    const k = fit >= 6 ? fit : Math.max(6, boxW / W); // too tall: fill the width; too wide: 6px tiles
    canvas.width = W * T; canvas.height = H * T;
    canvas.style.width = Math.round(W * k) + "px";
    canvas.style.height = Math.round(H * k) + "px";
    canvas.style.marginTop = Math.max(0, Math.floor((boxH - Math.round(H * k)) / 2)) + "px";
    canvas.style.imageRendering = k >= T ? "pixelated" : "auto";
    canvas.geo = { x0: bx0 * 32, z0: bz0 * 32, w: W, h: H, k: Math.round(W * k) / W };
    const c = canvas.getContext("2d");
    c.drawImage(base, 0, 0);
    // Markers, drawn bigger when the map is shown small so they stay visible.
    const grow = Math.max(1, 8 / k);
    const at = (x, z) => [(x - bx0 * 32 + 0.5) * T, (z - bz0 * 32 + 0.5) * T];
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
    (m.trainers || []).forEach(([x, z], i) => {
      const [cx, cy] = at(x, z), r = 5 * grow;
      c.fillStyle = "#181820"; c.fillRect(cx - r - grow, cy - r - grow, 2 * r + 2 * grow, 2 * r + 2 * grow);
      c.fillStyle = "#585868"; c.fillRect(cx - r, cy - r, 2 * r, 2 * r);
      c.fillStyle = "#f8f8f0"; c.fillRect(cx - r / 2, cy - r / 2, r, r);
      if (highlight === "t" + i) ring(cx, cy, r + 6 * grow);
    });
    (m.hidden || []).forEach((it, i) => ball(it, i, "h", true));
    (m.items || []).forEach((it, i) => ball(it, i, "i", false));
    if (highlight && box) {
      const list = { i: m.items, h: m.hidden, t: m.trainers }[highlight[0]], it = list && list[+highlight.slice(1)];
      if (it) {
        const [cx, cy] = at(it[0], it[1]);
        box.scrollTo({ left: cx / T * canvas.geo.k - box.clientWidth / 2, top: cy / T * canvas.geo.k - box.clientHeight / 2, behavior: "smooth" });
        followPause = Date.now() + 4000;
      }
    }
    placeExits(m, canvas, base, bx0, bz0);
    return true;
  }

  let pickedTime = null, highlight = null, mapWrap = null;
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
    main.append(node("div", "loc", m.name || "???"));
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
        box.append(c, dot);
        for (const ev of ["wheel", "pointerdown", "touchstart"]) box.addEventListener(ev, () => { followPause = Date.now() + 4000; }, { passive: true });
        const legend = node("div", "legend");
        for (const [color, label] of [["#3870e8", "you"], ["#d83820", "item"], ["#e0b030", "hidden"], ["#585868", "trainer"]]) {
          const k = node("span", "key", label);
          k.style.setProperty("--c", color);
          legend.append(k);
        }
        mapWrap = node("div", "mapwrap");
        mapWrap.append(node("h3", null, "MAP"), box, legend);
        mapWrap.canvas = c;
      }
      const wrap = mapWrap;
      canvas = wrap.canvas;
      main.append(wrap);
      drawMap(m, canvas, highlight).then((ok) => { if (ok === false && shown === id) { wrap.remove(); canvas = null; } });
    }

    if (story != null) main.append(...Story.nodes(heap(), storyBase, SPRITE));

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

    const items = (m.items || []).map((it, i) => [it[2], false, "i" + i]).concat((m.hidden || []).map((it, i) => [it[2], true, "h" + i]));
    if (items.length) {
      main.append(node("h3", null, "ITEMS"));
      const ul = node("ul", "items");
      for (const [name, hidden, key] of items) {
        const li = node("li");
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

    if (m.trainers) {
      side.append(node("h3", null, "TRAINERS"));
      const ul = node("ul", "trainers");
      m.trainers.forEach(([, , who, party, tid], i) => {
        const li = node("li");
        li.dataset.tid = tid;
        li.append(node("div", "who", who));
        const p = node("div", "party");
        for (const [dex, name, lv] of party) {
          const mon = node("span", "pm");
          const img = node("img");
          img.src = SPRITE + dex + ".png"; img.alt = name; img.title = name; img.loading = "lazy";
          img.onerror = () => { img.style.visibility = "hidden"; };
          mon.append(img, node("span", null, name + " " + lv));
          p.append(mon);
        }
        li.append(p);
        spot(li, "t" + i);
        ul.append(li);
      });
      side.append(ul);
    }
    if (!enc && !m.trainers) side.append(node("div", "note", "No wild Pokémon or trainers here."));

  }

  return { prepare, started };
})();

