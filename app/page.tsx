import { supabaseServer } from "@/lib/supabaseServer";
import { computePeriod, type Transaction, type Transfer, type AccountPeriodResult } from "@/lib/cashEngine";
import { addTransaction, addTransfer } from "./actions";

export const dynamic = "force-dynamic";

type Account = { id: string; company: string; label: string; currency: string; cadence: "weekly" | "monthly" };

function money(n: number, currency: string) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency, minimumFractionDigits: 2 }).format(n);
}

function cell(n: number, currency: string) {
  const cls = n < 0 ? "neg" : n === 0 ? "dim" : "";
  return <td className={cls}>{money(n, currency)}</td>;
}

async function latestPeriod(sb: ReturnType<typeof supabaseServer>, cadence: "weekly" | "monthly") {
  const { data } = await sb
    .from("periods")
    .select("id, label")
    .eq("cadence", cadence)
    .order("start_date", { ascending: false })
    .limit(1)
    .single();
  return data as { id: string; label: string } | null;
}

function Board({
  title, period, accounts, results, showTotal, currency,
}: {
  title: string; period: string; accounts: Account[];
  results: AccountPeriodResult[]; showTotal: boolean; currency?: string;
}) {
  const byId = (id: string) => results.find((r) => r.accountId === id);
  const total = (k: keyof AccountPeriodResult) =>
    results.reduce((s, r) => s + (r[k] as number), 0);

  return (
    <>
      <div className="eyebrow">{title} · {period}</div>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Account</th><th>Opening</th><th>Inflows</th>
              <th>Outflows</th><th>Net transfers</th><th>Closing</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => {
              const r = byId(a.id);
              const cur = a.currency;
              if (!r) return null;
              return (
                <tr key={a.id}>
                  <td>{a.label}</td>
                  {cell(r.opening, cur)}
                  {cell(r.inflows, cur)}
                  {cell(r.outflows, cur)}
                  {cell(r.transferIn - r.transferOut, cur)}
                  {cell(r.closing, cur)}
                </tr>
              );
            })}
          </tbody>
          {showTotal && currency ? (
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

export default async function Home() {
  const sb = supabaseServer();

  const { data: accountsRaw } = await sb
    .from("accounts")
    .select("id, company, label, currency, cadence")
    .eq("is_active", true)
    .order("cadence", { ascending: true })
    .order("label", { ascending: true });
  const accounts = (accountsRaw || []) as Account[];

  const weekly = await latestPeriod(sb, "weekly");
  const monthly = await latestPeriod(sb, "monthly");

  const periodIds = [weekly?.id, monthly?.id].filter(Boolean) as string[];

  const { data: balancesRaw } = await sb
    .from("balances").select("account_id, period_id, opening").in("period_id", periodIds);
  const { data: txnsRaw } = await sb
    .from("transactions").select("account_id, period_id, amount, direction, is_transfer")
    .eq("status", "confirmed").in("period_id", periodIds);
  const { data: transfersRaw } = await sb
    .from("transfers").select("from_account_id, to_account_id, amount, period_id").in("period_id", periodIds);

  const openingsFor = (periodId?: string): Record<string, number> => {
    const map: Record<string, number> = {};
    (balancesRaw || []).filter((b) => b.period_id === periodId).forEach((b) => { map[b.account_id] = Number(b.opening); });
    return map;
  };
  const txnsFor = (periodId?: string): Transaction[] =>
    (txnsRaw || []).filter((t) => t.period_id === periodId).map((t) => ({
      accountId: t.account_id, amount: Number(t.amount), direction: t.direction, isTransfer: t.is_transfer,
    }));
  const transfersFor = (periodId?: string): Transfer[] =>
    (transfersRaw || []).filter((t) => t.period_id === periodId).map((t) => ({
      fromAccountId: t.from_account_id, toAccountId: t.to_account_id, amount: Number(t.amount),
    }));

  const ngnAccounts = accounts.filter((a) => a.cadence === "weekly");
  const fxAccounts = accounts.filter((a) => a.cadence === "monthly");

  const ngnResults = computePeriod(openingsFor(weekly?.id), txnsFor(weekly?.id), transfersFor(weekly?.id));
  const fxResults = computePeriod(openingsFor(monthly?.id), txnsFor(monthly?.id), transfersFor(monthly?.id));

  return (
    <div className="wrap">
      <header className="site">
        <div>
          <h1>Cash Position</h1>
          <div className="meta">Metis Capital — group cash tracker</div>
        </div>
        <form action="/api/logout" method="post">
          <button className="linkbtn" type="submit">Sign out</button>
        </form>
      </header>

      <Board title="NGN Weekly" period={weekly?.label || "—"} accounts={ngnAccounts}
        results={ngnResults} showTotal currency="NGN" />

      <Board title="Foreign Monthly" period={monthly?.label || "—"} accounts={fxAccounts}
        results={fxResults} showTotal={false} />

      <div className="eyebrow">Record activity</div>
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
              <div className="field">
                <label htmlFor="t-date">Date</label>
                <input id="t-date" name="txn_date" type="date" required />
              </div>
              <div className="field">
                <label htmlFor="t-dir">Direction</label>
                <select id="t-dir" name="direction" required>
                  <option value="inflow">Inflow</option>
                  <option value="outflow">Outflow</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="t-desc">Description</label>
              <input id="t-desc" name="description" type="text" placeholder="e.g. Payroll" />
            </div>
            <div className="field">
              <label htmlFor="t-amt">Amount</label>
              <input id="t-amt" name="amount" type="number" step="0.01" min="0" required />
            </div>
            <button className="submit" type="submit">Record transaction</button>
          </form>
        </div>

        <div className="panel">
          <h3>Add inter-company transfer</h3>
          <form action={addTransfer}>
            <div className="row2">
              <div className="field">
                <label htmlFor="tr-from">From</label>
                <select id="tr-from" name="from_account_id" required>
                  {ngnAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="tr-to">To</label>
                <select id="tr-to" name="to_account_id" required>
                  {ngnAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="tr-desc">Description</label>
              <input id="tr-desc" name="description" type="text" placeholder="e.g. Working capital" />
            </div>
            <div className="field">
              <label htmlFor="tr-amt">Amount (NGN)</label>
              <input id="tr-amt" name="amount" type="number" step="0.01" min="0" required />
            </div>
            <button className="submit" type="submit">Record transfer</button>
          </form>
        </div>
      </div>
    </div>
  );
}
