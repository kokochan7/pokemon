/* ---------- story walkthrough for the guide panel's NEXT section (HeartGold / SoulSilver) ---------- */
// Works out where the player is in the story from the save data in DS RAM (same layout as the
// save file's general block): event flags, story variables, beaten-trainer flags and badges.
// The steps are written by hand in guide/story.json; boss teams come from guide/bosses.json.
const Story = (() => {
  const VARS = 0xDE4, FLAGS = 0x10C4;    // SaveVarsFlags in the general block: u16 vars[0x170], then flag bits
  const TRAINER_FLAGS = 0x550;           // FLAG_TRAINER(id) in the decomp
  const BADGES = [0x64 + 0x1a, 0x64 + 0x1f]; // trainer block: Johto, Kanto badge bits
  const STARTER = 0x4030;                // VAR_PLAYER_STARTER: species of the player's starter
  const STARTERS = [152, 155, 158];      // Chikorita, Cyndaquil, Totodile: index into a rival's t list
  let steps = null, bosses = {}, ver = "hg";

  async function load(v) {
    ver = v;
    try {
      const [s, b] = await Promise.all([fetch("guide/story.json"), fetch("guide/bosses.json")].map((p) => p.then((r) => r.json())));
      steps = s.steps; bosses = b;
    } catch { steps = null; }
  }

  const flag = (h, base, n) => n > 0 && (h[base + FLAGS + (n >> 3)] >> (n & 7) & 1) === 1;
  const getVar = (h, base, id) => h[base + VARS + (id - 0x4000) * 2] | h[base + VARS + (id - 0x4000) * 2 + 1] << 8;

  // "f:0x6A|t:20&b:0": | is any, & is all. An empty condition is never true.
  function test(h, base, cond) {
    if (!cond) return false;
    return cond.split("|").some((any) => any.split("&").every((c) => {
      const [k, x] = [c[0], c.slice(2)];
      if (k === "f") return flag(h, base, Number(x));
      if (k === "t") return flag(h, base, TRAINER_FLAGS + Number(x));
      if (k === "b" || k === "k") return (h[base + BADGES[k === "k" ? 1 : 0]] >> Number(x) & 1) === 1;
      if (k === "v") { const [id, min] = x.split(">="); return getVar(h, base, parseInt(id, 16)) >= Number(min); }
      return false;
    }));
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
    return i + ":" + (steps[i].todo || []).map(([, c]) => test(h, base, c) ? 1 : 0).join("");
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
      mon.append(img, el("span", null, name + " " + lv));
      p.append(mon);
    }
    return p;
  }

  // Strongest trainers on the step's maps (by their top level), from hgss.json.
  function toughest(specs, maps) {
    const out = [];
    for (const spec of specs) {
      const [name, place] = spec.split("/");
      for (const m of Object.values(maps)) {
        if (m.name !== name || (place && m.place !== place)) continue;
        for (const [, , who, party] of m.trainers || []) {
          out.push({ who, where: m.place ? m.name + " · " + m.place : m.name, party, top: Math.max(...party.map((p) => p[2])) });
        }
      }
    }
    return out.sort((a, b) => b.top - a.top).slice(0, 3);
  }

  // The NEXT section: step title, what to do, then (folded) the boss, what to catch and the
  // toughest trainers on the way.
  function nodes(h, base, maps, sprite) {
    if (!steps) return [];
    const i = current(h, base), s = steps[i];
    const box = el("div", "story");
    box.append(el("div", "step", "Step " + (i + 1) + " of " + steps.length), el("div", "stitle", s.title));
    if (s.where) box.append(el("div", "where", s.where));
    box.append(el("p", null, s.text));
    if (s.todo) {
      const ul = el("ul", "todo");
      for (const [text, cond] of s.todo) {
        const ok = test(h, base, cond);
        const li = el("li", ok ? "ok" : cond ? "" : "info", text);
        ul.append(li);
      }
      box.append(ul);
    }

    const more = el("details", "more");
    try { more.open = localStorage.getItem("pp_next_more") === "open"; } catch {}
    more.ontoggle = () => { try { localStorage.setItem("pp_next_more", more.open ? "open" : "shut"); } catch {} };
    const parts = [];
    const starter = STARTERS.indexOf(getVar(h, base, STARTER));
    for (const b of s.boss || []) {
      const ids = Array.isArray(b.t) ? b.t : [b.t];
      const shown = /^Rival/.test(b.name) && ids.length === 3 ? [ids[Math.max(starter, 0)]] : ids;
      const div = el("div", "boss");
      const beaten = shown.every((t) => flag(h, base, TRAINER_FLAGS + t));
      div.append(el("div", "who", b.name + (beaten ? " ✓" : "")), el("div", "type", b.type + (b.weak ? " · weak to " + b.weak : "")));
      for (const t of shown) if (bosses[t]) div.append(team(bosses[t], sprite));
      if (b.tip) div.append(el("p", "tip", b.tip));
      more.append(div);
      parts.push(b.name.replace(/^Gym Leader |^Elite Four |^Executive /, "").replace(/ \(.*/, ""));
    }
    if (s.catch) {
      more.append(el("div", "method", "Catch nearby"));
      const ul = el("ul", "catch");
      for (const [who, where, why] of s.catch) {
        const li = el("li");
        li.append(el("b", null, who), el("span", "where", " · " + where), el("div", null, why));
        ul.append(li);
      }
      more.append(ul);
      parts.push("what to catch");
    }
    const tough = toughest(s.maps || [], maps);
    if (tough.length) {
      more.append(el("div", "method", "Toughest trainers on the way"));
      const ul = el("ul", "trainers");
      for (const t of tough) {
        const li = el("li");
        li.append(el("div", "who", t.who), el("div", "where", t.where), team(t.party, sprite));
        ul.append(li);
      }
      more.append(ul);
      parts.push("trainers");
    }
    if (s.watch) { more.append(el("p", "tip", s.watch)); parts.push("tips"); }
    if (parts.length) {
      more.prepend(el("summary", null, parts.join(" · ")));
      box.append(more);
    }
    return [el("h3", null, "NEXT"), box];
  }

  return { load, key, nodes };
})();
