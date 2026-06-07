import { supabaseServer } from "@/lib/supabaseServer";
import { importStatement } from "./actions";

export const dynamic = "force-dynamic";

type Account = { id: string; label: string; cadence: "weekly" | "monthly" };

export default async function ImportPage({ searchParams }: { searchParams: { error?: string } }) {
  const sb = supabaseServer();
  const { data: accountsRaw } = await sb
    .from("accounts")
    .select("id, label, cadence")
    .eq("cadence", "weekly")
    .eq("is_active", true)
    .order("label");
  const accounts = (accountsRaw || []) as Account[];

  return (
    <div className="wrap">
      <header className="site">
        <div>
          <h1>Import Statement</h1>
          <div className="meta">Upload an Excel bank statement to populate the dashboard</div>
        </div>
        <a className="linkbtn" href="/">← Back to dashboard</a>
      </header>

      {searchParams.error ? (
        <div className="banner">
          <strong>Import failed</strong>
          <ul><li>{searchParams.error}</li></ul>
        </div>
      ) : null}

      <div className="card import-card">
        <form action={importStatement} encType="multipart/form-data">
          <div className="field">
            <label htmlFor="acct">Account</label>
            <select id="acct" name="account_id" required defaultValue="">
              <option value="" disabled>Choose a company…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="file">Statement file (.xlsx)</label>
            <input id="file" name="file" type="file" accept=".xlsx" required />
          </div>
          <button className="submit" type="submit">Parse and import</button>
        </form>

        <div className="import-help">
          <h3>How it works</h3>
          <p>
            The app reads the bank&apos;s own opening balance and date range straight from the
            file header, builds (or finds) a matching period, and replaces this account&apos;s
            transactions in that period with the parsed ones. Your dashboard&apos;s closing
            balance for the account will equal the bank&apos;s stated closing to the kobo.
          </p>
          <p>
            Re-uploading the same statement is safe — it refreshes the data rather than
            duplicating it.
          </p>
          <p className="dim">
            Expected layout: header rows 1–14 (OPENING BAL, CLOSING BAL, START DATE, END DATE,
            CURRENCY, …), followed by a column-header row containing &quot;TXN DATE&quot; and
            transactions with TXN DATE · VAL DATE · REMARKS · DEBIT · CREDIT · BALANCE.
          </p>
        </div>
      </div>
    </div>
  );
}
