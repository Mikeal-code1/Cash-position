"use server";

import { supabaseServer } from "@/lib/supabaseServer";
import { parseStatement } from "@/lib/parseStatement";
import { matchRequestsForAccount, unmatchTransactionsForAccountPeriod } from "@/lib/matcher";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDay(iso: string) {
  const [, m, d] = iso.split("-");
  return `${parseInt(d, 10)} ${MONTHS[parseInt(m, 10) - 1]}`;
}
function periodLabel(start: string, end: string) {
  return `${fmtDay(start)} – ${fmtDay(end)} ${end.slice(0, 4)}`;
}

export async function importStatement(formData: FormData) {
  const accountId = String(formData.get("account_id") || "");
  const file = formData.get("file") as File | null;

  if (!accountId || !file || file.size === 0) {
    redirect("/import?error=" + encodeURIComponent("Please select an account and a file."));
  }

  // Parse the statement
  const buf = Buffer.from(await file.arrayBuffer());
  let parsed;
  try {
    parsed = parseStatement(buf);
  } catch (e: any) {
    redirect("/import?error=" + encodeURIComponent(e.message || "Failed to parse the statement."));
  }
  if (!parsed.startDate || !parsed.endDate) {
    redirect("/import?error=" + encodeURIComponent("Statement is missing START DATE or END DATE in its header."));
  }
  if (!parsed.reconciled) {
    redirect(
      "/import?error=" +
        encodeURIComponent(
          `Statement did not reconcile: opening + credits − debits = ${parsed.derivedClosing}, but stated closing = ${parsed.closingBalance}.`,
        ),
    );
  }

  const sb = supabaseServer();

  // Look up the account (cadence + currency)
  const { data: acct } = await sb
    .from("accounts")
    .select("id, cadence, currency, label")
    .eq("id", accountId)
    .single();
  if (!acct) redirect("/import?error=" + encodeURIComponent("Account not found."));

  // Find or create the period matching the statement's date range.
  const { data: existing } = await sb
    .from("periods")
    .select("id")
    .eq("cadence", acct.cadence)
    .eq("start_date", parsed.startDate)
    .eq("end_date", parsed.endDate)
    .maybeSingle();

  let periodId: string;
  let createdNewPeriod = false;
  if (existing) {
    periodId = existing.id;
  } else {
    createdNewPeriod = true;
    // Carry-forward source: most recent prior period of the same cadence
    const { data: priorPeriod } = await sb
      .from("periods")
      .select("id")
      .eq("cadence", acct.cadence)
      .lt("start_date", parsed.startDate)
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: newPeriod } = await sb
      .from("periods")
      .insert({
        cadence: acct.cadence,
        start_date: parsed.startDate,
        end_date: parsed.endDate,
        label: periodLabel(parsed.startDate, parsed.endDate),
      })
      .select("id")
      .single();
    periodId = newPeriod!.id;

    // Pre-seed balances for ALL active accounts of this cadence, carrying
    // forward each account's opening from the prior period (or 0 if none).
    // The current account's opening is then overwritten with the bank's value below.
    const { data: activeAccts } = await sb
      .from("accounts")
      .select("id")
      .eq("cadence", acct.cadence)
      .eq("is_active", true);

    const carry: Record<string, number> = {};
    if (priorPeriod) {
      const { data: pb } = await sb
        .from("balances")
        .select("account_id, opening")
        .eq("period_id", priorPeriod.id);
      (pb || []).forEach((b: any) => {
        carry[b.account_id] = Number(b.opening);
      });
    }
    const seedRows = (activeAccts || []).map((a: any) => ({
      account_id: a.id,
      period_id: periodId,
      opening: carry[a.id] ?? 0,
    }));
    if (seedRows.length) await sb.from("balances").insert(seedRows);
  }

  // Upsert this account's opening to the statement's bank-true opening.
  await sb
    .from("balances")
    .upsert(
      { account_id: accountId, period_id: periodId, opening: parsed.openingBalance },
      { onConflict: "account_id,period_id" },
    );

  // Replace this account's transactions in this period (idempotent re-import).
  // First, revert any payment requests that point at txns we're about to delete,
  // so they go back to 'pending' and can be re-matched against the new txns.
  await unmatchTransactionsForAccountPeriod(sb, accountId, periodId);
  await sb.from("transactions").delete().eq("account_id", accountId).eq("period_id", periodId);

  if (parsed.transactions.length) {
    const rows = parsed.transactions.map((t) => ({
      account_id: accountId,
      period_id: periodId,
      txn_date: t.date,
      description: t.description,
      amount: t.amount,
      currency: acct.currency,
      direction: t.direction,
      status: "confirmed",
      is_transfer: false,
    }));
    // Chunked insert (Harvard has 211 rows; well within limits).
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const { error } = await sb.from("transactions").insert(slice);
      if (error) {
        redirect("/import?error=" + encodeURIComponent("Insert failed: " + error.message));
      }
    }
  }

  // Auto-match any pending payment requests now that fresh bank txns are in place.
  await matchRequestsForAccount(sb, accountId);

  revalidatePath("/");
  redirect(
    `/?wk=${periodId}&imported=${encodeURIComponent(acct.label)}&count=${parsed.transactions.length}${
      createdNewPeriod ? "&new=1" : ""
    }`,
  );
}
