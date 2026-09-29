import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// "Save to Amber Notes" from any app's share sheet (Apple Notes, Safari, Files…).
final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        let model = ShareModel(context: extensionContext)
        let host = UIHostingController(rootView: ShareSheet(model: model))
        host.view.backgroundColor = .clear
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
        Task { await model.load() }
    }
}

@MainActor
@Observable
final class ShareModel {
    let context: NSExtensionContext?
    var markdown = ""
    var files: [URL] = []
    var loading = true
    var saved = false
    var error: String?

    init(context: NSExtensionContext?) { self.context = context }

    var title: String {
        let t = markdown.split(separator: "\n").map { String($0).trimmingCharacters(in: .whitespaces) }.first { !$0.isEmpty } ?? ""
        return t.isEmpty ? (files.first?.lastPathComponent ?? "Shared item") : t.replacingOccurrences(of: #"^#+\s*"#, with: "", options: .regularExpression)
    }

    func load() async {
        let providers = (context?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        var texts: [String] = []
        for p in providers {
            if let md = await richText(p) { texts.append(md); continue }
            if p.hasItemConformingToTypeIdentifier(UTType.url.identifier), !p.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier),
               let url = try? await p.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
                texts.append(url.absoluteString); continue
            }
            if p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
               let s = try? await p.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                texts.append(s); continue
            }
            if let f = await file(p) { files.append(f) }
        }
        markdown = texts.joined(separator: "\n\n")
        loading = false
    }

    /// Rich text (Apple Notes, Pages, web pages) → markdown.
    private func richText(_ p: NSItemProvider) async -> String? {
        let kinds: [(String, NSAttributedString.DocumentType)] = [
            ("com.apple.flat-rtfd", .rtfd), (UTType.rtfd.identifier, .rtfd), (UTType.rtf.identifier, .rtf), (UTType.html.identifier, .html),
        ]
        for (type, doc) in kinds where p.hasItemConformingToTypeIdentifier(type) {
            let data: Data? = await withCheckedContinuation { c in _ = p.loadDataRepresentation(forTypeIdentifier: type) { d, _ in c.resume(returning: d) } }
            guard let raw = data else { continue }
            // HTML is converted offline: nothing it references is fetched.
            let safe = doc == .html ? OfflineHTML.strip(raw) : raw
            guard let a = try? NSAttributedString(data: safe, options: [.documentType: doc, .characterEncoding: String.Encoding.utf8.rawValue], documentAttributes: nil) else { continue }
            let md = RichTextToMarkdown.markdown(from: a).replacingOccurrences(of: "\u{FFFC}", with: "")
            if !md.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return md }
        }
        return nil
    }

    private func file(_ p: NSItemProvider) async -> URL? {
        guard let type = p.registeredTypeIdentifiers.first else { return nil }
        let name = p.suggestedName
        return await withCheckedContinuation { c in
            _ = p.loadFileRepresentation(forTypeIdentifier: type) { src, _ in
                guard let src else { c.resume(returning: nil); return }
                let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
                try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                let ext = src.pathExtension
                let fname = name.map { ext.isEmpty || $0.hasSuffix(".\(ext)") ? $0 : "\($0).\(ext)" } ?? src.lastPathComponent
                let dest = dir.appending(path: fname)
                c.resume(returning: (try? FileManager.default.copyItem(at: src, to: dest)) != nil ? dest : nil)
            }
        }
    }

    func save() {
        do {
            try Inbox.add(markdown: markdown, files: files)
            saved = true
            Task {
                try? await Task.sleep(for: .milliseconds(650))
                context?.completeRequest(returningItems: nil)
            }
        } catch {
            self.error = "Couldn't save. Open Amber Notes once, then try again."
        }
    }

    func cancel() { context?.cancelRequest(withError: CocoaError(.userCancelled)) }
}

struct ShareSheet: View {
    @Bindable var model: ShareModel

    var body: some View {
        VStack {
            Spacer()
            VStack(alignment: .leading, spacing: 14) {
                // A share sheet's bar: Cancel leading, the action trailing, the destination between.
                HStack {
                    Button("Cancel", action: model.cancel)
                    Spacer()
                    Text("Amber Notes").font(.headline)
                    Spacer()
                    Button(action: model.save) {
                        if model.saved {
                            Label("Saved", systemImage: "checkmark").labelStyle(.titleAndIcon)
                        } else {
                            Text("Save").fontWeight(.semibold)
                        }
                    }
                    .disabled(model.loading || model.saved || (model.markdown.isEmpty && model.files.isEmpty))
                    .accessibilityIdentifier("share.save")
                }
                .frame(minHeight: 44)
                Group {
                    if model.loading {
                        ProgressView().frame(maxWidth: .infinity, minHeight: 80)
                    } else {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(model.title).font(.title3.weight(.semibold)).lineLimit(2)
                            if !model.markdown.isEmpty {
                                Text(model.markdown.split(separator: "\n").dropFirst().prefix(4).joined(separator: "\n"))
                                    .font(.callout).foregroundStyle(.secondary).lineLimit(4)
                            }
                            if !model.files.isEmpty {
                                Label(model.files.count == 1 ? model.files[0].lastPathComponent : "\(model.files.count) files", systemImage: "paperclip")
                                    .font(.callout).foregroundStyle(.secondary)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                        .background(.fill.tertiary, in: .rect(cornerRadius: 14))
                    }
                }
                if let e = model.error { Text(e).font(.footnote).foregroundStyle(.red) }
            }
            .padding(20)
            .glassEffect(.regular, in: .rect(cornerRadius: 28))
            .padding(12)
            .tint(Color("AccentColor"))
            .animation(.snappy(duration: 0.2), value: model.saved)
        }
    }
}
