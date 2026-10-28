// Checks js/ivs.js against a fake DS RAM made of dummy bytes (no ROM or save needed): node tools/test_ivs.js
const fs = require("fs");
const src = fs.readFileSync(require("path").join(__dirname, "../js/ivs.js"), "utf8");
const WildIVs = new Function(src + "\nreturn WildIVs;")();
WildIVs.useBattleMons = true; // the fallback is off in the page, but keep testing it
const assert = require("assert");

const ORDERS = ["ABCD", "ABDC", "ACBD", "ACDB", "ADBC", "ADCB", "BACD", "BADC", "BCAD", "BCDA", "BDAC", "BDCA",
  "CABD", "CADB", "CBAD", "CBDA", "CDAB", "CDBA", "DABC", "DACB", "DBAC", "DBCA", "DCAB", "DCBA"];
const xor = (words, seed) => words.map((w) => { seed = (Math.imul(seed, 0x41C64E6D) + 0x6073) >>> 0; return w ^ seed >>> 16; });
// A party Pokémon as the game stores it (encrypted, shuffled), built the textbook way.
function makeMon(pid, species, level, ivs, egg = false) {
  const blocks = { A: new Array(16).fill(0), B: new Array(16).fill(0), C: new Array(16).fill(0), D: new Array(16).fill(0) };
  blocks.A[0] = species; blocks.A[2] = 0x1234; blocks.A[3] = 0x5678; // OT id
  const iv = (ivs.reduce((a, v, i) => a | v << i * 5, 0) | (egg ? 1 << 30 : 0)) >>> 0;
  blocks.B[8] = iv & 0xffff; blocks.B[9] = iv >>> 16;
  const plain = ORDERS[((pid >> 13) & 31) % 24].split("").flatMap((c) => blocks[c]);
  const sum = plain.reduce((a, b) => a + b, 0) & 0xffff;
  const party = new Array(50).fill(0); party[2] = level; party[3] = 20; party[4] = 20;
  const out = new Uint8Array(236), v = new DataView(out.buffer);
  v.setUint32(0, pid, true); v.setUint16(6, sum, true);
  xor(plain, sum).forEach((w, i) => v.setUint16(8 + i * 2, w, true));
  xor(party, pid).forEach((w, i) => v.setUint16(0x88 + i * 2, w, true));
  return out;
}
function putParty(h, at, mons) {
  const v = new DataView(h.buffer);
  v.setUint32(at, 6, true); v.setUint32(at + 4, mons.length, true);
  mons.forEach((m, i) => h.set(m, at + 8 + i * 236));
}

const h = new Uint8Array(0x800000), ram = 0x100000, gen = ram + 0x10000;
const mine = [makeMon(0x11112222, 155, 9, [10, 20, 30, 1, 2, 3]), makeMon(0x33334444, 16, 5, [5, 5, 6, 7, 8, 9])];
putParty(h, gen + WildIVs.PARTY_AT, mine);                // the save's party
putParty(h, ram + 0x200000, mine.slice(0, 1));             // the battle's copy of the player's lead
putParty(h, ram + 0x210000, [makeMon(0xAAAA0001, 19, 3, [31, 31, 0, 12, 25, 31])]); // the wild Rattata
putParty(h, ram + 0x220000, [makeMon(0xBBBB0001, 74, 12, [6, 6, 6, 6, 6, 6])]);    // a trainer's Geodude
putParty(h, ram + 0x228000, [makeMon(0xFFFF0031, 75, 32, [31, 31, 31, 31, 31, 31])]); // wild under an IV cheat
putParty(h, ram + 0x230000, [makeMon(0xCCCC0001, 175, 1, [9, 8, 7, 6, 5, 4], true)]); // an egg
const bad = makeMon(0xDDDD0001, 25, 4, [1, 2, 3, 4, 5, 6]); bad[20] ^= 1; // broken checksum
putParty(h, ram + 0x240000, [bad]);

// The battle's unencrypted copies (BattleMon): the player's lead and a wild Ursaring whose encrypted copy a
// cheat broke (no valid Party for it).
function battleMon(at, species, level, ivs, pid) {
  const v = new DataView(h.buffer);
  v.setUint16(at, species, true);
  for (let i = 2; i < 12; i += 2) v.setUint16(at + i, 50 + i, true);
  v.setUint16(at + 0xC, 33, true);
  v.setUint32(at + 0x14, ivs.reduce((a, x, i) => a | x << i * 5, 0) >>> 0, true);
  for (let i = 0; i < 8; i++) h[at + 0x18 + i] = 6;
  h[at + 0x24] = 0; h[at + 0x25] = 0; h[at + 0x34] = level;
  v.setUint16(at + 0x36, 0x12B, true); v.setUint16(at + 0x38, 0xffff, true); // a one-letter name
  v.setUint32(at + 0x4C, 90, true); v.setUint32(at + 0x50, 100, true); v.setUint32(at + 0x68, pid, true);
}
battleMon(ram + 0x250000, 155, 9, [10, 20, 30, 1, 2, 3], 0x11112222);
battleMon(ram + 0x250000 + WildIVs.BATTLE_MON, 217, 33, [3, 30, 17, 9, 22, 14], 0xEEEE0001);
// Junk with a BattleMon's shape but not next to the player's Pokémon (Kenny's game showed several, 2026-10-28).
battleMon(ram + 0x270000, 72, 1, [4, 0, 0, 0, 0, 0], 0x12345678);
const bad2 = makeMon(0xEEEE0001, 217, 33, [3, 30, 17, 9, 22, 14]); bad2[30] ^= 0x40;
putParty(h, ram + 0x260000, [bad2]);

const m = WildIVs.mon(h, ram + 0x210000 + 8);
assert.deepStrictEqual([m.species, m.level, m.ivs], [19, 3, [31, 31, 0, 12, 25, 31]]);
const wild = WildIVs.wild(h, ram, 0x400000, [gen]);
assert.deepStrictEqual(wild.map((x) => x.pid.toString(16)), ["aaaa0001", "ffff0031", "eeee0001"]);
assert.deepStrictEqual(wild[2].ivs, [3, 30, 17, 9, 22, 14]);
assert.deepStrictEqual(WildIVs.rate(wild[0].ivs), { total: 130, grade: "excellent" });
assert.strictEqual(WildIVs.rate([15, 15, 15, 15, 15, 15]).grade, "decent");
assert.strictEqual(WildIVs.rate([2, 20, 10, 5, 13, 8]).grade, "bad");
assert.deepStrictEqual(WildIVs.natureStats(3), [1, 4]); // Adamant: +Atk -SpA
assert.strictEqual(WildIVs.natureStats(12), null);      // Serious
console.log("wild:", wild.map((x) => `#${x.species} Lv${x.level} ${x.ivs.join("/")} ${WildIVs.NATURES[x.nature]}`).join(", "));
console.log("ok");
