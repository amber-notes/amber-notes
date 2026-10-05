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

/// "Share link": a read-only copy anyone with the link can open, sealed so we can't read it.
struct LinkShareSheet: View {
    let note: Note
    let store: CollabStore
    @Environment(\.dismiss) private var dismiss
    @State private var url: URL?
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if let url {
                        Text(url.absoluteString).font(.footnote.monospaced()).textSelection(.enabled).accessibilityIdentifier("share.link")
                        Button("Copy Link", systemImage: "doc.on.doc") { copy(url) }
                        Button("Make a New Link", systemImage: "arrow.triangle.2.circlepath") { Task { await publish(rotate: true) } }
                        Button("Stop Sharing", systemImage: "xmark.circle", role: .destructive) {
                            Task { try? await store.stopLink(note); self.url = nil; dismiss() }
                        }
                    } else {
                        ProgressView()
                    }
                } footer: {
                    Text("Anyone with the link can read this note\(store.pages[note.id] == nil ? "" : " and use its app, read only"). The end of the link is the key that opens it, so we can't read the copy. A new link stops the old one.")
                }
                if let problem { Text(problem).foregroundStyle(.red) }
            }
            .navigationTitle("Share Link")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await publish(rotate: false) }
        }
    }

    private func publish(rotate: Bool) async {
        do { let u = try await store.publishLink(note, rotate: rotate); url = u; CollabDemo.wrote("link", u) } catch { problem = error.localizedDescription }
    }

    private func copy(_ url: URL) {
        #if os(iOS)
        UIPasteboard.general.url = url
        #else
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(url.absoluteString, forType: .string)
        #endif
    }
}

/// "Share as template": a public page others can start from. Your notes and data stay out of it,
/// unless you include this note's rows as sample data.
struct TemplateShareSheet: View {
    let note: Note
    let store: CollabStore
    @Environment(\.dismiss) private var dismiss
    @State private var includeSample = true
    @State private var url: URL?
    @State private var working = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Toggle("Include sample data", isOn: $includeSample).disabled(url != nil)
                } footer: {
                    Text(includeSample ? "This note's rows go in as sample data, so people see the app working. Leave this off if they're private." : "Tables go in empty: only the headings and columns.")
                }
                let t = SharedTemplate.make(from: note.body, page: store.pages[note.id], includeSample: includeSample)
                Section("In the template") {
                    LabeledContent("Note", value: "Headings and table columns")
                    if t.page != nil { LabeledContent("App", value: "This note's page") }
                    LabeledContent("Sample data", value: includeSample ? "\(note.body.components(separatedBy: "\n").count - t.note.components(separatedBy: "\n").count) rows" : "None")
                    LabeledContent("Keys", value: t.needs.keys.isEmpty ? "None" : t.needs.keys.map(\.name).joined(separator: ", "))
                }
                Section {
                    if let url {
                        Text(url.absoluteString).font(.footnote.monospaced()).textSelection(.enabled)
                        Button("Stop Sharing", systemImage: "xmark.circle", role: .destructive) { Task { try? await store.stopTemplate(note); dismiss() } }
                    } else {
                        Button(working ? "Sharing…" : "Share Template") { Task { await share() } }.disabled(working)
                            .accessibilityIdentifier("template.share")
                    }
                } footer: {
                    Text("Anyone with the link can see and use this template. Your notes and data are not included, and keys are listed by name only.")
                }
            }
            .navigationTitle("Share as Template")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task {
                guard CollabDemo.autoShareTemplate else { return }
                CollabDemo.autoShareTemplate = false
                try? await Task.sleep(for: .seconds(2.2))
                await share()
                try? await Task.sleep(for: .seconds(3))
                dismiss()
            }
        }
    }

    private func share() async {
        working = true
        defer { working = false }
        url = try? await store.publishTemplate(note, includeSample: includeSample)
        if let url { CollabDemo.wrote("template", url) }
    }
}
