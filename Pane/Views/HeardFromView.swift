import SwiftUI

/// "How did you hear about Amber Notes?" (see `HeardFrom`): a title, a quiet line, one row per
/// answer and Skip. A row answers in one tap, shows a tick and the sheet goes. "Something else"
/// opens a short field for your own words first (optional too).
/// A solid sheet in the app's own colours: full height on iPhone, a small sheet on the Mac.
struct HeardFromView: View {
    let store: HeardFromStore
    @State private var typingOther = false
    @State private var words = ""
    @FocusState private var fieldFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

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
                    VStack(spacing: Metrics.rowGap) {
                        ForEach(HeardFrom.choices, id: \.self) { source in
                            row(source)
                            if source == .other && typingOther { other }
                        }
                    }
                }
                .padding(.horizontal, Metrics.padding)
                .padding(.top, Metrics.top)
                .padding(.bottom, 8)
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
        .frame(width: 420, height: typingOther ? 570 : 520)
        #endif
        .animation(reduceMotion ? nil : .smooth(duration: 0.25), value: typingOther)
        // The tick shows for a moment, then the sheet goes.
        .task(id: store.chosen) {
            guard store.chosen != nil else { return }
            try? await Task.sleep(for: .seconds(0.6))
            if !Task.isCancelled { store.visible = false }
        }
    }

    private static let doneID = "heardFrom.otherDone"

    private var skip: some View {
        Button { store.skip() } label: {
            Text("Skip").frame(maxWidth: .infinity, minHeight: Metrics.skipHeight).contentShape(.rect)
        }
        .buttonStyle(.plain)
        .font(Metrics.skipFont)
        .foregroundStyle(Color.muted)
        .keyboardShortcut(.cancelAction)
        .disabled(store.chosen != nil)
        .accessibilityIdentifier("heardFrom.skip")
        .padding(.horizontal, Metrics.padding)
        .padding(.bottom, Metrics.bottom)
        .background(Color(Palette.sheetGround))
    }

    private func row(_ source: HeardFrom.Source) -> some View {
        let picked = store.chosen == source || (source == .other && typingOther && store.chosen == nil)
        let shape = RoundedRectangle(cornerRadius: Metrics.radius, style: .continuous)
        return Button {
            if source == .other {
                typingOther = true
                fieldFocused = true
            } else {
                store.answer(source)
            }
        } label: {
            HStack {
                Text(HeardFrom.title(source))
                    .foregroundStyle(Color.ink)
                Spacer(minLength: 8)
                if store.chosen == source {
                    Image(systemName: "checkmark")
                        .font(Metrics.row.weight(.semibold))
                        .foregroundStyle(Color(Palette.amber))
                        .transition(.scale.combined(with: .opacity))
                        .accessibilityHidden(true)
                }
            }
            .font(Metrics.row)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: Metrics.rowHeight, alignment: .leading)
            .background(Color(Palette.field), in: shape)
            .overlay(shape.strokeBorder(picked ? Color(Palette.amber) : Color(Palette.fieldHairline), lineWidth: picked ? 2 : 1))
            .contentShape(shape)
        }
        .buttonStyle(PressScale())
        .disabled(store.chosen != nil)
        .animation(.snappy(duration: 0.2), value: store.chosen)
        .accessibilityAddTraits(store.chosen == source ? .isSelected : [])
        .accessibilityIdentifier("heardFrom.\(source.rawValue)")
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
        static let top: CGFloat = 28
        static let bottom: CGFloat = 16
        static let gap: CGFloat = 18
        static let rowGap: CGFloat = 6
        static let rowHeight: CGFloat = 32
        static let radius: CGFloat = 8
        static let skipHeight: CGFloat = 28
        #else
        static let title = Font.title2.weight(.bold)
        static let line = Font.subheadline
        static let row = Font.body
        static let skipFont = Font.body.weight(.medium)
        static let padding: CGFloat = 24
        static let top: CGFloat = 32
        static let bottom: CGFloat = 8
        static let gap: CGFloat = 22
        static let rowGap: CGFloat = 8
        static let rowHeight: CGFloat = 48
        static let radius: CGFloat = 12
        static let skipHeight: CGFloat = 44
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
                #if os(iOS)
                .presentationDetents([.large])
                #endif
                .tint(Color(PColor.paneAccent))
        }
    }
}
