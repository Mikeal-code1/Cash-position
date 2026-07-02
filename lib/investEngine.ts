// investEngine.ts — money-market placement mathematics, replicating the
// Investment_Schedule model's conventions exactly:
//
//   monthlyRate = annualRate / 12
//   growth(m)   = (1 + r)^floor(m) × (1 + r × frac(m))     — compound whole
//                 months, simple interest on the fractional month
//   elapsed     = actualDays(start → asOf) / 30, capped at tenor
//   WHT applied to interest (10% NGN, 0% USD by default)
//   Optional recall date: placement liquidates early at value held-to-date,
//   less a penalty % of accrued interest forfeited.

export interface Placement {
  id: string;
  entity: string;
  currency: string;         // NGN | USD
  startDate: string;        // YYYY-MM-DD
  principal: number;        // full currency units
  tenorMonths: number;      // may be fractional
  rateOverride: number | null; // annual, e.g. 0.18; null = use scenario rate
  recallDate: string | null;
}

export interface InvestSettings {
  ngnRate: number;   // annual
  usdRate: number;
  ngnWht: number;    // e.g. 0.10
  usdWht: number;
  penalty: number;   // % of accrued interest forfeited on early recall
}

export type PlacementStatus = "pending" | "active" | "matured";

export interface PlacementResult {
  placement: Placement;
  rateUsed: number;
  monthlyRate: number;
  maturityDate: string;      // start + tenor months (30-day convention)
  liquidationDate: string;   // recall date if earlier, else maturity
  status: PlacementStatus;
  // Projected to liquidation:
  heldMonths: number;
  realisedValue: number;
  realisedInterest: number;
  wht: number;
  netInterest: number;
  netProceeds: number;
  netRoi: number;
  penaltyForfeited: number;
  // Year-to-date (as-of):
  elapsedMonths: number;
  accruedGross: number;
  accruedNet: number;
  currentValue: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const DAY_MS = 86400000;

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
}

export function addMonths30(startIso: string, months: number): string {
  const d = new Date(startIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + Math.round(months * 30));
  return d.toISOString().slice(0, 10);
}

// growth factor for m months at monthly rate r: compound whole, simple fraction
export function growth(m: number, r: number): number {
  if (m <= 0) return 1;
  const whole = Math.floor(m);
  const frac = m - whole;
  return Math.pow(1 + r, whole) * (1 + r * frac);
}

function rateFor(p: Placement, s: InvestSettings): number {
  if (p.rateOverride != null) return p.rateOverride;
  return p.currency === "USD" ? s.usdRate : s.ngnRate;
}
function whtFor(p: Placement, s: InvestSettings): number {
  return p.currency === "USD" ? s.usdWht : s.ngnWht;
}

export function computePlacement(p: Placement, s: InvestSettings, asOf: string): PlacementResult {
  const annual = rateFor(p, s);
  const r = annual / 12;
  const whtRate = whtFor(p, s);

  const maturityDate = addMonths30(p.startDate, p.tenorMonths);
  const recalled = !!(p.recallDate && p.recallDate < maturityDate);
  const liquidationDate = recalled ? p.recallDate! : maturityDate;

  // Held to liquidation (months, 30-day convention), capped at tenor
  const heldMonths = Math.min(
    Math.max(daysBetween(p.startDate, liquidationDate), 0) / 30,
    p.tenorMonths,
  );

  const realisedValue = p.principal * growth(heldMonths, r);
  let realisedInterest = realisedValue - p.principal;
  let penaltyForfeited = 0;
  if (recalled && s.penalty > 0) {
    penaltyForfeited = realisedInterest * s.penalty;
    realisedInterest -= penaltyForfeited;
  }
  const wht = realisedInterest * whtRate;
  const netInterest = realisedInterest - wht;
  const netProceeds = p.principal + netInterest;
  const netRoi = p.principal > 0 ? netInterest / p.principal : 0;

  // YTD as-of
  const elapsedMonths = Math.min(
    Math.max(daysBetween(p.startDate, asOf), 0) / 30,
    heldMonths, // never accrue past liquidation
  );
  const accruedGross = p.principal * (growth(elapsedMonths, r) - 1);
  const accruedNet = accruedGross * (1 - whtRate);
  const currentValue = p.principal + accruedGross;

  const status: PlacementStatus =
    p.startDate > asOf ? "pending" : liquidationDate <= asOf ? "matured" : "active";

  return {
    placement: p,
    rateUsed: annual,
    monthlyRate: r,
    maturityDate,
    liquidationDate,
    status,
    heldMonths: round2(heldMonths),
    realisedValue: round2(realisedValue),
    realisedInterest: round2(realisedInterest),
    wht: round2(wht),
    netInterest: round2(netInterest),
    netProceeds: round2(netProceeds),
    netRoi,
    penaltyForfeited: round2(penaltyForfeited),
    elapsedMonths: round2(elapsedMonths),
    accruedGross: round2(accruedGross),
    accruedNet: round2(accruedNet),
    currentValue: round2(currentValue),
  };
}

// Mark-to-date value of a placement at an arbitrary date (for the timeline chart).
// 0 before start; carried flat at realised value after liquidation.
export function valueAt(p: Placement, s: InvestSettings, date: string): number {
  if (date < p.startDate) return 0;
  const res = computePlacement(p, s, date);
  if (date >= res.liquidationDate) return res.realisedValue;
  const r = rateFor(p, s) / 12;
  const m = Math.min(daysBetween(p.startDate, date) / 30, p.tenorMonths);
  return round2(p.principal * growth(m, r));
}

export interface PortfolioSummary {
  currency: string;
  invested: number;
  projMaturity: number;
  grossInterest: number;
  wht: number;
  netInterest: number;
  netProceeds: number;
  blendedNetRoi: number;
  accruedGross: number;
  accruedNet: number;
  currentBook: number;
  returnToDate: number;
  counts: { pending: number; active: number; matured: number };
}

export function summarise(results: PlacementResult[], currency: string): PortfolioSummary {
  const rs = results.filter((r) => r.placement.currency === currency);
  const sum = (f: (r: PlacementResult) => number) => rs.reduce((s, r) => s + f(r), 0);
  const invested = sum((r) => r.placement.principal);
  const grossInterest = sum((r) => r.realisedInterest + r.penaltyForfeited);
  const netInterest = sum((r) => r.netInterest);
  const accruedGross = sum((r) => r.accruedGross);
  return {
    currency,
    invested: round2(invested),
    projMaturity: round2(sum((r) => r.realisedValue)),
    grossInterest: round2(grossInterest),
    wht: round2(sum((r) => r.wht)),
    netInterest: round2(netInterest),
    netProceeds: round2(sum((r) => r.netProceeds)),
    blendedNetRoi: invested > 0 ? netInterest / invested : 0,
    accruedGross: round2(accruedGross),
    accruedNet: round2(sum((r) => r.accruedNet)),
    currentBook: round2(invested + accruedGross),
    returnToDate: invested > 0 ? accruedGross / invested : 0,
    counts: {
      pending: rs.filter((r) => r.status === "pending").length,
      active: rs.filter((r) => r.status === "active").length,
      matured: rs.filter((r) => r.status === "matured").length,
    },
  };
}

// Month-end series for the performance chart: portfolio book value and
// cumulative principal deployed, per month-end.
export function monthlySeries(
  placements: Placement[], s: InvestSettings, currency: string,
): { label: string; date: string; bookValue: number; deployed: number }[] {
  const ps = placements.filter((p) => p.currency === currency);
  if (!ps.length) return [];
  const starts = ps.map((p) => p.startDate).sort();
  const ends = ps.map((p) => addMonths30(p.startDate, p.tenorMonths)).sort();
  const first = new Date(starts[0] + "T00:00:00Z");
  const last = new Date(ends[ends.length - 1] + "T00:00:00Z");
  last.setUTCMonth(last.getUTCMonth() + 1); // one month past final maturity

  const out: { label: string; date: string; bookValue: number; deployed: number }[] = [];
  const cur = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
  while (cur <= last) {
    // month-end = first day of next month minus one day
    const me = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0));
    const iso = me.toISOString().slice(0, 10);
    const bookValue = round2(ps.reduce((sum, p) => sum + valueAt(p, s, iso), 0));
    const deployed = round2(
      ps.filter((p) => p.startDate <= iso).reduce((sum, p) => sum + p.principal, 0),
    );
    out.push({
      label: me.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }),
      date: iso,
      bookValue,
      deployed,
    });
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}
