import Foundation
import SwiftData

// One-time import of the web app's data. Refuses to run over existing data —
// a second import would double every log — so a re-import means erasing first,
// which is a deliberate, separate act (Settings → Erase all data).
enum Importer {
    struct Summary: Equatable {
        var habits = 0, logs = 0, goals = 0, checkIns = 0, chats = 0, bodyDays = 0, bookChunks = 0
    }

    enum ImportError: LocalizedError {
        case wrongFormat, alreadyHasData

        var errorDescription: String? {
            switch self {
            case .wrongFormat: "That file isn't a One Percent export."
            case .alreadyHasData: "This phone already has habits. Erase all data in Settings before importing again."
            }
        }
    }

    static func hasData(_ ctx: ModelContext) throws -> Bool {
        try ctx.fetchCount(FetchDescriptor<Habit>()) > 0 || ctx.fetchCount(FetchDescriptor<Profile>()) > 0
    }

    @discardableResult
    static func run(_ data: Data, into ctx: ModelContext) throws -> Summary {
        let export = try WebExport.decode(data)
        guard export.format == "one-percent-ios-export" else { throw ImportError.wrongFormat }
        guard try !hasData(ctx) else { throw ImportError.alreadyHasData }

        var s = Summary()
        let profile = Profile()
        profile.name = export.user.name
        profile.timezone = export.user.timezone
        profile.personalContext = export.user.personalContext
        profile.assessment = export.user.assessment
        profile.createdAt = export.user.createdAt
        ctx.insert(profile)

        // The web app had one workstation per user in practice; if there were
        // ever more, they fold together.
        for ws in export.workstations {
            if let draft = ws.compassDraft { profile.compassDraft = draft.jsonString }
            if let i = ws.momentumInsights {
                profile.momentumInsights = i
                profile.momentumInsightsAt = ws.momentumInsightsAt
            }

            var goals: [String: Goal] = [:]
            for g in ws.goals {
                let goal = Goal(title: g.title)
                goal.uid = g.id
                goal.domain = g.domain
                goal.whyText = g.whyText
                goal.timeframe = g.timeframe
                goal.sourceNote = g.sourceNote
                goal.sourceId = g.sourceId
                goal.status = g.status
                goal.createdAt = g.createdAt
                goal.updatedAt = g.updatedAt
                ctx.insert(goal)
                goals[g.id] = goal
                s.goals += 1
            }

            for h in ws.habits {
                let habit = Habit(title: h.title, failSafeAction: h.failSafeAction)
                habit.uid = h.id
                ctx.insert(habit)
                habit.goal = h.goalId.flatMap { goals[$0] }
                habit.kind = h.kind
                habit.breakMode = h.breakMode
                habit.avoidTrigger = h.avoidTrigger
                habit.replacementAction = h.replacementAction
                habit.frictionDevice = h.frictionDevice
                habit.checkStyle = h.checkStyle
                habit.checkQuestion = h.checkQuestion
                habit.whyText = h.whyText
                habit.whyImageData = h.whyImageUrl.flatMap(dataURL)
                habit.anchorRoutine = h.anchorRoutine
                habit.cueType = h.cueType
                habit.cueTime = h.cueTime
                habit.cueLocation = h.cueLocation
                habit.celebration = h.celebration
                habit.temptationBundle = h.temptationBundle
                habit.scheduleType = h.scheduleType
                habit.scheduleDays = h.scheduleDays
                habit.timesPerWeek = h.timesPerWeek
                habit.reminderTime = h.reminderTime
                habit.reminderEnabled = h.reminderEnabled
                habit.nightstandRule = h.nightstandRule
                habit.setbackPlans = h.setbackPlans
                habit.systemFocusConfirmed = h.systemFocusConfirmed
                habit.sectionNotes = h.sectionNotes
                habit.pausedAt = h.pausedAt
                habit.archivedAt = h.archivedAt
                habit.createdAt = h.createdAt
                habit.updatedAt = h.updatedAt
                s.habits += 1

                var phases: [String: Phase] = [:]
                for p in h.phases {
                    let phase = Phase(phaseNumber: p.phaseNumber, targetText: p.targetText)
                    phase.uid = p.id
                    ctx.insert(phase)
                    phase.habit = habit
                    phase.definitionOfDone = p.definitionOfDone
                    phase.targetCount = p.targetCount
                    phase.dailyLimit = p.dailyLimit
                    phase.status = p.status
                    phase.graduatedAt = p.graduatedAt
                    phase.createdAt = p.createdAt
                    phase.updatedAt = p.updatedAt
                    phases[p.id] = phase
                }

                for l in h.logs {
                    let log = HabitLog(date: l.date, status: l.status)
                    log.uid = l.id
                    ctx.insert(log)
                    log.habit = habit
                    log.phase = l.phaseId.flatMap { phases[$0] }
                    log.quantity = l.quantity
                    log.goldilocks = l.goldilocks
                    log.missReasons = l.missReasons
                    log.missNote = l.missNote
                    log.createdAt = l.createdAt
                    s.logs += 1
                }

                for c in h.checks {
                    let check = AutomaticityCheck()
                    check.uid = c.id
                    ctx.insert(check)
                    check.habit = habit
                    check.phase = phases[c.phaseId]
                    check.scores = c.scores
                    check.mean = c.mean
                    check.passed = c.passed
                    check.createdAt = c.createdAt
                }

                for m in h.metricLinks {
                    let link = HabitMetricLink()
                    link.uid = m.id
                    ctx.insert(link)
                    link.habit = habit
                    link.metric = m.metric
                    link.direction = m.direction
                    link.lagDays = m.lagDays
                    link.createdAt = m.createdAt
                }
            }

            for c in ws.checkIns {
                let ci = CheckIn(weekOf: c.weekOf)
                ci.uid = c.id
                ci.rating = c.rating
                ci.tinyVictory = c.tinyVictory
                ci.workingWell = c.workingWell
                ci.notWorking = c.notWorking
                ci.obstacles = c.obstacles
                ci.freeform = c.freeform
                ci.aiSummary = c.aiSummary
                ci.status = c.status
                ci.createdAt = c.createdAt
                ci.updatedAt = c.updatedAt
                ctx.insert(ci)
                s.checkIns += 1
            }

            for snap in ws.compassSnapshots {
                let cs = CompassSnapshot()
                cs.uid = snap.id
                cs.label = snap.label
                cs.assessment = snap.assessment.jsonString
                cs.vision = snap.vision.jsonString
                cs.goals = snap.goals.jsonString
                cs.createdAt = snap.createdAt
                ctx.insert(cs)
            }

            for chat in ws.coachChats {
                let conv = CoachConversation()
                conv.uid = chat.id
                conv.title = chat.title
                conv.createdAt = chat.createdAt
                conv.lastMessageAt = chat.lastMessageAt
                ctx.insert(conv)
                for m in chat.messages {
                    let msg = CoachMessage(role: m.role, text: m.text)
                    msg.uid = m.id
                    msg.createdAt = m.createdAt
                    ctx.insert(msg)
                    msg.conversation = conv
                }
                s.chats += 1
            }
        }

        for w in export.wearableDays {
            let d = BodyDay(date: w.date, source: w.source)
            d.uid = w.id
            d.sleepMinutes = w.sleepMinutes
            d.deepMinutes = w.deepMinutes
            d.remMinutes = w.remMinutes
            d.sleepScore = w.sleepScore
            d.restingHr = w.restingHr
            d.hrvNight = w.hrvNight
            d.bodyBatteryHigh = w.bodyBatteryHigh
            d.bodyBatteryLow = w.bodyBatteryLow
            d.stressAvg = w.stressAvg
            d.respirationAvg = w.respirationAvg
            d.steps = w.steps
            d.activeMinutes = w.activeMinutes
            d.sedentarySeconds = w.sedentarySeconds
            d.sleepStartMin = w.sleepStartMin
            d.sleepEndMin = w.sleepEndMin
            d.avgSleepStress = w.avgSleepStress
            d.awakeCount = w.awakeCount
            d.bodyBatteryAtWake = w.bodyBatteryAtWake
            d.lowStressSeconds = w.lowStressSeconds
            d.highStressSeconds = w.highStressSeconds
            d.minHeartRate = w.minHeartRate
            d.maxHeartRate = w.maxHeartRate
            d.avgWakingRespiration = w.avgWakingRespiration
            d.fetchedAt = w.fetchedAt
            ctx.insert(d)
            s.bodyDays += 1
        }

        for a in export.wearableActivities {
            let act = BodyActivity()
            act.source = a.source
            act.externalId = a.externalId
            act.type = a.type
            act.startedAt = a.startedAt
            act.localDate = a.localDate
            act.durationSec = a.durationSec
            act.distanceM = a.distanceM
            act.avgHr = a.avgHr
            ctx.insert(act)
        }

        for b in export.bookChunks {
            ctx.insert(BookChunk(idx: b.idx, content: b.content))
            s.bookChunks += 1
        }

        try ctx.save()
        return s
    }

    /// The web app stored habit "why" images as data: URLs. Anything else (a
    /// remote URL) is dropped — there's no server to fetch it from any more.
    private static func dataURL(_ s: String) -> Data? {
        guard s.hasPrefix("data:"), let comma = s.firstIndex(of: ",") else { return nil }
        return Data(base64Encoded: String(s[s.index(after: comma)...]))
    }

    /// Wipe every model. Used before a re-import.
    static func eraseAll(_ ctx: ModelContext) throws {
        for model in AppSchema.models { try ctx.delete(model: model) }
        try ctx.save()
    }
}
