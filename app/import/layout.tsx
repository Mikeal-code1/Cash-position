import { AppShell } from "../ui";

// Wraps the existing Import page(s) in the dashboard shell.
export default function ImportLayout({ children }: { children: React.ReactNode }) {
  return <AppShell active="import" title="Import" sub="Bank statements and payment requests"><div className="legacy">{children}</div></AppShell>;
}
