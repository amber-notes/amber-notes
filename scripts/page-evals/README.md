# Note page evals

Real model sessions against the local MCP server, scored automatically. Each task seeds a fresh in-process Postgres (PGlite, every migration) with one account, its notes and sometimes a page, connects the way Claude Code does, and gives the model one request. Afterwards the note, its page and its page data are read back and scored, and the page is opened in headless WebKit with the app's CSP, `--amber-*` theme and `window.amber` bridge.

```sh
# Default: the subscription CLIs, no per-token billing (Emil, 2026-10-05):
deno run -A scripts/page-evals/run.ts --round r15 --model claude-cli [--cli-model sonnet] [--tasks a,b] [--repeat 3]
deno run -A scripts/page-evals/run.ts --round r15 --model codex-cli [--cli-model <codex model>]
# The per-token APIs (sonnet, opus, openai, or-sonnet, or-gpt) refuse to run without --allow-paid.
deno run -A scripts/page-evals/run.ts --round r8 [--model sonnet|opus|openai] [--skill] [--hide check_app,preview_app] [--tasks a,b] [--server <checkout>] [--budget 40]
deno run -A scripts/page-evals/rescore.ts r6          # score saved sessions again, no model calls
deno run -A scripts/page-evals/summarize.ts           # results/RESULTS.md
deno run -A scripts/page-evals/test-templates.ts      # the skill's templates, same checks
deno run -A scripts/page-evals/build-skill.ts         # regenerate the templates module and the skill's guide
```

- `tasks.ts`: the 31 tasks and their own checks (data kept byte for byte where it should be, rows added right, the page left alone for data changes, and so on).
- `score.ts`: the checks every page task gets: saved and passes the server's checks, no console errors, no network, fits 390 px and 1280 px, shows the note's data, dark mode with readable contrast, labelled controls, uses the app's theme, an edit from the page lands, and robustness probes (a new row with markup in it shows as text, every row removed, 400 rows).
- `../page-render/render.ts`: the app in WebKit (shared with the render service behind check_app and preview_app, which the runner starts in-process); `page_input.ts` (in the server) is the TypeScript twin of the app's `NotePage` data and edits.
- `results/<round>/`: one JSON per session (checks, tool calls, tokens, cost), the page and the note it ended with. Screenshots are kept locally only. `results/spend.jsonl` logs every session's cost; OpenAI costs are estimates at $1.25/$10 per million tokens.
- CLI runs: each task is one `claude -p` or `codex exec` session with only the local Amber MCP server attached (over HTTP on 127.0.0.1), a neutral system prompt, a fresh empty working directory, no user or project settings, CLAUDE.md, AGENTS.md or API keys in its environment (so the subscription is used; a claude session that reports an API key is stopped), at `nice -n 10` and at most two at a time. Their results aren't exactly comparable with the API rounds: each CLI adds its own system prompt and tool wrappers. Compare rank order and failures, not decimals.
- The renderer is silent: every audio context plays through a zero gain and media starts muted.
- `--server <checkout>` runs against another checkout's server, which is how the `r0-proto` baselines were made.
