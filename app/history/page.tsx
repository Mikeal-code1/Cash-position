import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

type Run = {
  id: string;
  kind: "bank_statement" | "payment_request";
  original_filename: string;
  file_size_bytes: number | null;
  account_id: string | null;
  period_id: string | null;
  statement_start: string | null;
  statement_end: string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  txn_count: number | null;
  pr_inserted: number | null;
  pr_duplicates: number | null;
  pr_matched: number | null;
  pr_unmapped_codes: string | null;
  outcome: "success" | "failed" | "partial";
  error_message: string | null;
  notes: string | null;
  created_at: string;
};

function money(n: number | null, currency: string = "NGN") {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-NG", { style: "currency", currency, minimumFractionDigits: 2 }).format(Number(n));
}
function bytes(n: number | null) {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function whenFmt(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-NG", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default async function HistoryPage() {
  let sb;
  try { sb = supabaseServer(); }
  catch (e: any) { return <div className="wrap"><div className="banner"><strong>{e.message}</strong></div></div>; }

  const { data: runsRaw, error } = await sb
    .from("import_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return (
      <div className="wrap">
        <header className="site">
          <div><h1>Upload History</h1></div>
          <a className="linkbtn" href="/">← Back to dashboard</a>
        </header>
        <div className="banner">
          <strong>Couldn&apos;t load the history.</strong>
          <ul><li>{error.message}</li></ul>
          <div className="banner-hint">
            Have you run <code>schema_import_log.sql</code> in Supabase yet? That migration
            creates the <code>import_runs</code> table this page reads from.
          </div>
        </div>
      </div>
    );
  }

  // Map account ids to labels
  const acctIds = Array.from(new Set((runsRaw || []).map((r: any) => r.account_id).filter(Boolean)));
  const { data: accts } = acctIds.length
    ? await sb.from("accounts").select("id, label").in("id", acctIds)
    : { data: [] as any[] };
  const acctLabel = new Map((accts || []).map((a: any) => [a.id, a.label]));

  const runs = (runsRaw || []) as Run[];

  return (
    <div className="wrap">
      <header className="site">
        <div>
          <h1>Upload History</h1>
          <div className="meta">Audit trail of all bank statements and payment request uploads</div>
        </div>
        <a className="linkbtn" href="/">← Back to dashboard</a>
      </header>

      {runs.length === 0 ? (
        <div className="card" style={{ padding: 30, textAlign: "center" }}>
          <div className="dim">No uploads logged yet. Once you import a statement or payment request file, it&apos;ll appear here.</div>
        </div>
      ) : (
        <div className="card">
          <table className="history">
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>File</th>
                <th>Scope</th>
                <th>Detail</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="when">{whenFmt(r.created_at)}</td>
                  <td>
                    <span className={`kind-tag kind-${r.kind === "bank_statement" ? "stmt" : "pr"}`}>
                      {r.kind === "bank_statement" ? "Statement" : "Payment request"}
                    </span>
                  </td>
                  <td className="filename">
                    {r.original_filename}
                    <div className="dim small">{bytes(r.file_size_bytes)}</div>
                  </td>
                  <td>
                    {r.account_id ? acctLabel.get(r.account_id) || "—" : <span className="dim">(group)</span>}
                    {r.statement_start && r.statement_end ? (
                      <div className="dim small">{r.statement_start} → {r.statement_end}</div>
                    ) : null}
                  </td>
                  <td className="detail">
                    {r.kind === "bank_statement" ? (
                      <>
                        {r.txn_count != null ? <div>{r.txn_count} txns</div> : null}
                        {r.opening_balance != null ? (
                          <div className="dim small">
                            open {money(r.opening_balance)} → close {money(r.closing_balance)}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <div>
                          {r.pr_inserted ?? 0} new
                          {r.pr_duplicates ? `, ${r.pr_duplicates} dup` : ""}
                          {r.pr_matched ? `, ${r.pr_matched} matched` : ""}
                        </div>
                        {r.pr_unmapped_codes ? (
                          <div className="dim small">unmapped: {r.pr_unmapped_codes}</div>
                        ) : null}
                      </>
                    )}
                    {r.notes ? <div className="dim small">{r.notes}</div> : null}
                    {r.error_message ? <div className="error-msg">{r.error_message}</div> : null}
                  </td>
                  <td>
                    <span className={`outcome-tag outcome-${r.outcome}`}>{r.outcome}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="dim small" style={{ marginTop: 14 }}>Showing the {runs.length} most recent uploads.</p>
    </div>
  );
}
