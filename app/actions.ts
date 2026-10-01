"use server";

import { supabaseServer } from "@/lib/supabaseServer";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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

  revalidatePath("/", "layout");
  redirect("/record?ok=transaction#transaction");
}

// Insert an inter-company transfer (NGN weekly board).
export async function addTransfer(formData: FormData) {
  const fromId = String(formData.get("from_account_id") || "");
  const toId = String(formData.get("to_account_id") || "");
  const transferDate = String(formData.get("transfer_date") || "");
  const description = String(formData.get("description") || "");
  const amount = Number(formData.get("amount") || 0);

  if (!fromId || !toId || fromId === toId || amount <= 0 || !transferDate) return;

  const sb = supabaseServer();

  // Prefer the weekly period that contains the chosen date; fall back to the
  // most recent weekly period if the date falls outside every known window.
  const { data: containing } = await sb
    .from("periods")
    .select("id")
    .eq("cadence", "weekly")
    .lte("start_date", transferDate)
    .gte("end_date", transferDate)
    .maybeSingle();

  let periodId = containing?.id;
  if (!periodId) {
    const { data: latest } = await sb
      .from("periods")
      .select("id")
      .eq("cadence", "weekly")
      .order("end_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    periodId = latest?.id;
  }
  if (!periodId) return;

  await sb.from("transfers").insert({
    period_id: periodId,
    from_account_id: fromId,
    to_account_id: toId,
    transfer_date: transferDate,
    description,
    amount,
  });

  revalidatePath("/", "layout");
  redirect("/record?ok=transfer#transfer");
}

// --- Manual balance update (temporary fix for accounts without statements) ---
// Sets an NGN account's balance for a weekly period. Refuses where the account
// already has imported statement transactions in that period, so bank
// statements remain the source of truth. Every update is logged to History.
export async function updateBalance(formData: FormData) {
  const accountId = String(formData.get("account_id") || "");
  const periodIdIn = String(formData.get("period_id") || "");
  const asAt = String(formData.get("as_at") || "");
  const raw = String(formData.get("balance") ?? "").replace(/,/g, "").trim();
  const balance = Number(raw);
  const back = (msg: string) =>
    redirect(`/record?${periodIdIn ? `wk=${periodIdIn}&` : ""}bal_error=${encodeURIComponent(msg)}#balance`);

  if (!accountId || raw === "" || isNaN(balance)) back("Choose an account and enter a valid balance.");

  const sb = supabaseServer();
  const { data: acct } = await sb
    .from("accounts").select("id, label, cadence").eq("id", accountId).single();
  if (!acct || acct.cadence !== "weekly") back("Manual balance updates apply to NGN accounts only.");

  // Target period: the one being viewed, else the latest weekly period.
  let periodId = periodIdIn;
  if (!periodId) {
    const { data: latest } = await sb.from("periods").select("id").eq("cadence", "weekly")
      .order("end_date", { ascending: false }).order("start_date", { ascending: false })
      .limit(1).maybeSingle();
    periodId = latest?.id || "";
  }
  if (!periodId) back("No NGN weekly period exists yet. Import a statement first.");

  // Protect statement-backed balances.
  const { count } = await sb.from("transactions").select("id", { count: "exact", head: true })
    .eq("account_id", accountId).eq("period_id", periodId);
  if (count && count > 0) {
    back(`${acct!.label} already has ${count} imported statement transactions this week. Import a newer statement instead of overriding it manually.`);
  }

  const { data: prior } = await sb.from("balances").select("opening")
    .eq("account_id", accountId).eq("period_id", periodId).maybeSingle();

  const { error } = await sb.from("balances").upsert(
    { account_id: accountId, period_id: periodId, opening: balance },
    { onConflict: "account_id,period_id" },
  );
  if (error) back("Update failed: " + error.message);

  // Audit trail (never blocks the update if logging isn't available).
  try {
    await sb.from("import_runs").insert({
      kind: "manual_balance",
      original_filename: "(manual entry)",
      account_id: accountId,
      period_id: periodId,
      statement_end: asAt || null,
      opening_balance: prior ? Number(prior.opening) : null,
      closing_balance: balance,
      outcome: "success",
      notes: `Manual balance update${asAt ? ` as at ${asAt}` : ""}.`,
    });
  } catch { /* ignore */ }

  revalidatePath("/", "layout");
  redirect(`/ngn?wk=${periodId}&bal_ok=${encodeURIComponent(acct!.label)}`);
}
