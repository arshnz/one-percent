import SwiftUI
import Charts

// The headline: where these reps are heading. A port of CompoundCurve.tsx.
//
// The range looks the same distance forward as back: y-max is driven by where
// the projection ends, so a fixed one-year projection would flatten the history
// you actually earned into a smudge on the floor.
struct CompoundCurveCard: View {
    let data: MomentumData

    @State private var rangeDays = 182
    @State private var selectedDay: Int?
    @State private var showMaths = false

    private static let ranges = [("3m", 91), ("6m", 182), ("1y", 365)]

    private struct Model {
        let actual: [Compound.Point]
        let ceiling: [Compound.Point]
        let fan: Compound.Projection
        let promise: [Compound.ProjectedPoint]?
        let starting: Bool
        let weeklyActive: Int
        let progressDays: Double
        let activeDays: Int
        let projWeeks: Int
        let markers: [(day: Int, value: Double, label: String)]
        var histDays: Int { actual.count }
        var current: Double { actual.last?.value ?? 1 }
    }

    private var model: Model {
        let projWeeks = Int((Double(rangeDays) / 7).rounded())
        let series = Compound.progressSeries(data.curveHabits)
        let from = max(0, series.actual.count - rangeDays)
        let actual = Array(series.actual[from...])
        let ceiling = Array(series.ceiling[from...])
        let weekly = Compound.activeDaysPerWeek(data.scheduleSummaries)
        let fan = Compound.projectFan(progressDays: series.progressDays, rhythmPct: Double(data.consistency.rhythm), weeklyActive: weekly, weeks: projWeeks)
        // With no votes there's no pace to project; the honest line is the one
        // the app is asking for: hit every scheduled day.
        let starting = data.totalVotes == 0
        let promise = starting && weekly > 0 ? Compound.project(from: 0, perWeek: Double(weekly), weeks: projWeeks) : nil
        let index = Dictionary(actual.enumerated().map { ($1.date, $0) }, uniquingKeysWith: { a, _ in a })
        var markers: [(Int, Double, String)] = []
        for t in data.trajectory {
            for p in t.phases {
                guard let g = p.graduatedAt, let i = index[LocalDate.of(g, tz: "UTC")] else { continue }
                markers.append((i, actual[i].value, "\(t.habit.title) · Phase \(p.phaseNumber) graduated"))
            }
        }
        return Model(
            actual: actual, ceiling: ceiling, fan: fan, promise: promise, starting: starting, weeklyActive: weekly,
            progressDays: series.progressDays, activeDays: series.activeDays, projWeeks: projWeeks, markers: markers
        )
    }

    var body: some View {
        let m = model
        let exponent = Int(m.progressDays.rounded())
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Eyebrow("Your compound curve")
                    Text(Compound.format(m.current)).font(.system(size: 38, weight: .semibold)).tracking(-1).foregroundStyle(Theme.ink)
                        .contentTransition(.numericText())
                    if !m.actual.isEmpty && !m.starting && exponent > 0 {
                        Text("1.01 raised to \(exponent) \(exponent == 1 ? "day" : "days") of showing up").font(.system(size: 12)).foregroundStyle(Theme.faint)
                    }
                }
                Spacer()
                Picker("Range", selection: $rangeDays.animation()) {
                    ForEach(Self.ranges, id: \.1) { Text($0.0).tag($0.1) }
                }
                .pickerStyle(.segmented)
                .frame(width: 140)
            }

            if m.actual.isEmpty {
                Text("Nothing’s scheduled yet, so there’s no day for the curve to stand on.")
                    .font(.system(size: 14)).foregroundStyle(Theme.ink2).frame(maxWidth: .infinity, minHeight: 160)
            } else {
                chart(m).frame(height: 240)
                summary(m)
                legend(m)
                if !m.starting && exponent > 0 { maths(m, exponent: exponent) }
            }
            Text("This pictures compounding — it doesn’t measure you.").font(.system(size: 11)).italic().foregroundStyle(Theme.faint)
        }
        .padding(20)
        .card()
    }

    private func chart(_ m: Model) -> some View {
        let today = m.histDays - 1
        let forward: [(String, [Compound.ProjectedPoint], Double)] = m.starting
            ? (m.promise.map { [("If you never miss", $0, 0.5)] } ?? [])
            : [("One more day a week", m.fan.atOneMoreDay, 0.4), ("At your pace", m.fan.atCurrentPace, 0.8)]
        let values = m.actual.map(\.value) + m.ceiling.map(\.value)
        let yMin = values.min() ?? 1
        let forwardEnd = forward.map { $0.1.last!.value }.max() ?? m.current
        let yMaxRaw = max(m.ceiling.last?.value ?? 1, forwardEnd) * 1.05
        let yMax = yMaxRaw > yMin ? yMaxRaw : yMin + 1
        let totalDays = max(1, today + m.projWeeks * 7)

        return Chart {
            ForEach(Array(m.ceiling.enumerated()), id: \.offset) { i, p in
                LineMark(x: .value("Day", i), y: .value("×", p.value), series: .value("s", "ceiling"))
                    .foregroundStyle(Theme.faint.opacity(0.55))
                    .lineStyle(StrokeStyle(lineWidth: 1.2, dash: [3, 4]))
            }
            ForEach(forward, id: \.0) { name, pts, alpha in
                ForEach(pts, id: \.weekOffset) { p in
                    LineMark(x: .value("Day", today + p.weekOffset * 7), y: .value("×", p.value), series: .value("s", name))
                        .foregroundStyle(Theme.accent.opacity(alpha))
                        .lineStyle(StrokeStyle(lineWidth: 1.6, dash: [5, 4]))
                }
            }
            ForEach(Array(m.actual.enumerated()), id: \.offset) { i, p in
                AreaMark(x: .value("Day", i), yStart: .value("min", yMin), yEnd: .value("×", p.value))
                    .foregroundStyle(LinearGradient(colors: [Theme.accent.opacity(0.18), Theme.accent.opacity(0)], startPoint: .top, endPoint: .bottom))
                LineMark(x: .value("Day", i), y: .value("×", p.value), series: .value("s", "actual"))
                    .foregroundStyle(Theme.accent)
                    .lineStyle(StrokeStyle(lineWidth: 2.4, lineCap: .round, lineJoin: .round))
            }
            RuleMark(x: .value("Today", today))
                .foregroundStyle(Theme.faint.opacity(0.4))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [2, 3]))
                .annotation(position: .top, alignment: .leading) { Text("today").font(.system(size: 9)).foregroundStyle(Theme.faint) }
            ForEach(Array(m.markers.enumerated()), id: \.offset) { _, mk in
                PointMark(x: .value("Day", mk.day), y: .value("×", mk.value))
                    .foregroundStyle(Theme.green).symbolSize(40)
            }
            if let sel = readout(m, totalDays: totalDays) {
                RuleMark(x: .value("Sel", sel.day)).foregroundStyle(Theme.faint.opacity(0.5))
                PointMark(x: .value("Sel", sel.day), y: .value("×", sel.value)).foregroundStyle(Theme.accent)
                    .annotation(position: .top, spacing: 6, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                        VStack(spacing: 1) {
                            Text(Compound.format(sel.value)).font(.system(size: 12, weight: .semibold))
                            Text(sel.title + (sel.note.map { " · \($0)" } ?? "")).font(.system(size: 10)).opacity(0.7)
                        }
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8).padding(.vertical, 5)
                        .background(Theme.ink, in: RoundedRectangle(cornerRadius: 8))
                    }
            }
        }
        .chartXScale(domain: 0...totalDays)
        .chartYScale(domain: yMin...yMax)
        .chartXAxis(.hidden)
        .chartYAxis {
            AxisMarks(position: .trailing, values: (0...3).map { yMin + (yMax - yMin) * Double($0) / 3 }) { v in
                AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5, dash: [2, 4])).foregroundStyle(Theme.line)
                AxisValueLabel { if let d = v.as(Double.self) { Text(Compound.format(d)).font(.system(size: 10)).foregroundStyle(Theme.faint) } }
            }
        }
        .chartXSelection(value: $selectedDay)
        .chartOverlay { _ in
            // The two projection end labels, pinned to the right edge.
            GeometryReader { _ in EmptyView() }
        }
        .accessibilityLabel("Compound curve at \(Compound.format(m.current))")
    }

    private func readout(_ m: Model, totalDays: Int) -> (day: Int, value: Double, title: String, note: String?)? {
        guard let d = selectedDay else { return nil }
        let today = m.histDays - 1
        if d <= today {
            let i = max(0, min(d, m.actual.count - 1))
            return (i, m.actual[i].value, DateText.dayMonthYear(m.actual[i].date), nil)
        }
        guard let line = m.starting ? m.promise : m.fan.atCurrentPace else { return nil }
        let week = max(0, min(Int((Double(d - today) / 7).rounded()), m.projWeeks))
        let date = LocalDate.shift(m.actual.last!.date, by: week * 7)
        return (today + week * 7, line[week].value, DateText.monthYear(date), m.starting ? "if you hit every scheduled day" : "at your current pace")
    }

    @ViewBuilder private func summary(_ m: Model) -> some View {
        let end = DateText.monthYear(LocalDate.shift(m.actual.last!.date, by: m.projWeeks * 7))
        if m.starting {
            if let p = m.promise {
                (Text("Nothing cast yet. Hit every scheduled day and you’d be at ") + Text(Compound.format(p.last!.value)).bold()
                 + Text(" by \(end) — the first rep starts the climb."))
                    .font(.system(size: 14)).foregroundStyle(Theme.ink2)
            }
        } else {
            VStack(alignment: .leading, spacing: 4) {
                (Text("You’re at ") + Text(Compound.format(m.current)).bold() + Text(". At your current pace you’ll be at ")
                 + Text(Compound.format(m.fan.paceEnd)).bold() + Text(" by \(end).")
                 + (m.weeklyActive > 0 && m.fan.oneMoreEnd > m.fan.paceEnd
                    ? Text(" Show up one more day a week → ") + Text(Compound.format(m.fan.oneMoreEnd)).bold() + Text(".")
                    : Text("")))
                    .font(.system(size: 14)).foregroundStyle(Theme.ink2)
                if m.weeklyActive > 0 {
                    Text("The dashed lines assume you keep hitting \(data.consistency.rhythm)% of your days for a year — a projection, not a promise.")
                        .font(.system(size: 12)).foregroundStyle(Theme.faint)
                }
            }
        }
    }

    private func legend(_ m: Model) -> some View {
        FlowLayout(spacing: 12) {
            key("Days you showed up", Theme.accent, dashed: false)
            if !m.starting { key("At your pace", Theme.accent.opacity(0.8), dashed: true) }
            if !m.starting && m.fan.oneMoreEnd > m.fan.paceEnd { key("One more day a week", Theme.accent.opacity(0.4), dashed: true) }
            if m.starting && m.promise != nil { key("If you never miss", Theme.accent.opacity(0.5), dashed: true) }
            if !m.starting { key("Every scheduled day (so far)", Theme.faint.opacity(0.55), dashed: true) }
            if !m.markers.isEmpty {
                HStack(spacing: 5) { Circle().fill(Theme.green).frame(width: 7, height: 7); Text("Phase graduated") }
                    .font(.system(size: 10)).foregroundStyle(Theme.faint)
            }
        }
    }

    private func key(_ label: String, _ color: Color, dashed: Bool) -> some View {
        HStack(spacing: 5) {
            Path { p in p.move(to: .zero); p.addLine(to: CGPoint(x: 14, y: 0)) }
                .stroke(color, style: StrokeStyle(lineWidth: 2, dash: dashed ? [3, 2] : []))
                .frame(width: 14, height: 2)
            Text(label)
        }
        .font(.system(size: 10)).foregroundStyle(Theme.faint)
    }

    private func maths(_ m: Model, exponent: Int) -> some View {
        DisclosureGroup(isExpanded: $showMaths) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Every day you’re scheduled, the share of your habits you complete adds to a running day count — do everything and the day counts in full; do half and it counts half. You’ve banked the equivalent of \(exponent) full \(exponent == 1 ? "day" : "days") out of the \(m.activeDays) you could have.")
                Text("Each one multiplies you by 1.01: **1.01^\(exponent) = \(Compound.format(m.current))**. Type 1.01 ^ \(exponent) into any calculator to check it. A perfect year — showing up every scheduled day — is 1.01^365 = 37.8×.")
                if m.weeklyActive > 0 {
                    Text("The forward lines project that count onward assuming you hold your current pace, hitting \(data.consistency.rhythm)% of your days. That’s an estimate, not a promise — miss more and the real line stays lower.")
                }
                Text("Built from your \(data.totalVotes) logged \(data.totalVotes == 1 ? "rep" : "reps"). Rest days and paused habits don’t count for or against you — the curve never drops on a miss, it just stops climbing.")
            }
            .font(.system(size: 12.5)).foregroundStyle(Theme.ink2)
            .padding(.top, 6)
        } label: {
            Eyebrow(showMaths ? "Hide the calculation" : "How this is calculated")
        }
        .tint(Theme.faint)
    }
}

nonisolated extension DateText {
    /// "29 Oct 2026"
    static func dayMonthYear(_ iso: String) -> String { formatted(iso, "d MMM yyyy") }
    /// "October 2026"
    static func monthYear(_ iso: String) -> String { formatted(iso, "MMMM yyyy") }
    /// "Oct 29"
    static func shortMonthDay(_ iso: String) -> String { formatted(iso, "MMM d") }

    static func formatted(_ iso: String, _ pattern: String) -> String {
        let parse = DateFormatter()
        parse.locale = Locale(identifier: "en_US_POSIX")
        parse.timeZone = TimeZone(identifier: "UTC")
        parse.dateFormat = "yyyy-MM-dd"
        let out = DateFormatter()
        out.timeZone = TimeZone(identifier: "UTC")
        out.dateFormat = pattern
        return parse.date(from: iso).map(out.string) ?? iso
    }
}
