# App Privacy answers for App Store Connect

App Store Connect → Amber Notes: Notes & Lists → App Privacy. Click through exactly this:

1. **Privacy Policy URL:** https://ambernotes.app/privacy
2. **Get Started → "Do you or your third-party partners collect data from this app?"** → **Yes, we collect data from this app**.
3. Tick these data types, and nothing else:
   - **Contact Info → Email Address** (the account email, from Sign in with Apple or email sign-up)
   - **Contact Info → Name** (the profile name you set, or the name Sign in with Apple shares)
   - **User Content → Photos or Videos** (images you add to notes, and your profile photo)
   - **User Content → Other User Content** (your notes, folders and files)
   - **Identifiers → User ID** (the account identifier)
   - **Usage Data → Product Interaction** (per-account feature counts on our own server: AI edits,
     tips shown and used). Purposes: **Analytics** and **App Functionality** (a tip is never shown
     for a feature you've used). Linked: **Yes**. Tracking: **No**.
4. For each of the other types answer:
   - **How is it used?** → **App Functionality** only.
   - **Is it linked to the user's identity?** → **Yes**.
   - **Used for tracking?** → **No**.
5. **Publish** the answers.

Not collected (leave unticked): location, contacts, browsing or search history, health, financial
info, purchases, diagnostics, sensitive info. The app has no analytics, ads or
crash-reporting SDKs.

Reports about shared pages are made on the website by visitors, not in the app, so they don't
belong in the app's privacy label. The privacy policy covers them.
