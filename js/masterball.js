/* ---------- more ways to get Master Balls (HeartGold / SoulSilver) ---------- */
// Kenny's picks (2026-11-01):
// - a wild Pokémon that is shiny, or has an IV total of 150+ (not six 31s, which is what an IV cheat gives),
//   puts a Master Ball in the bag so you can catch it safely;
// - every wild Pokémon has a 1 in 200 chance to drop one ("lucky");
// - winning 1st place in the Bug-Catching Contest gives one on top of the prize stone;
// - the Goldenrod Dept. Store 2F ball clerk sells them for ₽10,000.
// Rewards are written into the bag in DS RAM (the save's Balls pocket, plus the battle's copy of the bag,
// which the game copies back over the save's bag when a battle ends). The shop is a code + data patch in
// DS RAM, like the Exp. Share. Nothing in the ROM or save file changes. See docs/master-balls.md.
const MasterBalls = (() => {
  const MASTER_BALL = 1, MAX = 999;
  const BAG = 0x644, BAG_SIZE = 0x79C;        // Bag in the save's general block (pret: bag_types_def.h)
  const ITEMS = 0x644, ITEM_SLOTS = 165;      // Items pocket: { u16 item, u16 count } per slot
  const BALLS = 0xD04, BALL_SLOTS = 24;       // Balls pocket
  const RAM_SIZE = 0x400000;

  // ---- rewards ----
  const LUCKY = 200;                          // 1 in LUCKY wild Pokémon drops one
  const PERFECT = 150;                        // IV total (of 186) that counts as "perfect"
  const shiny = (m) => m.ot != null && ((m.ot & 0xffff) ^ (m.ot >>> 16) ^ (m.pid & 0xffff) ^ (m.pid >>> 16)) < 8;
  const perfect = (m) => { const t = m.ivs.reduce((a, b) => a + b, 0); return t >= PERFECT && t < 186; };
  // Decided by the Pokémon's PID, so reloading the page or a save state can't re-roll it.
  const lucky = (m) => (Math.imul(m.pid ^ 0x5bd1e995, 0x9e3779b1) >>> 0) % LUCKY === 0;
  function why(m) {
    return shiny(m) ? "shiny Pokémon" : perfect(m) ? "perfect IVs" : lucky(m) ? "lucky find" : null;
  }

  // PIDs already rewarded (kept across reloads, so a reloaded save state doesn't pay twice).
  const KEY = "masterBallPids";
  let paid = [];
  try { paid = JSON.parse(localStorage.getItem(KEY)) || []; } catch { paid = []; }
  function remember(pid) {
    paid.push(pid);
    if (paid.length > 300) paid = paid.slice(-300);
    try { localStorage.setItem(KEY, JSON.stringify(paid)); } catch { /* private window: still works this session */ }
  }

  const u16 = (h, o) => h[o] | h[o + 1] << 8;
  const put16 = (h, o, v) => { h[o] = v & 0xff; h[o + 1] = v >> 8 & 0xff; };

  // Add n Master Balls to the Balls pocket of the bag at h[bag]. Returns false if the pocket is full.
  function addBalls(h, bag, n) {
    const pocket = bag + (BALLS - BAG);
    let free = -1;
    for (let i = 0; i < BALL_SLOTS; i++) {
      const o = pocket + i * 4, id = u16(h, o);
      if (id === MASTER_BALL) { put16(h, o + 2, Math.min(MAX, u16(h, o + 2) + n)); return true; }
      if (id === 0 && free < 0) free = o;
    }
    if (free < 0) return false;
    put16(h, free, MASTER_BALL); put16(h, free + 2, n);
    return true;
  }

  // Every exact copy of the save's bag in the same DS RAM: the battle keeps its own copy (BattleSetup.bag)
  // and copies it back over the save's bag when the battle ends, so a reward given mid-battle has to go in both.
  function bagCopies(h, gen) {
    const bag = gen + BAG, ram = ramOf(gen);
    const out = [bag];
    if (ram == null) return out;
    const first = u16(h, bag) | u16(h, bag + 2) << 16;
    const w = new Uint32Array(h.buffer, h.byteOffset + ram, RAM_SIZE >> 2);
    for (let i = 0; i < w.length - (BAG_SIZE >> 2); i++) {
      const o = ram + i * 4;
      if (w[i] !== first >>> 0 || o === bag) continue;
      let same = true;
      for (let k = 4; k < BAG_SIZE && same; k += 4) same = w[i + (k >> 2)] === (u16(h, bag + k) | u16(h, bag + k + 2) << 16) >>> 0;
      if (same) out.push(o);
    }
    return out;
  }
  // The DS RAM image (from the Exp. Share's search) that holds heap offset `o`.
  function ramOf(o) {
    const b = typeof ExpShare !== "undefined" ? ExpShare.bases() : [];
    return b.find((r) => o >= r && o < r + RAM_SIZE) ?? null;
  }

  function give(h, gen, n, reason) {
    const copies = bagCopies(h, gen);
    if (!addBalls(h, copies[0], n)) { toast("Balls pocket is full: no Master Ball (" + reason + ")"); return false; }
    for (const o of copies.slice(1)) addBalls(h, o, n);
    console.info("Master Ball +" + n + ": " + reason + " (" + copies.length + " bag" + (copies.length > 1 ? "s" : "") + ")");
    toast("Master Ball! (" + reason + ")");
    return true;
  }

  // Called by the guide with the wild Pokémon of each new encounter (js/guide.js wildTick).
  function wild(h, gen, mons) {
    if (!header || gen == null) return;
    for (const m of mons) {
      const r = why(m);
      if (!r || paid.includes(m.pid)) continue;
      if (give(h, gen, 1, r)) remember(m.pid);
    }
  }

  // ---- Bug-Catching Contest ----
  // The judge's script sets FLAG_WON_THIS_BUG_CONTEST (0x141) for 1st place, then gives the prize: a Sun
  // Stone, or with the National Dex any of Sun/Moon/Fire/Thunder/Water/Leaf/Shiny/Dusk/Dawn/Oval Stone
  // (pret: overlay_bug_contest.c, scr_seq_0151.s). So: in National Park, with the flag set, one of those
  // stones going up in the Items pocket is the prize. The park's own Shiny Stone item ball (flag 1286) is
  // left out.
  const PARK = [96, 487];                       // National Park, and the park during the contest
  const WON = 0x141, PARK_SHINY_STONE = 1286;
  const STONES = [80, 81, 82, 83, 84, 85, 107, 108, 109, 110];
  let contest = null;                           // { gen, stones, ball } from the last look
  function stones(h, gen) {
    let n = 0;
    for (let i = 0; i < ITEM_SLOTS; i++) {
      const o = gen + ITEMS + i * 4;
      if (STONES.includes(u16(h, o))) n += u16(h, o + 2);
    }
    return n;
  }
  function contestTick(h, gen) {
    if (gen == null || !PARK.includes(Guide.mapId())) { contest = null; return; }
    const now = { gen, stones: stones(h, gen), ball: Story.flag(h, gen, PARK_SHINY_STONE) };
    const was = contest;
    contest = now;
    if (!was || was.gen !== gen || now.stones <= was.stones || now.ball !== was.ball) return;
    if (Story.flag(h, gen, WON)) give(h, gen, 1, "Bug-Catching Contest 1st place");
  }

  // ---- Goldenrod Dept. Store 2F sells Master Balls for ₽10,000 ----
  // The ball clerk's list (Goldenrod 2F is map T25R1002: SpecialMartBuy 4, _020FBC1A in ARM9 data; Celadon 2F,
  // T07R0102, uses the identical list 19 right after it, at +0x34) gets a Master Ball after the Ultra Ball.
  // Kenny's RAM dump showed the shop's copy of list 4 (2026-11-01). The list can't grow, so the last
  // entry, Space Mail, is dropped.
  const MART_OLD = [4, 3, 2, 78, 63, 79, 76, 77, 137, 138, 139, 145, 0xffff];
  const MART_NEW = [4, 3, 2, 1, 78, 63, 79, 76, 77, 137, 138, 139, 0xffff];
  const MART_SEARCH = [0x020f0000, 0x02108000];  // US: 0x020FBC1A
  // Its price: ShopMenu_GetItemPrice (overlay 3, 0x02258120 US) returns GetItemAttr(item, PRICE) for a
  // normal mart, and the Master Ball's price there is 0. The function is rewritten in place so a normal
  // mart returns 10000 for item 1. The seal / Pokéathlon paths are shortened to fit but return the same
  // (checked in unicorn against the original for mart types 0-5). BL = keep the original bl.
  const BL = -1;
  const PRICE = {
    at: 0x02258120,
    code: [0xb508, 0x4b0f, 0x1c02, 0x5cd0, 0x2800, 0xd105, 0x1c08, 0x2100, 0x220b, BL, BL, 0xbd08,
      0x2801, 0xd101, 0x2064, 0xbd08, 0x30fd, 0x0600, 0x0e00, 0x2801, 0xd808, 0x1c08, 0x1c19, 0x3917,
      0x3b13, 0x5851, 0x5cd2, BL, BL, 0xbd08, 0x2064, 0xbd08, 0x0283, 0x0000],
    // "MOVED" = the original bl to GetItemAttr from halfwords 9-10, re-aimed from 4 bytes further on.
    patch: [0xb508, 0x4b0f, 0x1c02, 0x5cd0, 0x2800, 0xd10b, 0x2901, 0xd005, 0x1c08, 0x2100, 0x220b,
      "MOVED", "MOVED", 0xbd08, 0x2027, 0x0200, 0x3010, 0xbd08, // movs r0, #0x27; lsls r0, #8; adds r0, #0x10 = 10000
      0x3803, 0x2801, 0xd808, 0x1c08, 0x1c19, 0x3917, 0x3b13, 0x5851, 0x5cd2, null, null, 0xbd08, 0x2064, 0xbd08, null, null],
  };
  const PRICE_NEW = 10000;
  const isBl = (hw, half) => half === 0 ? (hw & 0xf800) === 0xf000 : (hw & 0xe800) === 0xe800;
  function priceIs(h, b) {
    for (let i = 0; i < PRICE.code.length; i++) {
      const hw = u16(h, b + PRICE.at + i * 2 - 0x02000000), want = PRICE.code[i];
      if (want === BL ? !isBl(hw, PRICE.code[i - 1] === BL ? 1 : 0) : hw !== want) return false;
    }
    return true;
  }
  // A Thumb bl at `hi, lo` re-encoded to reach the same target from `delta` bytes further on.
  function moveBl(hi, lo, delta) {
    let off = (hi & 0x7ff) << 12 | (lo & 0x7ff) << 1;
    if (off & 0x400000) off -= 0x800000;
    off -= delta;
    return [0xf000 | (off >> 12 & 0x7ff), (lo & 0xf800) | (off >> 1 & 0x7ff)];
  }
  function patchPrice(h, b) {
    const o = b + PRICE.at - 0x02000000;
    const moved = moveBl(u16(h, o + 18), u16(h, o + 20), 4);
    PRICE.patch.forEach((v, i) => {
      if (v == null) return;
      put16(h, o + i * 2, v === "MOVED" ? moved[i === 11 ? 0 : 1] : v);
    });
  }
  const listIs = (h, o, list) => list.every((v, i) => u16(h, o + i * 2) === v);
  let martAt = null, martBase = null, martTicks = 0, priceLogged = false;
  function findMart(h, b) {
    const out = [];
    for (let a = MART_SEARCH[0]; a < MART_SEARCH[1]; a += 2) {
      const o = b + a - 0x02000000;
      if (u16(h, o) === 4 && u16(h, o + 2) === 3 && (listIs(h, o, MART_OLD) || listIs(h, o, MART_NEW))) out.push(a);
    }
    // Goldenrod's list, then Celadon's 0x34 later.
    return out.length === 2 && out[1] - out[0] === 0x34 ? out[0] : null;
  }
  function shopTick(h, bases) {
    if (martAt == null) {
      if (martTicks++ % 5 === 0) for (const b of bases) if ((martAt = findMart(h, b)) != null) { martBase = b; break; }
    }
    if (martAt != null) {
      const o = martBase + martAt - 0x02000000;
      // The first version patched Celadon's list instead: put it back if it's still that way.
      if (listIs(h, o + 0x34, MART_NEW)) MART_OLD.forEach((v, i) => put16(h, o + 0x34 + i * 2, v));
      if (listIs(h, o, MART_OLD)) {
        MART_NEW.forEach((v, i) => put16(h, o + i * 2, v));
        console.info("Master Balls: Goldenrod 2F list patched at 0x" + martAt.toString(16));
      }
    }
    for (const b of bases) {
      if (!priceIs(h, b)) continue;
      patchPrice(h, b);
      if (!priceLogged) { priceLogged = true; console.info("Master Balls: shop price " + PRICE_NEW + " patched"); }
    }
  }

  // ---- page side ----
  let header = null, box = null, hideAt = 0;
  function toast(text) {
    if (!box) { box = document.createElement("div"); box.className = "mbtoast"; box.setAttribute("role", "status"); document.body.append(box); }
    box.textContent = text;
    box.hidden = false;
    clearTimeout(hideAt);
    hideAt = setTimeout(() => { box.hidden = true; }, 5000);
  }

  async function prepare(blob) {
    const h = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    header = ["IPK", "IPG"].includes(String.fromCharCode(...h.slice(12, 15))) ? h : null;
  }
  function heap() {
    const m = window.EJS_emulator && window.EJS_emulator.gameManager && window.EJS_emulator.gameManager.Module;
    return m && m.HEAPU8;
  }
  function tick() {
    const h = heap();
    if (!h) return;
    const bases = ExpShare.bases();
    if (bases.length) shopTick(h, bases);
    contestTick(h, Guide.save());
  }
  function started() {
    if (header) setInterval(tick, 500);
  }

  return { prepare, started, wild, why, shiny, perfect, lucky, addBalls, bagCopies, moveBl, priceIs, patchPrice, findMart, shopTick, contestTick, PRICE, MART_OLD, MART_NEW };
})();
