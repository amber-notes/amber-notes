import type { Metadata } from "next";
import { readResetLink } from "@/lib/password-reset";
import { Foot, Shell, Stage, TopBar } from "@/lib/ui";
import ResetPassword from "./ResetPassword";

// Where the reset email's button lands (supabase/templates/recovery.html), and where "Forgot
// password?" on /connect sends you. The server only decides which screen to draw; the link is spent
// in the browser, and only when Save is pressed (lib/password-reset.ts).
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reset your password · Amber Notes", robots: { index: false, follow: false } };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const query = new URLSearchParams(Object.entries(raw).flatMap(([k, v]) => typeof v === "string" ? [[k, v]] : []));
  const link = readResetLink(query, new URLSearchParams());
  return (
    <Shell>
      <TopBar />
      <Stage>
        <ResetPassword
          initial={link.kind === "token" ? "form" : link.kind === "refused" ? "expired" : "request"}
          supabaseURL={process.env.SUPABASE_URL ?? ""}
          anonKey={process.env.SUPABASE_ANON_KEY ?? ""}
        />
      </Stage>
      <Foot><a href="/help">Help</a><a href="/privacy">Privacy</a><a href="/support">Support</a></Foot>
    </Shell>
  );
}
