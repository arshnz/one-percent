import Foundation
import UserNotifications

// Reminders as local notifications — the on-device replacement for the
// server's 15-minute cron (server/src/lib/reminders.ts, checkinNudge.ts).
//
// The cron decided at send time; a phone has to decide ahead of time. So the
// whole next week is planned from what's known now and re-planned every time
// something changes (a vote, an edit, opening the app). The rules are the
// cron's, applied per future day:
//
//   - fixed days: remind on the habit's weekdays
//   - weekly quota: stay quiet while there's slack; speak up once the buffer
//     is gone (reps left == days left), plus one Thursday nudge if the week
//     hasn't started — planned assuming no more reps land before that day,
//     and re-planned the moment one does
//   - never on a day already voted
//   - the weekly check-in nudge, Sunday 5pm, unless that week's is done

enum Reminders {
    static let horizonDays = 7
    /// Thursday — late enough that a quiet Mon–Wed means something, early
    /// enough to leave four days to make good on a weekly quota.
    static let midWeekNudgeDay = 4
    static let checkInHour = 17
    private static let prefix = "op."

    struct Planned: Equatable {
        let id: String
        let date: String
        let minutes: Int
        let title: String
        let body: String
    }

    /// Pure planning, separate from the notification center so it can be tested.
    static func plan(habits all: [Habit], checkIns: [CheckIn], now: Date, tz: String) -> [Planned] {
        let today = LocalDate.of(now, tz: tz)
        let nowMin = LocalDate.minutesOfDay(now, tz: tz)
        let live = all.filter { $0.archivedAt == nil && $0.pausedAt == nil }
        var out: [Planned] = []

        for h in live where h.reminderEnabled {
            guard let minutes = LocalDate.parseHHMM(h.reminderTime) else { continue }
            let sched = Schedule(h)
            let hits = Set((h.logs ?? []).filter(\.isSuccess).map(\.date))
            let bounds = ScheduleBounds(h, tz: tz)

            for k in 0..<horizonDays {
                let date = LocalDate.shift(today, by: k)
                if k == 0 && minutes <= nowMin { continue }
                if hits.contains(date) { continue }
                let weekday = LocalDate.weekday(date)
                switch sched {
                case .days(let days):
                    if !days.contains(weekday) { continue }
                case .weekly:
                    guard let p = ScheduleResolver.weekProgress(sched, today: date, hitDates: hits, bounds: bounds),
                          p.remaining > 0 else { continue }
                    let midWeek = p.hits == 0 && weekday == midWeekNudgeDay
                    if !p.obligatedToday && !midWeek { continue }
                }
                let (title, body) = text(for: h)
                out.append(Planned(id: "\(prefix)\(h.uid).\(date)", date: date, minutes: minutes, title: title, body: body))
            }
        }

        if !live.isEmpty {
            for k in 0..<horizonDays {
                let date = LocalDate.shift(today, by: k)
                guard LocalDate.weekday(date) == 0 else { continue }
                if k == 0 && checkInHour * 60 <= nowMin { continue }
                let weekOf = LocalDate.mondayOf(date)
                if checkIns.contains(where: { $0.weekOf == weekOf }) { continue }
                out.append(Planned(
                    id: "\(prefix)checkin.\(date)", date: date, minutes: checkInHour * 60,
                    title: "Your weekly check-in is ready",
                    body: "Take five minutes to look back on the week — what worked, what didn’t, what’s next."
                ))
            }
        }
        return out
    }

    /// Break habits get a pre-emptive guard at the moment of risk; build habits
    /// get the usual "cast your vote".
    static func text(for h: Habit) -> (String, String) {
        let target = h.sortedPhases.first { $0.status == "active" }?.targetText ?? h.title
        let bundle = h.temptationBundle?.trimmed.nonEmpty
        let replacement = h.replacementAction?.trimmed.nonEmpty
        let trigger = h.avoidTrigger?.trimmed.nonEmpty
        if h.kind == "break" {
            return (
                trigger.map { "Heads up: \($0) usually hits about now" } ?? "Stay strong — your risky moment is here",
                replacement.map { "Your move instead: \($0)." } ?? "Ride out the urge — a clean day is the vote."
            )
        }
        return (
            "Time to \(target)",
            bundle.map { "Make it a treat — \($0)." } ?? "Cast today's vote — even the 2-minute version counts."
        )
    }

    /// Replace every pending One Percent notification with a fresh plan.
    static func reschedule(habits: [Habit], checkIns: [CheckIn], tz: String, enabled: Bool = true, now: Date = Date()) async {
        let center = UNUserNotificationCenter.current()
        let planned = enabled ? plan(habits: habits, checkIns: checkIns, now: now, tz: tz) : []
        let settings = await center.notificationSettings()
        if settings.authorizationStatus == .notDetermined && !planned.isEmpty {
            _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
        }

        let pending = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(prefix) }
        center.removePendingNotificationRequests(withIdentifiers: pending)

        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: tz) ?? .current
        for p in planned {
            let parts = p.date.split(separator: "-").compactMap { Int($0) }
            guard parts.count == 3 else { continue }
            var dc = DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: p.minutes / 60, minute: p.minutes % 60)
            dc.timeZone = cal.timeZone
            let content = UNMutableNotificationContent()
            content.title = p.title
            content.body = p.body
            content.sound = .default
            let req = UNNotificationRequest(identifier: p.id, content: content, trigger: UNCalendarNotificationTrigger(dateMatching: dc, repeats: false))
            try? await center.add(req)
        }
    }
}

extension String {
    nonisolated var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
    nonisolated var nonEmpty: String? { isEmpty ? nil : self }
}
