import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// "Make it an app" (prototype; see NotePage): apps are made by the person's own AI, so this hands
/// their AI a ready prompt for this note, or, with no AI connected yet, leads to connecting one.
enum MakeAnApp {
    /// A note that would make a good app: a table, or a checklist of three items or more.
    static func looksLikeAnApp(_ body: String) -> Bool {
        let lines = body.components(separatedBy: "\n")
        return !NotePage.tables(in: lines).isEmpty || lines.filter { ListPrefix(line: $0)?.checkbox != nil }.count >= 3
    }

    /// What to ask for, from what the note holds.
    static func idea(for body: String) -> String {
        let lines = body.components(separatedBy: "\n")
        if let t = NotePage.tables(in: lines).first {
            let names = t.columns.map { $0.name.lowercased() }
            if names.contains(where: { $0.contains("amount") || $0.contains("cost") || $0.contains("price") || $0 == "kr" }) {
                return "a budget app with the total, spending by category, and a quick way to add an expense"
            }
            if names.contains("date") {
                return "a tracker app: today's entry at the top, streaks, and a chart of the last weeks"
            }
            return "an app that shows this table as cards I can sort, filter and add to"
        }
        if lines.contains(where: { ListPrefix(line: $0)?.checkbox != nil }) {
            return "a checklist app that shows what's left, groups the items, and lets me add and tick them"
        }
        return "an app for this note"
    }

    static func prompt(title: String, body: String) -> String {
        "In Amber Notes, make my note \u{201C}\(title)\u{201D} an app: \(idea(for: body)). Read the note first, keep its table or checklist as the data, and use set_note_page."
    }

    // Notes the suggestion was shown on: once per note, never again.
    private static let shownKey = "makeAppChipShown"
    static func chipShown(_ id: UUID) -> Bool { (UserDefaults.standard.stringArray(forKey: shownKey) ?? []).contains(id.uuidString) }
    static func markChipShown(_ id: UUID) {
        var all = UserDefaults.standard.stringArray(forKey: shownKey) ?? []
        guard !all.contains(id.uuidString) else { return }
        all.append(id.uuidString)
        UserDefaults.standard.set(Array(all.suffix(500)), forKey: shownKey)
    }
}

/// The small suggestion on a note that looks like it could be an app. Shown once per note.
struct MakeAppChip: View {
    let open: () -> Void
    let dismiss: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Button(action: open) {
                Label("Make this an app", systemImage: NoteAppMark.symbol)
                    .font(.system(size: AIReceipt.text, weight: .semibold))
                    .foregroundStyle(Color.amberInk)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("makeApp.chip")
            Divider().frame(height: 14)
            Button(action: dismiss) {
                Image(systemName: "xmark").font(.system(size: AIReceipt.text - 2, weight: .semibold)).foregroundStyle(Color.amberInk.opacity(0.7))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Not now")
        }
        .padding(.horizontal, 14)
        .frame(height: AIReceipt.height)
        .background(Color.amberSoft, in: .capsule)
        .overlay(Capsule().strokeBorder(Color.amberInk.opacity(0.22), lineWidth: 0.5))
        .shadow(color: Color(red: 0.24, green: 0.12, blue: 0.02).opacity(0.12), radius: 12, y: 6)
    }
}

/// Make It an App: the prompt for your AI, or connecting one first.
struct MakeAppSheet: View {
    let title: String
    let body_: String
    @Environment(Backend.self) private var backend: Backend?
    @Environment(SyncEngine.self) private var sync: SyncEngine?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var connected: Bool?
    @State private var showPromptAnyway = false
    @State private var connecting = false
    @State private var copied = false

    private var prompt: String { MakeAnApp.prompt(title: title, body: body_) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if connected == true || showPromptAnyway { ask } else if connected == false { connect } else { ProgressView().frame(maxWidth: .infinity) }
                }
                .padding(20)
            }
            .navigationTitle("Make It an App")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await check() }
            .sheet(isPresented: $connecting, onDismiss: { Task { await check() } }) {
                if let backend { SettingsView(backend: backend, sync: sync) }
            }
        }
        #if os(macOS)
        .frame(minWidth: 460, minHeight: 420)
        #endif
    }

    private var ask: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Ask your AI").font(.title2.weight(.bold))
            Text("Your AI writes the app and it shows up on this note. The note stays as it is; the app is a second side you can switch to.")
                .foregroundStyle(.secondary)
            Text(prompt)
                .font(.callout)
                .textSelection(.enabled)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.paneChip, in: .rect(cornerRadius: 14, style: .continuous))
                .accessibilityIdentifier("makeApp.prompt")
            Button { copy() } label: {
                Label(copied ? "Copied" : "Copy Prompt", systemImage: copied ? "checkmark" : "doc.on.doc").frame(maxWidth: .infinity)
            }
            .buttonStyle(.amberProminent(height: 44, cornerRadius: 12))
            .accessibilityIdentifier("makeApp.copy")
            HStack(spacing: 10) {
                Button("Open ChatGPT") { copy(); open("https://chatgpt.com/?q=") }.frame(maxWidth: .infinity)
                Button("Open Claude") { copy(); open("https://claude.ai/new?q=") }.frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
    }

    private var connect: some View {
        VStack(alignment: .leading, spacing: 16) {
            Image(systemName: NoteAppMark.symbol).font(.system(size: 34, weight: .semibold)).foregroundStyle(Color.amberInk)
            Text("Apps are made by your AI").font(.title2.weight(.bold))
            Text("Connect ChatGPT or Claude to Amber Notes, then ask it to make this note an app: a tracker with streaks, a budget with totals, whatever the note needs. Connecting takes about 2 minutes.")
                .foregroundStyle(.secondary)
            Button { connecting = true } label: { Text("Connect an AI").frame(maxWidth: .infinity) }
                .buttonStyle(.amberProminent(height: 44, cornerRadius: 12))
                .accessibilityIdentifier("makeApp.connect")
            Button("Show the Prompt") { withAnimation(.smooth) { showPromptAnyway = true } }
                .frame(maxWidth: .infinity)
                .accessibilityIdentifier("makeApp.showPrompt")
        }
    }

    /// Whether any AI is connected to this account.
    private func check() async {
        if ProcessInfo.processInfo.arguments.contains("-aiConnected") { connected = true; return }
        guard let client = backend?.client else { connected = false; return }
        let rows: [Connection] = (try? await client.from("mcp_tokens").select().execute().value) ?? []
        connected = rows.contains { $0.revoked_at == nil }
    }

    private func copy() {
        #if os(iOS)
        UIPasteboard.general.string = prompt
        #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(prompt, forType: .string)
        #endif
        withAnimation(.smooth) { copied = true }
    }

    private func open(_ base: String) {
        guard let q = prompt.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed.subtracting(.init(charactersIn: "&=?+"))),
              let url = URL(string: base + q) else { return }
        openURL(url)
    }
}

// MARK: App settings

/// App Info: what only Amber Notes can do for a note's app. An app's own settings are the app's
/// (it draws them, and keeps them in its data); this holds the internet (which addresses it may
/// reach, what it sent, the libraries it downloaded), Previous App and Remove App.
struct AppInfoSheet: View {
    let noteID: UUID
    let html: String
    var hasPrevious = false
    var previous: () -> Void = {}
    var remove: () -> Void = {}
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                internet
                Section {
                    if hasPrevious {
                        Button("Previous App") { previous(); dismiss() }
                            .accessibilityIdentifier("appInfo.previous")
                    }
                    Button("Remove App", role: .destructive) { remove(); dismiss() }
                        .foregroundStyle(.red)
                        .accessibilityIdentifier("appInfo.remove")
                } footer: {
                    Text(hasPrevious ? "Removing the app keeps the note as it is. Previous App brings the one before back." : "Removing the app keeps the note as it is.")
                }
            }
            .formStyle(.grouped)
            .navigationTitle("App Info")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.accessibilityIdentifier("appInfo.done")
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 320)
        #endif
    }

    /// Which addresses the app may reach, and its last requests (keys hidden).
    @ViewBuilder
    private var internet: some View {
        let log = NotePageNetLog.shared
        let hosts = (log.approved[noteID] ?? []).sorted()
        let entries = Array((log.entries[noteID] ?? []).suffix(8).reversed())
        let libs = NotePageLibraries.downloaded(for: html)
        Section {
            if hosts.isEmpty && entries.isEmpty && libs.isEmpty {
                Text("This app hasn't used the internet.").foregroundStyle(.secondary)
            }
            ForEach(libs, id: \.self) { l in Label("Downloaded library: \(l)", systemImage: "shippingbox") }
            ForEach(hosts, id: \.self) { h in Label(h, systemImage: "checkmark.circle") }
            ForEach(entries) { e in
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text(e.method).font(.caption.monospaced().weight(.semibold))
                        Text(e.status.map(String.init) ?? e.error ?? "").font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Text(e.at, style: .time).font(.caption).foregroundStyle(.secondary)
                    }
                    Text(e.url).font(.caption.monospaced()).lineLimit(3).textSelection(.enabled)
                    if e.carriesNoteText {
                        Label("Includes text from this note", systemImage: "text.quote").font(.caption.weight(.semibold)).foregroundStyle(Color.amberInk)
                    }
                }
            }
            if !hosts.isEmpty {
                Button("Forget Allowed Addresses", role: .destructive) { log.forget(noteID) }
            }
        } header: {
            Text("Internet")
        } footer: {
            Text("The app asks before it reaches a new address. Everything it sends is listed here.")
        }
    }

}

import Supabase

/// Settings › Apps in Notes: whether an AI may preview a note's app with the note's real data
/// (pages-ai-tooling's preview_app; profiles.app_previews_real). Off by default: previews use made-up
/// data shaped like the note. Hidden on a backend without the setting.
struct AppPreviewSection: View {
    let client: SupabaseClient
    @State private var on = false
    @State private var available = false
    @State private var saving = false

    private struct Row: Codable { var user_id: UUID?; var app_previews_real: Bool }

    var body: some View {
        Group {
            if available {
                Section {
                    Toggle("Let AIs preview apps with my notes", isOn: Binding(get: { on }, set: { v in on = v; Task { await save(v) } }))
                        .disabled(saving)
                        .accessibilityIdentifier("settings.appPreviewsReal")
                } header: {
                    Text("Apps in Notes")
                } footer: {
                    Text("When your AI checks an app it made, it sees a picture of it. With this off, the picture uses made-up data shaped like your note. With it on, it shows your note's real data, decrypted for that check only.")
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        guard let user = client.auth.currentUser?.id else { return }
        let rows: [Row]? = try? await client.from("profiles").select("app_previews_real").eq("user_id", value: user).execute().value
        guard let rows else { return }
        on = rows.first?.app_previews_real ?? false
        available = true
    }

    private func save(_ v: Bool) async {
        guard let user = client.auth.currentUser?.id else { return }
        saving = true
        defer { saving = false }
        do {
            try await client.from("profiles").upsert(Row(user_id: user, app_previews_real: v), onConflict: "user_id").execute()
        } catch {
            on = !v
        }
    }
}
