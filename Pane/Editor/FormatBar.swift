#if os(iOS)
import SwiftUI
import UIKit

/// The glass bar that floats above the keyboard while you write.
struct FormatBar: View {
    let controller: EditorController
    let dismiss: () -> Void

    var body: some View {
        GlassEffectContainer(spacing: 10) {
            HStack(spacing: 10) {
                if controller.wikiSuggestions.isEmpty { tools } else {
                    WikiSuggestionRow(controller: controller)
                        .glassEffect(.regular.interactive(), in: .capsule)
                }

                Spacer(minLength: 0)

                Button(action: dismiss) {
                    BarIcon(systemName: "keyboard.chevron.compact.down")
                }
                .buttonStyle(PressScale())
                .accessibilityLabel("Hide keyboard")
                .accessibilityIdentifier("editor.done")
                .padding(.horizontal, 4)
                .glassEffect(.regular.interactive(), in: .circle)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
        }
    }

    /// The writing tools; while a `[[link` is typed, note titles take their place.
    private var tools: some View {
                HStack(spacing: 2) {
                    Menu {
                        Section {
                            Button("Title") { controller.heading(1) }
                            Button("Heading") { controller.heading(2) }
                            Button("Subheading") { controller.heading(3) }
                            Button("Body") { controller.heading(0) }
                        }
                        Section {
                            Button("Bold", systemImage: "bold", action: controller.bold)
                            Button("Italic", systemImage: "italic", action: controller.italic)
                            Button("Underline", systemImage: "underline", action: controller.underline)
                            Button("Strikethrough", systemImage: "strikethrough", action: controller.strikethrough)
                            Button("Code", systemImage: "chevron.left.forwardslash.chevron.right", action: controller.code)
                        }
                        Section {
                            Button("Bulleted List", systemImage: "list.bullet", action: controller.bulletList)
                            Button("Dashed List", systemImage: "list.dash", action: controller.dashedList)
                            Button("Numbered List", systemImage: "list.number", action: controller.numberedList)
                        }
                    } label: {
                        BarIcon(systemName: "textformat")
                    }
                    .accessibilityLabel("Format")
                    .accessibilityIdentifier("editor.format")
                    BarButton("Checklist", "checklist", action: controller.checklist)
                    BarButton("Table", "tablecells", action: controller.insertTable)
                    BarButton("Sub-note", "doc.badge.plus") { controller.newSubNote() }
                    BarButton("Attach", "paperclip") { controller.attach() }
                }
                .padding(.horizontal, 4)
                .glassEffect(.regular.interactive(), in: .capsule)
    }
}

private struct BarButton: View {
    let title: String
    let icon: String
    let action: () -> Void
    init(_ title: String, _ icon: String, action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.action = action
    }
    var body: some View {
        Button(action: action) { BarIcon(systemName: icon) }
            .buttonStyle(PressScale())
            .accessibilityLabel(title)
    }
}

private struct BarIcon: View {
    let systemName: String
    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: 17, weight: .medium))
            .foregroundStyle(.primary)
            .frame(width: 44, height: 44)
            .contentShape(.rect)
    }
}

/// Hosts the format bar as the text view's input accessory.
final class FormatBarHost: UIView {
    private let host: UIHostingController<FormatBar>

    init(controller: EditorController, dismiss: @escaping () -> Void) {
        host = UIHostingController(rootView: FormatBar(controller: controller, dismiss: dismiss))
        super.init(frame: CGRect(x: 0, y: 0, width: 390, height: 60))
        autoresizingMask = .flexibleHeight
        backgroundColor = .clear
        host.view.backgroundColor = .clear
        host.view.translatesAutoresizingMaskIntoConstraints = false
        addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: trailingAnchor),
            host.view.topAnchor.constraint(equalTo: topAnchor),
            host.view.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    override var intrinsicContentSize: CGSize { CGSize(width: UIView.noIntrinsicMetric, height: 60) }

    required init?(coder: NSCoder) { fatalError() }
}
#endif
