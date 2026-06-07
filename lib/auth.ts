// auth.ts — minimal password gate. The session cookie holds a hash of the
// app password, never the password itself. Works in both edge middleware and
// node route handlers via the Web Crypto API.

export const SESSION_COOKIE = "cp_session";

export async function sessionToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`cash-position::${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
