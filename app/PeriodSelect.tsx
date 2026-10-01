"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function PeriodSelect({
  periods,
  current,
  param,
  label = "Select period",
}: {
  periods: { id: string; label: string }[];
  current: string;
  param: string;
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(sp.toString());
    params.set(param, e.target.value);
    // A new period invalidates any date slice of the old one.
    params.delete(param === "wk" ? "wkFrom" : "moFrom");
    params.delete(param === "wk" ? "wkTo" : "moTo");
    router.push(`${pathname || "/"}?${params.toString()}`);
  }

  if (periods.length === 0) return null;

  return (
    <select className="period-select" value={current} onChange={onChange} aria-label={label}>
      {periods.map((p) => (
        <option key={p.id} value={p.id}>{p.label}</option>
      ))}
    </select>
  );
}
