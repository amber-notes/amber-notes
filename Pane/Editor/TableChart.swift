import Charts
import SwiftUI

/// How a tracker column changes over time: a line for numbers and scores,
/// a count per answer for choices ("how often was I on plan?").
struct TableChartSheet: View {
    let table: TypedTable
    @State private var column: Int
    @Environment(\.dismiss) private var dismiss

    init(table: TypedTable) {
        self.table = table
        _column = State(initialValue: table.columns.firstIndex { if case .scale = $0.type { true } else { false } }
            ?? table.columns.firstIndex { $0.type == .number } ?? 0)
    }

    private var chartable: [Int] {
        table.columns.indices.filter {
            switch table.columns[$0].type {
            case .scale, .number, .choice: true
            default: false
            }
        }
    }

    private var dateCol: Int? { table.columns.firstIndex { $0.type == .date } }

    private var points: [(Date, Double)] {
        guard let dc = dateCol else { return [] }
        return table.rows.compactMap { r in
            guard let d = TypedTable.date(from: r[dc]), let v = Double(r[column].replacingOccurrences(of: ",", with: ".")) else { return nil }
            return (d, v)
        }.sorted { $0.0 < $1.0 }
    }

    private var counts: [(String, Int)] {
        guard case .choice(let opts) = table.columns[column].type else { return [] }
        return opts.map { o in (o, table.rows.filter { $0[column] == o }.count) }
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                Picker("Column", selection: $column) {
                    ForEach(chartable, id: \.self) { Text(table.columns[$0].name).tag($0) }
                }
                .pickerStyle(.menu)
                .accessibilityIdentifier("chart.column")

                if case .choice = table.columns[column].type {
                    Chart(counts, id: \.0) { item in
                        BarMark(x: .value("Answer", item.0), y: .value("Days", item.1))
                            .foregroundStyle(item.0 == counts.first?.0 ? Color.green.gradient : Color.orange.gradient)
                            .cornerRadius(6)
                            .annotation(position: .top) { Text("\(item.1)").font(.caption).monospacedDigit().foregroundStyle(.secondary) }
                    }
                    .chartYAxisLabel("Days")
                } else if points.count >= 2 {
                    let avg = points.map(\.1).reduce(0, +) / Double(points.count)
                    Chart {
                        ForEach(points, id: \.0) { p in
                            AreaMark(x: .value("Day", p.0, unit: .day), y: .value("Value", p.1))
                                .foregroundStyle(.linearGradient(colors: [Color.accentColor.opacity(0.3), .clear], startPoint: .top, endPoint: .bottom))
                                .interpolationMethod(.monotone)
                            LineMark(x: .value("Day", p.0, unit: .day), y: .value("Value", p.1))
                                .interpolationMethod(.monotone)
                                .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round))
                            PointMark(x: .value("Day", p.0, unit: .day), y: .value("Value", p.1))
                                .symbolSize(28)
                        }
                        RuleMark(y: .value("Average", avg))
                            .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                            .foregroundStyle(.secondary)
                            .annotation(position: .top, alignment: .leading) {
                                Text("Average \(TypedTable.format(avg))").font(.caption).foregroundStyle(.secondary)
                            }
                    }
                    .chartYScale(domain: yDomain)
                } else {
                    ContentUnavailableView("Not enough entries yet", systemImage: "chart.xyaxis.line",
                                           description: Text("Log a few days and the trend shows up here."))
                }
                Spacer(minLength: 0)
            }
            .padding(20)
            .navigationTitle("Trends")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        #if os(macOS)
        .frame(width: 560, height: 460)
        #endif
    }

    private var yDomain: ClosedRange<Double> {
        if case .scale(let lo, let hi) = table.columns[column].type { return Double(lo)...Double(hi) }
        let v = points.map(\.1)
        return (min(0, v.min() ?? 0))...((v.max() ?? 1) * 1.1)
    }
}
