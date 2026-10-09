import { renderCard } from "@/lib/og/render";

export { size, contentType } from "@/lib/og/render";
export const alt = "Pinto Notes: the notes app your AI can actually use. A note open on an iPhone.";

export default function OpenGraphImage() {
  return renderCard({
    theme: "cream",
    title: "The notes app | [your AI] can | actually use.",
    sub: "Simple notes for iPhone and Mac. ChatGPT and Claude can read and edit them, with your approval.",
    chips: ["Free", "Imports Apple Notes", "Open source"],
    art: "phone",
  });
}
