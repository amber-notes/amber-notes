import { MCP_URL } from "./facts";

/// How to add Amber Notes to each AI tool, for the "Install in your AI tool" section of
/// /blog/mcp-server. Only tools whose install was run and whose sign-in reaches the consent page are
/// listed (checked 2026-09-30). Codex and VS Code sign in on 127.0.0.1, which reaches the server as
/// sent only with the proxy fix in middleware.ts (PR 47). Cursor isn't listed: it registers a
/// cursor:// redirect, which the server doesn't accept. Goose, Zed and Windsurf weren't checked.
/// The commands give mcp.pintonotes.com since 2026-10-09 (the same server; sign-in checked at that
/// address). The Claude Code plugin and the Gemini CLI extension still carry mcp.ambernotes.app.

/// The name each tool shows for the server.
export const SERVER_NAME = "amber-notes";

export type AgentInstall = {
  tool: string;
  /// A command to run.
  code?: string;
  /// Or steps to follow, for an app without a command line.
  steps?: string[];
  /// How the person signs in after adding it.
  signIn: string;
  /// A second way to add it.
  alt?: { text: string; code: string };
};

export const AGENT_INSTALLS: AgentInstall[] = [
  {
    tool: "Claude Code",
    code: `claude plugin marketplace add pinto-notes/pinto-notes
claude plugin install amber-notes`,
    signIn: "The plugin adds the server and a skill that tells Claude how your notes are laid out. Then run /mcp in Claude Code, pick amber-notes and sign in.",
    alt: { text: "Or add only the server, for every project:", code: `claude mcp add --scope user --transport http ${SERVER_NAME} ${MCP_URL}` },
  },
  {
    tool: "Codex",
    code: `codex mcp add amber_notes --url ${MCP_URL}`,
    signIn: "Codex starts the sign-in straight away. To sign in again later, run codex mcp login amber_notes.",
  },
  {
    tool: "Gemini CLI",
    code: `gemini extensions install https://github.com/pinto-notes/pinto-notes`,
    signIn: "Then run /mcp auth amber-notes in Gemini CLI to sign in.",
  },
  {
    tool: "VS Code",
    code: `code --add-mcp '${JSON.stringify({ name: SERVER_NAME, type: "http", url: MCP_URL })}'`,
    signIn: "The first time VS Code starts the server, it asks you to sign in.",
  },
  {
    // Amber Notes is one of Incredible's apps from the release that ships it (slug amber_notes).
    tool: "Incredible",
    steps: ["Open Apps and search for Amber Notes.", "Choose Connect, then Allow in Pinto Notes.", "Back in Incredible, choose Let's go."],
    signIn: `Pinto Notes shows it as an app on this computer that calls itself "incredible". Allow it only if you just chose Connect. On an older version of Incredible, choose Add it here at the bottom of Apps (or Add another MCP server), paste ${MCP_URL}, then Continue and Sign in, and Add server after you allow it.`,
  },
];
