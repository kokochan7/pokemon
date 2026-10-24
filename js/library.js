/* ---------- launching a game file (from the cloud list) ---------- */
async function handleFile(file) {
  err.textContent = "";
  if (!file) return;
  const core = detectCore(file.name, "auto");
  if (!core) {
    err.textContent = "UNKNOWN SYSTEM.";
    return;
  }
  const game = await identify(file);
  const label = game ? gameLabel(game) : file.name;
  // Keep a copy in this browser's STORED list so the next launch doesn't re-download it.
  try { await dbPut({ name: file.name, core, size: file.size, added: Date.now(), blob: file, game }); }
  catch (e) { console.warn("Could not save to library:", e); }
  launch(file.name, file, core, label);
}


/* ---------- library list ---------- */
async function renderLibrary() {
  const ul = $("lib");
  ul.innerHTML = "";
  let items = [];
  try { items = await dbAll(); } catch (e) { console.warn(e); }
  items.sort((a, b) => b.added - a.added);
  $("empty").hidden = items.length > 0;

  for (const it of items) {
    const li = document.createElement("li");

    const g = it.game;
    const label = g ? gameLabel(g) : it.name;
    if (g) li.style.setProperty("--tint", g.tint);

    const info = document.createElement("div");
    info.className = "name";
    info.textContent = label;

    const play = document.createElement("button");
    play.className = "primary";
    play.textContent = "Play";
    play.onclick = async () => {
      const rec = await dbGet(it.id);
      if (rec) launch(rec.name, rec.blob, rec.core, label);
    };

    const del = document.createElement("button");
    del.textContent = "Remove";
    del.onclick = async () => {
      const rec = await dbGet(it.id);
      const ds = it.core === "nds" && rec;
      const msg = ds
        ? "Remove " + label + "?\n\nThis deletes the game from this browser AND its save data on this device, " +
          "both here and in the cloud. Other devices keep their own saves. This can't be undone from the site."
        : "Are you sure you want to remove " + label + "?";
      if (!confirm(msg)) return;
      if (ds) {
        try { await SaveSync.removeSaves(rec.name, rec.blob); }
        catch (e) { alert(((e && e.message) || "Couldn't delete the cloud save.") + " Nothing was removed."); return; }
      }
      await dbDel(it.id);
      renderLibrary();
    };

    li.append(info, play, del);
    ul.appendChild(li);
  }
  hideStoredPlay();
}
renderLibrary();

/* ---------- cloud games (private R2 bucket, password protected) ---------- */
const cloudList = $("cloudList"), cloudMsg = $("cloudMsg"), loginForm = $("login"), logoutBtn = $("logout");

function showLogin(msg) {
  loginForm.hidden = false; logoutBtn.hidden = true;
  cloudList.innerHTML = "";
  cloudMsg.textContent = msg || "";
}

async function loadCloud() {
  let res;
  try { res = await fetch("/api/roms", { credentials: "same-origin" }); }
  catch { cloudMsg.textContent = ""; return; }
  if (res.status === 401) return showLogin();
  if (res.status === 404) { cloudMsg.textContent = ""; return; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { cloudMsg.textContent = data.error || "Couldn't load your games."; return; }

  loginForm.hidden = true; logoutBtn.hidden = false;
  cloudList.innerHTML = "";
  cloudMsg.textContent = data.roms.length ? "" : "NO GAMES IN STORAGE.";

  for (const r of data.roms) {
    const li = document.createElement("li");
    const info = document.createElement("div");
    info.className = "name";
    info.textContent = r.key.replace(/\.[^.]+$/, "");

    const play = document.createElement("button");
    play.className = "primary";
    play.textContent = "Play";
    play.onclick = () => playCloud(r, play);
    play.hidden = true;
    li.rom = r;

    li.append(info, play);
    cloudList.appendChild(li);

    // Show the proper game name from the header code the server read (no download needed).
    const known = r.code && NDS_GAMES[r.code.slice(0, 3)];
    if (known) {
      info.firstChild.textContent = known.title + (REGION[r.code[3]] ? " (" + REGION[r.code[3]] + ")" : "");
      li.style.setProperty("--tint", known.tint);
    } else cachedFor(r).then((rec) => {
      if (rec && rec.game) {
        info.firstChild.textContent = gameLabel(rec.game);
        li.style.setProperty("--tint", rec.game.tint);
      }
    });
  }
  hideStoredPlay();
}

// A game already in STORED is played from there, so its Play button here is hidden.
async function hideStoredPlay() {
  let items = [];
  try { items = await dbAll(); } catch {}
  for (const li of cloudList.children) {
    const r = li.rom;
    if (r) li.querySelector("button").hidden = items.some((x) => x.name === r.key && x.size === r.size);
  }
}

async function cachedFor(r) {
  try { return (await dbAll()).find((x) => x.name === r.key && x.size === r.size) || null; }
  catch { return null; }
}

async function playCloud(r, btn) {
  err.textContent = "";
  const cached = await cachedFor(r);
  if (cached) {
    const label = cached.game ? gameLabel(cached.game) : cached.name;
    return launch(cached.name, cached.blob, cached.core, label);
  }

  btn.disabled = true;
  btn.textContent = "Downloading…";
  try {
    const res = await fetch("/api/romfile?key=" + encodeURIComponent(r.key), { credentials: "same-origin" });
    if (res.status === 401) { btn.disabled = false; btn.textContent = "Play"; return showLogin("SESSION EXPIRED."); }
    if (!res.ok) throw new Error("HTTP " + res.status);
    const blob = await res.blob();
    const file = new File([blob], r.key.split("/").pop());
    // Cache it locally so next time it starts instantly (keeps the "Keep in library" choice).
    await handleFile(file);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "Play";
    cloudMsg.textContent = "Download failed (" + e.message + "). Try again.";
  }
}

loginForm.onsubmit = async (e) => {
  e.preventDefault();
  cloudMsg.textContent = "Checking…";
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ password: $("pw").value }),
  }).catch(() => null);
  $("pw").value = "";
  if (!res) { cloudMsg.textContent = "Couldn't reach the site."; return; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { cloudMsg.textContent = data.error || "Sign-in failed."; return; }
  loadCloud();
};

logoutBtn.onclick = async () => {
  await fetch("/api/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  showLogin("");
};

loadCloud();

/* ---------- Gen 2 clock (MORN / DAY / NITE) ---------- */
function tickClock() {
  const d = new Date(), h = d.getHours();
  const period = h >= 4 && h < 10 ? "morn" : h >= 10 && h < 18 ? "day" : "nite";
  document.documentElement.dataset.time = period;
  const hh = ((h + 11) % 12) + 1, mm = String(d.getMinutes()).padStart(2, "0");
  $("clock").textContent = period.toUpperCase() + "  " + hh + ":" + mm + (h < 12 ? " AM" : " PM");
}
tickClock();
setInterval(tickClock, 30000);
