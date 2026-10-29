import Foundation

// The one place a habit's schedule is interpreted. A port of server/src/lib/schedule.ts.
//
// Two modes:
//   .days   — fixed weekdays. "Is it due?" is weekday membership.
//   .weekly — a quota of N reps on ANY days, Mon–Sun. "Gym 3× a week."
//
// A weekly quota resolves into the SAME per-day `scheduled` flags everything
// downstream reads (week strip, contribution grid, compound curve, check-in),
// using the tail rule:
//
//   1. Eligible days = the Mon–Sun dates the habit existed and wasn't paused.
//   2. Effective quota = min(timesPerWeek, eligibleDays).
//   3. Every day with a successful log is scheduled: it counted.
//   4. remaining = quota − hits. Walk the non-hit eligible days BACKWARDS from
//      Sunday and mark `remaining` of them. Everything else is a rest day.
//
// So nothing turns red while you still have slack, and a week that ends short
// shows exactly the shortfall — on the days you ran out of runway.

enum Schedule: Equatable {
    case days([Int])
    case weekly(quota: Int)

    static let allDays = [0, 1, 2, 3, 4, 5, 6]

    init(scheduleType: String?, scheduleDays: String?, timesPerWeek: Int?) {
        if scheduleType == "weekly" {
            // A corrupt or missing quota falls back to daily rather than taking
            // the whole momentum pipeline down.
            if let q = timesPerWeek, (1...7).contains(q) { self = .weekly(quota: q); return }
            self = .days(Schedule.allDays)
            return
        }
        var days = Schedule.allDays
        if let raw = scheduleDays?.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: raw) as? [Any], !parsed.isEmpty {
            // Malformed entries are dropped; malformed JSON reads as every day.
            days = parsed.compactMap { ($0 as? NSNumber)?.intValue }.filter { (0...6).contains($0) }
        }
        self = .days(days.isEmpty ? Schedule.allDays : days)
    }

    init(_ h: Habit) {
        self.init(scheduleType: h.scheduleType, scheduleDays: h.scheduleDays, timesPerWeek: h.timesPerWeek)
    }
}

struct ResolvedDay: Equatable {
    let date: String
    let weekday: Int
    /// True when this day asks something of the habit — the flag the whole app reads.
    let scheduled: Bool
}

/// Bounds outside which a habit can't be scheduled at all. All local "YYYY-MM-DD".
struct ScheduleBounds {
    var createdOn: String
    /// That day and after are rest.
    var pausedOn: String?
    /// That day and after are rest.
    var archivedOn: String?

    init(createdOn: String, pausedOn: String? = nil, archivedOn: String? = nil) {
        self.createdOn = createdOn
        self.pausedOn = pausedOn
        self.archivedOn = archivedOn
    }

    init(_ h: Habit, tz: String) {
        self.init(
            createdOn: LocalDate.of(h.createdAt, tz: tz),
            pausedOn: h.pausedAt.map { LocalDate.of($0, tz: tz) },
            archivedOn: h.archivedAt.map { LocalDate.of($0, tz: tz) }
        )
    }

    func eligible(_ date: String) -> Bool {
        if date < createdOn { return false }
        if let p = pausedOn, date >= p { return false }
        if let a = archivedOn, date >= a { return false }
        return true
    }
}

struct WeekProgress: Equatable {
    let quota: Int
    let hits: Int
    let remaining: Int
    /// Days left in the Mon–Sun week, today included.
    let daysLeft: Int
    /// remaining >= daysLeft — the buffer is gone, today is a must.
    let obligatedToday: Bool
}

enum ScheduleResolver {
    /// The seven dates (Monday first) of the week containing `iso`.
    static func weekDates(of iso: String) -> [String] {
        let monday = LocalDate.mondayOf(iso)
        return (0..<7).map { LocalDate.shift(monday, by: $0) }
    }

    /// Materialize one Mon–Sun week. `hitDates` holds every date with a
    /// successful log; misses and unlogged days are both absent from it.
    static func resolveWeek(
        _ sched: Schedule, weekDates: [String], hitDates: Set<String>, bounds: ScheduleBounds
    ) -> [ResolvedDay] {
        switch sched {
        case .days(let days):
            return weekDates.map { date in
                let wd = LocalDate.weekday(date)
                return ResolvedDay(date: date, weekday: wd, scheduled: bounds.eligible(date) && days.contains(wd))
            }
        case .weekly(let rawQuota):
            let live = weekDates.filter(bounds.eligible)
            // Prorate: you can't owe reps for days the habit didn't exist for.
            let quota = min(rawQuota, live.count)
            let hits = live.filter(hitDates.contains)
            var marked = Set(hits)
            // Reserve the shortfall against the LAST unhit days of the week, from
            // Sunday backwards, so earlier days never read as misses you didn't owe.
            var remaining = quota - hits.count
            for d in live.reversed() where remaining > 0 && !marked.contains(d) {
                marked.insert(d)
                remaining -= 1
            }
            return weekDates.map { ResolvedDay(date: $0, weekday: LocalDate.weekday($0), scheduled: marked.contains($0)) }
        }
    }

    /// Resolve an inclusive range by slicing it into Mon–Sun weeks. Partial weeks
    /// at either end are resolved in full and then trimmed — a weekly quota only
    /// makes sense a whole week at a time.
    static func resolveRange(
        _ sched: Schedule, from: String, to: String, hitDates: Set<String>, bounds: ScheduleBounds
    ) -> [ResolvedDay] {
        guard from <= to else { return [] }
        var out: [ResolvedDay] = []
        var week = weekDates(of: from)
        for _ in 0..<600 {
            for day in resolveWeek(sched, weekDates: week, hitDates: hitDates, bounds: bounds)
            where day.date >= from && day.date <= to {
                out.append(day)
            }
            if week[6] >= to { break }
            week = weekDates(of: LocalDate.shift(week[6], by: 1))
        }
        return out
    }

    /// Week-to-date state of a weekly habit; nil for fixed-day habits.
    static func weekProgress(
        _ sched: Schedule, today: String, hitDates: Set<String>, bounds: ScheduleBounds
    ) -> WeekProgress? {
        guard case .weekly(let rawQuota) = sched else { return nil }
        let live = weekDates(of: today).filter(bounds.eligible)
        let quota = min(rawQuota, live.count)
        let hits = live.filter(hitDates.contains).count
        let remaining = max(0, quota - hits)
        let daysLeft = live.filter { $0 >= today }.count
        return WeekProgress(
            quota: quota, hits: hits, remaining: remaining, daysLeft: daysLeft,
            obligatedToday: remaining > 0 && daysLeft > 0 && remaining >= daysLeft
        )
    }

    static func isDue(
        _ sched: Schedule, on date: String, hitDates: Set<String>, bounds: ScheduleBounds
    ) -> Bool {
        resolveWeek(sched, weekDates: weekDates(of: date), hitDates: hitDates, bounds: bounds)
            .first { $0.date == date }?.scheduled ?? false
    }
}
