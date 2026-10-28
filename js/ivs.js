/* ---------- wild Pokémon IVs (HeartGold / SoulSilver) ---------- */
// Reads the wild Pokémon you're battling out of DS RAM and rates its IVs. A wild battle's enemy side
// is a Party struct (maxCount 6, curCount, then 236-byte party Pokémon), each Pokémon encrypted as in
// every Gen 4 game: four 32-byte blocks shuffled by the PID and XORed with an LCRNG seeded by the
// checksum (box part) or the PID (party part). A copy is valid when its checksum adds up.
// The player's own party (save data, general block +0x90) is left out by PID, and trainer Pokémon are
// left out by their IVs: the game gives every trainer Pokémon six equal IVs (six 31s still count as wild).
// Freed battle memory isn't cleared, so the wild Pokémon is the one whose PID wasn't there before.
const WildIVs = (() => {
  const MON = 236, PARTY_AT = 0x90;
  const STATS = ["HP", "Atk", "Def", "Spe", "SpA", "SpD"];
  // The nature raises STATS[1 + n/5] and lowers STATS[1 + n%5] (same stat = neutral).
  const NATURES = ["Hardy", "Lonely", "Brave", "Adamant", "Naughty", "Bold", "Docile", "Relaxed", "Impish", "Lax",
    "Timid", "Hasty", "Serious", "Jolly", "Naive", "Modest", "Mild", "Quiet", "Bashful", "Rash",
    "Calm", "Gentle", "Sassy", "Careful", "Quirky"];
  // Where block A/B/C/D sits for each shuffle order ((PID >> 13) & 31) % 24.
  const ORDERS = ["ABCD", "ABDC", "ACBD", "ACDB", "ADBC", "ADCB", "BACD", "BADC", "BCAD", "BCDA", "BDAC", "BDCA",
    "CABD", "CADB", "CBAD", "CBDA", "CDAB", "CDBA", "DABC", "DACB", "DBAC", "DBCA", "DCAB", "DCBA"];

  const u16 = (h, o) => h[o] | h[o + 1] << 8;
  const u32 = (h, o) => (h[o] | h[o + 1] << 8 | h[o + 2] << 16 | h[o + 3] << 24) >>> 0;
  // XOR `words` u16s at h[o..] with the LCRNG stream from `seed` (the game's encryption).
  function crypt(h, o, words, seed) {
    const out = new Uint16Array(words);
    for (let i = 0; i < words; i++) {
      seed = (Math.imul(seed, 0x41C64E6D) + 0x6073) >>> 0;
      out[i] = u16(h, o + i * 2) ^ seed >>> 16;
    }
    return out;
  }
  // The Pokémon at h[o] (party format), or null if it isn't a valid one.
  function mon(h, o) {
    if (o < 0 || o + MON > h.length) return null;
    const pid = u32(h, o), flags = u16(h, o + 4), sum = u16(h, o + 6);
    if (flags & 4 || !pid) return null; // bad egg
    const box = flags & 2 ? Uint16Array.from({ length: 64 }, (_, i) => u16(h, o + 8 + i * 2)) : crypt(h, o + 8, 64, sum);
    let s = 0;
    for (const w of box) s += w;
    if ((s & 0xffff) !== sum) return null;
    const order = ORDERS[((pid >> 13) & 31) % 24];
    const blk = (c) => order.indexOf(c) * 16; // u16 index of block c
    const a = blk("A"), b = blk("B");
    const species = box[a];
    const ivw = (box[b + 8] | box[b + 9] << 16) >>> 0;
    if (!species || species > 493 || ivw >>> 30 & 1) return null; // egg
    const party = flags & 1 ? Uint16Array.from({ length: 50 }, (_, i) => u16(h, o + 0x88 + i * 2)) : crypt(h, o + 0x88, 50, pid);
    const level = party[2] & 0xff;
    if (!level || level > 100) return null;
    const ivs = STATS.map((_, i) => ivw >>> i * 5 & 31);
    return { pid, species, level, ivs, nature: pid % 25, hp: party[3], maxHp: party[4] };
  }

  // Every party Pokémon in a Party struct found in DS RAM (ram .. ram + size).
  function parties(h, ram, size) {
    const w = new Uint32Array(h.buffer, h.byteOffset + ram, size >> 2), out = [];
    for (let i = 0; i + 2 < w.length; i++) {
      if (w[i] !== 6 || w[i + 1] < 1 || w[i + 1] > 6) continue;
      const at = ram + i * 4 + 8, mons = [];
      for (let k = 0; k < w[i + 1]; k++) {
        const m = mon(h, at + k * MON);
        if (!m) break;
        mons.push(m);
      }
      if (mons.length === w[i + 1]) out.push({ at: ram + i * 4, mons });
    }
    return out;
  }

  // The battle's own copy of each Pokémon on the field (pokeheartgold's BattleMon, 0xBC bytes, not
  // encrypted): species +0, stats +2..+0xB, moves +0xC, IVs +0x14, stat stages +0x18 (8 x 0-12, 6 = normal),
  // types +0x24/+0x25, level +0x34, nickname +0x36 (11 chars, 0xFFFF-ended), HP +0x4C / max +0x50, PID +0x68.
  // A fallback for when the encrypted copy can't be read (Kenny, 2026-10-28: "iv 0/0" after Action Replay
  // codes). Plenty of other memory has this rough shape, so it only counts in the battle's array of four
  // (player, enemy, player 2, enemy 2): the slot just before it must hold one of the player's Pokémon.
  const BATTLE_MON = 0xBC;
  function battleMonAt(h, o) {
    if (o < 0 || o + BATTLE_MON > h.length) return null;
    const species = u16(h, o), level = h[o + 0x34];
    if (!species || species > 493 || level < 1 || level > 100) return null;
    for (let i = 0; i < 8; i++) if (h[o + 0x18 + i] > 12) return null;
    for (let i = 2; i < 12; i += 2) { const v = u16(h, o + i); if (!v || v > 999) return null; }
    if (h[o + 0x24] > 17 || h[o + 0x25] > 17) return null;
    const m0 = u16(h, o + 0xC);
    if (!m0 || m0 > 467 || [0xE, 0x10, 0x12].some((k) => u16(h, o + k) > 467)) return null;
    let end = -1;
    for (let i = 0; i < 11 && end < 0; i++) if (u16(h, o + 0x36 + i * 2) === 0xffff) end = i;
    if (end < 1) return null; // no name, or no end mark
    const hp = u32(h, o + 0x4C), maxHp = u32(h, o + 0x50), pid = u32(h, o + 0x68), ivw = u32(h, o + 0x14);
    if (!maxHp || maxHp > 999 || hp > maxHp || !pid || ivw >>> 30 & 1) return null;
    return { pid, species, level, ivs: STATS.map((_, i) => ivw >>> i * 5 & 31), nature: pid % 25, hp, maxHp };
  }
  function battleMons(h, ram, size, mine) {
    const out = [];
    for (let o = ram + BATTLE_MON; o + BATTLE_MON <= ram + size; o += 4) {
      const species = u16(h, o);
      if (!species || species > 493) continue;
      const m = battleMonAt(h, o);
      if (!m || mine.has(m.pid)) continue;
      const before = battleMonAt(h, o - BATTLE_MON);
      if (before && mine.has(before.pid)) out.push({ ...m, live: true });
    }
    return out;
  }

  // Wild Pokémon in DS RAM: lone Pokémon in a Party that isn't the player's and isn't a trainer's.
  // `saves` = general block offsets in the heap (the player's party is at +0x90).
  function wild(h, ram, size, saves) {
    const mine = new Set();
    for (const b of saves) for (const m of partyAt(h, b + PARTY_AT)) mine.add(m.pid);
    const out = new Map();
    for (const p of parties(h, ram, size)) {
      if (p.mons.length !== 1) continue;
      const m = p.mons[0];
      if (mine.has(m.pid) || trainerLike(m.ivs)) continue;
      out.set(m.pid, m);
    }
    // The BattleMon fallback is off: in Kenny's game it showed junk outside battle and still missed the real
    // wild Pokémon (2026-10-28). Turn it back on only after checking it against a real RAM dump.
    if (WildIVs.useBattleMons) for (const m of battleMons(h, ram, size, mine)) {
      if (!mine.has(m.pid) && !trainerLike(m.ivs)) out.set(m.pid, { ...(out.get(m.pid) || m), live: true });
    }
    return [...out.values()];
  }
  // Trainer Pokémon get six equal IVs (0-31). Six 31s is also what an IV cheat gives wild Pokémon (Kenny's
  // "max31" code: a wild Graveler with six 31s was hidden, 2026-10-28), so only equal IVs below 31 mean a trainer.
  const trainerLike = (ivs) => ivs[0] < 31 && ivs.every((v) => v === ivs[0]);
  function partyAt(h, at) {
    if (at < 0 || at + 8 > h.length) return [];
    const n = u32(h, at + 4), out = [];
    for (let k = 0; k < Math.min(n, 6); k++) { const m = mon(h, at + 8 + k * MON); if (m) out.push(m); }
    return out;
  }

  // Overall verdict from the IV total (0-186; a random Pokémon averages 93).
  function rate(ivs) {
    const total = ivs.reduce((a, b) => a + b, 0);
    return { total, grade: total >= 124 ? "excellent" : total >= 75 ? "decent" : "bad" };
  }
  // [raised stat index, lowered stat index] in STATS, or null for a neutral nature.
  function natureStats(n) {
    const up = 1 + Math.floor(n / 5), down = 1 + n % 5;
    return up === down ? null : [up, down];
  }

  return { useBattleMons: false, mon, parties, battleMons, BATTLE_MON, wild, rate, natureStats, STATS, NATURES, MON, PARTY_AT };
})();
