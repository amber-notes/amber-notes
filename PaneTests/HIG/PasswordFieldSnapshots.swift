#if os(macOS)
import AppKit
import SwiftData
import SwiftUI
import Testing
@testable import Pane

/// Every Mac screen with a password field, for a look at the eye button: the field on its own
/// (dots, and shown), the locked note, and the notes password sheets. Offscreen; nothing touches
/// the screen. Runs only when AMBER_HIG_SHOTS is set (the "snapshots" label on a pull request).
@MainActor @Suite(.serialized) struct PasswordFieldSnapshots {
    @Test(arguments: [false, true]) func theFieldAsDotsAndShown(dark: Bool) async throws {
        guard let dir = AppSnapshotTests.dir else { return }
        var shown = PasswordReveal()
        shown.toggle()
        let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
        func boxed(_ reveal: PasswordReveal, _ text: String) -> some View {
            PasswordField("Password", text: .constant(text), id: "shot.password", reveal: reveal)
                .textFieldStyle(.plain)
                .padding(.leading, 10)
                .padding(.trailing, 4)
                .frame(height: 30)
                .background(Color(Palette.field), in: shape)
                .overlay(shape.strokeBorder(Color(Palette.fieldHairline), lineWidth: 1))
        }
        let view = VStack(spacing: 12) {
            boxed(PasswordReveal(), "")
            boxed(PasswordReveal(), "correct horse battery")
            boxed(shown, "correct horse battery")
            Form {
                PasswordField("Password", text: .constant("correct horse battery"), id: "shot.form")
                PasswordField("Verify", text: .constant("correct horse battery"), id: "shot.formShown", reveal: shown)
            }
            .formStyle(.grouped)
        }
        .padding(20)
        .frame(width: 400, height: 300)
        .background(Color(nsColor: .windowBackgroundColor))
        try await shoot(view, "field", CGSize(width: 400, height: 300), dark, in: dir)
    }

    @Test(arguments: [false, true]) func theNotesPasswordSheets(dark: Bool) async throws {
        guard let dir = AppSnapshotTests.dir else { return }
        let c = try AppSnapshotTests.container()
        try await shoot(NotesPasswordSetupSheet(onDone: {}).frame(width: 440, height: 480), "set", CGSize(width: 440, height: 480), dark, in: dir)
        try await shoot(ChangeNotesPasswordSheet(sync: nil).modelContainer(c).frame(width: 440, height: 400), "change", CGSize(width: 440, height: 400), dark, in: dir)
    }

    @Test(arguments: [false, true]) func theLockedNote(dark: Bool) async throws {
        guard let dir = AppSnapshotTests.dir else { return }
        let c = try AppSnapshotTests.container()
        let note = try #require(try c.mainContext.fetch(FetchDescriptor<Note>()).first)
        let view = LockedNoteView(note: note).modelContainer(c).frame(width: 560, height: 420).background(Color(nsColor: .textBackgroundColor))
        try await shoot(view, "locked-note", CGSize(width: 560, height: 420), dark, in: dir)
    }

    private func shoot(_ view: some View, _ name: String, _ size: CGSize, _ dark: Bool, in dir: URL) async throws {
        try await VersionHistorySnapshots.shoot(view, to: dir.appending(path: "mac-password-\(name)-\(dark ? "dark" : "light").png"), size: size, dark: dark)
    }
}
#endif
