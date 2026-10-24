import { isAuthed, json } from "../../lib/auth.js";

// Lists the ROMs in the private R2 bucket (bound as ROMS).
export async function onRequestGet({ request, env }) {
  if (!(await isAuthed(request, env))) return json({ error: "unauthorized" }, 401);
  if (!env.ROMS) return json({ error: "Storage isn't connected to the site yet." }, 503);

  const roms = [];
  let cursor;
  do {
    const page = await env.ROMS.list({ cursor, limit: 1000 });
    for (const o of page.objects) {
      if (o.key.startsWith("saves/")) continue; // save files live in the same bucket
      roms.push({ key: o.key, size: o.size, uploaded: o.uploaded });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return json({ roms });
}
