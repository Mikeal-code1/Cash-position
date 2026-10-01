import { AppShell } from "../ui";

// Wraps the existing Investments page(s) in the dashboard shell.
export default function InvestmentsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell active="investments" title="Investments" sub="Money-market and fixed-income placements"><div className="legacy">{children}</div></AppShell>;
}
