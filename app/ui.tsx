// ui.tsx — shared server components for the redesigned dashboard.
import { fetchUsdRates } from "@/lib/fxRates";
import { RecordMenu } from "./RecordMenu";
import { compact, signedCompact } from "@/lib/format";

type TabKey = "overview" | "ngn" | "foreign" | "liquidity" | "investments" | "history" | "import" | "record";

const TABS: { key: TabKey; label: string; href: string; icon: string }[] = [
  { key: "overview", label: "Overview", href: "/", icon: "M3 13h8V3H3zM13 21h8V11h-8zM13 3v6h8V3zM3 21h8v-6H3z" },
  { key: "ngn", label: "NGN board", href: "/ngn", icon: "M4 4v16M4 4l16 16M20 4v16M2 10h20M2 14h20" },
  { key: "foreign", label: "Foreign", href: "/foreign", icon: "M12 2a10 10 0 100 20 10 10 0 000-20zM2 12h20M12 2c3 3 4 6.5 4 10s-1 7-4 10M12 2C9 5 8 8.5 8 12s1 7 4 10" },
  { key: "liquidity", label: "Liquidity", href: "/liquidity", icon: "M12 2.5c-3.5 4.5-6 7.8-6 11a6 6 0 0012 0c0-3.2-2.5-6.5-6-11z" },
  { key: "investments", label: "Investments", href: "/investments", icon: "M3 17l6-6 4 4 8-8M15 7h6v6" },
  { key: "history", label: "History", href: "/history", icon: "M12 7v5l3 2M3.5 12a8.5 8.5 0 108.5-8.5A8.6 8.6 0 004 8M4 3v5h5" },
];

export async function AppShell({
  active, title, sub, actions, children,
}: {
  active: TabKey; title?: string; sub?: string; actions?: React.ReactNode; children: React.ReactNode;
}) {
  const rates = await fetchUsdRates();
  const r = (c: string) => (rates?.rates[c] ? rates.rates[c] : null);
  const fmt = (n: number | null, dp = 2) => (n === null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: dp, minimumFractionDigits: dp }));
  return (
    <div className="shell">
      <aside className="rail">
        <a href="/" className="brand" aria-label="Cash Position home">
          <span className="brand-mark">MC</span>
          <span className="brand-text"><span className="brand-name">Metis Capital</span><span className="brand-sub">Treasury</span></span>
        </a>
        <nav aria-label="Sections" className="rail-nav">
          {TABS.map((t) => (
            <a key={t.key} href={t.href} className={`rail-link${t.key === active ? " on" : ""}`} aria-current={t.key === active ? "page" : undefined}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={t.icon} /></svg>
              <span>{t.label}</span>
            </a>
          ))}
        </nav>
        <div className="rail-foot">
          <span className="rail-foot-lbl">Rates · 1 USD{rates?.asOf ? ` · ${rates.asOf}` : ""}</span>
          {rates ? (
            <>
              <span className="num">₦{fmt(r("NGN"))} · AED {fmt(r("AED"), 4)}</span>
              <span className="num">£1 = ${fmt(r("GBP") ? 1 / r("GBP")! : null, 4)} · €1 = ${fmt(r("EUR") ? 1 / r("EUR")! : null, 4)}</span>
            </>
          ) : <span>Rates feed unavailable</span>}
          <form action="/api/logout" method="post"><button type="submit" className="rail-signout">Sign out</button></form>
        </div>
      </aside>
      <div className="shell-main">
        <header className="topbar">
          <div className="topbar-title">
            {title ? <h1>{title}</h1> : null}
            {sub ? <span className="topbar-sub">{sub}</span> : null}
          </div>
          <div className="topbar-actions">
            {actions}
            <RecordMenu />
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

export function Banner({ kind = "error", title, items, hint }: { kind?: "error" | "success"; title: string; items?: string[]; hint?: React.ReactNode }) {
  return (
    <div className={`banner${kind === "success" ? " success" : ""}`} role={kind === "error" ? "alert" : "status"}>
      <strong>{title}</strong>
      {items && items.length ? <ul>{items.map((m, i) => <li key={i}>{m}</li>)}</ul> : null}
      {hint ? <div className="banner-hint">{hint}</div> : null}
    </div>
  );
}

export function DataErrors({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <Banner title="The app connected, but couldn't read all of your data." items={errors}
      hint={<>In Vercel → Environment Variables, check <code>SUPABASE_URL</code> ends in <code>.supabase.co</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code> is the service_role key, then redeploy.</>} />
  );
}

// ---------- Bridge (waterfall) chart ----------
export type Step = { label: string; v: number; total?: boolean };

function niceFloor(x: number) {
  if (x <= 0) return 0;
  const m = Math.pow(10, Math.floor(Math.log10(x)) - 1);
  return Math.floor(x / m) * m;
}

export function Bridge({ title, sub, steps, currency }: { title: string; sub: string; steps: Step[]; currency: string }) {
  if (steps.length < 2) return null;
  let run = 0;
  const segs: [number | null, number][] = [];
  const vals: number[] = [];
  for (const s of steps) {
    let a: number | null, b: number;
    if (s.total) { a = null; b = s.v; run = s.v; } else { a = run; b = run + s.v; run = b; }
    segs.push([a, b]); if (a !== null) vals.push(a); vals.push(b);
  }
  const mx = Math.max(...vals), mn = Math.min(...vals);
  let lo: number, truncated = false;
  if (mn > 0 && mn > 0.3 * mx) { lo = niceFloor(mn - (mx - mn) * 0.8); truncated = lo > 0; } else { lo = Math.min(0, mn); }
  const top = mx + (mx - lo) * 0.08 || 1, range = top - lo || 1;
  const pctY = (v: number) => ((top - v) / range) * 100;
  const opening = steps[0].v, closing = steps[steps.length - 1].v, delta = closing - opening;
  const ticks = [4, 3, 2, 1, 0].map((q) => compact(lo + (range * q) / 4, currency));

  return (
    <div className="bridge">
      <div className="bridge-head">
        <span className="bridge-title">{title}<span className="bridge-sub">{sub}</span></span>
        <span className={`num ${delta >= 0 ? "mv-up" : "mv-down"}`}>{signedCompact(delta, currency)} net</span>
      </div>
      <div className="bridge-body">
        <div className="bridge-ticks">{ticks.map((t, i) => <span key={i} className="num">{t}</span>)}</div>
        <div className="bridge-plot-wrap">
          <div className="bridge-plot" role="img" aria-label={`${title}: opening ${compact(opening, currency)}, closing ${compact(closing, currency)}`}>
            {steps.map((s, k) => {
              const a = segs[k][0] === null ? lo : segs[k][0]!, b = segs[k][1];
              const t = pctY(Math.max(a, b)), h = Math.max((Math.abs(b - a) / range) * 100, 0.6);
              const flat = !s.total && Math.abs(s.v) < 0.5;
              const tone = s.total ? "total" : flat ? "flat" : s.v >= 0 ? "up" : "down";
              return (
                <div key={k} className="bridge-col">
                  <span className={`bridge-val num tone-${tone}`} style={{ top: `calc(${t}% - 22px)` }}>
                    {s.total ? compact(s.v, currency) : flat ? "—" : signedCompact(s.v, currency)}
                  </span>
                  <div className={`bridge-bar bar-${tone}`} style={{ top: `${t}%`, height: `${h}%` }} />
                </div>
              );
            })}
          </div>
          <div className="bridge-labels">{steps.map((s, k) => <span key={k}>{s.label}</span>)}</div>
        </div>
      </div>
      <span className="bridge-axis">{truncated ? `Axis starts at ${compact(lo, currency)} so movements are readable` : "Axis starts at zero"}</span>
    </div>
  );
}

// Success / error banners carried in the URL after an action redirects.
export function ResultBanners({ sp }: { sp: Record<string, string | undefined> }) {
  const out: React.ReactNode[] = [];
  if (sp.imported) out.push(
    <Banner key="imp" kind="success" title={`Imported ${decodeURIComponent(sp.imported)} — ${parseInt(sp.count || "0", 10)} transactions loaded.`}
      hint={sp.new === "1" ? "A new period was created for the statement's date range and is now selected." : undefined} />);
  if (sp.pr_inserted) out.push(
    <Banner key="pr" kind="success"
      title={`Payment requests imported — ${sp.pr_inserted} new, ${sp.pr_duped || 0} duplicates skipped, ${sp.pr_matched || 0} matched to bank transactions.`}
      hint={sp.pr_unmapped ? <>Company codes not recognised and skipped: <code>{sp.pr_unmapped}</code></> : undefined} />);
  if (sp.bal_ok) out.push(
    <Banner key="bok" kind="success" title={`Balance updated — ${decodeURIComponent(sp.bal_ok)}.`} hint="Logged in History as a manual balance update." />);
  if (sp.bal_error) out.push(<Banner key="ber" title="Balance not updated" items={[decodeURIComponent(sp.bal_error)]} />);
  if (sp.ok === "transaction") out.push(<Banner key="tok" kind="success" title="Transaction recorded." />);
  if (sp.ok === "transfer") out.push(<Banner key="trok" kind="success" title="Inter-company transfer recorded." />);
  return out.length ? <>{out}</> : null;
}
