// fundEngine.ts — value-only mutual fund tracking.
//
// Value grows at the advised annual rate, compounded as (1 + r)^(days / 365)
// (the rate is an effective annual return). A new advised rate applies from
// its effective date onward. Units are carried so withdrawals can be made by
// number of units: implied unit price = start price × growth factor, and a
// withdrawal of N units on date d pays N × price(d). All values after the start
// are estimates accrued at the advised rate, not market valuations.

export interface FundHolding { startDate: string; startValue: number; startUnits: number; }
export interface FundRate { effectiveDate: string; annualRate: number; }   // decimal, e.g. 0.1025
export interface FundWithdrawal { date: string; units: number; }

const DAY = 86400000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function sortRates(rates: FundRate[]): FundRate[] {
  return [...rates].sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : 1));
}

// Growth factor from the start date to `to`.
export function growthFactor(h: FundHolding, rates: FundRate[], to: string): number {
  if (to <= h.startDate || rates.length === 0) return 1;
  const rs = sortRates(rates);
  let f = 1;
  for (let i = 0; i < rs.length; i++) {
    const a = rs[i].effectiveDate < h.startDate ? h.startDate : rs[i].effectiveDate;
    let b = i + 1 < rs.length ? rs[i + 1].effectiveDate : to;
    if (b > to) b = to;
    if (a >= to) break;
    const n = days(a, b);
    if (n > 0) f *= Math.pow(1 + rs[i].annualRate, n / 365);
  }
  return f;
}

export function priceAt(h: FundHolding, rates: FundRate[], d: string): number {
  return (h.startValue / h.startUnits) * growthFactor(h, rates, d);
}

export function unitsAt(h: FundHolding, wds: FundWithdrawal[], d: string): number {
  const u = wds.reduce((s, w) => (w.date <= d ? s - w.units : s), h.startUnits);
  return Math.max(Math.round(u * 10000) / 10000, 0);
}

export function valueAt(h: FundHolding, rates: FundRate[], wds: FundWithdrawal[], d: string): number {
  return unitsAt(h, wds, d) * priceAt(h, rates, d);
}

export function rateOn(rates: FundRate[], d: string): FundRate | undefined {
  const rs = sortRates(rates).filter((r) => r.effectiveDate <= d);
  return rs[rs.length - 1] ?? sortRates(rates)[0];
}

// Units that can be withdrawn on date d without overdrawing any later withdrawal.
export function withdrawableOn(h: FundHolding, wds: FundWithdrawal[], d: string): number {
  const later = wds.filter((w) => w.date > d).reduce((s, w) => s + w.units, 0);
  return Math.max(Math.round((unitsAt(h, wds, d) - later) * 10000) / 10000, 0);
}

export interface FundSummary {
  value: number; units: number; price: number;
  withdrawn: number; withdrawals: number;
  gain: number; returnPct: number; currentRate: FundRate | undefined;
}

export function summarise(h: FundHolding, rates: FundRate[], wds: FundWithdrawal[], asOf: string): FundSummary {
  const past = wds.filter((w) => w.date <= asOf);
  const withdrawn = past.reduce((s, w) => s + w.units * priceAt(h, rates, w.date), 0);
  const value = valueAt(h, rates, wds, asOf);
  const gain = value + withdrawn - h.startValue;
  return {
    value: round2(value), units: unitsAt(h, wds, asOf), price: round2(priceAt(h, rates, asOf)),
    withdrawn: round2(withdrawn), withdrawals: past.length,
    gain: round2(gain), returnPct: gain / h.startValue, currentRate: rateOn(rates, asOf),
  };
}

// Chart points: start, each month-end to the projection end, plus as-of.
export function series(h: FundHolding, rates: FundRate[], wds: FundWithdrawal[], asOf: string, projectTo: string) {
  const dates = new Set<string>([h.startDate, asOf]);
  const cur = new Date(h.startDate + "T00:00:00Z");
  cur.setUTCDate(1);
  for (let i = 0; i < 60; i++) {
    const me = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    if (me > projectTo) break;
    if (me > h.startDate) dates.add(me);
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return Array.from(dates).sort().map((d) => ({ date: d, value: round2(valueAt(h, rates, wds, d)), projected: d > asOf }));
}
