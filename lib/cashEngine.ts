// cashEngine.ts — the validated cash position logic, now date-aware.
//
// Closing = Opening + Inflows + Transfer In − Transfer Out − Outflows
//
// When a DateRange is supplied, the engine computes a SLICE of the period:
//   sliceOpening = periodOpening + flows strictly before `from`
//   inflows/outflows/transfers = those within [from, to]
//   sliceClosing = sliceOpening + netFlows − outflows
//
// Without a range, it computes the full period (backward compatible).

export type Direction = "inflow" | "outflow";

export interface Transaction {
  accountId: string;
  amount: number;
  direction: Direction;
  isTransfer: boolean;
  date?: string;        // YYYY-MM-DD; required for range filtering
}

export interface Transfer {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  date?: string;
}

export interface DateRange {
  from?: string;
  to?: string;
}

export interface AccountPeriodResult {
  accountId: string;
  opening: number;
  inflows: number;
  outflows: number;
  transferIn: number;
  transferOut: number;
  netFlows: number;
  closing: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

export function computeAccountPeriod(
  accountId: string,
  opening: number,
  transactions: Transaction[],
  transfers: Transfer[],
  range?: DateRange,
): AccountPeriodResult {
  const beforeFrom = (d?: string) => !!(range?.from && d && d < range.from);
  const inRange = (d?: string) => {
    if (range?.from && d && d < range.from) return false;
    if (range?.to && d && d > range.to) return false;
    return true; // undated items stay in-range
  };

  const own = transactions.filter((t) => t.accountId === accountId && !t.isTransfer);
  const tIn = transfers.filter((t) => t.toAccountId === accountId);
  const tOut = transfers.filter((t) => t.fromAccountId === accountId);

  // Effective opening = period opening + flows strictly before `from`
  const inflowsBefore = sum(own.filter((t) => t.direction === "inflow" && beforeFrom(t.date)).map((t) => t.amount));
  const outflowsBefore = sum(own.filter((t) => t.direction === "outflow" && beforeFrom(t.date)).map((t) => t.amount));
  const tInBefore = sum(tIn.filter((t) => beforeFrom(t.date)).map((t) => t.amount));
  const tOutBefore = sum(tOut.filter((t) => beforeFrom(t.date)).map((t) => t.amount));
  const effectiveOpening = opening + inflowsBefore + tInBefore - tOutBefore - outflowsBefore;

  const inflows = sum(own.filter((t) => t.direction === "inflow" && inRange(t.date)).map((t) => t.amount));
  const outflows = sum(own.filter((t) => t.direction === "outflow" && inRange(t.date)).map((t) => t.amount));
  const transferIn = sum(tIn.filter((t) => inRange(t.date)).map((t) => t.amount));
  const transferOut = sum(tOut.filter((t) => inRange(t.date)).map((t) => t.amount));
  const netFlows = inflows + transferIn - transferOut;
  const closing = effectiveOpening + netFlows - outflows;

  return {
    accountId,
    opening: round2(effectiveOpening),
    inflows: round2(inflows),
    outflows: round2(outflows),
    transferIn: round2(transferIn),
    transferOut: round2(transferOut),
    netFlows: round2(netFlows),
    closing: round2(closing),
  };
}

export function computePeriod(
  openings: Record<string, number>,
  transactions: Transaction[],
  transfers: Transfer[] = [],
  range?: DateRange,
): AccountPeriodResult[] {
  return Object.keys(openings).map((id) =>
    computeAccountPeriod(id, openings[id], transactions, transfers, range),
  );
}

export function rollForward(results: AccountPeriodResult[]): Record<string, number> {
  return Object.fromEntries(results.map((r) => [r.accountId, r.closing]));
}
