import SwiftUI

/// Callbacks a card uses to change the note it lives in.
struct CardActions {
    var toggleExpanded: () -> Void
    var edit: () -> Void
    var toggleCheckbox: (_ lineOffset: Int) -> Void
    var unwrap: () -> Void
    var delete: () -> Void
}

enum CardMetrics {
    static let collapsed: CGFloat = 66
    static let header: CGFloat = 50
    static let maxBody: CGFloat = 260
    static let bodyLine: CGFloat = EditorMetrics.body * 1.55

    /// Estimated height of the expanded body, so the note can reserve room for it.
    static func bodyHeight(_ content: String) -> CGFloat {
        let lines = content.split(separator: "\n", omittingEmptySubsequences: false)
        let est = lines.reduce(CGFloat(0)) { h, l in
            let chars = CGFloat(l.count)
            let wraps = max(1, (chars / 52).rounded(.up))
            return h + (l.trimmingCharacters(in: .whitespaces).isEmpty ? bodyLine * 0.5 : bodyLine * wraps)
        }
        return min(maxBody, est + 16)
    }

    static func height(_ card: CardBlock, expanded: Bool) -> CGFloat {
        expanded ? header + bodyHeight(card.content) + 8 : collapsed
    }
}

/// A collapsible card inside a note.
struct CardView: View {
    let card: CardBlock
    let expanded: Bool
    let actions: CardActions

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            if expanded {
                ScrollView {
                    MiniMarkdown(text: card.content, toggle: actions.toggleCheckbox)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .scrollBounceBehavior(.basedOnSize)
                .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .glassEffect(.regular, in: .rect(cornerRadius: 16))
        .contentShape(.rect(cornerRadius: 16))
        .contextMenu { menuItems }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("card.\(card.title)")
    }

    private var header: some View {
        HStack(spacing: 10) {
            Button(action: actions.toggleExpanded) {
                HStack(spacing: 10) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                        .frame(width: 16)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(card.title)
                            .font(.system(size: EditorMetrics.body, weight: .semibold))
                            .foregroundStyle(.primary)
                            .lineLimit(1)
                        if !expanded {
                            Text(preview)
                                .font(.system(size: EditorMetrics.body * 0.82))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(expanded ? "Collapse \(card.title)" : "Expand \(card.title)")

            Menu {
                menuItems
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 32, height: 32)
                    .contentShape(.rect)
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .fixedSize()
            .accessibilityLabel("Card actions")
        }
        .padding(.leading, 14)
        .padding(.trailing, 8)
        .frame(height: expanded ? CardMetrics.header : CardMetrics.collapsed)
    }

    @ViewBuilder
    private var menuItems: some View {
        Button("Edit Card", systemImage: "pencil", action: actions.edit)
        Button("Turn into Text", systemImage: "text.alignleft", action: actions.unwrap)
        Divider()
        Button("Delete Card", systemImage: "trash", role: .destructive, action: actions.delete)
    }

    private var preview: String {
        let lines = card.content.split(separator: "\n").map { NoteText.stripMarkup(String($0)) }.filter { !$0.isEmpty }
        if lines.isEmpty { return "Empty" }
        let first = lines.prefix(2).joined(separator: " · ")
        return lines.count > 2 ? "\(first) +\(lines.count - 2)" : first
    }
}

/// Read-only markdown for a card's body; checklist circles can be tapped.
struct MiniMarkdown: View {
    let text: String
    let toggle: (Int) -> Void

    var body: some View {
        let lines = text.components(separatedBy: "\n")
        VStack(alignment: .leading, spacing: 5) {
            ForEach(Array(lines.enumerated()), id: \.offset) { i, line in
                row(line, index: i)
            }
        }
    }

    @ViewBuilder
    private func row(_ line: String, index: Int) -> some View {
        let t = line.trimmingCharacters(in: .whitespaces)
        if t.isEmpty {
            Color.clear.frame(height: 4)
        } else if let h = t.range(of: #"^#{1,6}\s+"#, options: .regularExpression) {
            inline(String(t[h.upperBound...])).font(.system(size: EditorMetrics.body, weight: .semibold))
        } else if let list = ListPrefix(line: line) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                if let checked = list.checkbox {
                    Button { toggle(index) } label: {
                        Image(systemName: checked ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(checked ? AnyShapeStyle(.tint) : AnyShapeStyle(.tertiary))
                            .font(.system(size: EditorMetrics.body))
                            .contentTransition(.symbolEffect(.replace))
                    }
                    .buttonStyle(.plain)
                    .frame(minWidth: 24, minHeight: 24)
                } else if list.ordered {
                    Text(list.marker).monospacedDigit().foregroundStyle(.secondary)
                } else {
                    Circle().fill(.secondary).frame(width: 5, height: 5).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
                }
                inline(String((line as NSString).substring(from: list.length)))
                    .foregroundStyle(list.checkbox == true ? .secondary : .primary)
            }
            .padding(.leading, CGFloat(list.level) * 18)
        } else if t.hasPrefix(">") {
            HStack(spacing: 8) {
                RoundedRectangle(cornerRadius: 1.5).fill(.tint.opacity(0.7)).frame(width: 3)
                inline(String(t.drop { $0 == ">" || $0 == " " })).foregroundStyle(.secondary)
            }
        } else if t.hasPrefix("|") {
            Text(t.replacingOccurrences(of: "|", with: "  ").trimmingCharacters(in: .whitespaces))
                .font(.system(size: EditorMetrics.body * 0.88, design: .monospaced))
                .foregroundStyle(t.allSatisfy { "|-: ".contains($0) } ? .tertiary : .primary)
        } else {
            inline(t)
        }
    }

    private func inline(_ s: String) -> Text {
        let opts = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        let a = (try? AttributedString(markdown: s, options: opts)) ?? AttributedString(s)
        return Text(a).font(.system(size: EditorMetrics.body))
    }
}

/// Edits one card: its title and its contents, with the full markdown editor.
struct CardEditorSheet: View {
    @State var title: String
    @State var content: String
    let isNew: Bool
    let onSave: (String, String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var editor = EditorController()
    @FocusState private var titleFocused: Bool

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                TextField("Card title", text: $title)
                    .font(.title3.weight(.semibold))
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 14)
                    .focused($titleFocused)
                    .onSubmit { editor.focus() }
                    .accessibilityIdentifier("card.titleField")
                Divider()
                MarkdownEditor(initialText: content, header: "", controller: editor, autofocus: !isNew, identifier: "card.contentEditor", titleLine: false) { content = $0 }
                    .overlay(alignment: .topLeading) {
                        if content.isEmpty {
                            Text("What goes in the card? Lists, details, anything.")
                                .font(.system(size: EditorMetrics.body))
                                .foregroundStyle(.tertiary)
                                .padding(.horizontal, 20)
                                .padding(.top, 14)
                                .allowsHitTesting(false)
                        }
                    }
            }
            .onAppear { if isNew { titleFocused = true } }
            .navigationTitle(isNew ? "New Card" : "Edit Card")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isNew ? "Add" : "Save") { onSave(title, content); dismiss() }
                        .accessibilityIdentifier("card.save")
                }
            }
        }
        #if os(macOS)
        .frame(width: 560, height: 520)
        #endif
    }
}
