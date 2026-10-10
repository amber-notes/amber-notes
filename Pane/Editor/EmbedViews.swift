import LinkPresentation
import SwiftUI
import UniformTypeIdentifiers

/// A file, image or link that lives on its own line in a note.
struct EmbedView: View {
    let embed: LineEmbed
    let controller: EditorController?
    let remove: () -> Void

    var body: some View {
        switch embed.kind {
        case .file(let id, let name):
            FileChip(id: id, name: name, controller: controller, remove: remove)
        case .image(let id, let name):
            ImageEmbed(id: id, name: name, controller: controller, remove: remove)
        case .link(let url):
            LinkCard(url: url, remove: remove)
        case .note(let id, let name):
            if NoteWidgets.isApp(id) {
                SubNoteWidget(id: id, name: name, controller: controller, remove: remove)
            } else {
                SubNoteChip(id: id, name: name, controller: controller, remove: remove)
            }
        }
    }
}

private struct FileChip: View {
    let id: UUID
    let name: String
    let controller: EditorController?
    let remove: () -> Void

    var body: some View {
        let file = controller?.resolveAttachment(id)
        Button { controller?.openAttachment(id) } label: {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .fill(tint(file).opacity(0.16))
                    Image(systemName: icon(file))
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(tint(file))
                }
                .frame(width: 40, height: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(file?.filename ?? name)
                        .font(.system(size: EditorMetrics.body, weight: .medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text(file.map { "\($0.kindText) · \($0.sizeText)" } ?? "File not on this device yet")
                        .font(.system(size: EditorMetrics.body * 0.78))
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                if controller?.downloading.contains(id) == true {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .hoverHighlight(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(PressScale())
        // Content, not a control: a solid surface like the sub-note chip (glass is for the navigation layer).
        .background(Color.paneChip, in: .rect(cornerRadius: 12, style: .continuous))
        .contextMenu { EmbedMenu(open: { controller?.openAttachment(id) }, remove: remove) }
        .accessibilityIdentifier("file.\(name)")
    }

    private func icon(_ f: Attachment?) -> String { f?.symbol ?? "doc" }

    private func tint(_ f: Attachment?) -> Color { f?.tint ?? .secondary }
}

/// A link to a sub-note: its current title and first line; click to open it.
private struct SubNoteChip: View {
    let id: UUID
    let name: String
    let controller: EditorController?
    let remove: () -> Void

    var body: some View {
        let info = controller?.resolveNote(id)
        Button { controller?.openNote(id) } label: {
            HStack(spacing: 12) {
                Image(systemName: "doc.text")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(.tint)
                    .frame(width: 34, height: 34)
                    .background(Color.accentColor.opacity(0.14), in: .rect(cornerRadius: 8, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(info?.title ?? name)
                        .font(.system(size: EditorMetrics.body, weight: .semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text(info?.preview ?? "Sub-note")
                        .font(.system(size: EditorMetrics.body * 0.85))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .hoverHighlight(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .background(Color.paneChip, in: .rect(cornerRadius: 12, style: .continuous))
            .contentShape(.rect(cornerRadius: 12))
        }
        .buttonStyle(PressScale())
        .contextMenu {
            Button("Open Sub-note", systemImage: "arrow.right") { controller?.openNote(id) }
            Divider()
            Button("Remove Link", systemImage: "link.badge.plus", role: .destructive, action: remove)
        }
        .accessibilityIdentifier("subnote.\(info?.title ?? name)")
    }
}

extension Color {
    /// A quiet fill for chips inside a note.
    static var paneChip: Color { Color(PColor.paneFill) }
}

private struct ImageEmbed: View {
    let id: UUID
    let name: String
    let controller: EditorController?
    let remove: () -> Void

    var body: some View {
        let url = controller?.resolveAttachment(id).map { FileStore.url(for: $0.id, filename: $0.filename) }
        Button { controller?.openAttachment(id) } label: {
            // The image fills the slot without changing its size.
            Color.clear
                .overlay {
                    if let url, let image = PlatformImage.load(url) {
                        image.resizable().scaledToFill()
                    } else {
                        ZStack {
                            Rectangle().fill(.fill.tertiary)
                            Image(systemName: "photo").foregroundStyle(.tertiary)
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipShape(.rect(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(.primary.opacity(0.08), lineWidth: 1))
            .hoverOverlay(RoundedRectangle(cornerRadius: 14), .hoverDarken)
        }
        .buttonStyle(PressScale())
        .contextMenu { EmbedMenu(open: { controller?.openAttachment(id) }, remove: remove) }
        .accessibilityLabel("Image, \((name as NSString).deletingPathExtension)")
        .accessibilityHint("Opens it in Quick Look")
        .accessibilityIdentifier("image.\(name)")
    }
}

private enum PlatformImage {
    static func load(_ url: URL) -> Image? {
        #if os(iOS)
        guard let i = UIImage(contentsOfFile: url.path) else { return nil }
        return Image(uiImage: i)
        #else
        guard let i = NSImage(contentsOf: url) else { return nil }
        return Image(nsImage: i)
        #endif
    }
}

private struct EmbedMenu: View {
    let open: () -> Void
    let remove: () -> Void
    var body: some View {
        Button("Open", systemImage: "eye", action: open)
        Divider()
        Button("Remove from Note", systemImage: "trash", role: .destructive, action: remove)
    }
}

/// A rich preview for a link on its own line, using the page's title and icon.
private struct LinkCard: View {
    let url: URL
    let remove: () -> Void
    @State private var meta: LinkMeta?

    var body: some View {
        Link(destination: url) {
            HStack(spacing: 12) {
                Group {
                    if let icon = meta?.icon { icon.resizable().scaledToFit().padding(8) }
                    else { Image(systemName: "globe").font(.system(size: 18)).foregroundStyle(.secondary) }
                }
                .frame(width: 44, height: 44)
                .background(.fill.tertiary, in: .rect(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text(meta?.title ?? url.host() ?? url.absoluteString)
                        .font(.system(size: EditorMetrics.body, weight: .medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text(url.host()?.replacingOccurrences(of: "www.", with: "") ?? url.absoluteString)
                        .font(.system(size: EditorMetrics.body * 0.78))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .hoverHighlight(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(PressScale())
        // Content, not a control: a solid surface like the sub-note chip (glass is for the navigation layer).
        .background(Color.paneChip, in: .rect(cornerRadius: 12, style: .continuous))
        .contextMenu {
            Link(destination: url) { Label("Open Link", systemImage: "safari") }
            Button("Remove Preview", systemImage: "trash", role: .destructive, action: remove)
        }
        .task(id: url) { meta = await LinkMeta.fetch(url) }
        .accessibilityIdentifier("link.\(url.host() ?? "")")
    }
}

/// Title and icon for a URL, cached for the session.
struct LinkMeta {
    var title: String?
    var icon: Image?

    @MainActor private static var cache: [URL: LinkMeta] = [:]

    @MainActor
    static func fetch(_ url: URL) async -> LinkMeta {
        if let hit = cache[url] { return hit }
        let provider = LPMetadataProvider()
        provider.timeout = 8
        var result = LinkMeta()
        if let m = try? await provider.startFetchingMetadata(for: url) {
            result.title = m.title
            if let p = m.iconProvider ?? m.imageProvider {
                result.icon = await loadImage(p)
            }
        }
        cache[url] = result
        return result
    }

    @MainActor
    private static func loadImage(_ provider: NSItemProvider) async -> Image? {
        let data: Data? = await withCheckedContinuation { cont in
            _ = provider.loadDataRepresentation(for: .image) { d, _ in cont.resume(returning: d) }
        }
        guard let data else { return nil }
        #if os(iOS)
        return UIImage(data: data).map { Image(uiImage: $0) }
        #else
        return NSImage(data: data).map { Image(nsImage: $0) }
        #endif
    }
}
