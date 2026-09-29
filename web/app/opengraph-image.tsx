import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";

export const alt = "Amber Notes: the notes app your AI can actually use";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  const mark = `data:image/png;base64,${fs.readFileSync(path.join(process.cwd(), "public", "mark.png")).toString("base64")}`;
  const phone = `data:image/jpeg;base64,${fs.readFileSync(path.join(process.cwd(), "public", "hero-groceries.jpg")).toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#F0901A", padding: "0 0 0 80px", alignItems: "center", gap: 56 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 26, width: 620 }}>
          <img src={mark} width={96} height={96} style={{ borderRadius: 22 }} />
          <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.02, color: "#231400", letterSpacing: -2 }}>
            The notes app your AI can actually use.
          </div>
          <div style={{ fontSize: 28, color: "#3a1f0b", lineHeight: 1.35 }}>
            Simple notes for Mac and iPhone. ChatGPT and Claude can read and update them, with your approval.
          </div>
        </div>
        <div style={{ display: "flex", width: 420, height: 630, overflow: "hidden", alignItems: "flex-start", paddingTop: 70 }}>
          <div style={{ display: "flex", width: 360, height: 640, borderRadius: 52, border: "12px solid #17120d", overflow: "hidden", background: "#fff" }}>
            <img src={phone} width={336} height={730} />
          </div>
        </div>
      </div>
    ),
    size,
  );
}
