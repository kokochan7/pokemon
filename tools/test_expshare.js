// Checks js/expshare.js against a fake DS RAM made of dummy bytes (no ROM needed): node tools/test_expshare.js
const fs = require("fs");
const src = fs.readFileSync(require("path").join(__dirname, "../js/expshare.js"), "utf8");
const store = {}; const btn = { hidden: true, textContent: "", title: "" };
global.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
global.$ = () => btn;
const heap = new Uint8Array(0x1000000);
global.window = { EJS_emulator: { gameManager: { Module: { HEAPU8: heap } } } };
const ExpShare = new Function(src + "\nreturn ExpShare;")();
const header = new Uint8Array(16); header.set([...Buffer.from("POKEMON HG")], 0); header.set([...Buffer.from("IPKE")], 12);
const base = 0x400000;  // DS RAM in the heap
heap.set(header, base + 0x3FFE00);
const w16 = (a, v) => { const o = base + a - 0x02000000; heap[o] = v & 255; heap[o + 1] = v >> 8; };
const r16 = (a) => { const o = base + a - 0x02000000; return heap[o] | heap[o + 1] << 8; };
const sites = [
  [0x0223e796, [0x0400, 0x9900, 0x0c00, 0x2900, 0xd020, 0x0844, 0x9901, 0x1c20, 0xf7ff, 0xee11, 0x1c29, 0x319c, 0x6008]],
  [0x0223e7c2, [0x9900, 0x1c20, 0xf7ff, 0xee22, 0x1c29, 0x31a0, 0x6008]],
  [0x0223e7e2, [0x9901, 0xf7ff, 0xee33, 0x1c29, 0x319c, 0x6008, 0x1c28, 0x309c, 0x6800, 0x2800, 0xd103, 0x1c28, 0x2101, 0x309c, 0x6001, 0x2000, 0x35a0, 0x6028]],
  [0x022458dc, [0x2106, 0x2200, 0x1c06, 0xf7f0, 0xf833, 0x0400, 0x0c00, 0x2101, 0x2205, 0xf7f1, 0xf844, 0x2833, 0xd011]],
  [0x02245a48, [0x4208, 0xd003, 0x9809, 0x309c, 0x6800, 0x900e, 0x9806, 0x2833, 0xd106, 0x9809, 0x30a0]],
  [0x02245b3e, [0x980e, 0x2800, 0xd018, 0x2111, 0xa82d]],
  [0x02245b76, [0x2025, 0xb036, 0x62a0, 0xbdf8]],
];
const load = (shift) => { heap.fill(0, base + 0x200000, base + 0x280000); for (const [a, c] of sites) c.forEach((v, i) => w16(a + shift + i * 2, v)); };
const dump = (shift) => sites.map(([a, c]) => c.map((_, i) => r16(a + shift + i * 2).toString(16)).join(" ")).join("\n");
const romBlob = () => ({ slice: () => ({ arrayBuffer: async () => header.buffer }) });
(async () => {
  await ExpShare.prepare(romBlob());
  console.log("button:", btn.hidden, btn.textContent);
  load(0);
  // drive tick via started's interval: call setInterval manually
  let fn; global.setInterval = (f) => { fn = f; }; ExpShare.started();
  for (let i = 0; i < 12; i++) fn();
  console.log("patched US:\n" + dump(0), "\n", btn.title);
  btn.onclick(); console.log("after off:\n" + dump(0), btn.textContent);
  btn.onclick(); console.log("on again:\n" + dump(0).split("\n")[0]);
  // a different overlay in that memory: nothing written
  heap.fill(0x55, base + 0x200000, base + 0x280000); const before = Buffer.from(heap.slice(base + 0x200000, base + 0x280000));
  for (let i = 0; i < 12; i++) fn();
  console.log("untouched other overlay:", Buffer.compare(before, Buffer.from(heap.slice(base + 0x200000, base + 0x280000))) === 0);
  load(0x40); for (let i = 0; i < 12; i++) fn();
  console.log("shifted +0x40:\n" + dump(0x40));
  // one site differs -> no write
  load(0); w16(0x02245b78, 0xb037); for (let i = 0; i < 12; i++) fn();
  console.log("mismatch site4 untouched:", r16(0x0223e79e).toString(16));
})();
