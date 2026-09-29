// Turns a note's markdown into safe HTML for its share page, the way the app shows it:
// checklists, tables, code, quotes, underline, images and files from the note, sub-note links.
import type { Element, ElementContent, Root } from "hast";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema, type Options as Schema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";

export type SharedFile = { url: string; name: string; type: string; size: number };
export type RenderOptions = {
  /** Signed URLs for the files this note links to, by attachment id. */
  files: Record<string, SharedFile>;
  /** Where a sub-note link goes, or null to show its name without a link. */
  subNoteHref: (id: string) => string | null;
};

/** The note's first line is its title; the page shows it separately. */
export function withoutTitle(body: string): string {
  const lines = body.replace(/^\s*\n/, "").split("\n");
  return lines.slice(1).join("\n").replace(/^\s*\n/, "");
}

const schema: Schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "u", "figure", "figcaption"],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "className"],
    // The default schema pins some classes (footnotes, task lists); ours are free-form.
    a: [...(defaultSchema.attributes?.a ?? []).filter((x) => !(Array.isArray(x) && x[0] === "className")), "className", "target", "rel", "download"],
    img: [...(defaultSchema.attributes?.img ?? []), "loading", "decoding"],
    input: [["type", "checkbox"], ["disabled", true], "checked"],
  },
  // Links are http(s) or mailto; our own sub-note pages are relative.
  protocols: { ...defaultSchema.protocols, href: ["http", "https", "mailto"], src: ["http", "https"] },
  // Keep the default "user-content-" prefix on id and name: without it a note could name
  // an element after something the page's own scripts look up (DOM clobbering).
};

const text = (value: string): ElementContent => ({ type: "text", value });
const el = (tagName: string, className: string[], children: ElementContent[], properties: Record<string, unknown> = {}): Element =>
  ({ type: "element", tagName, properties: { className, ...properties }, children });

function formatSize(bytes: number): string {
  if (!bytes) return "";
  const units = ["bytes", "KB", "MB", "GB"];
  let v = bytes, i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i += 1; }
  return `${i === 0 ? v : v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

function textOf(node: Element): string {
  let s = "";
  visit(node, "text", (t: { value: string }) => { s += t.value; });
  return s;
}

/** Rewrites Amber Notes' own links (pane-file:, pane-note:) into things a browser can open. */
function rehypeAmber(opts: RenderOptions) {
  return (tree: Root) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (!parent || index === undefined) return;
      if (node.tagName === "img") {
        const src = String(node.properties?.src ?? "");
        const id = src.match(/^pane-file:([0-9a-f-]{36})$/i)?.[1]?.toLowerCase();
        if (!id) return;
        const f = opts.files[id];
        parent.children[index] = f
          ? el("img", ["embed-image"], [], { src: f.url, alt: String(node.properties?.alt ?? f.name), loading: "lazy", decoding: "async" })
          : el("span", ["embed-missing"], [text(`${String(node.properties?.alt || "Image")} isn’t available`)]);
        return;
      }
      if (node.tagName !== "a") return;
      const href = String(node.properties?.href ?? "");
      const file = href.match(/^pane-file:([0-9a-f-]{36})$/i)?.[1]?.toLowerCase();
      if (file) {
        const f = opts.files[file];
        const name = textOf(node) || f?.name || "File";
        parent.children[index] = f
          ? el("a", ["file-chip"], [
              el("span", ["file-icon"], [text((f.name.split(".").pop() ?? "").slice(0, 4).toUpperCase() || "FILE")]),
              el("span", ["file-text"], [el("span", ["file-name"], [text(name)]), el("span", ["file-meta"], [text(formatSize(f.size))])]),
            ], { href: f.url, download: f.name, rel: ["noopener", "noreferrer"] })
          : el("span", ["embed-missing"], [text(`${name} isn’t available`)]);
        return;
      }
      const note = href.match(/^pane-note:([0-9a-f-]{36})$/i)?.[1]?.toLowerCase();
      if (note) {
        const target = opts.subNoteHref(note);
        const label = textOf(node) || "Sub-note";
        parent.children[index] = target
          ? el("a", ["subnote-chip"], [el("span", ["subnote-icon"], []), el("span", [], [text(label)])], { href: target })
          : el("span", ["subnote-plain"], [text(label)]);
        return;
      }
      node.properties = { ...node.properties, target: "_blank", rel: ["noopener", "noreferrer", "nofollow", "ugc"] };
    });
  };
}

export function renderNote(markdown: string, opts: RenderOptions): string {
  const file = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeAmber, opts)
    .use(rehypeSanitize, schema)
    .use(rehypeStringify)
    .processSync(markdown);
  return String(file);
}

/** A plain-text line for link previews. */
export function summary(markdown: string, max = 160): string {
  const plain = markdown
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, "")
    .replace(/[#>*_`|~<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? plain.slice(0, max - 1).trimEnd() + "…" : plain;
}
