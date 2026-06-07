// matcher.ts — conservatively pair pending payment requests with bank transactions.
//
// Match rule (per account):
//   - Same account
//   - Direction = outflow, status = confirmed
//   - Amount equal to the kobo (≤ 0.005 NGN apart)
//   - txn_date in [request_date, request_date + 21 days]
//   - The transaction is not already matched to another request
//   - Exactly one such candidate (zero or multiple → leave pending for review)

import type { SupabaseClient } from "@supabase/supabase-js";

const MATCH_WINDOW_DAYS = 21;

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function matchRequestsForAccount(sb: SupabaseClient, accountId: string): Promise<{
  matched: number;
  remainingPending: number;
}> {
  const { data: pending } = await sb
    .from("payment_requests")
    .select("id, request_date, amount")
    .eq("account_id", accountId)
    .eq("status", "pending");
  const pendings = pending || [];
  if (!pendings.length) return { matched: 0, remainingPending: 0 };

  // Already-used txn ids (don't double-match)
  const { data: matchedRows } = await sb
    .from("payment_requests")
    .select("matched_txn_id")
    .eq("account_id", accountId)
    .eq("status", "matched")
    .not("matched_txn_id", "is", null);
  const used = new Set<string>((matchedRows || []).map((r: any) => r.matched_txn_id));

  const { data: txns } = await sb
    .from("transactions")
    .select("id, txn_date, amount")
    .eq("account_id", accountId)
    .eq("direction", "outflow")
    .eq("status", "confirmed");
  const candidates = (txns || []).filter((t: any) => !used.has(t.id));

  let matchedCount = 0;
  for (const req of pendings) {
    const reqAmount = Number(req.amount);
    const windowEnd = addDays(req.request_date, MATCH_WINDOW_DAYS);

    const matches = candidates.filter((t: any) => {
      if (Math.abs(Number(t.amount) - reqAmount) > 0.005) return false;
      return t.txn_date >= req.request_date && t.txn_date <= windowEnd;
    });

    if (matches.length === 1) {
      const m = matches[0];
      const { error } = await sb
        .from("payment_requests")
        .update({ status: "matched", matched_txn_id: m.id })
        .eq("id", req.id);
      if (!error) {
        matchedCount++;
        used.add(m.id);
        const idx = candidates.indexOf(m);
        if (idx >= 0) candidates.splice(idx, 1);
      }
    }
  }

  const remainingPending = pendings.length - matchedCount;
  return { matched: matchedCount, remainingPending };
}

// Called before a re-import wipes transactions for an account+period:
// any payment_request that points at a soon-to-be-deleted txn is reverted to pending.
export async function unmatchTransactionsForAccountPeriod(
  sb: SupabaseClient,
  accountId: string,
  periodId: string,
) {
  const { data: existingTxns } = await sb
    .from("transactions")
    .select("id")
    .eq("account_id", accountId)
    .eq("period_id", periodId);
  const ids = (existingTxns || []).map((t: any) => t.id);
  if (!ids.length) return;
  await sb
    .from("payment_requests")
    .update({ status: "pending", matched_txn_id: null })
    .in("matched_txn_id", ids);
}
