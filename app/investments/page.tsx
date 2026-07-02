import { supabaseServer } from "@/lib/supabaseServer";
import {
  computePlacement, summarise, monthlySeries,
  type Placement, type InvestSettings, type PlacementResult, type PortfolioSummary,
} from "@/lib/investEngine";
import { addPlacement, recordRecall, clearRecall, updateSettings } from "./actions";

export const dynamic = "force-dynamic";

const SYM: Record<string, string> = { NGN: "₦", USD: "$", GBP: "£", AED: "AED " };

function money(n: number, currency: string) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency, minimumFractionDigits: 2 }).format(n);
}
function compact(n: number, currency: string) {
  const sym = SYM[currency] ?? currency + " ";
  const a = Math.abs(n); const s = n < 0 ? "-" : "";
  if (a >= 1e9) return `${s}${sym}${(a / 1e9).toFixed(2)}b`;
  if (a >= 1e6) return `${s}${sym}${(a / 1e6).toFixed(1)}m`;
  if (a >= 1e3) return `${s}${sym}${(a / 1e3).toFixed(0)}k`;
  return `${s}${sym}${a.toFixed(0)}`;
}
const pct = (x: number) => (x * 100).toFixed(2) + "%";

function Kpis({ s }: { s: PortfolioSummary }) {
  const cur = s.currency;
  const items: [string, string][] = [
    ["Total invested", compact(s.invested, cur)],
    ["Projected maturity value", compact(s.projMaturity, cur)],
    ["Net interest (proj.)", compact(s.netInterest, cur)],
    ["Blended net ROI", pct(s.blendedNetRoi)],
    ["Accrued YTD (gross)", compact(s.accruedGross, cur)],
    ["Current book value", compact(s.currentBook, cur)],
    ["Return to date", pct(s.returnToDate)],
    ["Placements", `${s.counts.active} active · ${s.counts.pending} pending · ${s.counts.matured} matured`],
  ];
  return (
    <div className="kpis">
      {items.map(([label, value]) => (
        <div className="kpi" key={label}>
          <div className="kpi-label">{label}</div>
          <div className="kpi-value">{value}</div>
        </div>
      ))}
    </div>
  );
}

// Two-line YTD chart: portfolio book value vs principal deployed. The gap is accrued interest.
function PerformanceChart({ series, currency }: {
  series: { label: string; bookValue: number; deployed: number }[]; currency: string;
}) {
  if (series.length < 2) return null;
  const W = 760, H = 300, mL = 58, mR = 14, mT = 16, mB = 40;
  const plotW = W - mL - mR, plotH = H - mT - mB;
  const maxY = Math.max(...series.map((s) => s.bookValue)) * 1.06 || 1;
  const x = (i: number) => mL + (i / (series.length - 1)) * plotW;
  const y = (v: number) => mT + plotH - (v / maxY) * plotH;

  const path = (key: "bookValue" | "deployed") =>
    series.map((s, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(s[key]).toFixed(1)}`).join(" ");

  const gridLines = 4;
  const labelEvery = Math.max(1, Math.ceil(series.length / 12));

  return (
    <div className="card chart-card">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img"
           aria-label={`Portfolio book value vs principal deployed by month (${currency})`}>
        {Array.from({ length: gridLines + 1 }).map((_, i) => {
          const v = (maxY / gridLines) * i;
          return (
            <g key={i}>
              <line x1={mL} y1={y(v)} x2={W - mR} y2={y(v)} stroke="var(--line)" strokeWidth="1" />
              <text x={mL - 8} y={y(v)} textAnchor="end" dominantBaseline="middle"
                    fontSize="10" fontFamily="var(--font-mono)" fill="var(--muted)">
                {compact(v, currency)}
              </text>
            </g>
          );
        })}
        <path d={path("deployed")} fill="none" stroke="var(--muted)" strokeWidth="1.6" strokeDasharray="5 4" />
        <path d={path("bookValue")} fill="none" stroke="var(--positive)" strokeWidth="2.2" />
        {series.map((s, i) => (
          <circle key={i} cx={x(i)} cy={y(s.bookValue)} r="2.4" fill="var(--positive)" />
        ))}
        {series.map((s, i) => (
          i % labelEvery === 0 ? (
            <text key={i} x={x(i)} y={H - mB + 16} textAnchor="middle"
                  fontSize="10" fontFamily="var(--font-mono)" fill="var(--muted)">{s.label}</text>
          ) : null
        ))}
        <g fontFamily="var(--font-mono)" fontSize="10.5">
          <line x1={mL + 8} y1={mT + 6} x2={mL + 30} y2={mT + 6} stroke="var(--positive)" strokeWidth="2.2" />
          <text x={mL + 36} y={mT + 9} fill="var(--ink)">Book value (principal + accrued)</text>
          <line x1={mL + 258} y1={mT + 6} x2={mL + 280} y2={mT + 6} stroke="var(--muted)" strokeWidth="1.6" strokeDasharray="5 4" />
          <text x={mL + 286} y={mT + 9} fill="var(--muted)">Principal deployed</text>
        </g>
      </svg>
    </div>
  );
}

function EntityTable({ results, currency }: { results: PlacementResult[]; currency: string }) {
  const rs = results.filter((r) => r.placement.currency === currency);
  const entities = Array.from(new Set(rs.map((r) => r.placement.entity)));
  if (!entities.length) return null;
  const rowFor = (name: string, rr: PlacementResult[]) => {
    const invested = rr.reduce((s, r) => s + r.placement.principal, 0);
    const maturity = rr.reduce((s, r) => s + r.realisedValue, 0);
    const net = rr.reduce((s, r) => s + r.netInterest, 0);
    const accrued = rr.reduce((s, r) => s + r.accruedGross, 0);
    return { name, invested, maturity, net, roi: invested ? net / invested : 0, accrued };
  };
  const rows = entities.map((e) => rowFor(e, rs.filter((r) => r.placement.entity === e)));
  const total = rowFor("Total", rs);
  return (
    <div className="card">
      <table>
        <thead>
          <tr><th>Entity</th><th>Invested</th><th>Proj. maturity</th><th>Net interest</th><th>Net ROI</th><th>Accrued YTD</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td>{money(r.invested, currency)}</td>
              <td>{money(r.maturity, currency)}</td>
              <td>{money(r.net, currency)}</td>
              <td>{pct(r.roi)}</td>
              <td>{money(r.accrued, currency)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>{total.name}</td>
            <td>{money(total.invested, currency)}</td>
            <td>{money(total.maturity, currency)}</td>
            <td>{money(total.net, currency)}</td>
            <td>{pct(total.roi)}</td>
            <td>{money(total.accrued, currency)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default async function InvestmentsPage({ searchParams }: { searchParams: { error?: string } }) {
  let sb;
  try { sb = supabaseServer(); }
  catch (e: any) { return <div className="wrap"><div className="banner"><strong>{e.message}</strong></div></div>; }

  const { data: settingsRow, error: setErr } = await sb
    .from("investment_settings").select("*").eq("id", 1).maybeSingle();
  const { data: placementsRaw, error: plErr } = await sb
    .from("placements").select("*").order("start_date");

  if (setErr || plErr) {
    return (
      <div className="wrap">
        <header className="site">
          <div><h1>Investments</h1></div>
          <a className="linkbtn" href="/">← Back to dashboard</a>
        </header>
        <div className="banner">
          <strong>Couldn&apos;t load investment data.</strong>
          <ul><li>{(setErr || plErr)!.message}</li></ul>
          <div className="banner-hint">
            Have you run <code>schema_investments.sql</code> in Supabase yet? It creates the
            <code>placements</code> and <code>investment_settings</code> tables this page uses.
          </div>
        </div>
      </div>
    );
  }

  const settings: InvestSettings = {
    ngnRate: Number(settingsRow?.ngn_rate ?? 0.18),
    usdRate: Number(settingsRow?.usd_rate ?? 0.07),
    ngnWht: Number(settingsRow?.ngn_wht ?? 0.10),
    usdWht: Number(settingsRow?.usd_wht ?? 0),
    penalty: Number(settingsRow?.penalty ?? 0),
  };
  const asOf = new Date().toISOString().slice(0, 10);

  const placements: Placement[] = (placementsRaw || []).map((p: any) => ({
    id: p.id, entity: p.entity, currency: p.currency,
    startDate: p.start_date, principal: Number(p.principal),
    tenorMonths: Number(p.tenor_months),
    rateOverride: p.rate_override != null ? Number(p.rate_override) : null,
    recallDate: p.recall_date,
  }));

  const results = placements.map((p) => computePlacement(p, settings, asOf));
  const currencies = Array.from(new Set(placements.map((p) => p.currency)));

  return (
    <div className="wrap">
      <header className="site">
        <div>
          <h1>Investments</h1>
          <div className="meta">Money market &amp; fixed income placements — as of {asOf}</div>
        </div>
        <a className="linkbtn" href="/">← Back to dashboard</a>
      </header>

      {searchParams.error ? (
        <div className="banner"><strong>Action failed</strong><ul><li>{searchParams.error}</li></ul></div>
      ) : null}

      {placements.length === 0 ? (
        <div className="card" style={{ padding: 30, textAlign: "center" }}>
          <div className="dim">No placements yet. Add the first one below — the dashboard, chart and entity summary build automatically.</div>
        </div>
      ) : null}

      {currencies.map((cur) => {
        const summary = summarise(results, cur);
        const series = monthlySeries(placements, settings, cur);
        return (
          <div key={cur}>
            <div className="eyebrow">Portfolio — {cur}</div>
            <Kpis s={summary} />
            {series.length > 1 ? (
              <>
                <div className="eyebrow chart-eyebrow">Performance by month ({cur})</div>
                <div className="liquidity-note">
                  Book value marks each placement to month-end (compound whole months, simple
                  fractional month, actual days ÷ 30). Matured or recalled placements carry at
                  realised value. The gap between the lines is accrued interest.
                </div>
                <PerformanceChart series={series} currency={cur} />
              </>
            ) : null}
            <div className="eyebrow chart-eyebrow">By entity ({cur})</div>
            <EntityTable results={results} currency={cur} />
          </div>
        );
      })}

      {placements.length > 0 ? (
        <>
          <div className="eyebrow chart-eyebrow">All placements</div>
          <div className="card">
            <table className="history">
              <thead>
                <tr>
                  <th>Entity</th><th>Start</th><th>Principal</th><th>Tenor</th><th>Rate</th>
                  <th>Maturity</th><th>Status</th><th>Accrued YTD</th><th>Current value</th><th>Recall</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.placement.id}>
                    <td>{r.placement.entity}<div className="dim small">{r.placement.currency}</div></td>
                    <td className="when">{r.placement.startDate}</td>
                    <td>{money(r.placement.principal, r.placement.currency)}</td>
                    <td>{r.placement.tenorMonths}m</td>
                    <td>{pct(r.rateUsed)}{r.placement.rateOverride != null ? <div className="dim small">override</div> : null}</td>
                    <td className="when">{r.maturityDate}</td>
                    <td><span className={`outcome-tag outcome-${r.status === "active" ? "success" : r.status === "pending" ? "partial" : "failed"}`}>{r.status}</span></td>
                    <td>{money(r.accruedGross, r.placement.currency)}</td>
                    <td>{money(r.currentValue, r.placement.currency)}</td>
                    <td>
                      {r.placement.recallDate ? (
                        <form action={clearRecall} className="row-form">
                          <span className="dim small">{r.placement.recallDate}</span>
                          <input type="hidden" name="placement_id" value={r.placement.id} />
                          <button className="linkbtn" type="submit">clear</button>
                        </form>
                      ) : r.status !== "matured" ? (
                        <form action={recordRecall} className="row-form">
                          <input type="hidden" name="placement_id" value={r.placement.id} />
                          <input type="date" name="recall_date" required />
                          <button className="linkbtn" type="submit">recall</button>
                        </form>
                      ) : <span className="dim">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <div className="eyebrow chart-eyebrow">Manage</div>
      <div className="panels">
        <div className="panel">
          <h3>Add placement</h3>
          <form action={addPlacement}>
            <div className="field"><label htmlFor="p-entity">Entity / bucket</label>
              <input id="p-entity" name="entity" type="text" placeholder="e.g. Duval Properties" required /></div>
            <div className="row2">
              <div className="field"><label htmlFor="p-ccy">Currency</label>
                <select id="p-ccy" name="currency"><option value="NGN">NGN</option><option value="USD">USD</option></select></div>
              <div className="field"><label htmlFor="p-start">Start date</label>
                <input id="p-start" name="start_date" type="date" required /></div>
            </div>
            <div className="row2">
              <div className="field"><label htmlFor="p-principal">Principal (full amount)</label>
                <input id="p-principal" name="principal" type="number" step="0.01" min="0" required /></div>
              <div className="field"><label htmlFor="p-tenor">Tenor (months)</label>
                <input id="p-tenor" name="tenor_months" type="number" step="0.1" min="0.1" required /></div>
            </div>
            <div className="field"><label htmlFor="p-rate">Rate override — % p.a. (blank = scenario rate)</label>
              <input id="p-rate" name="rate_override" type="number" step="0.01" min="0" max="100" placeholder="e.g. 18.5" /></div>
            <div className="field"><label htmlFor="p-notes">Notes</label>
              <input id="p-notes" name="notes" type="text" placeholder="optional" /></div>
            <button className="submit" type="submit">Add placement</button>
          </form>
        </div>

        <div className="panel">
          <h3>Scenario &amp; tax settings</h3>
          <form action={updateSettings}>
            <div className="row2">
              <div className="field"><label htmlFor="s-ngn">NGN rate (% p.a.)</label>
                <input id="s-ngn" name="ngn_rate" type="number" step="0.01" defaultValue={(settings.ngnRate * 100).toFixed(2)} /></div>
              <div className="field"><label htmlFor="s-usd">USD rate (% p.a.)</label>
                <input id="s-usd" name="usd_rate" type="number" step="0.01" defaultValue={(settings.usdRate * 100).toFixed(2)} /></div>
            </div>
            <div className="row2">
              <div className="field"><label htmlFor="s-nwht">NGN WHT (%)</label>
                <input id="s-nwht" name="ngn_wht" type="number" step="0.01" defaultValue={(settings.ngnWht * 100).toFixed(2)} /></div>
              <div className="field"><label htmlFor="s-uwht">USD WHT (%)</label>
                <input id="s-uwht" name="usd_wht" type="number" step="0.01" defaultValue={(settings.usdWht * 100).toFixed(2)} /></div>
            </div>
            <div className="field"><label htmlFor="s-pen">Early-recall penalty (% of accrued forfeited)</label>
              <input id="s-pen" name="penalty" type="number" step="0.01" defaultValue={(settings.penalty * 100).toFixed(2)} /></div>
            <button className="submit" type="submit">Save settings</button>
            <p className="dim small" style={{ marginTop: 10 }}>
              Scenario reference — Best: 21 / 7.7 · Base: 18 / 7 · Worse: 16 / 7. Rates apply to
              all placements without an override; changing them re-prices the portfolio instantly.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
