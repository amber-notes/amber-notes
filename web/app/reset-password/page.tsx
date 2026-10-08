import type { Metadata } from "next";
import { readResetLink } from "@/lib/password-reset";
import { Foot, Shell, Stage, TopBar } from "@/lib/ui";
import ResetPassword from "./ResetPassword";

// Where the reset email's button lands (supabase/templates/recovery.html), and where "Forgot
// password?" on /connect sends you. The token is in the fragment, so the server never sees it: the
// page reads it in the browser and spends it only when Save is pressed (lib/password-reset.ts). The
// server only tells a link Supabase refused (an error in the query) from everything else.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reset your password · Pinto Notes", robots: { index: false, follow: false } };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const query = new URLSearchParams(Object.entries(raw).flatMap(([k, v]) => typeof v === "string" ? [[k, v]] : []));
  const link = readResetLink(query, new URLSearchParams());
  return (
    <Shell>
      <TopBar />
      <Stage>
        <ResetPassword
          initial={link.kind === "refused" ? "expired" : "opening"}
          supabaseURL={process.env.SUPABASE_URL ?? ""}
          anonKey={process.env.SUPABASE_ANON_KEY ?? ""}
        />
      </Stage>
      <Foot><a href="/help">Help</a><a href="/privacy">Privacy</a><a href="/support">Support</a></Foot>
    </Shell>
  );
}
