"use client";

import { usePathname } from "next/navigation";

export function InvTabs() {
  const path = usePathname() || "";
  const fund = path.startsWith("/investments/fund");
  return (
    <nav className="inv-tabs" aria-label="Investment type">
      <a href="/investments" className={!fund ? "on" : ""} aria-current={!fund ? "page" : undefined}>Money market</a>
      <a href="/investments/fund" className={fund ? "on" : ""} aria-current={fund ? "page" : undefined}>Mutual fund</a>
    </nav>
  );
}
