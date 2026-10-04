import { loadDashboard, ENTITY_SHORT } from "@/lib/dashboardData";
import { compact, signedCompact, f2, signedMoney, moveClass } from "@/lib/format";
import { AppShell, Bridge, DataErrors, ResultBanners, Banner, type Step } from "./ui";
import { PeriodSelect } from "./PeriodSelect";
import { supabaseServer } from "@/lib/supabaseServer";
import { loadInvestmentTotals } from "@/lib/investmentTotals";

export const dynamic = "force-dynamic";

type SP = Record<string, string | undefined>;

export default async function Overview({ searchParams }: { searchParams: SP }) {
  const d = await loadDashboard(searchParams);
  if (d.fatal !== null) return <AppShell active="overview" title="Overview"><Banner title={d.fatal} /></AppShell>;

  const view = searchParams.view === "gross" ? "gross" : "net";
  const qs = (v: string) => {
    const p = new URLSearchParams();
    Object.entries(searchParams).forEach(([k, val]) => { if (val && k !== "view") p.set(k, val); });
    if (v === "gross") p.set("view", "gross");
    const s = p.toString(); return s ? `/?${s}` : "/";
  };

  const n = d.ngnTotals;
  const ngnSteps: Step[] = view === "net"
    ? [{ label: "Opening", v: n.opening, total: true },
       ...d.groups.map((g) => ({ label: ENTITY_SHORT[g.key] ?? g.name, v: g.net })),
       { label: "Closing", v: n.closing, total: true }]
    : [{ label: "Opening", v: n.opening, total: true }, { label: "Inflows", v: n.inflows }, { label: "Outflows", v: -n.outflows },
       { label: "Closing", v: n.closing, total: true }];
  // Net transfers (if any) are absorbed into the closing so the bridge always ties.
  if (view === "gross") {
    const tr = n.closing - n.opening - n.inflows + n.outflows;
    if (Math.abs(tr) >= 0.005) ngnSteps.splice(3, 0, { label: "Transfers", v: tr });
  }

  let fxSteps: Step[] = [];
  if (d.fxUsd) {
    fxSteps = view === "net"
      ? [{ label: "Opening", v: d.fxUsd.opening, total: true },
         ...d.ccyAgg.map((c) => ({ label: c.currency, v: c.usd!.closing - c.usd!.opening })),
         { label: "Closing", v: d.fxUsd.closing, total: true }]
      : [{ label: "Opening", v: d.fxUsd.opening, total: true }, { label: "Inflows", v: d.fxUsd.inflows },
         { label: "Outflows", v: -d.fxUsd.outflows }, { label: "Closing", v: d.fxUsd.closing, total: true }];
  }

  const attention: { n: string; tone: string; text: string }[] = [];
  if (d.liqTotals.shortfalls) attention.push({ n: String(d.liqTotals.shortfalls), tone: "warn", text: `${d.liqTotals.shortfalls === 1 ? "Entity" : "Entities"} projected below zero once pending payment requests clear.` });
  if (d.liqTotals.flagged) attention.push({ n: String(d.liqTotals.flagged), tone: "warn", text: "Payment requests not yet matched to a bank statement covering their date." });
  if (d.nonStatementCount) attention.push({ n: String(d.nonStatementCount), tone: "info", text: `Accounts without a statement this week (manual or carried forward), holding ${n.closing > 0 ? ((d.nonStatementClosing / n.closing) * 100).toFixed(0) : 0}% of naira cash.` });
  if (d.nilCount) attention.push({ n: String(d.nilCount), tone: "neutral", text: `Account${d.nilCount === 1 ? "" : "s"} with a nil balance.` });
  if (!d.rates) attention.push({ n: "!", tone: "warn", text: "Exchange-rate feed unavailable — USD equivalents are hidden until it returns." });

  const maxClose = Math.max(...d.groups.map((g) => g.closing), 1);

  // ---------- Total holdings (₦) ----------
  const asOfToday = new Date().toISOString().slice(0, 10);
  const inv = await loadInvestmentTotals(supabaseServer(), asOfToday);
  const perUsd: Record<string, number> = { USD: 1 };
  (d.rates?.list || []).forEach((r) => { perUsd[r.currency] = r.perUsd; });
  const toNgn = (amt: number, c: string): number | null =>
    c === "NGN" ? amt : perUsd[c] && perUsd.NGN ? (amt / perUsd[c]) * perUsd.NGN : null;
  const excluded: string[] = [];
  const cashNgn = n.closing;
  let fxNgn = 0;
  d.ccyAgg.forEach((c) => { const v = toNgn(c.closing, c.currency); if (v === null) excluded.push(`${c.currency} cash (no rate)`); else fxNgn += v; });
  let mmNgn = 0, mmCount = 0;
  (inv.moneyMarket?.byCurrency || []).forEach((m) => { const v = toNgn(m.value, m.currency); mmCount += m.count;
    if (v === null) excluded.push(`${m.currency} placements (no rate)`); else mmNgn += v; });
  const fundLines = (inv.funds || []).map((f) => ({ name: f.name, ngn: toNgn(f.value, f.currency) }));
  fundLines.forEach((f) => { if (f.ngn === null) excluded.push(`${f.name} (no rate)`); });
  const fundNgn = fundLines.reduce((s2, f) => s2 + (f.ngn ?? 0), 0);
  inv.notes.forEach((x) => excluded.push(x));
  const cashTotal = cashNgn + fxNgn, invTotal = mmNgn + fundNgn, grand = cashTotal + invTotal;
  const share = (x: number) => (grand > 0 ? (x / grand) * 100 : 0);
  const N2 = (x: number) => "₦" + f2(x);

  return (
    <AppShell active="overview" title="Overview"
      sub={`NGN ${d.wkPeriod?.label ?? "—"} · foreign at latest statement`}
      actions={<PeriodSelect periods={d.weeklyList} current={d.wkId || ""} param="wk" label="NGN week" />}>
      <DataErrors errors={d.errors} />
      <ResultBanners sp={searchParams} />

      <section className="card totals" aria-label="Total holdings">
        <div className="totals-head">
          <div className="hero-main">
            <span className="lbl">Total holdings · naira</span>
            <span className="num hero-figure">{N2(grand)}</span>
            <span className="hero-delta">Cash at latest statements · investments valued at {asOfToday}{perUsd.NGN ? ` · foreign converted at 1 USD = ₦${f2(perUsd.NGN)}` : ""}</span>
          </div>
          <div className="totals-bar" role="img" aria-label={`Cash ${share(cashTotal).toFixed(1)}%, investments ${share(invTotal).toFixed(1)}%`}>
            <span className="tb-cash" style={{ width: `${share(cashTotal)}%` }} />
            <span className="tb-inv" style={{ width: `${share(invTotal)}%` }} />
          </div>
        </div>
        <div className="totals-cols">
          <div className="totals-col">
            <div className="totals-col-head"><span><i className="sw cash" />Cash</span><span className="num">{N2(cashTotal)}</span><span className="num muted small">{share(cashTotal).toFixed(1)}%</span></div>
            <div className="totals-line"><span>Naira accounts</span><span className="num">{N2(cashNgn)}</span></div>
            <div className="totals-line"><span>Foreign accounts <span className="muted small">{d.ccyAgg.map((c) => c.currency).join(" · ")}</span></span><span className="num">{N2(fxNgn)}</span></div>
          </div>
          <div className="totals-col">
            <div className="totals-col-head"><span><i className="sw inv" />Investments</span><span className="num">{N2(invTotal)}</span><span className="num muted small">{share(invTotal).toFixed(1)}%</span></div>
            <div className="totals-line"><span>Money market <span className="muted small">{mmCount} active placement{mmCount === 1 ? "" : "s"}</span></span><span className="num">{N2(mmNgn)}</span></div>
            {fundLines.map((f) => (
              <div className="totals-line" key={f.name}><span>{f.name}</span><span className="num">{f.ngn === null ? "—" : N2(f.ngn)}</span></div>
            ))}
            <a href="/investments" className="text-link">Open Investments →</a>
          </div>
        </div>
        {excluded.length ? <p className="muted small" style={{ margin: 0 }}>Not included: {excluded.join("; ")}.</p> : null}
      </section>

      <section className="card hero" aria-label="Group cash">
        <div className="hero-main">
          <span className="lbl">Group cash · USD equivalent</span>
          <span className="num hero-figure">{d.groupUsd ? "$" + f2(d.groupUsd.closing) : "Rates unavailable"}</span>
          {d.groupUsd ? (
            <span className="hero-delta"><span className={`num ${moveClass(d.groupUsd.closing - d.groupUsd.opening)}`}>{signedCompact(d.groupUsd.closing - d.groupUsd.opening, "USD")}</span> over the period</span>
          ) : null}
        </div>
        <div className="hero-stats">
          <div><span className="lbl">Naira</span><span className="num stat">{compact(n.closing, "NGN")}</span>
            <span className="num stat-sub">{d.groupUsd ? "≈ " + compact(d.groupUsd.ngnClosing, "USD") : "\u00a0"}</span></div>
          <div><span className="lbl">Foreign</span><span className="num stat">{d.fxUsd ? compact(d.fxUsd.closing, "USD") : "—"}</span>
            <span className="stat-sub">{d.ccyAgg.map((c) => c.currency).join(" · ") || "\u00a0"}</span></div>
          <div><span className="lbl">Naira after pending</span><span className="num stat">{compact(d.liqTotals.projected, "NGN")}</span>
            <span className={`stat-sub ${d.liqTotals.shortfalls ? "warn-text" : ""}`}>{d.liqTotals.shortfalls ? `${d.liqTotals.shortfalls} shortfall to review` : `${compact(d.liqTotals.pending, "NGN")} pending`}</span></div>
        </div>
      </section>

      <section className="card" aria-labelledby="mv-h">
        <div className="card-head">
          <div><h2 id="mv-h">Cash movement</h2><span className="card-sub">Opening, movements, closing · naira in NGN, foreign converted to USD</span></div>
          <div className="seg" role="group" aria-label="Chart view">
            <a href={qs("net")} className={view === "net" ? "on" : ""} aria-current={view === "net" ? "true" : undefined}>By entity / currency</a>
            <a href={qs("gross")} className={view === "gross" ? "on" : ""} aria-current={view === "gross" ? "true" : undefined}>Inflows &amp; outflows</a>
          </div>
        </div>
        <div className="bridges">
          <Bridge title="Naira" sub="NGN · by entity" steps={ngnSteps} currency="NGN" />
          <div className="bridges-sep" />
          {fxSteps.length
            ? <Bridge title="Foreign" sub="USD equivalent · by currency" steps={fxSteps} currency="USD" />
            : <div className="bridge empty">Foreign chart needs the exchange-rate feed; it will appear when rates are available.</div>}
        </div>
        <div className="legend">
          <span><i className="sw total" />Balance</span><span><i className="sw up" />Increase</span><span><i className="sw down" />Decrease</span>
        </div>
      </section>

      <div className="split">
        <section className="card grow" aria-labelledby="ent-h">
          <div className="card-head">
            <h2 id="ent-h">Naira by entity</h2>
            <a href={`/ngn${d.wkId ? `?wk=${d.wkId}` : ""}`} className="text-link">Open NGN board →</a>
          </div>
          {d.groups.map((g) => (
            <div className="ent-row" key={g.key}>
              <span className="ent-name">
                <span>{g.name}</span>
                <span className="ent-bar"><span style={{ width: `${Math.max((g.closing / maxClose) * 100, g.closing > 0 ? 1 : 0)}%` }} /></span>
              </span>
              <span className="ent-vals">
                <span className="num">₦{f2(g.closing)}</span>
                <span className={`num small ${moveClass(g.net)}`}>{signedMoney(g.net, "NGN")}</span>
              </span>
            </div>
          ))}
        </section>
        <section className="card side" aria-labelledby="att-h">
          <h2 id="att-h">Needs attention</h2>
          {attention.length ? attention.map((a, i) => (
            <div className="att" key={i}><span className={`att-n num tone-${a.tone}`}>{a.n}</span><span>{a.text}</span></div>
          )) : <p className="muted">Nothing needs attention right now.</p>}
        </section>
      </div>
    </AppShell>
  );
}
