import SwiftUI

/// "How did you hear about Amber Notes?" (see `HeardFrom`): a title, a quiet line, one row per
/// answer and Skip. A row answers in one tap, shows a tick and the sheet goes. "Something else"
/// opens a short field for your own words first (optional too).
/// A solid sheet in the app's own colours: full height on iPhone, a small sheet on the Mac.
struct HeardFromView: View {
    let store: HeardFromStore
    @State private var style: HeardFromStyle
    @State private var typingOther = false
    @State private var contentHeight: CGFloat = 0
    @Environment(\.displayScale) private var displayScale
    @State private var words = ""
    @FocusState private var fieldFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Dev: switch looks while the sheet is up (forced, and not in captures).
    private let showsDevPicker: Bool

    init(store: HeardFromStore, style: HeardFromStyle = .current, devPicker: Bool? = nil) {
        self.store = store
        _style = State(initialValue: style)
        showsDevPicker = devPicker ?? (store.forced && !ProcessInfo.processInfo.arguments.contains("-heardFromStyle"))
    }

    var body: some View {
        ScrollViewReader { scroller in
            ScrollView {
                VStack(alignment: style == .tiles ? .center : .leading, spacing: Metrics.gap) {
                    header
                    choices
                }
                .padding(.horizontal, Metrics.padding)
                .padding(.top, style == .today ? Metrics.top : Metrics.fittedTop)
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
            VStack(spacing: 0) {
                #if os(iOS)
                if !typingOther { skip }
                #else
                skip
                #endif
                if showsDevPicker { devPicker }
            }
        }
        .background(Color(Palette.sheetGround))
        #if os(macOS)
        .frame(width: 420, height: style == .today ? (typingOther ? 570 : 520) : fittedHeight)
        #else
        // Today's look takes the whole screen; the others are as tall as what they ask, and
        // the whole screen while you type your own words.
        .presentationDetents(style == .today || typingOther || contentHeight == 0 ? [.large] : [.height(fittedHeight)])
        #endif
        .animation(reduceMotion ? nil : .smooth(duration: 0.25), value: typingOther)
        // The tick shows for a moment, then the sheet goes.
        .task(id: store.chosen) {
            guard store.chosen != nil else { return }
            try? await Task.sleep(for: .seconds(0.6))
            if !Task.isCancelled { store.visible = false }
        }
    }

    /// The sheet's height for the fitted looks: the question and its answers, then Skip.
    private var fittedHeight: CGFloat {
        max(contentHeight, 120) + Metrics.skipHeight + Metrics.bottom + (showsDevPicker ? 44 : 0)
    }

    private var header: some View {
        VStack(alignment: style == .tiles ? .center : .leading, spacing: 6) {
            if style == .tiles { AppMark(size: Metrics.mark).padding(.bottom, 6) }
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
        .multilineTextAlignment(style == .tiles ? .center : .leading)
    }

    @ViewBuilder private var choices: some View {
        switch style {
        case .today:
            VStack(spacing: Metrics.rowGap) {
                ForEach(HeardFrom.choices, id: \.self) { source in
                    row(source)
                    if source == .other && typingOther { other }
                }
            }
        case .chips:
            VStack(alignment: .leading, spacing: Metrics.gap) {
                Flow(spacing: Metrics.chipGap) {
                    ForEach(HeardFrom.choices, id: \.self) { chip($0) }
                }
                if typingOther { other }
            }
        case .list:
            VStack(spacing: Metrics.gap) {
                group
                if typingOther { other }
            }
        case .tiles:
            VStack(spacing: Metrics.gap) {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: Metrics.tileGap), count: 3), spacing: Metrics.tileGap) {
                    ForEach(HeardFrom.choices, id: \.self) { tile($0) }
                }
                if typingOther { other }
            }
        }
    }

    /// Whether a choice shows as picked: just tapped, or "Something else" while you type.
    private func picked(_ source: HeardFrom.Source) -> Bool {
        store.chosen == source || (source == .other && typingOther && store.chosen == nil)
    }

    private func choose(_ source: HeardFrom.Source) {
        if source == .other {
            typingOther = true
            fieldFocused = true
        } else {
            store.answer(source)
        }
    }

    /// A: a pill as wide as its words. The one tapped fills with amber (its width never changes,
    /// so nothing reflows before the sheet goes).
    private func chip(_ source: HeardFrom.Source) -> some View {
        let tapped = store.chosen == source
        let on = picked(source)
        let shape = RoundedRectangle(cornerRadius: Metrics.chipHeight / 2)
        return Button { choose(source) } label: {
            Text(HeardFrom.title(source))
                .font(Metrics.row)
                .foregroundStyle(tapped ? Color(AmberProminentButtonStyle.label) : Color.ink)
                .padding(.horizontal, Metrics.chipPadding)
                .frame(minHeight: Metrics.chipHeight)
                .background(tapped ? Color(AmberProminentButtonStyle.fill) : on ? Color.amberSoft : Color(Palette.field), in: shape)
                .overlay(shape.strokeBorder(tapped ? .clear : on ? Color(Palette.amber) : Color(Palette.fieldHairline), lineWidth: on ? 1.5 : 1))
                .contentShape(shape)
        }
        .buttonStyle(PressScale())
        .disabled(store.chosen != nil)
        .animation(.snappy(duration: 0.2), value: store.chosen)
        .accessibilityAddTraits(tapped ? .isSelected : [])
        .accessibilityIdentifier("heardFrom.\(source.rawValue)")
    }

    /// B: one rounded group, like Settings: a symbol, the answer, and a tick once tapped.
    private var group: some View {
        let shape = RoundedRectangle(cornerRadius: Metrics.radius, style: .continuous)
        return VStack(spacing: 0) {
            ForEach(HeardFrom.choices, id: \.self) { source in
                listRow(source)
                if source != HeardFrom.choices.last {
                    Rectangle()
                        .fill(Color(Palette.fieldHairline).opacity(0.6))
                        .frame(height: 1 / displayScale)
                        .padding(.leading, Metrics.listInset)
                }
            }
        }
        .background(Color(Palette.field), in: shape)
        .overlay(shape.strokeBorder(Color(Palette.fieldHairline), lineWidth: 1 / displayScale))
        .clipShape(shape)
    }

    private func listRow(_ source: HeardFrom.Source) -> some View {
        Button { choose(source) } label: {
            HStack(spacing: 0) {
                Image(systemName: Self.symbol(source))
                    .font(Metrics.listSymbol)
                    .foregroundStyle(Color(Palette.amber))
                    .frame(width: Metrics.listInset, alignment: .center)
                    .accessibilityHidden(true)
                Text(HeardFrom.title(source)).foregroundStyle(Color.ink)
                Spacer(minLength: 8)
                if store.chosen == source {
                    Image(systemName: "checkmark")
                        .font(Metrics.row.weight(.semibold))
                        .foregroundStyle(Color(Palette.amber))
                        .transition(.scale.combined(with: .opacity))
                        .accessibilityHidden(true)
                } else if source == .other {
                    Image(systemName: typingOther ? "chevron.down" : "chevron.right")
                        .font(Metrics.line.weight(.semibold))
                        .foregroundStyle(Color(Palette.placeholder))
                        .accessibilityHidden(true)
                }
            }
            .font(Metrics.row)
            .padding(.trailing, 14)
            .frame(maxWidth: .infinity, minHeight: Metrics.listHeight, alignment: .leading)
            .background(picked(source) ? Color.amberSoft : .clear)
            .contentShape(.rect)
        }
        .buttonStyle(RowPress())
        .disabled(store.chosen != nil)
        .animation(.snappy(duration: 0.2), value: store.chosen)
        .accessibilityAddTraits(store.chosen == source ? .isSelected : [])
        .accessibilityIdentifier("heardFrom.\(source.rawValue)")
    }

    /// C: a soft tile, a symbol over the answer; three by three.
    private func tile(_ source: HeardFrom.Source) -> some View {
        let on = picked(source)
        let shape = RoundedRectangle(cornerRadius: Metrics.tileRadius, style: .continuous)
        return Button { choose(source) } label: {
            VStack(spacing: 6) {
                Image(systemName: store.chosen == source ? "checkmark" : Self.symbol(source))
                    .font(Metrics.tileSymbol)
                    .foregroundStyle(Color(Palette.amber))
                    .frame(height: Metrics.tileSymbolHeight)
                    .contentTransition(.symbolEffect(.replace))
                    .accessibilityHidden(true)
                Text(HeardFrom.title(source))
                    .font(Metrics.tileText)
                    .foregroundStyle(Color.ink)
                    .multilineTextAlignment(.center)
                    .lineLimit(2, reservesSpace: true)
                    .minimumScaleFactor(0.85)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, Metrics.tilePadding)
            .frame(maxWidth: .infinity, minHeight: Metrics.tileHeight)
            .background(on ? Color.amberSoft : Color(Palette.field), in: shape)
            .overlay(shape.strokeBorder(on ? Color(Palette.amber) : Color(Palette.fieldHairline).opacity(0.7), lineWidth: on ? 1.5 : 1 / displayScale))
            .contentShape(shape)
        }
        .buttonStyle(PressScale())
        .disabled(store.chosen != nil)
        .animation(.snappy(duration: 0.2), value: store.chosen)
        .accessibilityAddTraits(store.chosen == source ? .isSelected : [])
        .accessibilityIdentifier("heardFrom.\(source.rawValue)")
    }

    /// A plain symbol per answer (never a brand's logo).
    static func symbol(_ source: HeardFrom.Source) -> String {
        switch source {
        case .google: "magnifyingglass"
        case .blog: "doc.text"
        case .aiAssistant: "sparkles"
        case .tiktok: "music.note"
        case .youtube: "play.rectangle"
        case .instagram: "camera"
        case .friend: "person.2"
        case .productHuntHN: "arrowshape.up"
        case .other: "ellipsis"
        case .skipped: "xmark"
        }
    }

    private var devPicker: some View {
        Picker("Dev", selection: $style) {
            ForEach(HeardFromStyle.allCases, id: \.self) { Text("Dev: \($0.rawValue)").tag($0) }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .padding(.horizontal, Metrics.padding)
        .padding(.bottom, 10)
        .frame(height: 44)
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
        static let fittedTop: CGFloat = 24
        static let chipHeight: CGFloat = 30
        static let chipPadding: CGFloat = 12
        static let chipGap: CGFloat = 6
        static let listHeight: CGFloat = 30
        static let listInset: CGFloat = 34
        static let listSymbol = Font.system(size: 13)
        static let tileHeight: CGFloat = 70
        static let tileGap: CGFloat = 8
        static let tileRadius: CGFloat = 10
        static let tilePadding: CGFloat = 10
        static let tileSymbol = Font.system(size: 17)
        static let tileSymbolHeight: CGFloat = 20
        static let tileText = Font.system(size: 12)
        static let mark: CGFloat = 40
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
        static let fittedTop: CGFloat = 28
        static let chipHeight: CGFloat = 44
        static let chipPadding: CGFloat = 16
        static let chipGap: CGFloat = 8
        static let listHeight: CGFloat = 46
        static let listInset: CGFloat = 46
        static let listSymbol = Font.body
        static let tileHeight: CGFloat = 92
        static let tileGap: CGFloat = 10
        static let tileRadius: CGFloat = 16
        static let tilePadding: CGFloat = 14
        static let tileSymbol = Font.title3
        static let tileSymbolHeight: CGFloat = 26
        static let tileText = Font.footnote.weight(.medium)
        static let mark: CGFloat = 52
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

/// Dev, for picking a look: `-heardFromStyle chips|list|tiles` (today's when unset).
enum HeardFromStyle: String, CaseIterable {
    case today, chips, list, tiles

    static var current: HeardFromStyle {
        UserDefaults.standard.string(forKey: "heardFromStyle").flatMap(Self.init(rawValue:)) ?? .today
    }
}

/// A list row: dims a little while pressed, and stays at full strength once the sheet is done
/// (the plain style fades every row when they're all disabled after a tap).
private struct RowPress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.6 : 1)
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
