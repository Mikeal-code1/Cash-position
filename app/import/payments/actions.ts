"use server";

import { supabaseServer } from "@/lib/supabaseServer";
import { parsePaymentRequests, resolveAccountLabel } from "@/lib/parsePaymentRequests";
import { matchRequestsForAccount } from "@/lib/matcher";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

async function failImport(sb: any, filename: string, fileSize: number, message: string) {
  try {
    await sb.from("import_runs").insert({
      kind: "payment_request",
      original_filename: filename,
      file_size_bytes: fileSize,
      outcome: "failed",
      error_message: message,
    });
  } catch { /* never block user on logging failure */ }
  redirect("/import/payments?error=" + encodeURIComponent(message));
}

export async function importPaymentRequests(formData: FormData) {
  const file = formData.get("file") as File | null;
  const filename = file?.name || "(no file)";
  const fileSize = file?.size || 0;
  const sb = supabaseServer();

  if (!file || file.size === 0) {
    await failImport(sb, filename, fileSize, "Please choose a file to upload.");
  }

  const buf = Buffer.from(await file!.arrayBuffer());
  let parsed;
  try { parsed = parsePaymentRequests(buf); }
  catch (e: any) { await failImport(sb, filename, fileSize, e.message || "Failed to parse the file."); return; }
  if (!parsed.requests.length) {
    await failImport(sb, filename, fileSize, "No payment request rows found in this file.");
  }

  const { data: accountsRaw } = await sb
    .from("accounts").select("id, label, currency").eq("cadence", "weekly").eq("is_active", true);
  const accountByLabel = new Map<string, any>(
    (accountsRaw || []).map((a: any) => [String(a.label).toLowerCase(), a]),
  );

  const insertRows: any[] = [];
  const unmappedCodes = new Set<string>();
  const affectedAccountIds = new Set<string>();

  for (const r of parsed!.requests) {
    const label = resolveAccountLabel(r.companyCode);
    const acct = label ? accountByLabel.get(label.toLowerCase()) : null;
    if (!acct) { unmappedCodes.add(r.companyCode); continue; }
    insertRows.push({
      account_id: acct.id,
      request_date: r.date,
      description: r.description,
      amount: r.amount,
      currency: acct.currency,
      bank: r.bank ?? null,
      beneficiary: r.beneficiary ?? null,
      status: "pending",
    });
    affectedAccountIds.add(acct.id);
  }

  if (!insertRows.length) {
    await failImport(sb, filename, fileSize,
      "No rows matched any active accounts. Codes seen: " + Array.from(unmappedCodes).join(", "));
  }

  const { data: inserted, error } = await sb
    .from("payment_requests")
    .upsert(insertRows, {
      onConflict: "account_id,request_date,amount,description",
      ignoreDuplicates: true,
    })
    .select("id");
  if (error) {
    await failImport(sb, filename, fileSize, "Insert failed: " + error.message);
  }

  let totalMatched = 0;
  for (const accountId of affectedAccountIds) {
    const r = await matchRequestsForAccount(sb, accountId);
    totalMatched += r.matched;
  }

  const insertedCount = inserted?.length ?? 0;
  const dupedCount = insertRows.length - insertedCount;
  const unmappedStr = unmappedCodes.size ? Array.from(unmappedCodes).join(", ") : null;

  // Audit log
  await sb.from("import_runs").insert({
    kind: "payment_request",
    original_filename: filename,
    file_size_bytes: fileSize,
    pr_inserted: insertedCount,
    pr_duplicates: dupedCount,
    pr_matched: totalMatched,
    pr_unmapped_codes: unmappedStr,
    outcome: unmappedStr ? "partial" : "success",
    notes: parsed!.requests.length
      ? `Processed ${parsed!.requests.length} rows from the file.`
      : null,
  });

  revalidatePath("/");
  const params = new URLSearchParams({
    pr_inserted: String(insertedCount),
    pr_duped: String(dupedCount),
    pr_matched: String(totalMatched),
  });
  if (unmappedStr) params.set("pr_unmapped", unmappedStr);
  redirect("/?" + params.toString());
}
