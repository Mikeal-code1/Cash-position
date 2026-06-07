// parseStatement.ts — deterministic parser for the bank statement Excel format.
//
// Layout assumed (validated against four real statements):
//   rows 1–14: header metadata (OPENING BAL, CLOSING BAL, START DATE, END DATE, CURRENCY, ...)
//   row containing "TXN DATE" in column A: column header row
//   rows below: TXN DATE | VAL DATE | REMARKS | DEBIT | CREDIT | BALANCE
//
// DEBIT = outflow, CREDIT = inflow. Verified by reconciling
// opening + Σcredits − Σdebits to the bank's own closing balance, to the kobo.

import * as XLSX from "xlsx";

export interface ParsedTxn {
  date: string;           // YYYY-MM-DD
  description: string;
  direction: "inflow" | "outflow";
  amount: number;
}

export interface ParsedStatement {
  customerName: string;
  currency: string;
  accountNumber: string;
  startDate: string;
  endDate: string;
  openingBalance: number;
  closingBalance: number;
  transactions: ParsedTxn[];
  // Self-check: |derivedClosing − closingBalance| should be < 0.01
  reconciled: boolean;
  derivedClosing: number;
}

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const n = parseFloat(String(v).replace(/,/g, "").trim());
  return isNaN(n) ? null : n;
}

function toIsoDate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    // Use UTC to avoid timezone drift on parsed cells
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, "0");
    const d = String(v.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (m) {
    const key = m[2][0].toUpperCase() + m[2].slice(1, 3).toLowerCase();
    const mm = MONTHS[key];
    if (mm) return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

export function parseStatement(buf: ArrayBuffer | Buffer): ParsedStatement {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true, defval: null });

  // Header metadata from rows 1–14
  const hdr: Record<string, unknown> = {};
  for (let i = 0; i < Math.min(14, rows.length); i++) {
    const k = rows[i]?.[0];
    const v = rows[i]?.[1];
    if (k != null) hdr[String(k).trim().toUpperCase()] = v;
  }

  // Locate transaction header row by scanning column A for "TXN DATE"
  let hdrIdx = -1;
  for (let i = 0; i < Math.min(30, rows.length); i++) {
    const v = rows[i]?.[0];
    if (v != null && String(v).trim().toUpperCase() === "TXN DATE") {
      hdrIdx = i;
      break;
    }
  }
  if (hdrIdx < 0) {
    throw new Error(
      "Could not find a 'TXN DATE' header row. This doesn't look like a recognised bank statement layout.",
    );
  }

  const transactions: ParsedTxn[] = [];
  for (let i = hdrIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r[0] == null) continue;
    const date = toIsoDate(r[0]);
    if (!date) continue;
    const description = String(r[2] ?? "").replace(/\s+/g, " ").trim();
    const debit = toNum(r[3]);
    const credit = toNum(r[4]);
    if (credit && credit > 0) transactions.push({ date, description, direction: "inflow", amount: credit });
    else if (debit && debit > 0) transactions.push({ date, description, direction: "outflow", amount: debit });
  }

  const openingBalance = toNum(hdr["OPENING BAL"]) ?? 0;
  const closingBalance = toNum(hdr["CLOSING BAL"]) ?? 0;
  const totalIn = transactions.filter((t) => t.direction === "inflow").reduce((s, t) => s + t.amount, 0);
  const totalOut = transactions.filter((t) => t.direction === "outflow").reduce((s, t) => s + t.amount, 0);
  const derivedClosing = Math.round((openingBalance + totalIn - totalOut + Number.EPSILON) * 100) / 100;
  const reconciled = Math.abs(derivedClosing - closingBalance) < 0.01;

  const startDate = toIsoDate(hdr["START DATE"]) ?? "";
  const endDate = toIsoDate(hdr["END DATE"]) ?? "";

  return {
    customerName: String(hdr["CUSTOMER NAME"] ?? "").trim(),
    currency: String(hdr["CURRENCY"] ?? "NGN").trim(),
    accountNumber: String(hdr["ACC NO"] ?? "").trim(),
    startDate,
    endDate,
    openingBalance,
    closingBalance,
    transactions,
    reconciled,
    derivedClosing,
  };
}
