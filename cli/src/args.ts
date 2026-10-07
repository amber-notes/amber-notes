// Command-line arguments.
const SWITCHES = ["json", "all", "off", "pin", "no-browser", "read-only", "token", "help", "version", "files", "count", "case", "numbers"];
const OPTIONS = ["server", "limit", "offset", "glob", "path", "C"];

/** Flags are only the ones amber knows, so note text like "- [ ] Milk" or "-1" stays an argument.
 *  After "--", everything is an argument. */
export function parse(argv: string[]): { _: string[] } & Record<string, any> {
  const out: { _: string[] } & Record<string, any> = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") { out._.push(...argv.slice(i + 1)); break; }
    const m = a.match(/^--?([a-zA-Z][a-z-]*)(?:=(.*))?$/);
    const name = m ? ({ h: "help", v: "version" } as Record<string, string>)[m[1]] ?? m[1] : "";
    if (m && SWITCHES.includes(name) && m[2] === undefined) out[name] = true;
    else if (m && OPTIONS.includes(name)) out[name] = m[2] ?? argv[++i];
    else out._.push(a);
  }
  return out;
}
