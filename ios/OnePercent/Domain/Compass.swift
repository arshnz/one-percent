import Foundation
import SwiftData

// The Compass — the workbook's ABZ framework as a structured worksheet. A port
// of server/src/routes/compass.ts.
//
// One autosaved working draft, and that draft IS the live document: every save
// syncs its goals and assessment into the rest of the app. Snapshots are
// optional read-only copies you can look back on or restore.

struct CompassDraft: Codable, Equatable {
    var assessment = AssessmentForm()
    var vision = VisionForm()
    var goals: [GoalForm] = []

    struct StickyHabit: Codable, Equatable, Hashable {
        var habit = ""
        var whyItStuck = ""
    }

    struct AssessmentForm: Codable, Equatable {
        var contentmentPersonal: Int?
        var contentmentPersonalWhy: String?
        var contentmentProfessional: Int?
        var contentmentProfessionalWhy: String?
        var priorities: [String]?
        var highQualityHours: String?
        var workingWell: [String]?
        var notWorking: [String]?
        var obstacles: [String]?
        var pastStickyHabits: [StickyHabit]?
    }

    struct DomainVision: Codable, Equatable, Hashable {
        var domain: String
        var vision: String
    }

    struct VisionForm: Codable, Equatable {
        var dreamBig: String?
        var successMeaning: String?
        var domainVisions: [DomainVision]?
        var timeline6mo: String?
        var timeline2yr: String?
        var timeline10yr: String?
        var idealIdentity: String?
    }

    struct GoalForm: Codable, Equatable, Identifiable {
        /// Stable id so a goal survives title edits.
        var id: String? = UUID().uuidString
        var title = ""
        var domain = "health"
        var whyText: String?
        var timeframe: String?
        var currentSystem: String?
        var idealSystem: String?
    }

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        assessment = (try? c.decodeIfPresent(AssessmentForm.self, forKey: .assessment)) ?? AssessmentForm()
        vision = (try? c.decodeIfPresent(VisionForm.self, forKey: .vision)) ?? VisionForm()
        // Legacy goals predate ids — backfill so they survive title edits.
        goals = ((try? c.decodeIfPresent([GoalForm].self, forKey: .goals)) ?? []).map { g in
            var g = g
            if g.id == nil { g.id = UUID().uuidString }
            return g
        }
    }
}

enum Compass {
    static let domains = [("health", "Health"), ("career", "Career"), ("relationships", "Relationships"), ("money", "Money"), ("mind", "Mind")]

    static func load(_ p: Profile) -> CompassDraft {
        guard let s = p.compassDraft, let data = s.data(using: .utf8) else { return CompassDraft() }
        return (try? JSONDecoder().decode(CompassDraft.self, from: data)) ?? CompassDraft()
    }

    private static let isoMillis: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    /// The app-wide assessment the coaches read, derived from section A.
    static func assessmentJSON(_ a: CompassDraft.AssessmentForm, now: Date) -> String {
        var contentment: [[String: Any]] = []
        if let p = a.contentmentPersonal { contentment.append(["domain": "personal", "score": p]) }
        if let p = a.contentmentProfessional { contentment.append(["domain": "professional", "score": p]) }
        let obj: [String: Any] = [
            "contentment": contentment,
            "priorities": (a.priorities ?? []).filter { !$0.isEmpty },
            "highQualityHours": a.highQualityHours ?? "",
            "pastStickyHabits": (a.pastStickyHabits ?? []).filter { !$0.habit.trimmed.isEmpty }.map { ["habit": $0.habit, "whyItStuck": $0.whyItStuck] },
            "obstacles": (a.obstacles ?? []).filter { !$0.isEmpty },
            "workingWell": (a.workingWell ?? []).filter { !$0.isEmpty },
            "notWorking": (a.notWorking ?? []).filter { !$0.isEmpty },
            "updatedAt": isoMillis.string(from: now),
        ]
        let data = (try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }

    private static func norm(_ s: String) -> String { s.trimmed.lowercased() }

    /// Autosave: store the draft, then sync it into the app.
    static func save(_ draft: CompassDraft, profile: Profile, now: Date = Date(), ctx: ModelContext) throws {
        profile.compassDraft = JSONText.encode(draft)
        try sync(draft, profile: profile, now: now, ctx: ctx)
    }

    /// Write the assessment onto the profile and reconcile compass-sourced
    /// goals. Never deletes a goal — absent ones are shelved, so linked habits
    /// keep their link.
    static func sync(_ draft: CompassDraft, profile: Profile, now: Date, ctx: ModelContext) throws {
        profile.assessment = assessmentJSON(draft.assessment, now: now)

        let existing = try ctx.fetch(FetchDescriptor<Goal>()).filter { $0.sourceNote == "compass" }.sorted { $0.createdAt < $1.createdAt }
        var byId: [String: Goal] = [:]
        for g in existing { if let sid = g.sourceId { byId[sid] = g } }
        var legacyByTitle: [String: Goal] = [:]
        for g in existing where g.sourceId == nil { legacyByTitle[norm(g.title)] = g }

        var claimed = Set<ObjectIdentifier>()
        for g in draft.goals where !g.title.trimmed.isEmpty {
            let match = g.id.flatMap { byId[$0] } ?? legacyByTitle[norm(g.title)]
            let target: Goal
            if let match, !claimed.contains(ObjectIdentifier(match)) {
                claimed.insert(ObjectIdentifier(match))
                target = match
            } else {
                target = Goal(title: g.title.trimmed)
                target.sourceNote = "compass"
                target.createdAt = now
                ctx.insert(target)
            }
            target.title = g.title.trimmed
            target.domain = g.domain
            target.whyText = g.whyText?.trimmed.nonEmpty
            target.timeframe = g.timeframe?.trimmed.nonEmpty
            target.sourceId = g.id ?? match?.sourceId
            target.status = "active"
            target.updatedAt = now
        }
        for g in existing where !claimed.contains(ObjectIdentifier(g)) {
            g.status = "shelved"
            g.updatedAt = now
        }
        try ctx.save()
    }

    /// Freeze the live draft into a read-only copy.
    @discardableResult
    static func snapshot(label: String?, profile: Profile, now: Date = Date(), ctx: ModelContext) throws -> CompassSnapshot {
        let d = load(profile)
        let s = CompassSnapshot()
        s.label = label?.trimmed.nonEmpty
        s.assessment = JSONText.encode(d.assessment)
        s.vision = JSONText.encode(d.vision)
        s.goals = JSONText.encode(d.goals)
        s.createdAt = now
        ctx.insert(s)
        try ctx.save()
        return s
    }

    static func draft(of s: CompassSnapshot) -> CompassDraft {
        var d = CompassDraft()
        d.assessment = JSONText.decode(CompassDraft.AssessmentForm.self, s.assessment, default: .init())
        d.vision = JSONText.decode(CompassDraft.VisionForm.self, s.vision, default: .init())
        d.goals = JSONText.decode([CompassDraft.GoalForm].self, s.goals, default: []).map { g in
            var g = g
            if g.id == nil { g.id = UUID().uuidString }
            return g
        }
        return d
    }

    /// Restore a snapshot into the live worksheet; goals re-sync to match.
    static func restore(_ s: CompassSnapshot, profile: Profile, now: Date = Date(), ctx: ModelContext) throws -> CompassDraft {
        let d = draft(of: s)
        try save(d, profile: profile, now: now, ctx: ctx)
        return d
    }

    /// Start fresh: shelve compass goals, pause their linked habits (nothing
    /// owed, recoverable), clear the assessment and blank the worksheet.
    static func reset(profile: Profile, now: Date = Date(), ctx: ModelContext) throws {
        let goals = try ctx.fetch(FetchDescriptor<Goal>()).filter { $0.sourceNote == "compass" }
        for g in goals {
            g.status = "shelved"
            for h in g.habits ?? [] where h.archivedAt == nil && h.pausedAt == nil { h.pausedAt = now }
        }
        profile.assessment = nil
        profile.compassDraft = nil
        try ctx.save()
    }
}
