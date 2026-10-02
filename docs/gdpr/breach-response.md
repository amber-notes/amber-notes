# Personal data breach: what to do

Internal. GDPR Articles 33 and 34. A breach is any security problem that leads to personal data
being lost, changed, disclosed or accessed without permission: a leaked service key, an RLS bug that
lets one account read another's rows, a stolen laptop with production credentials, a Vercel or
Supabase incident that affects our project.

## The first hour

1. **Contain it.** Rotate what leaked: the Supabase service role key and JWT secret (Dashboard →
   Project Settings → API), `MCP_PROXY_SECRET` and `REPORT_SALT` (Vercel → Project → Settings →
   Environment Variables, then redeploy), App Store Connect and signing keys if they're involved.
   Revoke AI connections if tokens may have leaked (`update public.mcp_tokens set revoked_at = now() ...`).
   Take shared pages down if they're the problem (`select public.admin_take_down('<slug>')`).
2. **Start the log.** Keep it private, outside this public repo (it may name people). Write the time
   you found out: the 72 hours run from then.
3. **Keep the evidence.** Supabase keeps logs for only 1 day and Vercel for 1 hour on our plans.
   Export what matters now (Supabase → Logs → Download; Vercel → Logs).

## Within 72 hours

4. **Assess.** Answer these in the log:
   - What happened, and when did it start and end?
   - Which data was affected (notes, emails, tokens, locked-note ciphertext, IP addresses)?
   - How many accounts were affected?
   - What are the likely consequences for the people affected?
   - What has been done to contain it?
5. **Notify IMY unless the breach is unlikely to result in a risk to people.** Use IMY's e-service
   at imy.se (report a personal data breach). If you don't know everything yet, report what you know
   and add to it later. If you decide not to notify, write down why in the log. Examples:
   - Notify: note text or emails exposed.
   - Probably not: only locked-note ciphertext exposed, or salted hashes that can't be reversed.

## Tell the people affected

6. **When the risk to them is high**, tell them directly, without undue delay (Article 34), by
   email and in the app. Say in plain words:
   - what happened;
   - what data it involved;
   - what we've done;
   - what they should do, for example disconnect and reconnect AI apps, or change a reused password;
   - who to contact: hello@ambernotes.app.

## Afterwards

7. Fix the cause. Add a regression test, as for any bug.
8. Keep the log for at least 3 years, whether or not you notified. Article 33(5) requires documenting every breach.
9. If a processor caused it (Supabase, Vercel), ask for their incident report. Note it in the log.

## Processors telling us

Supabase and Vercel notify breaches to the account email. Make sure the owner email on both is one
you read (hello@ambernotes.app), and treat a breach notice from them as step 1.
