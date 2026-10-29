import Foundation
import SwiftData
import Testing
@testable import One_Percent

// Habit design + Compass against the real routes, driven the way the web
// Architect and Compass pages drive them (see golden.mts, section 3b).

/// Apply a form-shaped JSON object onto a draft, key by key.
func applyForm(_ f: [String: Any], to d: inout HabitDraft, goals: [Goal]) {
    for (k, v) in f {
        switch k {
        case "kind": d.kind = v as! String
        case "goalTitle": d.goal = goals.sorted { $0.createdAt < $1.createdAt }.first { $0.title == v as! String }
        case "breakMode": d.breakMode = v as! String
        case "checkStyle": d.checkStyle = v as! String
        case "checkQuestion": d.checkQuestion = v as! String
        case "avoidTrigger": d.avoidTrigger = v as! String
        case "replacementAction": d.replacementAction = v as! String
        case "frictionDevice": d.frictionDevice = v as! String
        case "title": d.title = v as! String
        case "whyText": d.whyText = v as! String
        case "cueType": d.cueType = v as! String
        case "anchorRoutine": d.anchorRoutine = v as! String
        case "cueTime": d.cueTime = v as! String
        case "cueLocation": d.cueLocation = v as! String
        case "failSafeAction": d.failSafeAction = v as! String
        case "celebration": d.celebration = v as! String
        case "temptationBundle": d.temptationBundle = v as! String
        case "targetText": d.targetText = v as! String
        case "definitionOfDone": d.definitionOfDone = v as! String
        case "targetCount": d.targetCount = v as! Int
        case "dailyLimit": d.dailyLimit = v as! Int
        case "reminderTime": d.reminderTime = v as! String
        case "reminderEnabled": d.reminderEnabled = v as! Bool
        case "nightstandRule": d.nightstandRule = v as! String
        case "systemFocusConfirmed": d.systemFocusConfirmed = v as! Bool
        case "scheduleType": d.scheduleType = v as! String
        case "days": d.days = v as! [Int]
        case "timesPerWeek": d.timesPerWeek = v as! Int
        case "setbacks": d.setbacks = (v as! [[String: String]]).map { SetbackPlan(obstacle: $0["obstacle"] ?? "", plan: $0["plan"] ?? "") }
        case "sectionNotes": d.sectionNotes = v as! [String: String]
        case "extraPhases": d.extraPhases = (v as! [[String: Any]]).map(ladderStep)
        default: Issue.record("unknown form key \(k)")
        }
    }
}

func ladderStep(_ p: [String: Any]) -> LadderStep {
    LadderStep(targetText: p["targetText"] as! String, definitionOfDone: p["definitionOfDone"] as! String,
               targetCount: p["targetCount"] as! Int, dailyLimit: p["dailyLimit"] as! Int)
}

private func json(_ s: String?) -> Any {
    guard let s, let d = s.data(using: .utf8), let v = try? JSONSerialization.jsonObject(with: d, options: .fragmentsAllowed) else { return s ?? NSNull() }
    return v
}

private func n(_ v: Any?) -> Any { v ?? NSNull() }

@MainActor
func designShape(_ ctx: ModelContext, importedUids: Set<String>) throws -> [String: Any] {
    let habits = try ctx.fetch(FetchDescriptor<Habit>()).filter { !importedUids.contains($0.uid) }.sorted { $0.title < $1.title }
    let goals = try ctx.fetch(FetchDescriptor<Goal>()).filter { $0.sourceNote == "compass" }.sorted { $0.title < $1.title }
    let all = try ctx.fetch(FetchDescriptor<Habit>())
    let profile = try ctx.fetch(FetchDescriptor<Profile>()).first!
    return [
        "habits": habits.map { h -> [String: Any] in
            [
                "kind": h.kind, "breakMode": n(h.breakMode), "checkStyle": h.checkStyle, "checkQuestion": n(h.checkQuestion),
                "avoidTrigger": n(h.avoidTrigger), "replacementAction": n(h.replacementAction), "frictionDevice": n(h.frictionDevice),
                "title": h.title, "whyText": n(h.whyText), "cueType": h.cueType, "anchorRoutine": n(h.anchorRoutine), "cueTime": n(h.cueTime),
                "cueLocation": n(h.cueLocation), "failSafeAction": h.failSafeAction, "celebration": n(h.celebration),
                "temptationBundle": n(h.temptationBundle), "scheduleType": h.scheduleType, "scheduleDays": json(h.scheduleDays),
                "timesPerWeek": n(h.timesPerWeek), "reminderTime": n(h.reminderTime), "reminderEnabled": h.reminderEnabled,
                "nightstandRule": n(h.nightstandRule), "setbackPlans": json(h.setbackPlans), "systemFocusConfirmed": h.systemFocusConfirmed,
                "sectionNotes": json(h.sectionNotes), "goalTitle": n(h.goal?.title), "archived": h.archivedAt != nil, "paused": h.pausedAt != nil,
                "phases": h.sortedPhases.map {
                    ["n": $0.phaseNumber, "status": $0.status, "targetText": $0.targetText, "definitionOfDone": n($0.definitionOfDone),
                     "targetCount": $0.targetCount, "dailyLimit": n($0.dailyLimit)] as [String: Any]
                },
            ]
        },
        "goals": goals.map { ["title": $0.title, "domain": $0.domain, "whyText": n($0.whyText), "timeframe": n($0.timeframe), "sourceId": n($0.sourceId), "status": $0.status] as [String: Any] },
        "pausedLinked": all.filter { $0.goal != nil && $0.pausedAt != nil && $0.archivedAt == nil }.map(\.title).sorted(),
        "assessment": json(profile.assessment),
        "snapshots": try ctx.fetchCount(FetchDescriptor<CompassSnapshot>()),
    ]
}

@MainActor
func runDesignOp(_ o: [String: Any], ctx: ModelContext, now: Date) -> [String: Any] {
    do {
        let habits = try ctx.fetch(FetchDescriptor<Habit>())
        let goals = try ctx.fetch(FetchDescriptor<Goal>())
        let profile = try ctx.fetch(FetchDescriptor<Profile>()).first!
        let byTitle = { (t: String) in habits.first { $0.title == t }! }
        switch o["op"] as! String {
        case "archiveHabit":
            try HabitDesign.archive(byTitle(o["title"] as! String), now: now, ctx: ctx)
        case "createHabit":
            var d = HabitDraft()
            applyForm(o["form"] as! [String: Any], to: &d, goals: goals)
            try HabitDesign.create(d, now: now, ctx: ctx)
        case "editHabit":
            let h = byTitle(o["title"] as! String)
            var d = HabitDraft(h)
            applyForm(o["patch"] as? [String: Any] ?? [:], to: &d, goals: goals)
            let remove = o["removeExtra"] as? [Int] ?? []
            let removed = remove.compactMap { $0 < d.extraPhases.count ? d.extraPhases[$0].uid : nil }
            d.extraPhases = d.extraPhases.enumerated().filter { !remove.contains($0.offset) }.map(\.element)
                + (o["appendExtra"] as? [[String: Any]] ?? []).map(ladderStep)
            try HabitDesign.update(h, with: d, removedPhaseUids: removed, ctx: ctx)
        case "compassSave":
            let data = try JSONSerialization.data(withJSONObject: o["draft"]!)
            try Compass.save(try JSONDecoder().decode(CompassDraft.self, from: data), profile: profile, now: now, ctx: ctx)
        case "compassSnapshot":
            try Compass.snapshot(label: o["label"] as? String, profile: profile, now: now, ctx: ctx)
        case "compassRestoreLatest":
            let latest = try ctx.fetch(FetchDescriptor<CompassSnapshot>()).max { $0.createdAt < $1.createdAt }!
            _ = try Compass.restore(latest, profile: profile, now: now, ctx: ctx)
        case "compassReset":
            try Compass.reset(profile: profile, now: now, ctx: ctx)
        default:
            Issue.record("unknown design op")
        }
        return [:]
    } catch {
        return ["error": true]
    }
}

struct ConcretenessGoldenTests {
    @Test func sharpeningHintsMatchTheWeb() throws {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures/golden.json")
        guard let data = try? Data(contentsOf: url),
              let g = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let cases = g["concreteness"] as? [[String: Any]] else { return }
        for c in cases {
            var d = HabitDraft()
            // Concreteness reads raw strings; the empty form's defaults match.
            for (k, v) in c["input"] as! [String: Any] {
                switch k {
                case "kind": d.kind = v as! String
                case "title": d.title = v as! String
                case "cueType": d.cueType = v as! String
                case "anchorRoutine": d.anchorRoutine = v as! String
                case "cueTime": d.cueTime = v as! String
                case "cueLocation": d.cueLocation = v as! String
                case "failSafeAction": d.failSafeAction = v as! String
                case "targetText": d.targetText = v as! String
                case "definitionOfDone": d.definitionOfDone = v as! String
                case "celebration": d.celebration = v as! String
                case "temptationBundle": d.temptationBundle = v as! String
                case "avoidTrigger": d.avoidTrigger = v as! String
                case "replacementAction": d.replacementAction = v as! String
                case "frictionDevice": d.frictionDevice = v as! String
                default: break
                }
            }
            let checks = Concreteness.checks(d, needsTarget: c["needsTarget"] as! Bool)
            let want = (c["checks"] as! [[String: Any]]).map { "\($0["key"]!)=\($0["passed"]!)" }
            let got = checks.map { "\($0.key)=\($0.passed ? 1 : 0)" }
            #expect(got == want.map { $0.replacingOccurrences(of: "=true", with: "=1").replacingOccurrences(of: "=false", with: "=0") }, "\(c["input"]!)")
            #expect(Concreteness.score(checks) == c["score"] as! Int, "\(c["input"]!)")
        }
    }
}
