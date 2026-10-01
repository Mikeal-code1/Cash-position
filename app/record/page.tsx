import { loadDashboard } from "@/lib/dashboardData";
import { addTransaction, addTransfer, updateBalance } from "../actions";
import { AppShell, DataErrors, ResultBanners, Banner } from "../ui";
import { PeriodSelect } from "../PeriodSelect";

export const dynamic = "force-dynamic";
type SP = Record<string, string | undefined>;

export default async function RecordPage({ searchParams }: { searchParams: SP }) {
  const d = await loadDashboard(searchParams);
  if (d.fatal !== null) return <AppShell active="record" title="Manual entry"><Banner title={d.fatal} /></AppShell>;
  const ngnAccounts = d.accounts.filter((a) => a.cadence === "weekly");
  const accounts = d.accounts;

  return (
    <AppShell active="record" title="Manual entry"
      sub="Balance updates, transactions and inter-company transfers — imports are under Record › Import"
      actions={<PeriodSelect periods={d.weeklyList} current={d.wkId || ""} param="wk" label="NGN week" />}>
      <DataErrors errors={d.errors} />
      <ResultBanners sp={searchParams} />

      <div className="forms">
        <section className="card form-card" id="balance" aria-labelledby="b-h">
          <h2 id="b-h">Update a balance</h2>
          <p className="muted small">Temporary fix for NGN accounts without a statement. Applies to {d.wkPeriod?.label || "the latest week"}; accounts with an imported statement that week can&apos;t be overridden.</p>
          <form action={updateBalance}>
            <input type="hidden" name="period_id" value={d.wkId || ""} />
            <div className="field"><label htmlFor="b-acct">NGN account</label>
              <select id="b-acct" name="account_id" required defaultValue="">
                <option value="" disabled>Choose an account…</option>
                {ngnAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}{a.account_no && !a.label.includes(a.account_no) ? ` · ${a.account_no}` : ""}</option>)}
              </select></div>
            <div className="row2">
              <div className="field"><label htmlFor="b-asat">Balance as at</label><input id="b-asat" name="as_at" type="date" required /></div>
              <div className="field"><label htmlFor="b-bal">Balance (NGN)</label><input id="b-bal" name="balance" type="number" step="0.01" required /></div>
            </div>
            <button className="btn-primary" type="submit">Update balance</button>
          </form>
        </section>

        <section className="card form-card" id="transaction" aria-labelledby="t-h">
          <h2 id="t-h">Add transaction</h2>
          <p className="muted small">For movements not covered by an imported statement.</p>
          <form action={addTransaction}>
            <div className="field"><label htmlFor="t-acct">Account</label>
              <select id="t-acct" name="account_id" required>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.label} ({a.currency})</option>)}
              </select></div>
            <div className="row2">
              <div className="field"><label htmlFor="t-date">Date</label><input id="t-date" name="txn_date" type="date" required /></div>
              <div className="field"><label htmlFor="t-dir">Direction</label>
                <select id="t-dir" name="direction" required><option value="inflow">Inflow</option><option value="outflow">Outflow</option></select></div>
            </div>
            <div className="field"><label htmlFor="t-desc">Description</label><input id="t-desc" name="description" type="text" placeholder="e.g. Payroll" /></div>
            <div className="field"><label htmlFor="t-amt">Amount</label><input id="t-amt" name="amount" type="number" step="0.01" min="0" required /></div>
            <button className="btn-primary" type="submit">Record transaction</button>
          </form>
        </section>

        <section className="card form-card" id="transfer" aria-labelledby="tr-h">
          <h2 id="tr-h">Inter-company transfer</h2>
          <p className="muted small">Moves naira between entities; the group total is unchanged.</p>
          <form action={addTransfer}>
            <div className="row2">
              <div className="field"><label htmlFor="tr-from">From</label>
                <select id="tr-from" name="from_account_id" required>{ngnAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></div>
              <div className="field"><label htmlFor="tr-to">To</label>
                <select id="tr-to" name="to_account_id" required>{ngnAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></div>
            </div>
            <div className="field"><label htmlFor="tr-date">Date</label><input id="tr-date" name="transfer_date" type="date" required /></div>
            <div className="field"><label htmlFor="tr-desc">Description</label><input id="tr-desc" name="description" type="text" placeholder="e.g. Working capital" /></div>
            <div className="field"><label htmlFor="tr-amt">Amount (NGN)</label><input id="tr-amt" name="amount" type="number" step="0.01" min="0" required /></div>
            <button className="btn-primary" type="submit">Record transfer</button>
          </form>
        </section>
      </div>
    </AppShell>
  );
}
