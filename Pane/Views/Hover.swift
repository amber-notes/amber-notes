import SwiftUI

/// What's under the pointer, on the Mac: rows take a light fill, icon buttons a soft rounded
/// background, plain-text buttons an underline (links also the pointing hand, as macOS does
/// for links only). A selected row stays stronger than a hovered one.
///
/// Each view keeps its own hover in its own `@State`, so moving the pointer redraws that row or
/// button and nothing else: never the list, the sidebar or the window around it
/// (`HoverTests` checks this). On iPhone these do nothing.
enum Hover {
    /// In and out quickly, so the fill follows the pointer without trailing it.
    static let animation = Animation.easeOut(duration: 0.12)
    /// A hovered row: a light fill, well under the selection's.
    static let row = AnyShapeStyle(.fill.quinary)
    /// A hovered icon button or plain button with its own shape.
    static let fill = AnyShapeStyle(.fill.tertiary)
    /// The same button while pressed.
    static let pressed = AnyShapeStyle(.fill.secondary)
    /// Where a Mac list draws its selection around a row's content (a List can't take a row
    /// background of its own there), and its corners. Measured from the selection in captures.
    static let listReach = EdgeInsets(top: 2, leading: 6, bottom: 2, trailing: 6)
    /// The sidebar's selection reaches further, to the left past the icon, and a level of
    /// sub-folders moves the content right by `sidebarIndent`.
    static func sidebarReach(depth: Int = 0) -> EdgeInsets {
        EdgeInsets(top: 7.5, leading: 15 + CGFloat(depth) * sidebarIndent, bottom: 7.5, trailing: 6)
    }
    static let sidebarIndent: CGFloat = 12
    static let rowRadius: CGFloat = 5
}

extension EnvironmentValues {
    /// Captures only: draws as hovered the rows with these ids ("*" for every hoverable view),
    /// since a capture has no pointer. Never set in the app.
    @Entry var hoverPreview: Set<String> = []
}

extension View {
    /// A list row that takes a light fill under the pointer, in the selection's own place
    /// (`reach`: how far the selection reaches past the row's content). `id` names the row for
    /// captures.
    func hoverRow(_ id: String = "", reach: EdgeInsets = Hover.listReach) -> some View {
        modifier(HoverRow(id: id, reach: reach))
    }

    /// A plain button or control with a shape of its own: a light fill under the pointer, behind
    /// its content. Put it before the control's own background, so the fill lands on top of it.
    func hoverHighlight<S: InsettableShape>(_ shape: S) -> some View {
        modifier(HoverHighlight(shape: shape))
    }

    /// A button with a solid fill of its own (Sign in with Apple, a picture): `tint` laid over it
    /// under the pointer.
    func hoverOverlay<S: InsettableShape>(_ shape: S, _ tint: Color) -> some View {
        modifier(HoverOverlay(shape: shape, tint: tint))
    }
}

/// How much a hover overlay lightens a dark fill or darkens a light one.
extension Color {
    static let hoverLighten = Color.white.opacity(0.12)
    static let hoverDarken = Color.black.opacity(0.06)
}

/// The pointer's state for one view, and nothing outside it.
struct HoverTracking: ViewModifier {
    let id: String
    @Binding var hovering: Bool

    func body(content: Content) -> some View {
        content
            #if os(macOS)
            .onHover { over in
                guard over != hovering else { return }
                withAnimation(Hover.animation) { hovering = over }
            }
            #if DEBUG
            .onAppear { HoverProbe.register(id) { hovering = $0 } }
            #endif
            #endif
    }
}

private struct HoverRow: ViewModifier {
    let id: String
    let reach: EdgeInsets
    @State private var hovering = false
    @Environment(\.hoverPreview) private var preview

    func body(content: Content) -> some View {
        #if os(macOS)
        let on = hovering || preview.contains("*") || (!id.isEmpty && preview.contains(id))
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
            .modifier(HoverTracking(id: id, hovering: $hovering))
            .background {
                if on {
                    RoundedRectangle(cornerRadius: Hover.rowRadius, style: .continuous)
                        .fill(Hover.row)
                        .padding(EdgeInsets(top: -reach.top, leading: -reach.leading, bottom: -reach.bottom, trailing: -reach.trailing))
                }
            }
            #if DEBUG
            .onChange(of: hovering) { HoverProbe.rowChanges += 1 }
            #endif
        #else
        content
        #endif
    }
}

private struct HoverHighlight<S: InsettableShape>: ViewModifier {
    let shape: S
    @State private var hovering = false
    @Environment(\.hoverPreview) private var preview
    @Environment(\.isEnabled) private var enabled

    func body(content: Content) -> some View {
        #if os(macOS)
        content
            .background { if enabled && (hovering || preview.contains("*")) { shape.fill(Hover.fill) } }
            .contentShape(shape)
            .modifier(HoverTracking(id: "", hovering: $hovering))
        #else
        content
        #endif
    }
}

private struct HoverOverlay<S: InsettableShape>: ViewModifier {
    let shape: S
    let tint: Color
    @State private var hovering = false
    @Environment(\.hoverPreview) private var preview
    @Environment(\.isEnabled) private var enabled

    func body(content: Content) -> some View {
        #if os(macOS)
        content
            .overlay { if enabled && (hovering || preview.contains("*")) { shape.fill(tint).allowsHitTesting(false) } }
            .modifier(HoverTracking(id: "", hovering: $hovering))
        #else
        content
        #endif
    }
}

/// An icon-only button (a close ×, a toolbar-like glyph in a card): a soft rounded background
/// under the pointer, a firmer one while pressed.
struct HoverIconButtonStyle: ButtonStyle {
    var cornerRadius: CGFloat = 6

    func makeBody(configuration: Configuration) -> some View {
        HoverIconButton(configuration: configuration, cornerRadius: cornerRadius)
    }
}

private struct HoverIconButton: View {
    let configuration: ButtonStyleConfiguration
    let cornerRadius: CGFloat
    @State private var hovering = false
    @Environment(\.hoverPreview) private var preview
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        #if os(macOS)
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        let on = enabled && (hovering || preview.contains("*"))
        configuration.label
            .opacity(enabled ? 1 : 0.5)
            .background {
                if configuration.isPressed { shape.fill(Hover.pressed) } else if on { shape.fill(Hover.fill) }
            }
            .contentShape(shape)
            .modifier(HoverTracking(id: "", hovering: $hovering))
        #else
        // On iPhone, as the plain style draws it.
        configuration.label.opacity(configuration.isPressed ? 0.6 : enabled ? 1 : 0.5)
        #endif
    }
}

/// A button that's only words ("Start Fresh", "Use a different email"): underlined under the
/// pointer and dimmed while pressed. A link also shows the pointing hand.
struct HoverTextButtonStyle: ButtonStyle {
    var link = false

    func makeBody(configuration: Configuration) -> some View {
        HoverTextButton(configuration: configuration, link: link)
    }
}

private struct HoverTextButton: View {
    let configuration: ButtonStyleConfiguration
    let link: Bool
    @State private var hovering = false
    @Environment(\.hoverPreview) private var preview
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        let on = enabled && (hovering || preview.contains("*"))
        configuration.label
            .underline(on)
            .opacity(configuration.isPressed ? 0.6 : enabled ? 1 : 0.5)
            .contentShape(.rect)
            .modifier(HoverTracking(id: "", hovering: $hovering))
            #if os(macOS)
            .pointerStyle(link && enabled ? .link : nil)
            #endif
    }
}

extension ButtonStyle where Self == HoverIconButtonStyle {
    static var hoverIcon: HoverIconButtonStyle { .init() }
    static func hoverIcon(cornerRadius: CGFloat) -> HoverIconButtonStyle { .init(cornerRadius: cornerRadius) }
}

extension ButtonStyle where Self == HoverTextButtonStyle {
    static var hoverText: HoverTextButtonStyle { .init() }
    static var hoverLink: HoverTextButtonStyle { .init(link: true) }
}

#if DEBUG
/// Tests: sets a named row's hover the way the pointer does, and counts hover changes.
@MainActor
enum HoverProbe {
    /// Off in the app: rows register only while a test has turned this on.
    static var enabled = false
    /// Hover changes the rows saw.
    static var rowChanges = 0
    private static var setters: [String: (Bool) -> Void] = [:]

    static func register(_ id: String, _ set: @escaping (Bool) -> Void) {
        guard enabled, !id.isEmpty else { return }
        setters[id] = set
    }

    static func hover(_ id: String, _ over: Bool) -> Bool {
        guard let set = setters[id] else { return false }
        set(over)
        return true
    }

    static func reset() {
        setters = [:]
        rowChanges = 0
    }
}

/// Tests: how many times the window's big views worked out their bodies, by name.
@MainActor
enum RenderProbe {
    static var counts: [String: Int] = [:]
    static func count(_ name: String) {
        guard HoverProbe.enabled else { return }
        counts[name, default: 0] += 1
    }
}
#endif
