/* ---------- always-on Exp. Share (HeartGold / SoulSilver) ---------- */
// After each knockout every Pokémon in the party (not eggs, not fainted) gets the full EXP. Only
// the Pokémon on the field gets the "gained X Exp. Points!" message; benched ones only show their
// level-ups. Always on, with no button (Kenny's choice). Nothing in the ROM or save changes:
// while a battle is loaded, a few instructions of the battle code (overlay 12) are patched in
// DS RAM, the same way an Action Replay code works. The overlay is reloaded for every battle,
// so the patch is re-applied each time. Addresses and bytes come from pret/pokeheartgold (US);
// each site is checked byte for byte before writing, so another version or region is left alone.
// See docs/exp-share.md.
const ExpShare = (() => {
  const GAMES = ["IPK", "IPG"];
  const RAM_SIZE = 0x400000, HEADER_IN_RAM = 0x3FFE00; // boot copies the ROM header to 0x027FFE00
  const NOP = 0x46c0, BL = -1;                           // BL = either half of a bl or blx (any target)
  // Each site: DS address of the first halfword, the original Thumb halfwords, and what to
  // write (null = leave alone). Offsets from the first site are fixed, so on a version where
  // the overlay sits elsewhere the first site is searched for and the rest follow it.
  const SITES = [
    { // BtlCmd_CalcExpGain: always take the "Exp. Share held" branch, with the full EXP instead of
      // EXP / 2 (lsr r4, r0, #1 -> adds r4, r0, #0) and no dividing by the number of fighters.
      at: 0x0223e796,
      code:  [0x0400, 0x9900, 0x0c00, 0x2900, 0xd020, 0x0844, 0x9901, 0x1c20, BL, BL, 0x1c29, 0x319c, 0x6008],
      patch: [null, null, null, null, NOP, 0x1c04, null, null, NOP, NOP, null, null, null],
    },
    { // the second division, EXP / holders: partyGainedExp = EXP
      at: 0x0223e7c2,
      code:  [0x9900, 0x1c20, BL, BL, 0x1c29, 0x31a0, 0x6008],
      patch: [null, null, NOP, NOP, null, null, null],
    },
    { // The "nobody holds an Exp. Share" branch of BtlCmd_CalcExpGain, dead after the nop above, holds a
      // small routine for Task_GetExp's message step (called from the site at 0x02245B3E). Returns
      // Z=0 to print "gained X Exp. Points!" (the Pokémon on the field), else Z=1 with the next state
      // in r0: 0x25 (done) if it got no EXP, or 3 (EXP gauge, which goes straight to the level-up
      // check for a Pokémon not on the field) so benched Pokémon only get a message when they level up.
      at: 0x0223e7e2,
      code:  [0x9901, BL, BL, 0x1c29, 0x319c, 0x6008, 0x1c28, 0x309c, 0x6800,
        0x2800, 0xd103, 0x1c28, 0x2101, 0x309c, 0x6001, 0x2000, 0x35a0, 0x6028],
      patch: [0x980e, 0x2800, 0xd009, 0x6860, 0x19c0, 0x2186, 0x0189, 0x311c, 0x5c40, // ldr r0, [sp, #0x38]; cmp r0, #0; beq done
        0x42a8, 0xd103, 0x2dff, 0x4770, 0x2025, 0xe000, 0x2003, 0x4280, 0x4770],      // ctx->selectedMonIndex[expBattler] == slot?
    },
    { // Task_GetExp, choosing the next party slot: GetMonData(mon, MON_DATA_IS_EGG) instead of
      // the held item's effect, so every slot that isn't an egg gets a turn.
      at: 0x022458dc,
      code:  [0x2106, 0x2200, 0x1c06, BL, BL, 0x0400, 0x0c00, 0x2101, 0x2205, BL, BL, 0x2833, 0xd011],
      patch: [0x214c, null, null, null, null, null, null, null, null, NOP, NOP, 0x2800, null],
    },
    { // Task_GetExp, adding up the EXP: skip the fighters' gainedExp (beq -> b) and make "holds an
      // Exp. Share" always true (cmp r0, r0), so everyone gets partyGainedExp = the full EXP.
      at: 0x02245a48,
      code:  [0x4208, 0xd003, 0x9809, 0x309c, 0x6800, 0x900e, 0x9806, 0x2833, 0xd106, 0x9809, 0x30a0],
      patch: [null, 0xe003, null, null, null, null, null, 0x4280, null, null, null],
    },
    { // Task_GetExp, before printing the message: bl to the routine at 0x0223E7E2 instead of
      // "ldr r0, [sp, #0x38]; cmp r0, #0"; the beq after it goes to the code that stores r0 as the state.
      at: 0x02245b3e,
      code:  [0x980e, 0x2800, 0xd018, 0x2111, 0xa82d],
      patch: [0xf7f8, 0xfe50, null, null, null],
    },
    { // ...which no longer sets r0 = 0x25 itself
      at: 0x02245b76,
      code:  [0x2025, 0xb036, 0x62a0, 0xbdf8],
      patch: [NOP, null, null, null],
    },
  ];
  const SEARCH = [0x02200000, 0x02280000]; // where overlay 12 can sit if it isn't at the US address

  let header = null, bases = [], scans = 0, shift = 0, logged = false;

  async function prepare(blob) {
    const h = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    if (GAMES.includes(String.fromCharCode(...h.slice(12, 15)))) header = h;
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
  // The second half is 0xF8xx for bl (Thumb target) and 0xE8xx for blx (ARM target, e.g. _s32_div_f).
  function isBl(hw, i, code) {
    return code[i - 1] === BL ? (hw & 0xe800) === 0xe800 : (hw & 0xf800) === 0xf000;
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

  function write(h, b) {
    SITES.forEach((s) => s.patch.forEach((v, i) => {
      if (v == null) return;
      const o = b + s.at + shift + i * 2 - 0x02000000;
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
      if (!all(h, b, false) && !(scans++ % 4 === 0 && search(h, b))) continue;
      write(h, b);
      if (!logged) { logged = true; console.info("Exp. Share: battle code patched"); }
      return;
    }
  }

  return { prepare, started };
})();
