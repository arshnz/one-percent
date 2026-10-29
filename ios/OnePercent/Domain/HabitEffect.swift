import Foundation

// "Does this habit move this number?" — a port of server/src/lib/habitEffect.ts.
//
// The easiest thing in the app to get dishonestly wrong, so three rules hold:
// a minimum sample in BOTH groups or no answer at all; a permutation test, not
// a raw difference; and every result worded as an ASSOCIATION — you train on
// days you already feel good, and the data fits that reading just as well.

nonisolated enum Verdict: String { case insufficient, noEffect = "no_effect", associated }

nonisolated struct EffectResult: Identifiable {
    let metric: BodyMetric
    let lagDays: Int
    let windowDays: Int
    let hit: (n: Int, median: Double)
    let miss: (n: Int, median: Double)
    /// hit − miss, raw sign.
    let difference: Double
    let pValue: Double
    let verdict: Verdict
    /// True when the difference runs the way you'd want; nil if undecided.
    let improved: Bool?
    let needMoreDays: Int?
    /// Already correctly hedged — render it verbatim.
    let sentence: String

    var id: String { metric.rawValue }
}

nonisolated struct MissPredictor {
    let metric: BodyMetric
    let hitDays: (n: Int, median: Double)
    let missDays: (n: Int, median: Double)
    let difference: Double
    let pValue: Double
    let verdict: Verdict
    let sentence: String
}

/// What the analyses need from a habit, copied off the model so the work can
/// run off the main thread.
nonisolated struct HabitSnapshot: Sendable {
    let uid: String
    let title: String
    let schedule: Schedule
    let bounds: ScheduleBounds
    let createdOn: String
    /// date → status
    let logs: [String: String]

    @MainActor init(_ h: Habit, tz: String) {
        uid = h.uid
        title = h.title
        schedule = Schedule(h)
        bounds = ScheduleBounds(h, tz: tz)
        createdOn = LocalDate.of(h.createdAt, tz: tz)
        logs = Dictionary((h.logs ?? []).map { ($0.date, $0.status) }, uniquingKeysWith: { a, _ in a })
    }

    nonisolated var hitDates: Set<String> { Set(logs.filter { $0.value == "target" || $0.value == "failsafe" }.keys) }
}


nonisolated enum HabitEffect {
    static let defaultWindow = 90
    static let minPerGroup = 10

    nonisolated static func effects(
        _ h: HabitSnapshot, links: [(metric: BodyMetric, lagDays: Int)], days: [BodySample],
        now: Date, tz: String, windowDays: Int = defaultWindow
    ) -> [EffectResult] {
        guard !links.isEmpty else { return [] }
        let today = LocalDate.of(now, tz: tz)
        let from = LocalDate.of(now.addingTimeInterval(-Double(windowDays - 1) * 86_400), tz: tz)
        let hits = Set(h.logs.filter { $0.key >= from && $0.key <= today && ($0.value == "target" || $0.value == "failsafe") }.keys)
        let scheduled = ScheduleResolver.resolveRange(h.schedule, from: max(from, h.createdOn), to: today, hitDates: hits, bounds: h.bounds)
            .filter { $0.scheduled && $0.date < today }  // today can still be logged
            .map(\.date)
        let byDate = Dictionary(days.map { ($0.date, $0) }, uniquingKeysWith: { a, _ in a })

        return links.map { link in
            var hit: [Double] = [], miss: [Double] = []
            for date in scheduled {
                guard let v = byDate[LocalDate.shift(date, by: link.lagDays)]?[link.metric], v.isFinite else { continue }
                if hits.contains(date) { hit.append(v) } else { miss.append(v) }
            }
            return summarise(link.metric, link.lagDays, hit, miss, windowDays)
        }
    }

    nonisolated private static func summarise(_ metric: BodyMetric, _ lag: Int, _ hit: [Double], _ miss: [Double], _ windowDays: Int) -> EffectResult {
        let hm = (hit.count, Stats.median(hit)), mm = (miss.count, Stats.median(miss))
        if hit.count < minPerGroup || miss.count < minPerGroup {
            return EffectResult(
                metric: metric, lagDays: lag, windowDays: windowDays, hit: hm, miss: mm, difference: 0, pValue: 1,
                verdict: .insufficient, improved: nil, needMoreDays: max(minPerGroup - hit.count, minPerGroup - miss.count),
                sentence: hit.count < minPerGroup
                    ? "Not enough reps yet to compare — about \(minPerGroup - hit.count) more days doing this would make it answerable."
                    : "Not enough missed days to compare against. That is a good problem to have."
            )
        }
        let difference = hm.1 - mm.1
        let p = Stats.permutationTest(hit, miss)
        let improved = metric.lowerIsBetter ? difference < 0 : difference > 0
        let size = Stats.toFixed(abs(difference), metric.precision)
        let unit = metric.unit.isEmpty ? "" : " \(metric.unit)"
        let when = lag == 0 ? "on days you did this" : "the day after you did this"
        if p >= 0.05 {
            return EffectResult(
                metric: metric, lagDays: lag, windowDays: windowDays, hit: hm, miss: mm, difference: difference, pValue: p,
                verdict: .noEffect, improved: nil, needMoreDays: nil,
                sentence: "No clear difference yet. Over \(windowDays) days, \(metric.inline) \(when) was within the range of ordinary variation."
            )
        }
        return EffectResult(
            metric: metric, lagDays: lag, windowDays: windowDays, hit: hm, miss: mm, difference: difference, pValue: p,
            verdict: .associated, improved: improved, needMoreDays: nil,
            sentence: "\(when.prefix(1).uppercased())\(when.dropFirst()), your \(metric.inline) was \(size)\(unit) \(difference < 0 ? "lower" : "higher") — bigger than chance would usually produce over \(windowDays) days. That is an association, not proof the habit caused it."
        )
    }

    /// The other direction: does how your body was predict whether you showed
    /// up? Day-level across every live habit — a day is "kept" only if every
    /// habit it asked for was done.
    nonisolated static func missPredictors(_ habits: [HabitSnapshot], days: [BodySample], now: Date, tz: String, windowDays: Int = defaultWindow) -> [MissPredictor] {
        guard !habits.isEmpty else { return [] }
        let today = LocalDate.of(now, tz: tz)
        let from = LocalDate.of(now.addingTimeInterval(-Double(windowDays - 1) * 86_400), tz: tz)
        var asked: [String: Int] = [:], kept: [String: Int] = [:]
        var askedOrder: [String] = []
        for h in habits {
            let hits = Set(h.logs.filter { $0.key >= from && $0.key <= today && ($0.value == "target" || $0.value == "failsafe") }.keys)
            for d in ScheduleResolver.resolveRange(h.schedule, from: max(from, h.createdOn), to: today, hitDates: hits, bounds: h.bounds)
            where d.scheduled && d.date < today {
                if asked[d.date] == nil { askedOrder.append(d.date) }
                asked[d.date, default: 0] += 1
                if hits.contains(d.date) { kept[d.date, default: 0] += 1 }
            }
        }
        let byDate = Dictionary(days.filter { $0.date >= from && $0.date <= today }.map { ($0.date, $0) }, uniquingKeysWith: { a, _ in a })

        return [BodyMetric.sleepMinutes, .bodyBatteryHigh, .hrvNight].map { metric in
            var hit: [Double] = [], miss: [Double] = []
            for date in askedOrder {
                guard let v = byDate[date]?[metric], v.isFinite else { continue }
                if (kept[date] ?? 0) >= asked[date]! { hit.append(v) } else { miss.append(v) }
            }
            let hm = (hit.count, Stats.median(hit)), mm = (miss.count, Stats.median(miss))
            if hit.count < minPerGroup || miss.count < minPerGroup {
                return MissPredictor(metric: metric, hitDays: hm, missDays: mm, difference: 0, pValue: 1, verdict: .insufficient,
                                     sentence: "Not enough of both kinds of day yet to compare \(metric.inline).")
            }
            let difference = mm.1 - hm.1
            let p = Stats.permutationTest(hit, miss)
            let size = Stats.toFixed(abs(difference), metric.precision)
            let unit = metric.unit.isEmpty ? "" : " \(metric.unit)"
            return MissPredictor(
                metric: metric, hitDays: hm, missDays: mm, difference: difference, pValue: p,
                verdict: p < 0.05 ? .associated : .noEffect,
                sentence: p < 0.05
                    ? "On days you missed something, your \(metric.inline) was \(size)\(unit) \(difference < 0 ? "lower" : "higher") than on days you kept everything — bigger than chance would usually produce. Which way the causation runs is not something this can tell you."
                    : "No clear difference in \(metric.inline) between the days you kept everything and the days you missed something."
            )
        }
    }
}
