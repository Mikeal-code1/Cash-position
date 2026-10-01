import { loadDashboard } from "@/lib/dashboardData";
import { f2 } from "@/lib/format";
import { AppShell, DataErrors, ResultBanners, Banner } from "../ui";
import { PeriodSelect } from "../PeriodSelect";

export const dynamic = "force-dynamic";
type SP = Record<string, string | undefined>;

export default async function Liquidity({ searchParams }: { searchParams: SP }) {
  const d = await loadDashboard(searchParams);
  if (d.fatal !== null) return <AppShell active="liquidity" title="Liquidity"><Banner title={d.fatal} /></AppShell>;
  const N = (n: number) => "₦" + f2(n);
  const t = d.liqTotals;

  return (
    <AppShell active="liquidity" title="Liquidity"
      sub={`Projected naira after pending payment requests · ${d.wkPeriod?.label ?? "—"}`}
      actions={<PeriodSelect periods={d.weeklyList} current={d.wkId || ""} param="wk" label="NGN week" />}>
      <DataErrors errors={d.errors} />
      <ResultBanners sp={searchParams} />

      <section className="card flush" aria-label="Real-time liquidity">
        <div className="card-note">Bank closing less payment requests sent but not yet seen on a statement. A request is <strong>flagged</strong> when the latest statement ({d.latestWeeklyEnd ?? "—"}) covers its date but no matching bank transaction was found.</div>
        <div className="tscroll"><div className="tgrid" style={{ minWidth: 720 }}>
          <div className="trow thead g5l">
            <span className="lbl">Entity</span><span className="lbl r">Bank closing</span><span className="lbl r">Pending out</span><span className="lbl r">Projected</span><span className="lbl r">Status</span>
          </div>
          {d.liquidity.map((l) => {
            const status = l.projected < 0 ? ["Shortfall", "chip chip-warn"]
              : l.flagged ? [`${l.flagged} flagged`, "chip chip-warn"]
              : l.pendingCount ? [`${l.pendingCount} awaiting`, "chip chip-info"] : ["Clear", "chip chip-muted"];
            return (
              <div className="trow g5l" key={l.name}>
                <span>{l.name}</span>
                <span className="num r">{N(l.closing)}</span>
                <span className="num r">{l.pending ? N(l.pending) : "—"}</span>
                <span className={`num r strong ${l.projected < 0 ? "warn-text" : ""}`}>{N(l.projected)}</span>
                <span className="r"><span className={status[1]}>{status[0]}</span></span>
              </div>
            );
          })}
          <div className="trow g5l tfoot">
            <span className="strong">Total</span>
            <span className="num r">{N(d.ngnTotals.closing)}</span>
            <span className="num r">{t.pending ? N(t.pending) : "—"}</span>
            <span className="num r strong">{N(t.projected)}</span>
            <span className="r">{t.flagged ? <span className="chip chip-warn">{t.flagged} flagged</span> : null}</span>
          </div>
        </div></div>
      </section>
      <p className="muted small">Pending requests are matched automatically when the bank statement covering them is imported (same account, same amount, within 21 days).</p>
    </AppShell>
  );
}
