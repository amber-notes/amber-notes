import SwiftUI

enum TableCardMetrics {
    static let header: CGFloat = 52
    static let summary: CGFloat = 40
    static let row: CGFloat = 36
    static let visibleRows = 5

    static func height(_ t: TypedTable, expanded: Bool) -> CGFloat {
        let rows = expanded ? min(t.rows.count, 14) : min(t.rows.count, visibleRows)
        let summary = t.summary().isEmpty ? 0 : Self.summary
        let more: CGFloat = t.rows.count > visibleRows ? 36 : 0
        return header + summary + row * CGFloat(rows + 1) + more + 12
    }
}

/// A typed table shown as a card: the latest entries, averages, and one-tap logging.
struct TableCardView: View {
    let table: TypedTable
    let expanded: Bool
    let log: () -> Void
    let edit: (Int) -> Void
    let toggleExpanded: () -> Void

    private var shown: [(offset: Int, cells: [String])] {
        Array(table.recentRows.prefix(expanded ? 14 : TableCardMetrics.visibleRows))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "tablecells")
                    .foregroundStyle(.tint)
                Text(table.rows.count == 1 ? "1 entry" : "\(table.rows.count) entries")
                    .font(.system(size: EditorMetrics.body, weight: .semibold))
                    .monospacedDigit()
                Spacer()
                Button(action: log) {
                    Label(hasToday ? "Edit today" : "Log today", systemImage: hasToday ? "pencil" : "plus")
                        .font(.system(size: EditorMetrics.body * 0.88, weight: .semibold))
                }
                .buttonStyle(.glassProminent)
                .accessibilityIdentifier("table.log")
            }
            .padding(.horizontal, 14)
            .frame(height: TableCardMetrics.header)

            let summary = table.summary()
            if !summary.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        Text("Last 7").font(.caption).foregroundStyle(.secondary)
                        ForEach(summary, id: \.0) { name, value in
                            HStack(spacing: 4) {
                                Text(name).foregroundStyle(.secondary)
                                Text(value).fontWeight(.semibold).monospacedDigit()
                            }
                            .font(.caption)
                            .padding(.horizontal, 9)
                            .padding(.vertical, 5)
                            .background(.fill.tertiary, in: .capsule)
                        }
                    }
                    .padding(.horizontal, 14)
                }
                .frame(height: TableCardMetrics.summary)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 0) {
                    GridRow {
                        ForEach(Array(table.columns.enumerated()), id: \.offset) { _, c in
                            Text(c.name)
                                .font(.system(size: EditorMetrics.body * 0.8, weight: .semibold))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .frame(height: TableCardMetrics.row)
                        }
                    }
                    ForEach(shown, id: \.offset) { row in
                        GridRow {
                            ForEach(Array(row.cells.enumerated()), id: \.offset) { i, cell in
                                CellText(value: cell, type: table.columns[i].type)
                                    .frame(maxWidth: 220, alignment: .leading)
                                    .frame(height: TableCardMetrics.row)
                            }
                        }
                        .contentShape(.rect)
                        .onTapGesture { edit(row.offset) }
                        .overlay(alignment: .top) { Rectangle().fill(.separator.opacity(0.5)).frame(height: 0.5) }
                    }
                }
                .padding(.horizontal, 14)
            }

            if table.rows.count > TableCardMetrics.visibleRows {
                Button(expanded ? "Show fewer" : "Show more", action: toggleExpanded)
                    .font(.system(size: EditorMetrics.body * 0.82, weight: .medium))
                    .buttonStyle(.plain)
                    .foregroundStyle(.tint)
                    .frame(maxWidth: .infinity, minHeight: 36)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .glassEffect(.regular, in: .rect(cornerRadius: 18))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("table.card")
    }

    private var hasToday: Bool { table.rowIndex(for: .now) != nil }
}

private struct CellText: View {
    let value: String
    let type: TypedTable.ColumnType

    var body: some View {
        switch type {
        case .choice(let opts) where !value.isEmpty:
            Text(value)
                .font(.system(size: EditorMetrics.body * 0.82, weight: .medium))
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(tint(opts).opacity(0.16), in: .capsule)
                .foregroundStyle(tint(opts))
        case .scale(_, let hi) where Double(value) != nil:
            HStack(spacing: 6) {
                Text(value).monospacedDigit()
                Capsule().fill(.tint.opacity(0.8))
                    .frame(width: 28 * CGFloat(Double(value)! / Double(max(hi, 1))), height: 4)
            }
            .font(.system(size: EditorMetrics.body * 0.88))
        default:
            Text(value.isEmpty ? "–" : value)
                .font(.system(size: EditorMetrics.body * 0.88))
                .foregroundStyle(value.isEmpty ? .tertiary : .primary)
                .monospacedDigit()
                .lineLimit(1)
        }
    }

    private func tint(_ opts: [String]) -> Color {
        if value == opts.first { return .green }
        if value == "N/A" { return .secondary }
        return .orange
    }
}

/// One row of a typed table, with the right control for each column.
struct TableRowSheet: View {
    let columns: [TypedTable.Column]
    @State var values: [String]
    let isNew: Bool
    let onSave: ([String]) -> Void
    var onDelete: (() -> Void)?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                ForEach(Array(columns.enumerated()), id: \.offset) { i, c in
                    field(c, $values[i])
                }
                if let onDelete, !isNew {
                    Section {
                        Button("Delete Entry", role: .destructive) { onDelete(); dismiss() }
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle(isNew ? "New entry" : "Edit entry")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { onSave(values); dismiss() }.accessibilityIdentifier("row.save")
                }
            }
        }
        #if os(macOS)
        .frame(width: 520, height: 640)
        #endif
    }

    @ViewBuilder
    private func field(_ c: TypedTable.Column, _ value: Binding<String>) -> some View {
        switch c.type {
        case .date:
            DatePicker(c.name, selection: Binding(
                get: { TypedTable.date(from: value.wrappedValue) ?? .now },
                set: { value.wrappedValue = TypedTable.day($0) }
            ), displayedComponents: .date)
        case .number:
            LabeledContent(c.name) {
                TextField("0", text: value)
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
                    #if os(iOS)
                    .keyboardType(.decimalPad)
                    #endif
            }
        case .scale(let lo, let hi):
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text(c.name)
                    Spacer()
                    Text(value.wrappedValue.isEmpty ? "–" : value.wrappedValue).monospacedDigit().foregroundStyle(.secondary)
                }
                ScaleTaps(lo: lo, hi: hi, value: value)
            }
            .padding(.vertical, 4)
        case .choice(let opts):
            VStack(alignment: .leading, spacing: 8) {
                Text(c.name)
                Picker(c.name, selection: value) {
                    Text("–").tag("")
                    ForEach(opts, id: \.self) { Text($0).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }
            .padding(.vertical, 4)
        case .text:
            TextField(c.name, text: value, axis: .vertical)
                .lineLimit(1...4)
        }
    }
}

/// A row of numbers you tap, faster than a slider for a 1–10 score.
private struct ScaleTaps: View {
    let lo: Int
    let hi: Int
    @Binding var value: String

    var body: some View {
        HStack(spacing: 4) {
            ForEach(lo...max(lo, hi), id: \.self) { n in
                let on = value == String(n)
                Button { value = on ? "" : String(n) } label: {
                    Text("\(n)")
                        .font(.system(size: 15, weight: on ? .bold : .regular))
                        .monospacedDigit()
                        .frame(maxWidth: .infinity, minHeight: 34)
                        .background(on ? AnyShapeStyle(.tint) : AnyShapeStyle(.fill.tertiary), in: .rect(cornerRadius: 8))
                        .foregroundStyle(on ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
                }
                .buttonStyle(PressScale())
                .accessibilityLabel("\(n)")
            }
        }
        .animation(.snappy(duration: 0.15), value: value)
    }
}
