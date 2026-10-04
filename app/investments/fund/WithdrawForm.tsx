"use client";

import { useMemo, useState } from "react";
import { priceAt, withdrawableOn, type FundHolding, type FundRate, type FundWithdrawal } from "@/lib/fundEngine";

export function WithdrawForm({
  holdingId, holding, rates, withdrawals, today, action,
}: {
  holdingId: string; holding: FundHolding; rates: FundRate[]; withdrawals: FundWithdrawal[];
  today: string; action: (fd: FormData) => void;
}) {
  const [date, setDate] = useState(today);
  const [units, setUnits] = useState("");
  const [all, setAll] = useState(false);
  const avail = useMemo(() => (date ? withdrawableOn(holding, withdrawals, date) : 0), [date, holding, withdrawals]);
  const price = useMemo(() => (date ? priceAt(holding, rates, date) : 0), [date, holding, rates]);
  const u = all ? avail : parseFloat(units);
  const f2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const over = !all && !isNaN(u) && u > avail + 0.00005;

  return (
    <form action={action} className="fund-form">
      <input type="hidden" name="holding_id" value={holdingId} />
      <div className="fund-form-row">
        <label className="field-inline"><span>Date</span>
          <input type="date" name="withdrawal_date" required min={holding.startDate} max={today} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field-inline"><span>Units</span>
          <input type="number" name="units" step="0.0001" min="0" placeholder={`max ${f2(avail)}`} disabled={all}
            value={all ? avail.toFixed(4) : units} onChange={(e) => setUnits(e.target.value)} /></label>
        <label className="check"><input type="checkbox" name="all_units" checked={all} onChange={(e) => setAll(e.target.checked)} /> All units</label>
        <button type="submit" className="btn-primary" disabled={over || avail <= 0}>{all ? "Liquidate position" : "Withdraw"}</button>
      </div>
      <span className={`num small ${over ? "warn-text" : "muted"}`}>
        {avail <= 0 ? "No units available on this date."
          : over ? `Only ${f2(avail)} units can be withdrawn on this date.`
          : !isNaN(u) && u > 0 ? `≈ ₦${f2(u * price)} at ₦${f2(price)} per unit`
          : `${f2(avail)} units available · implied price ₦${f2(price)}`}
      </span>
    </form>
  );
}
