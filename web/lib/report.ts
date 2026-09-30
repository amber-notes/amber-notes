"use server";
// Reports about shared pages go to the report_share RPC. Who reported is a salted hash of
// their network address (reporter.ts), so one person can't take a page down alone and no address
// is stored.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { reporterHash } from "./reporter";
import { validSlug } from "./shared";

const URL_ = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SALT = process.env.REPORT_SALT ?? "";

export type ReportOutcome = "received" | "taken_down" | "not_found" | "too_many" | "missing_reason" | "error";

export async function sendReport(form: FormData): Promise<void> {
  const slug = String(form.get("slug") ?? "");
  const reason = String(form.get("reason") ?? "").trim().slice(0, 1000);
  const contact = String(form.get("contact") ?? "").trim().slice(0, 200);
  if (!validSlug(slug)) redirect("/");
  let outcome: ReportOutcome;
  if (!reason) {
    outcome = "missing_reason";
  } else if (!URL_ || !KEY) {
    outcome = "error";
  } else {
    const h = await headers();
    const address = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "";
    try {
      const res = await fetch(`${URL_}/rest/v1/rpc/report_share`, {
        method: "POST",
        headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ p_slug: slug, p_reason: reason, p_reporter: reporterHash(address, SALT), p_contact: contact || null }),
        cache: "no-store",
      });
      if (res.ok) {
        const v = (await res.json()) as string;
        outcome = v === "taken_down" || v === "not_found" ? v : "received";
      } else {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        outcome = body.code === "P0429" ? "too_many" : body.code === "22023" ? "missing_reason" : "error";
      }
    } catch {
      outcome = "error";
    }
  }
  redirect(`/report/${slug}?sent=${outcome}`);
}
