import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// The first time someone opens an app (or a note) they added from the website: what it is, that
/// their AI can change it, that nothing is lost, and Start. Once per person for apps and once for
/// notes; after that, a template only gets "Added to your notes". (Prototype: three designs to
/// choose from, `-firstOpen a|b|c`: a sheet over the app, a card inside it, a welcome before it.)
@MainActor
@Observable
final class FirstOpen {
    static let shared = FirstOpen()
    /// Who a template's app is from, for NotePageStore (no "made this note an app" receipt).
    static let templateWriter = "Template"

    enum Variant: String { case a, b, c }
    nonisolated(unsafe) static var variant: Variant = Capture.argument("-firstOpen").flatMap(Variant.init(rawValue:)) ?? .a

    struct Moment: Equatable, Identifiable {
        var note: UUID
        var isApp: Bool
        var title: String
        var description: String?
        var ask: String?
        var slug: String
        var preview: Data?
        /// The full moment (the first time), or just "Added to your notes".
        var full: Bool
        var id: UUID { note }
    }

    private(set) var pending: [UUID: Moment] = [:]
    @ObservationIgnored private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if ProcessInfo.processInfo.arguments.contains("-resetFirstOpen") {
            defaults.removeObject(forKey: Self.key(app: true))
            defaults.removeObject(forKey: Self.key(app: false))
        }
    }

    private static func key(app: Bool) -> String { app ? "firstOpen.appShown" : "firstOpen.noteShown" }

    func added(note: UUID, draft: NoteDraft) {
        let app = draft.appProject != nil
        pending[note] = Moment(note: note, isApp: app, title: draft.title, description: draft.description, ask: draft.ask,
                               slug: draft.link.slug, preview: draft.preview, full: !defaults.bool(forKey: Self.key(app: app)))
    }

    /// Captures: as if it had never been shown, and nothing waiting.
    func reset() {
        defaults.removeObject(forKey: Self.key(app: true))
        defaults.removeObject(forKey: Self.key(app: false))
        pending = [:]
    }

    /// Start: seen, never shown again for that kind.
    func start(_ m: Moment) {
        if m.full { defaults.set(true, forKey: Self.key(app: m.isApp)) }
        pending[m.note] = nil
    }

    /// The paper-cut picture for a template, by its slug; a general one otherwise.
    static func illustration(for m: Moment) -> String {
        let named = "firstopen-\(m.slug.replacingOccurrences(of: "-tracker", with: ""))"
        if Bundle.main.url(forResource: named, withExtension: "jpg") != nil { return named }
        if Bundle.main.url(forResource: "firstopen-\(m.slug)", withExtension: "jpg") != nil { return "firstopen-\(m.slug)" }
        return m.isApp ? "firstopen-apps" : "firstopen-note"
    }

    static func image(_ name: String) -> Image? {
        guard let url = Bundle.main.url(forResource: name, withExtension: "jpg") else { return nil }
        #if os(iOS)
        return UIImage(contentsOfFile: url.path).map { Image(uiImage: $0) }
        #else
        return NSImage(contentsOf: url).map { Image(nsImage: $0) }
        #endif
    }

    static func image(data: Data?) -> Image? {
        guard let data else { return nil }
        #if os(iOS)
        return UIImage(data: data).map { Image(uiImage: $0) }
        #else
        return NSImage(data: data).map { Image(nsImage: $0) }
        #endif
    }
}

/// The words and the button, the same in all three designs.
struct FirstOpenContent: View {
    let moment: FirstOpen.Moment
    /// How much room it has: a sheet or a welcome shows the picture large; a card, small.
    var compact = false
    let start: () -> Void
    @Environment(Backend.self) private var backend: Backend?
    @Environment(SyncEngine.self) private var sync: SyncEngine?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var connected: Bool?
    @State private var connecting = false
    @State private var copied = false
    @State private var shown = false

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 14 : 18) {
            Text(moment.isApp ? "\(moment.title) is in your notes" : "\(moment.title) is in your notes")
                .font(.system(compact ? .title3 : .title2, design: .default, weight: .bold))
                .foregroundStyle(Color.ink)
                .fixedSize(horizontal: false, vertical: true)
                .entrance(shown, 0, reduceMotion)
            if moment.isApp {
                row(1, "lock.fill", "This app lives in your notes. It works offline, syncs to your iPhone and Mac, and only you can read it.")
                aiRow(2)
                row(3, "arrow.uturn.backward", "Every change has Undo, and it always keeps the last working version.")
            } else {
                if let d = moment.description { row(1, "text.alignleft", d) }
                aiRow(2)
            }
            Button(action: start) {
                Text("Start").frame(maxWidth: .infinity)
            }
            .buttonStyle(.amberProminent(height: 48, cornerRadius: 14))
            .accessibilityIdentifier("firstOpen.start")
            .entrance(shown, 4, reduceMotion)
            .padding(.top, 2)
        }
        .task {
            await check()
            withAnimation(reduceMotion ? .easeOut(duration: 0.2) : .spring(duration: 0.55, bounce: 0.2)) { shown = true }
        }
        .sheet(isPresented: $connecting, onDismiss: { Task { await check() } }) {
            if let backend { SettingsView(backend: backend, sync: sync) }
        }
    }

    private func row(_ i: Int, _ symbol: String, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.amberInk)
                .frame(width: 22)
            Text(text)
                .foregroundStyle(Color.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .entrance(shown, i, reduceMotion)
    }

    /// "Your AI can change it", with one thing to ask (copy it); without an AI, Connect an AI.
    private func aiRow(_ i: Int) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: "sparkles")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.amberInk)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 8) {
                Text(moment.isApp ? "Your AI can change it. Try asking:" : "Your AI fills it in. Try asking:")
                    .foregroundStyle(Color.ink)
                if let ask = moment.ask {
                    Button { copy(ask) } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text("\u{201C}\(ask)\u{201D}")
                                .multilineTextAlignment(.leading)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 4)
                            Image(systemName: copied ? "checkmark" : "doc.on.doc")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Color.amberInk)
                        }
                        .font(.callout)
                        .foregroundStyle(Color.ink)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .background(Color.amberSoft, in: .rect(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.line, lineWidth: 1))
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Copy: \(ask)")
                    .accessibilityIdentifier("firstOpen.ask")
                }
                if connected == false {
                    Button("Connect an AI") { connecting = true }
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(Color.amberInk)
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("firstOpen.connect")
                }
            }
        }
        .entrance(shown, i, reduceMotion)
    }

    private func copy(_ text: String) {
        #if os(iOS)
        UIPasteboard.general.string = text
        #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #endif
        withAnimation(.smooth) { copied = true }
    }

    private func check() async {
        if ProcessInfo.processInfo.arguments.contains("-aiConnected") { connected = true; return }
        guard let client = backend?.client else { connected = false; return }
        struct Row: Decodable { var revoked_at: Date? }
        let rows: [Row] = (try? await client.from("mcp_tokens").select("revoked_at").execute().value) ?? []
        connected = rows.contains { $0.revoked_at == nil }
    }
}

/// The paper-cut picture at the top: solid, rounded, cropped to a band.
struct FirstOpenArt: View {
    let moment: FirstOpen.Moment
    var height: CGFloat = 170
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    var body: some View {
        Group {
            if let image = FirstOpen.image(FirstOpen.illustration(for: moment)) {
                image.resizable().scaledToFill()
            } else {
                Color.amberSoft
            }
        }
        .frame(height: height)
        .frame(maxWidth: .infinity)
        .clipShape(.rect(cornerRadius: 18, style: .continuous))
        .scaleEffect(shown || reduceMotion ? 1 : 0.96)
        .opacity(shown ? 1 : 0)
        .onAppear { withAnimation(.spring(duration: 0.6, bounce: 0.25)) { shown = true } }
        .accessibilityHidden(true)
    }
}

/// A: a sheet over the app, the app visible behind it.
struct FirstOpenSheet: View {
    let moment: FirstOpen.Moment
    let start: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                FirstOpenArt(moment: moment, height: moment.isApp ? 120 : 110)
                FirstOpenContent(moment: moment, start: start)
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 12)
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(Color.notePage)
        #if os(iOS)
        // Low enough that the app shows above it.
        .presentationDetents(moment.isApp ? [.fraction(0.8), .large] : [.fraction(0.6), .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(Color.notePage)
        #else
        .frame(width: 460, height: moment.isApp ? 600 : 460)
        #endif
        .interactiveDismissDisabled()
    }
}

/// B: a card at the top of the app, inside it; gone after Start.
struct FirstOpenCard: View {
    let moment: FirstOpen.Moment
    let start: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            FirstOpenArt(moment: moment, height: 96)
            FirstOpenContent(moment: moment, compact: true, start: start)
        }
        .padding(16)
        .background(Color.notePage, in: .rect(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.line, lineWidth: 1))
        .shadow(color: Color(red: 0.24, green: 0.12, blue: 0.02).opacity(0.10), radius: 16, y: 6)
        .padding(.horizontal, 14)
        .padding(.top, 8)
        // A width to lay its lines out at even when asked for its ideal size (the window's).
        .frame(minWidth: 300, idealWidth: 560, maxWidth: 640)
    }
}

/// C: a short welcome before the app, with a picture of it.
struct FirstOpenWelcome: View {
    let moment: FirstOpen.Moment
    let start: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                ZStack(alignment: .bottomTrailing) {
                    FirstOpenArt(moment: moment, height: 230)
                    // The app itself, as it will open.
                    if let preview = FirstOpen.image(data: moment.preview) {
                        preview.resizable().scaledToFill()
                            .frame(width: 118, height: 236, alignment: .top)
                            .clipShape(.rect(cornerRadius: 18, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color.line, lineWidth: 1))
                            .shadow(color: .black.opacity(0.22), radius: 14, y: 8)
                            .rotationEffect(.degrees(shown || reduceMotion ? 4 : 0))
                            .offset(x: -18, y: shown || reduceMotion ? 46 : 80)
                            .opacity(shown ? 1 : 0)
                            .accessibilityHidden(true)
                    }
                }
                .padding(.bottom, moment.preview == nil ? 0 : 40)
                FirstOpenContent(moment: moment, start: start)
            }
            .padding(.horizontal, 24)
            .padding(.top, 28)
            .padding(.bottom, 24)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(Color.notePage.ignoresSafeArea())
        .onAppear { withAnimation(.spring(duration: 0.7, bounce: 0.25).delay(0.15)) { shown = true } }
        #if os(macOS)
        .frame(width: 520, height: 680)
        #endif
    }
}

extension View {
    /// A gentle entrance: rises a little and fades in, one after another.
    func entrance(_ shown: Bool, _ i: Int, _ reduceMotion: Bool) -> some View {
        self
            .opacity(shown ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : 8)
            .animation(reduceMotion ? .easeOut(duration: 0.2) : .spring(duration: 0.5, bounce: 0.15).delay(0.08 * Double(i)), value: shown)
    }
}
