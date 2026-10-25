/* ---------- always-on Exp. Share and +5 trainer levels (HeartGold / SoulSilver) ---------- */
// After each knockout the Pokémon that fought get 100% of the EXP and the rest of the party (not
// eggs, not fainted) gets 50% (Kenny's choice). Only the Pokémon on the field gets the "gained X
// Exp. Points!" message; benched ones only show their level-ups. Every trainer's Pokémon are also
// 5 levels higher than normal. Always on, with no button. Nothing in the ROM or save changes:
// a few instructions of the game's code are patched in DS RAM, the same way an Action Replay code
// works. The battle code (overlay 12) is reloaded for every battle, so it is re-patched each time;
// the trainer party code is in the always-loaded ARM9 code and is patched once (and again after a
// reset). Addresses and bytes come from pret/pokeheartgold (US);
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
    { // BtlCmd_CalcExpGain: always take the "Exp. Share held" branch, and split the EXP as
      // gainedExp = EXP / 2 (fighters only) and partyGainedExp = EXP - EXP / 2 (everyone), with no
      // dividing by the number of fighters: lsrs r1, r0, #1; subs r4, r0, r1; adds r0, r1, #0.
      at: 0x0223e796,
      code:  [0x0400, 0x9900, 0x0c00, 0x2900, 0xd020, 0x0844, 0x9901, 0x1c20, BL, BL, 0x1c29, 0x319c, 0x6008],
      patch: [null, null, null, null, NOP, 0x0841, 0x1a44, 0x1c08, NOP, NOP, null, null, null],
    },
    { // the second division, (EXP - EXP / 2) / holders: partyGainedExp = EXP - EXP / 2
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
    { // Task_GetExp, adding up the EXP: "holds an Exp. Share" is always true (cmp r0, r0), so a fighter
      // gets gainedExp + partyGainedExp = 100% of the EXP and everyone else partyGainedExp = 50%.
      at: 0x02245a48,
      code:  [0x4208, 0xd003, 0x9809, 0x309c, 0x6800, 0x900e, 0x9806, 0x2833, 0xd106, 0x9809, 0x30a0],
      patch: [null, null, null, null, null, null, null, 0x4280, null, null, null],
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

  // CreateNPCTrainerParty (ARM9, 0x02073604 in HG US) calls CreateMon(mon, species, level, iv, ...)
  // once for each of the 4 trainer data layouts, each time with this code. iv is at most 31, so the
  // "lsl r3, r3, #0x18 ... lsr r3, r3, #0x18" (keep the low byte) does nothing: the lsl becomes a nop
  // and the lsr becomes "adds r2, #5", so the level passed to CreateMon is 5 higher. The level used to
  // seed the Pokémon's personality is read separately and stays the same. [value, mask] per halfword.
  const LEVEL_UP = 5;
  const TRAINER_CODE = [[0x1c03], [0x2001], [0x9000], [0x061b], [0x9701], [0x2002], [0x9002], [0x2000],
    [0x9003], [0x9a00, 0xff00], [0x9900, 0xff00], [0x8852], [0x1c30], [0x0e1b]]; // ldr r2/r1, [sp, #any]
  const TRAINER_PATCH = { 3: NOP, 13: 0x3200 | LEVEL_UP };
  const TRAINER_SEARCH = [0x02000000, 0x02110000]; // ARM9 static code

  let header = null, bases = [], scans = 0, shift = 0, logged = false, found = false, trainerAt = null, trainerBase = null, trainerTicks = 0;

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

  // The 4 CreateMon calls: every match of TRAINER_CODE in the ARM9 code, original or patched.
  function trainerIs(h, b, a, patched) {
    return TRAINER_CODE.every(([v, m = 0xffff], i) => {
      const want = patched && TRAINER_PATCH[i] != null ? TRAINER_PATCH[i] : v;
      return (u16(h, b, a + i * 2) & (patched && TRAINER_PATCH[i] != null ? 0xffff : m)) === want;
    });
  }
  function findTrainer(h, b) {
    const out = [];
    for (let a = TRAINER_SEARCH[0]; a < TRAINER_SEARCH[1]; a += 2) {
      if (u16(h, b, a) === 0x1c03 && (trainerIs(h, b, a, false) || trainerIs(h, b, a, true))) out.push(a);
    }
    return out.length === 4 && out[3] - out[0] < 0x400 ? out : null;
  }
  function trainerLevels(h, b) {
    for (const a of trainerAt) {
      if (!trainerIs(h, b, a, false)) continue; // already patched (or not the game's code right now)
      for (const i in TRAINER_PATCH) {
        const o = b + a + i * 2 - 0x02000000;
        h[o] = TRAINER_PATCH[i] & 0xff; h[o + 1] = TRAINER_PATCH[i] >> 8;
      }
      console.info("Trainer levels +" + LEVEL_UP + ": patched at 0x" + a.toString(16));
    }
  }

  function tick() {
    const h = heap();
    if (!h || !header) return;
    if (!bases.length) {
      if (scans++ % 10) return; // look for DS RAM every 5s until the game is running
      bases = findBases(h).filter((b) => b + RAM_SIZE <= h.length);
      if (!bases.length) return;
    }
    if (trainerAt) trainerLevels(h, trainerBase);
    else if (trainerTicks++ % 10 === 0) { // search every 5s until the game's code is in RAM
      for (const b of bases) if ((trainerAt = findTrainer(h, b))) { trainerBase = b; trainerLevels(h, b); break; }
    }
    for (const b of bases) {
      // Once the battle code has been found (and patched), it's always at the same address: no more searching.
      if (!all(h, b, false) && (found || !(scans++ % 4 === 0 && search(h, b)))) continue;
      write(h, b);
      found = true;
      bases = [b];
      if (!logged) { logged = true; console.info("Exp. Share: battle code patched"); }
      return;
    }
  }

  return { prepare, started, LEVEL_UP }; // LEVEL_UP: the guide panel adds it to trainer levels
})();
