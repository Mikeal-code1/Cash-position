// format.ts — shared number formatting for the dashboard UI.

export const SYM: Record<string, string> = { NGN: "₦", USD: "$", GBP: "£", AED: "AED ", EUR: "€" };

export function f2(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function money(n: number, currency: string): string {
  return (SYM[currency] ?? currency + " ") + f2(n);
}

// Compact: ₦3.20b, $1.44m, $128.6k
export function compact(n: number, currency: string): string {
  const sym = SYM[currency] ?? currency + " ";
  const a = Math.abs(n);
  const sg = n < 0 ? "−" : "";
  if (a >= 1e9) return `${sg}${sym}${(a / 1e9).toFixed(2)}b`;
  if (a >= 1e6) return `${sg}${sym}${(a / 1e6).toFixed(2)}m`;
  if (a >= 1e3) return `${sg}${sym}${(a / 1e3).toFixed(1)}k`;
  return `${sg}${sym}${a.toFixed(0)}`;
}

export function signedCompact(n: number, currency: string): string {
  return (n > 0 ? "+" : "") + compact(n, currency);
}

// Signed full amount; "—" for zero movement.
export function signedMoney(n: number, currency: string): string {
  if (Math.abs(n) < 0.005) return "—";
  return (n > 0 ? "+" : "−") + (SYM[currency] ?? currency + " ") + f2(Math.abs(n));
}

export function moveClass(n: number): string {
  if (Math.abs(n) < 0.005) return "mv-flat";
  return n > 0 ? "mv-up" : "mv-down";
}

export const pct = (x: number, dp = 1) => (x * 100).toFixed(dp) + "%";
