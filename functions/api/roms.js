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

  // Read the 4-byte DS game code (header offset 0x0C) so the page can show the real title
  // before the ROM is ever downloaded. Ranged reads only fetch those 4 bytes.
  await Promise.all(roms.map(async (r) => {
    if (!/\.nds$/i.test(r.key)) return;
    try {
      const obj = await env.ROMS.get(r.key, { range: { offset: 12, length: 4 } });
      if (!obj) return;
      const code = String.fromCharCode(...new Uint8Array(await obj.arrayBuffer()));
      if (/^[A-Z0-9]{4}$/.test(code)) r.code = code;
    } catch {}
  }));

  return json({ roms });
}
