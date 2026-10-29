import Foundation

// The compound curve: 1% better per DAY. A port of client/src/lib/compound.ts.
//
// The exponent is days, not reps. A day where you hit everything scheduled is a
// full 1%; hit half your habits and it's half a percent — so the number means
// the same thing whether you track one habit or six. A perfect year is
// 1.01^365 = 37.8×.
//
// A miss doesn't subtract, it just doesn't add. That's deliberate and
// load-bearing: this app rejects clawback ("No streaks, ever"). A curve that
// dropped on a miss would argue the opposite of the product.
//
// This pictures compounding. It does not measure the person.
enum Compound {
    static let rate = 0.01

    static func multiplier(_ progressDays: Double) -> Double { pow(1 + rate, progressDays) }

    struct Point: Equatable {
        let date: String
        let value: Double
    }

    struct Series {
        /// Calendar days from the first scheduled day to today.
        let actual: [Point]
        /// What the curve would read if every scheduled day had been hit.
        let ceiling: [Point]
        /// The exponent behind today's multiplier — full days' worth of progress.
        let progressDays: Double
        /// Days that asked something of you (excludes rest days and paused stretches).
        let activeDays: Int
    }

    struct GridCell {
        let date: String
        let count: Int
        let scheduled: Bool
    }

    /// The minimum a habit needs to feed the curve — active or archived alike.
    struct CurveHabit {
        let contributions: [GridCell]
        let createdAt: Date?
        let pausedAt: Date?
        /// Set once a habit is deleted/retired — its history stays, frozen here.
        let archivedAt: Date?
    }

    // The web app cut these instants to a date with `iso.slice(0, 10)`, which is
    // the UTC date, not the local one. Kept identical so the curve matches what
    // the web app showed to the decimal; see the note in the iOS README.
    private static func utcDay(_ d: Date?) -> String? { d.map { LocalDate.of($0, tz: "UTC") } }

    /// Roll the per-habit grids into one daily progress fraction. Rest days and
    /// paused stretches are skipped, not zeroed. Archived habits stay in, frozen
    /// at the archive date — deleting a habit must not erase evidence you banked.
    static func progressSeries(_ habits: [CurveHabit]) -> Series {
        var byDate: [String: (hit: Int, scheduled: Int)] = [:]

        for h in habits {
            let pausedOn = utcDay(h.pausedAt)
            let createdOn = utcDay(h.createdAt)
            let archivedOn = utcDay(h.archivedAt)
            for c in h.contributions where c.scheduled {
                if let createdOn, c.date < createdOn { continue }
                if let archivedOn, c.date >= archivedOn { continue }
                if let pausedOn, c.date >= pausedOn { continue }
                var day = byDate[c.date] ?? (0, 0)
                day.scheduled += 1
                if c.count > 0 { day.hit += 1 }
                byDate[c.date] = day
            }
        }

        guard !byDate.isEmpty else { return Series(actual: [], ceiling: [], progressDays: 0, activeDays: 0) }

        // Walk the calendar rather than only the active days, so the x-axis stays
        // linear in time and a fallow stretch reads as the flat line it was.
        let active = byDate.keys.sorted()
        var progress = 0.0
        var ceiling = 0
        var actualPts: [Point] = []
        var ceilingPts: [Point] = []
        for date in LocalDate.range(active.first!, active.last!) {
            if let day = byDate[date], day.scheduled > 0 {
                progress += Double(day.hit) / Double(day.scheduled)
                ceiling += 1
            }
            actualPts.append(Point(date: date, value: multiplier(progress)))
            ceilingPts.append(Point(date: date, value: multiplier(Double(ceiling))))
        }
        return Series(actual: actualPts, ceiling: ceilingPts, progressDays: progress, activeDays: ceiling)
    }

    struct ScheduleSummary {
        let paused: Bool
        let schedule: Schedule
    }

    /// How many days a week can move the curve at all — the cap on the
    /// projection. Fixed-day habits union their weekdays; a weekly quota
    /// contributes its quota; the two combine with max, never more than seven.
    static func activeDaysPerWeek(_ habits: [ScheduleSummary]) -> Int {
        var weekdays = Set<Int>()
        var maxQuota = 0
        for h in habits where !h.paused {
            switch h.schedule {
            case .weekly(let q): maxQuota = max(maxQuota, q)
            case .days(let days): weekdays.formUnion(days)
            }
        }
        return min(7, max(weekdays.count, maxQuota))
    }

    struct ProjectedPoint: Equatable {
        let weekOffset: Int
        let value: Double
    }

    /// Fractional days are intentional — it's a trend line.
    static func project(from: Double, perWeek: Double, weeks: Int) -> [ProjectedPoint] {
        (0...weeks).map { ProjectedPoint(weekOffset: $0, value: multiplier(from + perWeek * Double($0))) }
    }

    struct Projection {
        let current: Double
        let atCurrentPace: [ProjectedPoint]
        let atOneMoreDay: [ProjectedPoint]
        let paceEnd: Double
        let oneMoreEnd: Double
        let activeDaysPerWeek: Int
    }

    /// The two forward lines. When rhythm is 0 the pace line goes flat and the
    /// "one more day a week" line does all the talking — exactly the moment that
    /// message matters most, so it's never hidden.
    static func projectFan(progressDays: Double, rhythmPct: Double, weeklyActive: Int, weeks: Int = 52) -> Projection {
        let w = Double(weeklyActive)
        let pacePerWeek = weeklyActive > 0 ? (rhythmPct / 100) * w : 0
        // You can't show up more often than you have days scheduled.
        let oneMorePerWeek = weeklyActive > 0 ? min(pacePerWeek + 1, w) : 0
        let pace = project(from: progressDays, perWeek: pacePerWeek, weeks: weeks)
        let oneMore = project(from: progressDays, perWeek: oneMorePerWeek, weeks: weeks)
        return Projection(
            current: multiplier(progressDays), atCurrentPace: pace, atOneMoreDay: oneMore,
            paceEnd: pace.last!.value, oneMoreEnd: oneMore.last!.value, activeDaysPerWeek: weeklyActive
        )
    }

    /// Keep a decimal while it still means something, then drop it.
    static func format(_ value: Double) -> String {
        if value < 10 { return String(format: "%.1f×", value) }
        if value < 1000 { return "\(Int(value.rounded()))×" }
        if value < 1_000_000 { return "\(Int((value / 1000).rounded()))k×" }
        return String(format: "%.1fM×", value / 1_000_000)
    }
}
