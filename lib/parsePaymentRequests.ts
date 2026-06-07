// parsePaymentRequests.ts — deterministic parser for the payment-request
// Excel layout. The file groups rows by company; each transaction row carries
// the company key in the CompanyCode column (col I), which is more reliable
// than relying on section headers.
//
// Columns used:
//   A = Date (D/M/YYYY or Date)
//   B = BANK (destination bank)
//   C = beneficiaryAccountName
//   G = Transaction amount
//   H = narration (description)
//   I = CompanyCode  (Duval | Metis | NS | Havard ...)
//
// Subtotal rows have an amount in G but no CompanyCode in I, so they are
// automatically excluded.

import * as XLSX from "xlsx";

export interface ParsedPaymentRequest {
  date: string;          // YYYY-MM-DD
  description: string;
  amount: number;
  bank?: string;
  beneficiary?: string;
  companyCode: string;   // raw code as written in the file
}

export interface ParsedPaymentRequests {
  requests: ParsedPaymentRequest[];
  byCompany: Record<string, number>;
}

// Map the codes used in the file to our account labels.
const COMPANY_CODE_TO_LABEL: Record<string, string> = {
  duval: "Duval",
  metis: "Metis",
  ns: "Nimbel Shaw",
  "nimbel shaw": "Nimbel Shaw",
  havard: "Harvard",      // the file's spelling
  harvard: "Harvard",
  "vernon quest": "Vernon Quest",
};

export function resolveAccountLabel(companyCode: string): string | null {
  return COMPANY_CODE_TO_LABEL[companyCode.trim().toLowerCase()] ?? null;
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
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, "0");
    const d = String(v.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  // D/M/YYYY or DD/MM/YYYY
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, d, m, y] = slash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // 25-May-2026
  const dash = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (dash) {
    const key = dash[2][0].toUpperCase() + dash[2].slice(1, 3).toLowerCase();
    const mm = MONTHS[key];
    if (mm) return `${dash[3]}-${mm}-${dash[1].padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

export function parsePaymentRequests(buf: ArrayBuffer | Buffer): ParsedPaymentRequests {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true, defval: null });

  const requests: ParsedPaymentRequest[] = [];
  const byCompany: Record<string, number> = {};

  for (const r of rows) {
    if (!r) continue;
    const date = toIsoDate(r[0]);
    const amount = toNum(r[6]);
    const companyCode = r[8] != null ? String(r[8]).trim() : "";

    if (!date || !amount || amount <= 0 || !companyCode) continue;

    // Skip the column-header rows (where col A is the literal string "Date").
    if (String(r[0]).trim().toLowerCase() === "date") continue;

    const description = String(r[7] ?? "").replace(/\s+/g, " ").trim();
    const bank = r[1] != null ? String(r[1]).trim() : undefined;
    const beneficiary = r[2] != null ? String(r[2]).trim() : undefined;

    requests.push({ date, description, amount, bank, beneficiary, companyCode });
    byCompany[companyCode] = (byCompany[companyCode] ?? 0) + amount;
  }

  return { requests, byCompany };
}
