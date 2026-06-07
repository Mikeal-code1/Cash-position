"use server";

import { supabaseServer } from "@/lib/supabaseServer";
import { revalidatePath } from "next/cache";

// Insert a single transaction. Manual entries are trusted, so status = confirmed
// (extraction will later insert as pending_review for the review step instead).
export async function addTransaction(formData: FormData) {
  const accountId = String(formData.get("account_id") || "");
  const txnDate = String(formData.get("txn_date") || "");
  const description = String(formData.get("description") || "");
  const amount = Number(formData.get("amount") || 0);
  const direction = String(formData.get("direction") || "outflow") as "inflow" | "outflow";

  if (!accountId || !txnDate || amount <= 0) return;

  const sb = supabaseServer();
  const { data: acct } = await sb
    .from("accounts")
    .select("currency, cadence")
    .eq("id", accountId)
    .single();
  if (!acct) return;

  const { data: period } = await sb
    .from("periods")
    .select("id")
    .eq("cadence", acct.cadence)
    .order("start_date", { ascending: false })
    .limit(1)
    .single();
  if (!period) return;

  await sb.from("transactions").insert({
    account_id: accountId,
    period_id: period.id,
    txn_date: txnDate,
    description,
    amount,
    currency: acct.currency,
    direction,
    status: "confirmed",
  });

  revalidatePath("/");
}

// Insert an inter-company transfer (NGN weekly board).
export async function addTransfer(formData: FormData) {
  const fromId = String(formData.get("from_account_id") || "");
  const toId = String(formData.get("to_account_id") || "");
  const description = String(formData.get("description") || "");
  const amount = Number(formData.get("amount") || 0);

  if (!fromId || !toId || fromId === toId || amount <= 0) return;

  const sb = supabaseServer();
  const { data: period } = await sb
    .from("periods")
    .select("id")
    .eq("cadence", "weekly")
    .order("start_date", { ascending: false })
    .limit(1)
    .single();
  if (!period) return;

  await sb.from("transfers").insert({
    period_id: period.id,
    from_account_id: fromId,
    to_account_id: toId,
    description,
    amount,
  });

  revalidatePath("/");
}
