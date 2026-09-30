// Domain verification for ChatGPT's plugin directory. OpenAI fetches
// https://<MCP host>/.well-known/openai-apps-challenge and expects the token from its dashboard,
// alone in the body. The token lives in the OPENAI_APPS_CHALLENGE secret, so setting it needs no deploy.

export const OPENAI_CHALLENGE_PATH = "/.well-known/openai-apps-challenge";

export function openaiChallenge(token: string | undefined): Response {
  const t = token?.trim();
  if (!t) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(t, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
