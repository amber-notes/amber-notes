import { MAC_DMG, countDownload, toFile } from "@/lib/downloads";

// Counts a Mac download, then sends the browser to the DMG (lib/downloads.ts).
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  await countDownload("mac");
  return toFile(MAC_DMG);
}

// A link checker or preview asking whether the address works isn't a download.
export function HEAD(): Response {
  return toFile(MAC_DMG);
}
