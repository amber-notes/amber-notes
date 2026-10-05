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
            if script == "owner" { await owner(context, store: store) } else { await member(store: store) }
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
            content.alert(store.invite.map { "\($0.from) shared \u{201C}\($0.title)\u{201D} with you" } ?? "",
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
