"use server";

import { supabaseServer } from "@/lib/supabaseServer";
import { withdrawableOn, type FundHolding, type FundWithdrawal } from "@/lib/fundEngine";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const today = () => new Date().toISOString().slice(0, 10);
const back = (msg: string, anchor = ""): never => redirect(`/investments/fund?fund_error=${encodeURIComponent(msg)}${anchor}`);

async function loadHolding(sb: ReturnType<typeof supabaseServer>, id: string) {
  const { data } = await sb.from("fund_holdings").select("id, start_date, start_value, start_units").eq("id", id).maybeSingle();
  return data as { id: string; start_date: string; start_value: number; start_units: number } | null;
}

export async function addFundRate(formData: FormData) {
  const holdingId = String(formData.get("holding_id") || "");
  const date = String(formData.get("effective_date") || "");
  const pct = Number(String(formData.get("annual_rate") ?? "").trim());
  const sb = supabaseServer();
  const h = await loadHolding(sb, holdingId);
  if (!h) back("Fund not found.", "#rates");
  if (!date || date <= h!.start_date) back(`Effective date must be after the start date (${h!.start_date}).`, "#rates");
  if (isNaN(pct) || pct < 0 || pct > 100) back("Rate must be a percentage between 0 and 100.", "#rates");
  const { error } = await sb.from("fund_rates").upsert(
    { holding_id: holdingId, effective_date: date, annual_rate: pct / 100, note: "Advised rate" },
    { onConflict: "holding_id,effective_date" },
  );
  if (error) back("Could not save rate: " + error.message, "#rates");
  revalidatePath("/investments/fund");
  redirect("/investments/fund?fund_ok=rate#rates");
}

export async function removeFundRate(formData: FormData) {
  const id = String(formData.get("rate_id") || "");
  const sb = supabaseServer();
  const { data: r } = await sb.from("fund_rates").select("id, effective_date, holding_id").eq("id", id).maybeSingle();
  if (!r) back("Rate not found.", "#rates");
  const h = await loadHolding(sb, (r as any).holding_id);
  if (h && (r as any).effective_date <= h.start_date) back("The base rate can't be removed; add a new dated rate instead.", "#rates");
  await sb.from("fund_rates").delete().eq("id", id);
  revalidatePath("/investments/fund");
  redirect("/investments/fund#rates");
}

export async function addFundWithdrawal(formData: FormData) {
  const holdingId = String(formData.get("holding_id") || "");
  const date = String(formData.get("withdrawal_date") || "");
  const all = formData.get("all_units") === "on";
  let units = Number(String(formData.get("units") ?? "").trim());
  const sb = supabaseServer();
  const h = await loadHolding(sb, holdingId);
  if (!h) back("Fund not found.", "#withdraw");
  if (!date || date < h!.start_date || date > today()) back(`Choose a date between ${h!.start_date} and today.`, "#withdraw");

  const { data: wdRows } = await sb.from("fund_withdrawals").select("withdrawal_date, units").eq("holding_id", holdingId);
  const holding: FundHolding = { startDate: h!.start_date, startValue: Number(h!.start_value), startUnits: Number(h!.start_units) };
  const wds: FundWithdrawal[] = (wdRows || []).map((w: any) => ({ date: w.withdrawal_date, units: Number(w.units) }));
  const available = withdrawableOn(holding, wds, date);
  if (all) units = available;
  if (isNaN(units) || units <= 0) back("Enter the number of units to withdraw.", "#withdraw");
  if (units > available + 0.00005) back(`Only ${available.toLocaleString("en-US", { maximumFractionDigits: 4 })} units can be withdrawn on ${date}.`, "#withdraw");

  const { error } = await sb.from("fund_withdrawals").insert({
    holding_id: holdingId, withdrawal_date: date, units: Math.round(units * 10000) / 10000,
    note: all ? "Full liquidation" : null,
  });
  if (error) back("Could not save withdrawal: " + error.message, "#withdraw");
  revalidatePath("/investments/fund");
  redirect("/investments/fund?fund_ok=withdrawal#withdraw");
}

export async function removeFundWithdrawal(formData: FormData) {
  const id = String(formData.get("withdrawal_id") || "");
  const sb = supabaseServer();
  await sb.from("fund_withdrawals").delete().eq("id", id);
  revalidatePath("/investments/fund");
  redirect("/investments/fund#withdraw");
}
