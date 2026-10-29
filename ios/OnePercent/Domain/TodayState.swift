import Foundation
import SwiftData

// What each Launchpad card needs to know — a port of GET /habits/today in
// server/src/routes/habits.ts, plus the Launchpad's own ordering rules from
// client/src/pages/Launchpad.tsx.

struct WeekStripDay: Equatable, Identifiable {
    let date: String
    let scheduled: Bool
    /// The day's log status, or nil when nothing was logged.
    let status: String?
    /// From the habit's creation up to today — any of these can be corrected.
    let editable: Bool

    var id: String { date }
}

struct HabitToday: Identifiable {
    let habit: Habit
    let phase: Phase?
    let completedReps: Int
    let todayLog: HabitLog?
    let automaticity: Automaticity.State
    let wasPreviousMissed: Bool
    let previousMissDate: String?
    let previousMissNeedsReason: Bool
    let weekStrip: [WeekStripDay]
    /// Nil for fixed-day habits.
    let weekProgress: WeekProgress?

    var id: PersistentIdentifier { habit.persistentModelID }
}

struct TodayPayload {
    let date: String
    let weekday: Int
    let habits: [HabitToday]
}

enum TodayState {
    private static let day: TimeInterval = 86_400

    /// The last `n` local dates ending today, oldest first. Steps back in whole
    /// 24-hour instants exactly as the server did, so DST days resolve the same.
    static func lastNDates(_ now: Date, tz: String, _ n: Int) -> [String] {
        (0..<n).reversed().map { LocalDate.of(now.addingTimeInterval(-Double($0) * day), tz: tz) }
    }

    static func build(_ all: [Habit], now: Date, tz: String) -> TodayPayload {
        let date = LocalDate.of(now, tz: tz)
        let weekday = LocalDate.weekday(date)
        let weekDays = lastNDates(now, tz: tz, 7)
        let fromISO = LocalDate.shift(ScheduleResolver.weekDates(of: date)[0], by: -7)

        let habits = all
            .filter { $0.archivedAt == nil && $0.pausedAt == nil }
            .sorted { $0.createdAt < $1.createdAt }

        let result = habits.map { h -> HabitToday in
            let phase = Phases.current(h)
            let windowLogs = (h.logs ?? []).filter { $0.date >= fromISO && $0.date <= date }
            let logByDate = Dictionary(windowLogs.map { ($0.date, $0) }, uniquingKeysWith: { a, _ in a })
            let hits = Set(windowLogs.filter(\.isSuccess).map(\.date))

            let sched = Schedule(h)
            let bounds = ScheduleBounds(h, tz: tz)
            let resolved = ScheduleResolver.resolveRange(sched, from: fromISO, to: date, hitDates: hits, bounds: bounds)
            let scheduledOn = Dictionary(resolved.map { ($0.date, $0.scheduled) }, uniquingKeysWith: { a, _ in a })
            let prevDate = resolved.last { $0.date < date && $0.scheduled }?.date

            var missed = false
            var needsReason = false
            if let prevDate {
                let prev = logByDate[prevDate]
                if prev == nil || prev?.status == "miss" {
                    missed = true
                    needsReason = prev.map { !MissReasons.isExplained($0) } ?? true
                }
            }

            let created = LocalDate.of(h.createdAt, tz: tz)
            let strip = weekDays.map { d in
                WeekStripDay(
                    date: d,
                    scheduled: scheduledOn[d] ?? false,
                    status: logByDate[d]?.status,
                    editable: d >= created && d <= date
                )
            }

            return HabitToday(
                habit: h,
                phase: phase,
                completedReps: phase.map(Phases.completedReps) ?? 0,
                todayLog: logByDate[date],
                automaticity: Automaticity.state(phase, now: now),
                wasPreviousMissed: missed,
                previousMissDate: missed ? prevDate : nil,
                previousMissNeedsReason: needsReason,
                weekStrip: strip,
                weekProgress: ScheduleResolver.weekProgress(sched, today: date, hitDates: hits, bounds: bounds)
            )
        }
        return TodayPayload(date: date, weekday: weekday, habits: result)
    }

    // MARK: Launchpad ordering

    /// 0 = today asks for it, 1 = a weekly habit you could still do today,
    /// 2 = genuinely off. A flexible habit with reps left shouldn't sink to the
    /// bottom next to a rest day.
    static func tier(_ h: HabitToday, weekday: Int) -> Int {
        if let wp = h.weekProgress { return wp.obligatedToday ? 0 : wp.remaining > 0 ? 1 : 2 }
        if case .days(let days) = Schedule(h.habit) { return days.contains(weekday) ? 0 : 2 }
        return 0
    }

    /// "Votes left to cast" — only what today actually asks for.
    static func remaining(_ p: TodayPayload) -> Int {
        p.habits.filter { tier($0, weekday: p.weekday) == 0 && ($0.todayLog == nil || $0.todayLog?.status == "miss") }.count
    }

    /// Tier first; within "asked for today", ones in danger (missed the previous
    /// day they owed) first. Otherwise creation order — a stable sort.
    static func sorted(_ p: TodayPayload) -> [HabitToday] {
        p.habits.enumerated().sorted { a, b in
            let at = tier(a.element, weekday: p.weekday), bt = tier(b.element, weekday: p.weekday)
            if at != bt { return at < bt }
            if at == 0 && a.element.wasPreviousMissed != b.element.wasPreviousMissed { return a.element.wasPreviousMissed }
            return a.offset < b.offset
        }.map(\.element)
    }
}
