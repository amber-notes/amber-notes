import { renderCard } from "@/lib/og/render";

export { size, contentType } from "@/lib/og/render";
export const alt = "Pinto Notes help: importing Apple Notes, connecting your AI, sync and sharing.";

export default function OpenGraphImage() {
  return renderCard({
    theme: "leaf",
    title: "Help and [answers].",
    sub: "Short answers on importing, connecting your AI, sync and sharing, and how to reach me.",
    chips: ["Import Apple Notes", "Connect ChatGPT or Claude", "Sync"],
    art: "icon",
    titleSize: 84,
  });
}
