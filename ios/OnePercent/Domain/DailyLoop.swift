import Foundation
import SwiftData

// The daily loop's write rules — a port of server/src/routes/logs.ts,
// automaticity.ts and the pause/phase routes in habits.ts.
//
// Each target/failsafe is one Identity Vote. Reaching the rep floor makes the
// phase `ready` for the Automaticity Check; passing the check is what graduates
// it. A `miss` records the day without a vote and never claws back banked
// progress.

enum Phases {
    /// The phase a habit is working on: a `ready` one first (it's waiting on its
    /// check), then `active`, else the highest-numbered.
    static func current(_ h: Habit) -> Phase? {
        let phases = h.sortedPhases
        return phases.first { $0.status == "ready" }
            ?? phases.first { $0.status == "active" }
            ?? phases.last
    }

    /// Successful reps logged against a phase, ever.
    static func completedReps(_ p: Phase) -> Int {
        (p.logs ?? []).filter(\.isSuccess).count
    }
}

enum Automaticity {
    /// Mean of the four SRBAI items (1–5) needed to pass.
    static let passThreshold = 4.0
    /// After a failed check, ask again this many days later.
    static let repromptDays = 7.0

    /// The 4-item Self-Report Behavioural Automaticity Index.
    static let items = [
        "I do it automatically.",
        "I do it without having to consciously remember.",
        "I do it without thinking.",
        "I start doing it before I realise I’m doing it.",
    ]

    struct State: Equatable {
        let eligible: Bool
        let due: Bool
    }

    static func state(_ phase: Phase?, now: Date) -> State {
        guard let phase, phase.status == "ready" else { return State(eligible: false, due: false) }
        guard let last = (phase.checks ?? []).max(by: { $0.createdAt < $1.createdAt }) else {
            return State(eligible: true, due: true)
        }
        if last.passed { return State(eligible: true, due: false) }
        return State(eligible: true, due: now.timeIntervalSince(last.createdAt) / 86_400 >= repromptDays)
    }
}

enum DailyLoop {
    enum LoopError: LocalizedError {
        case outsideWindow, notReady

        var errorDescription: String? {
            switch self {
            case .outsideWindow: "You can only change the last 7 days."
            case .notReady: "This habit isn’t ready for an Automaticity Check yet."
            }
        }
    }

    struct VoteResult {
        let log: HabitLog
        let completedReps: Int
        /// True when this vote tipped the phase into `ready`.
        let ready: Bool
    }

    /// Today back to six days ago — the WeekStrip's window.
    static func inEditWindow(_ date: String, today: String) -> Bool {
        date <= today && date >= LocalDate.shift(today, by: -6)
    }

    static func log(on h: Habit, date: String) -> HabitLog? {
        (h.logs ?? []).first { $0.date == date }
    }

    /// Record a day: a vote (target/failsafe), an explicit miss, or a taper
    /// count. Upserts — one log per habit per day.
    ///
    /// `missReasons`/`missNote` are only written when passed, so a re-vote or a
    /// Goldilocks rating never wipes an earlier "what got in the way".
    @discardableResult
    static func vote(
        _ h: Habit, status: String? = nil, quantity: Int? = nil, goldilocks: String? = nil,
        date: String? = nil, missReasons: [String]? = nil, missNote: String?? = nil,
        today: String, ctx: ModelContext
    ) throws -> VoteResult {
        let day = date ?? today
        if date != nil && !inEditWindow(day, today: today) { throw LoopError.outsideWindow }

        // Votes land on the phase being worked on. (The web app's log route
        // skipped `ready` phases here and could credit a locked future phase
        // with reps; the Today view always read the `ready` one. One rule now.)
        let phase = Phases.current(h)

        var resolved = status
        if let quantity, h.kind == "break", h.breakMode == "taper" {
            resolved = quantity <= (phase?.dailyLimit ?? 0) ? "target" : "miss"
        }
        let finalStatus = resolved ?? "target"

        let entry: HabitLog
        if let existing = log(on: h, date: day) {
            entry = existing
            entry.status = finalStatus
        } else {
            entry = HabitLog(date: day, status: finalStatus)
            ctx.insert(entry)
            entry.habit = h
            entry.missReasons = "[]"
        }
        entry.quantity = quantity
        entry.goldilocks = goldilocks
        entry.phase = phase
        if let missReasons { entry.missReasons = JSONText.encode(missReasons) }
        if let missNote { entry.missNote = missNote }

        var ready = false
        var reps = 0
        if let phase {
            reps = Phases.completedReps(phase)
            if phase.status == "active" && reps >= phase.targetCount {
                phase.status = "ready"
                phase.updatedAt = Date()
                ready = true
            }
        }
        try ctx.save()
        return VoteResult(log: entry, completedReps: reps, ready: ready)
    }

    /// "What got in the way" for a day, without touching the rest of the log.
    /// A day with no log at all (a silent miss explained later) gets a `miss`
    /// row — misses never count as votes, so phases and rhythm are unaffected.
    static func recordReason(_ h: Habit, date: String, reasons: [String], note: String?, today: String, ctx: ModelContext) throws {
        guard date <= today, date >= LocalDate.shift(today, by: -7) else { throw LoopError.outsideWindow }
        let entry: HabitLog
        if let existing = log(on: h, date: date) {
            entry = existing
        } else {
            entry = HabitLog(date: date, status: "miss")
            ctx.insert(entry)
            entry.habit = h
            entry.phase = h.sortedPhases.first { $0.status == "active" }
        }
        entry.missReasons = JSONText.encode(Array(reasons.prefix(5)))
        entry.missNote = note
        try ctx.save()
    }

    /// Clear a day. If that log had tipped its phase into `ready` and the floor
    /// is no longer met, the phase goes back to `active`.
    static func clear(_ h: Habit, date: String, today: String, ctx: ModelContext) throws {
        guard inEditWindow(date, today: today), let entry = log(on: h, date: date) else { return }
        let phase = entry.phase
        ctx.delete(entry)
        if let phase, phase.status == "ready" {
            let after = (phase.logs ?? []).filter { $0 !== entry && $0.isSuccess }.count
            if after < phase.targetCount {
                phase.status = "active"
                phase.updatedAt = Date()
            }
        }
        try ctx.save()
    }

    /// A reversible rest. Paused habits drop off Today, stop reminding, and stop
    /// decaying rhythm, but keep their full history.
    static func setPaused(_ h: Habit, _ paused: Bool, now: Date = Date(), ctx: ModelContext) throws {
        guard h.archivedAt == nil else { return }
        h.pausedAt = paused ? now : nil
        h.updatedAt = now
        try ctx.save()
    }

    struct CheckResult {
        let passed: Bool
        let mean: Double
        /// True when a pre-mapped locked phase was promoted to active.
        let advanced: Bool
        let nextPhaseNumber: Int?
    }

    /// Submit a 4-item SRBAI. Passing graduates the phase and promotes the next
    /// locked step in the ladder, if there is one.
    static func submitCheck(_ h: Habit, scores: [Int], now: Date = Date(), ctx: ModelContext) throws -> CheckResult {
        guard let phase = Phases.current(h), phase.status == "ready" else { throw LoopError.notReady }
        let mean = Double(scores.reduce(0, +)) / Double(scores.count)
        let passed = mean >= Automaticity.passThreshold

        let check = AutomaticityCheck()
        ctx.insert(check)
        check.habit = h
        check.phase = phase
        check.scores = JSONText.encode(scores)
        check.mean = mean
        check.passed = passed
        check.createdAt = now

        var next: Phase?
        if passed {
            phase.status = "graduated"
            phase.graduatedAt = now
            phase.updatedAt = now
            next = h.sortedPhases.first { $0.status == "locked" && $0.phaseNumber > phase.phaseNumber }
            next?.status = "active"
            next?.updatedAt = now
        }
        try ctx.save()
        return CheckResult(passed: passed, mean: mean, advanced: next != nil, nextPhaseNumber: next?.phaseNumber)
    }

    /// Append a step to the ladder: locked behind any live phase, or active
    /// straight away if everything has graduated.
    @discardableResult
    static func addPhase(
        _ h: Habit, targetText: String, definitionOfDone: String?, targetCount: Int, dailyLimit: Int? = nil,
        ctx: ModelContext
    ) throws -> Phase {
        let top = h.sortedPhases.last?.phaseNumber ?? 0
        let hasLive = (h.phases ?? []).contains { $0.status != "graduated" }
        let phase = Phase(phaseNumber: top + 1, targetText: targetText)
        ctx.insert(phase)
        phase.habit = h
        phase.definitionOfDone = definitionOfDone
        phase.targetCount = targetCount
        phase.dailyLimit = dailyLimit
        phase.status = hasLive ? "locked" : "active"
        try ctx.save()
        return phase
    }
}

/// JSON-in-a-string columns, as the web schema stored them.
enum JSONText {
    static func encode<T: Encodable>(_ value: T) -> String {
        guard let data = try? JSONEncoder().encode(value) else { return "null" }
        return String(decoding: data, as: UTF8.self)
    }

    static func decode<T: Decodable>(_ type: T.Type, _ text: String?, default fallback: T) -> T {
        guard let data = text?.data(using: .utf8), let v = try? JSONDecoder().decode(T.self, from: data) else { return fallback }
        return v
    }

    static func strings(_ text: String?) -> [String] {
        decode([String].self, text, default: [])
    }
}

struct SetbackPlan: Codable, Equatable, Hashable {
    var obstacle: String
    var plan: String
}

extension Habit {
    var setbackPlanList: [SetbackPlan] {
        // Tolerate rows missing either half — the web app did.
        guard let data = setbackPlans.data(using: .utf8),
              let raw = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return raw.map { SetbackPlan(obstacle: $0["obstacle"] as? String ?? "", plan: $0["plan"] as? String ?? "") }
    }
}

enum MissReasons {
    static let defaults = ["Tired", "No time", "Travel", "Forgot", "Sick", "Social event", "Low mood"]
    static let maxChips = 10

    /// Defaults merged with the habit's own setback obstacles (so the chips
    /// speak the user's language), deduped case-insensitively.
    static func chips(setbackPlans: String?, extra: [String] = []) -> [String] {
        let plans = JSONText.decode([[String: String?]].self, setbackPlans, default: [])
        let obstacles = plans.compactMap { ($0["obstacle"] ?? nil)?.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        var out: [String] = []
        var seen = Set<String>()
        for chip in obstacles + extra + defaults {
            let key = chip.lowercased()
            if chip.isEmpty || seen.contains(key) { continue }
            seen.insert(key)
            out.append(shorten(chip))
            if out.count >= maxChips { break }
        }
        return out
    }

    /// Setback obstacles can be sentences; keep chips tappable-short.
    private static func shorten(_ chip: String) -> String {
        guard chip.count > 40 else { return chip }
        let cut = String(chip.prefix(40))
        if let r = cut.range(of: #"\s+\S*$"#, options: .regularExpression) {
            return String(cut[..<r.lowerBound]) + "…"
        }
        return cut + "…"
    }

    /// A miss is "explained" by reason chips OR a free-text note.
    static func isExplained(_ log: HabitLog) -> Bool {
        !JSONText.strings(log.missReasons).isEmpty || !(log.missNote?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
    }
}
