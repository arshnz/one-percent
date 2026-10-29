import Foundation

// Momentum aggregates — a port of GET /momentum in server/src/routes/momentum.ts.
// No streaks, ever.

struct MomentumData {
    struct Consistency: Equatable {
        let rhythm: Int
        let anchoring: Int?
        let consistency: Int
    }

    struct Cell: Equatable {
        let date: String
        let count: Int
        let wasSavedMiss: Bool
        let status: String?
        let scheduled: Bool
        let missReasons: [String]?
    }

    struct Obstacle: Equatable, Hashable {
        let reason: String
        let count: Int
    }

    struct PhaseStep: Equatable {
        let phaseNumber: Int
        let targetText: String
        let targetCount: Int
        let status: String
        let graduatedAt: Date?
    }

    struct HabitTrajectory: Identifiable {
        let habit: Habit
        let consistency: Consistency
        let contributions: [Cell]
        let topObstacles: [Obstacle]
        let missPattern: String?
        let setbackObstacles: [String]
        let phases: [PhaseStep]

        var id: String { habit.uid }
        var paused: Bool { habit.pausedAt != nil }

        var curveHabit: Compound.CurveHabit {
            Compound.CurveHabit(
                contributions: contributions.map { Compound.GridCell(date: $0.date, count: $0.count, scheduled: $0.scheduled) },
                createdAt: habit.createdAt, pausedAt: habit.pausedAt, archivedAt: habit.archivedAt
            )
        }
    }

    struct AutomaticityPoint: Equatable {
        let habitUid: String
        let mean: Double
        let passed: Bool
        let createdAt: Date
    }

    let totalVotes: Int
    let totalRecoveries: Int
    let consistency: Consistency
    let automaticity: [AutomaticityPoint]
    let weeklyRatings: [(weekOf: String, rating: Int)]
    let ratio: (successes: Int, expected: Int, pct: Int, windowDays: Int)
    /// A year of workspace-wide vote counts per day.
    let contributions: [(date: String, count: Int)]
    let trajectory: [HabitTrajectory]
    /// Archived habits feed the curve only — their earned days are permanent.
    let archived: [Compound.CurveHabit]
    let habitCount: Int
    let topObstacle: Obstacle?

    /// The compound curve's input: live and archived habits alike.
    var curveHabits: [Compound.CurveHabit] { trajectory.map(\.curveHabit) + archived }

    var scheduleSummaries: [Compound.ScheduleSummary] {
        trajectory.map { .init(paused: $0.paused, schedule: Schedule($0.habit)) }
    }
}

enum Momentum {
    static let window = 30
    static let gridDays = 365
    static let rhythmHalfLife = 14.0
    static let rhythmLookback = 60
    private static let day: TimeInterval = 86_400
    private static let weekdayPlural = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"]

    /// Time of day as a 0–1 fraction in the user's time zone.
    static func hourFraction(_ d: Date, tz: String) -> Double {
        // (h + m/60) / 24, in that order, so the float matches the web's bit for bit.
        let mins = LocalDate.minutesOfDay(d, tz: tz)
        return (Double(mins / 60) + Double(mins % 60) / 60) / 24
    }

    /// Recency-weighted adherence to scheduled days (half-life 14 days), 0–100.
    static func rhythm(scheduledOn: [String: Bool], hits: Set<String>, tz: String, now: Date) -> Int {
        var wsum = 0.0, hit = 0.0
        for i in 0..<rhythmLookback {
            let ds = LocalDate.of(now.addingTimeInterval(-Double(i) * day), tz: tz)
            guard scheduledOn[ds] == true else { continue }
            let w = pow(0.5, Double(i) / rhythmHalfLife)
            wsum += w
            if hits.contains(ds) { hit += w }
        }
        return wsum > 0 ? Int((hit / wsum * 100).rounded()) : 0
    }

    /// How tightly reps cluster at one time of day: the mean resultant length
    /// of the circular distribution (handles the midnight wrap). Nil under 3 reps.
    static func anchoring(_ fractions: [Double]) -> Int? {
        guard fractions.count >= 3 else { return nil }
        var sx = 0.0, sy = 0.0
        for f in fractions {
            sx += cos(f * 2 * .pi)
            sy += sin(f * 2 * .pi)
        }
        return Int((sqrt(sx * sx + sy * sy) / Double(fractions.count) * 100).rounded())
    }

    /// Most frequent first; ties keep first-seen order, as JS's stable sort did.
    private static func countTop(_ order: [String], _ counts: [String: Int], _ top: Int) -> [MomentumData.Obstacle] {
        order.enumerated()
            .sorted { a, b in counts[a.element]! != counts[b.element]! ? counts[a.element]! > counts[b.element]! : a.offset < b.offset }
            .prefix(top)
            .map { MomentumData.Obstacle(reason: $0.element, count: counts[$0.element]!) }
    }

    static func compute(habits all: [Habit], checkIns: [CheckIn], now: Date, tz: String) -> MomentumData {
        let habits = all.filter { $0.archivedAt == nil }.sorted { $0.createdAt < $1.createdAt }
        let logsOf = { (h: Habit) in (h.logs ?? []).sorted { $0.date != $1.date ? $0.date < $1.date : $0.createdAt < $1.createdAt } }

        var totalVotes = 0
        var countsByDate: [String: Int] = [:]
        for h in habits {
            for l in logsOf(h) where l.isSuccess {
                totalVotes += 1
                countsByDate[l.date, default: 0] += 1
            }
        }

        let windowDates = (0..<window).map { LocalDate.of(now.addingTimeInterval(-Double($0) * day), tz: tz) }
        let windowSet = Set(windowDates)
        let windowSuccesses = habits.flatMap(logsOf).filter { $0.isSuccess && windowSet.contains($0.date) }.count
        let contributions = (0..<gridDays).reversed().map { i -> (date: String, count: Int) in
            let ds = LocalDate.of(now.addingTimeInterval(-Double(i) * day), tz: tz)
            return (ds, countsByDate[ds] ?? 0)
        }

        let day90 = LocalDate.of(now.addingTimeInterval(-90 * day), tz: tz)
        let day30 = LocalDate.of(now.addingTimeInterval(-30 * day), tz: tz)
        let endStr = LocalDate.of(now, tz: tz)
        let yearAgo = LocalDate.of(now.addingTimeInterval(-Double(gridDays - 1) * day), tz: tz)

        var workspaceOrder: [String] = []
        var workspaceCounts: [String: Int] = [:]
        var expected = 0
        var totalRecoveries = 0
        var trajectory: [MomentumData.HabitTrajectory] = []

        for h in habits {
            let logs = logsOf(h)
            let sched = Schedule(h)
            let created = LocalDate.of(h.createdAt, tz: tz)
            let success = logs.filter(\.isSuccess)
            let hits = Set(success.map(\.date))
            var statusOn: [String: String] = [:]
            for l in success { statusOn[l.date] = l.status }

            // "What got in the way" — miss days with recorded reasons.
            var reasonByDate: [String: [String]] = [:]
            var reasonDates: [String] = []
            for l in logs where l.status == "miss" {
                let reasons = JSONText.strings(l.missReasons)
                guard !reasons.isEmpty else { continue }
                if reasonByDate[l.date] == nil { reasonDates.append(l.date) }
                reasonByDate[l.date] = reasons
                if l.date >= day30 {
                    for r in reasons {
                        if workspaceCounts[r] == nil { workspaceOrder.append(r) }
                        workspaceCounts[r, default: 0] += 1
                    }
                }
            }

            let bounds = ScheduleBounds(createdOn: created, pausedOn: h.pausedAt.map { LocalDate.of($0, tz: tz) })
            let resolved = ScheduleResolver.resolveRange(sched, from: min(created, yearAgo), to: endStr, hitDates: hits, bounds: bounds)
            let scheduledOn = Dictionary(resolved.map { ($0.date, $0.scheduled) }, uniquingKeysWith: { a, _ in a })
            expected += windowDates.filter { scheduledOn[$0] == true }.count

            let r = rhythm(scheduledOn: scheduledOn, hits: hits, tz: tz, now: now)
            let a = anchoring(success.map { hourFraction($0.createdAt, tz: tz) })
            let consistency = MomentumData.Consistency(
                rhythm: r, anchoring: a, consistency: a.map { Int((0.6 * Double(r) + 0.4 * Double($0)).rounded()) } ?? r
            )

            // Saved miss: a scheduled day you skipped but came back to on the
            // very next one you owed.
            let scheduledDates = resolved.filter(\.scheduled).map(\.date)
            var saved = Set<String>()
            for (curr, next) in zip(scheduledDates, scheduledDates.dropFirst()) where !hits.contains(curr) && hits.contains(next) {
                saved.insert(curr)
                totalRecoveries += 1
            }

            var obstacleOrder: [String] = []
            var obstacleCounts: [String: Int] = [:]
            for ds in reasonDates where ds >= day90 {
                for reason in reasonByDate[ds]! {
                    if obstacleCounts[reason] == nil { obstacleOrder.append(reason) }
                    obstacleCounts[reason, default: 0] += 1
                }
            }

            // Name a weekday that carries at least half the misses (min 3).
            // Skipped for weekly quotas: the tail rule would always "find" Sunday.
            var missPattern: String?
            if case .days = sched {
                var order: [Int] = []
                var byWeekday: [Int: Int] = [:]
                var total = 0
                for ds in scheduledDates where ds >= day90 && ds < endStr && !hits.contains(ds) {
                    let wd = LocalDate.weekday(ds)
                    if byWeekday[wd] == nil { order.append(wd) }
                    byWeekday[wd, default: 0] += 1
                    total += 1
                }
                if total >= 3 {
                    let top = order.enumerated().sorted { x, y in
                        byWeekday[x.element]! != byWeekday[y.element]! ? byWeekday[x.element]! > byWeekday[y.element]! : x.offset < y.offset
                    }[0].element
                    if Double(byWeekday[top]!) / Double(total) >= 0.5 {
                        missPattern = "Most misses land on \(weekdayPlural[top])."
                    }
                }
            }

            trajectory.append(MomentumData.HabitTrajectory(
                habit: h,
                consistency: consistency,
                contributions: resolved.map {
                    MomentumData.Cell(
                        date: $0.date, count: hits.contains($0.date) ? 1 : 0, wasSavedMiss: saved.contains($0.date),
                        status: statusOn[$0.date], scheduled: $0.scheduled, missReasons: reasonByDate[$0.date]
                    )
                },
                topObstacles: countTop(obstacleOrder, obstacleCounts, 4),
                missPattern: missPattern,
                setbackObstacles: h.setbackPlanList.map(\.obstacle).filter { !$0.isEmpty },
                phases: h.sortedPhases.map {
                    MomentumData.PhaseStep(phaseNumber: $0.phaseNumber, targetText: $0.targetText, targetCount: $0.targetCount, status: $0.status, graduatedAt: $0.graduatedAt)
                }
            ))
        }

        // Paused habits are resting — they stay out of the headline average.
        let running = trajectory.filter { !$0.paused }.map(\.consistency)
        let mean = { (xs: [Int]) in Int((Double(xs.reduce(0, +)) / Double(xs.count)).rounded()) }
        let anchored = running.compactMap(\.anchoring)
        let overall = running.isEmpty
            ? MomentumData.Consistency(rhythm: 0, anchoring: nil, consistency: 0)
            : MomentumData.Consistency(rhythm: mean(running.map(\.rhythm)), anchoring: anchored.isEmpty ? nil : mean(anchored), consistency: mean(running.map(\.consistency)))

        let liveUids = Set(habits.map(\.uid))
        let automaticity = habits.flatMap { $0.checks ?? [] }
            .filter { $0.habit.map { liveUids.contains($0.uid) } ?? false }
            .sorted { $0.createdAt < $1.createdAt }
            .map { MomentumData.AutomaticityPoint(habitUid: $0.habit!.uid, mean: $0.mean, passed: $0.passed, createdAt: $0.createdAt) }

        let ratings = checkIns.compactMap { c in c.rating.map { (weekOf: c.weekOf, rating: $0) } }
            .sorted { $0.weekOf > $1.weekOf }.prefix(26).reversed()

        let archived = all.filter { $0.archivedAt != nil }.sorted { $0.createdAt < $1.createdAt }.map { h -> Compound.CurveHabit in
            let created = LocalDate.of(h.createdAt, tz: tz)
            let archivedOn = LocalDate.of(h.archivedAt!, tz: tz)
            let hits = Set((h.logs ?? []).filter(\.isSuccess).map(\.date))
            let bounds = ScheduleBounds(createdOn: created, pausedOn: h.pausedAt.map { LocalDate.of($0, tz: tz) }, archivedOn: archivedOn)
            let grid = ScheduleResolver.resolveRange(Schedule(h), from: created, to: archivedOn, hitDates: hits, bounds: bounds).map {
                Compound.GridCell(date: $0.date, count: hits.contains($0.date) ? 1 : 0, scheduled: $0.scheduled)
            }
            return Compound.CurveHabit(contributions: grid, createdAt: h.createdAt, pausedAt: h.pausedAt, archivedAt: h.archivedAt)
        }

        return MomentumData(
            totalVotes: totalVotes,
            totalRecoveries: totalRecoveries,
            consistency: overall,
            automaticity: automaticity,
            weeklyRatings: Array(ratings),
            ratio: (windowSuccesses, expected, expected > 0 ? Int((Double(min(windowSuccesses, expected)) / Double(expected) * 100).rounded()) : 0, window),
            contributions: contributions,
            trajectory: trajectory,
            archived: archived,
            habitCount: habits.count,
            topObstacle: countTop(workspaceOrder, workspaceCounts, 1).first
        )
    }
}
