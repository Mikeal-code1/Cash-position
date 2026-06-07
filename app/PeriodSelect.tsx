"use client";

import { useRouter, useSearchParams } from "next/navigation";

export function PeriodSelect({
  periods,
  current,
  param,
}: {
  periods: { id: string; label: string }[];
  current: string;
  param: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(sp.toString());
    params.set(param, e.target.value);
    router.push(`/?${params.toString()}`);
  }

  if (periods.length === 0) return null;

  return (
    <select className="period-select" value={current} onChange={onChange} aria-label="Select period">
      {periods.map((p) => (
        <option key={p.id} value={p.id}>{p.label}</option>
      ))}
    </select>
  );
}
