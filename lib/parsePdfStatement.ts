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
  const accountNumber = (text.match(/Account N(?:o|umber)\s*(\d+)/) || [])[1] || "";
  const customerName = (text.match(/Account Name([A-Z .'-]+)/) || [])[1]?.trim() || "";

  // The date is matched with a 4-digit year so it still separates from the amount when
  // newer FSDH exports print them with no space ("as at 10/1/202618,631.99").
  const openM = text.match(/Opening Balance as at \d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d+(?=\s))?\s*([\d,]*\.\d{2})/);
  const closeM = text.match(/Closing Balance as at \d{1,2}\/\d{1,2}\/\d{4}\s*([\d,]*\.\d{2})/);
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
      if (/^(Customer Statement|Account N|Account Name|Account Currency|Address|Mailing Address|S\/N|Opening Balance|Closing Balance|Available Balance|Blocked Balance|PND|Dormancy|OD Limit|Last Transaction|\d+$)/.test(line)) {
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


// ---------- FSDH "STATEMENT OF ACCOUNT" (corporate layout, from Oct 2026) ----------
// Header table: CUSTOMER NAME, START/END DATE (01-OCT-2026), ACCOUNT NUMBER,
// OPENING/CLOSING BALANCE, CURRENCY. Rows: TXN DATE · VAL DATE · REMARKS ·
// DEBIT · CREDIT · BALANCE, with the amount and balance glued together
// ("FUNDING30,000.00279,711.44"). Each transaction is taken from the change in
// running balance, so a row the PDF repeats across a page break (same balance
// twice) shows zero movement and is skipped rather than double-counted.
function isoFromDMonY2(d: string, mon: string, y: string): string | null {
  const mm = MONTHS[mon[0].toUpperCase() + mon.slice(1, 3).toLowerCase()];
  return mm ? `${y}-${mm}-${d.padStart(2, "0")}` : null;
}
function parseFSDHv2(text: string): ParsedStatement {
  const DATE = /(\d{1,2})-\s*([A-Za-z]{3})-?\s*(\d{4})/;
  const sd = text.match(new RegExp("START\\s*DATE\\s*" + DATE.source));
  const ed = text.match(new RegExp("END\\s*DATE\\s*" + DATE.source));
  if (!sd || !ed) throw new Error("FSDH statement: couldn't find the start/end dates.");
  const startDate = isoFromDMonY2(sd[1], sd[2], sd[3])!;
  const endDate = isoFromDMonY2(ed[1], ed[2], ed[3])!;
  const openM = text.match(/OPENING\s*BALANCE\s*(-?[\d,]*\.\d{2})/);
  const closeM = text.match(/CLOSING\s*BALANCE\s*(-?[\d,]*\.\d{2})/);
  if (!openM || !closeM) throw new Error("FSDH statement: couldn't find opening/closing balances.");
  const openingBalance = num(openM[1]);
  const closingBalance = num(closeM[1]);
  const currency = (text.match(/CURRENCY\s*([A-Z]{3})/) || [])[1] || "";
  const accountNumber = (text.match(/ACCOUNT\s*NUMBER\s*(\d+)/) || [])[1] || "";
  const customerName = ((text.match(/CUSTOMER\s*NAME\s*([^\n]+)/) || [])[1] || "").trim();

  const hdr = text.indexOf("REMARKS");
  const bal = hdr >= 0 ? text.indexOf("BALANCE", hdr) : -1;
  const end = text.indexOf("TOTAL DEBIT", bal);
  if (bal < 0) throw new Error("FSDH statement: couldn't find the transaction table.");
  const body = text.slice(bal + "BALANCE".length, end > 0 ? end : undefined);

  // A row ends with: amount immediately followed by balance (each exactly 2 dp).
  const PAIR = /((?:\d{1,3}(?:,\d{3})*)?\.\d{2})(-?(?:\d{1,3}(?:,\d{3})*)?\.\d{2})\s*$/;
  const DATE_G = new RegExp(DATE.source, "g");
  const transactions: ParsedTxn[] = [];
  let prevBal = openingBalance, lastBal = openingBalance;
  let buf: string[] = [];
  let curDate: string | null = null;
  for (const raw of body.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const m = line.match(PAIR);
    if (!m) { buf.push(line); continue; }
    const chunk = [...buf, line.slice(0, m.index)].join("\n");
    let dm: RegExpExecArray | null; DATE_G.lastIndex = 0;
    while ((dm = DATE_G.exec(chunk))) curDate = isoFromDMonY2(dm[1], dm[2], dm[3]) ?? curDate;
    const balance = num(m[2]);
    const delta = round2(balance - prevBal);
    if (Math.abs(delta) >= 0.005 && curDate) {
      const description = chunk.replace(DATE_G, " ")
        .replace(/(^|\s)(\d{1,2}-\s*)?[A-Za-z]{3}-\s*(?=\s|$)/g, " ")  // partial dates left by page breaks
        .replace(/\s+/g, " ").trim();
      transactions.push({ date: curDate, description, direction: delta > 0 ? "inflow" : "outflow", amount: Math.abs(delta) });
      prevBal = balance;
    }
    lastBal = balance;
    buf = [];
  }

  const derivedClosing = round2(lastBal);
  return {
    customerName, currency, accountNumber, startDate, endDate,
    openingBalance, closingBalance, transactions, derivedClosing,
    reconciled: Math.abs(derivedClosing - closingBalance) < 0.01,
  };
}

export async function parsePdfStatement(buf: Buffer): Promise<ParsedStatement> {
  const { text } = await pdfParse(buf);
  if (/Customer Statement of Account/i.test(text)) return parseFSDH(text);
  if (/ACCOUNT STATEMENT/i.test(text) && /IBAN AE/i.test(text)) return parseFAB(text);
  if (/STATEMENT OF ACCOUNT/.test(text) && /OPENING\s*BALANCE/.test(text) && /REMARKS/.test(text)) return parseFSDHv2(text);
  throw new Error(
    "Unrecognised PDF statement layout. Supported formats: FSDH Merchant Bank (\"Customer Statement of Account\" and \"Statement of Account\") and FAB (First Abu Dhabi Bank).",
  );
}
