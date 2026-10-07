/// Every blog post, in the order the index lists them. This is the one list: the index, the
/// sitemap, /llms.txt, "More posts" and "All posts" all read it. `draft` posts are noindex and
/// stay out of every list until they're approved.

export type Category = "Guides" | "Apple Notes" | "Comparisons" | "Building Amber Notes";

/// A real capture of the app, in public/blog. `window` says whether the capture already has the
/// Mac window around it (true), or is a sheet or form that the page frames in a window (false).
/// `phone`: an iPhone screen, shown as the screen alone with its own rounded corners.
export type Shot = { src: string; alt: string; width: number; height: number; window: boolean; title?: string; phone?: boolean };

export type Post = {
  slug: string;
  title: string;
  /// The meta description, for search results (under about 160 characters).
  description: string;
  /// The card text on the index: two or three lines.
  excerpt: string;
  category: Category;
  /// When it was published, and the day it was last checked against the app (ISO dates).
  date: string;
  updated: string;
  /// The capture right after the intro, on the post's ground.
  image: Shot;
  /// The card's picture: its own ground and one focal capture, so no two posts look alike.
  thumb: Thumb;
  draft: boolean;
};

/// The ground a cover (and the post's first picture) sits on: the site's palette, the help page's
/// leaf brown, the app's dark look, or the home page's dunes.
export type Ground = "paper" | "soft" | "tint" | "amber" | "leaf" | "dark" | "dunes" | "ink" | "peach" | "cream" | "sand" | "clay" | "mist" | "honey" | "sage" | "heather" | "blush" | "wheat" | "fog" | "dusk" | "pearl" | "linen" | "night" | "rose" | "mint" | "sky" | "lemon" | "coral" | "lagoon" | "denim";

/// A card's picture: one real capture of the element the post is about, on the post's ground. The
/// capture is cropped at 2x (3x from iPhone) to about the card's width, so it shows at full size.
export type Thumb = { ground: Ground; src: string; width: number; height: number; alt: string };

const thumb = (ground: Ground, name: string, width: number, height: number, alt: string): Thumb => ({ ground, src: `/blog/${name}.webp`, width, height, alt });

export const AUTHOR = { name: "Emil Wagman", avatar: "/emil-wagman.jpg" };

export const SHOTS = {
  connectChatGPT: { src: "/blog/amber-notes-connect-chatgpt-steps.webp", alt: "Connect ChatGPT in Amber Notes on a Mac: a Copy Address and Open ChatGPT button, then four steps: turn on Developer mode, add Amber Notes in Plugins, paste the address and choose OAuth, then Allow.", width: 1120, height: 610, window: false, title: "Connect ChatGPT" },
  connectClaude: { src: "/blog/amber-notes-connect-claude-steps.webp", alt: "Connect Claude in Amber Notes on a Mac: an Add to Claude button, a note that it works on every Claude plan, then the steps: choose Add, then Connect, then Allow.", width: 1120, height: 590, window: false, title: "Connect Claude" },
  consent: { src: "/blog/amber-notes-allow-chatgpt-access.webp", alt: "Amber Notes asking \"Allow ChatGPT to use your notes?\" with a choice of Read and Edit or Read Only, and Allow and Don't Allow buttons.", width: 840, height: 700, window: false, title: "Amber Notes" },
  connectList: { src: "/blog/amber-notes-connect-an-ai.webp", alt: "Settings in Amber Notes on a Mac: Connect an AI lists ChatGPT, Claude, Claude Code and Codex, with what's connected below.", width: 1040, height: 720, window: false, title: "Settings" },
  consentE2ee: { src: "/blog/amber-notes-allow-chatgpt-encrypted-notes.webp", alt: "Amber Notes on a Mac asking \"Allow ChatGPT to use your notes?\": access goes to chatgpt.com, a choice of Read and Edit or Read Only, and a line saying that while it's connected it can read everything except locked notes.", width: 840, height: 712, window: false, title: "Amber Notes" },
  notesPassword: { src: "/blog/amber-notes-locked-notes-password.webp", alt: "Amber Notes on a Mac: Create a password for your locked notes, with Password, Verify and Hint fields, and the warning that if you forget this password, your locked notes can't be recovered, not even by us.", width: 880, height: 600, window: false, title: "Locked Notes" },
  coworkAllow: { src: "/blog/claude-wants-access-to-control-notes-macos.webp", alt: "The macOS prompt that appears when Claude first uses the Apple Notes extension: \u201cClaude\u201d wants access to control \u201cNotes\u201d. Allowing control will provide access to documents and data in \u201cNotes\u201d, and to perform actions within that app. Buttons: Don\u2019t Allow and Allow.", width: 520, height: 532, window: true },
  notesDefaultAccount: { src: "/blog/notes-default-account.webp", alt: "The General settings of Apple Notes on a Mac running macOS 26: Sort notes by Date Edited, New notes start with Title, and Default account set to iCloud, which Siri uses when creating notes.", width: 1093, height: 298, window: true },
  notesTableMenu: { src: "/blog/notes-format-table-menu.webp", alt: "The Format menu of Apple Notes on a Mac running macOS 26, at Table (Option-Command-T), with Convert to Text and Reverse Table Direction below it.", width: 700, height: 436, window: true },
  notesSmartFolderFilters: { src: "/blog/notes-smart-folder-filters.webp", alt: "The first pop-up menu of a Smart Folder rule in Apple Notes on a Mac running macOS 26, with Tags checked above Date Created, Date Edited, Shared, Mentions, Checklists, Attachments, Folders, Quick Notes, Pinned Notes and Locked Notes.", width: 560, height: 800, window: true },
  notesExportMenu: { src: "/blog/notes-export-menu.webp", alt: "The File menu of Apple Notes on a Mac running macOS 26, open at Export as, with PDF and Markdown in the submenu and Markdown selected.", width: 700, height: 453, window: true },
  importSheet: { src: "/blog/amber-notes-import-from-apple-notes.webp", alt: "The Import from Apple Notes sheet in Amber Notes on a Mac: notes picked, Keep Apple Notes folders and Also bring over pinned notes ticked, and an Import 1,284 Notes button.", width: 1980, height: 1800, window: true },
  aiEdit: { src: "/blog/amber-notes-chatgpt-edit-undo.webp", alt: "A Groceries note in Amber Notes on a Mac. The five lines ChatGPT just added are tinted, and a bar at the bottom says ChatGPT changed 5 lines, with Undo.", width: 1260, height: 1520, window: false, title: "Groceries" },
  history: { src: "/blog/amber-notes-version-history-chatgpt.webp", alt: "Version history for a Groceries note in Amber Notes on a Mac: versions by you on iPhone and Mac, ChatGPT and Claude Code, with the lines that differ tinted and a Restore This Version button.", width: 1800, height: 1200, window: false, title: "Groceries" },
  welcome: { src: "/blog/amber-notes-markdown-welcome-note.webp", alt: "The Welcome to Amber Notes note on a Mac: markdown that styles itself as you type, a checklist, bullets, inline code and a table.", width: 1250, height: 950, window: false, title: "Welcome to Amber Notes" },
  historyBurst: { src: "/blog/amber-notes-version-history-restore.webp", alt: "Version history for a Groceries note on a Mac: versions by you on iPhone and Mac, ChatGPT and Claude Code, with the lines that differ tinted and a Restore This Version button.", width: 1800, height: 1200, window: false, title: "Groceries" },
  iphoneList: { src: "/blog/amber-notes-iphone-notes-edited-by-ai.webp", alt: "Amber Notes on iPhone: the note list, with Groceries marked Edited by ChatGPT, Standup notes Edited by Claude Code and Lisbon Edited by Claude.", width: 1206, height: 2622, window: false, phone: true },
  tracker: { src: "/blog/amber-notes-evening-tracker-table.webp", alt: "An Evening tracker note in Amber Notes on a Mac: a table with a row per day and typed columns for work hours, energy, mood and yes-or-no habits.", width: 1250, height: 900, window: false, title: "Evening tracker" },
  lisbon: { src: "/blog/amber-notes-lisbon-trip-note.webp", alt: "A Lisbon trip note in Amber Notes on a Mac: a plan checklist, a list of places, a linked Hotel booking sub-note, and a table of where to eat.", width: 1250, height: 1420, window: false, title: "Lisbon" },
  iphoneFiles: { src: "/blog/amber-notes-iphone-files-in-a-note.webp", alt: "Amber Notes on iPhone in dark mode: a Trip documents note holding a PDF, a CSV file, a photo and a link.", width: 1206, height: 2622, window: false, phone: true },
  iphoneGroceries: { src: "/blog/amber-notes-iphone-chatgpt-edited-checklist.webp", alt: "A Groceries checklist in Amber Notes on iPhone. The five items ChatGPT just added are tinted, and a bar says ChatGPT changed 5 lines, with Undo.", width: 1206, height: 2622, window: false, phone: true },
  standup: { src: "/blog/amber-notes-claude-code-standup-note.webp", alt: "Standup notes in Amber Notes on a Mac. The line Claude Code just added is tinted, and a bar at the bottom says Claude Code changed 1 line, with Undo.", width: 1250, height: 1420, window: false, title: "Standup notes" },
} satisfies Record<string, Shot>;

export const posts: Post[] = [
  {
    slug: "shared-memory-for-coding-agents",
    title: "One memory for Claude Code, Codex and your other agents",
    description: "Give Claude Code, Codex and other agents one shared memory in a note you can read: connect both, a Project memory note, and who changed what.",
    excerpt: "A Project memory note that every coding agent reads first and adds to, that you can read too, with each change labelled by the agent that made it.",
    category: "Guides",
    date: "2026-10-06",
    updated: "2026-10-06",
    image: SHOTS.history,
    thumb: thumb("denim", "thumb-iphone-agents", 1206, 680, "The note list, with notes edited by Claude Code and by Claude"),
    draft: false,
  },
  {
    slug: "apple-notes-not-syncing",
    title: "Apple Notes not syncing between iPhone and Mac: how to fix it",
    description: "Why Apple Notes stops syncing between iPhone and Mac, and the fixes in order: iCloud settings, Apple Account, note account, storage, iOS 27 updates.",
    excerpt: "A note from your iPhone isn't on your Mac. Six things to check, in the order that finds the cause fastest, plus shared notes that won't update.",
    category: "Apple Notes",
    date: "2026-10-05",
    updated: "2026-10-05",
    image: SHOTS.notesDefaultAccount,
    thumb: thumb("lagoon", "thumb-notes-sync-default-account", 800, 528, "Apple Notes settings on a Mac with Default account set to iCloud"),
    draft: false,
  },
  {
    slug: "apple-notes-tables",
    title: "Tables in Apple Notes: what you can and can't do",
    description: "How tables work in Apple Notes on iPhone and Mac: adding rows and columns, column width, sums and formulas, and what to do when you need more.",
    excerpt: "Apple Notes tables are simple on purpose: no column widths, no sums, no formulas. What they do, what they don't, and the workarounds that hold up.",
    category: "Apple Notes",
    date: "2026-10-04",
    updated: "2026-10-04",
    image: SHOTS.notesTableMenu,
    thumb: thumb("lemon", "thumb-notes-format-table-menu", 800, 528, "The Apple Notes Format menu on a Mac, open at Table"),
    draft: false,
  },
  {
    slug: "apple-notes-tags-smart-folders",
    title: "Apple Notes tags and Smart Folders: how they work, and why they stop working",
    description: "How tags and Smart Folders work in Apple Notes on iPhone and Mac, and the fixes when a tag won't form, a note can't be tagged or a Smart Folder is empty.",
    excerpt: "A tag is a word after #, and a Smart Folder is a saved filter. Why a tag won't form, why a note refuses tags, and what a Smart Folder can't do.",
    category: "Apple Notes",
    date: "2026-10-04",
    updated: "2026-10-04",
    image: SHOTS.notesSmartFolderFilters,
    thumb: thumb("coral", "thumb-notes-smart-folder-filters", 800, 528, "The rule menu of an Apple Notes Smart Folder on a Mac, with Tags checked"),
    draft: false,
  },
  {
    slug: "move-apple-notes-to-icloud",
    title: "How to move Apple Notes from On My iPhone or Gmail to iCloud",
    description: "Move notes from On My iPhone or Gmail into iCloud on iPhone or Mac, and what to check first for locked notes and Gmail notes.",
    excerpt: "Notes in On My iPhone or Gmail stay where they are until you move them. How to move them into iCloud, and what to check before and after.",
    category: "Apple Notes",
    date: "2026-10-02",
    updated: "2026-10-02",
    image: SHOTS.notesDefaultAccount,
    thumb: thumb("sky", "thumb-notes-default-account", 800, 528, "Apple Notes settings on a Mac with Default account set to iCloud"),
    draft: false,
  },
  {
    slug: "back-up-apple-notes",
    title: "How to back up Apple Notes",
    description: "iCloud syncs Apple Notes but keeps no old copies. How to back up every note to files on your Mac, and what iPhone backups and Time Machine cover.",
    excerpt: "iCloud keeps your notes in sync, which isn't the same as a copy you can go back to. What actually backs up Apple Notes, and a routine to follow.",
    category: "Apple Notes",
    date: "2026-10-02",
    updated: "2026-10-02",
    image: SHOTS.notesExportMenu,
    thumb: thumb("mint", "thumb-notes-export-menu", 800, 528, "The Apple Notes File menu open at Export as, with Markdown selected"),
    draft: false,
  },
  {
    slug: "claude-cowork-apple-notes",
    title: "How to use Claude Cowork with Apple Notes",
    description: "How Claude Cowork reaches Apple Notes today: Anthropic's Mac extension, what it can't do from your phone, and a connector that works on every device.",
    excerpt: "Cowork can use Apple Notes on a Mac, through Anthropic's extension. From your phone it's harder. The options, and when the extension is enough.",
    category: "Apple Notes",
    date: "2026-10-01",
    updated: "2026-10-02",
    image: SHOTS.coworkAllow,
    thumb: thumb("rose", "thumb-cowork-apple-notes", 800, 528, "The macOS prompt asking to let Claude control Notes"),
    draft: false,
  },
  {
    slug: "recover-deleted-apple-notes",
    title: "How to recover deleted Apple Notes, including after 30 days",
    description: "Get back deleted Apple Notes from Recently Deleted on iPhone, Mac and iCloud.com, what works after 30 days, and why Gmail notes and locked notes are different.",
    excerpt: "Within 30 days it's almost always in Recently Deleted. After that, what still works, what doesn't, and what recovery apps won't tell you.",
    category: "Apple Notes",
    date: "2026-10-01",
    updated: "2026-10-07",
    image: SHOTS.history,
    thumb: thumb("night", "thumb-restore-dark", 846, 558, "An earlier version of a Groceries note in Amber Notes, in dark mode"),
    draft: false,
  },
  {
    slug: "connect-notes-to-gemini",
    title: "Connect your notes to Gemini with MCP",
    description: "Use your notes in Gemini CLI with one command and an approval on your iPhone or Mac, and what Google says about adding MCP servers to the Gemini app.",
    excerpt: "Gemini CLI takes one command. The Gemini app can add MCP servers too, with conditions. Both, and what I could and couldn't check.",
    category: "Guides",
    date: "2026-10-01",
    updated: "2026-10-01",
    image: SHOTS.connectList,
    thumb: thumb("linen", "thumb-consent-local", 826, 545, "Amber Notes asking to let an app on this computer use your notes"),
    draft: false,
  },
  {
    slug: "forgot-apple-notes-password",
    title: "Forgot your Apple Notes password? What works, and what doesn't",
    description: "What to try before you reset a forgotten Apple Notes password, how to reset it on iPhone and Mac, and why Apple and unlock tools can't open old locked notes.",
    excerpt: "Try these first, then reset. Resetting lets you lock new notes, but it never opens the old ones. Nobody can, and here's why.",
    category: "Apple Notes",
    date: "2026-10-01",
    updated: "2026-10-01",
    image: SHOTS.notesPassword,
    thumb: thumb("pearl", "thumb-notes-password", 896, 591, "Amber Notes asking you to create a password for locked notes"),
    draft: false,
  },
  {
    slug: "encrypted-notes-app-for-ai",
    title: "An encrypted notes app that ChatGPT and Claude can use",
    description: "Amber Notes encrypts every note on your iPhone or Mac and still lets ChatGPT and Claude read and edit them. How it works, its limits, and how others compare.",
    excerpt: "Every note is encrypted on your devices, and ChatGPT and Claude can still use them once you approve. How, what stays readable, and how Apple Notes, Standard Notes, Notesnook, Obsidian and Notion compare.",
    category: "Building Amber Notes",
    date: "2026-10-01",
    updated: "2026-10-01",
    image: SHOTS.consentE2ee,
    thumb: thumb("dusk", "thumb-consent-e2ee", 826, 545, "Amber Notes asking to let ChatGPT use your notes"),
    draft: false,
  },
  {
    slug: "chatgpt-memory-vs-notes",
    title: "ChatGPT memory vs a notes app ChatGPT can read",
    description: "What ChatGPT memory keeps, what it doesn't, and when you want notes ChatGPT can read and write instead: exact text, on your phone, with history.",
    excerpt: "Memory is ChatGPT's own summary of you. Notes are your words, where you can read them. What each is good for, and how to use both.",
    category: "Comparisons",
    date: "2026-09-30",
    updated: "2026-10-01",
    image: SHOTS.historyBurst,
    thumb: thumb("fog", "thumb-lisbon-chatgpt", 731, 482, "A Lisbon plan checklist with the line ChatGPT added tinted"),
    draft: false,
  },
  {
    slug: "apple-notes-ios-27",
    title: "What's new in Apple Notes in iOS 27, and how to use it",
    description: "New in Apple Notes in iOS 27 and macOS 27: divider lines, section links, Markdown copy and paste, and Siri AI that finds, adds to and reformats notes.",
    excerpt: "Divider lines, section links, Markdown in and out, and a Siri that can find your notes and write into them. What changed, and how to use it.",
    category: "Apple Notes",
    date: "2026-09-30",
    updated: "2026-10-01",
    image: SHOTS.notesExportMenu,
    thumb: thumb("wheat", "thumb-lisbon-food", 744, 491, "A table of places to eat in Lisbon, in a note"),
    draft: false,
  },
  {
    slug: "export-apple-notes-to-markdown",
    title: "How to export Apple Notes to Markdown",
    description: "Export a note from Apple Notes as a Markdown file on Mac and iPhone, what to check in the file, and how to export every note at once.",
    excerpt: "Apple Notes exports Markdown on its own now, one note at a time. The steps on Mac and iPhone, what to check, and what to use for all of them.",
    category: "Apple Notes",
    date: "2026-09-30",
    updated: "2026-09-30",
    image: SHOTS.welcome,
    thumb: thumb("blush", "thumb-markdown-title", 714, 471, "The Welcome to Amber Notes note, written in Markdown"),
    draft: false,
  },
  {
    slug: "connect-chatgpt-to-your-notes",
    title: "How to connect ChatGPT to your notes",
    description: "Let ChatGPT or Claude read and update your notes on iPhone and Mac. What you need, the steps, and how you stay in control.",
    excerpt: "Ask ChatGPT to add to a list or tidy a note, and the change lands in your notes. The steps for ChatGPT and Claude, and how you stay in control.",
    category: "Guides",
    date: "2026-09-30",
    updated: "2026-10-02",
    image: SHOTS.connectChatGPT,
    thumb: thumb("paper", "thumb-connect-chatgpt", 704, 572, "The steps to connect ChatGPT in Amber Notes"),
    draft: false,
  },
  {
    slug: "claude-and-apple-notes",
    title: "Can Claude read your Apple Notes?",
    description: "What works today on a Mac, what doesn't work on iPhone or the web, and the options side by side.",
    excerpt: "On a Mac, yes. On iPhone and in the browser, no. Why it depends on where you use Claude, and what each option can and can't do.",
    category: "Apple Notes",
    date: "2026-09-30",
    updated: "2026-10-02",
    image: SHOTS.connectClaude,
    thumb: thumb("leaf", "thumb-connect-claude", 704, 451, "The steps to connect Claude in Amber Notes"),
    draft: false,
  },
  {
    slug: "notes-apps-with-mcp",
    title: "Notes apps with an MCP server, compared",
    description: "Which notes apps ChatGPT and Claude can read and edit through MCP, whether that works away from your Mac, and what to check before you pick one.",
    excerpt: "Notion, Evernote, Bear, Obsidian, Apple Notes and more: which ones your AI can reach from your phone, and what happens when it gets an edit wrong.",
    category: "Comparisons",
    date: "2026-09-30",
    updated: "2026-10-01",
    image: SHOTS.aiEdit,
    thumb: thumb("dunes", "thumb-ai-rows", 733, 533, "A grocery checklist with the five lines an AI added tinted"),
    draft: false,
  },
  {
    slug: "apple-notes-mcp",
    title: "Apple Notes MCP servers compared (2026)",
    description: "There's no official Apple Notes MCP server. The community ones compared: what each can do, how to set one up in Claude, and the limits they share.",
    excerpt: "Apple doesn't make one, so every Apple Notes MCP server is a community project on your Mac. Four compared, the setup, and the limits they all share.",
    category: "Comparisons",
    date: "2026-09-30",
    updated: "2026-09-30",
    image: SHOTS.history,
    thumb: thumb("sage", "thumb-history-list", 640, 973, "Version history for a note, listing who made each version"),
    draft: false,
  },
  {
    slug: "obsidian-mcp",
    title: "Obsidian MCP servers compared (2026)",
    description: "There's no official Obsidian MCP server. The community plugins and servers compared, how to set one up in Claude, and the limits they share.",
    excerpt: "Plugins that serve your vault from inside Obsidian, and servers that work on the files. Seven compared, the setup in Claude, and what none of them can do.",
    category: "Comparisons",
    date: "2026-09-30",
    updated: "2026-09-30",
    image: SHOTS.lisbon,
    thumb: thumb("heather", "thumb-lisbon-link", 744, 491, "A Lisbon note linking to a Hotel booking sub-note"),
    draft: false,
  },
  {
    slug: "move-from-apple-notes",
    title: "How to move from Apple Notes to Amber Notes",
    description: "Import all your Apple Notes on your Mac, with folders, checklists and tables. Apple Notes stays untouched.",
    excerpt: "Bring every note over in one go on your Mac, folders and pins included. Nothing in Apple Notes changes, so you can take your time.",
    category: "Apple Notes",
    date: "2026-09-30",
    updated: "2026-09-30",
    image: SHOTS.importSheet,
    thumb: thumb("soft", "thumb-import", 750, 523, "Notes picked for import from Apple Notes into Amber Notes"),
    draft: false,
  },
  {
    slug: "notes-in-claude-code-and-codex",
    title: "Use your notes from Claude Code and Codex",
    description: "Add Amber Notes to Claude Code or Codex in one step, and let your coding agent read and write your notes.",
    excerpt: "Let your coding agent write the standup or keep a work log, in the same notes you read on your phone. One command for Claude Code, a few lines for Codex.",
    category: "Guides",
    date: "2026-09-30",
    updated: "2026-10-01",
    image: SHOTS.connectList,
    thumb: thumb("dark", "thumb-connect-list", 704, 566, "Connect an AI in Amber Notes: ChatGPT, Claude, Claude Code and Codex"),
    draft: false,
  },
  {
    slug: "amber-notes-vs-apple-notes",
    title: "Amber Notes vs Apple Notes",
    description: "What Amber Notes adds, what Apple Notes still does better, and who each one is for.",
    excerpt: "Amber Notes is built to feel like Apple Notes, with a few things it always missed. Where they differ, including what Apple Notes still does better.",
    category: "Comparisons",
    date: "2026-09-30",
    updated: "2026-10-01",
    image: SHOTS.history,
    thumb: thumb("tint", "thumb-iphone-history", 1313, 956, "Version history on iPhone, with a version by ChatGPT"),
    draft: false,
  },
  {
    slug: "mcp-server",
    title: "The Amber Notes MCP server",
    description: "The server address, how sign-in and approval work, and every tool an AI app can call.",
    excerpt: "For developers and curious people: the address, how an AI app signs in and gets approved, and every tool it can call.",
    category: "Guides",
    date: "2026-09-30",
    updated: "2026-10-02",
    image: SHOTS.consent,
    thumb: thumb("amber", "thumb-consent", 854, 528, "Amber Notes asking to let ChatGPT use your notes, with Allow and Don't Allow"),
    draft: false,
  },
  {
    slug: "apple-notes-api",
    title: "Apple Notes API: what exists and what to use instead",
    description: "Apple Notes has no public API. What you can use on a Mac and iPhone (AppleScript, Shortcuts, export), what each can do, and when to use a notes app with an API.",
    excerpt: "Apple Notes has no public API. What you can do with AppleScript and Shortcuts, what you can't, and what to use when you need more.",
    category: "Apple Notes",
    date: "2026-09-30",
    updated: "2026-10-01",
    image: SHOTS.connectList,
    thumb: thumb("ink", "thumb-markdown", 804, 531, "Markdown checklists, bullets and inline code in a note"),
    draft: false,
  },
  {
    slug: "notes-apps-that-work-with-chatgpt",
    title: "Notes apps that work with ChatGPT",
    description: "Which notes apps ChatGPT can search and write to in 2026, compared fairly: Notion, OneNote, Evernote, Apple Notes, Google Keep, Amber Notes and more.",
    excerpt: "\u201cWorks with ChatGPT\u201d can mean reading the note you have open, or searching and editing all of them. The main notes apps, compared.",
    category: "Comparisons",
    date: "2026-09-30",
    updated: "2026-10-01",
    image: SHOTS.iphoneList,
    thumb: thumb("peach", "thumb-iphone-chatgpt", 1278, 908, "The note list on iPhone, with Groceries edited by ChatGPT"),
    draft: false,
  },
  {
    slug: "best-notes-app-for-ai-agents",
    title: "The best notes app for AI agents",
    description: "What an AI agent needs from a notes app: remote MCP, precise writes, undo and history, approval, and apps you read on. How the options compare.",
    excerpt: "Remote MCP, precise writes, undo, approval and a phone app to read the results: the criteria that matter, and how the options compare.",
    category: "Comparisons",
    date: "2026-09-30",
    updated: "2026-10-02",
    image: SHOTS.tracker,
    thumb: thumb("cream", "thumb-tracker", 708, 749, "An evening tracker table with a row per day"),
    draft: false,
  },
  {
    slug: "apple-notes-vs-notion",
    title: "Apple Notes vs Notion for everyday notes (and where AI fits)",
    description: "Apple Notes and Notion compared for everyday notes: speed, devices, offline, price, built-in AI, and whether ChatGPT and Claude can use them.",
    excerpt: "One is where a thought goes in two seconds, the other is where a project lives. How they compare, and what changes once you want your AI to use them.",
    category: "Comparisons",
    date: "2026-09-30",
    updated: "2026-10-01",
    image: SHOTS.lisbon,
    thumb: thumb("sand", "thumb-lisbon", 643, 520, "A Lisbon trip note with a plan checklist"),
    draft: false,
  },
  {
    slug: "apple-notes-vs-obsidian",
    title: "Apple Notes vs Obsidian",
    description: "Apple Notes and Obsidian compared fairly: local markdown files and plugins, iCloud and speed, sync, price, and AI access.",
    excerpt: "Obsidian gives you markdown files and plugins; Apple Notes gives you speed and iCloud. Where each one wins, and where AI fits.",
    category: "Comparisons",
    date: "2026-09-30",
    updated: "2026-10-01",
    image: SHOTS.iphoneFiles,
    thumb: thumb("mist", "thumb-iphone-files", 1238, 831, "A note on iPhone holding a PDF and a CSV file, in dark mode"),
    draft: false,
  },
  {
    slug: "chatgpt-to-do-list-on-iphone",
    title: "How to use ChatGPT as a to-do list that syncs to your iPhone",
    description: "Ask ChatGPT to add, tick and tidy your to-dos, and see the checklist on your iPhone and Mac. The setup, the prompts, and how to share a list.",
    excerpt: "Tell ChatGPT what needs doing and it lands in a checklist you can tick on your phone. The setup, prompts that work, and sharing a list.",
    category: "Guides",
    date: "2026-09-30",
    updated: "2026-10-01",
    image: SHOTS.iphoneGroceries,
    thumb: thumb("honey", "thumb-iphone-groceries", 1278, 970, "A Groceries checklist on iPhone with the lines ChatGPT added tinted"),
    draft: false,
  },
  {
    slug: "work-log-with-claude-code",
    title: "Keep a work log with Claude Code",
    description: "Let Claude Code write your standup, keep a daily log and fill in a tracker in your notes, with one instruction and the Amber Notes MCP server.",
    excerpt: "Your standup, a daily log and a tracker, written by Claude Code as you work, in notes you can read on your phone.",
    category: "Guides",
    date: "2026-09-30",
    updated: "2026-09-30",
    image: SHOTS.standup,
    thumb: thumb("clay", "thumb-standup", 902, 595, "Standup notes with the line Claude Code added tinted"),
    draft: false,
  },
  {
    slug: "chatgpt-and-apple-notes",
    title: "How to use ChatGPT with Apple Notes",
    description: "The three ways ChatGPT can work with Apple Notes today, what each can and can't do, and when a different notes app makes sense.",
    excerpt: "ChatGPT can help with the note in front of you, but it can't search your notes or save to them. The three ways it works today.",
    category: "Guides",
    date: "2026-09-30",
    updated: "2026-10-01",
    image: SHOTS.aiEdit,
    thumb: thumb("paper", "thumb-ai-rows", 733, 533, "A grocery checklist with the five lines an AI added tinted"),
    draft: true,
  },
];

export const post = (slug: string): Post => {
  const p = posts.find((x) => x.slug === slug);
  if (!p) throw new Error(`No post ${slug}`);
  return p;
};

export const published = () => posts.filter((p) => !p.draft);

/// Categories that have at least one published post, in a fixed order.
export const categories = (): Category[] =>
  (["Guides", "Apple Notes", "Comparisons", "Building Amber Notes"] as Category[]).filter((c) => published().some((p) => p.category === c));

export const categoryAnchor = (c: Category) => c.toLowerCase().replace(/\s+/g, "-");

/// The category's own page, which lists its posts (paged like the index).
export const categoryPath = (c: Category) => `/blog/category/${categoryAnchor(c)}`;

export const categoryFromAnchor = (anchor: string): Category | undefined => categories().find((c) => categoryAnchor(c) === anchor);

/// Posts per page on the index and on each category page.
export const PER_PAGE = 12;

/// Published posts, newest first (by date; the list order breaks ties).
export function newestFirst(list: Post[] = published()): Post[] {
  return list.map((p, i) => [p, i] as const).sort((a, b) => b[0].date.localeCompare(a[0].date) || a[1] - b[1]).map(([p]) => p);
}

export const pageCount = (list: Post[]) => Math.max(1, Math.ceil(list.length / PER_PAGE));

/// Page `n` (from 1) of a list.
export const pageOf = (list: Post[], n: number) => list.slice((n - 1) * PER_PAGE, n * PER_PAGE);

/// Where page `n` of a list lives: the list's own address for page 1, then <base>/page/<n>.
export const pagePath = (base: string, n: number) => (n === 1 ? base : `${base}/page/${n}`);

/// Two other published posts to read next: the same category first, then the rest, in list order.
export function morePosts(slug: string, n = 2): Post[] {
  const me = post(slug);
  const others = published().filter((p) => p.slug !== slug);
  return [...others.filter((p) => p.category === me.category), ...others.filter((p) => p.category !== me.category)].slice(0, n);
}
