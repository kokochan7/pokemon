// Shared helpers for the password-protected ROM API.
// The password lives only in the Cloudflare secret SITE_PASSWORD.

const enc = new TextEncoder();

export const COOKIE = "pp_session";
export const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
  let s = "";
  for (const b of sig) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function checkPassword(given, env) {
  if (!env.SITE_PASSWORD || typeof given !== "string" || !given) return false;
  // Compare fixed-length digests so timing doesn't leak the password length.
  return safeEqual(await hmac("pw-check", given), await hmac("pw-check", env.SITE_PASSWORD));
}

// Session token = "<expiry>.<hmac>". Changing the password logs out every session.
export async function makeToken(env) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  return exp + "." + (await hmac(env.SITE_PASSWORD, "session:" + exp));
}

export async function isAuthed(request, env) {
  if (!env.SITE_PASSWORD) return false;
  const m = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)pp_session=([^;]+)/);
  if (!m) return false;
  const [exp, sig] = m[1].split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, await hmac(env.SITE_PASSWORD, "session:" + exp));
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}
