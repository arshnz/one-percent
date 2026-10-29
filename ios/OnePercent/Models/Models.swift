import Foundation
import SwiftData

// The on-device data model — the Prisma schema minus everything that only made
// sense with a server (users table, push subscriptions, sync bookkeeping, raw
// Garmin payloads, the Vision Canvas).
//
// Written to be CloudKit-ready from day one: every stored property has a
// default, every relationship is optional, and nothing is @Attribute(.unique).
// CloudKit rejects a model that breaks any of those, and retrofitting them
// after real data exists is a migration nobody wants.
//
// Field names and value conventions match the web app exactly — dates as local
// "YYYY-MM-DD" strings, statuses as the same string enums, JSON blobs kept as
// JSON strings — so the ported logic reads like the TypeScript it came from.
// `uid` carries the original Prisma cuid for imported rows.

/// The single person using the app. Folds in the old User and Workstation rows,
/// since on a phone there is exactly one of each.
@Model final class Profile {
    var uid: String = UUID().uuidString
    var name: String?
    var timezone: String = "Pacific/Auckland"
    var personalContext: String?
    /// JSON — the Compass self-assessment.
    var assessment: String?
    /// JSON — an in-progress Compass draft.
    var compassDraft: String?
    /// JSON array of strings — cached "What the data says".
    var momentumInsights: String?
    var momentumInsightsAt: Date?
    var createdAt: Date = Date()

    init() {}
}

@Model final class Goal {
    var uid: String = UUID().uuidString
    var title: String = ""
    var domain: String = "health"
    var whyText: String?
    var timeframe: String?
    var sourceNote: String?
    var sourceId: String?
    var status: String = "active"
    var createdAt: Date = Date()
    var updatedAt: Date = Date()
    @Relationship(deleteRule: .nullify, inverse: \Habit.goal) var habits: [Habit]? = []

    init(title: String) { self.title = title }
}

@Model final class Habit {
    var uid: String = UUID().uuidString
    var goal: Goal?
    /// "build" | "break"
    var kind: String = "build"
    /// "abstain" | "taper" (break habits only)
    var breakMode: String?
    var avoidTrigger: String?
    var replacementAction: String?
    var frictionDevice: String?
    /// "hold" | "yesno"
    var checkStyle: String = "hold"
    var checkQuestion: String?
    var title: String = ""
    var whyText: String?
    var whyImageData: Data?
    var anchorRoutine: String?
    var cueType: String = "habit_stack"
    var cueTime: String?
    var cueLocation: String?
    var failSafeAction: String = ""
    var celebration: String?
    var temptationBundle: String?
    /// "days" | "weekly"
    var scheduleType: String = "days"
    /// JSON array of weekdays, 0 = Sunday.
    var scheduleDays: String = "[0,1,2,3,4,5,6]"
    var timesPerWeek: Int?
    var reminderTime: String?
    var reminderEnabled: Bool = true
    var nightstandRule: String?
    /// JSON array of { obstacle, plan }.
    var setbackPlans: String = "[]"
    var systemFocusConfirmed: Bool = false
    /// JSON object of per-section notes.
    var sectionNotes: String = "{}"
    var pausedAt: Date?
    var archivedAt: Date?
    var createdAt: Date = Date()
    var updatedAt: Date = Date()

    @Relationship(deleteRule: .cascade, inverse: \Phase.habit) var phases: [Phase]? = []
    @Relationship(deleteRule: .cascade, inverse: \HabitLog.habit) var logs: [HabitLog]? = []
    @Relationship(deleteRule: .cascade, inverse: \AutomaticityCheck.habit) var checks: [AutomaticityCheck]? = []
    @Relationship(deleteRule: .cascade, inverse: \HabitMetricLink.habit) var metricLinks: [HabitMetricLink]? = []

    init(title: String, failSafeAction: String) {
        self.title = title
        self.failSafeAction = failSafeAction
    }

    var sortedPhases: [Phase] { (phases ?? []).sorted { $0.phaseNumber < $1.phaseNumber } }
    var activePhase: Phase? { sortedPhases.first { $0.status == "active" || $0.status == "ready" } }
}

@Model final class Phase {
    var uid: String = UUID().uuidString
    var habit: Habit?
    var phaseNumber: Int = 1
    var targetText: String = ""
    var definitionOfDone: String?
    var targetCount: Int = 30
    var dailyLimit: Int?
    /// "locked" | "active" | "ready" | "graduated"
    var status: String = "active"
    var graduatedAt: Date?
    var createdAt: Date = Date()
    var updatedAt: Date = Date()
    @Relationship(deleteRule: .nullify, inverse: \HabitLog.phase) var logs: [HabitLog]? = []
    @Relationship(deleteRule: .cascade, inverse: \AutomaticityCheck.phase) var checks: [AutomaticityCheck]? = []

    init(phaseNumber: Int, targetText: String) {
        self.phaseNumber = phaseNumber
        self.targetText = targetText
    }
}

@Model final class AutomaticityCheck {
    var uid: String = UUID().uuidString
    var habit: Habit?
    var phase: Phase?
    /// JSON array of 4 ints (1–5 agreement).
    var scores: String = "[]"
    var mean: Double = 0
    var passed: Bool = false
    var createdAt: Date = Date()

    init() {}
}

@Model final class HabitLog {
    var uid: String = UUID().uuidString
    var habit: Habit?
    var phase: Phase?
    /// Local "YYYY-MM-DD". One log per habit per date (enforced in code — CloudKit
    /// can't hold a unique constraint).
    var date: String = ""
    /// "target" | "failsafe" | "miss"
    var status: String = "target"
    var quantity: Int?
    var goldilocks: String?
    /// JSON array of reason keys.
    var missReasons: String = "[]"
    var missNote: String?
    var createdAt: Date = Date()

    init(date: String, status: String) {
        self.date = date
        self.status = status
    }

    var isSuccess: Bool { status == "target" || status == "failsafe" }
}

@Model final class HabitMetricLink {
    var uid: String = UUID().uuidString
    var habit: Habit?
    var metric: String = ""
    var direction: String = ""
    var lagDays: Int = 1
    var createdAt: Date = Date()

    init() {}
}

@Model final class CheckIn {
    var uid: String = UUID().uuidString
    /// Monday of the reviewed week, "YYYY-MM-DD". Unique, enforced in code.
    var weekOf: String = ""
    var rating: Int?
    var tinyVictory: String?
    var workingWell: String?
    var notWorking: String?
    /// JSON array.
    var obstacles: String = "[]"
    var freeform: String?
    var aiSummary: String?
    /// "completed" | "snoozed" | "skipped"
    var status: String = "completed"
    var createdAt: Date = Date()
    var updatedAt: Date = Date()

    init(weekOf: String) { self.weekOf = weekOf }
}

@Model final class CompassSnapshot {
    var uid: String = UUID().uuidString
    var label: String?
    /// JSON.
    var assessment: String = "{}"
    /// JSON.
    var vision: String = "{}"
    /// JSON.
    var goals: String = "[]"
    var createdAt: Date = Date()

    init() {}
}

@Model final class CoachConversation {
    var uid: String = UUID().uuidString
    var title: String = "New chat"
    var createdAt: Date = Date()
    var lastMessageAt: Date = Date()
    @Relationship(deleteRule: .cascade, inverse: \CoachMessage.conversation) var messages: [CoachMessage]? = []

    init() {}

    var sortedMessages: [CoachMessage] { (messages ?? []).sorted { $0.createdAt < $1.createdAt } }
}

@Model final class CoachMessage {
    var uid: String = UUID().uuidString
    var conversation: CoachConversation?
    /// "user" | "model"
    var role: String = "user"
    var text: String = ""
    var createdAt: Date = Date()

    init(role: String, text: String) {
        self.role = role
        self.text = text
    }
}

/// One day of body metrics. Imported Garmin history keeps every column it had;
/// Apple Health fills the subset it can (source "health").
@Model final class BodyDay {
    var uid: String = UUID().uuidString
    var date: String = ""
    /// "garmin" | "health"
    var source: String = "garmin"
    var sleepMinutes: Int?
    var deepMinutes: Int?
    var remMinutes: Int?
    var sleepScore: Int?
    var restingHr: Int?
    var hrvNight: Int?
    var bodyBatteryHigh: Int?
    var bodyBatteryLow: Int?
    var stressAvg: Int?
    var respirationAvg: Double?
    var steps: Int?
    var activeMinutes: Int?
    var sedentarySeconds: Int?
    var sleepStartMin: Int?
    var sleepEndMin: Int?
    var avgSleepStress: Double?
    var awakeCount: Int?
    var bodyBatteryAtWake: Int?
    var lowStressSeconds: Int?
    var highStressSeconds: Int?
    var minHeartRate: Int?
    var maxHeartRate: Int?
    var avgWakingRespiration: Double?
    var fetchedAt: Date = Date()

    init(date: String, source: String) {
        self.date = date
        self.source = source
    }
}

@Model final class BodyActivity {
    var uid: String = UUID().uuidString
    var source: String = "garmin"
    var externalId: String = ""
    var type: String = ""
    var startedAt: Date = Date()
    var localDate: String = ""
    var durationSec: Int = 0
    var distanceM: Double?
    var avgHr: Int?

    init() {}
}

/// A passage of the book the coach grounds its answers in. The embedding is
/// computed on-device (NLEmbedding) after import.
@Model final class BookChunk {
    var idx: Int = 0
    var content: String = ""
    var embedding: Data?

    init(idx: Int, content: String) {
        self.idx = idx
        self.content = content
    }
}

enum AppSchema {
    static let models: [any PersistentModel.Type] = [
        Profile.self, Goal.self, Habit.self, Phase.self, AutomaticityCheck.self,
        HabitLog.self, HabitMetricLink.self, CheckIn.self, CompassSnapshot.self,
        CoachConversation.self, CoachMessage.self, BodyDay.self, BodyActivity.self,
        BookChunk.self,
    ]
}
