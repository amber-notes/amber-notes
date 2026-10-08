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
    /// The folders the app left for us, and the one this goes into (the last one used).
    var folders: [Inbox.FolderChoice] = Inbox.folders()
    var folder: UUID? = Inbox.lastFolder

    init(context: NSExtensionContext?) {
        self.context = context
        if let f = folder, !folders.contains(where: { $0.id == f }) { folder = nil }
        if folder == nil { folder = (folders.first { $0.name == "Notes" } ?? folders.first)?.id }
    }

    /// Files shared without text are kept in the folder as files; anything with text is a note.
    var asFiles: Bool { markdown.isEmpty && !files.isEmpty }

    var title: String { SharedItem.title(markdown: markdown, files: files) }

    func load() async {
        let providers = (context?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        // The same conversion as the Mac's Apple Notes import (see SharedItem).
        let content = await SharedItem.read(providers, filesInto: FileManager.default.temporaryDirectory)
        markdown = content.markdown
        files = content.files
        loading = false
    }

    func save() {
        do {
            try Inbox.add(markdown: markdown, files: files, folder: folder)
            Inbox.lastFolder = folder
            saved = true
            Task {
                try? await Task.sleep(for: .milliseconds(650))
                context?.completeRequest(returningItems: nil)
            }
        } catch {
            self.error = "Couldn't save. Open Pinto Notes once, then try again."
        }
    }

    func cancel() { context?.cancelRequest(withError: CocoaError(.userCancelled)) }
}

struct ShareSheet: View {
    @Bindable var model: ShareModel

    var body: some View {
        // Laid out like the system's own share sheets: the bar on top, the item below, filling the sheet.
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Button("Cancel", action: model.cancel)
                Spacer()
                HStack(spacing: 7) {
                    AppMark(size: 22)
                    Text("Pinto Notes").font(.headline)
                }
                .accessibilityElement(children: .combine)
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
                            Text(model.markdown.split(separator: "\n").dropFirst().prefix(8).joined(separator: "\n"))
                                .font(.callout).foregroundStyle(.secondary).lineLimit(8)
                        }
                        if !model.files.isEmpty {
                            Label(model.files.count == 1 ? model.files[0].lastPathComponent : "\(model.files.count) files", systemImage: "paperclip")
                                .font(.callout).foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(.background, in: .rect(cornerRadius: 14, style: .continuous))
                }
            }
            if !model.loading && !model.folders.isEmpty {
                // Where it goes, as a row under the item, like Notes' own share sheet.
                HStack {
                    Text("Folder")
                    Spacer()
                    Picker("Folder", selection: $model.folder) {
                        ForEach(model.folders) { f in
                            Text(f.name).tag(UUID?.some(f.id))
                        }
                    }
                    .labelsHidden()
                    .accessibilityIdentifier("share.folder")
                }
                .padding(.leading, 14)
                .padding(.vertical, 4)
                .background(.background, in: .rect(cornerRadius: 14, style: .continuous))
                if model.asFiles {
                    Text(model.files.count == 1 ? "Kept in the folder as a file." : "Kept in the folder as files.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 14)
                }
            }
            if let e = model.error {
                Text(e).font(.footnote).foregroundStyle(.red).accessibilityIdentifier("share.error")
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 20)
        .padding(.top, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color(uiColor: .systemGroupedBackground))
        .tint(Color("AccentColor"))
        .animation(.snappy(duration: 0.2), value: model.saved)
    }
}
