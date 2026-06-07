import { supabaseServer } from "@/lib/supabaseServer";
import { computePeriod, type Transaction, type Transfer, type AccountPeriodResult, type DateRange } from "@/lib/cashEngine";
import { addTransaction, addTransfer } from "./actions";
import { PeriodSelect } from "./PeriodSelect";

export const dynamic = "force-dynamic";

type Account = { id: string; company: string; label: string; currency: string; cadence: "weekly" | "monthly" };
type Period = { id: string; label: string; start_date: string; end_date: string };

function money(n: number, currency: string) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency, minimumFractionDigits: 2 }).format(n);
}
function compact(n: number) {
  const a = Math.abs(n); const s = n < 0 ? "-" : "";
  if (a >= 1e9) return `${s}₦${(a / 1e9).toFixed(1)}b`;
  if (a >= 1e6) return `${s}₦${(a / 1e6).toFixed(1)}m`;
  if (a >= 1e3) return `${s}₦${(a / 1e3).toFixed(0)}k`;
  return `${s}₦${a.toFixed(0)}`;
}
function cell(n: number, currency: string) {
  const cls = n < 0 ? "neg" : n === 0 ? "dim" : "";
  return <td className={cls}>{money(n, currency)}</td>;
}

function DateFilter({
  period, fromParam, toParam, fromVal, toVal, preserve,
}: {
  period?: Period; fromParam: string; toParam: string; fromVal?: string; toVal?: string;
  preserve: Record<string, string | undefined>;
}) {
  if (!period) return null;
  const hasFilter = Boolean(fromVal || toVal);
  return (
    <form className="date-filter" method="get">
      {Object.entries(preserve).map(([k, v]) =>
        v ? <input key={k} type="hidden" name={k} value={v} /> : null,
      )}
      <label>From <input type="date" name={fromParam}
        min={period.start_date} max={period.end_date}
        defaultValue={fromVal || period.start_date} /></label>
      <label>To <input type="date" name={toParam}
        min={period.start_date} max={period.end_date}
        defaultValue={toVal || period.end_date} /></label>
      <button type="submit" className="apply">Apply</button>
      {hasFilter ? (
        <a href={`/?${new URLSearchParams(
          Object.entries(preserve).filter(([, v]) => v) as [string, string][],
        ).toString()}`} className="clear-link">Clear</a>
      ) : null}
    </form>
  );
}

function Board({
  title, periodLabel, periodControl, dateFilter, accounts, results, showTotal, currency, sliceLabel,
}: {
  title: string; periodLabel: string; periodControl: React.ReactNode; dateFilter: React.ReactNode;
  accounts: Account[]; results: AccountPeriodResult[]; showTotal: boolean; currency?: string;
  sliceLabel?: string;
}) {
  const byId = (id: string) => results.find((r) => r.accountId === id);
  const total = (k: keyof AccountPeriodResult) => results.reduce((s, r) => s + (r[k] as number), 0);
  return (
    <>
      <div className="board-head">
        <div className="board-head-left">
          <div className="eyebrow">{title} · {periodLabel}</div>
          {sliceLabel ? <div className="slice-label">Showing {sliceLabel}</div> : null}
        </div>
        {periodControl}
      </div>
      {dateFilter}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Account</th><th>Opening</th><th>Inflows</th>
              <th>Outflows</th><th>Net transfers</th><th>Closing</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr><td colSpan={6} className="dim">No accounts for this board.</td></tr>
            ) : accounts.map((a) => {
              const r = byId(a.id); if (!r) return null;
              return (
                <tr key={a.id}>
                  <td>{a.label}</td>
                  {cell(r.opening, a.currency)}
                  {cell(r.inflows, a.currency)}
                  {cell(r.outflows, a.currency)}
                  {cell(r.transferIn - r.transferOut, a.currency)}
                  {cell(r.closing, a.currency)}
                </tr>
              );
            })}
          </tbody>
          {showTotal && currency && accounts.length > 0 ? (
            <tfoot>
              <tr>
                <td>Total</td>
                <td>{money(total("opening"), currency)}</td>
                <td>{money(total("inflows"), currency)}</td>
                <td>{money(total("outflows"), currency)}</td>
                <td>{money(total("transferIn") - total("transferOut"), currency)}</td>
                <td>{money(total("closing"), currency)}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </>
  );
}

function Waterfall({ accounts, results }: { accounts: Account[]; results: AccountPeriodResult[] }) {
  const byId = (id: string) => results.find((r) => r.accountId === id);
  const openingTotal = results.reduce((s, r) => s + r.opening, 0);
  const closingTotal = results.reduce((s, r) => s + r.closing, 0);

  type Step = { label: string; value: number; kind: "total" | "delta" };
  const steps: Step[] = [
    { label: "Opening", value: openingTotal, kind: "total" },
    ...accounts.map((a) => {
      const r = byId(a.id);
      return { label: a.label, value: r ? r.closing - r.opening : 0, kind: "delta" as const };
    }),
    { label: "Closing", value: closingTotal, kind: "total" },
  ];

  const levels: number[] = [0, openingTotal];
  let run = openingTotal;
  for (const s of steps.slice(1, -1)) { run += s.value; levels.push(run); }
  levels.push(closingTotal);
  const yMax = Math.max(...levels) * 1.08 || 1;
  const yMin = Math.min(0, ...levels);

  const W = 760, H = 340, mL = 16, mR = 16, mT = 24, mB = 70;
  const plotW = W - mL - mR, plotH = H - mT - mB;
  const n = steps.length;
  const slot = plotW / n;
  const bw = Math.min(slot * 0.6, 70);
  const y = (v: number) => mT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  let cum = openingTotal;
  const bars = steps.map((s) => {
    let top: number, bottom: number, color: string;
    if (s.kind === "total") {
      top = y(s.value); bottom = y(yMin > 0 ? yMin : 0); color = "var(--ink)";
    } else {
      const start = cum; const end = cum + s.value; cum = end;
      top = y(Math.max(start, end)); bottom = y(Math.min(start, end));
      color = s.value >= 0 ? "var(--positive)" : "var(--negative)";
    }
    return { s, top, h: Math.max(Math.abs(bottom - top), 1), color };
  });

  return (
    <div className="card chart-card">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img"
           aria-label="Cash movement by company, opening to closing">
        <line x1={mL} y1={y(yMin > 0 ? yMin : 0)} x2={W - mR} y2={y(yMin > 0 ? yMin : 0)}
              stroke="var(--line-strong)" strokeWidth="1" />
        {bars.map((b, i) => {
          const cx = mL + slot * i + slot / 2;
          return (
            <g key={i}>
              <rect x={cx - bw / 2} y={b.top} width={bw} height={b.h} fill={b.color} rx="2" />
              <text x={cx} y={b.top - 6} textAnchor="middle"
                    fontSize="11" fontFamily="var(--font-mono)"
                    fill={b.s.kind === "total" ? "var(--ink)" : (b.s.value >= 0 ? "var(--positive)" : "var(--negative)")}>
                {b.s.kind === "total" ? compact(b.s.value) : (b.s.value === 0 ? "" : compact(b.s.value))}
              </text>
              <text x={cx} y={H - mB + 18} textAnchor="middle"
                    fontSize="10.5" fontFamily="var(--font-mono)" fill="var(--muted)"
                    transform={`rotate(35 ${cx} ${H - mB + 18})`}>
                {b.s.label.length > 14 ? b.s.label.slice(0, 13) + "…" : b.s.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ErrorBanner({ messages }: { messages: string[] }) {
  return (
    <div className="banner">
      <strong>The app connected, but couldn&apos;t read your data.</strong>
      <ul>{messages.map((m, i) => <li key={i}>{m}</li>)}</ul>
      <div className="banner-hint">
        In Vercel → Environment Variables, ensure <code>SUPABASE_URL</code> ends in
        <code>.supabase.co</code> (no <code>/rest/v1</code>) and that
        <code>SUPABASE_SERVICE_ROLE_KEY</code> is the service_role / secret key.
        Then redeploy.
      </div>
    </div>
  );
}

function SuccessBanner({ company, count, isNew }: { company: string; count: number; isNew: boolean }) {
  return (
    <div className="banner success">
      <strong>Imported {company} — {count} transactions loaded.</strong>
      {isNew ? <div className="banner-hint">A new period was created for the statement&apos;s date range and is now selected.</div> : null}
    </div>
  );
}

function PaymentRequestBanner({ inserted, duped, matched, unmapped }: {
  inserted: number; duped: number; matched: number; unmapped: string;
}) {
  return (
    <div className="banner success">
      <strong>Payment requests imported — {inserted} new, {duped} duplicates skipped, {matched} auto-matched to bank transactions.</strong>
      {unmapped ? (
        <div className="banner-hint">
          The following company codes weren&apos;t recognised and were skipped: <code>{unmapped}</code>
        </div>
      ) : null}
    </div>
  );
}

type PaymentRequest = {
  id: string; account_id: string; request_date: string;
  description: string; amount: number; status: "pending" | "matched" | "cancelled";
};

function LiquidityPanel({
  accounts, results, requests, latestEnd,
}: {
  accounts: Account[]; results: AccountPeriodResult[];
  requests: PaymentRequest[]; latestEnd: string | null;
}) {
  const rows = accounts.map((a) => {
    const closing = results.find((r) => r.accountId === a.id)?.closing ?? 0;
    const pending = requests.filter((r) => r.account_id === a.id && r.status === "pending");
    const pendingAmount = pending.reduce((s, r) => s + Number(r.amount), 0);
    const flagged = latestEnd
      ? pending.filter((r) => r.request_date <= latestEnd).length
      : 0;
    const projected = closing - pendingAmount;
    return { account: a, closing, pendingAmount, pendingCount: pending.length, flagged, projected };
  });
  const total = (k: "closing" | "pendingAmount" | "projected") =>
    rows.reduce((s, r) => s + r[k], 0);
  const totalFlagged = rows.reduce((s, r) => s + r.flagged, 0);

  return (
    <>
      <div className="eyebrow chart-eyebrow">Real-time liquidity (NGN)</div>
      <div className="liquidity-note">
        Pending payment requests reduce available cash before they hit the bank.
        Flagged rows are requests dated on or before {latestEnd ?? "—"} that have no
        matching bank transaction yet.
      </div>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Bank closing</th>
              <th>Pending out</th>
              <th>Projected</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.account.id}>
                <td>{r.account.label}</td>
                <td>{money(r.closing, "NGN")}</td>
                <td className={r.pendingAmount > 0 ? "neg" : "dim"}>
                  {r.pendingAmount > 0
                    ? <>{money(r.pendingAmount, "NGN")} <span className="dim count">({r.pendingCount})</span></>
                    : money(0, "NGN")}
                </td>
                <td className={r.projected < 0 ? "neg" : ""}>{money(r.projected, "NGN")}</td>
                <td>
                  {r.flagged > 0 ? <span className="flag">⚠ {r.flagged} flagged</span>
                   : r.pendingCount > 0 ? <span className="dim">{r.pendingCount} awaiting</span>
                   : <span className="dim">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td>{money(total("closing"), "NGN")}</td>
              <td className={total("pendingAmount") > 0 ? "neg" : "dim"}>{money(total("pendingAmount"), "NGN")}</td>
              <td className={total("projected") < 0 ? "neg" : ""}>{money(total("projected"), "NGN")}</td>
              <td>{totalFlagged > 0 ? <span className="flag">⚠ {totalFlagged}</span> : <span className="dim">—</span>}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

function sliceLabelFor(from?: string, to?: string, period?: Period): string | undefined {
  if (!from && !to) return undefined;
  const f = from || period?.start_date || "";
  const t = to || period?.end_date || "";
  return `${f} → ${t}`;
}

export default async function Home({ searchParams }: {
  searchParams: { wk?: string; mo?: string; wkFrom?: string; wkTo?: string; moFrom?: string; moTo?: string;
                  imported?: string; count?: string; new?: string;
                  pr_inserted?: string; pr_duped?: string; pr_matched?: string; pr_unmapped?: string };
}) {
  let sb;
  try { sb = supabaseServer(); }
  catch (e: any) { return <div className="wrap"><ErrorBanner messages={[e.message]} /></div>; }

  const errors: string[] = [];

  const { data: accountsRaw, error: accErr } = await sb
    .from("accounts").select("id, company, label, currency, cadence")
    .eq("is_active", true).order("cadence").order("label");
  if (accErr) errors.push(`accounts: ${accErr.message}`);
  const accounts = (accountsRaw || []) as Account[];

  const { data: wkPeriods, error: wkErr } = await sb
    .from("periods").select("id, label, start_date, end_date").eq("cadence", "weekly")
    .order("start_date", { ascending: false });
  if (wkErr) errors.push(`periods (weekly): ${wkErr.message}`);
  const { data: moPeriods } = await sb
    .from("periods").select("id, label, start_date, end_date").eq("cadence", "monthly")
    .order("start_date", { ascending: false });

  const weeklyList = (wkPeriods || []) as Period[];
  const monthlyList = (moPeriods || []) as Period[];
  const wkId = searchParams.wk || weeklyList[0]?.id;
  const moId = searchParams.mo || monthlyList[0]?.id;
  const wkPeriod = weeklyList.find((p) => p.id === wkId);
  const moPeriod = monthlyList.find((p) => p.id === moId);
  const periodIds = [wkId, moId].filter(Boolean) as string[];

  const { data: balancesRaw } = await sb.from("balances").select("account_id, period_id, opening").in("period_id", periodIds);
  const { data: txnsRaw } = await sb.from("transactions")
    .select("account_id, period_id, amount, direction, is_transfer, txn_date").eq("status", "confirmed").in("period_id", periodIds);
  const { data: transfersRaw } = await sb.from("transfers")
    .select("from_account_id, to_account_id, amount, period_id").in("period_id", periodIds);

  const openingsFor = (pid?: string): Record<string, number> => {
    const m: Record<string, number> = {};
    (balancesRaw || []).filter((b) => b.period_id === pid).forEach((b) => { m[b.account_id] = Number(b.opening); });
    return m;
  };
  const txnsFor = (pid?: string): Transaction[] =>
    (txnsRaw || []).filter((t) => t.period_id === pid).map((t: any) => ({
      accountId: t.account_id, amount: Number(t.amount), direction: t.direction,
      isTransfer: t.is_transfer, date: t.txn_date }));
  const transfersFor = (pid?: string): Transfer[] =>
    (transfersRaw || []).filter((t) => t.period_id === pid).map((t: any) => ({
      fromAccountId: t.from_account_id, toAccountId: t.to_account_id, amount: Number(t.amount) }));

  const ngnAccounts = accounts.filter((a) => a.cadence === "weekly");
  const fxAccounts = accounts.filter((a) => a.cadence === "monthly");

  // --- Liquidity outlook data: payment requests + each NGN account's latest period end ---
  const ngnAcctIds = ngnAccounts.map((a) => a.id);
  const { data: prRaw } = ngnAcctIds.length
    ? await sb.from("payment_requests")
        .select("id, account_id, request_date, description, amount, status")
        .in("account_id", ngnAcctIds)
    : { data: [] as any[] };
  const latestWeeklyEnd = weeklyList.length ? weeklyList[0].end_date : null;

  const wkRange: DateRange = { from: searchParams.wkFrom, to: searchParams.wkTo };
  const moRange: DateRange = { from: searchParams.moFrom, to: searchParams.moTo };

  const ngnResults = computePeriod(openingsFor(wkId), txnsFor(wkId), transfersFor(wkId), wkRange);
  const fxResults = computePeriod(openingsFor(moId), txnsFor(moId), transfersFor(moId), moRange);

  const showError = errors.length > 0 || (accounts.length === 0 && !accErr);
  if (accounts.length === 0 && !accErr) {
    errors.push("Connected, but found 0 accounts. Likely causes: wrong project URL, anon key instead of service_role, or seed.sql didn't run.");
  }

  const importedMsg = searchParams.imported
    ? <SuccessBanner company={decodeURIComponent(searchParams.imported)}
        count={parseInt(searchParams.count || "0", 10)}
        isNew={searchParams.new === "1"} />
    : null;

  const prImportMsg = searchParams.pr_inserted
    ? <PaymentRequestBanner
        inserted={parseInt(searchParams.pr_inserted || "0", 10)}
        duped={parseInt(searchParams.pr_duped || "0", 10)}
        matched={parseInt(searchParams.pr_matched || "0", 10)}
        unmapped={searchParams.pr_unmapped || ""} />
    : null;

  const paymentRequests = (prRaw || []) as PaymentRequest[];

  return (
    <div className="wrap">
      <header className="site">
        <div>
          <h1>Cash Position</h1>
          <div className="meta">Metis Capital — group cash tracker</div>
        </div>
        <div className="header-actions">
          <a className="linkbtn primary" href="/import">Import statement</a>
          <a className="linkbtn primary alt" href="/import/payments">Import payment requests</a>
          <form action="/api/logout" method="post"><button className="linkbtn" type="submit">Sign out</button></form>
        </div>
      </header>

      {showError ? <ErrorBanner messages={errors} /> : null}
      {importedMsg}
      {prImportMsg}

      <Board
        title="NGN Weekly"
        periodLabel={wkPeriod?.label || "—"}
        periodControl={<PeriodSelect periods={weeklyList} current={wkId || ""} param="wk" />}
        dateFilter={<DateFilter period={wkPeriod} fromParam="wkFrom" toParam="wkTo"
                     fromVal={searchParams.wkFrom} toVal={searchParams.wkTo}
                     preserve={{ wk: wkId, mo: moId, moFrom: searchParams.moFrom, moTo: searchParams.moTo }} />}
        accounts={ngnAccounts} results={ngnResults} showTotal currency="NGN"
        sliceLabel={sliceLabelFor(searchParams.wkFrom, searchParams.wkTo, wkPeriod)} />

      {ngnAccounts.length > 0 ? (
        <>
          <div className="eyebrow chart-eyebrow">Cash movement by company (NGN)</div>
          <Waterfall accounts={ngnAccounts} results={ngnResults} />
          <LiquidityPanel
            accounts={ngnAccounts}
            results={ngnResults}
            requests={paymentRequests}
            latestEnd={latestWeeklyEnd}
          />
        </>
      ) : null}

      <Board
        title="Foreign Monthly"
        periodLabel={moPeriod?.label || "—"}
        periodControl={<PeriodSelect periods={monthlyList} current={moId || ""} param="mo" />}
        dateFilter={<DateFilter period={moPeriod} fromParam="moFrom" toParam="moTo"
                     fromVal={searchParams.moFrom} toVal={searchParams.moTo}
                     preserve={{ wk: wkId, mo: moId, wkFrom: searchParams.wkFrom, wkTo: searchParams.wkTo }} />}
        accounts={fxAccounts} results={fxResults} showTotal={false}
        sliceLabel={sliceLabelFor(searchParams.moFrom, searchParams.moTo, moPeriod)} />

      <div className="eyebrow">Record activity manually</div>
      <div className="panels">
        <div className="panel">
          <h3>Add transaction</h3>
          <form action={addTransaction}>
            <div className="field">
              <label htmlFor="t-acct">Account</label>
              <select id="t-acct" name="account_id" required>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </div>
            <div className="row2">
              <div className="field"><label htmlFor="t-date">Date</label>
                <input id="t-date" name="txn_date" type="date" required /></div>
              <div className="field"><label htmlFor="t-dir">Direction</label>
                <select id="t-dir" name="direction" required>
                  <option value="inflow">Inflow</option><option value="outflow">Outflow</option>
                </select></div>
            </div>
            <div className="field"><label htmlFor="t-desc">Description</label>
              <input id="t-desc" name="description" type="text" placeholder="e.g. Payroll" /></div>
            <div className="field"><label htmlFor="t-amt">Amount</label>
              <input id="t-amt" name="amount" type="number" step="0.01" min="0" required /></div>
            <button className="submit" type="submit">Record transaction</button>
          </form>
        </div>

        <div className="panel">
          <h3>Add inter-company transfer</h3>
          <form action={addTransfer}>
            <div className="row2">
              <div className="field"><label htmlFor="tr-from">From</label>
                <select id="tr-from" name="from_account_id" required>
                  {ngnAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select></div>
              <div className="field"><label htmlFor="tr-to">To</label>
                <select id="tr-to" name="to_account_id" required>
                  {ngnAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select></div>
            </div>
            <div className="field"><label htmlFor="tr-desc">Description</label>
              <input id="tr-desc" name="description" type="text" placeholder="e.g. Working capital" /></div>
            <div className="field"><label htmlFor="tr-amt">Amount (NGN)</label>
              <input id="tr-amt" name="amount" type="number" step="0.01" min="0" required /></div>
            <button className="submit" type="submit">Record transfer</button>
          </form>
        </div>
      </div>
    </div>
  );
}
