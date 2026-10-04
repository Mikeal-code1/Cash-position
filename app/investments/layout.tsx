import { AppShell } from "../ui";
import { InvTabs } from "./InvTabs";

// Wraps the Investments pages (money market and mutual fund) in the dashboard shell.
export default function InvestmentsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell active="investments" title="Investments" sub="Money-market placements and mutual fund holdings">
      <InvTabs />
      <div className="legacy">{children}</div>
    </AppShell>
  );
}
