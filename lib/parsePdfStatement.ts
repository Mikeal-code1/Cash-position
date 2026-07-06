// parsePdfStatement.ts — deterministic parser for PDF bank statements.
//
// Supports two validated layouts:
//   FSDH Merchant Bank ("Customer Statement of Account"): S/N table with
//     Booking/Value dates (M/D/YY) and Debit/Credit/Balance columns.
//   FAB First Abu Dhabi Bank ("ACCOUNT STATEMENT" + IBAN AE): DATE/DESCRIPTION
//     table with DD-MMM-YYYY dates.
//
// Extraction strategy: pdf text comes out with amounts glued together, so we
// anchor on the RUNNING BALANCE column. Each transaction's amount and
// direction are derived from the balance delta, then the final balance is
// checked against the bank's stated closing — a full self-validation.
//
// Returns the same shape as parseStatement (xlsx) so the importer can treat
// both identically.

// pdf-parse's package entry runs debug code when imported by bundlers, so we
// import the library file directly.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

import type { ParsedStatement, ParsedTxn } from "./parseStatement";

const NUM = /(?:\d[\d,]*)?\.\d{2}/g;
const num = (s: string) => parseFloat(s.replace(/,/g, ""));
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function isoFromMDY(s: string): string | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let y = m[3];
  if (y.length === 2) y = "20" + y;
  return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}
function isoFromDMonY(s: string): string | null {
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const mm = MONTHS[m[2][0].toUpperCase() + m[2].slice(1, 3).toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
}

// ---------- FSDH ----------
function parseFSDH(text: string): ParsedStatement {
  // The To date can carry a stray trailing marker (e.g. "To: 6/1/2026 2"),
  // which some FSDH exports glue directly onto the closing balance
  // ("6/1/2026 239,687.67"). Capture that marker so we can strip it.
  const range = text.match(/From:\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*To:\s*(\d{1,2}\/\d{1,2}\/\d{4})(?:\s+(\d+))?/);
  if (!range) throw new Error("FSDH statement: couldn't find the From/To date range.");
  const startDate = isoFromMDY(range[1])!;
  const endDate = isoFromMDY(range[2])!;
  const endMarker = range[3] || "";
  const currency = (text.match(/Account Currency([A-Z]{3})/) || [])[1] || "";
  const accountNumber = (text.match(/Account No(\d+)/) || [])[1] || "";
  const customerName = (text.match(/Account Name([A-Z .'-]+)/) || [])[1]?.trim() || "";

  const openM = text.match(/Opening Balance as at [\d/]+(?:\s+\d+)?\s+([\d,]*\.\d{2})/);
  const closeM = text.match(/Closing Balance as at [\d/]+\s+([\d,]*\.\d{2})/);
  if (!openM || !closeM) throw new Error("FSDH statement: couldn't find opening/closing balances.");
  const openingBalance = num(openM[1]);

  // Strip the stray marker if it's glued to the front of the closing balance.
  let closeStr = closeM[1].replace(/,/g, "");
  if (endMarker && closeStr.startsWith(endMarker) && closeStr.length > endMarker.length + 3) {
    const stripped = closeStr.slice(endMarker.length);
    if (/^\d+\.\d{2}$/.test(stripped)) closeStr = stripped;
  }
  const closingBalance = parseFloat(closeStr);

  // Tail of each txn: BookingDate + ValueDate + glued Debit/Credit/Balance.
  const tailRe = /(\d{1,2}\/\d{1,2}\/\d{2})(\d{1,2}\/\d{1,2}\/\d{2})((?:(?:\d[\d,]*)?\.\d{2}|0)+)$/;
  const lines = text.split("\n");
  const transactions: ParsedTxn[] = [];
  let desc: string[] = [];
  let prevBal = openingBalance;
  let lastBal = openingBalance;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(tailRe);
    if (m) {
      desc.push(line.slice(0, m.index));
      const amounts = m[3].match(NUM) || [];
      if (!amounts.length) { desc = []; continue; }
      const balance = num(amounts[amounts.length - 1]);
      const delta = round2(balance - prevBal);
      const description = desc.join(" ")
        .replace(/^\d{8}[0-9a-z]+\s*/i, "")   // strip glued AcEntrySrNo+TrnRef
        .replace(/\s+/g, " ").trim();
      transactions.push({
        date: isoFromMDY(m[1])!,
        description,
        direction: delta >= 0 ? "inflow" : "outflow",
        amount: Math.abs(delta),
      });
      prevBal = balance;
      lastBal = balance;
      desc = [];
    } else {
      if (/^(Customer Statement|Account No|Account Name|Account Currency|Address|S\/N|Opening Balance|Closing Balance|Available Balance|Blocked Balance|PND|Dormancy|OD Limit|Last Transaction|\d+$)/.test(line)) {
        desc = [];
        continue;
      }
      desc.push(line);
    }
  }

  const derivedClosing = round2(lastBal);
  return {
    customerName, currency, accountNumber, startDate, endDate,
    openingBalance, closingBalance, transactions,
    derivedClosing,
    reconciled: Math.abs(derivedClosing - closingBalance) < 0.01,
  };
}

// ---------- FAB ----------
function parseFAB(text: string): ParsedStatement {
  const range = text.match(/(\d{2}-[A-Za-z]{3}-\d{4})\s*To Date\s*:\s*(\d{2}-[A-Za-z]{3}-\d{4})/);
  if (!range) throw new Error("FAB statement: couldn't find the From/To date range.");
  const startDate = isoFromDMonY(range[1])!;
  const endDate = isoFromDMonY(range[2])!;
  const currency = (text.match(/:\s*([A-Z]{3})\s*\n/) || [])[1] || "";
  if (!currency) {
    throw new Error("FAB statement: couldn't detect the account currency from the header.");
  }
  const accountNumber = (text.match(/Account Number\s*(\d+)/) || [])[1] || "";

  const lines = text.split("\n");
  let opening: number | null = null;
  let closing: number | null = null;
  const transactions: ParsedTxn[] = [];
  let prevBal: number | null = null;
  let lastBal: number | null = null;
  let pendingBalance: number | null = null;
  let desc: string[] = [];
  let dateFound: string | null = null;

  const flush = () => {
    if (pendingBalance != null && dateFound && prevBal != null) {
      const delta = round2(pendingBalance - prevBal);
      transactions.push({
        date: dateFound,
        description: desc.join(" ").replace(/\s+/g, " ").trim(),
        direction: delta >= 0 ? "inflow" : "outflow",
        amount: Math.abs(delta),
      });
      prevBal = pendingBalance;
      lastBal = pendingBalance;
    }
    pendingBalance = null;
    desc = [];
    dateFound = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/^Opening Balance$/.test(line)) continue;
    if (/^Closing Statement Balance/.test(line)) {
      flush();
      const m = (line + " " + (lines[i + 1] || "")).match(NUM);
      if (m) closing = num(m[0]);
      break;
    }
    const onlyNums = line.match(/^((?:(?:\d[\d,]*)?\.\d{2})+)$/);
    if (onlyNums) {
      const amounts = (line.match(NUM) || []).map(num);
      if (opening === null && amounts.length === 1) {
        opening = amounts[0];
        prevBal = opening;
        lastBal = opening;
        continue;
      }
      flush();
      pendingBalance = amounts[0];
      continue;
    }
    const dm = line.match(/^(\d{2}-[A-Za-z]{3}-\d{4})(.*)$/);
    if (dm) {
      if (!dateFound) dateFound = isoFromDMonY(dm[1]);
      if (dm[2].trim()) desc.push(dm[2].trim());
      continue;
    }
    if (pendingBalance != null) desc.push(line);
  }
  flush();

  if (opening === null) throw new Error("FAB statement: couldn't find the opening balance.");
  if (closing === null) throw new Error("FAB statement: couldn't find the closing balance.");

  const derivedClosing = round2(lastBal ?? opening);
  return {
    customerName: "", currency, accountNumber, startDate, endDate,
    openingBalance: opening, closingBalance: closing, transactions,
    derivedClosing,
    reconciled: Math.abs(derivedClosing - closing) < 0.01,
  };
}

export async function parsePdfStatement(buf: Buffer): Promise<ParsedStatement> {
  const { text } = await pdfParse(buf);
  if (/Customer Statement of Account/i.test(text)) return parseFSDH(text);
  if (/ACCOUNT STATEMENT/i.test(text) && /IBAN AE/i.test(text)) return parseFAB(text);
  throw new Error(
    "Unrecognised PDF statement layout. Supported formats: FSDH Merchant Bank and FAB (First Abu Dhabi Bank).",
  );
}
