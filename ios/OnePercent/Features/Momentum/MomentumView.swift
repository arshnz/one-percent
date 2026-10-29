import SwiftUI
import SwiftData
import Charts

// Momentum — a port of client/src/pages/Momentum.tsx. Who you're becoming.
struct MomentumView: View {
    var onEditHabit: ((Habit) -> Void)?
    var onAddHabit: (() -> Void)?
    /// Extra content per habit (the habit-effect card arrives with Body).
    var habitFooter: ((Habit) -> AnyView)?
    /// Rendered under "What you've measured" (the wearable panel).
    var measuredExtra: AnyView?
    /// The cached "What the data says" card (it refreshes via the AI layer).
    var insights: AnyView?

    @Query(sort: \Habit.createdAt) private var habits: [Habit]
    @Query private var logs: [HabitLog]
    @Query(sort: \CheckIn.weekOf, order: .reverse) private var checkIns: [CheckIn]
    @Query private var phases: [Phase]
    @Query private var profiles: [Profile]
    @Environment(\.scenePhase) private var scenePhase
    @State private var now = Date()
    @State private var showDetails = false
    @State private var data: MomentumData?

    private var tz: String { profiles.first?.timezone ?? TimeZone.current.identifier }

    /// Changes whenever anything Momentum reads changes — a year of grids is
    /// too much work to redo on every redraw.
    private var inputs: Int {
        var h = Hasher()
        h.combine(now.timeIntervalSince1970 / 60)
        h.combine(tz)
        for l in logs { h.combine(l.date); h.combine(l.status); h.combine(l.missReasons) }
        for p in phases { h.combine(p.status) }
        for x in habits { h.combine(x.pausedAt); h.combine(x.archivedAt); h.combine(x.scheduleDays); h.combine(x.scheduleType); h.combine(x.timesPerWeek); h.combine(x.setbackPlans) }
        for c in checkIns { h.combine(c.weekOf); h.combine(c.rating) }
        return h.finalize()
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header
                    if let data { content(data) } else { ProgressView().frame(maxWidth: .infinity, minHeight: 200) }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 32)
            }
            .background(Theme.bg)
            .refreshable { now = Date() }
            .toolbar(.hidden, for: .navigationBar)
        }
        .onChange(of: scenePhase) { if scenePhase == .active { now = Date() } }
        .task(id: inputs) { data = Momentum.compute(habits: habits, checkIns: checkIns, now: now, tz: tz) }
    }

    @ViewBuilder private func content(_ data: MomentumData) -> some View {
                    if data.habitCount == 0 {
                        empty
                    } else {
                        CompoundCurveCard(data: data)
                        if let insights { insights } else { InsightsCardView(profile: profiles.first) }
                        primaryStats(data)
                        details(data)
                        habitByHabit(data)
                        MeasuredSeriesView(data: data, extra: measuredExtra)
                        CheckInHistoryView(checkIns: Array(checkIns.prefix(20)))
                    }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: "chart.bar").font(.system(size: 12))
                Eyebrow("Momentum")
            }
            .foregroundStyle(Theme.faint)
            Text("Who you’re becoming").font(.system(size: 26, weight: .semibold)).tracking(-0.5).foregroundStyle(Theme.ink)
            Text("Every rep is a vote. Here’s what they’re compounding into.").font(.system(size: 14)).foregroundStyle(Theme.ink2)
        }
        .padding(.top, 12)
    }

    private var empty: some View {
        VStack(spacing: 8) {
            Text("No votes cast yet").font(.serif(18)).foregroundStyle(Theme.ink)
            Text("Engineer a habit and start casting votes — your curve starts climbing from the first rep.")
                .font(.system(size: 14)).foregroundStyle(Theme.ink2).multilineTextAlignment(.center)
            if let onAddHabit {
                Button("Open the Architect", action: onAddHabit).buttonStyle(PrimaryButtonStyle()).padding(.top, 12)
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity)
        .card()
    }

    private func primaryStats(_ d: MomentumData) -> some View {
        HStack(spacing: 12) {
            bigStat("Total identity votes", icon: "checkmark.seal", value: "\(d.totalVotes)", unit: nil,
                    hint: "lifetime reps — each one a vote for who you want to be")
            bigStat("Showing up", icon: "gauge.with.needle", value: "\(d.consistency.rhythm)", unit: "%",
                    hint: "how often you’ve shown up lately — recent days count more")
        }
    }

    private func bigStat(_ label: String, icon: String, value: String, unit: String?, hint: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 11))
                Text(label.uppercased()).font(.system(size: 10, weight: .semibold)).tracking(1).lineLimit(1).minimumScaleFactor(0.8)
            }
            .foregroundStyle(Theme.faint)
            (Text(value) + Text(unit ?? "").font(.system(size: 20)).foregroundStyle(Theme.faint))
                .font(.system(size: 40, weight: .semibold)).tracking(-1).foregroundStyle(Theme.ink)
            Text(hint).font(.system(size: 12)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private func details(_ d: MomentumData) -> some View {
        DisclosureGroup(isExpanded: $showDetails) {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                smallStat("Showing up", icon: "repeat", value: "\(d.consistency.rhythm)", hint: "lately, weighted recent")
                smallStat("Same time of day", icon: "clock", value: d.consistency.anchoring.map(String.init) ?? "—",
                          hint: d.consistency.anchoring == nil ? "building…" : "a steady rhythm")
                smallStat("Bounce-backs", icon: "shield", value: "\(d.totalRecoveries)", hint: "never missed twice")
                smallStat("Top obstacle", icon: "cloud.rain", value: d.topObstacle.map { "\($0.reason) ×\($0.count)" } ?? "—",
                          hint: d.topObstacle == nil ? "nothing recorded yet" : "across all habits, 30 days")
            }
            .padding(.top, 10)
        } label: {
            Eyebrow(showDetails ? "Hide the details" : "Show the details")
        }
        .tint(Theme.faint)
    }

    private func smallStat(_ label: String, icon: String, value: String, hint: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Label(label.uppercased(), systemImage: icon).font(.system(size: 10, weight: .medium)).foregroundStyle(Theme.faint)
            Text(value).font(.system(size: 19, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1).minimumScaleFactor(0.7)
            Text(hint).font(.system(size: 11.5)).foregroundStyle(Theme.faint)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private func habitByHabit(_ d: MomentumData) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Eyebrow("Habit by habit", color: Theme.ink2)
            GridLegend()
            ForEach(d.trajectory) { t in
                HabitMomentumCard(t: t, onEdit: onEditHabit, footer: habitFooter?(t.habit))
            }
        }
    }
}

private struct HabitMomentumCard: View {
    let t: MomentumData.HabitTrajectory
    let onEdit: ((Habit) -> Void)?
    let footer: AnyView?

    var body: some View {
        let breaking = t.habit.kind == "break"
        let color = Theme.accent(for: t.habit)
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    if breaking {
                        Label("Breaking" + (t.habit.breakMode == "taper" ? " · taper" : ""), systemImage: "shield")
                            .font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.breakAccent)
                            .padding(.horizontal, 7).padding(.vertical, 2).background(Theme.breakAccent.opacity(0.08), in: Capsule())
                    }
                    Text(t.habit.title).font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.ink).lineLimit(2)
                }
                Spacer()
                Text(t.paused ? "Paused" : "Showing up \(t.consistency.rhythm)%")
                    .font(.system(size: 12))
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .foregroundStyle(t.paused ? Color(hex: 0x5B4B86) : Theme.ink2)
                    .background(t.paused ? Color(hex: 0xEFEAF7) : Theme.panel, in: Capsule())
            }
            Sparkline(habit: t.curveHabit, color: color)
            ContributionGridView(cells: t.contributions)
            obstacles
            phaseLadder
            if let footer { footer }
        }
        .padding(18)
        .card()
        .overlay(alignment: .leading) {
            UnevenRoundedRectangle(topLeadingRadius: 20, bottomLeadingRadius: 20).fill(color).frame(width: 3)
        }
    }

    @ViewBuilder private var obstacles: some View {
        if !t.topObstacles.isEmpty || t.missPattern != nil {
            VStack(alignment: .leading, spacing: 6) {
                Eyebrow("What gets in the way")
                if !t.topObstacles.isEmpty {
                    FlowLayout(spacing: 6) {
                        ForEach(t.topObstacles, id: \.self) { o in
                            (Text(o.reason) + Text(" ×\(o.count)").foregroundStyle(Theme.faint))
                                .font(.system(size: 12)).foregroundStyle(Theme.ink2)
                                .padding(.horizontal, 8).padding(.vertical, 3)
                                .background(Theme.bg, in: Capsule()).overlay(Capsule().stroke(Theme.line))
                        }
                        // A reason that keeps recurring with no matching if/then
                        // plan is the next setback plan waiting to be written.
                        if let onEdit, unplanned != nil {
                            Button("Make a plan for this →") { onEdit(t.habit) }
                                .font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.gold)
                        }
                    }
                }
                if let p = t.missPattern { Text(p).font(.system(size: 12)).italic().foregroundStyle(Theme.faint) }
            }
        }
    }

    private var unplanned: MomentumData.Obstacle? {
        t.topObstacles.first { o in
            o.count >= 3 && !t.setbackObstacles.contains { s in
                s.lowercased().contains(o.reason.lowercased()) || o.reason.lowercased().contains(s.lowercased())
            }
        }
    }

    private var phaseLadder: some View {
        FlowLayout(spacing: 6) {
            ForEach(Array(t.phases.enumerated()), id: \.offset) { i, p in
                HStack(spacing: 6) {
                    if i > 0 { Text("→").foregroundStyle(Theme.faint) }
                    HStack(spacing: 5) {
                        Image(systemName: icon(p.status)).font(.system(size: 10, weight: .semibold)).foregroundStyle(tone(p.status))
                        Text("Phase \(p.phaseNumber)")
                        if p.status == "ready" { Text("· ready for check").foregroundStyle(Theme.faint) }
                        if p.status == "graduated", let g = p.graduatedAt {
                            Text("· \(g.formatted(.dateTime.month(.abbreviated).day()))").foregroundStyle(Theme.faint)
                        }
                    }
                    .font(.system(size: 12))
                    .foregroundStyle(p.status == "locked" ? Theme.faint : Theme.ink)
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .background(tone(p.status).opacity(p.status == "locked" ? 0 : 0.1), in: Capsule())
                    .overlay(Capsule().stroke(p.status == "locked" ? Theme.line : tone(p.status).opacity(0.4)))
                }
            }
        }
    }

    private func icon(_ s: String) -> String {
        switch s {
        case "graduated": "checkmark"
        case "ready": "sparkles"
        case "locked": "lock"
        default: "target"
        }
    }

    private func tone(_ s: String) -> Color {
        switch s {
        case "graduated": Theme.green
        case "ready": Theme.amber
        case "locked": Theme.faint
        default: Theme.ink
        }
    }
}

/// One habit's own compound curve — the shape and the number are the point.
struct Sparkline: View {
    let habit: Compound.CurveHabit
    let color: Color

    var body: some View {
        let actual = Compound.progressSeries([habit]).actual
        if actual.count >= 2 {
            HStack(spacing: 8) {
                Chart(Array(actual.enumerated()), id: \.offset) { i, p in
                    LineMark(x: .value("d", i), y: .value("v", p.value))
                        .foregroundStyle(color)
                        .lineStyle(StrokeStyle(lineWidth: 1.75, lineCap: .round, lineJoin: .round))
                }
                .chartXAxis(.hidden).chartYAxis(.hidden)
                .chartYScale(domain: (actual.map(\.value).min()!)...(max(actual.map(\.value).max()!, actual.map(\.value).min()! + 0.0001)))
                .frame(height: 22)
                Text(Compound.format(actual.last!.value)).font(.system(size: 14, weight: .semibold)).monospacedDigit().foregroundStyle(Theme.ink)
            }
        }
    }
}

struct MeasuredSeriesView: View {
    let data: MomentumData
    let extra: AnyView?

    private struct AutoLine: Identifiable {
        let habit: Habit
        let points: [MomentumData.AutomaticityPoint]
        var id: String { habit.uid }
    }

    private var lines: [AutoLine] {
        let byUid = Dictionary(uniqueKeysWithValues: data.trajectory.map { ($0.habit.uid, $0.habit) })
        let grouped = Dictionary(grouping: data.automaticity, by: \.habitUid)
        return grouped.compactMap { uid, pts in byUid[uid].map { AutoLine(habit: $0, points: pts) } }
            .filter { $0.points.count >= 2 }
            .sorted { $0.habit.createdAt < $1.habit.createdAt }
    }

    var body: some View {
        let lines = lines
        let ratings = data.weeklyRatings
        if !lines.isEmpty || ratings.count >= 3 || extra != nil {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Eyebrow("What you’ve measured", color: Theme.ink2)
                    Text("Not the curve above — these are the raw numbers, drawn straight, nothing modelled.").font(.system(size: 12)).foregroundStyle(Theme.faint)
                }
                if !lines.isEmpty { automaticity(lines) }
                if ratings.count >= 3 { weekly(ratings) }
                if let extra { extra }
            }
        }
    }

    private func automaticity(_ lines: [AutoLine]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("How automatic it feels").font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.ink)
            Text("Your SRBAI score each time a phase came up for a check. \(String(format: "%.1f", Automaticity.passThreshold)) graduates it.")
                .font(.system(size: 12)).foregroundStyle(Theme.faint)
            Chart {
                RuleMark(y: .value("Pass", Automaticity.passThreshold))
                    .foregroundStyle(Theme.green.opacity(0.7)).lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
                    .annotation(position: .top, alignment: .trailing) { Text("pass").font(.system(size: 8)).foregroundStyle(Theme.green) }
                ForEach(lines) { l in
                    ForEach(l.points, id: \.createdAt) { p in
                        LineMark(x: .value("When", p.createdAt), y: .value("SRBAI", p.mean), series: .value("Habit", l.habit.uid))
                            .foregroundStyle(Theme.accent(for: l.habit))
                        PointMark(x: .value("When", p.createdAt), y: .value("SRBAI", p.mean))
                            .foregroundStyle(p.passed ? Theme.accent(for: l.habit) : Theme.card)
                            .symbol { Circle().stroke(Theme.accent(for: l.habit), lineWidth: 1.5).background(Circle().fill(p.passed ? Theme.accent(for: l.habit) : Theme.card)).frame(width: 7) }
                    }
                }
            }
            .chartYScale(domain: 1...5)
            .chartYAxis { AxisMarks(values: [1, 3, 5]) }
            .frame(height: 130)
        }
        .padding(16)
        .card()
    }

    private func weekly(_ ratings: [(weekOf: String, rating: Int)]) -> some View {
        let byWeek = Dictionary(ratings.map { ($0.weekOf, $0.rating) }, uniquingKeysWith: { a, _ in a })
        var slots: [(String, Int?)] = []
        var cursor = ratings.first!.weekOf
        while cursor <= ratings.last!.weekOf && slots.count < 200 {
            slots.append((cursor, byWeek[cursor]))
            cursor = LocalDate.shift(cursor, by: 7)
        }
        let avg = Double(ratings.map(\.rating).reduce(0, +)) / Double(ratings.count)
        let skipped = slots.count - ratings.count
        return VStack(alignment: .leading, spacing: 6) {
            Text("How the week felt").font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.ink)
            Text("Your own 1–10 rating at each weekly check-in. Averaging \(String(format: "%.1f", avg))" + (skipped > 0 ? " across \(ratings.count) of \(slots.count) weeks." : "."))
                .font(.system(size: 12)).foregroundStyle(Theme.faint)
            Chart(slots, id: \.0) { week, rating in
                BarMark(x: .value("Week", week), y: .value("Rating", rating ?? 0))
                    .foregroundStyle(rating == nil ? Color.clear : Theme.green.opacity(0.7))
                    .cornerRadius(3)
            }
            .chartYScale(domain: 0...10)
            .chartXAxis(.hidden)
            .chartYAxis { AxisMarks(values: [0, 5, 10]) }
            .frame(height: 110)
            HStack {
                Text(DateText.formatted(slots.first!.0, "MMM yyyy")); Spacer(); Text(DateText.formatted(slots.last!.0, "MMM yyyy"))
            }
            .font(.system(size: 10)).foregroundStyle(Theme.faint)
        }
        .padding(16)
        .card()
    }
}

/// The look-back shelf — every past check-in, skipped weeks included.
struct CheckInHistoryView: View {
    let checkIns: [CheckIn]

    var body: some View {
        if !checkIns.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Label("Check-in history", systemImage: "calendar.badge.checkmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.ink2)
                ForEach(checkIns) { c in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("Week of \(DateText.shortMonthDay(c.weekOf))").font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.ink)
                            Spacer()
                            if c.status == "skipped" {
                                Text("Skipped").font(.system(size: 12)).foregroundStyle(Theme.faint)
                            } else if let r = c.rating {
                                Text("\(r)/10").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.green)
                            }
                        }
                        if let s = c.aiSummary { Text(s).font(.system(size: 13)).foregroundStyle(Theme.ink2) }
                        if let w = c.tinyVictory { Text("Win: \(w)").font(.system(size: 12.5)).foregroundStyle(Theme.muted) }
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card()
                }
            }
        }
    }
}
