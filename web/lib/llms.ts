import { FACTS, MCP_URL, WHAT_IT_IS } from "./facts";
import { GITHUB_URL } from "./github";
import { published } from "./guides";
import { MCP_TOOLS } from "./mcp-tools";
import { SITE_URL } from "./site";
import { FAQ } from "../app/help/questions";

/// /llms.txt (llmstxt.org): a plain summary for AI assistants and agents, with links to the pages
/// that answer questions about Amber Notes. /llms-full.txt adds the help answers and the MCP tools.

function summary(): string[] {
  return [
    "# Amber Notes",
    "",
    `> ${WHAT_IT_IS}`,
    "",
    "Not to be confused with other products called AmberNotes or Amber Notes (meeting transcription and AI note-taking services). This one is the notes app at ambernotes.app, made by Emil Wagman.",
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
    `- Full details: ${SITE_URL}/guides/mcp-server`,
    "",
    "## Guides",
    "",
    ...published().map((g) => `- [${g.title}](${SITE_URL}/guides/${g.slug}): ${g.description}`),
    "",
    "## More",
    "",
    `- [Download for Mac](${SITE_URL}/download): free, macOS 26 or later.`,
    `- [Help and FAQ](${SITE_URL}/help)`,
    `- [Changelog](${SITE_URL}/changelog)`,
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
