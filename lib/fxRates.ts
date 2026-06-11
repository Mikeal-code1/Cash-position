// fxRates.ts — fetch published USD exchange rates for the consolidated view.
//
// Source: open.er-api.com (free, no key, daily-published rates incl. NGN/GBP/AED).
// Cached for 6 hours via Next's fetch revalidation. On any failure, returns
// null and the consolidated chart is simply not rendered — the dashboard
// never breaks because of the rates feed.
//
// Note: these are indicative market rates and may differ slightly from CBN
// NFEM. The native-currency boards remain the source of truth; the USD view
// is presentational.

export interface UsdRates {
  asOf: string;                    // human-readable rate date
  rates: Record<string, number>;   // currency -> units per 1 USD
}

export async function fetchUsdRates(): Promise<UsdRates | null> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      next: { revalidate: 21600 }, // 6 hours
    });
    if (!res.ok) return null;
    const j = await res.json();
    if (j?.result !== "success" || !j?.rates) return null;
    const asOf = String(j.time_last_update_utc || "").replace(/ \d{2}:\d{2}:\d{2}.*$/, "");
    return { asOf, rates: j.rates };
  } catch {
    return null;
  }
}

export function toUsd(amount: number, currency: string, rates: Record<string, number>): number | null {
  if (currency === "USD") return amount;
  const r = rates[currency];
  if (!r || r <= 0) return null;
  return Math.round((amount / r + Number.EPSILON) * 100) / 100;
}
