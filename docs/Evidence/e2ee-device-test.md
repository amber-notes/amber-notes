# End-to-end encryption: device test

For one person with an iPhone and a Mac signed in to the same Apple ID, with iCloud Keychain on (Settings › [your name] › iCloud › Passwords and Keychain). Use a fresh Amber Notes account, and builds from `feature/e2ee` pointed at a backend with the e2ee migration: the iPhone from Xcode or TestFlight, the Mac from `scripts/install-mac.sh` (team-signed, so it has the shared Keychain group). The Developer ID download can't use iCloud Keychain and always needs the recovery key.

Write down the times and what you saw in the table at the end.

## 1. First device

1. On the iPhone, sign in to the new account.
2. Expect one screen: "Your notes are encrypted. Only your devices hold the key, not us." Tap Continue.
3. Make a note "Lisbon" with a line of text, a folder "Travel", and attach a photo.
4. Settings › Privacy & Security: the summary reads "Encrypted on your devices. We can't read your notes. When you connect an AI, our server unlocks your notes for that AI's requests." Recovery key shows Not saved.

## 2. The key arrives on the second device (time it)

1. On the Mac, sign in to the same account. Start a stopwatch when you press Sign in.
2. Expect "Enter your recovery key" with "Your key isn't on this device yet." Don't type anything. Stop the stopwatch when your notes appear. Write down the time.
3. If nothing arrives, tap "Wait for iCloud Keychain instead": a spinner for about 20 seconds, then the iCloud Keychain help, with Use recovery key throughout. Keep waiting up to 5 minutes before going on, and write down whether the key arrived.
4. On the Mac, open Lisbon, the Travel folder and the photo. Edit Lisbon; check the edit shows on the iPhone within a second or two.

## 3. The recovery key

1. On the iPhone: Settings › Privacy & Security › Show recovery key. Face ID (or the passcode) is asked first. Write the key down.
2. Save a recovery key › Print (cancel at the print sheet), Save as PDF (save it), Copy. The status turns Saved on this device, and on the Mac after reopening Settings.

## 4. iCloud Keychain off: the fallback

1. On the Mac, sign out of Amber Notes. In System Settings › [your name] › iCloud › Passwords and Keychain, turn Keychain off and choose to delete the items from this Mac.
2. In Terminal: `security find-generic-password -s dev.emilwagman.pane.data-key` should find nothing. (If it's still there, delete Amber Notes' item in Keychain Access, "Amber Notes encryption key".)
3. Sign in to Amber Notes again. Expect "Enter your recovery key" at once, with "Find it on your other device in Amber Notes › Settings › Privacy & Security".
4. Type it with a mistake: expect "That recovery key has a typo." Type it again in lowercase with spaces instead of dashes: your notes appear. Settings › Privacy & Security says the recovery key is Saved.
5. Turn Keychain back on.

## 5. An AI connection

1. On the Mac, in Chrome, add the Amber Notes connector to ChatGPT or Claude (https://mcp.ambernotes.app). ambernotes.app/connect says where access goes and asks you to sign in. Sign in there.
2. First with Amber Notes closed on the iPhone (swipe it away): a push should arrive; tap it and the approval sheet opens. Then with the app open: time how long the sheet takes to appear. It should say "Allow <AI> to use your notes?", the access, and "Requested … from Chrome on a Mac". With the app in the background on the Mac, a notification should appear; tap it.
3. Allow asks for Face ID or Touch ID. The Chrome page goes on to the AI by itself. Check the other device's sheet closes.
4. Ask the AI "What's in my Lisbon note?" and "Add 'Tram 28' to Lisbon". The edit shows in the app, marked as the AI's.
5. Connect again, and this time choose "Use your recovery key" on the page. Sign in, type the recovery key from step 3.1 in lowercase with spaces, and allow. The page goes on to the AI.
6. Try Open Amber Notes on the page on a Mac with the app: the app opens the same request.
7. Disconnect the AI in Settings › Connect an AI. The AI's next request asks you to connect again.

## 6. Start fresh (last resort)

Only on a test account.

1. On the Mac, sign out, delete the Keychain item as in 4.2, and keep iCloud Keychain off.
2. Sign in, choose I don't have my key. Read the copy, type the confirmation, and choose Start fresh.
3. Expect an empty library and the first-launch screen again. On the iPhone, the old notes disappear and it asks for the key again (the Mac's new key reaches it through iCloud Keychain once that's back on, or with the new recovery key).

## Results

| Step | Device | Result | Time |
|---|---|---|---|
| 2.2 key arrived on second device | Mac | | s |
| 2.3 help shown after ~20 s | Mac | | |
| 3.1 Face ID before showing the key | iPhone | | |
| 3.2 Saved on both devices | both | | |
| 4.3 help shown at once, Keychain off | Mac | | |
| 4.4 typo caught, key accepted | Mac | | |
| 5.2 sheet appeared on the other device | iPhone | | s |
| 5.2 notification with the app in the background | Mac | | |
| 5.3 Face ID or Touch ID, page went on by itself | | | |
| 5.5 recovery key approval in the browser | Chrome | | |
| 5.6 Open Amber Notes opened the app | Mac | | |
| 5.7 disconnected AI asked to reconnect | | | |
| 6.3 start fresh | Mac / iPhone | | |
