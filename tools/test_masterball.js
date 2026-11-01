// Checks js/masterball.js against a fake DS RAM made of dummy bytes (no ROM or save needed): node tools/test_masterball.js
const fs = require("fs"), path = require("path"), assert = require("assert");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

const RAM = 0x100000, RAM_SIZE = 0x400000, h = new Uint8Array(RAM + RAM_SIZE + 0x1000);
const gen = RAM + 0x230000; // the save's general block
let map = 96;
const store = {};
const env = {
  ExpShare: { bases: () => [RAM] },
  Guide: { mapId: () => map, save: () => gen },
  Story: { flag: (h, b, n) => (h[b + 0x10C4 + (n >> 3)] >> (n & 7) & 1) === 1 },
  localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
  document: { body: { append() {} }, createElement: () => ({ setAttribute() {}, hidden: true }) },
  window: {},
  console: { info() {} },
};
const load = (src, name) => new Function(...Object.keys(env), src + "\nreturn " + name + ";")(...Object.values(env));
const WildIVs = load(read("js/ivs.js"), "WildIVs");
const MB = load(read("js/masterball.js"), "MasterBalls");
const u16 = (o) => h[o] | h[o + 1] << 8;
const put = (o, v) => { h[o] = v & 0xff; h[o + 1] = v >> 8; };
const ds = (a) => RAM + a - 0x02000000;
const masterBalls = (bag) => { for (let i = 0; i < 24; i++) if (u16(bag + 0x6C0 + i * 4) === 1) return u16(bag + 0x6C0 + i * 4 + 2); return 0; };

// ---- which wild Pokémon pay out ----
const OT = 0x5678 << 16 | 0x1234; // the player's id (wild Pokémon get it)
const shinyPid = (((0x5678 ^ 0x1234 ^ 0xBEEF) & 0xffff) << 16 | 0xBEEF) >>> 0;
assert(MB.shiny({ pid: shinyPid, ot: OT }));
assert(!MB.shiny({ pid: 0x9abc0def, ot: OT }));
assert(MB.perfect({ ivs: [31, 31, 30, 25, 20, 15] }));        // 152
assert(!MB.perfect({ ivs: [31, 31, 31, 31, 31, 31] }));       // an IV cheat, not a find
assert(!MB.perfect({ ivs: [31, 31, 30, 25, 20, 10] }));       // 147
let luckyPid = 1;
while (!MB.lucky({ pid: luckyPid })) luckyPid++;
let lucky = 0;
for (let p = 1; p <= 200000; p++) if (MB.lucky({ pid: p * 7919 })) lucky++;
assert(lucky > 800 && lucky < 1200, "about 1 in 200: " + lucky);

// ---- the bag ----
// Balls pocket: Poké Balls in slot 0, Great Balls in slot 1; the battle's copy of the bag elsewhere in RAM.
const bag = gen + 0x644, battleBag = RAM + 0x300000;
put(bag + 0x6C0, 4); put(bag + 0x6C2, 10); put(bag + 0x6C4, 3); put(bag + 0x6C6, 5);
put(bag, 17); put(bag + 2, 3); // a Potion x3 in the Items pocket
h.copyWithin(battleBag, bag, bag + 0x79C);
const before = MB.bagCopies(h, gen);
assert.deepStrictEqual(before, [bag, battleBag]);

const plain = { pid: 0x9abc0def, ot: OT, ivs: [1, 2, 3, 4, 5, 6] };
MB.wild(h, gen, [plain]); // header not set yet (no game): nothing
assert.strictEqual(masterBalls(bag), 0);
// prepare() reads the game code from the ROM header: dummy bytes with "IPK".
const fakeRom = { slice: () => ({ arrayBuffer: async () => Uint8Array.from([...Array(12).fill(0), 0x49, 0x50, 0x4b, 0x45]).buffer }) };
MB.prepare(fakeRom).then(() => {
  MB.wild(h, gen, [plain]);
  assert.strictEqual(masterBalls(bag), 0, "a plain wild Pokémon pays nothing");
  MB.wild(h, gen, [{ pid: shinyPid, ot: OT, ivs: [1, 2, 3, 4, 5, 6] }]);
  assert.strictEqual(masterBalls(bag), 1, "shiny");
  assert.strictEqual(masterBalls(battleBag), 1, "the battle's bag too");
  assert.strictEqual(u16(bag + 0x6C8), 1, "new slot after the Great Balls");
  MB.wild(h, gen, [{ pid: shinyPid, ot: OT, ivs: [1, 2, 3, 4, 5, 6] }]);
  assert.strictEqual(masterBalls(bag), 1, "same Pokémon again: nothing");
  MB.wild(h, gen, [{ pid: luckyPid, ot: 1, ivs: [1, 2, 3, 4, 5, 6] }, { pid: 0x0badf00d, ot: 1, ivs: [31, 31, 31, 31, 26, 20] }]);
  assert.strictEqual(masterBalls(bag), 3, "lucky + perfect");
  assert.strictEqual(masterBalls(battleBag), 3);
  assert.strictEqual(JSON.parse(store.masterBallPids).length, 3);

  // a full pocket: nothing written
  const full = RAM + 0x340000;
  for (let i = 0; i < 24; i++) { put(full + 0x6C0 + i * 4, 5 + i); put(full + 0x6C2 + i * 4, 1); }
  assert.strictEqual(MB.addBalls(h, full, 1), false);

  // ---- Bug-Catching Contest ----
  const sunStones = () => { for (let i = 0; i < 165; i++) if (u16(bag + i * 4) === 80) return bag + i * 4; return null; };
  MB.contestTick(h, gen);                                     // first look
  put(bag + 4, 80); put(bag + 6, 1);                          // Sun Stone, but no win flag (e.g. the item ball path)
  MB.contestTick(h, gen);
  assert.strictEqual(masterBalls(bag), 3, "stone without the win flag: nothing");
  h[gen + 0x10C4 + (0x141 >> 3)] |= 1 << (0x141 & 7);         // FLAG_WON_THIS_BUG_CONTEST
  MB.contestTick(h, gen);
  assert.strictEqual(masterBalls(bag), 3, "flag alone: nothing");
  put(sunStones() + 2, 2);                                    // the prize
  MB.contestTick(h, gen);
  assert.strictEqual(masterBalls(bag), 4, "1st place");
  MB.contestTick(h, gen);
  assert.strictEqual(masterBalls(bag), 4, "only once");
  h[gen + 0x10C4 + (1286 >> 3)] |= 1 << (1286 & 7); put(sunStones() + 2, 3); // the park's Shiny Stone ball (counted as a stone here)
  MB.contestTick(h, gen);
  assert.strictEqual(masterBalls(bag), 4, "park item ball: nothing");
  map = 40; put(sunStones() + 2, 4); MB.contestTick(h, gen);
  assert.strictEqual(masterBalls(bag), 4, "outside the park: nothing");

  // ---- the shop ----
  // Two identical ball lists 0x34 apart (Goldenrod, then Celadon), as in the US ARM9 data.
  // Celadon's comes already patched, as the first version of this did.
  MB.MART_OLD.forEach((v, i) => put(ds(0x020fbc1a) + i * 2, v));
  MB.MART_NEW.forEach((v, i) => put(ds(0x020fbc4e) + i * 2, v));
  // ShopMenu_GetItemPrice with real bl encodings (from keystone, GetItemAttr at 0x02077D00).
  const code = MB.PRICE.code.map((v, i) => (v === -1 ? { 9: 0xf61f, 10: 0xfde5, 27: 0xf7ff, 28: 0xffcf }[i] : v));
  code.forEach((v, i) => put(ds(0x02258120) + i * 2, v));
  assert(MB.priceIs(h, RAM));
  MB.shopTick(h, [RAM]);
  assert.deepStrictEqual(MB.MART_NEW.map((_, i) => u16(ds(0x020fbc1a) + i * 2)), MB.MART_NEW, "Goldenrod list");
  assert.deepStrictEqual(MB.MART_OLD.map((_, i) => u16(ds(0x020fbc4e) + i * 2)), MB.MART_OLD, "Celadon back to normal");
  // Expected bytes: keystone's assembly of the new function (checked in unicorn: type 0 item 1 -> 10000,
  // every other mart type / item the same as the original).
  const want = [0xb508, 0x4b0f, 0x1c02, 0x5cd0, 0x2800, 0xd10b, 0x2901, 0xd005, 0x1c08, 0x2100, 0x220b, 0xf61f, 0xfde3,
    0xbd08, 0x2027, 0x0200, 0x3010, 0xbd08, 0x3803, 0x2801, 0xd808, 0x1c08, 0x1c19, 0x3917, 0x3b13, 0x5851, 0x5cd2,
    0xf7ff, 0xffcf, 0xbd08, 0x2064, 0xbd08, 0x0283, 0x0000];
  assert.deepStrictEqual(want.map((_, i) => u16(ds(0x02258120) + i * 2)), want, "price function");
  assert(!MB.priceIs(h, RAM), "patched once");
  // a bl that has to borrow across the halves
  assert.deepStrictEqual(MB.moveBl(0xf000, 0xf801, 4), [0xf7ff, 0xffff]);

  console.log("ok");
}).catch((e) => { console.error(e); process.exit(1); });
