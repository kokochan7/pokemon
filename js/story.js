/* ---------- story walkthrough for the guide panel's NEXT section (HeartGold / SoulSilver) ---------- */
// Works out where the player is in the story from the save data in DS RAM (same layout as the
// save file's general block): event flags, story variables, beaten-trainer flags and badges.
// The steps are written by hand in guide/story.json; boss teams come from guide/bosses.json.
const Story = (() => {
  const VARS = 0xDE4, FLAGS = 0x10C4;    // SaveVarsFlags in the general block: u16 vars[0x170], then flag bits
  const TRAINER_FLAGS = 0x550;           // FLAG_TRAINER(id) in the decomp
  const BADGES = [0x64 + 0x1a, 0x64 + 0x1f]; // trainer block: Johto, Kanto badge bits
  const STARTER = 0x4030;                // VAR_PLAYER_STARTER: species of the player's starter
  const DEX = 0x12B8, DEX_MAGIC = 0xBEEFCAFE; // Pokedex in the general block: magic, then caught bits (species - 1)
  const STARTERS = [152, 155, 158];      // Chikorita, Cyndaquil, Totodile: index into a rival's t list
  let steps = null, bosses = { teams: {}, dex: {} }, ver = "hg";

  async function load(v) {
    ver = v;
    try {
      const [s, b] = await Promise.all([fetch("guide/story.json"), fetch("guide/bosses.json")].map((p) => p.then((r) => r.json())));
      steps = s.steps; bosses = b;
    } catch { steps = null; }
  }

  // `base` can be a list of every copy of the general block found in RAM: besides the live one, the game
  // keeps a buffer it fills only when you save. Flags only ever get set and story vars only go up, so
  // a flag counts if any copy has it and a var is the highest of the copies.
  const flag = (h, base, n) => n > 0 && [].concat(base).some((b) => (h[b + FLAGS + (n >> 3)] >> (n & 7) & 1) === 1);
  const getVar = (h, base, id) => Math.max(...[].concat(base).map((b) => h[b + VARS + (id - 0x4000) * 2] | h[b + VARS + (id - 0x4000) * 2 + 1] << 8));

  // "f:0x6A|t:20&b:0": | is any, & is all. An empty condition is never true.
  function test(h, base, cond) {
    if (!cond) return false;
    cond = pick(cond); // "{f:0x117|f:0x116}": HeartGold's condition, then SoulSilver's
    return cond.split("|").some((any) => any.split("&").every((c) => {
      const [k, x] = [c[0], c.slice(2)];
      if (k === "f") return flag(h, base, Number(x));
      if (k === "t") return flag(h, base, TRAINER_FLAGS + Number(x));
      if (k === "b" || k === "k") return [].concat(base).some((b) => (h[b + BADGES[k === "k" ? 1 : 0]] >> Number(x) & 1) === 1);
      if (k === "c") return [].concat(base).some((b) => caught(h, b, Number(x)));
      if (k === "v") { const [id, min] = x.split(">="); return getVar(h, base, parseInt(id, 16)) >= Number(min); }
      return false;
    }));
  }

  function caught(h, b, species) {
    const o = b + DEX, magic = (h[o] | h[o + 1] << 8 | h[o + 2] << 16 | h[o + 3] << 24) >>> 0;
    return magic === DEX_MAGIC && (h[o + 4 + (species - 1 >> 3)] >> (species - 1 & 7) & 1) === 1;
  }

  // The first step not done yet. A step also counts as done once a later step is, unless it is
  // "free" (Kanto gyms can be beaten in any order).
  function current(h, base) {
    const done = steps.map((s) => test(h, base, s.done));
    for (let i = 0; i < steps.length; i++) {
      if (done[i] || (!steps[i].free && done.slice(i + 1).some(Boolean))) continue;
      return i;
    }
    return steps.length - 1;
  }

  // A short string that changes whenever the NEXT section would look different.
  function key(h, base) {
    if (!steps) return null;
    const i = current(h, base);
    return i + ":" + [...steps[i].todo || [], ...steps[i].opt || []].map(([, c]) => test(h, base, c) ? 1 : 0).join("");
  }

  const pick = (t) => t.replace(/\{([^{}|]*)\|([^{}]*)\}/g, (m, hg, ss) => ver === "ss" ? ss : hg);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = pick(String(text));
    return n;
  };
  function team(party, sprite) {
    const p = el("div", "party");
    for (const [dex, name, lv] of party) {
      const mon = el("span", "pm"), img = el("img");
      img.src = sprite + dex + ".png"; img.alt = name; img.title = name; img.loading = "lazy";
      img.onerror = () => { img.style.visibility = "hidden"; };
      mon.append(img, el("span", null, name + " " + (lv + ExpShare.LEVEL_UP)));
      p.append(mon);
    }
    return p;
  }

  // Game-style type icons (PokeAPI sprites, hot-linked like the Pokémon sprites).
  const TYPE_ICON = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/types/generation-iv/heartgold-soulsilver/";
  const TYPES = ["normal", "fighting", "flying", "poison", "ground", "rock", "bug", "ghost", "steel", "fire", "water",
    "grass", "electric", "psychic", "ice", "dragon", "dark"];
  function icons(types) {
    const row = el("span", "types");
    for (const t of types) {
      const img = el("img");
      img.src = TYPE_ICON + (TYPES.indexOf(t) + 1) + ".png"; img.alt = img.title = t;
      img.onerror = () => { img.replaceWith(el("span", "tname", t)); };
      row.append(img);
    }
    return row;
  }

  // The NEXT section, all at a glance: the step's to-do bullets (ticked from the save data), the
  // boss teams with type and weakness icons. What to catch goes in the right panel (catches()).
  // A bullet's place in story.json: a map id, [map id, x, z], or "HeartGold id|SoulSilver id".
  const where = (p) => typeof p === "string" ? [Number(p.split("|")[ver === "ss" ? 1 : 0])] : [].concat(p);

  // nav (from the guide) shows the way to a bullet's place when it is clicked (the place isn't written
  // out: Kenny just clicks): { key: the picked bullet, pick(key, place) }.
  function nodes(h, base, sprite, nav) {
    if (!steps) return [];
    const i = current(h, base), s = steps[i];
    const box = el("div", "story");
    box.append(el("div", "stitle", s.title));
    const bullet = (kind, j, [text, cond, place], done) => {
      const li = el("li", done ? "ok" : cond ? "" : "info", text);
      if (place != null && nav) {
        const key = i + kind + j, at = where(place);
        li.classList.add("go");
        li.classList.toggle("nav", key === nav.key);
        li.title = "Show the way";
        li.onclick = () => nav.pick(key === nav.key ? null : key, at, li);
      }
      return li;
    };
    const ul = el("ul", "todo");
    // The todo bullets are in game order, so a later one being done means the earlier ones are too
    // (a town's fly point, say, is only set on some ways in).
    const done = s.todo.map(([, cond]) => !!cond && test(h, base, cond));
    for (let j = done.length - 1, later = false; j >= 0; j--) {
      if (later && s.todo[j][1]) done[j] = true;
      later = later || done[j];
    }
    s.todo.forEach((t, j) => ul.append(bullet("t", j, t, done[j])));
    box.append(ul);
    // Optional side quests worth doing at this point; they tick themselves the same way.
    if (s.opt) {
      const ol = el("ul", "todo opt");
      s.opt.forEach((t, j) => ol.append(bullet("o", j, t, t[1] && test(h, base, t[1]))));
      box.append(el("div", "otitle", "Optional"), ol);
    }

    const starter = STARTERS.indexOf(getVar(h, base, STARTER));
    for (const b of s.boss || []) {
      const ids = Array.isArray(b.t) ? b.t : [b.t];
      const shown = b.name === "Rival" && ids.length === 3 ? [ids[Math.max(starter, 0)]] : ids;
      // Scripted battles (rivals, leaders, executives) never set the trainer-beaten flag: "won" is what
      // the script sets after the win instead.
      const beaten = b.won ? test(h, base, b.won) : shown.every((t) => flag(h, base, TRAINER_FLAGS + t));
      const div = el("div", "boss" + (beaten ? " beaten" : ""));
      const head = el("div", "bhead");
      head.append(el("b", null, b.name + (beaten ? " ✓" : "")));
      if (b.types.length) head.append(icons(b.types));
      div.append(head);
      if (b.weak.length) {
        const w = el("div", "weak");
        w.append(el("span", null, "Weakness"), icons(b.weak));
        div.append(w);
      }
      for (const t of shown) if (bosses.teams[t]) div.append(team(bosses.teams[t], sprite));
      box.append(div);
    }
    return [box];
  }

  // RECOMMEND CATCH for the right panel, between WILD and TRAINERS: sprites of what's worth catching on this step.
  function catches(h, base, sprite) {
    if (!steps) return [];
    const s = steps[current(h, base)];
    if (!s.catch) return [];
    const grid = el("ul", "cgrid");
    for (const [who, where] of s.catch) {
      const name = pick(who), li = el("li"), img = el("img");
      img.src = sprite + bosses.dex[name] + ".png"; img.alt = ""; img.loading = "lazy";
      img.onerror = () => { img.style.visibility = "hidden"; };
      const t = el("span");
      t.append(el("b", null, name), el("span", "where", where));
      li.append(img, t);
      grid.append(li);
    }
    return [el("h3", null, "RECOMMEND CATCH"), grid];
  }

  const beaten = (h, base, tid) => flag(h, base, TRAINER_FLAGS + tid);

  const step = (h, base) => steps ? current(h, base) : -1;

  return { load, key, nodes, catches, beaten, flag, test, step };
})();
