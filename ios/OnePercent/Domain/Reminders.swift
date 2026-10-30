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
    static let digestHour = 6
    static let prefix = "op."

    /// What the user has switched on, and when.
    ///
    /// Every notification this app sends is individually switchable and
    /// individually timed — which is the point of it living on the phone
    /// rather than in a cron. The server sent what it sent; this does not.
    /// Defaults match the old server times exactly, so nothing moves until it
    /// is deliberately moved.
    struct Prefs: Equatable {
        var habitReminders = true
        var digest = true
        var digestMinutes = digestHour * 60
        var checkIn = true
        var checkInMinutes = checkInHour * 60

        static let `default` = Prefs()

        init() {}

        init(_ p: Profile?) {
            guard let p else { return }
            habitReminders = p.habitRemindersEnabled
            digest = p.digestEnabled
            digestMinutes = LocalDate.parseHHMM(p.digestTime) ?? Reminders.digestHour * 60
            checkIn = p.checkInNudgeEnabled
            checkInMinutes = LocalDate.parseHHMM(p.checkInTime) ?? Reminders.checkInHour * 60
        }
    }

    struct Planned: Equatable {
        let id: String
        let date: String
        let minutes: Int
        let title: String
        let body: String
    }

    /// Pure planning, separate from the notification center so it can be tested.
    static func plan(
        habits all: [Habit],
        checkIns: [CheckIn],
        now: Date,
        tz: String,
        prefs: Prefs = .default
    ) -> [Planned] {
        let today = LocalDate.of(now, tz: tz)
        let nowMin = LocalDate.minutesOfDay(now, tz: tz)
        let live = all.filter { $0.archivedAt == nil && $0.pausedAt == nil }
        var out: [Planned] = []

        for h in live where h.reminderEnabled && prefs.habitReminders {
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

        if !live.isEmpty && prefs.checkIn {
            for k in 0..<horizonDays {
                let date = LocalDate.shift(today, by: k)
                guard LocalDate.weekday(date) == 0 else { continue }
                if k == 0 && prefs.checkInMinutes <= nowMin { continue }
                let weekOf = LocalDate.mondayOf(date)
                if checkIns.contains(where: { $0.weekOf == weekOf }) { continue }
                out.append(Planned(
                    id: "\(prefix)checkin.\(date)", date: date, minutes: prefs.checkInMinutes,
                    title: "Your weekly check-in is ready",
                    body: "Take five minutes to look back on the week — what worked, what didn’t, what’s next."
                ))
            }
        }
        // ── The morning digest ────────────────────────────────────────────
        //
        // The on-device replacement for server/src/lib/digest.ts, the last of
        // the daily emails with no equivalent here. One notification listing
        // today's implementation intentions, rather than one per habit — the
        // whole point of a digest is that it is a single look at the day.
        //
        // Planned per future day against what is due THAT day, using the same
        // schedule rules the per-habit nudges use, so a digest never lists a
        // habit that is not actually on today. A day with nothing due gets no
        // digest at all rather than an empty one.
        if prefs.digest {
            for k in 0..<horizonDays {
                let date = LocalDate.shift(today, by: k)
                if k == 0 && prefs.digestMinutes <= nowMin { continue }
                let due = live.filter { h in
                    if hitsFor(h).contains(date) { return false }
                    switch Schedule(h) {
                    case .days(let days):
                        return days.contains(LocalDate.weekday(date))
                    case .weekly:
                        guard let pr = ScheduleResolver.weekProgress(
                            Schedule(h), today: date, hitDates: hitsFor(h), bounds: ScheduleBounds(h, tz: tz)
                        ) else { return false }
                        return pr.remaining > 0
                    }
                }
                guard !due.isEmpty else { continue }
                out.append(Planned(
                    id: "\(prefix)digest.\(date)",
                    date: date,
                    minutes: prefs.digestMinutes,
                    title: "Today's intentions — \(due.count) habit\(due.count == 1 ? "" : "s")",
                    body: due.map(intentionLine).joined(separator: "\n")
                ))
            }
        }

        return out
    }

    private static func hitsFor(_ h: Habit) -> Set<String> {
        Set((h.logs ?? []).filter(\.isSuccess).map(\.date))
    }

    /// One habit's implementation intention, as a sentence.
    ///
    /// Mirrors `intentionLine()` in server/src/lib/digest.ts and the cue line
    /// on the habit card, so the notification, the email that preceded it and
    /// the card all phrase the same habit the same way.
    static func intentionLine(for h: Habit) -> String {
        if h.kind == "break" {
            let instead = stripIWill(h.replacementAction?.trimmed.nonEmpty ?? "")
            let trigger = h.avoidTrigger?.trimmed.nonEmpty
            if let trigger, !instead.isEmpty { return "When \(trigger), I'll \(instead) instead" }
            if !instead.isEmpty { return "I'll \(instead) instead of slipping" }
            return "Stay free today — one clean day is a vote"
        }
        let action = stripIWill(h.failSafeAction.trimmed)
        var cue = ""
        switch h.cueType {
        case "habit_stack": if let a = h.anchorRoutine?.trimmed.nonEmpty { cue = "After I \(a)" }
        case "time": if let t = h.cueTime?.trimmed.nonEmpty { cue = "At \(t)" }
        case "location": if let l = h.cueLocation?.trimmed.nonEmpty { cue = "When I get to \(l)" }
        default: break
        }
        if cue.isEmpty { return action.isEmpty ? h.title : "I will \(action)" }
        return "\(cue), I will \(action)"
    }

    private static func stripIWill(_ s: String) -> String {
        s.replacingOccurrences(of: #"^i will\s+"#, with: "", options: [.regularExpression, .caseInsensitive])
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

    /// The soonest planned notification, for Settings to show that reminders
    /// are really queued on this phone.
    static func next() async -> (title: String, at: Date)? {
        let pending = await UNUserNotificationCenter.current().pendingNotificationRequests()
        return pending
            .filter { $0.identifier.hasPrefix(prefix) }
            .compactMap { r in (r.trigger as? UNCalendarNotificationTrigger)?.nextTriggerDate().map { (r.content.title, $0) } }
            .min { $0.1 < $1.1 }
    }

    /// Replace every pending One Percent notification with a fresh plan.
    static func reschedule(
        habits: [Habit],
        checkIns: [CheckIn],
        tz: String,
        enabled: Bool = true,
        prefs: Prefs = .default,
        now: Date = Date()
    ) async {
        let center = UNUserNotificationCenter.current()
        #if os(macOS)
        // The iPhone owns reminders; with the data synced, a Mac planning the
        // same ones would send every nudge twice.
        let planned: [Planned] = []
        #else
        let planned = enabled ? plan(habits: habits, checkIns: checkIns, now: now, tz: tz, prefs: prefs) : []
        #endif
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
