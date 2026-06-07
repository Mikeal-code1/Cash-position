"use server";

import { supabaseServer } from "@/lib/supabaseServer";
import { parsePaymentRequests, resolveAccountLabel } from "@/lib/parsePaymentRequests";
import { matchRequestsForAccount } from "@/lib/matcher";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function importPaymentRequests(formData: FormData) {
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) {
    redirect("/import/payments?error=" + encodeURIComponent("Please choose a file to upload."));
  }

  const buf = Buffer.from(await file.arrayBuffer());
  let parsed;
  try {
    parsed = parsePaymentRequests(buf);
  } catch (e: any) {
    redirect("/import/payments?error=" + encodeURIComponent(e.message || "Failed to parse the file."));
  }
  if (!parsed.requests.length) {
    redirect("/import/payments?error=" + encodeURIComponent("No payment request rows found in this file."));
  }

  const sb = supabaseServer();

  // Map company codes to NGN accounts (cadence=weekly).
  const { data: accountsRaw } = await sb
    .from("accounts")
    .select("id, label, currency")
    .eq("cadence", "weekly")
    .eq("is_active", true);
  const accountByLabel = new Map<string, any>(
    (accountsRaw || []).map((a: any) => [String(a.label).toLowerCase(), a]),
  );

  const insertRows: any[] = [];
  const unmappedCodes = new Set<string>();
  const affectedAccountIds = new Set<string>();

  for (const r of parsed.requests) {
    const label = resolveAccountLabel(r.companyCode);
    const acct = label ? accountByLabel.get(label.toLowerCase()) : null;
    if (!acct) {
      unmappedCodes.add(r.companyCode);
      continue;
    }
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
    redirect(
      "/import/payments?error=" +
        encodeURIComponent(
          "No rows matched any active accounts. Codes seen: " + Array.from(unmappedCodes).join(", "),
        ),
    );
  }

  // Idempotent insert: ON CONFLICT (account_id, request_date, amount, description) DO NOTHING.
  const { data: inserted, error } = await sb
    .from("payment_requests")
    .upsert(insertRows, {
      onConflict: "account_id,request_date,amount,description",
      ignoreDuplicates: true,
    })
    .select("id");
  if (error) {
    redirect("/import/payments?error=" + encodeURIComponent("Insert failed: " + error.message));
  }

  // Auto-match each affected account against existing bank transactions.
  let totalMatched = 0;
  for (const accountId of affectedAccountIds) {
    const r = await matchRequestsForAccount(sb, accountId);
    totalMatched += r.matched;
  }

  const insertedCount = inserted?.length ?? 0;
  const dupedCount = insertRows.length - insertedCount;

  revalidatePath("/");
  const params = new URLSearchParams({
    pr_inserted: String(insertedCount),
    pr_duped: String(dupedCount),
    pr_matched: String(totalMatched),
  });
  if (unmappedCodes.size) params.set("pr_unmapped", Array.from(unmappedCodes).join(","));
  redirect("/?" + params.toString());
}
