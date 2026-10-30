import SwiftUI
import SwiftData
import Charts

// The Body — a port of client/src/pages/Body.tsx. Your body's own record,
// standing on its own: it works, and is worth opening, with no habits at all.
// Everything here was measured, not remembered or rated.

enum BodyFeatures {
    @MainActor static func register() {
        BodyTabSlot.factory = { AnyView(BodyView()) }
        HealthSettingsSlot.factory = { AnyView(HealthSettingsCard()) }
        HabitFooterSlot.factory = { habit in AnyView(HabitEffectCard(habit: habit)) }
        Prompts.wearableBlock = { now, tz in BodyAI.wearableBlockFromStore(now: now, tz: tz) }
    }
}

/// Where the per-habit effect card plugs into Momentum.
enum HabitFooterSlot {
    @MainActor static var factory: ((Habit) -> AnyView)?
}

struct BodyView: View {
    @Environment(\.modelContext) private var ctx
    @Environment(Toasts.self) private var toasts
    @Query(sort: \BodyDay.date) private var rows: [BodyDay]
    @Query(sort: \BodyActivity.startedAt) private var activities: [BodyActivity]
    @Query private var profiles: [Profile]

    @State private var rangeDays = 30
    @State private var findings: (days: Int, findings: [Finding])?
    @State private var syncing = false

    private var tz: String { profiles.first?.timezone ?? TimeZone.current.identifier }
    private static let ranges = [("7d", 7), ("30d", 30), ("6m", 182), ("1y", 365)]
    /// A year of permutation tests is worth computing once per day of data.
    private static var cache: (key: String, value: (days: Int, findings: [Finding]))?

    var body: some View {
        let samples = BodySample.merged(rows)
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 4) {
                        Label("THE BODY", systemImage: "waveform.path.ecg").font(.eyebrow).tracking(1.4).foregroundStyle(Theme.faint)
                        Text("What your body recorded").font(.ui(26, weight: .semibold)).tracking(-0.5).foregroundStyle(Theme.ink)
                        Text("Measured while you slept and moved — nothing here was remembered, rated or typed in. The charts are the evidence; the reading of them is above.")
                            .font(.ui(14)).foregroundStyle(Theme.ink2)
                    }
                    .padding(.top, 12)
                    .phoneOnly()

                    healthBar(samples)

                    if samples.isEmpty {
                        VStack(spacing: 8) {
                            Text("Nothing recorded yet").font(.serif(18))
                            Text("Connect Apple Health and your sleep, resting heart rate, HRV and steps land here automatically — from an Apple Watch, Garmin Connect, or any app that writes to Health.")
                                .font(.ui(14)).foregroundStyle(Theme.ink2).multilineTextAlignment(.center)
                        }
                        .padding(28).frame(maxWidth: .infinity).card()
                    } else {
                        FindingsPanel(result: findings)
                        HStack {
                            Eyebrow("The raw record", color: Theme.ink2)
                            Spacer()
                            Picker("Range", selection: $rangeDays) { ForEach(Self.ranges, id: \.1) { Text($0.0).tag($0.1) } }
                                .pickerStyle(.segmented).labelsHidden().frame(width: 200)
                        }
                        Text("Every day as it was measured. Nothing smoothed, nothing filled in.").font(.ui(12)).foregroundStyle(Theme.faint)
                        #if os(macOS)
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 460), spacing: 16, alignment: .top)], spacing: 16) {
                            panels(slots(samples))
                        }
                        #else
                        panels(slots(samples))
                        #endif
                        Text("Days with nothing recorded are left blank rather than filled in.").font(.ui(11)).foregroundStyle(Theme.faint)
                    }
                }
                .padding(.horizontal, 16).padding(.bottom, 32)
            }
            .background(Theme.bg)
            .refreshable { await sync() }
            .hidePhoneNavBar()
        }
        .task(id: "\(rows.count)-\(LocalDate.today(tz: tz))") {
            let key = "\(rows.count)-\(activities.count)-\(LocalDate.today(tz: tz))"
            if let hit = Self.cache, hit.key == key { findings = hit.value; return }
            let s = BodySample.merged(rows)
            let acts = activities.map { ActivitySample(type: $0.type, localDate: $0.localDate) }
            let tz = tz
            let value = await Task.detached(priority: .utility) { BodyInsights.compute(days: s, activities: acts, now: Date(), tz: tz) }.value
            Self.cache = (key, value)
            findings = value
        }
    }

    private static var healthLine: String {
        #if os(iOS)
        HealthSync.lastSync.map { "Apple Health synced \($0.formatted(.relative(presentation: .named)))" } ?? "Apple Health not connected yet"
        #else
        HealthSync.lastSync.map { "From your iPhone’s Apple Health, read \($0.formatted(.relative(presentation: .named)))" } ?? "Apple Health data arrives from your iPhone"
        #endif
    }

    private func healthBar(_ samples: [BodySample]) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "heart.fill").foregroundStyle(.pink)
            VStack(alignment: .leading, spacing: 2) {
                Text(Self.healthLine)
                    .font(.ui(13, weight: .medium)).foregroundStyle(Theme.ink)
                if let first = samples.first?.date {
                    Text("\(samples.count) days · history from \(DateText.dayMonthYear(first))").font(.ui(12)).foregroundStyle(Theme.faint)
                }
            }
            Spacer()
            #if os(iOS)
            Button(syncing ? "Syncing…" : HealthSync.lastSync == nil ? "Connect" : "Sync") { Task { await sync() } }
                .font(.ui(13, weight: .semibold)).disabled(syncing || !HealthSync.isAvailable)
            #endif
        }
        .padding(14).card()
    }

    private func sync() async {
        syncing = true
        do {
            try await HealthSync.requestAccess()
            let n = try await HealthSync.sync(ctx, tz: tz)
            toasts.show(n == 0 ? "Nothing new in Apple Health." : "Synced \(n) days from Apple Health.")
        } catch {
            toasts.error("Couldn’t read Apple Health.")
        }
        syncing = false
    }

    struct Slot: Identifiable {
        let date: String
        let day: BodySample?
        var id: String { date }
    }

    /// A dense date axis: a day nothing was recorded is present-but-empty, so
    /// the gap draws where it belongs.
    private func slots(_ samples: [BodySample]) -> [Slot] {
        let today = LocalDate.today(tz: tz)
        let from = LocalDate.shift(today, by: -(rangeDays - 1))
        let byDate = Dictionary(samples.map { ($0.date, $0) }, uniquingKeysWith: { a, _ in a })
        return LocalDate.range(from, today).map { Slot(date: $0, day: byDate[$0]) }
    }

    @ViewBuilder private func panels(_ slots: [Slot]) -> some View {
        let has = { (kp: KeyPath<BodySample, Double?>) in slots.contains { $0.day?[keyPath: kp] != nil } }
        if has(\.sleepMinutes) { SleepPanel(slots: slots) }
        if has(\.restingHr) { LinePanel(title: "Resting heart rate", hint: "The shaded band is your 14-day baseline — what matters is the gap between it and the line.", slots: slots, value: \.restingHr, unit: "bpm", color: Theme.accent) }
        if has(\.hrvNight) { LinePanel(title: "Overnight HRV", hint: "Heart-rate variability while you slept. Higher usually means better recovered.", slots: slots, value: \.hrvNight, unit: "ms", color: Theme.green) }
        if has(\.bodyBatteryHigh) { RangePanel(slots: slots) }
        if has(\.stressAvg) { LinePanel(title: "Average stress", hint: "Garmin’s all-day stress score, averaged — from your imported Garmin history (Apple Health has no equivalent).", slots: slots, value: \.stressAvg, unit: "", color: Theme.red, baseline: false, domain: 0...100) }
        if has(\.steps) { StepsPanel(slots: slots) }
    }
}

// MARK: - Panels

private struct PanelShell<Content: View>: View {
    let title: String
    let hint: String
    let latest: String?
    let average: String?
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.ui(15, weight: .semibold)).foregroundStyle(Theme.ink)
                    Text(hint).font(.ui(12)).foregroundStyle(Theme.faint)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 1) {
                    if let latest { Text(latest).font(.ui(18, weight: .semibold)).foregroundStyle(Theme.ink) }
                    if let average { Text("avg \(average)").font(.ui(10)).foregroundStyle(Theme.faint) }
                }
            }
            content.frame(height: 150)
        }
        .padding(16).card()
    }
}

private func hhmm(_ m: Double) -> String { "\(Int(m.rounded()) / 60)h \(String(format: "%02d", Int(m.rounded()) % 60))m" }

private func stats(_ xs: [Double]) -> (latest: Double?, mean: Double?) {
    (xs.last, xs.isEmpty ? nil : xs.reduce(0, +) / Double(xs.count))
}

private struct SleepPanel: View {
    let slots: [BodyView.Slot]

    var body: some View {
        let vals = slots.compactMap { $0.day?.sleepMinutes }
        let s = stats(vals)
        PanelShell(title: "Sleep", hint: "Total time asleep, split into deep, REM and the rest.", latest: s.latest.map(hhmm), average: s.mean.map(hhmm)) {
            Chart {
                ForEach(slots) { slot in
                    if let d = slot.day, let total = d.sleepMinutes {
                        let deep = d.deepMinutes ?? 0, rem = d.remMinutes ?? 0
                        BarMark(x: .value("Day", slot.date), y: .value("min", deep)).foregroundStyle(by: .value("Stage", "Deep"))
                        BarMark(x: .value("Day", slot.date), y: .value("min", rem)).foregroundStyle(by: .value("Stage", "REM"))
                        BarMark(x: .value("Day", slot.date), y: .value("min", max(0, total - deep - rem))).foregroundStyle(by: .value("Stage", "Light"))
                    }
                }
            }
            .chartForegroundStyleScale(["Deep": Color(hex: 0x64606E), "REM": Theme.amber, "Light": Theme.rest])
            .chartXAxis(.hidden)
            .chartYAxis { AxisMarks(values: [0, 240, 480]) { v in AxisGridLine(); AxisValueLabel { if let m = v.as(Double.self) { Text("\(Int(m) / 60)h") } } } }
            .chartLegend(position: .bottom, spacing: 4)
        }
    }
}

private struct LinePanel: View {
    let title: String
    let hint: String
    let slots: [BodyView.Slot]
    let value: KeyPath<BodySample, Double?>
    let unit: String
    let color: Color
    var baseline = true
    var domain: ClosedRange<Double>?

    /// Trailing 14-day mean, once at least 5 days of the window are filled.
    private var baselineSeries: [(String, Double)] {
        guard baseline else { return [] }
        return slots.indices.compactMap { i in
            let window = slots[max(0, i - 13)...i].compactMap { $0.day?[keyPath: value] }
            guard window.count >= 5 else { return nil }
            return (slots[i].date, window.reduce(0, +) / Double(window.count))
        }
    }

    var body: some View {
        let vals = slots.compactMap { $0.day?[keyPath: value] }
        let s = stats(vals)
        let fmt = { (v: Double) in "\(Int(v.rounded()))\(unit.isEmpty ? "" : " \(unit)")" }
        PanelShell(title: title, hint: hint, latest: s.latest.map(fmt), average: s.mean.map(fmt)) {
            Chart {
                ForEach(baselineSeries, id: \.0) { date, v in
                    LineMark(x: .value("Day", date), y: .value("base", v), series: .value("s", "baseline"))
                        .foregroundStyle(color.opacity(0.22)).lineStyle(StrokeStyle(lineWidth: 7, lineCap: .round))
                }
                ForEach(slots) { slot in
                    if let v = slot.day?[keyPath: value] {
                        LineMark(x: .value("Day", slot.date), y: .value(title, v), series: .value("s", "value"))
                            .foregroundStyle(color).lineStyle(StrokeStyle(lineWidth: 1.8))
                        if slots.count <= 31 { PointMark(x: .value("Day", slot.date), y: .value(title, v)).foregroundStyle(color).symbolSize(14) }
                    }
                }
            }
            .chartXAxis(.hidden)
            .chartYScale(domain: domain ?? ((vals.min() ?? 0) - 3)...((vals.max() ?? 1) + 3))
        }
    }
}

private struct RangePanel: View {
    let slots: [BodyView.Slot]

    var body: some View {
        let highs = slots.compactMap { $0.day?.bodyBatteryHigh }
        let s = stats(highs)
        PanelShell(title: "Body Battery", hint: "Each bar spans the day’s low to its high — from your imported Garmin history (Apple Health has no equivalent).",
                   latest: s.latest.map { "\(Int($0))" }, average: s.mean.map { "\(Int($0.rounded()))" }) {
            Chart(slots) { slot in
                if let hi = slot.day?.bodyBatteryHigh {
                    BarMark(x: .value("Day", slot.date), yStart: .value("Low", slot.day?.bodyBatteryLow ?? hi), yEnd: .value("High", hi))
                        .foregroundStyle(Theme.amber.opacity(0.8)).cornerRadius(2)
                }
            }
            .chartXAxis(.hidden)
            .chartYScale(domain: 0...100)
        }
    }
}

private struct StepsPanel: View {
    let slots: [BodyView.Slot]

    var body: some View {
        let vals = slots.compactMap { $0.day?.steps }
        let s = stats(vals)
        let fmt = { (v: Double) in Int(v.rounded()).formatted() }
        PanelShell(title: "Steps", hint: "Every day you carried a phone or watch.", latest: s.latest.map(fmt), average: s.mean.map(fmt)) {
            Chart(slots) { slot in
                if let v = slot.day?.steps { BarMark(x: .value("Day", slot.date), y: .value("Steps", v)).foregroundStyle(Theme.accent.opacity(0.85)).cornerRadius(2) }
            }
            .chartXAxis(.hidden)
        }
    }
}

// MARK: - Momentum's body series

/// The third measured series on Momentum — the only one recorded by something
/// other than your own judgement. Renders nothing when there's no body data.
struct WearableSeriesView: View {
    @Query(sort: \BodyDay.date) private var rows: [BodyDay]
    @Query private var profiles: [Profile]

    var body: some View {
        let tz = profiles.first?.timezone ?? TimeZone.current.identifier
        let samples = BodySample.merged(rows)
        let today = LocalDate.today(tz: tz)
        let from = LocalDate.shift(today, by: -89)
        let byDate = Dictionary(samples.map { ($0.date, $0) }, uniquingKeysWith: { a, _ in a })
        let slots = LocalDate.range(from, today).map { BodyView.Slot(date: $0, day: byDate[$0]) }
        if slots.contains(where: { $0.day != nil }) {
            VStack(alignment: .leading, spacing: 10) {
                Text("What your body recorded, last 90 days").font(.ui(14, weight: .medium)).foregroundStyle(Theme.ink)
                if slots.contains(where: { $0.day?.sleepMinutes != nil }) { SleepPanel(slots: slots) }
                if slots.contains(where: { $0.day?.restingHr != nil }) {
                    LinePanel(title: "Resting heart rate", hint: "Against your 14-day baseline.", slots: slots, value: \.restingHr, unit: "bpm", color: Theme.accent)
                }
                if slots.contains(where: { $0.day?.hrvNight != nil }) {
                    LinePanel(title: "Overnight HRV", hint: "Higher usually means better recovered.", slots: slots, value: \.hrvNight, unit: "ms", color: Theme.green)
                }
            }
        }
    }
}

// MARK: - Findings

struct FindingsPanel: View {
    let result: (days: Int, findings: [Finding])?

    private static let groups = [
        ("sleep_regularity", "When you sleep"), ("activity_impact", "What your sessions cost"),
        ("baseline_shift", "Things that shifted"), ("weekday", "Your week has a shape"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("What the record shows", systemImage: "sparkle.magnifyingglass").font(.ui(13, weight: .semibold)).foregroundStyle(Theme.ink2)
            if let result {
                if result.findings.isEmpty {
                    Text(result.days < BodyInsights.minDays ? "Needs at least \(BodyInsights.minDays) days of data before it will say anything." : "Nothing stands out yet.")
                        .font(.ui(14)).foregroundStyle(Theme.ink2)
                }
                ForEach(Self.groups, id: \.0) { kind, title in
                    let fs = result.findings.filter { $0.kind == kind }
                    if !fs.isEmpty {
                        Eyebrow(title)
                        ForEach(fs) { f in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(f.headline).font(.ui(15, weight: .medium)).foregroundStyle(Theme.ink)
                                Text(f.detail).font(.ui(13)).foregroundStyle(Theme.ink2)
                                if let p = f.pValue { Text("p = \(Stats.toFixed(p, 3)) · tested, then corrected for how many things were tested").font(.ui(10)).foregroundStyle(Theme.faint) }
                            }
                        }
                    }
                }
                Text("Every pattern here passed a permutation test with a false-discovery correction. They are associations in your own data, not diagnoses.")
                    .font(.ui(11)).foregroundStyle(Theme.faint)
            } else {
                HStack { ProgressView(); Text("Reading a year of data…").font(.ui(13)).foregroundStyle(Theme.faint) }
            }
        }
        .padding(18).card()
    }
}

// MARK: - Settings card

struct HealthSettingsCard: View {
    @Environment(\.modelContext) private var ctx
    @Environment(Toasts.self) private var toasts
    @Query private var profiles: [Profile]
    @Query private var rows: [BodyDay]
    @State private var syncing = false

    var body: some View {
        Section {
            LabeledContent("Days recorded", value: "\(Set(rows.map(\.date)).count)")
            if let last = HealthSync.lastSync {
                LabeledContent("Last synced", value: last.formatted(.relative(presentation: .named)))
            }
#if os(iOS)
                        Button(syncing ? "Syncing…" : HealthSync.lastSync == nil ? "Connect Apple Health" : "Sync now", systemImage: "heart") {
                syncing = true
                Task {
                    do {
                        try await HealthSync.requestAccess()
                        let n = try await HealthSync.sync(ctx, tz: profiles.first?.timezone ?? TimeZone.current.identifier)
                        toasts.show("Synced \(n) days from Apple Health.")
                    } catch { toasts.error("Couldn’t read Apple Health.") }
                    syncing = false
                }
            }
            .disabled(syncing || !HealthSync.isAvailable)
            #endif
        } header: {
            Text("Apple Health")
        } footer: {
            #if os(iOS)
            Text("Sleep, resting heart rate, HRV, steps and workouts — from an Apple Watch, Garmin Connect or any app that writes to Health. Your imported Garmin history stays; Body Battery and stress have no Health equivalent.")
            #else
            Text("A Mac has no Apple Health. Your iPhone reads it and the numbers arrive here through iCloud.")
            #endif
        }
    }
}

// MARK: - Habit effect

/// "Is this habit actually doing anything?" — a port of HabitEffectCard.tsx.
/// Renders the analysis's own sentence verbatim; it does the hedging.
struct HabitEffectCard: View {
    let habit: Habit

    @Environment(\.modelContext) private var ctx
    @Query private var rows: [BodyDay]
    @Query private var profiles: [Profile]
    @State private var results: [EffectResult] = []
    @State private var adding = false

    private var links: [HabitMetricLink] { (habit.metricLinks ?? []).sorted { $0.createdAt < $1.createdAt } }
    private var tz: String { profiles.first?.timezone ?? TimeZone.current.identifier }

    var body: some View {
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Eyebrow("Does it show up in your body?")
                    Spacer()
                    Menu {
                        ForEach(BodyMetric.allCases.filter { m in !links.contains { $0.metric == m.rawValue } }) { m in
                            Menu(m.label) {
                                Button("The same day") { link(m, lag: 0) }
                                Button("The day after") { link(m, lag: 1) }
                            }
                        }
                    } label: { Image(systemName: "plus.circle").font(.ui(15)) }
                    .foregroundStyle(Theme.faint)
                    .accessibilityLabel("Track a body metric against this habit")
                }
                if links.isEmpty {
                    Text("Compare the days you did this against the days you didn’t.").font(.ui(12)).foregroundStyle(Theme.faint)
                }
                ForEach(results) { r in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: r.verdict == .insufficient ? "hourglass" : r.verdict == .noEffect ? "minus" : (r.difference < 0 ? "arrow.down.right" : "arrow.up.right"))
                            .font(.ui(12, weight: .semibold))
                            .foregroundStyle(r.verdict == .associated ? (r.improved == true ? Theme.green : Theme.amber) : Theme.faint)
                            .frame(width: 16).padding(.top, 2)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(r.metric.label + (r.lagDays == 1 ? " · next day" : "")).font(.ui(13, weight: .medium)).foregroundStyle(Theme.ink)
                            Text(r.sentence).font(.ui(12.5)).foregroundStyle(Theme.ink2)
                            if r.verdict != .insufficient {
                                Text("\(r.hit.n) days you did it vs \(r.miss.n) you didn’t · p=\(Stats.toFixed(r.pValue, 3))").font(.ui(10)).foregroundStyle(Theme.faint)
                            }
                        }
                        Spacer(minLength: 0)
                        Button { unlink(r.metric) } label: { Image(systemName: "xmark").font(.ui(10)) }
                            .foregroundStyle(Theme.faint).accessibilityLabel("Stop tracking \(r.metric.label)")
                    }
                }
            }
            .padding(.top, 4)
            .task(id: links.map { "\($0.metric)\($0.lagDays)" }.joined() + "\(rows.count)\(habit.logs?.count ?? 0)") { await compute() }
        }
    }

    private func compute() async {
        let snap = HabitSnapshot(habit, tz: tz)
        let specs = links.compactMap { l in BodyMetric(rawValue: l.metric).map { ($0, l.lagDays) } }
        let days = BodySample.merged(rows)
        let tz = tz
        results = await Task.detached(priority: .utility) {
            HabitEffect.effects(snap, links: specs.map { (metric: $0.0, lagDays: $0.1) }, days: days, now: Date(), tz: tz)
        }.value
    }

    private func link(_ m: BodyMetric, lag: Int) {
        let l = links.first { $0.metric == m.rawValue } ?? {
            let n = HabitMetricLink()
            ctx.insert(n)
            n.habit = habit
            n.metric = m.rawValue
            return n
        }()
        l.lagDays = lag
        // Direction comes from the metric, never from a choice.
        l.direction = m.lowerIsBetter ? "lower_better" : "higher_better"
        try? ctx.save()
    }

    private func unlink(_ m: BodyMetric) {
        for l in links where l.metric == m.rawValue { ctx.delete(l) }
        try? ctx.save()
    }
}

// MARK: - The body's contribution to the insights prompt

enum BodyAI {
    /// A port of buildWearableBlock in routes/ai.ts: descriptive numbers, plus
    /// the only relationships the model may state — ones that passed a test.
    nonisolated static func wearableBlock(habits: [HabitSnapshot], links: [(habit: HabitSnapshot, metric: BodyMetric, lagDays: Int)],
                                          days all: [BodySample], now: Date, tz: String) -> String {
        let today = LocalDate.of(now, tz: tz)
        let day30 = LocalDate.of(now.addingTimeInterval(-30 * 86_400), tz: tz)
        let day90 = LocalDate.of(now.addingTimeInterval(-90 * 86_400), tz: tz)
        let days = all.filter { $0.date >= day90 && $0.date <= today }
        guard days.count >= 14 else { return "" }

        let recent = days.filter { $0.date >= day30 }
        var lines: [String] = []
        for k in [BodyMetric.sleepMinutes, .restingHr, .hrvNight, .bodyBatteryHigh, .stressAvg] {
            let r = recent.compactMap { $0[k] }, a = days.compactMap { $0[k] }
            guard !r.isEmpty, !a.isEmpty else { continue }
            let fmt = { (v: Double) in
                k == .sleepMinutes
                    ? "\(Int((v / 60).rounded(.down)))h \(String(format: "%02d", Int(Stats.jsRound(v.truncatingRemainder(dividingBy: 60)))))m"
                    : Stats.toFixed(v, k.precision)
            }
            lines.append("- \(k.label): \(fmt(Stats.median(r))) typical over the last 30 days (\(fmt(Stats.median(a))) over 90).")
        }

        var verdicts = HabitEffect.missPredictors(habits, days: all, now: now, tz: tz).filter { $0.verdict != .insufficient }.map { "- \($0.sentence)" }
        var order: [String] = []
        var byHabit: [String: (HabitSnapshot, [(metric: BodyMetric, lagDays: Int)])] = [:]
        for l in links {
            if byHabit[l.habit.uid] == nil { order.append(l.habit.uid); byHabit[l.habit.uid] = (l.habit, []) }
            byHabit[l.habit.uid]!.1.append((l.metric, l.lagDays))
        }
        for uid in order {
            let (h, specs) = byHabit[uid]!
            for r in HabitEffect.effects(h, links: specs, days: all, now: now, tz: tz) where r.verdict != .insufficient {
                verdicts.append("- \"\(h.title)\" vs \(r.metric.label): \(r.sentence)")
            }
        }

        return [
            "Wearable data, \(days.count) days recorded (descriptive only — do NOT infer relationships from these numbers):",
            lines.joined(separator: "\n"),
            verdicts.isEmpty
                ? "No relationship has been statistically tested yet."
                : "Tested findings (these HAVE been statistically checked — the only relationships you may state):\n\(verdicts.joined(separator: "\n"))",
        ].filter { !$0.isEmpty }.joined(separator: "\n\n")
    }

    @MainActor static func inputs(_ habits: [Habit], rows: [BodyDay], tz: String) -> ([HabitSnapshot], [(habit: HabitSnapshot, metric: BodyMetric, lagDays: Int)], [BodySample]) {
        let live = habits.filter { $0.archivedAt == nil }.sorted { $0.createdAt < $1.createdAt }
        let snaps = Dictionary(uniqueKeysWithValues: live.map { ($0.uid, HabitSnapshot($0, tz: tz)) })
        let links = live.flatMap { h in (h.metricLinks ?? []).sorted { $0.createdAt < $1.createdAt }.compactMap { l in
            BodyMetric(rawValue: l.metric).map { (habit: snaps[h.uid]!, metric: $0, lagDays: l.lagDays) }
        } }
        return (live.map { snaps[$0.uid]! }, links, BodySample.merged(rows))
    }

    @MainActor static func wearableBlockFromStore(now: Date, tz: String) -> String {
        guard let ctx = ModelContextHolder.main else { return "" }
        let habits = (try? ctx.fetch(FetchDescriptor<Habit>())) ?? []
        let rows = (try? ctx.fetch(FetchDescriptor<BodyDay>())) ?? []
        let (h, l, d) = inputs(habits, rows: rows, tz: tz)
        return wearableBlock(habits: h, links: l, days: d, now: now, tz: tz)
    }
}

/// The app's main context, for the few non-view callers that need it.
enum ModelContextHolder {
    @MainActor static var main: ModelContext?
}
