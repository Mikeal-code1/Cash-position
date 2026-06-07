import { importPaymentRequests } from "./actions";

export const dynamic = "force-dynamic";

export default function PaymentImportPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <div className="wrap">
      <header className="site">
        <div>
          <h1>Import Payment Requests</h1>
          <div className="meta">Upload an Excel of payment requests sent to the bank</div>
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
        <form action={importPaymentRequests} encType="multipart/form-data">
          <div className="field">
            <label htmlFor="file">Payment request file (.xlsx)</label>
            <input id="file" name="file" type="file" accept=".xlsx" required />
          </div>
          <button className="submit" type="submit">Parse and import</button>
        </form>

        <div className="import-help">
          <h3>How it works</h3>
          <p>
            Each row in the file becomes a <strong>pending payment request</strong>. The
            dashboard&apos;s liquidity panel shows pending amounts per company so you can
            see real-time available cash — bank closing minus what&apos;s queued for
            processing — before the bank moves on the requests.
          </p>
          <p>
            When you later import the matching bank statement, the app auto-matches each
            pending request to its bank transaction (same account, same amount, bank date
            within 21 days of the request) and marks it <strong>matched</strong>.
            Anything unmatched once the statement covers its date is flagged for review
            on the dashboard.
          </p>
          <p>
            Re-uploading the same file is safe — duplicate rows (same account, date,
            amount, description) are skipped automatically.
          </p>
          <p className="dim">
            Expected layout: rows with Date in column A, Amount in column G, Narration in
            column H, and CompanyCode in column I (Duval / Metis / NS / Havard). Subtotal
            rows are skipped automatically.
          </p>
        </div>
      </div>
    </div>
  );
}
