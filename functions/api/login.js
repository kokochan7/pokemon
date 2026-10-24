import { checkPassword, makeToken, json, COOKIE, MAX_AGE } from "../../lib/auth.js";

export async function onRequestPost({ request, env }) {
  let body = {};
  try { body = await request.json(); } catch {}

  if (!env.SITE_PASSWORD) return json({ ok: false, error: "No password is set up yet in Cloudflare." }, 503);

  if (!(await checkPassword(body.password, env))) {
    await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
    return json({ ok: false, error: "Wrong password." }, 401);
  }

  const token = await makeToken(env);
  return json({ ok: true }, 200, {
    "set-cookie": `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Strict`,
  });
}
