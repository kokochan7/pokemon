import { json, COOKIE } from "../../lib/auth.js";

export async function onRequestPost() {
  return json({ ok: true }, 200, {
    "set-cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
  });
}
