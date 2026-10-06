# amber: your Amber Notes as a folder of markdown files

`amber` is a small command-line tool for Linux and macOS. It keeps a folder of plain `.md` files in
sync with an Amber Notes account, so the notes you see on your iPhone and Mac also sit on a server
as ordinary files. Your own scripts, search tools or MCP server can then read and write those files.

It is a plain MCP client: it talks to the same server that Claude and ChatGPT use
(`https://mcp.ambernotes.app`), with a token you make in the app. It needs no other service.

> **The folder is plain text.** Amber Notes is end-to-end encrypted, but `amber` decrypts your
> notes on the machine it runs on, by design: that is what makes them files your tools can read.
> Anyone who can read that folder can read your notes. Keep it on a disk and account you trust,
> and treat the token like a password.

## Install

Download the binary for your machine (`amber-linux-x64`, `amber-linux-arm64` or `amber-macos-arm64`),
then:

```sh
chmod +x amber-linux-x64
sudo mv amber-linux-x64 /usr/local/bin/amber
amber --version
```

To build them yourself (needs [Deno](https://deno.com) 2):

```sh
cd cli
deno task compile        # writes dist/amber-linux-x64, dist/amber-linux-arm64, dist/amber-macos-arm64
```

## Sign in

In Amber Notes, open **Settings › Connect an AI** and make a token (it starts with `pane_`). Then:

```sh
amber login              # paste the token; it isn't shown as you type
```

The token is saved in `~/.config/amber/config.json` (or `$XDG_CONFIG_HOME/amber/config.json`), mode
600. On a server you can skip the file and set `AMBER_TOKEN` in the environment instead.
`amber logout` removes the saved token. `amber` never prints or logs the token.

A token with read access is enough for `pull`; `sync` needs one that can write.

## Commands

```sh
amber pull ~/notes             # every note as ~/notes/<Folder>/<Title>.md; never changes the account
amber sync ~/notes             # one pass, both ways
amber sync ~/notes --watch     # keeps going: local changes go up within a second or two,
                               # the account is checked every 30 s (--interval 30)
amber status ~/notes           # the connection, and what changed here since the last sync
```

Options: `--server <url>` (or `AMBER_SERVER`), `--quiet`, and `--force` (see Safety below).

## How notes map to files

- A note is `<Folder>/<Title>.md`, with its exact markdown inside. The first line is the title, as in
  Amber, so renaming a file renames the note (and rewrites its first line), and changing the first
  line renames the file.
- A sub-note lives in a folder named after its parent: `Travel/Trip.md` and `Travel/Trip/Packing.md`.
  A new file in such a folder becomes a sub-note of that note.
- `[[wikilinks]]`, checklists, tables and every other line stay exactly as written.
- A new file whose first line isn't its name gets its name as the first line, so the title in Amber
  matches the file. (New notes made here always land in a folder; a file at the top of the sync
  folder goes into `Notes/`.)
- Two notes with the same title in one folder get two files: `Acme.md` and `Acme (1a2b3c4d).md`.
- Not synced: locked notes (only the app can open them), the apps of notes (`Note.app` folders; the
  note's text still syncs), files and images, and anything in a hidden folder (`.obsidian`, `.git`,
  `.amber`) or that isn't `.md`. Empty folders don't sync.

## Conflicts and deletes

`.amber/state.json` in the folder records, per note, the version both sides last agreed on and a hash
of its text. A sync compares each note against it:

- Changed on one side: the change is carried to the other.
- Changed on both sides with different text: **both are kept**. The account's text keeps the note's
  file, and this folder's text goes to `Title (conflict YYYY-MM-DD).md`, like Dropbox and Obsidian
  Sync do. That copy also goes up as its own note, so your phone shows both. Merge them and delete
  the copy.
- Deleted here: the note goes to Amber's Recently Deleted (restorable for 30 days).
- Deleted in Amber: the file moves to `.amber/trash/<date>/`.
- Deleted on one side but changed on the other: the change wins and nothing is deleted.

Edits go up as an exact search-and-replace of the changed lines (the files tools' `edit`), or a whole
`write` for big changes, and only if the note is still at the version the change was based on.

## Safety

- If more than half of the notes look deleted on one side at once (an unmounted disk, a token for
  another account), `amber` stops and changes nothing. Run again with `--force` if that's really
  what you want.
- A state folder belongs to one server; `amber` refuses to mix them.
- Every file is written whole (to a temporary file, then renamed), so your tools never read half a note.

## Run it as a service

### Linux (systemd, per user)

`~/.config/systemd/user/amber.service`:

```ini
[Unit]
Description=Amber Notes folder sync
After=network-online.target

[Service]
ExecStart=/usr/local/bin/amber sync %h/notes --watch --quiet
Restart=always
RestartSec=30
# Or leave the token in ~/.config/amber/config.json and drop this line:
EnvironmentFile=%h/.config/amber/env

[Install]
WantedBy=default.target
```

`~/.config/amber/env` (mode 600) holds `AMBER_TOKEN=pane_…`. Then:

```sh
systemctl --user daemon-reload
systemctl --user enable --now amber
loginctl enable-linger "$USER"     # keep it running when you're logged out
journalctl --user -u amber -f
```

### macOS (launchd)

`~/Library/LaunchAgents/app.ambernotes.sync.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>app.ambernotes.sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/amber</string>
    <string>sync</string>
    <string>/Users/you/notes</string>
    <string>--watch</string>
    <string>--quiet</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/you/Library/Logs/amber.log</string>
  <key>StandardErrorPath</key><string>/Users/you/Library/Logs/amber.log</string>
</dict>
</plist>
```

```sh
launchctl load ~/Library/LaunchAgents/app.ambernotes.sync.plist
```

## Your own tools on the folder

The folder is the interface: anything that reads and writes markdown files works, and `amber sync
--watch` carries the changes to your phone.

- **grep, ripgrep, scripts, cron jobs**: read and write the files directly.
- **Your own MCP server**: point a filesystem MCP server at the folder, for example
  `npx -y @modelcontextprotocol/server-filesystem ~/notes`, or your own. An agent that edits
  `~/notes/Work/Acme.md` edits the note in Amber within a second or two.
- **Obsidian**: the folder opens as a vault; `[[wikilinks]]` resolve by title, as in Amber.

Write whole files (or edit in place), keep the first line as the title, and leave `.amber/` alone.

## Which server tools it uses

`amber` works with both tool sets the Amber Notes MCP server offers and picks the one it finds:

- **files tools** (`list`, `fetch`, `create`, `edit`, `write`, `move`, `delete`): paths map one to
  one onto files, and `list { all: true }` returns every note with its version in one call, which is
  all a poll costs when nothing changed.
- **classic tools** (`list_notes`, `read_note`, `create_note`, `edit_note`, `replace_note_body`,
  `move_note`, `delete_note`), what production runs today: the same behavior, polling with
  `list_notes` (200 notes per call) and each note's updated time.

## Development

```sh
cd cli
deno task test                    # unit tests: paths, state file, the sync and its conflicts
deno task compile                 # the three binaries
deno run -A e2e/run.ts            # end to end: the compiled binary against the real MCP server
                                  # (e2e/local_server.ts: in-process Postgres, no Docker)
```
