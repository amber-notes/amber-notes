import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PROMPTS from "@/lib/try-prompts.json";
import { Card, Foot, Shell, Stage, TopBar, ui } from "@/lib/ui";
import CopyPrompt from "./CopyPrompt";

// "Ask Claude" in the onboarding emails. Claude's web app no longer takes a prompt in its address,
// so this page holds the prompt and copies it on a tap, then opens Claude to paste it. Only the
// prompts the emails use (lib/try-prompts.json, the same list as
// supabase/functions/lifecycle/prompts.json): a page that copied any text from its address could be
// used to put someone else's words in a person's clipboard.
export const metadata: Metadata = { title: "Ask Claude · Pinto Notes", robots: { index: false, follow: false } };

export function generateStaticParams() {
  return PROMPTS.map((p) => ({ id: p.id }));
}

export default async function CopyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const prompt = PROMPTS.find((p) => p.id === id);
  if (!prompt) notFound();
  return (
    <Shell>
      <TopBar />
      <Stage>
        <Card>
          <div className={ui.group}>
            <h1 className={ui.title}>Ask Claude</h1>
            <p className={ui.lede}>Copy this, then paste it into a new chat in Claude.</p>
          </div>
          <CopyPrompt text={prompt.text} chatgpt={`https://chatgpt.com/?q=${encodeURIComponent(prompt.text)}`} />
        </Card>
      </Stage>
      <Foot><a href="/help">Help</a><a href="/privacy">Privacy</a></Foot>
    </Shell>
  );
}
