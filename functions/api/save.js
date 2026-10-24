import { isAuthed, json } from "../../lib/auth.js";

// In-game save files (battery saves), stored in the same private bucket under saves/.
// Every overwrite first copies the previous save to saves/backups/<id>/, keeping the last 20.

const MAX_BYTES = 4 * 1024 * 1024; // DS saves are at most a few hundred KB
const KEEP_BACKUPS = 20;

function saveId(request) {
  const id = new URL(request.url).searchParams.get("id") || "";
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

async function sha256Hex(buf) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestGet({ request, env }) {
  if (!(await isAuthed(request, env))) return json({ error: "unauthorized" }, 401);
  if (!env.ROMS) return json({ error: "Storage not connected" }, 503);
  const id = saveId(request);
  if (!id) return json({ error: "bad id" }, 400);

  const obj = await env.ROMS.get(`saves/${id}.sav`);
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
  const id = saveId(request);
  if (!id) return json({ error: "bad id" }, 400);

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return json({ error: "empty save refused" }, 400);
  if (body.byteLength > MAX_BYTES) return json({ error: "save too large" }, 413);

  const sha256 = await sha256Hex(body);
  const key = `saves/${id}.sav`;

  // ?backup=1 stores a copy in the backups folder without touching the main save
  // (used when you pick the cloud save over this browser's copy).
  if (new URL(request.url).searchParams.get("backup") === "1") {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await env.ROMS.put(`saves/backups/${id}/${stamp}-replaced.sav`, body, { customMetadata: { sha256 } });
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
    await env.ROMS.put(`saves/backups/${id}/${stamp}.sav`, await existing.arrayBuffer(), {
      customMetadata: existing.customMetadata || {},
    });

    // Prune old backups.
    const list = await env.ROMS.list({ prefix: `saves/backups/${id}/` });
    const keys = list.objects.map((o) => o.key).sort();
    const extra = keys.slice(0, Math.max(0, keys.length - KEEP_BACKUPS));
    if (extra.length) await env.ROMS.delete(extra);
  }

  const put = await env.ROMS.put(key, body, { customMetadata: { sha256 } });
  return json({ ok: true, uploaded: put.uploaded.toISOString(), sha256 });
}
