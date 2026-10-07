import SwiftUI

/// "How did you hear about Amber Notes?" (see `HeardFrom`): a title, a quiet line, the answers
/// as pills sized to their words, and Skip. A pill answers in one tap, fills with amber and the
/// sheet goes. "Something else" opens a short field for your own words first (optional too).
/// A solid sheet in the app's own colours, as tall as what it asks: a short sheet on the Mac, and
/// on iPhone about half the screen (the whole screen while you type).
struct HeardFromView: View {
    let store: HeardFromStore
    @State private var typingOther: Bool
    @State private var contentHeight: CGFloat = 0
    @State private var words = ""
    @FocusState private var fieldFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// `typing`: captures can open it with the "Something else" field showing.
    init(store: HeardFromStore, typing: Bool = false) {
        self.store = store
        _typingOther = State(initialValue: typing)
    }

    var body: some View {
        ScrollViewReader { scroller in
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.gap) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("How did you hear about Amber Notes?")
                            .font(Metrics.title)
                            .tracking(-0.4)
                            .foregroundStyle(Color.ink)
                            .accessibilityAddTraits(.isHeader)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("Optional. It helps us see what's working.")
                            .font(Metrics.line)
                            .foregroundStyle(Color.muted)
                    }
                    Flow(spacing: Metrics.chipGap) {
                        ForEach(HeardFrom.choices, id: \.self) { chip($0) }
                    }
                    if typingOther { other }
                }
                .padding(.horizontal, Metrics.padding)
                .padding(.top, Metrics.top)
                .padding(.bottom, 8)
                .onGeometryChange(for: CGFloat.self, of: \.size.height) { contentHeight = $0 }
            }
            .accessibilityIdentifier("heardFrom")
            .scrollBounceBehavior(.basedOnSize)
            .scrollDismissesKeyboard(.interactively)
            // Typing under "Something else", Done is the way on: it scrolls into view above the
            // keyboard, and (on iPhone) Skip steps aside.
            .onChange(of: typingOther) { _, typing in
                guard typing else { return }
                Task {
                    try? await Task.sleep(for: .seconds(0.35))
                    withAnimation(reduceMotion ? nil : .smooth(duration: 0.3)) { scroller.scrollTo(Self.doneID, anchor: .bottom) }
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            #if os(iOS)
            if !typingOther { skip }
            #else
            skip
            #endif
        }
        .background(Color(Palette.sheetGround))
        #if os(macOS)
        .frame(width: 420, height: fittedHeight)
        #else
        .presentationDetents(typingOther || contentHeight == 0 ? [.large] : [.height(fittedHeight)])
        #endif
        .animation(reduceMotion ? nil : .smooth(duration: 0.25), value: typingOther)
        // The amber pill shows for a moment, then the sheet goes.
        .task(id: store.chosen) {
            guard store.chosen != nil else { return }
            try? await Task.sleep(for: .seconds(0.6))
            if !Task.isCancelled { store.visible = false }
        }
    }

    /// The question and its answers, then Skip.
    private var fittedHeight: CGFloat {
        max(contentHeight, 120) + Metrics.skipHeight + Metrics.bottom
    }

    /// A pill as wide as its words. The one tapped fills with amber and keeps its width, so
    /// nothing reflows before the sheet goes; "Something else" takes an amber ring while you type.
    private func chip(_ source: HeardFrom.Source) -> some View {
        let tapped = store.chosen == source
        let typing = source == .other && typingOther && store.chosen == nil
        let shape = Capsule()
        return Button {
            if source == .other {
                typingOther = true
                fieldFocused = true
            } else {
                store.answer(source)
            }
        } label: {
            Text(HeardFrom.title(source))
                .font(Metrics.row)
                .foregroundStyle(tapped ? Color(AmberProminentButtonStyle.label) : Color.ink)
                .padding(.horizontal, Metrics.chipPadding)
                .frame(minHeight: Metrics.chipHeight)
                .background(tapped ? Color(AmberProminentButtonStyle.fill) : typing ? Color.amberSoft : Color(Palette.field), in: shape)
                .overlay(shape.strokeBorder(tapped ? .clear : typing ? Color(Palette.amber) : Color(Palette.fieldHairline), lineWidth: typing ? 1.5 : 1))
                .hoverOverlay(shape, Color.primary.opacity(0.05))
                .contentShape(shape)
        }
        .buttonStyle(PressScale())
        .disabled(store.chosen != nil)
        .animation(.snappy(duration: 0.2), value: store.chosen)
        .accessibilityAddTraits(tapped ? .isSelected : [])
        .accessibilityIdentifier("heardFrom.\(source.rawValue)")
    }

    private static let doneID = "heardFrom.otherDone"

    private var skip: some View {
        Button { store.skip() } label: {
            Text("Skip").frame(maxWidth: .infinity, minHeight: Metrics.skipHeight).contentShape(.rect)
        }
        .buttonStyle(.hoverText)
        .font(Metrics.skipFont)
        .foregroundStyle(Color.muted)
        .keyboardShortcut(.cancelAction)
        .disabled(store.chosen != nil)
        .accessibilityIdentifier("heardFrom.skip")
        .padding(.horizontal, Metrics.padding)
        .padding(.bottom, Metrics.bottom)
        .background(Color(Palette.sheetGround))
    }

    /// Your own words under "Something else", then Done (which works with the field empty too).
    private var other: some View {
        let shape = RoundedRectangle(cornerRadius: Metrics.radius, style: .continuous)
        return VStack(spacing: Metrics.rowGap) {
            TextField("Where? (optional)", text: $words, prompt: Text("Where? (optional)").foregroundStyle(Color(Palette.placeholder)))
                .textFieldStyle(.plain)
                .font(Metrics.row)
                .focused($fieldFocused)
                .submitLabel(.done)
                .onSubmit(sendOther)
                .onChange(of: words) { _, w in if w.count > HeardFrom.detailLimit { words = String(w.prefix(HeardFrom.detailLimit)) } }
                .padding(.horizontal, 14)
                .frame(height: Metrics.rowHeight)
                .background(Color(Palette.field), in: shape)
                .overlay(shape.strokeBorder(fieldFocused ? Color(Palette.amber) : Color(Palette.fieldHairline), lineWidth: fieldFocused ? 2 : 1))
                .accessibilityIdentifier("heardFrom.otherText")
            Button("Done", action: sendOther)
                .buttonStyle(.amberProminent(height: SignInView.Row.height, cornerRadius: SignInView.Row.radius))
                .keyboardShortcut(.defaultAction)
                .disabled(store.chosen != nil)
                .accessibilityIdentifier("heardFrom.otherDone")
                .id(Self.doneID)
        }
        .transition(.opacity)
    }

    private func sendOther() {
        fieldFocused = false
        store.answer(.other, detail: words)
    }

    private enum Metrics {
        #if os(macOS)
        static let title = Font.system(size: 20, weight: .bold)
        static let line = Font.system(size: 13)
        static let row = Font.system(size: 13)
        static let skipFont = Font.system(size: 13, weight: .medium)
        static let padding: CGFloat = 28
        static let top: CGFloat = 24
        static let bottom: CGFloat = 16
        static let gap: CGFloat = 18
        static let rowGap: CGFloat = 6
        static let rowHeight: CGFloat = 32
        static let radius: CGFloat = 8
        static let skipHeight: CGFloat = 28
        static let chipHeight: CGFloat = 30
        static let chipPadding: CGFloat = 12
        static let chipGap: CGFloat = 6
        #else
        static let title = Font.title2.weight(.bold)
        static let line = Font.subheadline
        static let row = Font.body
        static let skipFont = Font.body.weight(.medium)
        static let padding: CGFloat = 24
        static let top: CGFloat = 28
        static let bottom: CGFloat = 8
        static let gap: CGFloat = 22
        static let rowGap: CGFloat = 8
        static let rowHeight: CGFloat = 48
        static let radius: CGFloat = 12
        static let skipHeight: CGFloat = 44
        static let chipHeight: CGFloat = 44
        static let chipPadding: CGFloat = 16
        static let chipGap: CGFloat = 8
        #endif
    }
}

extension View {
    /// "How did you hear about Amber Notes?" over the library, when the store says.
    func heardFromSheet(_ store: HeardFromStore) -> some View {
        modifier(HeardFromSheet(store: store))
    }
}

struct HeardFromSheet: ViewModifier {
    @Bindable var store: HeardFromStore

    func body(content: Content) -> some View {
        content.sheet(isPresented: $store.visible, onDismiss: store.closed) {
            HeardFromView(store: store)
                // Solid, in the app's own ground: never the see-through sheet.
                .presentationBackground(Color(Palette.sheetGround))
                .tint(Color(PColor.paneAccent))
        }
    }
}

/// Lays its children out in rows, left to right, wrapping when a row is full.
private struct Flow: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        let frames = place(subviews, in: width)
        let used = frames.reduce(CGSize.zero) { CGSize(width: max($0.width, $1.maxX), height: max($0.height, $1.maxY)) }
        return CGSize(width: proposal.width ?? used.width, height: used.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for (frame, view) in zip(place(subviews, in: bounds.width), subviews) {
            view.place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY), proposal: ProposedViewSize(frame.size))
        }
    }

    private func place(_ subviews: Subviews, in width: CGFloat) -> [CGRect] {
        var frames: [CGRect] = []
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(ProposedViewSize(width: width, height: nil))
            if x > 0, x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            frames.append(CGRect(origin: CGPoint(x: x, y: y), size: CGSize(width: min(size.width, width), height: size.height)))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return frames
    }
}
