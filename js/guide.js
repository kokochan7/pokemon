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
  const METHODS = { surf: "Surfing", rock: "Rock Smash", oldrod: "Old Rod", goodrod: "Good Rod", superrod: "Super Rod" };
  let ver = null, header = null, data = null, tiles = {}, shown = null, timer = null, scans = 0, tod = null, badges = null;
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
    try { ({ maps: data, tiles } = await (await fetch("guide/hgss.json")).json()); }
    catch { render(null, "Couldn't load the guide data."); ver = null; }
  }

  function started() {
    if (!ver) return;
    render(null, "Waiting for the game…");
    timer = setInterval(poll, 1000);
    setInterval(follow, 200);
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
    if (inside) {
      dot.style.left = c.offsetLeft + c.clientLeft + (p[0] - g.x0) * g.k + "px";
      dot.style.top = c.offsetTop + c.clientTop + (p[1] - g.z0) * g.k + "px";
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
    const t = timeOfDay(), b = cands[pick] + TRAINER;
    const bd = [h[b + 0x1a], h[b + 0x1f]]; // Johto and Kanto badge bits
    const changed = !badges || bd[0] !== badges[0] || bd[1] !== badges[1];
    if (id !== shown) highlight = null;
    if (id !== shown || t !== tod || changed) { tod = t; badges = bd; render(id); }
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

  // Mini map colours by terrain class (see "tiles" in hgss.json).
  const TILE = { 0: "#f0f0e0", 1: "#78c050", 2: "#5898f0", 3: "#b07840", 4: "#d83820", 5: "#e8d098" };
  const WALL = "#4c6450";

  async function drawMap(m, canvas, highlight) {
    const blocks = (m.blocks || []).map((b) => [...b, false]).concat((m.near || []).map((b) => [...b, true]));
    if (!blocks.length) return false;
    const bx0 = Math.min(...blocks.map((b) => b[0])), bz0 = Math.min(...blocks.map((b) => b[1]));
    const bw = Math.max(...blocks.map((b) => b[0])) - bx0 + 1, bh = Math.max(...blocks.map((b) => b[1])) - bz0 + 1;
    // Fill the column's width, up to about half the screen's height; draw at a whole number of
    // pixels per tile (at least the shown size) and let CSS scale it with crisp pixels.
    const boxW = (canvas.parentElement && canvas.parentElement.clientWidth || 268) - 6;
    const boxH = Math.max(260, Math.min(560, innerHeight * 0.55));
    const fit = Math.min(boxW / (bw * 32), boxH / (bh * 32));
    const s = Math.max(1, Math.min(8, Math.ceil(fit)));
    canvas.width = bw * 32 * s; canvas.height = bh * 32 * s;
    canvas.style.width = Math.floor(bw * 32 * fit) + "px";
    canvas.style.height = Math.floor(bh * 32 * fit) + "px";
    canvas.geo = { x0: bx0 * 32, z0: bz0 * 32, w: bw * 32, h: bh * 32, k: Math.floor(bw * 32 * fit) / (bw * 32) };
    const c = canvas.getContext("2d");
    c.fillStyle = "#181820"; c.fillRect(0, 0, canvas.width, canvas.height);
    let drew = false;
    for (const [bx, bz, land, dim] of blocks) {
      const t = await Terrain.block(land);
      if (!t) continue;
      drew = true;
      const ox = (bx - bx0) * 32 * s, oz = (bz - bz0) * 32 * s;
      for (let i = 0; i < 1024; i++) {
        const v = t[i];
        c.fillStyle = v & 0x8000 ? WALL : TILE[tiles[v & 0xff] || 0];
        c.fillRect(ox + (i & 31) * s, oz + (i >> 5) * s, s, s);
      }
      if (dim) { c.fillStyle = "rgba(24,24,32,.45)"; c.fillRect(ox, oz, 32 * s, 32 * s); }
    }
    if (!drew) return false;
    const dot = (x, z, fill, r, ring) => {
      const px = (x - bx0 * 32) * s + s / 2, pz = (z - bz0 * 32) * s + s / 2;
      c.fillStyle = "#181820"; c.fillRect(px - r - 1, pz - r - 1, 2 * r + 2, 2 * r + 2);
      c.fillStyle = fill; c.fillRect(px - r, pz - r, 2 * r, 2 * r);
      if (ring) { const o = r + Math.max(4, s); c.strokeStyle = "#e0b030"; c.lineWidth = Math.max(2, s / 2); c.strokeRect(px - o, pz - o, 2 * o, 2 * o); }
    };
    const r = Math.max(2, s);
    for (const [x, z] of m.warps || []) dot(x, z, "#f8f8f0", r - 1);
    (m.trainers || []).forEach(([x, z], i) => dot(x, z, "#585868", r, highlight === "t" + i));
    (m.hidden || []).forEach(([x, z], i) => dot(x, z, "#e0b030", r, highlight === "h" + i));
    (m.items || []).forEach(([x, z], i) => dot(x, z, "#d83820", r, highlight === "i" + i));
    return true;
  }

  // Next step of the story by badges earned (Johto byte, then Kanto byte; bit 0 = first badge).
  const JOHTO = [
    "Get your first Pokémon from Prof. Elm, run his errand to Mr. Pokémon's house on Route 30, then go north through Route 31 to Violet City. Gym: Falkner (Flying).",
    "Go south from Violet City down Route 32, through Union Cave and Route 33 to Azalea Town. Clear Team Rocket out of Slowpoke Well. Gym: Bugsy (Bug).",
    "Go west into Ilex Forest (herd the charcoal maker's lost Farfetch'd back to get HM01 Cut), then north on Route 34 to Goldenrod City. Gym: Whitney (Normal).",
    "Go north on Route 35 past the National Park to Route 36. The odd tree there needs the SquirtBottle from the Goldenrod Flower Shop. Then Route 37 to Ecruteak City. Gym: Morty (Ghost).",
    "Learn Surf at the Ecruteak Dance Theater, head west to Olivine City and check the Lighthouse, then surf Routes 40-41 to Cianwood City. Gym: Chuck (Fighting). Get the medicine at the pharmacy.",
    "Take the medicine to the sick Ampharos at the top of the Olivine Lighthouse. Gym: Jasmine (Steel).",
    "Go east from Ecruteak on Route 42 to Mahogany Town, north to the Lake of Rage, then clear Team Rocket's hideout under the Mahogany shop. Gym: Pryce (Ice).",
    "Free the Goldenrod Radio Tower from Team Rocket, then go east from Mahogany on Route 44 through the Ice Path to Blackthorn City. Gym: Clair (Dragon), then her test in the Dragon's Den.",
  ];
  const KANTO = [
    ["Brock", "Pewter City"], ["Misty", "Cerulean City"], ["Lt. Surge", "Vermilion City"], ["Erika", "Celadon City"],
    ["Janine", "Fuchsia City"], ["Sabrina", "Saffron City"], ["Blaine", "Seafoam Islands"], ["Blue", "Viridian City (last)"],
  ];
  function nextStep(johto, kanto) {
    for (let i = 0; i < 8; i++) if (!(johto >> i & 1)) return JOHTO[i];
    if (!kanto) return "On to the Pokémon League: from New Bark Town surf east on Route 27, climb Tohjo Falls (Waterfall, from the Ice Path) and take Route 26 and Victory Road to Indigo Plateau. After that, take the S.S. Aqua from Olivine to Kanto.";
    const left = KANTO.filter((k, i) => !(kanto >> i & 1));
    if (!left.length) return "All 16 badges! Talk to Prof. Oak in Pallet Town, then go west from Viridian City on Routes 22 and 28 to Mt. Silver.";
    return "Kanto badges left: " + left.map(([who, where]) => who + " (" + where + ")").join(", ") + ".";
  }

  let pickedTime = null, highlight = null;
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
    // main: next step, map, items, exits. side: wild Pokémon, trainers. On wide screens main
    // goes in its own panel on the left of the game.
    const main = node("div", "gcol"), side = node("div", "gcol");
    if (wide.matches) { gl.append(main); gl.hidden = g.hidden; } else g.append(main);
    g.append(side);
    main.append(node("div", "loc", m.name || "???"));
    if (m.place) main.append(node("div", "place", m.place));

    if (badges) main.append(node("h3", null, "NEXT"), node("div", "story", nextStep(badges[0], badges[1])));

    let canvas = null;
    if (m.blocks && Terrain.ready()) {
      canvas = node("canvas", "minimap");
      canvas.setAttribute("aria-hidden", "true");
      const box = node("div", "mapbox");
      const dot = node("div", "me");
      dot.hidden = true;
      box.append(canvas, dot);
      const legend = node("div", "legend");
      for (const [color, label] of [["#3870e8", "you"], ["#d83820", "item"], ["#e0b030", "hidden"], ["#585868", "trainer"], ["#f8f8f0", "door"]]) {
        const k = node("span", "key", label);
        k.style.setProperty("--c", color);
        legend.append(k);
      }
      const wrap = node("div", "mapwrap");
      wrap.append(node("h3", null, "MAP"), box, legend);
      main.append(wrap);
      drawMap(m, canvas, highlight).then((ok) => { if (!ok) { wrap.remove(); canvas = null; } });
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
    }

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

    const exits = (m.exits || []).map(([d, to]) => [{ N: "North", S: "South", E: "East", W: "West" }[d], to])
      .concat((m.warps || []).map(([, , to]) => ["Door", to]));
    if (exits.length) {
      main.append(node("h3", null, "EXITS"));
      const ul = node("ul", "items");
      for (const [d, to] of exits) {
        const t = data[to];
        if (!t) continue;
        const li = node("li");
        const label = t.name === m.name ? t.place || t.name : t.name + (t.place ? " · " + t.place : "");
        li.append(node("span", "dir", d), node("span", null, label));
        ul.append(li);
      }
      main.append(ul);
    }

    if (m.trainers) {
      side.append(node("h3", null, "TRAINERS"));
      const ul = node("ul", "trainers");
      m.trainers.forEach(([, , who, party], i) => {
        const li = node("li");
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

    const src = node("div", "src");
    const a = node("a", null, "More on Bulbapedia");
    a.href = "https://bulbapedia.bulbagarden.net/w/index.php?search=" + encodeURIComponent(m.name);
    a.target = "_blank"; a.rel = "noopener";
    src.append(a, node("div", null, "Map " + id + " · " + debug));
    main.append(src);
  }

  return { prepare, started };
})();

