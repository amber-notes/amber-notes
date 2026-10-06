# amber: Amber Notes from the terminal

`amber` reads and edits your Amber Notes from a terminal, on macOS and Linux. It gives you the same
verbs Amber Notes gives AIs (search, list, read, create, edit, write, move, delete, history,
restore, pin), so a person and an agent like Claude Code use one tool the same way.

It's a thin client of the Amber Notes MCP server (`https://mcp.ambernotes.app`), the one Claude and
ChatGPT connect to. It signs in the same way they do: you approve it in Amber Notes.

## Install

Nothing is published yet; these are the planned commands.

```sh
curl -fsSL https://ambernotes.app/install.sh | sh
```

The script downloads the binary for your machine (macOS or Linux, Apple silicon / arm64 or
Intel / x64), checks it against `SHA256SUMS`, and puts it in `~/.local/bin`. No sudo. Set
`AMBER_INSTALL_DIR` to put it elsewhere.

With Homebrew (a tap of our own; homebrew-core already has an unrelated `amber`):

```sh
brew install amber-notes/tap/amber-notes
```

Or download `amber-<os>-<arch>` from the release, `chmod +x` it and put it on your PATH.

## Sign in

```sh
amber login
```

Your browser opens. Approve in Amber Notes on your iPhone or Mac, and you're done. In Settings ›
Connect an AI the connection shows as **An app on this computer**; Disconnect there turns this
terminal away, like any other connection. `amber logout` disconnects it from here.

- **On a server or over SSH** (no browser), `amber login` prints an address instead. Open it in any
  browser and approve. The browser then lands on a page that won't load (it points at the server's
  127.0.0.1): copy that page's address and paste it into the terminal.
- **Read only:** `amber login --read-only`.
- **CI and scripts:** set `AMBER_TOKEN` to an access token from Settings › Connect an AI, or save one
  with `amber login --token`.

Tokens are kept in the macOS Keychain, or on Linux in `~/.config/amber/credentials.json` (mode 600).
`amber` never prints them. The access token lasts an hour and renews itself; the refresh token is
single use, and amber processes take turns renewing it so running several at once is safe.

## Use

```sh
amber search butter                     # find notes by their words
amber list                              # folders, pinned and recently edited notes
amber list Work/                        # a folder
amber read "Work/Clients/Acme.md"       # the markdown, exactly; pipes cleanly
amber create Work "Standup

- Shipped the CLI"                      # the first line is the title
amber create Ideas/Garden.md < garden.md
amber edit Groceries.md "- [ ] Milk" "- [x] Milk"   # exact search and replace
amber write Work/Standup.md < standup.md            # replace the whole note
amber move Work/Standup.md Archive/
amber delete Ideas/Garden.md            # to Recently Deleted; amber restore brings it back
amber history Groceries.md
amber restore Groceries.md 12           # a version from history
amber pin Groceries.md                  # --off to unpin
```

Notes are paths like `Work/Acme.md`; folders end in `/`; a note's id works anywhere a path does.
`amber help` lists everything; `amber help edit` explains one command.

Output is plain text for people. `--json` prints the server's full answer, for scripts and agents.
Errors go to stderr with exit code 1.

## Agents

Allow your agent to run `amber`, and tell it the command exists. For Claude Code:

```sh
claude -p --allowedTools 'Bash(amber:*)' "Use the amber command (amber help) to ..."
```

`amber edit` is exact search and replace, like the coding agents' own Edit tool, and every change
keeps the previous version, so `amber history` and `amber restore` can undo it.

## What it can't do

- Locked notes stay locked: only the app opens them.
- Apps of notes and attached files: `amber read` shows what the server returns, but the verbs are
  made for notes.
- It needs the server's file-like tool set (`list`, `fetch`, `edit`, …). Until that ships, it says
  so instead of guessing.

## Development

```sh
cd cli
deno task test                    # unit tests
deno task compile                 # dist/amber-{macos,linux}-{arm64,x64} and dist/SHA256SUMS
deno run -A e2e/run.ts            # end to end: the compiled binary against the real MCP server
                                  # and OAuth (e2e/local_server.ts: in-process Postgres, no Docker)
deno run -A e2e/agent_demo.ts     # claude -p using amber against the same server
deno run -A e2e/local_server.ts --port 8787    # a local server to try amber by hand:
amber login --server http://127.0.0.1:8787/mcp
```

`packaging/homebrew/amber-notes.rb` is the formula (a draft until there's a release and a tap).
