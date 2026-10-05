# Amber Notes plugin for Claude Code

Adds the [Amber Notes](https://ambernotes.app) MCP server (`https://mcp.ambernotes.app`) to Claude Code, with a skill that tells Claude how the notes are laid out and how to edit them safely.

```sh
claude plugin marketplace add amber-notes/amber-notes
claude plugin install amber-notes@amber-notes
```

Then start Claude Code, run `/mcp`, pick `amber-notes` and sign in. Your browser opens ambernotes.app/connect, where you approve Claude Code with read and edit, or read only access. You need the free Amber Notes app and an account.

Prefer an access token? In Amber Notes, open Settings, Connect an AI, Claude Code. It adds the server with a token instead, and you don't need this plugin. [The setup guide](https://ambernotes.app/blog/notes-in-claude-code-and-codex) covers both.

## Skills

- `amber-notes`: how the notes are laid out and how to edit them safely.
- `note-pages`: building and editing note pages (small sandboxed apps over a note's data) and putting data into them: the page guide (`references/guide.md`, generated from the server's `page_guide.ts`) and seven tested templates (`templates/`). The server serves the same guide and templates through `get_page_guide`, so clients without skills get them too.
