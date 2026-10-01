import { loadDashboard } from "@/lib/dashboardData";
import { f2, signedMoney, moveClass } from "@/lib/format";
import { AppShell, DataErrors, ResultBanners, Banner } from "../ui";
import { PeriodSelect } from "../PeriodSelect";

export const dynamic = "force-dynamic";
type SP = Record<string, string | undefined>;

const chip = (s: string) => (s === "statement" ? "chip chip-ok" : s === "manual" ? "chip chip-info" : "chip chip-muted");

export default async function NgnBoard({ searchParams }: { searchParams: SP }) {
  const d = await loadDashboard(searchParams);
  if (d.fatal !== null) return <AppShell active="ngn" title="NGN board"><Banner title={d.fatal} /></AppShell>;
  const p = d.wkPeriod;
  const sliced = !!(searchParams.wkFrom || searchParams.wkTo);
  const N = (n: number) => "₦" + f2(n);

  return (
    <AppShell active="ngn" title="NGN board"
      sub={`${p?.label ?? "No period yet"} · opening, net movement and closing by entity`}
      actions={<PeriodSelect periods={d.weeklyList} current={d.wkId || ""} param="wk" label="NGN week" />}>
      <DataErrors errors={d.errors} />
      <ResultBanners sp={searchParams} />

      {p ? (
        <form className="card filter" method="get" action="/ngn">
          <input type="hidden" name="wk" value={d.wkId || ""} />
          <div className="field-inline"><label htmlFor="f-from">From</label>
            <input id="f-from" type="date" name="wkFrom" min={p.start_date} max={p.end_date} defaultValue={searchParams.wkFrom || p.start_date} /></div>
          <div className="field-inline"><label htmlFor="f-to">To</label>
            <input id="f-to" type="date" name="wkTo" min={p.start_date} max={p.end_date} defaultValue={searchParams.wkTo || p.end_date} /></div>
          <button type="submit" className="btn-secondary">Apply</button>
          {sliced ? <a className="text-link" href={`/ngn?wk=${d.wkId}`}>Clear range</a> : null}
          {sliced ? <span className="muted small">Showing {searchParams.wkFrom || p.start_date} → {searchParams.wkTo || p.end_date}</span> : null}
        </form>
      ) : null}

      <section className="card flush" aria-label="NGN weekly board">
        <div className="tscroll"><div className="tgrid" style={{ minWidth: 680 }}>
          <div className="trow thead g3">
            <span className="lbl">Entity · account</span><span className="lbl r">Opening</span><span className="lbl r">Net movement</span><span className="lbl r">Closing</span>
          </div>
          {d.groups.length === 0 ? <div className="trow"><span className="muted">No NGN balances for this period yet.</span></div> : null}
          {d.groups.map((g) => (
            <details key={g.key} className="ent">
              <summary className="trow g3 ent-sum">
                <span className="ent-title">
                  <svg className="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                  <span><span className="strong">{g.name}</span>
                    <span className="muted small block">{g.rows.length} account{g.rows.length === 1 ? "" : "s"}{g.statementCount ? ` · ${g.statementCount} statement` : ""}{g.otherCount ? ` · ${g.otherCount} without statement` : ""}</span></span>
                </span>
                <span className="num r">{N(g.opening)}</span>
                <span className={`num r ${moveClass(g.net)}`}>{signedMoney(g.net, "NGN")}</span>
                <span className="num r strong">{N(g.closing)}</span>
              </summary>
              <div className="ent-rows">
                {g.rows.map((r) => (
                  <div key={r.account.id} className="trow g3 sub">
                    <span className="acct">
                      <span>{r.account.label}</span>
                      {r.account.account_no && !r.account.label.includes(r.account.account_no) ? <span className="num muted small">{r.account.account_no}</span> : null}
                      <span className={chip(r.source)}>{r.sourceNote}</span>
                    </span>
                    <span className="num r">{N(r.result.opening)}</span>
                    <span className={`num r ${moveClass(r.net)}`}>{signedMoney(r.net, "NGN")}</span>
                    <span className="num r">{N(r.result.closing)}</span>
                  </div>
                ))}
              </div>
            </details>
          ))}
          <div className="trow g3 tfoot">
            <span className="strong">Total naira · {d.ngnTotals.accounts} accounts</span>
            <span className="num r">{N(d.ngnTotals.opening)}</span>
            <span className="num r">{signedMoney(d.ngnTotals.closing - d.ngnTotals.opening, "NGN")}</span>
            <span className="num r strong">{N(d.ngnTotals.closing)}</span>
          </div>
        </div></div>
      </section>
      <p className="muted small">Net movement = inflows − outflows ± inter-company transfers. Balances from imported statements reconcile to the bank&apos;s stated closing. Gross inflows and outflows are on the Overview chart&apos;s &ldquo;Inflows &amp; outflows&rdquo; view.</p>
    </AppShell>
  );
}
