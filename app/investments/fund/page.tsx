import { supabaseServer } from "@/lib/supabaseServer";
import { summarise, series, priceAt, sortRates, type FundHolding, type FundRate, type FundWithdrawal } from "@/lib/fundEngine";
import { f2, compact } from "@/lib/format";
import { addFundRate, removeFundRate, addFundWithdrawal, removeFundWithdrawal } from "./actions";
import { WithdrawForm } from "./WithdrawForm";

export const dynamic = "force-dynamic";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dF = (iso: string) => { const [y, m, d] = iso.split("-"); return `${parseInt(d, 10)} ${MON[parseInt(m, 10) - 1]} ${y}`; };
const N = (n: number) => "₦" + f2(n);

export default async function FundPage({ searchParams }: { searchParams: { h?: string; fund_ok?: string; fund_error?: string } }) {
  let sb;
  try { sb = supabaseServer(); } catch (e: any) { return <div className="banner"><strong>{e.message}</strong></div>; }

  const { data: holdingsRaw, error } = await sb.from("fund_holdings").select("*").order("created_at");
  if (error) {
    return (
      <div className="banner" role="alert">
        <strong>Couldn&apos;t load mutual fund data.</strong>
        <ul><li>{error.message}</li></ul>
        <div className="banner-hint">Run <code>schema_mutual_fund.sql</code> in Supabase (SQL Editor → New query). It creates the fund tables and seeds Coral Income Fund.</div>
      </div>
    );
  }
  const holdings = (holdingsRaw || []) as any[];
  if (!holdings.length) return <div className="banner"><strong>No mutual fund holdings yet.</strong><div className="banner-hint">Run <code>schema_mutual_fund.sql</code> to seed Coral Income Fund.</div></div>;
  const hr = holdings.find((x) => x.id === searchParams.h) || holdings[0];

  const [{ data: ratesRaw }, { data: wdRaw }] = await Promise.all([
    sb.from("fund_rates").select("*").eq("holding_id", hr.id),
    sb.from("fund_withdrawals").select("*").eq("holding_id", hr.id).order("withdrawal_date"),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const holding: FundHolding = { startDate: hr.start_date, startValue: Number(hr.start_value), startUnits: Number(hr.start_units) };
  const rateRows = sortRates((ratesRaw || []).map((r: any) => ({ effectiveDate: r.effective_date, annualRate: Number(r.annual_rate), id: r.id, note: r.note })) as any[]) as any[];
  const rates: FundRate[] = rateRows.map((r) => ({ effectiveDate: r.effectiveDate, annualRate: r.annualRate }));
  const wdRows = (wdRaw || []).map((w: any) => ({ id: w.id, date: w.withdrawal_date, units: Number(w.units), note: w.note }));
  const wds: FundWithdrawal[] = wdRows.map((w) => ({ date: w.date, units: w.units }));

  const s = summarise(holding, rates, wds, today);
  const projectTo = `${today.slice(0, 4)}-12-31`;
  const pts = series(holding, rates, wds, today, projectTo);
  const closed = s.units <= 0;

  // ---- chart geometry (server-rendered SVG) ----
  const W = 900, X0 = 80, X1 = 884, Y0 = 20, Y1 = 236;
  const vals = pts.map((p) => p.value);
  let hi = Math.max(...vals), lo = Math.min(...vals);
  if (hi - lo < 1) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.15; hi += pad; lo = Math.max(0, lo - pad);
  const t0 = Date.parse(pts[0].date), t1 = Date.parse(pts[pts.length - 1].date) || t0 + 1;
  const xOf = (d: string) => X0 + ((Date.parse(d) - t0) / (t1 - t0 || 1)) * (X1 - X0);
  const yOf = (v: number) => Y1 - ((v - lo) / (hi - lo)) * (Y1 - Y0);
  const path = (ps: typeof pts) => ps.map((p, i) => `${i ? "L" : "M"}${xOf(p.date).toFixed(1)},${yOf(p.value).toFixed(1)}`).join(" ");
  const actual = pts.filter((p) => !p.projected);
  const proj = pts.filter((p) => p.date >= today);
  const area = actual.length > 1 ? `${path(actual)} L${xOf(actual[actual.length - 1].date).toFixed(1)},${Y1} L${X0},${Y1} Z` : "";
  const grid = [0, 1, 2, 3, 4].map((q) => lo + ((hi - lo) * q) / 4);
  const label = (d: string) => (d === holding.startDate ? dF(d).slice(0, -5) : d === today ? "Today" : MON[parseInt(d.slice(5, 7), 10) - 1]);

  return (
    <div className="fund">
      {searchParams.fund_error ? <div className="banner" role="alert"><strong>Not saved</strong><ul><li>{searchParams.fund_error}</li></ul></div> : null}
      {searchParams.fund_ok === "rate" ? <div className="banner success" role="status"><strong>Advised rate saved.</strong></div> : null}
      {searchParams.fund_ok === "withdrawal" ? <div className="banner success" role="status"><strong>Withdrawal recorded.</strong></div> : null}

      <section className="card hero" aria-label={`${hr.name} position`}>
        <div className="hero-main">
          <span className="lbl">{hr.name}{hr.holder ? ` · held by ${hr.holder}` : ""}</span>
          <span className="num hero-figure">{N(s.value)}</span>
          <span className="hero-delta">{closed ? "Position fully liquidated" : `Estimated value at ${dF(today)} · accrued at the advised rate, not a market valuation`}</span>
        </div>
        <div className="hero-stats">
          <div><span className="lbl">Gain since start</span><span className={`num stat ${s.gain >= 0 ? "mv-up" : "mv-down"}`}>{s.gain >= 0 ? "+" : "−"}{N(Math.abs(s.gain))}</span>
            <span className="num stat-sub">{(s.returnPct * 100).toFixed(2)}% since {dF(holding.startDate)}</span></div>
          <div><span className="lbl">Units held</span><span className="num stat">{s.units.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>
            <span className="num stat-sub">implied price ₦{f2(s.price)}</span></div>
          <div><span className="lbl">Withdrawn</span><span className="num stat">{N(s.withdrawn)}</span>
            <span className="stat-sub">{s.withdrawals ? `${s.withdrawals} withdrawal${s.withdrawals === 1 ? "" : "s"}` : "None yet"}</span></div>
          <div><span className="lbl">Current rate</span><span className="num stat">{s.currentRate ? (s.currentRate.annualRate * 100).toFixed(2) + "% p.a." : "—"}</span>
            <span className="stat-sub">{s.currentRate ? `since ${dF(s.currentRate.effectiveDate)}` : ""}</span></div>
        </div>
      </section>

      <section className="card" aria-labelledby="fv-h">
        <div className="card-head">
          <div><h2 id="fv-h">Position value</h2><span className="card-sub">Month-end values from {dF(holding.startDate)}; dashed line projects the current rate to {dF(projectTo)}</span></div>
          <span className="legend" style={{ paddingTop: 0 }}>
            <span><i className="ln" />Accrued to date</span><span><i className="ln dash" />Projection</span>
          </span>
        </div>
        <svg viewBox={`0 0 ${W} 280`} className="fund-chart" role="img"
          aria-label={`Position value: ${compact(holding.startValue, "NGN")} at start, ${compact(s.value, "NGN")} today`}>
          {grid.map((v, i) => (
            <g key={i}>
              <line x1={X0} x2={X1} y1={yOf(v)} y2={yOf(v)} stroke="#EEF0F3" />
              <text x={X0 - 8} y={yOf(v) + 4} textAnchor="end" className="ax">{compact(v, "NGN")}</text>
            </g>
          ))}
          {area ? <path d={area} fill="#1E3A8A" fillOpacity={0.07} /> : null}
          {actual.length > 1 ? <path d={path(actual)} fill="none" stroke="#1E3A8A" strokeWidth={2.5} strokeLinejoin="round" /> : null}
          {proj.length > 1 ? <path d={path(proj)} fill="none" stroke="#1E3A8A" strokeWidth={2} strokeDasharray="6 5" /> : null}
          {wdRows.filter((w) => w.date <= projectTo).map((w) => (
            <g key={w.id}>
              <line x1={xOf(w.date)} x2={xOf(w.date)} y1={16} y2={Y1} stroke="#B45309" strokeDasharray="3 3" />
              <text x={xOf(w.date) + 6} y={28} className="ax" fill="#B45309">−{compact(w.units * priceAt(holding, rates, w.date), "NGN")}</text>
            </g>
          ))}
          {pts.map((p) => (
            <g key={p.date}>
              <circle cx={xOf(p.date)} cy={yOf(p.value)} r={p.date === today ? 5 : 3.5} fill={p.projected ? "#fff" : "#1E3A8A"} stroke="#1E3A8A" strokeWidth={2} />
              <text x={xOf(p.date)} y={262} textAnchor="middle" className="ax-x">{label(p.date)}</text>
            </g>
          ))}
        </svg>
      </section>

      <div className="split">
        <section className="card flush grow" id="rates" aria-labelledby="fr-h">
          <div className="card-pad"><h2 id="fr-h">Advised rates</h2><span className="card-sub">Each rate applies from its effective date until the next one</span></div>
          {rateRows.map((r, i) => (
            <div key={r.id} className="trow fund-row">
              <span className="num muted">{dF(r.effectiveDate)}</span>
              <span>{r.note || "Advised rate"}</span>
              <span className="num strong">{(r.annualRate * 100).toFixed(2)}%</span>
              <span className="r">
                {i === 0 ? <span className="chip chip-muted">Base</span> : (
                  <form action={removeFundRate}><input type="hidden" name="rate_id" value={r.id} />
                    <button type="submit" className="link-btn">Remove</button></form>
                )}
              </span>
            </div>
          ))}
          <form action={addFundRate} className="fund-foot">
            <input type="hidden" name="holding_id" value={hr.id} />
            <label className="field-inline"><span>Effective date</span><input type="date" name="effective_date" required min={holding.startDate} /></label>
            <label className="field-inline"><span>Rate % p.a.</span><input type="number" name="annual_rate" step="0.01" min="0" max="100" placeholder="e.g. 11.00" required /></label>
            <button type="submit" className="btn-primary">Add rate</button>
          </form>
        </section>

        <section className="card flush grow" id="withdraw" aria-labelledby="fw-h">
          <div className="card-pad"><h2 id="fw-h">Withdrawals</h2><span className="card-sub">Redeem units at the implied price on the withdrawal date</span></div>
          {wdRows.length === 0 ? <div className="trow"><span className="muted">No withdrawals since {dF(holding.startDate)}.</span></div> : null}
          {wdRows.map((w) => (
            <div key={w.id} className="trow fund-row">
              <span className="num muted">{dF(w.date)}</span>
              <span className="num">{w.units.toLocaleString("en-US", { maximumFractionDigits: 4 })} units @ ₦{f2(priceAt(holding, rates, w.date))}{w.note ? <span className="muted small"> · {w.note}</span> : null}</span>
              <span className="num strong mv-down">−{N(w.units * priceAt(holding, rates, w.date))}</span>
              <span className="r"><form action={removeFundWithdrawal}><input type="hidden" name="withdrawal_id" value={w.id} />
                <button type="submit" className="link-btn">Remove</button></form></span>
            </div>
          ))}
          <div className="fund-foot">
            <WithdrawForm holdingId={hr.id} holding={holding} rates={rates} withdrawals={wds} today={today} action={addFundWithdrawal} />
          </div>
        </section>
      </div>
      <p className="muted small">Value grows at (1 + rate)<sup>days ÷ 365</sup> from {dF(holding.startDate)} (₦{f2(holding.startValue)}, {holding.startUnits.toLocaleString("en-US")} units). Withdrawal amounts are recalculated if an earlier advised rate is changed.</p>
    </div>
  );
}
