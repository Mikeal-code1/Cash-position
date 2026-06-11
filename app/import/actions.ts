"use server";

import { supabaseServer } from "@/lib/supabaseServer";
import { parseStatement } from "@/lib/parseStatement";
import { parsePdfStatement } from "@/lib/parsePdfStatement";
import { matchRequestsForAccount, unmatchTransactionsForAccountPeriod } from "@/lib/matcher";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDay(iso: string) { const [, m, d] = iso.split("-"); return `${parseInt(d, 10)} ${MONTHS[parseInt(m, 10) - 1]}`; }
function periodLabel(start: string, end: string) { return `${fmtDay(start)} – ${fmtDay(end)} ${end.slice(0, 4)}`; }

// Log a failed import to the audit table, then redirect.
async function failImport(sb: any, filename: string, fileSize: number, message: string, accountId?: string) {
  try {
    await sb.from("import_runs").insert({
      kind: "bank_statement",
      original_filename: filename,
      file_size_bytes: fileSize,
      account_id: accountId || null,
      outcome: "failed",
      error_message: message,
    });
  } catch { /* never block the user on logging failure */ }
  redirect("/import?error=" + encodeURIComponent(message));
}

export async function importStatement(formData: FormData) {
  const accountId = String(formData.get("account_id") || "");
  const file = formData.get("file") as File | null;

  const filename = file?.name || "(no file)";
  const fileSize = file?.size || 0;
  const sb = supabaseServer();

  if (!accountId || !file || file.size === 0) {
    await failImport(sb, filename, fileSize, "Please select an account and a file.", accountId);
  }

  // Look up the account first (needed for the currency guard below)
  const { data: acct } = await sb
    .from("accounts").select("id, cadence, currency, label").eq("id", accountId).single();
  if (!acct) await failImport(sb, filename, fileSize, "Account not found.", accountId);

  // Parse the statement — Excel or PDF, by file extension.
  const buf = Buffer.from(await file!.arrayBuffer());
  const isPdf = /\.pdf$/i.test(filename) || (buf.length > 4 && buf.subarray(0, 4).toString() === "%PDF");
  let parsed;
  try { parsed = isPdf ? await parsePdfStatement(buf) : parseStatement(buf); }
  catch (e: any) {
    await failImport(sb, filename, fileSize, e.message || "Failed to parse the statement.", accountId);
    return;
  }
  if (!parsed.startDate || !parsed.endDate) {
    await failImport(sb, filename, fileSize, "Statement is missing its start/end dates.", accountId);
  }
  if (!parsed.reconciled) {
    await failImport(sb, filename, fileSize,
      `Statement did not reconcile: opening + credits − debits = ${parsed.derivedClosing}, but stated closing = ${parsed.closingBalance}.`,
      accountId);
  }
  // Currency guard: a GBP statement must not be imported into a USD account.
  if (parsed.currency && acct!.currency && parsed.currency.toUpperCase() !== acct!.currency.toUpperCase()) {
    await failImport(sb, filename, fileSize,
      `Currency mismatch: the statement is in ${parsed.currency.toUpperCase()} but the selected account (${acct!.label}) is ${acct!.currency.toUpperCase()}. Pick the matching account and re-upload.`,
      accountId);
  }

  // Find or create the period
  const { data: existing } = await sb
    .from("periods").select("id").eq("cadence", acct!.cadence)
    .eq("start_date", parsed.startDate).eq("end_date", parsed.endDate).maybeSingle();

  let periodId: string;
  let createdNewPeriod = false;
  if (existing) {
    periodId = existing.id;
  } else {
    createdNewPeriod = true;
    const { data: priorPeriod } = await sb
      .from("periods").select("id").eq("cadence", acct!.cadence)
      .lt("start_date", parsed.startDate)
      .order("start_date", { ascending: false }).limit(1).maybeSingle();

    const { data: newPeriod } = await sb
      .from("periods").insert({
        cadence: acct!.cadence, start_date: parsed.startDate, end_date: parsed.endDate,
        label: periodLabel(parsed.startDate, parsed.endDate),
      }).select("id").single();
    periodId = newPeriod!.id;

    const { data: activeAccts } = await sb
      .from("accounts").select("id").eq("cadence", acct!.cadence).eq("is_active", true);

    const carry: Record<string, number> = {};
    if (priorPeriod) {
      const { data: pb } = await sb.from("balances")
        .select("account_id, opening").eq("period_id", priorPeriod.id);
      (pb || []).forEach((b: any) => { carry[b.account_id] = Number(b.opening); });
    }
    const seedRows = (activeAccts || []).map((a: any) => ({
      account_id: a.id, period_id: periodId, opening: carry[a.id] ?? 0,
    }));
    if (seedRows.length) await sb.from("balances").insert(seedRows);
  }

  // Upsert this account's opening to bank-true value
  await sb.from("balances").upsert(
    { account_id: accountId, period_id: periodId, opening: parsed.openingBalance },
    { onConflict: "account_id,period_id" },
  );

  // Count txns being replaced (for the audit note)
  const { count: priorCount } = await sb
    .from("transactions").select("id", { count: "exact", head: true })
    .eq("account_id", accountId).eq("period_id", periodId);

  // Idempotent replacement: unmatch payment_requests, delete txns, re-insert.
  await unmatchTransactionsForAccountPeriod(sb, accountId, periodId);
  await sb.from("transactions").delete().eq("account_id", accountId).eq("period_id", periodId);

  if (parsed.transactions.length) {
    const rows = parsed.transactions.map((t) => ({
      account_id: accountId, period_id: periodId,
      txn_date: t.date, description: t.description,
      amount: t.amount, currency: acct!.currency,
      direction: t.direction, status: "confirmed", is_transfer: false,
    }));
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const { error } = await sb.from("transactions").insert(slice);
      if (error) {
        await failImport(sb, filename, fileSize, "Insert failed: " + error.message, accountId);
      }
    }
  }

  // Auto-match pending payment requests
  await matchRequestsForAccount(sb, accountId);

  // Audit log
  const notes = createdNewPeriod
    ? `Created new period ${periodLabel(parsed.startDate, parsed.endDate)}.`
    : (priorCount && priorCount > 0 ? `Replaced ${priorCount} existing transactions for ${acct!.label}.` : null);
  await sb.from("import_runs").insert({
    kind: "bank_statement",
    original_filename: filename,
    file_size_bytes: fileSize,
    account_id: accountId,
    period_id: periodId,
    statement_start: parsed.startDate,
    statement_end: parsed.endDate,
    opening_balance: parsed.openingBalance,
    closing_balance: parsed.closingBalance,
    txn_count: parsed.transactions.length,
    outcome: "success",
    notes,
  });

  revalidatePath("/");
  const periodParam = acct!.cadence === "weekly" ? "wk" : "mo";
  redirect(
    `/?${periodParam}=${periodId}&imported=${encodeURIComponent(acct!.label)}&count=${parsed.transactions.length}${
      createdNewPeriod ? "&new=1" : ""
    }`,
  );
}
