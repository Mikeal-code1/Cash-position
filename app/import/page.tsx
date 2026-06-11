import { supabaseServer } from "@/lib/supabaseServer";
import { importStatement } from "./actions";

export const dynamic = "force-dynamic";

type Account = { id: string; label: string; cadence: "weekly" | "monthly"; currency: string };

export default async function ImportPage({ searchParams }: { searchParams: { error?: string } }) {
  const sb = supabaseServer();
  const { data: accountsRaw } = await sb
    .from("accounts")
    .select("id, label, cadence, currency")
    .eq("is_active", true)
    .order("cadence")
    .order("label");
  const accounts = (accountsRaw || []) as Account[];
  const ngn = accounts.filter((a) => a.cadence === "weekly");
  const foreign = accounts.filter((a) => a.cadence === "monthly");

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
              <option value="" disabled>Choose an account…</option>
              <optgroup label="NGN — weekly board">
                {ngn.map((a) => (
                  <option key={a.id} value={a.id}>{a.label} ({a.currency})</option>
                ))}
              </optgroup>
              <optgroup label="Foreign — monthly board">
                {foreign.map((a) => (
                  <option key={a.id} value={a.id}>{a.label} ({a.currency})</option>
                ))}
              </optgroup>
            </select>
          </div>
          <div className="field">
            <label htmlFor="file">Statement file (.xlsx or .pdf)</label>
            <input id="file" name="file" type="file" accept=".xlsx,.pdf" required />
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
            Supported formats — Excel: the standard layout with header rows (OPENING BAL,
            CLOSING BAL, START DATE, END DATE, CURRENCY) and a &quot;TXN DATE&quot; column row.
            PDF: FSDH Merchant Bank (&quot;Customer Statement of Account&quot;) and FAB First Abu
            Dhabi Bank statements. Every import is reconciled against the bank&apos;s stated
            closing balance before anything is saved, and the statement&apos;s currency must
            match the selected account&apos;s currency.
          </p>
        </div>
      </div>
    </div>
  );
}
