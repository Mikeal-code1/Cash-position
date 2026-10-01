import { loadDashboard } from "@/lib/dashboardData";
import { money, signedMoney, moveClass, compact } from "@/lib/format";
import { AppShell, DataErrors, ResultBanners, Banner } from "../ui";
import { PeriodSelect } from "../PeriodSelect";

export const dynamic = "force-dynamic";
type SP = Record<string, string | undefined>;

export default async function ForeignBoard({ searchParams }: { searchParams: SP }) {
  const d = await loadDashboard(searchParams);
  if (d.fatal !== null) return <AppShell active="foreign" title="Foreign accounts"><Banner title={d.fatal} /></AppShell>;
  const order = ["USD", "AED", "GBP", "EUR"];
  const rank = (c: string) => (order.indexOf(c) === -1 ? 99 : order.indexOf(c));
  const rows = [...d.fxRows].sort((a, b) => rank(a.account.currency) - rank(b.account.currency) || b.result.closing - a.result.closing);

  return (
    <AppShell active="foreign" title="Foreign accounts"
      sub={d.moPinned ? `Pinned period · ${d.moPinned.label}` : "Latest statement per account · native currency"}
      actions={<PeriodSelect periods={[{ id: "latest", label: "Latest per account" }, ...d.monthlyList]} current={d.moParam || "latest"} param="mo" label="Foreign period" />}>
      <DataErrors errors={d.errors} />
      <ResultBanners sp={searchParams} />

      <div className="tiles">
        {d.ccyAgg.map((c) => (
          <div className="card tile" key={c.currency}>
            <span className="lbl">{c.currency} · {c.count} account{c.count === 1 ? "" : "s"}</span>
            <span className="num tile-figure">{money(c.closing, c.currency)}</span>
            <span className="num muted small">{c.usd ? "≈ " + compact(c.usd.closing, "USD") : "USD rate unavailable"}</span>
          </div>
        ))}
      </div>

      <section className="card flush" aria-label="Foreign accounts">
        <div className="tscroll"><div className="tgrid" style={{ minWidth: 760 }}>
          <div className="trow thead g4f">
            <span className="lbl">Account</span><span className="lbl">Statement</span><span className="lbl r">Opening</span><span className="lbl r">Net movement</span><span className="lbl r">Closing</span>
          </div>
          {rows.length === 0 ? <div className="trow"><span className="muted">No foreign statements imported yet.</span></div> : null}
          {rows.map((r) => {
            const net = r.result.closing - r.result.opening, c = r.account.currency;
            return (
              <div className="trow g4f" key={r.account.id}>
                <span>{r.account.label} <span className="muted small">· {c}</span></span>
                <span className="muted">{r.periodLabel}</span>
                <span className="num r">{money(r.result.opening, c)}</span>
                <span className={`num r ${moveClass(net)}`}>{signedMoney(net, c)}</span>
                <span className="num r strong">{money(r.result.closing, c)}</span>
              </div>
            );
          })}
        </div></div>
      </section>
      <p className="muted small">Balances stay in their own currency here and are never summed across currencies. USD equivalents use the live rates shown in the side menu.</p>
    </AppShell>
  );
}
