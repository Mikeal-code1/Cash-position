// cashEngine.ts — the validated cash position logic.
// Closing = Opening + Inflows + Transfer In − Transfer Out − Outflows

export type Direction = "inflow" | "outflow";

export interface Transaction {
  accountId: string;
  amount: number;
  direction: Direction;
  isTransfer: boolean;
}

export interface Transfer {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
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

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = (xs: number[]): number => xs.reduce((s, x) => s + x, 0);

export function computeAccountPeriod(
  accountId: string,
  opening: number,
  transactions: Transaction[],
  transfers: Transfer[],
): AccountPeriodResult {
  const own = transactions.filter((t) => t.accountId === accountId && !t.isTransfer);
  const inflows = sum(own.filter((t) => t.direction === "inflow").map((t) => t.amount));
  const outflows = sum(own.filter((t) => t.direction === "outflow").map((t) => t.amount));
  const transferIn = sum(transfers.filter((t) => t.toAccountId === accountId).map((t) => t.amount));
  const transferOut = sum(transfers.filter((t) => t.fromAccountId === accountId).map((t) => t.amount));
  const netFlows = inflows + transferIn - transferOut;
  const closing = opening + netFlows - outflows;
  return {
    accountId,
    opening: round2(opening),
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
): AccountPeriodResult[] {
  return Object.keys(openings).map((accountId) =>
    computeAccountPeriod(accountId, openings[accountId], transactions, transfers),
  );
}

export function rollForward(results: AccountPeriodResult[]): Record<string, number> {
  return Object.fromEntries(results.map((r) => [r.accountId, r.closing]));
}
