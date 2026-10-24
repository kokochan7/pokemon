import { isAuthed } from "../../lib/auth.js";

// Streams one ROM from the private R2 bucket, only for a signed-in session.
// The object key comes in as ?key=..., which decodes identically everywhere
// (names with spaces, dashes and parentheses are common for ROMs).
export async function onRequestGet({ request, env }) {
  if (!(await isAuthed(request, env))) return new Response("Unauthorized", { status: 401 });
  if (!env.ROMS) return new Response("Storage not connected", { status: 503 });

  const key = new URL(request.url).searchParams.get("key");
  if (!key) return new Response("Missing key", { status: 400 });

  const obj = await env.ROMS.get(key);
  if (!obj) return new Response("Not found in storage: " + key, { status: 404 });

  return new Response(obj.body, {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(obj.size),
      "cache-control": "private, no-store",
    },
  });
}
