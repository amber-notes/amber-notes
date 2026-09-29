import SwiftData
import SwiftUI
import Supabase

/// Settings → Delete Account…: removes the account and everything in it, on the server and on
/// this device. The App Store requires it for apps where you can create an account.
struct DeleteAccountButton: View {
    let backend: Backend
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @State private var asking = false
    @State private var working = false
    @State private var error: String?

    var body: some View {
        Button(role: .destructive) { asking = true } label: {
            HStack(spacing: 8) {
                Text(working ? "Deleting Account…" : "Delete Account…").foregroundStyle(.red)
                if working { ProgressView().controlSize(.small) }
            }
        }
        .disabled(working)
        .accessibilityIdentifier("settings.deleteAccount")
        .confirmationDialog("Delete your Amber Notes account?", isPresented: $asking, titleVisibility: .visible) {
            Button("Delete Account and All Notes", role: .destructive) { Task { await delete() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Every note, folder, file, earlier version, AI connection and share link is deleted from the cloud and from this device. This can't be undone.")
        }
        if let error {
            Label(error, systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
                .font(.callout)
        }
    }

    private func delete() async {
        working = true
        error = nil
        defer { working = false }
        do {
            try await backend.deleteAccount()
            context.wipeLocalLibrary()
            await backend.signOut()
            dismiss()
        } catch {
            self.error = "Couldn't delete your account. Check your connection and try again."
        }
    }
}

extension Backend {
    /// Deletes the signed-in account on the server (files first, then the login; the rest cascades).
    func deleteAccount() async throws {
        guard let client else { throw URLError(.userAuthenticationRequired) }
        try await client.functions.invoke("account", options: FunctionInvokeOptions(method: .delete))
    }
}

extension ModelContext {
    /// Forgets every note, folder and file on this device (after the account is gone).
    @MainActor func wipeLocalLibrary() {
        // One by one (a batch delete refuses rows that other rows still point at), and through
        // `erase` so it's SwiftData's delete, not Library's delete(folder) that moves to Recently Deleted.
        func erase<T: PersistentModel>(_ type: T.Type) {
            for m in (try? fetch(FetchDescriptor<T>())) ?? [] { delete(m) }
        }
        erase(Attachment.self)
        erase(Note.self)
        erase(Folder.self)
        try? save()
        try? FileManager.default.removeItem(at: FileStore.root)
    }
}
