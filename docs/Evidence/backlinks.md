# Backlinks and citations

> **8 October 2026:** the app is now Pinto Notes at https://pintonotes.com. ambernotes.app redirects there. The two open list pull requests (awesome-remote-mcp-servers #866, open-source-mac-os-apps #1459) were updated to the new name on 8 October. Use "Pinto Notes" and "pintonotes.com" in every new submission, and never the bare word "Pinto".

Where Amber Notes (ambernotes.app) is linked from, where it should be, and what each place needs. Checked on 2026-09-30. Research on search and AI citations is in [seo-aeo-research-2026-09-30.md](seo-aeo-research-2026-09-30.md); the Claude and ChatGPT directory listings are prepared in [directory-submissions.md](directory-submissions.md).

Two facts shape every submission:
- **Say "Amber Notes" and "ambernotes.app" together.** Other products share the name: Amberscript's transcription app at notes.amberscript.com, app.ambernotes.eu, ambernotes.ai, ambernotes.com and an Android app. A directory entry that only says "Amber Notes" can be matched to the wrong one.
- **Only the Mac app is out.** The iPhone app is in App Store review. Every text below says "iPhone coming soon", and nothing says it's on the App Store. BetaList and the Mac-news tip lines are timed for the iPhone release.

## 1. Log

Status on 2026-09-30. "Open" means the pull request is waiting for the list's maintainer.

| Target | Status | Link | Needs |
|---|---|---|---|
| Repo topics on amber-notes/amber-notes | Done | [repo](https://github.com/amber-notes/amber-notes) | Nothing. Added `mcp-server`, `model-context-protocol`, `note-taking`; kept the existing ones, description and homepage. |
| Official MCP Registry | Listed | `app.ambernotes/amber-notes` | Nothing. PulseMCP and mcp.directory import from it. |
| Glama connector | Listed | [glama.ai](https://glama.ai/mcp/connectors/app.ambernotes/amber-notes) | Nothing. Its link goes to the GitHub repo, not the site. |
| emilwagman.com | Linked | [emilwagman.com](https://www.emilwagman.com) | Nothing. Its GitHub link points to `Neobyte01`, not `emilwagman`, which owns the repo; worth checking. |
| punkpeye/awesome-remote-mcp-servers | PR open | [#866](https://github.com/punkpeye/awesome-remote-mcp-servers/pull/866) | Merge by maintainer. The repo is starred from emilwagman, which the list requires. Its CI checks the endpoint and the Glama badge. |
| serhii-londar/open-source-mac-os-apps | PR open | [#1459](https://github.com/serhii-londar/open-source-mac-os-apps/pull/1459) | Merge by maintainer. Entry is in `applications.json` (Notes, Markdown). |
| jaywcjlove/awesome-mac | PR open | [#3090](https://github.com/jaywcjlove/awesome-mac/pull/3090) | Merge by maintainer. Added to English, Chinese, Japanese and Korean READMEs, as the list requires. |
| jaywcjlove/awesome-swift-macos-apps | PR open | [#132](https://github.com/jaywcjlove/awesome-swift-macos-apps/pull/132) | Merge by maintainer. English and Chinese READMEs. |
| onmyway133/awesome-swiftui | PR open | [#56](https://github.com/onmyway133/awesome-swiftui/pull/56) | Merge by maintainer. Open source apps, macOS. |
| punkpeye/awesome-mcp-servers | Skipped | | Its rules send remote-only servers to the remote list above. |
| appcypher/awesome-mcp-servers | Skipped | | Archived. |
| wong2/awesome-mcp-servers | Skipped | | Takes no PRs; submissions go through [mcpservers.org/submit](https://mcpservers.org/submit) (section 2, no. 6). |
| iCHAIT/awesome-macOS | Skipped | | Its rules exclude "software whose main purpose is interfacing with generative tools like LLMs". Amber Notes is a notes app first, but it's pitched on AI access, so a PR would likely be closed. |
| dkhamsing/open-source-ios-apps | Later | | After the iPhone app is on the App Store. |
| Gemini CLI extension gallery (geminicli.com/extensions) | After merge | | Needs `gemini-extension.json` at the repo root on `main` (the reach/agents PR), then the `gemini-cli-extension` topic on the repo. Its crawler indexes tagged repos daily; no form ([releasing docs](https://geminicli.com/docs/extensions/releasing/)). |
| Claude Code plugin marketplace | After merge | | Needs `.claude-plugin/marketplace.json` on `main`. Then `claude plugin marketplace add amber-notes/amber-notes` works for anyone; no listing step. |
| Cursor | Blocked | | Cursor registers `cursor://anysphere.cursor-mcp/oauth/callback`, and the server accepts only https or loopback redirects, so sign-in fails at `/register`. |

## 2. The 25 best places, ranked

Ranked by value times chance of success. "Value" means one or more of: people who'd use it visit the page, the link is followed by search engines, or AI assistants cite the page when asked about notes apps and MCP. Minutes are Emil's time.

Emil's rules apply to all of it: no ads, no paid or "featured" placements, and nothing posted on his social accounts. Every entry below is a directory or registry submission, a GitHub pull request, an email, or one of Emil's own sites. Posts on Hacker News, Reddit, Product Hunt, X or LinkedIn are not on this list; section 4 keeps drafts in case he ever wants them.

| # | Where | Why | What to do | Who | Min |
|---|---|---|---|---|---|
| 1 | Claude connector directory (claude.ai/directory) | Shown inside Claude to every user looking for connectors. Highest-intent audience there is. | Submit per [directory-submissions.md](directory-submissions.md). | Emil (paid Claude plan) | 30 |
| 2 | ChatGPT plugin directory | Same, inside ChatGPT. | Same doc. Needs OpenAI identity verification and a demo video. | Emil | 60 |
| 3 | AlternativeTo, Apple Notes alternatives page | Ranks for "Apple Notes alternative"; 175 alternatives listed; heavily cited by AI assistants. | Suggest a new app, then mark it an alternative to Apple Notes, Bear and Notion. The account must be 7 days old with a verified email, so create it today. | Emil | 10 now + 10 in a week |
| 4 | mcpservers.org | The site behind wong2/awesome-mcp-servers; ranks for "notes app with MCP server". | Free form at mcpservers.org/submit, no login. Tick "supports remote", Registry name `app.ambernotes/amber-notes`. Reviewed within 2 weeks. | Emil or the lead | 5 |
| 5 | openalternative.co, Apple Notes alternatives page | Updated 2026-09-29; lists many small open-source notes apps; open source only, which we are. | Free submission at openalternative.co/submit (needs sign-in). | Emil | 10 |
| 6 | mcp.directory | Imports from the Registry automatically. | Wait a few days for the import, then claim the listing by email. The free form at mcp.directory/submit works too. | Emil | 5 |
| 7 | Smithery (smithery.ai) | Big MCP registry that clients install from. | Listing draft is with directory-prep; the lead submits with Emil's login. Its scan can't sign in, so it falls back to `/.well-known/mcp/server-card.json`; the site should serve that file first. | Lead | 0 |
| 8 | mcp.so | Large MCP directory. | Free submission; listing draft is with directory-prep. | Lead | 0 |
| 9 | MCP Market (mcpmarket.com) | Ranks for "Apple Notes MCP" and "Claude Apple Notes". | Free form at mcpmarket.com/submit, "Remote MCP". The free queue takes 4 to 6 weeks. | Emil or the lead | 5 |
| 10 | Cline MCP marketplace | Shown inside Cline to developers. Selective. | GitHub issue with the `mcp-server-submission.yml` template: repo URL, 400x400 PNG logo (`brand/directory/icon-512.png` resized), reason. Test adding the server in Cline first; the form asks you to confirm it installs from the README. | An agent, after testing in Cline | 20 |
| 11 | LobeHub MCP | ~100K servers; LobeChat users install from it. | lobehub.com/mcp, "Submit MCP" (needs account), or `npx @lobehub/market-cli`. | Emil | 10 |
| 12 | Docker MCP catalog | Shown in Docker Desktop's MCP Toolkit. | Pull request to github.com/docker/mcp-registry: `task remote-wizard` writes a `server.yaml` with `type: remote` and an `oauth` block. | An agent (GitHub PR) | 0 |
| 13 | incredible.one | Emil's company site; a followed link from an established domain, and it says who's behind Amber. | A line in the footer or on an "about" page (text in section 3), linking to ambernotes.app. | Emil (company site) | 15 |
| 14 | GitHub profile (github.com/emilwagman) | The profile is linked from every PR above. | Set Website to ambernotes.app or emilwagman.com. Create repo `emilwagman/emilwagman` with the README text in section 3. | Emil | 5 |
| 15 | MCP Newsletter (mcpnewsletter.com) | Takes new servers; exact audience. | mcpnewsletter.com/submit or contact@mcpnewsletter.com with the 50-word text. | Emil | 5 |
| 16 | usecarly.com, "Claude Apple Notes integration" post | Ranks for Claude plus Apple Notes, and says local Apple Notes servers can't reach the phone: the gap Amber fills. | Email pitch in section 3. Contact via carlyassistant.com. | Emil | 10 |
| 17 | Tool Finder, Apple Notes alternatives and open-source note-taking lists | Ranking listicles by Francesco D'Alessio. | Free form at toolfinder.com/submit, then the pitch in section 3. | Emil | 10 |
| 18 | Timing blog, "best note-taking apps for Mac" | Updated 2026-09-28, 19 apps including solo-developer ones. | Email pitch in section 3 through their contact form. | Emil | 10 |
| 19 | Indie Dev Monday | Newsletter that spotlights new indie apps. | Free form at indiedevmonday.com/look-at-me. | Emil | 10 |
| 20 | Console.dev | Weekly newsletter for developer tools; takes maker submissions. | Email hello@console.dev, pitched on Claude Code and Codex reading and editing your notes. | Emil | 10 |
| 21 | MacUpdate | Long-lived Mac download site. | Form at macupdate.com/content/submit: the .dmg link, descriptions, "Requires macOS 26". | Emil | 15 |
| 22 | SaaSHub | Alternatives pages that rank for "X alternative". | Free submission; needs an account. | Emil | 10 |
| 23 | DevHunt | Directory for developer tools, with an MCP category. | Free queue; needs an account. | Emil | 10 |
| 24 | opensourcealternative.to | Wants open-source, self-hostable projects; the README's "Run your own backend" section qualifies. | Free form, no login. The free queue is long (6 months or more). | Emil or the lead | 5 |
| 25 | Uneed (uneed.best) | Directory with a launch queue; the link becomes followed once the listing gets enough upvotes. | Free waiting line only. | Emil | 10 |

Later:
- **BetaList**: only takes unreleased or just-launched products, so submit on the day the iPhone app is released.
- **9to5Mac and MacRumors tip lines** (tips@9to5mac.com, tips@macrumors.com): email on iPhone launch day, with the Apple Notes import angle.
- **iOS Dev Weekly** (suggest.iosdevweekly.com): after the iPhone launch, ideally with a technical write-up of the TextKit 2 editor.
- **Changelog News** (changelog.com/news/submit): account needed; own work is welcome.
- **The Rundown** tool form (therundown.ai/submit) and **Ben's Bites** tools catalog: free forms, low odds.

Skipped:
- Paid-only or pay-for-placement directories: There's An AI For That, Futurepedia, Toolify, Microlaunch, and the paid tiers of every directory above. Fazier's free tier requires a Fazier badge on our homepage, which is advertising for them.
- TLDR AI: no free route found.
- PulseMCP (submissions paused, imports from the Registry), OpenTools, HiMCP, MCP Server Finder and Portkey (no submit route), mcp.run and mcp-get (gone), Composio (not a public directory).

## 3. Ready-to-paste text

### Short descriptions

One line (under 80 characters):
> Open-source notes for Mac and iPhone that ChatGPT and Claude can read and edit.

Tagline (under 60):
> Notes your AI can read and edit, with every change shown

160 characters:
> Amber Notes is a free, open-source notes app for Mac (iPhone coming soon). Connect ChatGPT, Claude, Claude Code or Codex over MCP and see every edit they make.

50 words:
> Amber Notes is a free, open-source (MIT) notes app that works like Apple Notes and imports from it. ChatGPT, Claude, Claude Code and Codex can search, read and edit your notes through its MCP server once you approve them. Every AI edit is highlighted, labeled and undoable. Mac now, iPhone soon.

Facts for forms:
- Website: https://ambernotes.app
- Download: https://ambernotes.app/download (Mac, requires macOS 26)
- Source: https://github.com/amber-notes/amber-notes (MIT, Swift and SwiftUI; server in TypeScript on Supabase)
- MCP server: `https://mcp.ambernotes.app` (Streamable HTTP, OAuth 2.1 with dynamic client registration; Claude Code and Codex use a revocable token)
- MCP Registry name: `app.ambernotes/amber-notes`
- Categories: Notes, Productivity, Knowledge and memory, Developer tools (for MCP directories)
- Price: free
- Maker: Emil Wagman, https://www.emilwagman.com
- Icon: `brand/directory/icon-512.png`; screenshot: `docs/images/banner.jpg`

### GitHub profile README (`emilwagman/emilwagman/README.md`)

```markdown
Hi, I'm Emil. I'm CTO at [Incredible](https://incredible.one), where we build AI that does tasks on your computer.

On the side I make [Amber Notes](https://ambernotes.app), an open-source notes app for Mac and iPhone that ChatGPT, Claude, Claude Code and Codex can read and edit. Every change an AI makes is highlighted and can be undone. Source: [amber-notes/amber-notes](https://github.com/amber-notes/amber-notes).

More at [emilwagman.com](https://www.emilwagman.com).
```

### Pitches to article authors

Send each from Emil's own email, one at a time, and only to articles that are still being updated.

**usecarly.com, "Claude Apple Notes integration":**
> Hi, I read your post on connecting Claude to Apple Notes. You point out that the local Apple Notes servers only work on a Mac, and can't reach notes from a phone or from claude.ai. I made Amber Notes (ambernotes.app), a free, open-source notes app that works like Apple Notes, imports from it, and has a hosted MCP server that Claude and ChatGPT connect to with OAuth, so it works from any device. If you update the post, it might be a useful option for readers who want Claude to reach their notes everywhere.

**Tool Finder, Apple Notes alternatives:**
> Hi Francesco, I made Amber Notes (ambernotes.app), a free, open-source (MIT) notes app for Mac, with iPhone in App Store review. It looks and behaves like Apple Notes and imports your Apple Notes, and it adds one thing Notes doesn't have: ChatGPT and Claude can search and edit your notes, with each AI edit highlighted and undoable. I've submitted it through your form; if you refresh the Apple Notes alternatives list, I'd be glad if you took a look. Happy to send anything you need.

**Timing, "best note-taking apps for Mac":**
> Hi, I enjoyed your roundup of note-taking apps for Mac. I made Amber Notes (ambernotes.app), a free, open-source native Mac notes app that works like Apple Notes and imports from it. What's different is that ChatGPT, Claude and Codex can read and edit your notes once you approve them, and every AI edit is highlighted with version history. If you update the list, it could fit readers who want an Apple Notes feel with AI access.

**Any "best MCP servers" list (for example totalum.app, contacto@totalum.app):**
> Hi, I saw your list of MCP servers. Most notes options on these lists are either Notion or local servers that only run on one Mac. I made Amber Notes (ambernotes.app), an open-source notes app with a hosted OAuth MCP server (`https://mcp.ambernotes.app`, in the official MCP Registry) that works from ChatGPT, Claude, Claude Code and Codex, and highlights every edit an AI makes. If you add a notes pick next time, it might be worth a look.

### incredible.one line

> Amber Notes, an open-source notes app by our CTO Emil Wagman, lets ChatGPT and Claude read and edit your notes, and shows you every change they make. [ambernotes.app](https://ambernotes.app)

## 4. Optional drafts, not planned

Emil doesn't post about Amber Notes on his social accounts, and no agent posts anywhere under his name. These drafts exist only in case he ever decides to post one himself. Nothing in sections 2 or 5 depends on them. Anything marked [check] is a guess about his reasons or plans.

The same goes for his X and LinkedIn bios: a line like "Making Amber Notes, open-source notes your AI can use: ambernotes.app" is there if he wants it.

### Show HN

Title:
> Show HN: Amber Notes, an open-source notes app that ChatGPT and Claude can edit

URL: https://ambernotes.app

First comment:
> Hi HN, I'm Emil. I made Amber Notes because I wanted to ask Claude and ChatGPT things about my own notes, and have them update a list or a plan, without giving them my whole Apple Notes library or copying text back and forth. [check]
>
> It's a notes app for the Mac that works like Apple Notes: folders, checklists, tables, pinning, and an importer for your existing Apple Notes. The iPhone app is in App Store review.
>
> The part I cared most about is trust. You approve each AI connection inside the app and choose read-only or read-and-edit. Anything an assistant writes is tinted and labeled with its name, one click undoes it, and every change keeps the previous version, so you can see who changed what.
>
> Under the hood: SwiftUI with a TextKit 2 editor, sync through Supabase with row-level security on every table, and an MCP server with 27 tools that runs as an Edge Function. ChatGPT and Claude connect with OAuth; Claude Code and Codex use a revocable token. It's MIT-licensed, and the README explains how to run the whole backend yourself.
>
> The Mac app is free to download. I'd like to hear what breaks, and what you'd want an AI to be allowed to do in your notes.

Check before posting: Show HN wants something people can try without a signup. The app asks for Sign in with Apple or email; if that can't be skipped, say so in the first comment rather than letting people find out.

### r/macapps

Title:
> [Developer] Amber Notes: a free, open-source Apple Notes-style app that ChatGPT and Claude can edit

Body:
> Hi, I'm the developer. Amber Notes is a free, open-source (MIT) notes app for the Mac. It works like Apple Notes, with folders, checklists, tables, pinning and search, and it can import your Apple Notes.
>
> What it adds: you can connect ChatGPT, Claude, Claude Code or Codex, and they can search and edit your notes. You approve each connection in the app and choose read-only or read-and-edit. Every AI edit is highlighted and labeled, one click undoes it, and version history keeps every change.
>
> - Price: free, no ads, no tracking
> - Requires macOS 26
> - iPhone app is in App Store review
> - Download: https://ambernotes.app/download
> - Source: https://github.com/amber-notes/amber-notes
>
> Happy to answer questions, and I'd like to hear what's missing compared with Apple Notes.

Use the flair the sidebar asks for (developer or self-promotion) and check the current rules first; they changed recently.

### r/ClaudeAI

Title:
> I built a notes app that Claude can read and edit, with every change highlighted

Body:
> I wanted Claude to work with my notes: find things, keep a trip plan or a checklist up to date. The local Apple Notes MCP servers only work on the Mac they run on, so I built Amber Notes, a free, open-source notes app for the Mac (iPhone in review) with its own MCP server.
>
> How it works with Claude:
> - In claude.ai, add a custom connector with the address `https://mcp.ambernotes.app`. Approve it in the app or on the web; choose read-only or read-and-edit.
> - In Claude Code: Settings → Connect an AI in the app gives you a command with a revocable token.
> - Whatever Claude writes is tinted and labeled "Claude", one click undoes it, and version history shows who changed what.
>
> I built much of it with Claude Code. [check]
>
> It's MIT-licensed: https://github.com/amber-notes/amber-notes. Download: https://ambernotes.app. I'd like feedback on which tools Claude uses well and which it fumbles.

### Product Hunt

- Name: Amber Notes
- Tagline (60 characters max): Notes your AI can read and edit, with every change shown
- Topics: Note taking, Mac, iPhone, Open source, Artificial Intelligence
- Description (260 characters max):
  > A free, open-source notes app for iPhone and Mac that works like Apple Notes and imports from it. Connect ChatGPT, Claude, Claude Code or Codex over MCP; you approve each one, and every edit they make is highlighted, labeled and undoable.
- Maker comment:
  > Hi Product Hunt, I'm Emil. Amber Notes is the notes app I wanted: Apple Notes simplicity, plus an AI that can actually use my notes. You decide which assistant can read or edit, and you always see what it changed. It's free and MIT-licensed. I'd like to hear what you'd want your AI to do with your notes.

## 5. What Emil should do next

In order. Time is Emil's own. No ads, no paid placements, no social posts.

1. Create an AlternativeTo account today, so it's 7 days old next week (2 min now, 10 min later).
2. Submit to Claude's connector directory, per directory-submissions.md (30 min).
3. Fill in the free forms: mcpservers.org, MCP Market, opensourcealternative.to (15 min total; the lead can do these too).
4. Add the line to incredible.one (15 min).
5. Set the GitHub profile website and create the profile README (5 min).
6. Submit to openalternative.co, free tier (10 min).
7. Send the three author pitches (usecarly, Tool Finder, Timing) (30 min).
8. Send the MCP Newsletter, Indie Dev Monday and Console.dev submissions (20 min).
9. Submit to LobeHub, SaaSHub and DevHunt (30 min).
10. Submit to the ChatGPT plugin directory once identity verification and the demo video are done (60 min).

On the day the iPhone app is released: BetaList, the 9to5Mac and MacRumors tip lines, iOS Dev Weekly.
