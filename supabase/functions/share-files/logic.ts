// Pure pieces of share-files, unit-tested without a server.

/** Attachment ids a note body links to, as `[name](pane-file:<id>)` or `![name](pane-file:<id>)`. */
export function referencedFiles(body: string): string[] {
  const ids = new Set<string>();
  for (const m of body.matchAll(/\]\(pane-file:([0-9a-fA-F-]{36})\)/g)) ids.add(m[1].toLowerCase());
  return [...ids].slice(0, 200);
}

/** A fixed-window counter per key; good enough to stop one client hammering the function. */
export class RateLimiter {
  private hits = new Map<string, { count: number; reset: number }>();
  constructor(private limit: number, private windowMs: number) {}
  allow(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h || now >= h.reset) {
      if (this.hits.size > 10_000) this.hits.clear();
      this.hits.set(key, { count: 1, reset: now + this.windowMs });
      return true;
    }
    h.count += 1;
    return h.count <= this.limit;
  }
}

/** The address of one file on a shared page, relative to the Supabase URL. */
export function filePath(slug: string, id: string, sub?: string | null): string {
  const q = new URLSearchParams({ slug, file: id.toLowerCase() });
  if (sub) q.set("sub", sub.toLowerCase());
  return `/functions/v1/share-files?${q}`;
}

// A stored type is a MIME type or a UTType identifier from the apps; anything else goes by the
// name's extension.
const UTI: Record<string, string> = {
  "public.png": "image/png", "public.jpeg": "image/jpeg", "public.heic": "image/heic", "public.heif": "image/heif",
  "com.compuserve.gif": "image/gif", "org.webmproject.webp": "image/webp", "public.webp": "image/webp", "public.avif": "image/avif",
  "com.adobe.pdf": "application/pdf", "public.mpeg-4": "video/mp4", "com.apple.quicktime-movie": "video/quicktime",
  "public.mp3": "audio/mpeg", "public.mpeg-4-audio": "audio/mp4", "com.apple.m4a-audio": "audio/mp4",
  "public.plain-text": "text/plain", "public.utf8-plain-text": "text/plain",
};
const EXTENSIONS: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", heic: "image/heic", gif: "image/gif", webp: "image/webp", avif: "image/avif",
  pdf: "application/pdf", mp4: "video/mp4", mov: "video/quicktime", mp3: "audio/mpeg", m4a: "audio/mp4", txt: "text/plain",
};
/** What a browser may show in place. Everything else (HTML, SVG, scripts…) is only downloaded. */
const INLINE = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/heic", "image/heif",
  "application/pdf", "video/mp4", "video/quicktime", "audio/mpeg", "audio/mp4", "text/plain",
]);

/** The content type a stored file is served with, and whether it's shown in place. */
export function servedType(stored: string, name: string): { type: string; inline: boolean } {
  const t = stored.trim().toLowerCase().split(";")[0].trim();
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const mime = /^[a-z]+\/[a-z0-9.+-]+$/.test(t) ? t : UTI[t] ?? (ext ? EXTENSIONS[ext] : undefined) ?? "application/octet-stream";
  if (!INLINE.has(mime)) return { type: "application/octet-stream", inline: false };
  return { type: mime === "text/plain" ? "text/plain; charset=utf-8" : mime, inline: true };
}

/** A Content-Disposition with the file's name: a plain ASCII fallback and the exact name (RFC 6266). */
export function contentDisposition(name: string, inline: boolean): string {
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, "").trim() || "file";
  const ascii = clean.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/["\;]/g, "_").trim() || "file";
  const exact = encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${exact}`;
}

export const SLUG = /^[A-Za-z0-9_-]{24,64}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
