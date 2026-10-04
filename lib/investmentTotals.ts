// investmentTotals.ts — current value of investments for the Overview totals.
//
// Money market: identical loading and calculation to the Investments page
// (settings, placements, rate revisions → computePlacement). Only ACTIVE
// placements count: matured/recalled money is back in the bank (already in
// cash), and future-dated placements haven't left the bank yet.
// Current value = principal + interest accrued to date (gross, before WHT) —
// the same "current book value" shown on the Investments page.
//
// Mutual funds: estimated value today (units still held × implied price);
// withdrawn units are excluded because that cash is back in the bank.

import type { SupabaseClient } from "@supabase/supabase-js";
import { computePlacement, type InvestSettings, type Placement } from "@/lib/investEngine";
import { summarise as fundSummary, type FundRate, type FundWithdrawal } from "@/lib/fundEngine";

export interface InvestmentTotals {
  asOf: string;
  moneyMarket: { byCurrency: { currency: string; value: number; count: number }[] } | null;
  funds: { name: string; currency: string; value: number }[] | null;
  notes: string[];
}

export async function loadInvestmentTotals(sb: SupabaseClient, asOf: string): Promise<InvestmentTotals> {
  const notes: string[] = [];
  let moneyMarket: InvestmentTotals["moneyMarket"] = null;
  let funds: InvestmentTotals["funds"] = null;

  // ---- Money market ----
  try {
    const { data: settingsRow, error: setErr } = await sb.from("investment_settings").select("*").eq("id", 1).maybeSingle();
    const { data: placementsRaw, error: plErr } = await sb.from("placements").select("*").order("start_date");
    const { data: revisionsRaw } = await sb.from("placement_revisions").select("*").order("effective_date");
    if (setErr || plErr) {
      notes.push("Money-market data unavailable");
    } else {
      const settings: InvestSettings = {
        ngnRate: Number(settingsRow?.ngn_rate ?? 0.18),
        usdRate: Number(settingsRow?.usd_rate ?? 0.07),
        ngnWht: Number(settingsRow?.ngn_wht ?? 0.10),
        usdWht: Number(settingsRow?.usd_wht ?? 0),
        penalty: Number(settingsRow?.penalty ?? 0),
      };
      const revs: Record<string, { effectiveDate: string; annualRate: number }[]> = {};
      (revisionsRaw || []).forEach((rv: any) => {
        (revs[rv.placement_id] ||= []).push({ effectiveDate: rv.effective_date, annualRate: Number(rv.annual_rate) });
      });
      const placements: Placement[] = (placementsRaw || []).map((p: any) => ({
        id: p.id, entity: p.entity, currency: p.currency,
        startDate: p.start_date, principal: Number(p.principal),
        tenorMonths: Number(p.tenor_months),
        rateOverride: p.rate_override != null ? Number(p.rate_override) : null,
        recallDate: p.recall_date,
        revisions: revs[p.id] || [],
      }));
      const byCcy = new Map<string, { value: number; count: number }>();
      placements.map((p) => computePlacement(p, settings, asOf))
        .filter((r) => r.status === "active")
        .forEach((r) => {
          const c = r.placement.currency;
          const cur = byCcy.get(c) || { value: 0, count: 0 };
          cur.value += r.currentValue; cur.count += 1;
          byCcy.set(c, cur);
        });
      moneyMarket = { byCurrency: Array.from(byCcy.entries()).map(([currency, v]) => ({ currency, ...v })) };
    }
  } catch { notes.push("Money-market data unavailable"); }

  // ---- Mutual funds ----
  try {
    const { data: hs, error: hErr } = await sb.from("fund_holdings").select("*").order("created_at");
    if (hErr) {
      notes.push("Mutual fund data unavailable");
    } else {
      const ids = (hs || []).map((h: any) => h.id);
      const [{ data: rr }, { data: ww }] = ids.length
        ? await Promise.all([
            sb.from("fund_rates").select("holding_id, effective_date, annual_rate").in("holding_id", ids),
            sb.from("fund_withdrawals").select("holding_id, withdrawal_date, units").in("holding_id", ids),
          ])
        : [{ data: [] as any[] }, { data: [] as any[] }];
      funds = (hs || []).map((h: any) => {
        const rates: FundRate[] = (rr || []).filter((r: any) => r.holding_id === h.id)
          .map((r: any) => ({ effectiveDate: r.effective_date, annualRate: Number(r.annual_rate) }));
        const wds: FundWithdrawal[] = (ww || []).filter((w: any) => w.holding_id === h.id)
          .map((w: any) => ({ date: w.withdrawal_date, units: Number(w.units) }));
        const s = fundSummary({ startDate: h.start_date, startValue: Number(h.start_value), startUnits: Number(h.start_units) }, rates, wds, asOf);
        return { name: h.name as string, currency: (h.currency || "NGN") as string, value: asOf < h.start_date ? 0 : s.value };
      });
    }
  } catch { notes.push("Mutual fund data unavailable"); }

  return { asOf, moneyMarket, funds, notes };
}
