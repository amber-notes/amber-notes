import { renderCard } from "@/lib/og/render";

export { size, contentType } from "@/lib/og/render";
export const alt = "Amber Notes templates: note templates that ChatGPT, Claude and Claude Code fill in for you.";

export default function OpenGraphImage() {
  return renderCard({
    theme: "cream",
    title: "Templates [your AI] fills in.",
    sub: "Habit trackers, meeting notes, standups, meal plans and more, each with the prompt for ChatGPT, Claude and Claude Code.",
    chips: ["Free", "ChatGPT", "Claude", "Claude Code"],
    art: "icon",
    titleSize: 84,
  });
}
