import { AppShell } from "../ui";

// Wraps the existing History page(s) in the dashboard shell.
export default function HistoryLayout({ children }: { children: React.ReactNode }) {
  return <AppShell active="history" title="History" sub="Audit trail of statement imports, payment requests and manual entries"><div className="legacy">{children}</div></AppShell>;
}
