import SwiftUI

// A habit's day-by-day grid — a port of ContributionGrid.tsx. Ink for a vote,
// ink-and-amber stripes for a fail-safe, a little climbing line for a saved
// miss, grey for a rest day, an empty square for a miss.
struct ContributionGridView: View {
    let cells: [MomentumData.Cell]

    @State private var rangeDays = 30
    @State private var selected: MomentumData.Cell?
    @State private var expanded = false

    private static let ranges = [("7d", 7), ("30d", 30), ("6m", 182), ("1y", 365)]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Picker("Range", selection: $rangeDays) {
                    ForEach(Self.ranges, id: \.1) { Text($0.0).tag($0.1) }
                }
                .pickerStyle(.segmented).labelsHidden()
                .frame(maxWidth: 220)
                Spacer()
                Button { expanded = true } label: {
                    Image(systemName: "arrow.up.left.and.arrow.down.right").font(.ui(12))
                }
                .foregroundStyle(Theme.faint)
                .accessibilityLabel("Show full lifetime activity")
            }
            GridBody(cells: rangeDays >= cells.count ? cells : Array(cells.suffix(rangeDays)), selected: $selected)
            if let c = selected { Text(Self.describe(c)).font(.ui(12)).foregroundStyle(Theme.ink2).transition(.opacity) }
        }
        .sheet(isPresented: $expanded) {
            NavigationStack {
                ScrollView { GridBody(cells: cells, selected: $selected).padding() }
                    .navigationTitle("Full lifetime activity")
                    .inlineTitle()
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { expanded = false } } }
            }
            .presentationDetents([.medium, .large])
            .macSheet(width: 720, height: 520)
        }
    }

    static func describe(_ c: MomentumData.Cell) -> String {
        let day = DateText.formatted(c.date, "EEEE, MMM d")
        if c.wasSavedMiss { return "\(day) — Saved miss, chain protected" }
        if c.status == "failsafe" { return "\(day) — Fail-safe vote cast" }
        if c.count > 0 { return "\(day) — \(c.count) vote\(c.count == 1 ? "" : "s") cast" }
        if !c.scheduled { return "\(day) — Nothing owed this day" }
        if let r = c.missReasons, !r.isEmpty { return "\(day) — Missed: \(r.joined(separator: ", ").lowercased())" }
        return "\(day) — No vote cast"
    }
}

private struct GridBody: View {
    let cells: [MomentumData.Cell]
    @Binding var selected: MomentumData.Cell?

    private let size: CGFloat = 14
    private let gap: CGFloat = 2

    /// Columns of weeks, Sunday on top; the first week padded so rows line up.
    private var weeks: [[MomentumData.Cell?]] {
        var out: [[MomentumData.Cell?]] = []
        var week: [MomentumData.Cell?] = []
        for (i, c) in cells.enumerated() {
            if i == 0 { week = Array(repeating: nil, count: LocalDate.weekday(c.date)) }
            week.append(c)
            if week.count == 7 { out.append(week); week = [] }
        }
        if !week.isEmpty { out.append(week) }
        return out
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: gap) {
                    VStack(spacing: gap) {
                        ForEach(0..<7, id: \.self) { i in
                            Text(i % 2 == 1 ? ["S", "M", "T", "W", "T", "F", "S"][i] : "")
                                .font(.ui(8)).foregroundStyle(Theme.faint).frame(width: 12, height: size)
                        }
                    }
                    ForEach(Array(weeks.enumerated()), id: \.offset) { wi, week in
                        VStack(spacing: gap) {
                            ForEach(0..<week.count, id: \.self) { di in
                                if let c = week[di] {
                                    cell(c)
                                        .onTapGesture { selected = selected?.date == c.date ? nil : c }
                                        .overlay { if selected?.date == c.date { RoundedRectangle(cornerRadius: 3).stroke(Theme.accent, lineWidth: 1.5) } }
                                } else {
                                    Color.clear.frame(width: size, height: size)
                                }
                            }
                        }
                        .id(wi)
                    }
                }
            }
            .onAppear { proxy.scrollTo(weeks.count - 1, anchor: .trailing) }
            .onChange(of: cells.count) { proxy.scrollTo(weeks.count - 1, anchor: .trailing) }
        }
        .sensoryFeedback(.selection, trigger: selected?.date)
    }

    @ViewBuilder private func cell(_ c: MomentumData.Cell) -> some View {
        let shape = RoundedRectangle(cornerRadius: 3, style: .continuous)
        if c.count > 0 && c.status == "failsafe" {
            Stripes().clipShape(shape).frame(width: size, height: size)
        } else if c.count > 0 {
            shape.fill(Theme.ink).frame(width: size, height: size)
        } else if c.wasSavedMiss {
            shape.fill(Color(hex: 0xFDFBF7))
                .overlay(shape.stroke(Color(hex: 0xEAE0D5), lineWidth: 0.5))
                .overlay(
                    Path { p in
                        p.move(to: CGPoint(x: 1.5, y: 11)); p.addLine(to: CGPoint(x: 4.5, y: 8))
                        p.addLine(to: CGPoint(x: 6.5, y: 10)); p.addLine(to: CGPoint(x: 9.5, y: 3)); p.addLine(to: CGPoint(x: 12.5, y: 4))
                    }
                    .stroke(Color(hex: 0xD1B98E), style: StrokeStyle(lineWidth: 1.2, lineCap: .round, lineJoin: .round))
                )
                .frame(width: size, height: size)
        } else if !c.scheduled {
            shape.fill(Color(hex: 0xCBC7BF)).frame(width: size, height: size)
        } else {
            shape.fill(Theme.card).overlay(shape.stroke(Theme.line, lineWidth: 1)).frame(width: size, height: size)
        }
    }
}

/// Fail-safe: ink with amber diagonal stripes.
private struct Stripes: View {
    var body: some View {
        Canvas { ctx, size in
            ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Color(hex: 0x211F1B)))
            var x: CGFloat = -size.height
            while x < size.width {
                var p = Path()
                p.move(to: CGPoint(x: x, y: size.height)); p.addLine(to: CGPoint(x: x + size.height, y: 0))
                ctx.stroke(p, with: .color(Color(hex: 0xF5D24F)), lineWidth: 2.5)
                x += 5
            }
        }
    }
}

/// The legend that sits over the per-habit grids.
struct GridLegend: View {
    var body: some View {
        FlowLayout(spacing: 12) {
            item("Target hit") { RoundedRectangle(cornerRadius: 2).fill(Theme.ink) }
            item("Fail-safe") { Stripes().clipShape(RoundedRectangle(cornerRadius: 2)) }
            item("Saved miss") { RoundedRectangle(cornerRadius: 2).fill(Color(hex: 0xFDFBF7)).overlay(RoundedRectangle(cornerRadius: 2).stroke(Color(hex: 0xD1B98E))) }
            item("Rest day") { RoundedRectangle(cornerRadius: 2).fill(Color(hex: 0xCBC7BF)) }
            item("Miss") { RoundedRectangle(cornerRadius: 2).fill(Theme.card).overlay(RoundedRectangle(cornerRadius: 2).stroke(Theme.line)) }
        }
    }

    private func item<S: View>(_ label: String, @ViewBuilder _ swatch: () -> S) -> some View {
        HStack(spacing: 5) {
            swatch().frame(width: 10, height: 10)
            Text(label).font(.ui(10)).foregroundStyle(Theme.faint)
        }
    }
}
