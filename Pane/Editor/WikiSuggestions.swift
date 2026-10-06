import SwiftUI

#if os(macOS)
/// Titles offered under the caret while a `[[link` is typed on the Mac. Arrows move, Return or
/// Tab takes one, Escape puts the list away; a click takes one too.
struct WikiSuggestionList: View {
    let controller: EditorController
    static let rowHeight: CGFloat = 24
    static let width: CGFloat = 260

    /// The list's size for so many titles (the text view places it before SwiftUI lays it out).
    static func size(rows: Int) -> CGSize { CGSize(width: width, height: CGFloat(rows) * rowHeight + 8) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(controller.wikiSuggestions.enumerated()), id: \.offset) { i, title in
                Button { controller.completeWiki(title) } label: {
                    Text(title)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.ink)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .padding(.horizontal, 8)
                        .frame(maxWidth: .infinity, minHeight: Self.rowHeight, maxHeight: Self.rowHeight, alignment: .leading)
                        .background(i == controller.wikiChoice ? Color.amberSoft : .clear, in: .rect(cornerRadius: 5))
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("wiki.suggestion.\(i)")
            }
        }
        .padding(4)
        .frame(width: Self.width)
        .background(Color(PColor.panePanel), in: .rect(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color(PColor.paneSeparator)))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Link to a note")
    }
}
#endif

#if os(iOS)
/// The same titles in the bar above the keyboard on iPhone, where QuickType would offer words.
struct WikiSuggestionRow: View {
    let controller: EditorController

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                ForEach(Array(controller.wikiSuggestions.enumerated()), id: \.offset) { i, title in
                    Button { controller.completeWiki(title) } label: {
                        Text(title)
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(.primary)
                            .lineLimit(1)
                            .padding(.horizontal, 12)
                            .frame(height: 44)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("wiki.suggestion.\(i)")
                }
            }
            .padding(.horizontal, 4)
        }
        .accessibilityLabel("Link to a note")
    }
}
#endif
