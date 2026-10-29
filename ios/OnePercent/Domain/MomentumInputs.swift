import Foundation

/// The per-habit inputs the Momentum maths reads, built the same way the web
/// app's server built them in routes/momentum.ts.
enum MomentumInputs {
    /// A full year of cells — the web app's GRID_DAYS.
    static let gridDays = 365

    /// Every date with a successful log (target or fail-safe).
    static func hitDates(_ h: Habit) -> Set<String> {
        Set((h.logs ?? []).filter(\.isSuccess).map(\.date))
    }

    /// The compound-curve grid for one habit. Active habits span the trailing
    /// year (or back to creation, whichever is earlier) up to today; archived
    /// habits span creation to their archive date, frozen there.
    static func grid(_ h: Habit, today: String, tz: String) -> [Compound.GridCell] {
        let hits = hitDates(h)
        let created = LocalDate.of(h.createdAt, tz: tz)
        let paused = h.pausedAt.map { LocalDate.of($0, tz: tz) }
        let sched = Schedule(h)
        let from: String
        let to: String
        let bounds: ScheduleBounds
        if let archivedAt = h.archivedAt {
            let archivedOn = LocalDate.of(archivedAt, tz: tz)
            from = created
            to = archivedOn
            bounds = ScheduleBounds(createdOn: created, pausedOn: paused, archivedOn: archivedOn)
        } else {
            from = min(created, LocalDate.shift(today, by: -(gridDays - 1)))
            to = today
            // The web route left archivedOn out for live habits — it's nil anyway.
            bounds = ScheduleBounds(createdOn: created, pausedOn: paused)
        }
        return ScheduleResolver.resolveRange(sched, from: from, to: to, hitDates: hits, bounds: bounds).map {
            Compound.GridCell(date: $0.date, count: hits.contains($0.date) ? 1 : 0, scheduled: $0.scheduled)
        }
    }

    static func curveHabit(_ h: Habit, today: String, tz: String) -> Compound.CurveHabit {
        Compound.CurveHabit(contributions: grid(h, today: today, tz: tz), createdAt: h.createdAt, pausedAt: h.pausedAt, archivedAt: h.archivedAt)
    }
}
