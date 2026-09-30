import { MCP_URL } from "./facts";

/// How to add Amber Notes to each AI coding tool, for the "Install in your AI tool" section of
/// /blog/mcp-server. Each format was checked against the tool's own documentation on 2026-09-30;
/// agent-installs.test.ts decodes the links to make sure they carry the right server.

/// The name each tool shows for the server.
export const SERVER_NAME = "amber-notes";

/// Cursor: cursor://anysphere.cursor-deeplink/mcp/install?name=…&config=<base64 of the server's JSON>.
export const CURSOR_LINK = `cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER_NAME}&config=${btoa(JSON.stringify({ url: MCP_URL }))}`;

/// VS Code: vscode:mcp/install?<URL-encoded JSON with the server's name>.
export const VSCODE_LINK = `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: SERVER_NAME, type: "http", url: MCP_URL }))}`;

/// Goose: goose://extension?type=streamable_http&url=…&id=…&name=…&description=…
export const GOOSE_LINK = "goose://extension?" + [
  "type=streamable_http",
  `url=${encodeURIComponent(MCP_URL)}`,
  `id=${SERVER_NAME}`,
  `name=${encodeURIComponent("Amber Notes")}`,
  `description=${encodeURIComponent("Search, read and edit your Amber Notes")}`,
].join("&");

export type AgentInstall = {
  tool: string;
  /// A one-click link, where the tool has one.
  link?: { href: string; text: string };
  /// A command to run or a config file to edit.
  code: string;
  /// Where the code goes, when it isn't a terminal command.
  file?: string;
  /// How the person signs in after adding it.
  signIn: string;
  /// A second way to add it.
  alt?: { text: string; code: string };
};

export const AGENT_INSTALLS: AgentInstall[] = [
  {
    tool: "Claude Code",
    code: `claude plugin marketplace add emilwagman/amber-notes
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
    code: `gemini extensions install https://github.com/emilwagman/amber-notes`,
    signIn: "Then run /mcp auth amber-notes in Gemini CLI to sign in.",
  },
  {
    tool: "VS Code",
    link: { href: VSCODE_LINK, text: "Add to VS Code" },
    code: `code --add-mcp '${JSON.stringify({ name: SERVER_NAME, type: "http", url: MCP_URL })}'`,
    signIn: "VS Code asks you to sign in when it first starts the server.",
  },
  {
    tool: "Cursor",
    link: { href: CURSOR_LINK, text: "Add to Cursor" },
    code: JSON.stringify({ mcpServers: { [SERVER_NAME]: { url: MCP_URL } } }, null, 2),
    file: "~/.cursor/mcp.json",
    signIn: "Then sign in from amber-notes in Cursor's MCP settings.",
  },
  {
    tool: "Goose",
    link: { href: GOOSE_LINK, text: "Add to Goose" },
    code: `goose configure`,
    signIn: "Or, in goose configure, choose Add Extension, then Remote Extension (Streamable HTTP), and give it the address above. Goose opens the sign-in page when it first connects.",
  },
  {
    tool: "Zed",
    code: JSON.stringify({ context_servers: { [SERVER_NAME]: { url: MCP_URL } } }, null, 2),
    file: "Zed's settings.json",
    signIn: "Zed asks you to sign in when it first connects.",
  },
  {
    tool: "Windsurf (Devin Desktop)",
    code: JSON.stringify({ mcpServers: { [SERVER_NAME]: { serverUrl: MCP_URL } } }, null, 2),
    file: "~/.config/devin/mcp_config.json",
    signIn: "It asks you to sign in when it first connects.",
  },
];
