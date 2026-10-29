import Foundation
import SwiftData

// A full backup in the same shape the importer reads (one-percent-ios-export),
// so a backup restores onto a new phone exactly like the original web export.
// With no server, this file is the only copy outside iCloud — Settings offers it.
enum Exporter {
    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static func d(_ date: Date?) -> Any { date.map(iso.string) ?? NSNull() }
    private static func n(_ v: Any?) -> Any { v ?? NSNull() }
    private static func json(_ s: String?) -> Any {
        guard let s, let data = s.data(using: .utf8), let v = try? JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed) else { return NSNull() }
        return v
    }

    static func run(_ ctx: ModelContext) throws -> Data {
        let profile = try ctx.fetch(FetchDescriptor<Profile>()).first ?? Profile()
        let wsId = "ws-\(profile.uid)"

        let goals = try ctx.fetch(FetchDescriptor<Goal>(sortBy: [SortDescriptor(\.createdAt)])).map { g -> [String: Any] in
            ["id": g.uid, "title": g.title, "domain": g.domain, "whyText": n(g.whyText), "timeframe": n(g.timeframe),
             "sourceNote": n(g.sourceNote), "sourceId": n(g.sourceId), "status": g.status, "createdAt": d(g.createdAt), "updatedAt": d(g.updatedAt)]
        }

        let habits = try ctx.fetch(FetchDescriptor<Habit>(sortBy: [SortDescriptor(\.createdAt)])).map { h -> [String: Any] in
            [
                "id": h.uid, "goalId": n(h.goal?.uid), "kind": h.kind, "breakMode": n(h.breakMode), "avoidTrigger": n(h.avoidTrigger),
                "replacementAction": n(h.replacementAction), "frictionDevice": n(h.frictionDevice), "checkStyle": h.checkStyle,
                "checkQuestion": n(h.checkQuestion), "title": h.title, "whyText": n(h.whyText),
                "whyImageUrl": h.whyImageData.map { "data:image/jpeg;base64,\($0.base64EncodedString())" } ?? NSNull(),
                "anchorRoutine": n(h.anchorRoutine), "cueType": h.cueType, "cueTime": n(h.cueTime), "cueLocation": n(h.cueLocation),
                "failSafeAction": h.failSafeAction, "celebration": n(h.celebration), "temptationBundle": n(h.temptationBundle),
                "scheduleType": h.scheduleType, "scheduleDays": h.scheduleDays, "timesPerWeek": n(h.timesPerWeek),
                "reminderTime": n(h.reminderTime), "reminderEnabled": h.reminderEnabled, "nightstandRule": n(h.nightstandRule),
                "setbackPlans": h.setbackPlans, "systemFocusConfirmed": h.systemFocusConfirmed, "sectionNotes": h.sectionNotes,
                "pausedAt": d(h.pausedAt), "archivedAt": d(h.archivedAt), "createdAt": d(h.createdAt), "updatedAt": d(h.updatedAt),
                "phases": h.sortedPhases.map { p -> [String: Any] in
                    ["id": p.uid, "phaseNumber": p.phaseNumber, "targetText": p.targetText, "definitionOfDone": n(p.definitionOfDone),
                     "targetCount": p.targetCount, "dailyLimit": n(p.dailyLimit), "status": p.status, "graduatedAt": d(p.graduatedAt),
                     "createdAt": d(p.createdAt), "updatedAt": d(p.updatedAt)]
                },
                "logs": (h.logs ?? []).sorted { $0.date < $1.date }.map { l -> [String: Any] in
                    ["id": l.uid, "phaseId": n(l.phase?.uid), "date": l.date, "status": l.status, "quantity": n(l.quantity),
                     "goldilocks": n(l.goldilocks), "missReasons": l.missReasons, "missNote": n(l.missNote), "createdAt": d(l.createdAt)]
                },
                "checks": (h.checks ?? []).compactMap { c -> [String: Any]? in
                    guard let phase = c.phase else { return nil }
                    return ["id": c.uid, "phaseId": phase.uid, "scores": c.scores, "mean": c.mean, "passed": c.passed, "createdAt": d(c.createdAt)]
                },
                "metricLinks": (h.metricLinks ?? []).map { ["id": $0.uid, "metric": $0.metric, "direction": $0.direction, "lagDays": $0.lagDays, "createdAt": d($0.createdAt)] as [String: Any] },
            ]
        }

        let checkIns = try ctx.fetch(FetchDescriptor<CheckIn>(sortBy: [SortDescriptor(\.weekOf)])).map { c -> [String: Any] in
            ["id": c.uid, "weekOf": c.weekOf, "rating": n(c.rating), "tinyVictory": n(c.tinyVictory), "workingWell": n(c.workingWell),
             "notWorking": n(c.notWorking), "obstacles": c.obstacles, "freeform": n(c.freeform), "aiSummary": n(c.aiSummary),
             "status": c.status, "createdAt": d(c.createdAt), "updatedAt": d(c.updatedAt)]
        }
        let snapshots = try ctx.fetch(FetchDescriptor<CompassSnapshot>()).map { s -> [String: Any] in
            ["id": s.uid, "label": n(s.label), "assessment": json(s.assessment), "vision": json(s.vision), "goals": json(s.goals), "createdAt": d(s.createdAt)]
        }
        let chats = try ctx.fetch(FetchDescriptor<CoachConversation>(sortBy: [SortDescriptor(\.createdAt)])).map { c -> [String: Any] in
            ["id": c.uid, "title": c.title, "createdAt": d(c.createdAt), "lastMessageAt": d(c.lastMessageAt),
             "messages": c.sortedMessages.map { ["id": $0.uid, "role": $0.role, "text": $0.text, "createdAt": d($0.createdAt)] as [String: Any] }]
        }
        let days = try ctx.fetch(FetchDescriptor<BodyDay>(sortBy: [SortDescriptor(\.date)])).map { b -> [String: Any] in
            ["id": b.uid, "date": b.date, "source": b.source, "sleepMinutes": n(b.sleepMinutes), "deepMinutes": n(b.deepMinutes),
             "remMinutes": n(b.remMinutes), "sleepScore": n(b.sleepScore), "restingHr": n(b.restingHr), "hrvNight": n(b.hrvNight),
             "bodyBatteryHigh": n(b.bodyBatteryHigh), "bodyBatteryLow": n(b.bodyBatteryLow), "stressAvg": n(b.stressAvg),
             "respirationAvg": n(b.respirationAvg), "steps": n(b.steps), "activeMinutes": n(b.activeMinutes),
             "sedentarySeconds": n(b.sedentarySeconds), "sleepStartMin": n(b.sleepStartMin), "sleepEndMin": n(b.sleepEndMin),
             "avgSleepStress": n(b.avgSleepStress), "awakeCount": n(b.awakeCount), "bodyBatteryAtWake": n(b.bodyBatteryAtWake),
             "lowStressSeconds": n(b.lowStressSeconds), "highStressSeconds": n(b.highStressSeconds), "minHeartRate": n(b.minHeartRate),
             "maxHeartRate": n(b.maxHeartRate), "avgWakingRespiration": n(b.avgWakingRespiration), "fetchedAt": d(b.fetchedAt)]
        }
        let activities = try ctx.fetch(FetchDescriptor<BodyActivity>(sortBy: [SortDescriptor(\.startedAt)])).map { a -> [String: Any] in
            ["source": a.source, "externalId": a.externalId, "type": a.type, "startedAt": d(a.startedAt), "localDate": a.localDate,
             "durationSec": a.durationSec, "distanceM": n(a.distanceM), "avgHr": n(a.avgHr)]
        }
        let book = try ctx.fetch(FetchDescriptor<BookChunk>(sortBy: [SortDescriptor(\.idx)])).map { ["idx": $0.idx, "content": $0.content] as [String: Any] }

        let out: [String: Any] = [
            "format": "one-percent-ios-export",
            "version": 1,
            "exportedAt": iso.string(from: Date()),
            "user": ["name": n(profile.name), "timezone": profile.timezone, "personalContext": n(profile.personalContext),
                     "assessment": n(profile.assessment), "createdAt": d(profile.createdAt)],
            "workstations": [[
                "id": wsId, "compassDraft": json(profile.compassDraft), "momentumInsights": n(profile.momentumInsights),
                "momentumInsightsAt": d(profile.momentumInsightsAt), "goals": goals, "checkIns": checkIns,
                "compassSnapshots": snapshots, "coachChats": chats, "habits": habits,
            ]],
            "wearableDays": days,
            "wearableActivities": activities,
            "bookChunks": book,
        ]
        return try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])
    }
}
