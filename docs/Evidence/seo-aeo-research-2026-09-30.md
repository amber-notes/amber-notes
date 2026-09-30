# Search and AI-answer research, 30 September 2026

Research for getting Amber Notes found through Google and through AI assistants (ChatGPT, Claude,
Perplexity, Gemini). Done with web search and page fetches on 30 September 2026. Rankings change;
treat this as a snapshot.

## Method and limits

- About 30 queries, looking at the top results: who ranks, what kind of page it is, and how old or thin it is.
- **Google Trends failed.** Both the web page and the API returned HTTP 429, so there are no volume numbers.
  Google autocomplete (suggestqueries.google.com, US English) stood in as a weak signal: it only shows
  that a query is common enough to be suggested.
- ChatGPT and Claude weren't queried directly. The web search used here is the backend Claude's own
  answers draw on, so its results for question-style queries are a fair proxy for what Claude cites.
  ChatGPT's citations are inferred from the same pages.
- The OpenAI help center returned 403, so ChatGPT setup facts come from OpenAI's developer docs.

## The name collides

Other products use the name: ambernotes.ai ("AmberNotes App"), app.ambernotes.eu ("Amber Notes"), a
Google Play app "Amber Notes: AI Meeting Notes" (com.amberrecapp), and Amberscript's "Amber Notes" at
notes.amberscript.com. A search for the bare name isn't ours to win soon. Every page pairs the name with
what it is ("the notes app for iPhone and Mac"), and the JSON-LD ties the name to the GitHub repository.

## Shortlist, best first

| # | Query | Intent | Who ranks now | Our angle | Winnability |
|---|---|---|---|---|---|
| 1 | apple notes claude / connect apple notes to claude / apple notes claude connector | How-to | GitHub plugins, Medium, mcpmarket, usecarly (Jul 2026), geeky-gadgets | Honest answer: Mac only, not iPhone or web; the options side by side | High: thin pages; "apple notes and claude" is 3rd in autocomplete for "apple notes and" |
| 2 | can claude read my apple notes | Question | Medium, a dormant GitHub repo (sirmews), Claude help, usecarly | Direct yes/no, then a table of options | High |
| 3 | notes app with mcp server / mcp notes app / best notes app with mcp | Comparison | MCPNotes repo, sweetrb repo, mcpservers.org, Glama, Hjarni, App Store "MCP Notes" | A fair comparison table: hosted vs local, can it edit, open source | High for a comparison page; Hjarni already has one |
| 4 | codex notes / codex notes mcp | How-to | An UpNote fork, Amplenote help, Composio | Setup page with the real config lines | High, low volume |
| 5 | chatgpt connector notes / notes app that works with chatgpt | Commercial | SourceForge, 2022 Zoho posts, 2024 AppleInsider and MacRumors, OpenAI's OneNote page | Setup guide for Developer mode plus a notes app | Medium-high: stale results |
| 6 | apple notes mcp server / apple notes mcp | Developer | GitHub repos, PyPI, directories | Rank through GitHub and MCP directories, not the site | Medium |
| 7 | apple notes api | Informational | Wikipedia, Apple forums ("no public API") | "No API: what works instead" | Medium, weak fit |
| 8 | claude code notes | Mixed | GitHub plugins, makeuseof, inc.com | Claude Code setup page | Medium: split intent |
| 9 | claude connector notes | Commercial | Fellow, XDA, Claude help, Evernote's connector page | Connector guide; directory listing | Medium |
| 10 | best notes app for AI agents | Listicle | tana.inc, spinach, plaud, Hjarni | Own comparison; get into listicles | Medium |
| 11 | apple notes vs obsidian | Comparison | Medium, Obsidian forum, mattgiaro, AI-written pages | Three-way page with an Apple Notes-like app with AI access | Medium |
| 12 | how to connect apple notes to chatgpt | How-to | AppleInsider, MacRumors (Dec 2024), Elephas | Up-to-date guide: Work with Apps reads only the open note | Medium: authoritative but stale |
| 13 | apple notes chatgpt | Mixed | Forums, Tom's Guide, OpenAI help | Same page as 12 | Medium-low |
| 14 | apple notes vs notion | Comparison | fabric.so, Montaigne, super.so | Covered by a three-way page later | Medium-low |
| 15 | apple notes open source alternative | Listing | openalternative.co, AlternativeTo | Get listed there | Low for a page, high via listings |
| 16 | apple notes alternative (mac) | Listicle | Spike, ClickUp, pocket-lint, AlternativeTo, Zapier | AlternativeTo and listicle outreach | Low |
| 17 | let ai edit my notes | Fragmented | Medical and meeting tools | Post on approval, Undo and history | Medium, low value |
| 18 | apple notes export markdown / export apple notes | How-to | AppleInsider, Apple Support, exporters | Mention on the import page | Low: macOS 26 exports markdown natively |
| 19 | best note taking app / best notes app for mac 2026 | Head term | Zapier, Cloudwards, Setapp | Listicle outreach only | Low |
| 20 | best note taking app for AI | Head term | Meeting note-takers (Granola, Laxis) | Wrong intent | Low |

## What AI assistants cite, and why

For "can Claude read my Apple Notes" and "notes app that works with ChatGPT", the cited pages are:

1. **GitHub MCP repositories** (sweetrb/apple-notes-mcp, RafalWilinski, sirmews). The README title
   answers the question, install config is right there, and GitHub carries authority.
2. **MCP directories** (mcpmarket, mcpservers.org, Glama, PulseMCP, LobeHub). One page per server with
   a keyword-exact title and a list of tools. They copy READMEs, so one repo becomes several citable pages.
3. **Fresh "what it can and can't do" explainers** (usecarly, July 2026). A year in the title, a direct
   yes/no, and quotable sentences like "Claude's iPhone app has no path into Notes".
4. **Vendor comparison tables** (Hjarni's "MCP note app" page). A search summary for "notes app that
   claude or chatgpt can edit" was drawn almost entirely from that table.
5. **Official help pages** (Claude help center, OpenAI's OneNote page) for setup steps.

They win on: the question in the title, the answer in the first paragraph, tables and step lists, a
visible date, and GitHub or directory authority. Reddit didn't show up for these queries.

## Competitors in the exact position

- **Hjarni** (hjarni.com): hosted notes with an MCP server; iPhone, Mac, Android and web; free plan of 25 notes; not open source.
- **MCP Notes** (App Store id 6762989069): free, MIT, iPhone and Mac, with a local MCP server on the Mac.
- **Bear 2.8** (April 2026): official MCP server and Claude connector, both local on the Mac.
- **Notion**: official hosted MCP at mcp.notion.com with OAuth.
- **Evernote**: official hosted MCP, in beta; read, search and create.
- **Obsidian**: no official server; community plugins.
- **Apple Notes**: no API. The Claude desktop app has a desktop extension that reads Apple Notes on a Mac
  (Anthropic's tutorial: Claude "can read your Apple Notes on desktop"). Community AppleScript servers
  write to it on a Mac.

The gap Amber Notes fills: works like Apple Notes, reachable from phone and web, with approval, Undo and
version history, and open source.

## Connector setup facts (as of September 2026)

- **Claude** ([custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)):
  every plan; Free gets one custom connector. Customize, Connectors, +, Add custom connector. Team and
  Enterprise: an Owner adds it in Organization settings. The app's Connect guide uses Claude's documented
  prefilled install link.
- **Claude Code** ([docs](https://code.claude.com/docs/en/mcp)): `claude mcp add --transport http <name> <url>`, `--scope user` for every project.
- **ChatGPT** ([developer mode](https://developers.openai.com/api/docs/guides/developer-mode)): Plus, Pro,
  Business, Enterprise and Edu, on the web. Settings, Security and login, Developer mode; then Plugins, +.
  Connectors were renamed Plugins in July 2026, and older guides still say Connectors or Apps. One third
  party claims custom MCP now needs Business or higher; OpenAI's own doc says Plus and up. Re-check in a
  Plus account.
- **Codex** ([docs](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)): `[mcp_servers.<name>]` in `~/.codex/config.toml` with `url` and `http_headers`.

## Directories worth submitting to

| Where | Why |
|---|---|
| [Official MCP Registry](https://registry.modelcontextprotocol.io) | PulseMCP and other aggregators pull from it; `mcp-publisher` with a remote streamable-http entry |
| [Claude connectors directory](https://claude.ai/directory/manage) | Found inside Claude; needs tool titles and read-only/destructive hints (the server already has them), OAuth, privacy policy, a reviewer test account; about 2 weeks of review |
| [ChatGPT app directory](https://platform.openai.com/plugins) | One-click install without Developer mode, so free ChatGPT users could use it; needs org verification, test cases and a demo video |
| [Smithery](https://smithery.ai/new) | Large MCP index; accepts a remote URL |
| [mcp.so](https://mcp.so/submit) | Big MCP directory; free listing with review |
| [Glama](https://glama.ai/mcp/servers) | Has a note-taking category; feeds awesome-mcp-servers |
| [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | GitHub authority; mirrored by mcpservers.org; one-line PR |
| AlternativeTo (Apple Notes page) | Ranks for "apple notes alternative" |
| openalternative.co | Ranks for "apple notes open source alternative"; MIT qualifies |
| Product Hunt | Backlink and launch spike; launch once the iPhone app is live |

## Raw notes per query

- apple notes vs obsidian: Medium, forum.obsidian.md, mattgiaro.com, cote.io (Jan 2025), atlasworkspace.ai, TechRadar. Autocomplete: reddit, vs notion, 2025, 2026.
- apple notes vs notion: fabric.so (vendor), blog.montaigne.io, super.so, Medium, hulry.
- best note taking app: Zapier, Cloudwards, thedigitalprojectmanager, Wikipedia, noteapps.info.
- best note taking app for AI: Lindy, Laxis, Metaview, Zapier, Granola. All meeting-focused.
- how to connect apple notes to chatgpt: AppleInsider, MacRumors (2024-12-20), Elephas, Geeky Gadgets, Mac Observer. They describe Work with Apps, Apple Intelligence and Shortcuts.
- apple notes claude: ALucek/apple-notes, Medium Mac O'Clock, LeetaoGoooo plugin, mcpmarket, Claude help, inc.com.
- apple notes mcp server: sweetrb (active, about 139 stars), RafalWilinski (about 415 stars, dormant since Dec 2024), Siddhant-K-code, PyPI, mcpservers.org, PulseMCP, Glama.
- notes app with mcp server: MCPNotes, sweetrb, mcpservers.org, Glama category, devas.life (Inkdrop), evernote.com/mcp.
- mcp notes app: App Store "MCP Notes", MCPNotes repos. Autocomplete: "best notes app with mcp".
- claude code notes: plugin repos, Medium build logs, inc.com, makeuseof.
- codex notes mcp: upnote-mcp-codex, Amplenote help, Composio, OpenAI Codex MCP docs.
- apple notes alternative: Spike, ClickUp, pocket-lint, Saner.ai, AlternativeTo. Autocomplete: android, windows, reddit, free, open source.
- apple notes export markdown: AppleInsider (macOS 26 and iOS 26 export markdown natively), exporters, Apple Support.
- apple notes open source alternative: openalternative.co, AlternativeTo, bestalternative.dev, opentosh.
- chatgpt connector notes / notes app that works with chatgpt: AppleInsider, MacRumors, SourceForge, Tom's Guide, Elephas.
- claude connector notes: Fellow, XDA, Claude help, meetingnotes.com, Evernote connector page.
- apple notes api: Wikipedia, Apple developer forums (no public API), HN.
- best notes app for mac 2026: Setapp, timingapp, Zapier, Medium.
- best notes app for AI agents: tana.inc, spinach.ai, plaud, meetingnotes.com, Hjarni.
