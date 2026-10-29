import Foundation
import SwiftData

// The weekly check-in — a port of server/src/routes/checkins.ts.

struct CheckInPack {
    struct HabitWeek: Equatable {
        let title: String
        let goalTitle: String?
        /// "days" | "weekly" — names the denominator: days, or sessions.
        let scheduleType: String
        let scheduled: Int
        let hits: Int
        /// Weekday names of the scheduled days that weren't hit.
        let redDots: [String]
    }

    struct UnexplainedMiss: Equatable, Identifiable {
        let habit: Habit
        let date: String
        let weekdayName: String
        let obstacles: [String]

        var id: String { "\(habit.uid)|\(date)" }

        static func == (a: Self, b: Self) -> Bool { a.habit === b.habit && a.date == b.date }
    }

    /// Monday of the week under review.
    let weekOf: String
    let existing: CheckIn?
    let summary: [HabitWeek]
    let unexplainedMisses: [UnexplainedMiss]
    let goals: [String]
    let priorObstacles: [SetbackPlan]

    static let weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

    static func current(habits all: [Habit], checkIns: [CheckIn], goals: [Goal], now: Date, tz: String) -> CheckInPack {
        let today = LocalDate.of(now, tz: tz)
        let weekOf = LocalDate.mondayOf(today)
        // The rolling seven days ending today — it straddles two calendar weeks,
        // so logs are pulled from the earlier week's Monday.
        let week = TodayState.lastNDates(now, tz: tz, 7)
        let logsFrom = ScheduleResolver.weekDates(of: week[0])[0]

        let existing = checkIns.first { $0.weekOf == weekOf }
        let prior = checkIns.filter { $0.weekOf < weekOf }.max { $0.weekOf < $1.weekOf }

        let habits = all.filter { $0.archivedAt == nil && $0.pausedAt == nil }.sorted { $0.createdAt < $1.createdAt }
        var misses: [UnexplainedMiss] = []

        let summary = habits.map { h -> HabitWeek in
            let logs = (h.logs ?? []).filter { $0.date >= logsFrom && $0.date <= week[6] }
            let logByDate = Dictionary(logs.map { ($0.date, $0) }, uniquingKeysWith: { a, _ in a })
            let hits = Set(logs.filter(\.isSuccess).map(\.date))
            let sched = Schedule(h)
            let created = LocalDate.of(h.createdAt, tz: tz)
            let bounds = ScheduleBounds(createdOn: created, pausedOn: h.pausedAt.map { LocalDate.of($0, tz: tz) })
            let obstacles = h.setbackPlanList.map(\.obstacle).filter { !$0.isEmpty }
            let scheduledOn = Dictionary(
                ScheduleResolver.resolveRange(sched, from: week[0], to: week[6], hitDates: hits, bounds: bounds).map { ($0.date, $0.scheduled) },
                uniquingKeysWith: { a, _ in a }
            )

            var hitCount = 0, scheduled = 0
            var red: [String] = []
            for date in week where scheduledOn[date] == true {
                scheduled += 1
                let log = logByDate[date]
                if let log, log.status != "miss" { hitCount += 1; continue }
                let name = weekdayNames[LocalDate.weekday(date)]
                red.append(name)
                // Unexplained = a missed scheduled day (not today — it can still be
                // logged) with no chips or note yet.
                let explained = log.map(MissReasons.isExplained) ?? false
                if date != today && date >= created && !explained {
                    misses.append(UnexplainedMiss(habit: h, date: date, weekdayName: name, obstacles: obstacles))
                }
            }
            if case .weekly = sched {
                return HabitWeek(title: h.title, goalTitle: h.goal?.title, scheduleType: "weekly", scheduled: scheduled, hits: hitCount, redDots: red)
            }
            return HabitWeek(title: h.title, goalTitle: h.goal?.title, scheduleType: "days", scheduled: scheduled, hits: hitCount, redDots: red)
        }

        return CheckInPack(
            weekOf: weekOf,
            existing: existing,
            summary: summary,
            unexplainedMisses: misses,
            goals: goals.filter { $0.status == "active" }.sorted { $0.createdAt < $1.createdAt }.map(\.title),
            priorObstacles: prior.map { JSONText.decode([SetbackPlan].self, $0.obstacles, default: []) } ?? []
        )
    }

    /// Worth showing on the Launchpad: there's a week to reflect on, it hasn't
    /// been saved or skipped, and it isn't snoozed.
    var isDue: Bool { !summary.isEmpty && existing == nil && !CheckInSnooze.isSnoozed(weekOf: weekOf) }

    struct Draft {
        var rating: Int?
        var tinyVictory = ""
        var workingWell = ""
        var notWorking = ""
        var obstacles: [SetbackPlan] = []
        var freeform = ""
        var aiSummary: String?

        init() {}

        init(_ c: CheckIn) {
            rating = c.rating
            tinyVictory = c.tinyVictory ?? ""
            workingWell = c.workingWell ?? ""
            notWorking = c.notWorking ?? ""
            obstacles = JSONText.decode([SetbackPlan].self, c.obstacles, default: [])
            freeform = c.freeform ?? ""
            aiSummary = c.aiSummary
        }
    }

    /// One per week, keyed by weekOf. Saving always counts as completed —
    /// including filling in a week that was skipped.
    @discardableResult
    static func save(weekOf: String, _ d: Draft, existing: [CheckIn], ctx: ModelContext) throws -> CheckIn {
        func clean(_ s: String) -> String? {
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? nil : t
        }
        let c = existing.first { $0.weekOf == weekOf } ?? {
            let new = CheckIn(weekOf: weekOf)
            ctx.insert(new)
            return new
        }()
        c.rating = d.rating
        c.tinyVictory = clean(d.tinyVictory)
        c.workingWell = clean(d.workingWell)
        c.notWorking = clean(d.notWorking)
        c.obstacles = JSONText.encode(
            d.obstacles
                .map { SetbackPlan(obstacle: $0.obstacle.trimmingCharacters(in: .whitespaces), plan: $0.plan.trimmingCharacters(in: .whitespaces)) }
                .filter { !$0.obstacle.isEmpty && !$0.plan.isEmpty }
                .prefix(5).map { $0 }
        )
        c.freeform = clean(d.freeform)
        c.aiSummary = d.aiSummary
        c.status = "completed"
        c.updatedAt = Date()
        try ctx.save()
        return c
    }

    /// "Not this week." Never downgrades a week that was already completed.
    static func skip(weekOf: String, existing: [CheckIn], ctx: ModelContext) throws {
        guard !existing.contains(where: { $0.weekOf == weekOf }) else { return }
        let c = CheckIn(weekOf: weekOf)
        c.status = "skipped"
        ctx.insert(c)
        try ctx.save()
    }
}

/// "Snooze until tomorrow" — device-local on purpose: it's a nuisance control,
/// not data. Self-expires when the week rolls over.
enum CheckInSnooze {
    private static let key = "checkin-snooze"

    static func snooze(weekOf: String, today: String) {
        UserDefaults.standard.set(["weekOf": weekOf, "until": LocalDate.shift(today, by: 1)], forKey: key)
    }

    static func isSnoozed(weekOf: String, today: String = LocalDate.today(tz: TimeZone.current.identifier)) -> Bool {
        guard let s = UserDefaults.standard.dictionary(forKey: key) as? [String: String] else { return false }
        return s["weekOf"] == weekOf && (s["until"] ?? "") > today
    }
}
