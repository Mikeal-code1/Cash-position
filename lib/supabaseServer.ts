// supabaseServer.ts — server-only Supabase client.
// Uses the SERVICE ROLE key, which must NEVER be sent to the browser.
// Only ever imported from server components, route handlers and server actions.

import { createClient } from "@supabase/supabase-js";

export function supabaseServer() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
