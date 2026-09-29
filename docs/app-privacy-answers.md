# App Privacy answers for App Store Connect

App Store Connect → Amber Notes → App Privacy. Needed once before external TestFlight testing
works (and for the App Store later). Click through exactly this:

1. **Privacy Policy URL:** the share site's /privacy page (e.g. https://<vercel-url>/privacy).
2. **Get Started → "Do you or your third-party partners collect data from this app?"** → **Yes, we collect data from this app**.
3. Tick these data types, and nothing else:
   - **Contact Info → Email Address**
   - **Contact Info → Name** (Sign in with Apple may share it)
   - **User Content → Other User Content** (your notes)
   - **User Content → Photos or Videos** (images you add to notes)
   - **Identifiers → User ID** (the account identifier from Sign in with Apple)
4. For **each** of those types answer:
   - **How is it used?** → **App Functionality** only.
   - **Is it linked to the user's identity?** → **Yes**.
   - **Used for tracking?** → **No**.
5. **Publish** the answers.

Not collected (leave unticked): location, contacts, browsing/search history, health, financial info,
purchases, usage data, diagnostics, sensitive info. The app has no analytics or crash reporting SDKs.
