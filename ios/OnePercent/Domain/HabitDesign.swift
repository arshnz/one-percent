import Foundation
import SwiftData

// Designing a habit — a port of the create/update/phase/archive routes in
// server/src/routes/habits.ts plus the Architect's own client-side rules
// (client/src/pages/Architect.tsx) and concreteness scoring
// (client/src/lib/concreteness.ts).

struct LadderStep: Equatable, Identifiable {
    /// The existing Phase's uid when editing; nil for a step not saved yet.
    var uid: String?
    var targetText = ""
    var definitionOfDone = ""
    var targetCount = 21
    var dailyLimit = 0
    var id = UUID()
}

/// The Architect form, field for field.
struct HabitDraft: Equatable {
    var kind = "build"
    var goal: Goal?
    var breakMode = "abstain"
    var checkStyle = "hold"
    var checkQuestion = ""
    var avoidTrigger = ""
    var replacementAction = ""
    var frictionDevice = ""
    var title = ""
    var whyText = ""
    var whyImageData: Data?
    var cueType = "habit_stack"
    var anchorRoutine = ""
    var cueTime = ""
    var cueLocation = ""
    var failSafeAction = ""
    var celebration = ""
    var temptationBundle = ""
    var targetText = ""
    var definitionOfDone = ""
    var targetCount = 14
    var dailyLimit = 2
    var reminderTime = ""
    var reminderEnabled = true
    var nightstandRule = ""
    var systemFocusConfirmed = false
    var scheduleType = "days"
    var days = Schedule.allDays
    var timesPerWeek = 3
    var setbacks: [SetbackPlan] = []
    var sectionNotes: [String: String] = [:]
    /// Locked steps 2..N of the ladder (phase 1 lives in the fields above).
    var extraPhases: [LadderStep] = []
    /// "I can do this fail-safe in under two minutes."
    var confirmedQuick = false

    var breaking: Bool { kind == "break" }
    var taper: Bool { breaking && breakMode == "taper" }

    static func == (a: Self, b: Self) -> Bool {
        a.title == b.title && a.kind == b.kind && a.goal === b.goal && a.extraPhases == b.extraPhases && a.setbacks == b.setbacks
            && a.failSafeAction == b.failSafeAction && a.targetText == b.targetText && a.days == b.days && a.scheduleType == b.scheduleType
    }

    init() {}

    /// Load an existing habit for editing.
    init(_ h: Habit) {
        let phase = h.sortedPhases.first { $0.status == "active" || $0.status == "ready" }
        kind = h.kind
        goal = h.goal
        breakMode = h.breakMode ?? "abstain"
        checkStyle = h.checkStyle
        checkQuestion = h.checkQuestion ?? ""
        avoidTrigger = h.avoidTrigger ?? ""
        replacementAction = h.replacementAction ?? ""
        frictionDevice = h.frictionDevice ?? ""
        title = h.title
        whyText = h.whyText ?? ""
        whyImageData = h.whyImageData
        cueType = h.cueType
        anchorRoutine = h.anchorRoutine ?? ""
        cueTime = h.cueTime ?? ""
        cueLocation = h.cueLocation ?? ""
        failSafeAction = h.failSafeAction
        celebration = h.celebration ?? ""
        temptationBundle = h.temptationBundle ?? ""
        targetText = phase?.targetText ?? ""
        definitionOfDone = phase?.definitionOfDone ?? ""
        targetCount = phase?.targetCount ?? 14
        dailyLimit = phase?.dailyLimit ?? 2
        reminderTime = h.reminderTime ?? ""
        reminderEnabled = h.reminderEnabled
        nightstandRule = h.nightstandRule ?? ""
        systemFocusConfirmed = h.systemFocusConfirmed
        scheduleType = h.scheduleType == "weekly" ? "weekly" : "days"
        if case .days(let d) = Schedule(scheduleType: "days", scheduleDays: h.scheduleDays, timesPerWeek: nil) { days = d }
        if let t = h.timesPerWeek { timesPerWeek = t }
        setbacks = h.setbackPlanList
        sectionNotes = JSONText.decode([String: String].self, h.sectionNotes, default: [:])
        extraPhases = h.sortedPhases.filter { $0.status == "locked" }.map {
            LadderStep(uid: $0.uid, targetText: $0.targetText, definitionOfDone: $0.definitionOfDone ?? "", targetCount: $0.targetCount, dailyLimit: $0.dailyLimit ?? 0)
        }
        confirmedQuick = true
    }
}

enum HabitDesign {
    /// Six slots on the Launchpad.
    static let maxHabits = 6
    static let noteKeys = ["cue", "craving", "response", "reward", "setbacks"]

    enum DesignError: LocalizedError, Equatable {
        case noCue, noTrigger, atCap

        var errorDescription: String? {
            switch self {
            case .noCue: "Give the cue a concrete trigger — a routine, a time, or a place."
            case .noTrigger: "Name the trigger you’re removing — the cue that sets the habit off."
            case .atCap: "Six habits is the hard ceiling — and honestly, one at a time sticks best. Archive or pause one to start another."
            }
        }
    }

    private static func clean(_ s: String) -> String? { s.trimmed.nonEmpty }

    /// Only rows where both halves are filled make it into the saved plan.
    static func cleanSetbacks(_ rows: [SetbackPlan]) -> [SetbackPlan] {
        rows.map { SetbackPlan(obstacle: $0.obstacle.trimmed, plan: $0.plan.trimmed) }.filter { !$0.obstacle.isEmpty && !$0.plan.isEmpty }
    }

    static func cleanNotes(_ notes: [String: String]) -> [String: String] {
        var out: [String: String] = [:]
        for k in noteKeys { if let v = notes[k]?.trimmed.nonEmpty { out[k] = v } }
        return out
    }

    /// A build habit needs a concrete cue; a break habit needs the trigger it removes.
    static func cueValid(_ d: HabitDraft) -> Bool {
        if d.breaking { return !d.avoidTrigger.trimmed.isEmpty }
        switch d.cueType {
        case "habit_stack": return !d.anchorRoutine.trimmed.isEmpty
        case "time": return !d.cueTime.trimmed.isEmpty
        case "location": return !d.cueLocation.trimmed.isEmpty
        default: return false
        }
    }

    /// The Architect's save gate.
    static func isValid(_ d: HabitDraft, editing: Habit?, liveCount: Int) -> Bool {
        let needsTarget = editing == nil || editingPhase(editing!) != nil
        return !d.title.trimmed.isEmpty && cueValid(d) && !d.failSafeAction.trimmed.isEmpty
            && (!needsTarget || (!d.targetText.trimmed.isEmpty && d.targetCount > 0))
            && d.extraPhases.allSatisfy { !$0.targetText.trimmed.isEmpty && $0.targetCount > 0 }
            && (d.scheduleType == "weekly" || !d.days.isEmpty)
            && d.confirmedQuick
            && (editing != nil || liveCount < maxHabits)
    }

    static func editingPhase(_ h: Habit) -> Phase? {
        h.sortedPhases.first { $0.status == "active" || $0.status == "ready" }
    }

    /// The reminder fires at its own time, falling back to a time-based cue.
    private static func reminder(_ d: HabitDraft) -> (Bool, String?) {
        guard d.reminderEnabled else { return (false, nil) }
        let t = d.reminderTime.trimmed.nonEmpty ?? (d.cueType == "time" ? d.cueTime.trimmed.nonEmpty : nil)
        return (true, t)
    }

    /// Everything but phases, written onto a habit — shared by create and update.
    private static func apply(_ d: HabitDraft, to h: Habit) {
        let breaking = d.breaking, taper = d.taper
        h.goal = d.goal
        h.breakMode = breaking ? d.breakMode : nil
        h.checkStyle = taper ? "hold" : d.checkStyle
        h.checkQuestion = d.checkStyle == "yesno" && !taper ? clean(d.checkQuestion) : nil
        h.avoidTrigger = breaking ? clean(d.avoidTrigger) : nil
        h.replacementAction = breaking ? clean(d.replacementAction) : nil
        h.frictionDevice = breaking ? clean(d.frictionDevice) : nil
        h.title = d.title.trimmed
        h.whyText = clean(d.whyText)
        h.whyImageData = d.whyImageData
        h.cueType = d.cueType
        h.anchorRoutine = d.cueType == "habit_stack" ? d.anchorRoutine.trimmed : nil
        h.cueTime = d.cueType == "time" ? d.cueTime.trimmed : nil
        h.cueLocation = d.cueType == "location" ? d.cueLocation.trimmed : nil
        h.failSafeAction = d.failSafeAction.trimmed
        h.celebration = clean(d.celebration)
        h.temptationBundle = clean(d.temptationBundle)
        if d.scheduleType == "weekly" {
            h.scheduleType = "weekly"
            h.timesPerWeek = d.timesPerWeek
        } else {
            h.scheduleType = "days"
            h.scheduleDays = JSONText.encode(d.days.sorted())
            h.timesPerWeek = nil
        }
        let (on, time) = reminder(d)
        h.reminderEnabled = on
        h.reminderTime = time
        h.nightstandRule = clean(d.nightstandRule)
        h.setbackPlans = JSONText.encode(Array(cleanSetbacks(d.setbacks).prefix(3)))
        h.systemFocusConfirmed = d.systemFocusConfirmed
        h.sectionNotes = JSONText.encode(cleanNotes(d.sectionNotes))
        h.updatedAt = Date()
    }

    private static func checkRules(_ d: HabitDraft) throws {
        if d.breaking {
            if d.avoidTrigger.trimmed.isEmpty { throw DesignError.noTrigger }
        } else if !cueValid(d) {
            throw DesignError.noCue
        }
    }

    /// Create a habit with its fail-safe and the whole ladder: step 1 active,
    /// the rest locked behind it.
    @discardableResult
    static func create(_ d: HabitDraft, now: Date = Date(), ctx: ModelContext) throws -> Habit {
        try checkRules(d)
        let live = try ctx.fetch(FetchDescriptor<Habit>(predicate: #Predicate { $0.archivedAt == nil })).count
        guard live < maxHabits else { throw DesignError.atCap }

        let h = Habit(title: d.title.trimmed, failSafeAction: d.failSafeAction.trimmed)
        h.kind = d.kind
        h.createdAt = now
        ctx.insert(h)
        apply(d, to: h)

        let first = LadderStep(targetText: d.targetText, definitionOfDone: d.definitionOfDone, targetCount: d.targetCount, dailyLimit: d.dailyLimit)
        for (i, step) in ([first] + d.extraPhases).prefix(6).enumerated() {
            let p = Phase(phaseNumber: i + 1, targetText: step.targetText.trimmed)
            ctx.insert(p)
            p.habit = h
            p.definitionOfDone = clean(step.definitionOfDone)
            p.targetCount = step.targetCount
            p.dailyLimit = d.taper ? step.dailyLimit : nil
            p.status = i == 0 ? "active" : "locked"
            p.createdAt = now
        }
        try ctx.save()
        return h
    }

    /// Save an edit: the habit's fields, its current milestone, and the
    /// upcoming (locked) ladder — removed steps go, edited ones update, new
    /// ones append behind the current.
    static func update(_ h: Habit, with d: HabitDraft, removedPhaseUids: [String], ctx: ModelContext) throws {
        var rules = d
        rules.kind = h.kind
        try checkRules(rules)
        apply(rules, to: h)

        if let phase = editingPhase(h) {
            phase.targetText = d.targetText.trimmed
            phase.definitionOfDone = clean(d.definitionOfDone)
            phase.targetCount = d.targetCount
            phase.dailyLimit = rules.taper ? d.dailyLimit : nil
            phase.updatedAt = Date()
        }
        for uid in removedPhaseUids {
            if let p = (h.phases ?? []).first(where: { $0.uid == uid }), p.status == "locked" { ctx.delete(p) }
        }
        try ctx.save()
        for step in d.extraPhases {
            if let uid = step.uid, let p = (h.phases ?? []).first(where: { $0.uid == uid }) {
                guard p.status != "graduated" else { continue }
                p.targetText = step.targetText.trimmed
                p.definitionOfDone = clean(step.definitionOfDone)
                p.targetCount = step.targetCount
                p.dailyLimit = rules.taper ? step.dailyLimit : nil
                p.updatedAt = Date()
            } else {
                try DailyLoop.addPhase(h, targetText: step.targetText.trimmed, definitionOfDone: clean(step.definitionOfDone),
                                       targetCount: step.targetCount, dailyLimit: rules.taper ? step.dailyLimit : nil, ctx: ctx)
            }
        }
        try ctx.save()
    }

    /// "Delete" keeps the history: the habit is archived, its earned days stay
    /// on the compound curve, and it leaves every current view.
    static func archive(_ h: Habit, now: Date = Date(), ctx: ModelContext) throws {
        h.archivedAt = now
        h.updatedAt = now
        try ctx.save()
    }
}

// MARK: - Concreteness

/// Gentle sharpening hints — a port of client/src/lib/concreteness.ts.
enum Concreteness {
    struct Check: Equatable {
        let key: String
        let label: String
        let passed: Bool
        let weight: Int
        let hint: String
    }

    private static func words(_ s: String) -> [Substring] { s.trimmed.split(whereSeparator: \.isWhitespace) }

    private static func matches(_ s: String, _ pattern: String) -> Bool {
        s.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// One genuinely tiny action: short, a single step, no "and".
    static func failSafeIsTiny(_ s: String) -> Bool {
        let t = s.trimmed
        guard !t.isEmpty else { return false }
        return t.count <= 80 && words(t).count <= 12 && !matches(t, " and ")
    }

    /// A number with a unit (mins, reps, pages, km…) or a duration.
    static func targetIsMeasurable(_ s: String) -> Bool {
        matches(s, #"\d"#) && matches(s, #"\d\s*(min|minute|sec|second|hour|hr|rep|page|pp|km|mile|set|round|lap|glass|cup|bottle|serving|word|step|x|m)(?:es|s)?\b"#)
    }

    /// Reads as identity ("I am someone who…"), not a to-do.
    static func isIdentityPhrased(_ s: String) -> Bool {
        matches(s.trimmed, #"^\s*i\s*('?m| am|\s+am)\b|^\s*i\s+am\s+(a|an|someone|the kind)"#)
    }

    private static func cueIsConcrete(_ d: HabitDraft) -> Bool {
        switch d.cueType {
        case "habit_stack": return words(d.anchorRoutine).count >= 2
        case "time": return matches(d.cueTime, #"\d"#)
        case "location": return d.cueLocation.trimmed.count >= 2
        default: return false
        }
    }

    static func checks(_ d: HabitDraft, needsTarget: Bool) -> [Check] {
        let identity = !d.title.trimmed.isEmpty && isIdentityPhrased(d.title)
        if d.breaking {
            var c = [
                Check(key: "identity", label: "Identity-phrased name", passed: identity, weight: 15, hint: "Frame it as freedom — “I am someone who is free of…”."),
                Check(key: "trigger", label: "Trigger identified", passed: !d.avoidTrigger.trimmed.isEmpty, weight: 15, hint: "Name the cue that sets the habit off — the thing to make invisible."),
                Check(key: "risk", label: "Moment of risk", passed: cueIsConcrete(d), weight: 10, hint: "Pin when the urge usually strikes — a time, a routine, or a place."),
                Check(key: "replacement", label: "Replacement defined", passed: !d.replacementAction.trimmed.isEmpty, weight: 10, hint: "Decide what you’ll do instead when the urge hits."),
                Check(key: "failsafe", label: "Two-minute resist", passed: failSafeIsTiny(d.failSafeAction), weight: 10, hint: "One tiny action to ride out the urge (e.g. “phone face-down, 3 breaths”)."),
                Check(key: "friction", label: "Friction device", passed: !d.frictionDevice.trimmed.isEmpty, weight: 15, hint: "Add a barrier that makes the habit harder (a blocker, distance, a rule)."),
                Check(key: "cost", label: "Real cost named", passed: !d.temptationBundle.trimmed.isEmpty, weight: 10, hint: "Name what this habit truly costs you — make it unattractive."),
                Check(key: "accountability", label: "Accountability set", passed: !d.celebration.trimmed.isEmpty, weight: 10, hint: "Pick an accountability hook — make a relapse unsatisfying."),
            ]
            if needsTarget {
                c.append(Check(key: "milestone", label: "Clean-day milestone", passed: targetIsMeasurable(d.targetText), weight: 15, hint: "Set a measurable milestone (e.g. “Stay scroll-free 14 days”)."))
            }
            return c
        }
        var c = [
            Check(key: "identity", label: "Identity-phrased name", passed: identity, weight: 15, hint: "Start with “I am someone who…” so the name names a person, not a task."),
            Check(key: "cue", label: "Concrete cue", passed: cueIsConcrete(d), weight: 25, hint: "Pin the trigger to a specific routine, a clock time, or a place."),
            Check(key: "failsafe", label: "Two-minute fail-safe", passed: failSafeIsTiny(d.failSafeAction), weight: 20, hint: "Shrink the gateway to one action you could do in under two minutes."),
            Check(key: "celebration", label: "Chosen celebration", passed: !d.celebration.trimmed.isEmpty, weight: 10, hint: "Pick a small immediate reward — it wires the habit in faster."),
            Check(key: "temptation", label: "Temptation bundle", passed: !d.temptationBundle.trimmed.isEmpty, weight: 10, hint: "Pair the habit with something you already enjoy — it makes starting attractive."),
        ]
        if needsTarget {
            c.append(Check(key: "measurable", label: "Measurable target", passed: targetIsMeasurable(d.targetText), weight: 15, hint: "Give the target a number and unit (e.g. “Walk 15 mins”)."))
            c.append(Check(key: "done", label: "Definition of done", passed: !d.definitionOfDone.trimmed.isEmpty, weight: 15, hint: "Name the exact finish line so there’s nothing to negotiate."))
        }
        return c
    }

    static func score(_ checks: [Check]) -> Int {
        let total = checks.reduce(0) { $0 + $1.weight }
        let earned = checks.filter(\.passed).reduce(0) { $0 + $1.weight }
        return Int((Double(earned) / Double(total) * 100).rounded())
    }
}
