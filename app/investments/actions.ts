"use server";

import { supabaseServer } from "@/lib/supabaseServer";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function addPlacement(formData: FormData) {
  const entity = String(formData.get("entity") || "").trim();
  const currency = String(formData.get("currency") || "NGN").toUpperCase();
  const startDate = String(formData.get("start_date") || "");
  const principal = Number(formData.get("principal") || 0);
  const tenorMonths = Number(formData.get("tenor_months") || 0);
  const rateOverrideRaw = String(formData.get("rate_override") || "").trim();
  const notes = String(formData.get("notes") || "").trim();

  if (!entity || !startDate || principal <= 0 || tenorMonths <= 0) {
    redirect("/investments?error=" + encodeURIComponent("Entity, start date, principal and tenor are required."));
  }
  // Rate entered as a percentage (e.g. 18.5) → stored as decimal 0.185
  let rateOverride: number | null = null;
  if (rateOverrideRaw !== "") {
    const pct = Number(rateOverrideRaw);
    if (isNaN(pct) || pct <= 0 || pct > 100) {
      redirect("/investments?error=" + encodeURIComponent("Rate override must be a percentage between 0 and 100."));
    }
    rateOverride = pct / 100;
  }

  const sb = supabaseServer();
  const { error } = await sb.from("placements").insert({
    entity, currency, start_date: startDate, principal,
    tenor_months: tenorMonths, rate_override: rateOverride,
    notes: notes || null,
  });
  if (error) redirect("/investments?error=" + encodeURIComponent("Insert failed: " + error.message));

  revalidatePath("/investments");
  redirect("/investments");
}

export async function recordRecall(formData: FormData) {
  const id = String(formData.get("placement_id") || "");
  const recallDate = String(formData.get("recall_date") || "");
  if (!id || !recallDate) return;

  const sb = supabaseServer();
  await sb.from("placements").update({ recall_date: recallDate }).eq("id", id);
  revalidatePath("/investments");
  redirect("/investments");
}

export async function clearRecall(formData: FormData) {
  const id = String(formData.get("placement_id") || "");
  if (!id) return;
  const sb = supabaseServer();
  await sb.from("placements").update({ recall_date: null }).eq("id", id);
  revalidatePath("/investments");
  redirect("/investments");
}

export async function updateSettings(formData: FormData) {
  const pct = (name: string, fallback: number) => {
    const v = Number(formData.get(name));
    return isNaN(v) || v < 0 || v > 100 ? fallback : v / 100;
  };
  const sb = supabaseServer();
  await sb.from("investment_settings").update({
    ngn_rate: pct("ngn_rate", 0.18),
    usd_rate: pct("usd_rate", 0.07),
    ngn_wht: pct("ngn_wht", 0.10),
    usd_wht: pct("usd_wht", 0),
    penalty: pct("penalty", 0),
    updated_at: new Date().toISOString(),
  }).eq("id", 1);
  revalidatePath("/investments");
  redirect("/investments");
}
