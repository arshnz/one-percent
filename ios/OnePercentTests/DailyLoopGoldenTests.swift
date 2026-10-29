import Foundation
import SwiftData
import Testing
@testable import One_Percent

// The daily loop against the web app's real route handlers (GET /habits/today,
// GET /checkins/current, and every write route), as captured by
// ios/Tools/golden.mts: 80-odd moments across your history, then a scripted
// run of votes, edits, reasons, checks and check-ins.
//
// Shapes are compared as canonical JSON, so a mismatch prints both sides.

private let fixtures = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures")

private func json(_ name: String) -> Any? {
    guard let data = try? Data(contentsOf: fixtures.appendingPathComponent(name)) else { return nil }
    return try? JSONSerialization.jsonObject(with: data)
}

/// Canonical JSON text — sorted keys, so two equal structures print equal.
private func canon(_ v: Any) -> String {
    let data = try! JSONSerialization.data(withJSONObject: v, options: [.sortedKeys, .fragmentsAllowed, .withoutEscapingSlashes])
    return String(decoding: data, as: UTF8.self)
}

private func orNull(_ v: Any?) -> Any { v ?? NSNull() }

private let iso: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()

private func todayShape(_ p: TodayPayload) -> Any {
    [
        "date": p.date,
        "weekday": p.weekday,
        "habits": p.habits.map { h -> [String: Any] in
            [
                "uid": h.habit.uid,
                "phaseNumber": orNull(h.phase?.phaseNumber),
                "completedReps": h.completedReps,
                "todayStatus": orNull(h.todayLog?.status),
                "automaticity": ["eligible": h.automaticity.eligible, "due": h.automaticity.due],
                "wasPreviousMissed": h.wasPreviousMissed,
                "previousMissDate": orNull(h.previousMissDate),
                "previousMissNeedsReason": h.previousMissNeedsReason,
                "weekStrip": h.weekStrip.map { ["date": $0.date, "scheduled": $0.scheduled, "status": orNull($0.status), "editable": $0.editable] },
                "weekProgress": h.weekProgress.map {
                    ["quota": $0.quota, "hits": $0.hits, "remaining": $0.remaining, "daysLeft": $0.daysLeft, "obligatedToday": $0.obligatedToday] as Any
                } ?? NSNull(),
            ]
        },
    ]
}

private func checkinShape(_ c: CheckInPack) -> Any {
    [
        "weekOf": c.weekOf,
        "existingStatus": orNull(c.existing?.status),
        "summary": c.summary.map {
            ["title": $0.title, "goalTitle": orNull($0.goalTitle), "scheduleType": $0.scheduleType, "scheduled": $0.scheduled, "hits": $0.hits, "redDots": $0.redDots] as [String: Any]
        },
        "unexplainedMisses": c.unexplainedMisses.map { ["uid": $0.habit.uid, "date": $0.date, "weekdayName": $0.weekdayName, "obstacles": $0.obstacles] as [String: Any] },
        "goals": c.goals,
        "priorObstacles": c.priorObstacles.map { ["obstacle": $0.obstacle, "plan": $0.plan] },
    ]
}

/// JSON-in-a-string columns compare by meaning, not by key order.
private func parsed(_ s: Any?) -> Any {
    guard let s = s as? String, let d = s.data(using: .utf8), let v = try? JSONSerialization.jsonObject(with: d, options: .fragmentsAllowed) else { return orNull(s) }
    return v
}

private func habitShape(_ h: Habit) -> Any {
    [
        "paused": h.pausedAt != nil,
        "logs": (h.logs ?? []).sorted { $0.date < $1.date }.map { l -> [String: Any] in
            [
                "date": l.date, "status": l.status, "quantity": orNull(l.quantity), "goldilocks": orNull(l.goldilocks),
                "missReasons": parsed(l.missReasons), "missNote": orNull(l.missNote), "phaseNumber": orNull(l.phase?.phaseNumber),
            ]
        },
        "phases": h.sortedPhases.map { ["n": $0.phaseNumber, "status": $0.status, "targetCount": $0.targetCount, "graduated": $0.graduatedAt != nil] as [String: Any] },
        "checks": (h.checks ?? []).count,
    ]
}

private func normaliseHabit(_ v: Any) -> Any {
    guard var d = v as? [String: Any], let logs = d["logs"] as? [[String: Any]] else { return v }
    d["logs"] = logs.map { l in var l = l; l["missReasons"] = parsed(l["missReasons"]); return l }
    return d
}

private func checkinsShape(_ all: [CheckIn]) -> Any {
    all.sorted { $0.weekOf < $1.weekOf }.map { c -> [String: Any] in
        [
            "weekOf": c.weekOf, "status": c.status, "rating": orNull(c.rating), "tinyVictory": orNull(c.tinyVictory),
            "workingWell": orNull(c.workingWell), "notWorking": orNull(c.notWorking), "obstacles": parsed(c.obstacles), "freeform": orNull(c.freeform),
        ]
    }
}

private func normaliseCheckins(_ v: Any) -> Any {
    (v as? [[String: Any]])?.map { c in var c = c; c["obstacles"] = parsed(c["obstacles"]); return c } ?? v
}

private func momentumShape(_ m: MomentumData) -> Any {
    let series = Compound.progressSeries(m.curveHabits)
    let weekly = Compound.activeDaysPerWeek(m.scheduleSummaries)
    let fan = Compound.projectFan(progressDays: series.progressDays, rhythmPct: Double(m.consistency.rhythm), weeklyActive: weekly, weeks: 26)
    let cons = { (c: MomentumData.Consistency) -> [String: Any] in ["rhythm": c.rhythm, "anchoring": orNull(c.anchoring), "consistency": c.consistency] }
    let obstacle = { (o: MomentumData.Obstacle) -> [String: Any] in ["reason": o.reason, "count": o.count] }
    return [
        "totalVotes": m.totalVotes,
        "totalRecoveries": m.totalRecoveries,
        "consistency": cons(m.consistency),
        "automaticity": m.automaticity.map { ["uid": $0.habitUid, "mean": $0.mean, "passed": $0.passed] as [String: Any] },
        "weeklyRatings": m.weeklyRatings.map { ["weekOf": $0.weekOf, "rating": $0.rating] as [String: Any] },
        "ratio": ["successes": m.ratio.successes, "expected": m.ratio.expected, "pct": m.ratio.pct, "windowDays": m.ratio.windowDays],
        "contributions": m.contributions.map { ["date": $0.date, "count": $0.count] as [String: Any] },
        "habitCount": m.habitCount,
        "topObstacle": m.topObstacle.map(obstacle) ?? NSNull(),
        "trajectory": m.trajectory.map { t -> [String: Any] in
            [
                "uid": t.habit.uid,
                "consistency": cons(t.consistency),
                "contributions": t.contributions.map {
                    ["date": $0.date, "count": $0.count, "wasSavedMiss": $0.wasSavedMiss, "status": orNull($0.status), "scheduled": $0.scheduled, "missReasons": orNull($0.missReasons)] as [String: Any]
                },
                "topObstacles": t.topObstacles.map(obstacle),
                "missPattern": orNull(t.missPattern),
                "setbackObstacles": t.setbackObstacles,
                "phases": t.phases.map { ["n": $0.phaseNumber, "status": $0.status, "targetCount": $0.targetCount, "graduated": $0.graduatedAt != nil] as [String: Any] },
            ]
        },
        "archivedCount": m.archived.count,
        "curve": [
            "progressDays": series.progressDays, "activeDays": series.activeDays, "length": series.actual.count,
            "first": orNull(series.actual.first?.date), "last": orNull(series.actual.last?.date),
            "lastValue": orNull(series.actual.last?.value), "lastCeiling": orNull(series.ceiling.last?.value),
            "weeklyActive": weekly, "paceEnd": fan.paceEnd, "oneMoreEnd": fan.oneMoreEnd,
        ] as [String: Any],
    ]
}

/// The web returned habits in database order (unspecified); iOS sorts by
/// creation. Compare habit by habit.
private func byUid(_ v: Any) -> Any {
    guard var d = v as? [String: Any], let t = d["trajectory"] as? [[String: Any]] else { return v }
    d["trajectory"] = t.sorted { ($0["uid"] as! String) < ($1["uid"] as! String) }
    return d
}

/// Floats compare to 12 significant digits — the same maths in two languages
/// can differ in the last bit of a pow().
private func rounded(_ v: Any) -> Any {
    switch v {
    case let d as [String: Any]: return d.mapValues(rounded)
    case let a as [Any]: return a.map(rounded)
    case let n as NSNumber where CFNumberIsFloatType(n) && CFGetTypeID(n) != CFBooleanGetTypeID():
        let x = n.doubleValue
        return x == x.rounded() ? NSNumber(value: Int(x)) : NSNumber(value: Double(String(format: "%.12g", x))!)
    default: return v
    }
}

@MainActor
struct DailyLoopGoldenTests {
    private func setUp() throws -> (ModelContext, [String: Any])? {
        guard let golden = json("golden.json") as? [String: Any],
              let data = try? Data(contentsOf: fixtures.appendingPathComponent("export.json")) else { return nil }
        let container = try ModelContainer(for: Schema(AppSchema.models), configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = container.mainContext
        try Importer.run(data, into: ctx)
        // Keep the container alive for the test's duration.
        Self.keepAlive = container
        return (ctx, golden)
    }

    private static var keepAlive: ModelContainer?

    private func expectViews(_ views: [[String: Any]], ctx: ModelContext, tz: String, label: String) throws {
        let habits = try ctx.fetch(FetchDescriptor<Habit>())
        let checkIns = try ctx.fetch(FetchDescriptor<CheckIn>())
        let goals = try ctx.fetch(FetchDescriptor<Goal>())
        for v in views {
            let at = try #require(iso.date(from: v["now"] as! String))
            let today = canon(todayShape(TodayState.build(habits, now: at, tz: tz)))
            let wantToday = canon(v["today"]!)
            #expect(today == wantToday, "\(label) /today at \(v["now"]!)\nswift: \(today)\nweb:   \(wantToday)")
            let pack = canon(checkinShape(CheckInPack.current(habits: habits, checkIns: checkIns, goals: goals, now: at, tz: tz)))
            let wantPack = canon(v["checkin"]!)
            #expect(pack == wantPack, "\(label) /checkins/current at \(v["now"]!)\nswift: \(pack)\nweb:   \(wantPack)")
        }
    }

    @Test func todayAndCheckInMatchAcrossHistory() throws {
        guard let (ctx, g) = try setUp() else { return }
        try expectViews(g["views"] as! [[String: Any]], ctx: ctx, tz: g["tz"] as! String, label: "history")
    }

    private func expectMomentum(_ views: [[String: Any]], ctx: ModelContext, tz: String, label: String) throws {
        let habits = try ctx.fetch(FetchDescriptor<Habit>())
        let checkIns = try ctx.fetch(FetchDescriptor<CheckIn>())
        for v in views {
            let at = try #require(iso.date(from: v["now"] as! String))
            let got = canon(rounded(byUid(momentumShape(Momentum.compute(habits: habits, checkIns: checkIns, now: at, tz: tz)))))
            let want = canon(rounded(byUid(v["momentum"]!)))
            if got != want {
                // Leave both sides on disk (gitignored) for a structural diff.
                try? got.write(to: fixtures.appendingPathComponent("debug-swift.json"), atomically: true, encoding: .utf8)
                try? want.write(to: fixtures.appendingPathComponent("debug-web.json"), atomically: true, encoding: .utf8)
            }
            #expect(got == want, "\(label) /momentum at \(v["now"]!)\nswift: \(got.prefix(3000))\nweb:   \(want.prefix(3000))")
        }
    }

    @Test func momentumMatchesAcrossHistory() throws {
        guard let (ctx, g) = try setUp() else { return }
        try expectMomentum(g["momentumViews"] as! [[String: Any]], ctx: ctx, tz: g["tz"] as! String, label: "history")
    }

    @Test func writesMatchTheWebRoutes() throws {
        guard let (ctx, g) = try setUp() else { return }
        let tz = g["tz"] as! String
        let now = try #require(iso.date(from: g["now"] as! String))
        let today = LocalDate.of(now, tz: tz)
        let byUid = Dictionary(uniqueKeysWithValues: try ctx.fetch(FetchDescriptor<Habit>()).map { ($0.uid, $0) })

        for (i, step) in (g["scenario"] as! [[String: Any]]).enumerated() {
            let op = step["op"] as! String
            let h = (step["habit"] as? String).flatMap { byUid[$0] }
            var result: [String: Any] = [:]
            do {
                switch op {
                case "vote":
                    let r = try DailyLoop.vote(
                        h!, status: step["status"] as? String, quantity: step["quantity"] as? Int,
                        goldilocks: step["goldilocks"] as? String, date: step["date"] as? String, today: today, now: now, ctx: ctx
                    )
                    result = ["completedReps": r.completedReps, "ready": r.ready]
                case "reason":
                    try DailyLoop.recordReason(h!, date: step["date"] as! String, reasons: step["reasons"] as! [String], note: step["note"] as? String, today: today, now: now, ctx: ctx)
                case "clear":
                    try DailyLoop.clear(h!, date: step["date"] as? String ?? today, today: today, ctx: ctx)
                case "check":
                    let r = try DailyLoop.submitCheck(h!, scores: step["scores"] as! [Int], now: now, ctx: ctx)
                    result = ["passed": r.passed, "mean": r.mean, "advanced": r.advanced, "nextPhaseNumber": orNull(r.nextPhaseNumber)]
                case "addPhase":
                    try DailyLoop.addPhase(h!, targetText: step["targetText"] as! String, definitionOfDone: nil, targetCount: step["targetCount"] as! Int, ctx: ctx)
                case "pause":
                    try DailyLoop.setPaused(h!, step["paused"] as! Bool, now: now, ctx: ctx)
                case "checkinSave":
                    var d = CheckInPack.Draft()
                    d.rating = step["rating"] as? Int
                    d.tinyVictory = step["tinyVictory"] as? String ?? ""
                    d.workingWell = step["workingWell"] as? String ?? ""
                    d.notWorking = step["notWorking"] as? String ?? ""
                    d.freeform = step["freeform"] as? String ?? ""
                    d.obstacles = (step["obstacles"] as! [[String: String]]).map { SetbackPlan(obstacle: $0["obstacle"]!, plan: $0["plan"]!) }
                    try CheckInPack.save(weekOf: step["weekOf"] as! String, d, existing: try ctx.fetch(FetchDescriptor<CheckIn>()), ctx: ctx)
                case "skip":
                    try CheckInPack.skip(weekOf: step["weekOf"] as! String, existing: try ctx.fetch(FetchDescriptor<CheckIn>()), ctx: ctx)
                default:
                    Issue.record("unknown op \(op)")
                }
            } catch {
                result = ["error": true]
            }

            let label = "step \(i) \(op) \(step["habit"] ?? "") \(step["date"] ?? "")"
            #expect(canon(result) == canon(step["result"]!), "\(label) result\nswift: \(canon(result))\nweb:   \(canon(step["result"]!))")
            if let h, let want = step["habitAfter"], !(want is NSNull) {
                let got = canon(habitShape(h)), exp = canon(normaliseHabit(want))
                #expect(got == exp, "\(label) state\nswift: \(got)\nweb:   \(exp)")
            }
            if let want = step["checkinsAfter"], !(want is NSNull) {
                let got = canon(checkinsShape(try ctx.fetch(FetchDescriptor<CheckIn>()))), exp = canon(normaliseCheckins(want))
                #expect(got == exp, "\(label) check-ins\nswift: \(got)\nweb:   \(exp)")
            }
        }

        try expectViews(g["afterViews"] as! [[String: Any]], ctx: ctx, tz: tz, label: "after scenario")
        try expectMomentum(g["afterMomentum"] as! [[String: Any]], ctx: ctx, tz: tz, label: "after scenario")
    }

    @Test func reasonChipsMatchTheWeb() {
        let plans = #"[{"obstacle":"I get home after 7pm and the kids need dinner straight away","plan":"x"},{"obstacle":"Tired","plan":"y"}]"#
        // The 40-char cut drops the trailing partial word, as the web regex did.
        #expect(MissReasons.chips(setbackPlans: plans) == [
            "I get home after 7pm and the kids need…", "Tired", "No time", "Travel", "Forgot", "Sick", "Social event", "Low mood",
        ])
    }
}
