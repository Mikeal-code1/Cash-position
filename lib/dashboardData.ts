// dashboardData.ts — one loader for every dashboard tab (Overview, NGN board,
// Foreign, Liquidity), so all views compute from the same numbers.
//
// The calculation logic is unchanged from the previous single-page dashboard:
// NGN = the selected weekly period (optionally sliced by a date range);
// Foreign = each account's latest statement (or a pinned monthly period).

import { supabaseServer } from "@/lib/supabaseServer";
import {
  computePeriod, computeAccountPeriod,
  type Transaction, type Transfer, type AccountPeriodResult, type DateRange,
} from "@/lib/cashEngine";
import { fetchUsdRates, toUsd } from "@/lib/fxRates";

export type Account = {
  id: string; company: string; label: string; currency: string;
  cadence: "weekly" | "monthly"; account_no?: string | null;
};
export type Period = { id: string; label: string; start_date: string; end_date: string };

export type Source = "statement" | "manual" | "carried";

export interface NgnAccountRow {
  account: Account; result: AccountPeriodResult;
  net: number; source: Source; sourceNote: string;
}
export interface EntityGroup {
  key: string; name: string; rows: NgnAccountRow[];
  opening: number; net: number; closing: number;
  statementCount: number; otherCount: number;
}
export interface LiquidityRow {
  name: string; closing: number; pending: number; projected: number;
  pendingCount: number; flagged: number;
}
export interface FxRow { account: Account; result: AccountPeriodResult; periodLabel: string; }
export interface CcyAgg {
  currency: string; count: number;
  opening: number; inflows: number; outflows: number; closing: number;
  usd: { opening: number; inflows: number; outflows: number; closing: number } | null;
}

// Friendly entity names (falls back to the stored company name).
const ENTITY_NAME: Record<string, string> = {
  "HBO Personal": "HBO Personal",
  Metis: "Metis Capital Partners",
  Duval: "Duval Properties",
  Harvard: "Harvard Investments",
  "Nimbel Shaw": "Nimbel Shaw",
  "Vernon Quest": "Vernon Quest Oil & Gas",
  Porterbell: "Porterbell Nigeria Investment",
};
export const ENTITY_SHORT: Record<string, string> = {
  "HBO Personal": "HBO", Metis: "Metis", Duval: "Duval", Harvard: "Harvard",
  "Nimbel Shaw": "Nimbel", "Vernon Quest": "Vernon", Porterbell: "Porterbell",
};

export type DashParams = {
  wk?: string; mo?: string; wkFrom?: string; wkTo?: string; moFrom?: string; moTo?: string;
};

export async function loadDashboard(sp: DashParams) {
  const errors: string[] = [];
  let sb;
  try { sb = supabaseServer(); } catch (e: any) {
    return { fatal: e.message as string } as const;
  }

  const { data: accountsRaw, error: accErr } = await sb
    .from("accounts").select("*").eq("is_active", true).order("cadence").order("label");
  if (accErr) errors.push(`accounts: ${accErr.message}`);
  const accounts = (accountsRaw || []) as Account[];
  if (!accErr && accounts.length === 0) {
    errors.push("Connected, but found 0 accounts. Likely causes: wrong project URL, anon key instead of service_role, or seed.sql didn't run.");
  }

  const { data: wkPeriods, error: wkErr } = await sb
    .from("periods").select("id, label, start_date, end_date").eq("cadence", "weekly")
    .order("end_date", { ascending: false }).order("start_date", { ascending: false });
  if (wkErr) errors.push(`periods (weekly): ${wkErr.message}`);
  const { data: moPeriods } = await sb
    .from("periods").select("id, label, start_date, end_date").eq("cadence", "monthly")
    .order("end_date", { ascending: false }).order("start_date", { ascending: false });

  const weeklyList = (wkPeriods || []) as Period[];
  const monthlyList = (moPeriods || []) as Period[];
  const wkId = sp.wk || weeklyList[0]?.id;
  const wkPeriod = weeklyList.find((p) => p.id === wkId);
  const moParam = sp.mo && sp.mo !== "latest" ? sp.mo : null;
  const moPinned = moParam ? monthlyList.find((p) => p.id === moParam) : undefined;

  const periodIds = [wkId, ...monthlyList.map((p) => p.id)].filter(Boolean) as string[];
  const { data: balancesRaw } = await sb.from("balances").select("account_id, period_id, opening").in("period_id", periodIds);
  const { data: txnsRaw } = await sb.from("transactions")
    .select("account_id, period_id, amount, direction, is_transfer, txn_date").eq("status", "confirmed").in("period_id", periodIds);
  const { data: transfersRaw } = await sb.from("transfers")
    .select("from_account_id, to_account_id, amount, period_id, transfer_date").in("period_id", periodIds);

  const openingsFor = (pid?: string): Record<string, number> => {
    const m: Record<string, number> = {};
    (balancesRaw || []).filter((b: any) => b.period_id === pid).forEach((b: any) => { m[b.account_id] = Number(b.opening); });
    return m;
  };
  const txnsFor = (pid?: string): Transaction[] =>
    (txnsRaw || []).filter((t: any) => t.period_id === pid).map((t: any) => ({
      accountId: t.account_id, amount: Number(t.amount), direction: t.direction,
      isTransfer: t.is_transfer, date: t.txn_date }));
  const transfersFor = (pid?: string): Transfer[] =>
    (transfersRaw || []).filter((t: any) => t.period_id === pid).map((t: any) => ({
      fromAccountId: t.from_account_id, toAccountId: t.to_account_id,
      amount: Number(t.amount), date: t.transfer_date }));

  const ngnAccounts = accounts.filter((a) => a.cadence === "weekly");
  const fxAccounts = accounts.filter((a) => a.cadence === "monthly");

  // ---------- NGN ----------
  const wkRange: DateRange = { from: sp.wkFrom, to: sp.wkTo };
  const ngnResults = computePeriod(openingsFor(wkId), txnsFor(wkId), transfersFor(wkId), wkRange);

  // Source of each NGN balance this week: statement import, manual entry, or carried forward.
  const stmtAccts = new Set<string>();
  const manualNote: Record<string, string> = {};
  let runsOk = false;
  if (wkId) {
    try {
      const { data: runs, error: runErr } = await sb.from("import_runs")
        .select("account_id, kind, outcome, statement_end, created_at")
        .eq("period_id", wkId).order("created_at", { ascending: false });
      if (!runErr) {
        runsOk = true;
        (runs || []).forEach((r: any) => {
          if (!r.account_id) return;
          if (r.kind === "bank_statement" && r.outcome === "success") stmtAccts.add(r.account_id);
          if (r.kind === "manual_balance" && !manualNote[r.account_id]) {
            manualNote[r.account_id] = `as at ${r.statement_end || String(r.created_at).slice(0, 10)}`;
          }
        });
      }
    } catch { /* audit table not available */ }
  }
  const acctsWithTxns = new Set((txnsRaw || []).filter((t: any) => t.period_id === wkId).map((t: any) => t.account_id));

  const groupsMap = new Map<string, EntityGroup>();
  for (const a of ngnAccounts) {
    const r = ngnResults.find((x) => x.accountId === a.id);
    if (!r) continue; // account has no balance row in this period
    let source: Source = "carried", sourceNote = "Carried forward";
    if (stmtAccts.has(a.id) || (!runsOk && acctsWithTxns.has(a.id))) { source = "statement"; sourceNote = "Statement"; }
    else if (manualNote[a.id]) { source = "manual"; sourceNote = `Manual · ${manualNote[a.id]}`; }
    const row: NgnAccountRow = { account: a, result: r, net: r.closing - r.opening, source, sourceNote };
    const key = a.company;
    if (!groupsMap.has(key)) {
      groupsMap.set(key, { key, name: ENTITY_NAME[key] ?? key, rows: [], opening: 0, net: 0, closing: 0, statementCount: 0, otherCount: 0 });
    }
    const g = groupsMap.get(key)!;
    g.rows.push(row);
    g.opening += r.opening; g.closing += r.closing; g.net += row.net;
    if (source === "statement") g.statementCount++; else g.otherCount++;
  }
  const groups = Array.from(groupsMap.values()).sort((x, y) => y.closing - x.closing);
  groups.forEach((g) => g.rows.sort((x, y) => y.result.closing - x.result.closing));
  const ngnTotals = {
    opening: groups.reduce((s, g) => s + g.opening, 0),
    inflows: ngnResults.reduce((s, r) => s + r.inflows, 0),
    outflows: ngnResults.reduce((s, r) => s + r.outflows, 0),
    closing: groups.reduce((s, g) => s + g.closing, 0),
    accounts: groups.reduce((s, g) => s + g.rows.length, 0),
  };
  const nonStatementClosing = groups.reduce((s, g) => s + g.rows.filter((r) => r.source !== "statement").reduce((t, r) => t + r.result.closing, 0), 0);
  const nonStatementCount = groups.reduce((s, g) => s + g.otherCount, 0);
  const nilCount = groups.reduce((s, g) => s + g.rows.filter((r) => Math.abs(r.result.closing) < 0.005).length, 0);

  // ---------- Liquidity (payment requests) ----------
  const latestWeeklyEnd = weeklyList.length ? weeklyList[0].end_date : null;
  const { data: prRaw } = ngnAccounts.length
    ? await sb.from("payment_requests").select("account_id, request_date, amount, status").in("account_id", ngnAccounts.map((a) => a.id))
    : { data: [] as any[] };
  const pendingByAcct = new Map<string, { amount: number; count: number; flagged: number }>();
  (prRaw || []).forEach((p: any) => {
    if (p.status !== "pending") return;
    const cur = pendingByAcct.get(p.account_id) || { amount: 0, count: 0, flagged: 0 };
    cur.amount += Number(p.amount); cur.count += 1;
    if (latestWeeklyEnd && p.request_date <= latestWeeklyEnd) cur.flagged += 1;
    pendingByAcct.set(p.account_id, cur);
  });
  const liquidity: LiquidityRow[] = groups.map((g) => {
    let pending = 0, count = 0, flagged = 0;
    g.rows.forEach((r) => { const p = pendingByAcct.get(r.account.id); if (p) { pending += p.amount; count += p.count; flagged += p.flagged; } });
    return { name: g.name, closing: g.closing, pending, projected: g.closing - pending, pendingCount: count, flagged };
  });
  const liqTotals = {
    pending: liquidity.reduce((s, l) => s + l.pending, 0),
    projected: liquidity.reduce((s, l) => s + l.projected, 0),
    flagged: liquidity.reduce((s, l) => s + l.flagged, 0),
    shortfalls: liquidity.filter((l) => l.projected < 0).length,
  };

  // ---------- Foreign ----------
  const moRange: DateRange = { from: sp.moFrom, to: sp.moTo };
  const fxRows: FxRow[] = [];
  if (moPinned) {
    const res = computePeriod(openingsFor(moPinned.id), txnsFor(moPinned.id), [], moRange);
    fxAccounts.forEach((a) => {
      const r = res.find((x) => x.accountId === a.id);
      if (r) fxRows.push({ account: a, result: r, periodLabel: moPinned.label });
    });
  } else {
    const txnP = new Map<string, Set<string>>(), balP = new Map<string, Set<string>>();
    (txnsRaw || []).forEach((t: any) => { if (!txnP.has(t.account_id)) txnP.set(t.account_id, new Set()); txnP.get(t.account_id)!.add(t.period_id); });
    (balancesRaw || []).forEach((b: any) => { if (!balP.has(b.account_id)) balP.set(b.account_id, new Set()); balP.get(b.account_id)!.add(b.period_id); });
    const pick = (id: string): Period | undefined => {
      const w = txnP.get(id); if (w) { const p = monthlyList.find((p) => w.has(p.id)); if (p) return p; }
      const b = balP.get(id); if (b) return monthlyList.find((p) => b.has(p.id));
      return undefined;
    };
    fxAccounts.forEach((a) => {
      const p = pick(a.id);
      if (!p) return;
      const opening = openingsFor(p.id)[a.id] ?? 0;
      const r = computeAccountPeriod(a.id, opening, txnsFor(p.id).filter((t) => t.accountId === a.id), [], moRange);
      fxRows.push({ account: a, result: r, periodLabel: p.label });
    });
  }

  // ---------- FX rates & USD conversion ----------
  const usdRates = await fetchUsdRates();
  const conv = (n: number, c: string) => (usdRates ? toUsd(n, c, usdRates.rates) : null);
  const fxOrder = ["USD", "AED", "GBP", "EUR"];
  const fxCcys = Array.from(new Set(fxRows.map((r) => r.account.currency)))
    .sort((a, b) => (fxOrder.indexOf(a) + 99) % 99 - (fxOrder.indexOf(b) + 99) % 99);
  let fxUsdMissing = false;
  const ccyAgg: CcyAgg[] = fxCcys.map((c) => {
    const rs = fxRows.filter((r) => r.account.currency === c);
    const sum = (f: (r: AccountPeriodResult) => number) => rs.reduce((s, r) => s + f(r.result), 0);
    const opening = sum((r) => r.opening), closing = sum((r) => r.closing);
    const inflows = sum((r) => r.inflows + r.transferIn), outflows = sum((r) => r.outflows + r.transferOut);
    const uo = conv(opening, c), ui = conv(inflows, c), ux = conv(outflows, c), uc = conv(closing, c);
    const usd = uo === null || ui === null || ux === null || uc === null ? null : { opening: uo, inflows: ui, outflows: ux, closing: uc };
    if (!usd) fxUsdMissing = true;
    return { currency: c, count: rs.length, opening, inflows, outflows, closing, usd };
  });
  const fxUsd = fxUsdMissing ? null : {
    opening: ccyAgg.reduce((s, c) => s + c.usd!.opening, 0),
    inflows: ccyAgg.reduce((s, c) => s + c.usd!.inflows, 0),
    outflows: ccyAgg.reduce((s, c) => s + c.usd!.outflows, 0),
    closing: ccyAgg.reduce((s, c) => s + c.usd!.closing, 0),
  };
  const ngnUsdOpening = conv(ngnTotals.opening, "NGN");
  const ngnUsdClosing = conv(ngnTotals.closing, "NGN");
  const groupUsd = fxUsd && ngnUsdOpening !== null && ngnUsdClosing !== null
    ? { opening: ngnUsdOpening + fxUsd.opening, closing: ngnUsdClosing + fxUsd.closing, ngnClosing: ngnUsdClosing }
    : null;
  const rates = usdRates
    ? { asOf: usdRates.asOf, list: ["NGN", "AED", "GBP", "EUR"].filter((c) => usdRates.rates[c]).map((c) => ({ currency: c, perUsd: usdRates.rates[c] })) }
    : null;

  return {
    fatal: null,
    errors, accounts, weeklyList, monthlyList, wkId, wkPeriod, moParam, moPinned,
    groups, ngnTotals, nonStatementClosing, nonStatementCount, nilCount,
    liquidity, liqTotals, latestWeeklyEnd,
    fxRows, ccyAgg, fxUsd, groupUsd, rates,
  } as const;
}
