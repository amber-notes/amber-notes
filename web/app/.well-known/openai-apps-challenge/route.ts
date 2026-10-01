// Domain verification for ChatGPT's plugin directory. OpenAI fetches
// https://mcp.ambernotes.app/.well-known/openai-apps-challenge (middleware.ts lets this path through
// to the site) and expects the token from the plugin's dashboard as plain text, alone in the body:
// no newline, no JSON. The token is a public challenge, not a secret.

export const dynamic = "force-static";

export function GET() {
  return new Response("63ThANIdhp-bJNHKaegib3mD6AXGcWuB4Dvwj-m3eqs", { headers: { "content-type": "text/plain; charset=utf-8" } });
}
