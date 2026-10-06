// ~/.config/amber/config.json ($XDG_CONFIG_HOME respected): the token and, if not the default,
// the server. The file is mode 600 and its folder 700.
export const DEFAULT_SERVER = "https://mcp.ambernotes.app";

export type Config = { token?: string; server?: string };

export function configPath(): string {
  const base = Deno.env.get("XDG_CONFIG_HOME") || `${Deno.env.get("HOME")}/.config`;
  return `${base}/amber/config.json`;
}

export async function loadConfig(): Promise<Config> {
  try {
    return JSON.parse(await Deno.readTextFile(configPath()));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return {};
    throw new Error(`${configPath()} can't be read: ${(e as Error).message}`);
  }
}

export async function saveConfig(c: Config): Promise<void> {
  const path = configPath();
  const dir = path.slice(0, path.lastIndexOf("/"));
  await Deno.mkdir(dir, { recursive: true, mode: 0o700 });
  await Deno.chmod(dir, 0o700);
  // Created with mode 600 before the token is in it.
  const tmp = `${path}.tmp`;
  await Deno.writeTextFile(tmp, "", { mode: 0o600 });
  await Deno.chmod(tmp, 0o600);
  await Deno.writeTextFile(tmp, JSON.stringify(c, null, 2) + "\n");
  await Deno.rename(tmp, path);
}
