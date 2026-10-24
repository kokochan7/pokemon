import { isAuthed, json } from "../../lib/auth.js";

// In-game save files (battery saves), stored in the same private bucket under saves/.
// Each browser/device has its own slot: saves/devices/<device>/<id>.sav (?device=). Without
// ?device= this is the old shared save saves/<id>.sav, which the page only reads to migrate.
// Every overwrite first copies the previous save to the matching backups folder, keeping the last 20.

const MAX_BYTES = 4 * 1024 * 1024; // DS saves are at most a few hundred KB
const KEEP_BACKUPS = 20;

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Returns { key, backups } for this request, or null if the id or device is malformed.
function saveKeys(request) {
  const q = new URL(request.url).searchParams;
  const id = q.get("id") || "", device = q.get("device");
  if (!ID_RE.test(id) || (device !== null && !ID_RE.test(device))) return null;
  if (device === null) return { key: `saves/${id}.sav`, backups: `saves/backups/${id}/` };
  return { key: `saves/devices/${device}/${id}.sav`, backups: `saves/backups/devices/${device}/${id}/` };
}

async function sha256Hex(buf) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestGet({ request, env }) {
  if (!(await isAuthed(request, env))) return json({ error: "unauthorized" }, 401);
  if (!env.ROMS) return json({ error: "Storage not connected" }, 503);
  const keys = saveKeys(request);
  if (!keys) return json({ error: "bad id" }, 400);

  const obj = await env.ROMS.get(keys.key);
  if (!obj) return json({ error: "none" }, 404);

  return new Response(obj.body, {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "private, no-store",
      "x-save-uploaded": obj.uploaded.toISOString(),
      "x-save-sha256": (obj.customMetadata && obj.customMetadata.sha256) || "",
    },
  });
}

export async function onRequestPut({ request, env }) {
  if (!(await isAuthed(request, env))) return json({ error: "unauthorized" }, 401);
  if (!env.ROMS) return json({ error: "Storage not connected" }, 503);
  const keys = saveKeys(request);
  if (!keys) return json({ error: "bad id" }, 400);

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return json({ error: "empty save refused" }, 400);
  if (body.byteLength > MAX_BYTES) return json({ error: "save too large" }, 413);

  const sha256 = await sha256Hex(body);
  const { key, backups } = keys;

  // ?backup=1 stores a copy in the backups folder without touching the main save
  // (used when you pick the cloud save over this browser's copy).
  if (new URL(request.url).searchParams.get("backup") === "1") {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await env.ROMS.put(`${backups}${stamp}-replaced.sav`, body, { customMetadata: { sha256 } });
    return json({ ok: true, backup: true });
  }

  // Back up the current cloud save before replacing it (skip if identical).
  const existing = await env.ROMS.get(key);
  if (existing) {
    const prevSha = existing.customMetadata && existing.customMetadata.sha256;
    if (prevSha === sha256) {
      return json({ ok: true, unchanged: true, uploaded: existing.uploaded.toISOString(), sha256 });
    }
    const stamp = existing.uploaded.toISOString().replace(/[:.]/g, "-");
    await env.ROMS.put(`${backups}${stamp}.sav`, await existing.arrayBuffer(), {
      customMetadata: existing.customMetadata || {},
    });

    // Prune old backups.
    const list = await env.ROMS.list({ prefix: backups });
    const keys = list.objects.map((o) => o.key).sort();
    const extra = keys.slice(0, Math.max(0, keys.length - KEEP_BACKUPS));
    if (extra.length) await env.ROMS.delete(extra);
  }

  const put = await env.ROMS.put(key, body, { customMetadata: { sha256 } });
  return json({ ok: true, uploaded: put.uploaded.toISOString(), sha256 });
}
