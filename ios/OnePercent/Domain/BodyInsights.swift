import Foundation

// What the watch has the data for but doesn't tell you — a port of
// server/src/lib/bodyInsights.ts. Works from body data alone, no habits needed.
//
// Same honesty rules as HabitEffect, plus a false-discovery correction: these
// scans test many things at once, and at p<0.05 a couple will look real from
// noise alone.

nonisolated struct Finding: Identifiable, Equatable {
    /// "sleep_regularity" | "activity_impact" | "weekday" | "baseline_shift"
    let kind: String
    let headline: String
    let detail: String
    let pValue: Double?
    let metric: BodyMetric?

    var id: String { kind + headline }
}

nonisolated struct ActivitySample: Sendable {
    let type: String
    let localDate: String
}

nonisolated enum BodyInsights {
    static let minDays = 20
    static let fdrQ = 0.10
    static let scanIterations = 2_500
    static let analysed: [BodyMetric] = [.sleepMinutes, .restingHr, .hrvNight, .bodyBatteryHigh, .stressAvg]

    nonisolated private static func fmtClock(_ minsOfDay: Double) -> String {
        let m = ((Int(Stats.jsRound(minsOfDay)) % 1440) + 1440) % 1440
        return String(format: "%02d:%02d", m / 60, m % 60)
    }

    nonisolated static func fmtMetric(_ k: BodyMetric, _ v: Double) -> String {
        if k == .sleepMinutes {
            let a = abs(v)
            return "\(Int((a / 60).rounded(.down)))h \(String(format: "%02d", Int(Stats.jsRound(a.truncatingRemainder(dividingBy: 60)))))m"
        }
        return Stats.toFixed(abs(v), k.precision)
    }

    // 1. When you fall asleep — the part of sleep you actually choose.
    nonisolated static func sleepRegularity(_ days: [BodySample]) -> [Finding] {
        let fractions = days.compactMap(\.sleepStartMin).filter(\.isFinite).map { $0 / 1440 }
        guard fractions.count >= minDays, let c = Stats.circularStats(fractions) else { return [] }
        let sd = Stats.circularSdMinutes(c.resultant)
        let verdict = sd <= 30 ? "tight — most nights land within half an hour of each other"
            : sd <= 50 ? "reasonably steady"
            : sd <= 75 ? "drifting by more than an hour either way"
            : "very scattered"
        return [Finding(
            kind: "sleep_regularity",
            headline: "You fall asleep around \(fmtClock(c.meanFraction * 1440)), give or take \(Int(Stats.jsRound(sd))) minutes",
            detail: "Across \(fractions.count) nights that spread is \(verdict). Garmin scores how long and how deeply you slept but never when you started — and the start is the part you actually choose.",
            pValue: nil, metric: nil
        )]
    }

    // 2. What each kind of session costs your body, one and two days later.
    nonisolated static func activityImpact(_ days: [BodySample], _ activities: [ActivitySample]) -> [Finding] {
        let byDate = Dictionary(days.map { ($0.date, $0) }, uniquingKeysWith: { a, _ in a })
        let allDates = days.map(\.date).sorted()
        var typeOrder: [String] = []
        var types: [String: [String]] = [:]
        for a in activities {
            if types[a.type] == nil { typeOrder.append(a.type) }
            types[a.type, default: []].append(a.localDate)
        }
        let anyActivity = Set(activities.map(\.localDate))

        struct Candidate { let type: String; let metric: BodyMetric; let lag: Int; let after: [Double]; let rest: [Double] }
        var candidates: [Candidate] = []
        for type in typeOrder {
            let dates = types[type]!
            guard dates.count >= 8 else { continue }
            let sessions = Set(dates)
            for lag in [1, 2] {
                let afterDates = Set(dates.map { LocalDate.shift($0, by: lag) })
                for metric in [BodyMetric.hrvNight, .restingHr, .bodyBatteryHigh, .sleepMinutes] {
                    var after: [Double] = [], rest: [Double] = []
                    for date in allDates {
                        guard let v = byDate[date]?[metric], v.isFinite else { continue }
                        if afterDates.contains(date) { after.append(v); continue }
                        let clean = !anyActivity.contains(date) && !anyActivity.contains(LocalDate.shift(date, by: -1))
                            && !anyActivity.contains(LocalDate.shift(date, by: -2)) && !sessions.contains(date)
                        if clean { rest.append(v) }
                    }
                    if after.count >= 8 && rest.count >= 8 { candidates.append(Candidate(type: type, metric: metric, lag: lag, after: after, rest: rest)) }
                }
            }
        }
        guard !candidates.isEmpty else { return [] }
        let ps = candidates.map { Stats.permutationTest($0.after, $0.rest, seed: 12345, iterations: scanIterations) }
        let qs = Stats.benjaminiHochberg(ps)
        return candidates.enumerated().compactMap { i, c in
            guard qs[i] < fdrQ else { return nil }
            let diff = Stats.median(c.after) - Stats.median(c.rest)
            let better = c.metric.lowerIsBetter ? diff < 0 : diff > 0
            return Finding(
                kind: "activity_impact",
                headline: "\(c.lag == 1 ? "The day after" : "Two days after") \(c.type.replacingOccurrences(of: "_", with: " ")), your \(c.metric.inline) is \(fmtMetric(c.metric, diff)) \(diff < 0 ? "lower" : "higher")",
                detail: "Compared with days that had no session in the previous 48 hours (\(c.after.count) vs \(c.rest.count) days). "
                    + (better ? "That is the direction you would want." : "That is the cost of the session — worth knowing when you plan the next one."),
                pValue: ps[i], metric: c.metric
            )
        }
    }

    // 3. "Your worst sleep is Friday, every Friday."
    nonisolated static func weekdayPatterns(_ days: [BodySample]) -> [Finding] {
        let names = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"]
        struct Candidate { let metric: BodyMetric; let wd: Int; let on: [Double]; let off: [Double] }
        var candidates: [Candidate] = []
        for metric in analysed {
            for wd in 0..<7 {
                var on: [Double] = [], off: [Double] = []
                for d in days {
                    guard let v = d[metric], v.isFinite else { continue }
                    if LocalDate.weekday(d.date) == wd { on.append(v) } else { off.append(v) }
                }
                if on.count >= 8 && off.count >= minDays { candidates.append(Candidate(metric: metric, wd: wd, on: on, off: off)) }
            }
        }
        guard !candidates.isEmpty else { return [] }
        let ps = candidates.map { Stats.permutationTest($0.on, $0.off, seed: 12345, iterations: scanIterations) }
        let qs = Stats.benjaminiHochberg(ps)
        return candidates.enumerated().compactMap { i, c in
            guard qs[i] < fdrQ else { return nil }
            let diff = Stats.median(c.on) - Stats.median(c.off)
            return Finding(
                kind: "weekday",
                headline: "\(names[c.wd]) are different: \(c.metric.inline) runs \(fmtMetric(c.metric, diff)) \(diff < 0 ? "lower" : "higher")",
                detail: "Across \(c.on.count) \(names[c.wd].lowercased()) against \(c.off.count) other days. A weekly rhythm is usually something in your calendar rather than something in your body.",
                pValue: ps[i], metric: c.metric
            )
        }
    }

    // 4. "Your resting heart rate stepped up in mid-June and never came back."
    // The null is the same max-over-all-splits statistic on shuffled data, so
    // searching for the biggest split is priced into the p-value.
    nonisolated static func baselineShifts(_ days: [BodySample], seed: Int = 4242) -> [Finding] {
        let minSegment = 21
        var out: [Finding] = []
        for metric in [BodyMetric.restingHr, .hrvNight] {
            let series = days.compactMap { d in d[metric].flatMap { $0.isFinite ? (d.date, $0) : nil } }
            guard series.count >= minSegment * 2 + 10 else { continue }
            let values = series.map(\.1)

            func bestSplit(_ xs: [Double]) -> (idx: Int, stat: Double) {
                var best = (idx: -1, stat: -1.0)
                guard xs.count - minSegment >= minSegment else { return best }
                for i in minSegment...(xs.count - minSegment) {
                    let stat = abs(Stats.median(xs[..<i]) - Stats.median(xs[i...]))
                    if stat > best.stat { best = (i, stat) }
                }
                return best
            }

            let observed = bestSplit(values)
            guard observed.idx >= 0 else { continue }
            var rand = Stats.Mulberry32(seed)
            let iterations = 400
            var buf = values
            var atLeast = 0
            for _ in 0..<iterations {
                var i = buf.count - 1
                while i > 0 {
                    buf.swapAt(i, Int(rand.next() * Double(i + 1)))
                    i -= 1
                }
                if bestSplit(buf).stat >= observed.stat { atLeast += 1 }
            }
            let p = Double(atLeast + 1) / Double(iterations + 1)
            guard p < 0.05 else { continue }

            let before = Stats.median(values[..<observed.idx]), after = Stats.median(values[observed.idx...])
            let rose = after > before
            let better = metric.lowerIsBetter ? !rose : rose
            out.append(Finding(
                kind: "baseline_shift",
                headline: "Your \(metric.inline) baseline \(rose ? "stepped up" : "stepped down") around \(DateText.formatted(series[observed.idx].0, "d MMMM"))",
                detail: "\(fmtMetric(metric, before)) before, \(fmtMetric(metric, after)) after — and it has not gone back. "
                    + (better ? "Whatever changed then is worth keeping." : "Something changed around then. Only you know what; the data just knows when."),
                pValue: p, metric: metric
            ))
        }
        return out
    }

    /// Everything, over the last year.
    nonisolated static func compute(days all: [BodySample], activities: [ActivitySample], now: Date, tz: String, windowDays: Int = 365) -> (days: Int, findings: [Finding]) {
        let today = LocalDate.of(now, tz: tz)
        let from = LocalDate.of(now.addingTimeInterval(-Double(windowDays) * 86_400), tz: tz)
        let days = all.filter { $0.date >= from && $0.date <= today }
        let acts = activities.filter { $0.localDate >= from && $0.localDate <= today }
        guard days.count >= minDays else { return (days.count, []) }
        return (days.count, sleepRegularity(days) + activityImpact(days, acts) + weekdayPatterns(days) + baselineShifts(days))
    }
}
