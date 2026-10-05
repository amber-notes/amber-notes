# Note page evals

Real model sessions against the local MCP server, scored automatically. Each task seeds a fresh in-process Postgres (PGlite, every migration) with one account, its notes and sometimes a page, connects the way Claude Code does, and gives the model one request. Afterwards the note, its page and its page data are read back and scored, and the page is opened in headless WebKit with the app's CSP, `--amber-*` theme and `window.amber` bridge.

```sh
# Anthropic key from the environment; OpenAI's for --model openai (OPENAI_EVAL_MODEL, default gpt-5).
deno run -A scripts/page-evals/run.ts --round r6 [--model sonnet|opus|openai] [--skill] [--tasks a,b] [--server <checkout>] [--budget 25]
deno run -A scripts/page-evals/rescore.ts r6          # score saved sessions again, no model calls
deno run -A scripts/page-evals/summarize.ts           # results/RESULTS.md
deno run -A scripts/page-evals/test-templates.ts      # the skill's templates, same checks
deno run -A scripts/page-evals/build-skill.ts         # regenerate the templates module and the skill's guide
```

- `tasks.ts`: the 24 tasks and their own checks (data kept byte for byte where it should be, rows added right, the page left alone for data changes, and so on).
- `score.ts`: the checks every page task gets: saved and passes the server's checks, no console errors, no network, fits 390 px and 1280 px, shows the note's data, dark mode with readable contrast, labelled controls, uses the app's theme, an edit from the page lands, and robustness probes (a new row with markup in it shows as text, every row removed, 400 rows).
- `render.ts`: the page in WebKit; `page_input.ts` (in the server) is the TypeScript twin of the app's `NotePage` data and edits.
- `results/<round>/`: one JSON per session (checks, tool calls, tokens, cost), the page and the note it ended with. Screenshots are kept locally only. `results/spend.jsonl` logs every session's cost; OpenAI costs are estimates at $1.25/$10 per million tokens.
- `--server <checkout>` runs against another checkout's server, which is how the `r0-proto` baselines were made.
