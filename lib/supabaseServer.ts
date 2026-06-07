// supabaseServer.ts — server-only Supabase client.
// Uses the SERVICE ROLE key, which must NEVER be sent to the browser.

import { createClient } from "@supabase/supabase-js";

// Tolerate common URL mistakes: trailing slashes and a pasted "/rest/v1" suffix.
function normalizeUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/rest\/v1$/i, "")
    .replace(/\/+$/, "");
}

export function supabaseServer() {
  const rawUrl = process.env.SUPABASE_URL || "";
  const url = normalizeUrl(rawUrl);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set both in Vercel → Settings → Environment Variables, then redeploy.",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
