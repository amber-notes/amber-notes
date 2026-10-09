# Pinto Notes plugin for Claude Code

Adds the [Pinto Notes](https://pintonotes.com) MCP server (`https://mcp.ambernotes.app`) to Claude Code, with a skill that tells Claude how the notes are laid out and how to edit them safely.

Pinto Notes was called Amber Notes until October 2026. The plugin, the marketplace and the server keep the name `amber-notes`, and the server keeps its address, so nothing you installed stops working.

```sh
claude plugin marketplace add pinto-notes/pinto-notes
claude plugin install amber-notes@amber-notes
```

Then start Claude Code, run `/mcp`, pick `amber-notes` and sign in. Your browser opens pintonotes.com/connect, where you approve Claude Code with read and edit, or read only access. You need the free Pinto Notes app and an account.

Prefer an access token? In Pinto Notes, open Settings, Connect an AI, Claude Code. It adds the server with a token instead, and you don't need this plugin. [The setup guide](https://pintonotes.com/blog/notes-in-claude-code-and-codex) covers both.
