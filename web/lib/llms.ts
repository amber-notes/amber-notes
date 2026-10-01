import { FACTS, MCP_URL, WHAT_IT_IS } from "./facts";
import { GITHUB_URL } from "./github";
import { published } from "./posts";
import { searchTitle, templates } from "./templates";
import { MCP_TOOLS } from "./mcp-tools";
import { INCREDIBLE_URL, MAKER_URL, SITE_URL } from "./site";
import { FAQ } from "../app/help/questions";

/// /llms.txt (llmstxt.org): a plain summary for AI assistants and agents, with links to the pages
/// that answer questions about Amber Notes. /llms-full.txt adds the help answers and the MCP tools.

function summary(): string[] {
  return [
    "# Amber Notes",
    "",
    `> ${WHAT_IT_IS}`,
    "",
    `Not to be confused with other products called AmberNotes or Amber Notes (meeting transcription and AI note-taking services). This one is the notes app at ambernotes.app, made by Emil Wagman (${MAKER_URL}) at Incredible (${INCREDIBLE_URL}).`,
    "",
    "## Facts",
    "",
    ...FACTS.map((f) => `- ${f}`),
    "",
    "## Connect an AI (MCP)",
    "",
    `- MCP server (Streamable HTTP, OAuth 2.1 sign-in or a bearer access token): ${MCP_URL}`,
    "- ChatGPT: add it as your own app in Developer mode (Plus, Pro, Business, Enterprise or Edu, on the web), choose OAuth, then Allow in Amber Notes.",
    "- Claude: add it as a custom connector (every plan; the free plan includes one), then Allow in Amber Notes.",
    "- Claude Code and Codex: an access token from Amber Notes, Settings, Connect an AI, sent as an Authorization header.",
    "- Claude Code plugin: `claude plugin marketplace add emilwagman/amber-notes`, then `claude plugin install amber-notes`, then sign in from /mcp.",
    `- Codex, Gemini CLI and VS Code: one command each at ${SITE_URL}/blog/mcp-server#install; each signs in with OAuth in the browser.`,
    `- Incredible (${INCREDIBLE_URL}), a desktop app for Mac and Windows: in Apps, search for Amber Notes and choose Connect, then Allow in Amber Notes (it shows as an app on this computer). On an older Incredible, add ${MCP_URL} as an MCP server instead.`,
    "- Any other app that supports MCP: add the server address and sign in, then Allow in Amber Notes.",
    `- Full details: ${SITE_URL}/blog/mcp-server`,
    "",
    "## Blog posts",
    "",
    ...published().map((p) => `- [${p.title}](${SITE_URL}/blog/${p.slug}): ${p.description}`),
    "",
    "## Templates",
    "",
    "Note templates with the prompt that lets an AI fill them in through the MCP tools. Each page has the note, the prompt for ChatGPT, Claude and Claude Code, and a filled-in example; the same data is at /templates/<slug>.json.",
    "",
    `- [All templates](${SITE_URL}/templates)`,
    ...templates().map((t) => `- [${searchTitle(t)}](${SITE_URL}/templates/${t.slug}): ${t.description}`),
    "",
    "## More",
    "",
    `- [Download for Mac](${SITE_URL}/download): free, macOS 26 or later.`,
    `- [Help and FAQ](${SITE_URL}/help)`,
    `- [Changelog](${SITE_URL}/changelog)`,
    `- [Privacy & Security](${SITE_URL}/privacy-security): what's stored, what's encrypted, every log and how long it's kept.`,
    `- [Privacy policy](${SITE_URL}/privacy)`,
    `- [Source code on GitHub](${GITHUB_URL}) (MIT license)`,
  ];
}

export function llmsTxt(): string {
  return summary().join("\n") + "\n";
}

export function llmsFullTxt(): string {
  return [
    ...summary(),
    "",
    "## Help",
    "",
    ...FAQ.flatMap((q) => [`### ${q.q}`, "", ...q.a.flatMap((p) => [p, ""])]),
    "## MCP tools",
    "",
    "A read-only connection sees only the tools marked read.",
    "",
    ...MCP_TOOLS.map((t) => `- \`${t.name}\` (${t.kind}): ${t.description}`),
  ].join("\n") + "\n";
}
