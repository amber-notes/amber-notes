import SwiftData
import SwiftUI
#if os(iOS)
import UIKit
#endif

/// Collaboration (prototype): the scripted demo two simulators play side by side
/// (scripts/collab-demo.sh). `-collabScript owner` shares "Team offsite" and invites Sara;
/// `-collabScript member` accepts. Then both type into the note at once.
///
/// The typing goes through the text view's own keyboard path (`insertText`), so lists continue on
/// Return and every keystroke takes the same route as a real one. Nothing is driven from outside the
/// app and no input events are posted.
@MainActor
enum CollabDemo {
    static let invite = Notification.Name("pane.collabDemoInvite")
    /// The address the people sheet types and invites when it next opens.
    static var pendingInvite: String?
    static let showShare = Notification.Name("pane.collabDemoShowShare")
    /// The template sheet shares by itself when it opens (the demo).
    static var autoShareTemplate = false
    /// The note the share demo shares.
    static var sharedNote: Note?

    /// The demo's links, for scripts/share-demo.sh to open in Safari: Documents/share-demo.txt.
    static func wrote(_ kind: String, _ url: URL) {
        guard Capture.argument("-collabScript") == "share" else { return }
        let file = URL.documentsDirectory.appending(path: "share-demo.txt")
        let line = "\(kind) \(url.absoluteString)\n"
        if let h = try? FileHandle(forWritingTo: file) { h.seekToEndOfFile(); h.write(Data(line.utf8)); try? h.close() }
        else { try? Data(line.utf8).write(to: file) }
    }

    static let offsite = """
    Team offsite, 14 November

    ## Agenda
    - 09:00 Coffee and goals for Q1
    - 10:30 Roadmap review
    - 12:30 Lunch at Tranan

    ## Bring
    - [ ] Laptop and charger
    - [ ] Printed customer quotes
    """

    static func run(_ context: ModelContext, store: CollabStore) {
        guard let script = Capture.argument("-collabScript") else { return }
        Task { @MainActor in
            while !store.isReady { try? await Task.sleep(for: .seconds(0.2)) }
            switch script {
            case "owner": await owner(context, store: store)
            case "share": await share(context, store: store)
            default: await member(store: store)
            }
        }
    }

    private static func pause(_ s: Double) async { try? await Task.sleep(for: .seconds(s)) }

    private static func owner(_ context: ModelContext, store: CollabStore) async {
        let note = context.createNote(in: .all, body: offsite)
        await pause(1.2)
        NoteOpener.shared.open(note.id)
        await pause(2.5)
        guard let session = try? await store.share(note) else { return }
        // Sara's phone has made her account by now; invite her from the people sheet.
        while (try? await store.find("sara@example.com")) == nil { await pause(0.5) }
        pendingInvite = "sara@example.com"
        NotificationCenter.default.post(name: invite, object: nil)
        // Wait for her to open it, then write together.
        while session.peers.isEmpty { await pause(0.3) }
        await pause(2.0)
        await type("\n15:00 Customer stories, Sara and Emil", after: "12:30 Lunch at Tranan", context)
        await pause(1.2)
        await type(" (bring the Q3 numbers)", after: "10:30 Roadmap review", context)
        await pause(1.5)
        await type("\nSpeaker clicker", after: "Printed customer quotes", context)
    }

    /// Read-only link and template: a habit tracker with its app (`-collabPage <path to html>`), shared
    /// as an encrypted link, then as a template. scripts/share-demo.sh opens both in Safari.
    private static func share(_ context: ModelContext, store: CollabStore) async {
        try? FileManager.default.removeItem(at: URL.documentsDirectory.appending(path: "share-demo.txt"))
        let note = context.createNote(in: .all, body: habitNote())
        sharedNote = note
        if let path = Capture.argument("-collabPage"), let html = try? String(contentsOfFile: path, encoding: .utf8) { store.pages[note.id] = html }
        try? context.save()
        await pause(1.0)
        NoteOpener.shared.open(note.id)
        await pause(2.0)
        NotificationCenter.default.post(name: showShare, object: "link")
        await pause(4.5)
        autoShareTemplate = true
        NotificationCenter.default.post(name: showShare, object: "template")
        // What the person taps next, handed over by scripts/share-demo.sh as lines in
        // Documents/demo-command.txt: "use <template id>" (Use template on the site) and "stop"
        // (Stop Sharing in the link's sheet). Opening ambernotes:// links from the script makes iOS
        // ask "Open in Amber Notes?", which nothing here can answer.
        let file = URL.documentsDirectory.appending(path: "demo-command.txt")
        try? FileManager.default.removeItem(at: file)
        while true {
            await pause(0.4)
            guard let text = try? String(contentsOf: file, encoding: .utf8) else { continue }
            try? FileManager.default.removeItem(at: file)
            for line in text.split(separator: "\n") {
                let parts = line.split(separator: " ").map(String.init)
                if parts.first == "use", parts.count == 2 { _ = await store.useTemplate(parts[1]) }
                if parts.first == "stop" { try? await store.stopLink(note) }
            }
        }
    }

    /// Fourteen days of habits ending today, as on the note-pages branch (Capture.habitNote).
    static func habitNote(today: Date = .now) -> String {
        let marks = ["✓✓·✓", "✓✓✓✓", "·✓✓·", "✓✓✓✓", "✓·✓✓", "✓✓✓·", "··✓✓", "✓✓✓✓", "✓✓·✓", "✓✓✓✓", "✓·✓✓", "✓✓✓✓", "✓✓✓·", "✓✓✓✓", "✓···"]
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        let rows = marks.enumerated().map { i, m in
            let d = Calendar.current.date(byAdding: .day, value: i - (marks.count - 1), to: today)!
            return "| \(f.string(from: d)) | " + m.map { $0 == "✓" ? "✓" : " " }.joined(separator: " | ") + " |"
        }
        return "Habit tracker\n\nSmall things, most days. A ✓ means done.\n\n| Date | Walk | Read | Stretch | No phone in bed |\n| --- | --- | --- | --- | --- |\n"
            + rows.joined(separator: "\n") + "\n"
    }

    private static func member(store: CollabStore) async {
        while store.invite == nil { await pause(0.3) }
        await pause(2.6)
        if let invite = store.invite { await store.accept(invite) }
        await pause(3.2)
        await type(" and decide the top three bets", after: "Coffee and goals for Q1", nil)
        await pause(0.8)
        await type("\nName badges", after: "Laptop and charger", nil)
        await pause(1.0)
        await type("\n17:00 Dinner, table for 9", after: "Customer stories, Sara and Emil", nil, waitForAnchor: true)
    }

    /// Puts the caret at the end of `anchor` and types `text` a character at a time.
    private static func type(_ text: String, after anchor: String, _ context: ModelContext?, waitForAnchor: Bool = false) async {
        #if os(iOS)
        var view: UITextView?
        for _ in 0..<100 {
            if let v = editor(), (v.text as NSString).range(of: anchor).location != NSNotFound { view = v; break }
            if !waitForAnchor, let v = editor() { view = v; break }
            await pause(0.2)
        }
        guard let view else { return }
        if !view.isFirstResponder { view.becomeFirstResponder(); await pause(0.6) }
        let r = (view.text as NSString).range(of: anchor)
        guard r.location != NSNotFound else { return }
        view.selectedRange = NSRange(location: NSMaxRange(r), length: 0)
        await pause(0.5)
        for ch in text {
            // Return asks the editor first, as the keyboard does, so lists continue.
            if ch == "\n", let delegate = view.delegate,
               delegate.textView?(view, shouldChangeTextIn: view.selectedRange, replacementText: "\n") == false {
                await pause(0.15)
                continue
            }
            view.insertText(String(ch))
            await pause(ch == " " ? 0.11 : Double.random(in: 0.06...0.13))
        }
        #endif
    }

    #if os(iOS)
    private static func editor() -> UITextView? {
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
        func find(_ v: UIView) -> UITextView? {
            if let t = v as? PaneTextView, t.window != nil, !t.isHidden { return t }
            for s in v.subviews { if let t = find(s) { return t } }
            return nil
        }
        for w in windows { if let t = find(w) { return t } }
        return nil
    }
    #endif
}

/// "Emil shared a note with you": the invitation, with the safety code, and Open.
struct CollabInviteAlert: ViewModifier {
    @State private var store = CollabStore.shared

    func body(content: Content) -> some View {
        if let store {
            content
            // "Use template" on a shared template's page (ambernotes://shared-template/<id>).
            .onOpenURL { url in
                guard url.scheme == "ambernotes" else { return }
                if url.host == "shared-template", let id = url.pathComponents.dropFirst().first { Task { _ = await store.useTemplate(id) } }
                // scripts/share-demo.sh: Stop Sharing on the demo note, as its sheet would.
                if url.host == "demo", url.path == "/stop-link", Capture.argument("-collabScript") == "share", let note = CollabDemo.sharedNote {
                    Task { try? await store.stopLink(note) }
                }
            }
            .alert(store.invite.map { "\($0.from) shared \u{201C}\($0.title)\u{201D} with you" } ?? "",
                          isPresented: Binding(get: { store.invite != nil }, set: { if !$0, let i = store.invite { store.decline(i) } })) {
                Button("Not Now", role: .cancel) { if let i = store.invite { store.decline(i) } }
                Button("Open") { if let i = store.invite { Task { await store.accept(i) } } }
            } message: {
                Text("You can both edit it, and see each other while you do. It stays end-to-end encrypted.\n\nSafety code \(store.invite?.safetyCode ?? "")")
            }
        } else {
            content
        }
    }
}
