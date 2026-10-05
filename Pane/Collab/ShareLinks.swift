import CryptoKit
import Foundation
import SwiftData
import SwiftUI

/// Read-only links and shared templates (prototype; docs/Technical/collaboration-design.md).
///
/// A sealed link is `<site>/s/<id>#<secret>`: the note, its page and the page's data, sealed here
/// under a key from the secret, which only the link holds (web/lib/sealed-share.ts opens it).
/// A shared template is `<site>/t/<id>`: published readable on purpose, holding only the note's
/// skeleton, its page, its table layout, sample rows if you include them, and the names of keys
/// the page asks for.
enum SealedLink {
    static func randomID(bytes n: Int) -> String {
        E2EE.randomBytes(n).base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    struct Copy: Codable, Equatable {
        var v = 1
        var title: String
        var body: String
        var page: String?
        var data: [String: String]?
        var shared_by: Sharer?
        var updated_at: String
        struct Sharer: Codable, Equatable { var name: String? }
    }

    private static func key(_ secret: Data, id: String) -> SymmetricKey {
        HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: secret), salt: E2EE.hkdfSalt, info: Data("share \(id)".utf8), outputByteCount: 32)
    }

    static func seal(_ copy: Copy, id: String, secret: Data) throws -> String {
        let box = try AES.GCM.seal(try JSONEncoder().encode(copy), using: key(secret, id: id), authenticating: Data("amb3r|\(id)".utf8))
        guard let combined = box.combined else { throw CollabCrypto.Failure.malformed }
        return "amb3r." + combined.base64EncodedString()
    }

    static func open(_ sealed: String, id: String, secret: Data) throws -> Copy {
        guard sealed.hasPrefix("amb3r."), let b = Data(base64Encoded: String(sealed.dropFirst(6))),
              let box = try? AES.GCM.SealedBox(combined: b) else { throw CollabCrypto.Failure.malformed }
        guard let plain = try? AES.GCM.open(box, using: key(secret, id: id), authenticating: Data("amb3r|\(id)".utf8)) else { throw CollabCrypto.Failure.wrongKey }
        return try JSONDecoder().decode(Copy.self, from: plain)
    }

    static func base64url(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

/// What a shared template holds. Built from the note; never the note's real rows unless you choose
/// to include them as sample data, and never a key's value.
struct SharedTemplate: Codable, Equatable {
    struct Key: Codable, Equatable { var name: String; var host: String? }
    struct Needs: Codable, Equatable { var keys: [Key]; var hosts: [String] }
    struct Layout: Codable, Equatable { var table: Int; var columns: [String] }
    var v = 1
    var title: String
    var description: String?
    var note: String
    var sample: String?
    var page: String?
    var layout: [Layout]
    var needs: Needs

    /// The note with every table's rows taken out: its headings, text and table headers stay.
    static func skeleton(of body: String) -> String {
        var out: [String] = []
        var inTable = false
        let lines = body.components(separatedBy: "\n")
        for (i, line) in lines.enumerated() {
            let t = line.trimmingCharacters(in: .whitespaces)
            let isRow = t.hasPrefix("|")
            if isRow, !inTable, i + 1 < lines.count, lines[i + 1].trimmingCharacters(in: .whitespaces).hasPrefix("|"), lines[i + 1].contains("-") {
                inTable = true
                out.append(line)
                continue
            }
            if inTable, isRow {
                if t.allSatisfy({ "|-: ".contains($0) }) { out.append(line) }
                continue
            }
            inTable = false
            // Ticked checklist items start unticked.
            out.append(line.replacingOccurrences(of: "- [x] ", with: "- [ ] ").replacingOccurrences(of: "- [X] ", with: "- [ ] "))
        }
        return out.joined(separator: "\n")
    }

    /// The keys and hosts a page declares in `<meta name="amber-needs" content='{"keys":[…],"hosts":[…]}'>`.
    static func needs(of page: String?) -> Needs {
        guard let page, let r = page.range(of: #"<meta name="amber-needs" content='([^']*)'"#, options: .regularExpression) else { return Needs(keys: [], hosts: []) }
        let tag = String(page[r])
        guard let start = tag.range(of: "content='")?.upperBound, let json = tag[start...].split(separator: "'").first,
              let n = try? JSONDecoder().decode(Needs.self, from: Data(json.utf8)) else { return Needs(keys: [], hosts: []) }
        // Names and hosts only, whatever else the page wrote there.
        return Needs(keys: n.keys.map { Key(name: $0.name, host: $0.host) }, hosts: n.hosts)
    }

    static func make(from body: String, page: String?, includeSample: Bool) -> SharedTemplate {
        let lines = body.components(separatedBy: "\n")
        let layout = lines.indices.filter { i in
            lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("|") && i + 1 < lines.count && lines[i + 1].contains("---")
                && (i == 0 || !lines[i - 1].trimmingCharacters(in: .whitespaces).hasPrefix("|"))
        }.enumerated().map { n, i in
            Layout(table: n, columns: lines[i].split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty })
        }
        let description = NoteText.head(of: body).preview
        return SharedTemplate(title: NoteText.title(of: body), description: description, note: skeleton(of: body),
                              sample: includeSample ? body : nil, page: page, layout: layout, needs: needs(of: page))
    }
}

extension CollabStore {
    /// Where shared pages open (`-shareSite`), ambernotes.app in the product.
    static var site: String {
        Capture.argument("-shareSite") ?? "http://localhost:5230"
    }

    /// Seals the note (and its page) for a new link. A new link replaces the old one, which stops
    /// working at once (rotation); publishing again keeps the link and updates the copy.
    func publishLink(_ note: Note, rotate: Bool = false) async throws -> URL {
        guard let relay else { throw CollabRelay.Problem(message: "Not connected") }
        let link = rotate ? nil : links[note.id]
        let id = link?.id ?? SealedLink.randomID(bytes: 16)
        let secret = link?.secret ?? E2EE.randomBytes(16)
        let copy = SealedLink.Copy(title: note.title, body: note.body, page: pages[note.id], data: nil,
                                   shared_by: .init(name: name), updated_at: ISO8601DateFormatter().string(from: note.updatedAt))
        try await relay.rpc("publish_sealed_link", [id, note.id.uuidString.lowercased(), try SealedLink.seal(copy, id: id, secret: secret)])
        links[note.id] = (id, secret)
        return URL(string: "\(Self.site)/s/\(id)#\(SealedLink.base64url(secret))")!
    }

    func stopLink(_ note: Note) async throws {
        try await relay?.rpc("stop_sealed_link", [note.id.uuidString.lowercased()])
        links[note.id] = nil
    }

    func publishTemplate(_ note: Note, includeSample: Bool) async throws -> URL {
        guard let relay else { throw CollabRelay.Problem(message: "Not connected") }
        let id = templates[note.id] ?? SealedLink.randomID(bytes: 12)
        let t = SharedTemplate.make(from: note.body, page: pages[note.id], includeSample: includeSample)
        let json = String(decoding: try JSONEncoder().encode(t), as: UTF8.self)
        try await relay.rpc("publish_template", [id, note.id.uuidString.lowercased(), name, json])
        templates[note.id] = id
        return URL(string: "\(Self.site)/t/\(id)")!
    }

    func stopTemplate(_ note: Note) async throws {
        try await relay?.rpc("stop_template", [note.id.uuidString.lowercased()])
        templates[note.id] = nil
    }

    /// "Use template": a fresh note from a shared template, with its page. Its page starts with no
    /// network; hosts and keys wait for the new owner to allow them.
    func useTemplate(_ id: String) async -> Note? {
        guard let context, let url = URL(string: "\(relayURLString)/public/template/\(id)"),
              let (data, _) = try? await URLSession.shared.data(from: url) else { return nil }
        struct Row: Decodable { let maker: String?; let template: SharedTemplate }
        guard let row = try? JSONDecoder().decode(Row.self, from: data) else { return nil }
        let note = context.createNote(in: .all, body: row.template.sample ?? row.template.note)
        pages[note.id] = row.template.page
        try? context.save()
        NoteOpener.shared.open(note.id)
        return note
    }
}

/// "Share as template": a public page others can start from. Your notes and data stay out of it,
/// unless you include this note's rows as sample data.
struct TemplateShareSheet: View {
    let note: Note
    let store: CollabStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            TemplateForm(note: note, store: store)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

/// Share as Template's content: in its own sheet, or pushed from Share. A preview of the page
/// people will see, one line, one toggle, one button. What the template's app needs is said on the
/// template page itself, not here.
struct TemplateForm: View {
    let note: Note
    let store: CollabStore
    @Environment(\.dismiss) private var dismiss
    @State private var includeRows = false
    @State private var url: URL?
    @State private var working = false
    @State private var copied = false

    var body: some View {
        Form {
            Section {
                TemplateCard(template: SharedTemplate.make(from: note.body, page: store.pages[note.id], includeSample: includeRows), maker: store.name)
                    .listRowInsets(EdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12))
            }
            Section {
                Toggle("Include example rows", isOn: $includeRows)
                Button { Task { await share() } } label: {
                    Label(copied ? "Link Copied" : working ? "Sharing…" : "Share Template Link", systemImage: copied ? "checkmark" : "square.and.arrow.up")
                }
                .disabled(working)
                .accessibilityIdentifier("template.share")
            } footer: {
                Text("Your notes and data aren't included.")
            }
            if url != nil {
                Section {
                    Button("Stop Sharing Template", role: .destructive) { Task { try? await store.stopTemplate(note); url = nil } }
                        .font(.callout)
                }
            }
        }
        .formStyle(.grouped)
        #if os(macOS)
        .buttonStyle(.borderless)
        #endif
        .navigationTitle("Share as Template")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task {
            guard CollabDemo.autoShareTemplate else { return }
            CollabDemo.autoShareTemplate = false
            includeRows = true
            try? await Task.sleep(for: .seconds(2.2))
            await share(present: false)
            try? await Task.sleep(for: .seconds(2))
            dismiss()
        }
    }

    /// Publishes (or updates) the template and hands its link to the system share sheet on iPhone;
    /// on the Mac it copies the link and says so.
    private func share(present: Bool = true) async {
        working = true
        defer { working = false }
        guard let link = try? await store.publishTemplate(note, includeSample: includeRows) else { return }
        url = link
        CollabDemo.wrote("template", link)
        guard present else { return }
        #if os(iOS)
        SystemShare.present(link)
        #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(link.absoluteString, forType: .string)
        withAnimation(.snappy) { copied = true }
        try? await Task.sleep(for: .seconds(1.6))
        withAnimation(.snappy) { copied = false }
        #endif
    }
}

/// The template as its page will show it: a small card with the app (or the note) and who shared it.
struct TemplateCard: View {
    let template: SharedTemplate
    let maker: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image("Mark").resizable().frame(width: 16, height: 16).clipShape(.rect(cornerRadius: 4))
                Text("Shared by \(maker)").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Text("Use template")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.notePage)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Color(Palette.ink), in: .capsule)
            }
            Text(template.title).font(.headline)
            // The first lines of what they'd get; with example rows, those show too.
            Text(preview).font(.caption).foregroundStyle(.secondary).lineLimit(5)
            if template.page != nil {
                Label("With its app", systemImage: "square.grid.2x2").font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.notePage, in: .rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color(Palette.pair(0xE7DCCF, 0x3A342E)), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Preview: \(template.title), shared by \(maker)")
    }

    /// The first lines of what people would get, as they read: table rows as "Date · Walk · Read",
    /// separator rows left out, checkboxes as circles.
    private var preview: String {
        (template.sample ?? template.note).components(separatedBy: "\n").dropFirst().compactMap { line -> String? in
            let t = line.trimmingCharacters(in: .whitespaces)
            guard !t.isEmpty, !t.allSatisfy({ "|-: ".contains($0) }) else { return nil }
            if t.hasPrefix("|") {
                return t.split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: " · ")
            }
            return t.replacingOccurrences(of: "- [ ] ", with: "○ ").replacingOccurrences(of: "- [x] ", with: "● ")
        }.prefix(5).joined(separator: "\n")
    }
}

#if os(iOS)
/// The system share sheet for a link, from wherever the app is.
enum SystemShare {
    @MainActor static func present(_ url: URL) {
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first,
              var top = scene.keyWindow?.rootViewController else { return }
        while let next = top.presentedViewController { top = next }
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = top.view
        top.present(sheet, animated: true)
    }
}
#endif
