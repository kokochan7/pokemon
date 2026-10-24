/* ---------- always-on Exp. Share (HeartGold / SoulSilver) ---------- */
// Gen 6+ style: after each knockout, the Pokémon that fought get the full EXP and every other
// Pokémon in the party (not eggs, not fainted) gets half. Nothing in the ROM or save changes:
// while a battle is loaded, a few instructions of the battle code (overlay 12) are patched in
// DS RAM, the same way an Action Replay code works. The overlay is reloaded for every battle,
// so the patch is re-applied each time. Addresses and bytes come from pret/pokeheartgold (US);
// each site is checked byte for byte before writing, so another version or region is left alone.
// See docs/exp-share.md.
const ExpShare = (() => {
  const GAMES = ["IPK", "IPG"];
  const RAM_SIZE = 0x400000, HEADER_IN_RAM = 0x3FFE00; // boot copies the ROM header to 0x027FFE00
  const NOP = 0x46c0, BL = -1;                           // BL = either half of a bl (any target)
  // Each site: DS address of the first halfword, the original Thumb halfwords, and what to
  // write (null = leave alone). Offsets from the first site are fixed, so on a version where
  // the overlay sits elsewhere the first site is searched for and the rest follow it.
  const SITES = [
    { // BtlCmd_CalcExpGain: always take the "Exp. Share held" branch, without dividing by the
      // number of fighters or holders, so gainedExp = partyGainedExp = EXP / 2.
      at: 0x0223e796,
      code:  [0x0400, 0x9900, 0x0c00, 0x2900, 0xd020, 0x0844, 0x9901, 0x1c20, BL, BL, 0x1c29, 0x319c, 0x6008],
      patch: [null, null, null, null, NOP, null, null, null, NOP, NOP, null, null, null],
    },
    { // the second division, (EXP / 2) / holders
      at: 0x0223e7c2,
      code:  [0x9900, 0x1c20, BL, BL, 0x1c29, 0x31a0, 0x6008],
      patch: [null, null, NOP, NOP, null, null, null],
    },
    { // Task_GetExp, choosing the next party slot: GetMonData(mon, MON_DATA_IS_EGG) instead of
      // the held item's effect, so every slot that isn't an egg gets a turn.
      at: 0x022458dc,
      code:  [0x2106, 0x2200, 0x1c06, BL, BL, 0x0400, 0x0c00, 0x2101, 0x2205, BL, BL, 0x2833, 0xd011],
      patch: [0x214c, null, null, null, null, null, null, null, null, NOP, NOP, 0x2800, null],
    },
    { // Task_GetExp, adding up the EXP: "holds an Exp. Share" is always true (cmp r0, r0), so
      // a fighter gets gainedExp + partyGainedExp = EXP and everyone else EXP / 2.
      at: 0x02245a50,
      code:  [0x6800, 0x900e, 0x9806, 0x2833, 0xd106, 0x9809, 0x30a0],
      patch: [null, null, null, 0x4280, null, null, null],
    },
  ];
  const SEARCH = [0x02200000, 0x02280000]; // where overlay 12 can sit if it isn't at the US address

  let header = null, bases = [], scans = 0, shift = 0, saved = null, patchedAt = -1, status = "";

  function on() { try { return localStorage.getItem("pp_expshare") !== "off"; } catch { return true; } }
  function label() {
    $("expBtn").textContent = "Exp. Share: " + (on() ? "On" : "Off");
    $("expBtn").title = on() ? status : "Only the Pokémon that fought get EXP (the game's normal rule).";
  }

  async function prepare(blob) {
    const h = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    if (!GAMES.includes(String.fromCharCode(...h.slice(12, 15)))) return;
    header = h;
    status = "On. Waiting for the first battle.";
    $("expBtn").hidden = false;
    $("expBtn").onclick = () => {
      try { localStorage.setItem("pp_expshare", on() ? "off" : "on"); } catch {}
      tick();
      label();
    };
    label();
  }

  function started() {
    if (header) setInterval(tick, 500);
  }

  function heap() {
    const m = window.EJS_emulator && window.EJS_emulator.gameManager && window.EJS_emulator.gameManager.Module;
    return m && m.HEAPU8;
  }

  // Start of DS main RAM in the wasm heap: 0x3FFE00 before every copy of the ROM header.
  // (The ROM image itself also matches; its "RAM" just never holds the battle code.)
  function findBases(h) {
    const u32 = new Uint32Array(h.buffer, h.byteOffset, h.length >> 2);
    const key = (header[12] | header[13] << 8 | header[14] << 16 | header[15] << 24) >>> 0;
    const out = [];
    for (let i = 3; i < u32.length; i++) {
      if (u32[i] !== key) continue;
      const at = i * 4 - 12, base = at - HEADER_IN_RAM;
      if (base >= 0 && header.every((b, k) => h[at + k] === b)) out.push(base);
    }
    return out;
  }

  // Does the code at DS address `at` (+ shift) match `code`, or the patched version of it?
  function u16(h, b, a) { const o = b + a - 0x02000000; return h[o] | h[o + 1] << 8; }
  function isBl(hw, i, code) {
    return code[i - 1] === BL ? (hw & 0xf800) === 0xf800 : (hw & 0xf800) === 0xf000;
  }
  function siteIs(h, b, s, patched) {
    for (let i = 0; i < s.code.length; i++) {
      const hw = u16(h, b, s.at + shift + i * 2);
      const want = patched && s.patch[i] != null ? s.patch[i] : s.code[i];
      if (want === BL ? !isBl(hw, i, s.code) : hw !== want) return false;
    }
    return true;
  }
  const all = (h, b, patched) => SITES.every((s) => siteIs(h, b, s, patched));

  // Look for the first site's original bytes anywhere overlay 12 could be loaded.
  function search(h, b) {
    const s = SITES[0], first = s.code[0];
    for (let a = SEARCH[0]; a < SEARCH[1]; a += 2) {
      if (u16(h, b, a) !== first) continue;
      const old = shift;
      shift = a - s.at;
      if (all(h, b, false)) return true;
      shift = old;
    }
    return false;
  }

  function write(h, b, patched) {
    if (patched) saved = [];
    SITES.forEach((s, n) => s.code.forEach((_, i) => {
      if (s.patch[i] == null) return;
      const o = b + s.at + shift + i * 2 - 0x02000000;
      if (patched) saved.push(h[o] | h[o + 1] << 8);
      const v = patched ? s.patch[i] : saved.shift();
      h[o] = v & 0xff; h[o + 1] = v >> 8;
    }));
  }

  function tick() {
    const h = heap();
    if (!h || !header) return;
    if (!bases.length) {
      if (scans++ % 10) return; // look for DS RAM every 5s until the game is running
      bases = findBases(h).filter((b) => b + RAM_SIZE <= h.length);
      if (!bases.length) return;
    }
    for (const b of bases) {
      if (!all(h, b, false) && !all(h, b, true) && !(scans++ % 4 === 0 && search(h, b))) continue;
      if (on() && all(h, b, false)) {
        write(h, b, true);
        patchedAt = b;
        status = "On: working in this battle.";
        label();
      } else if (!on() && b === patchedAt && saved && all(h, b, true)) {
        write(h, b, false);
        patchedAt = -1;
      }
      return;
    }
  }

  return { prepare, started };
})();
