# Security

Please report security problems privately to **hello@ambernotes.app**, not in a public issue.

Include what you found, how to reproduce it, and what an attacker could do with it. You'll get a reply within a few days. Once a fix is out, you're welcome to publish the details, and I'll credit you if you like.

In scope: the apps, the Supabase migrations and Edge Functions in `supabase/`, the MCP server and its OAuth flow, and the share site in `web/`. Please don't test against other people's accounts or data, and don't load-test the production project; run the local stack (`supabase start`) instead.
