import Foundation

// The shape of backups/ios-export-*.json, written by
// server/src/scripts/exportForIos.ts — Prisma rows as-is, nested by ownership.
// Optional wherever the column is nullable, so a field the export omits can't
// fail the whole import.
struct WebExport: Decodable {
    let format: String
    let version: Int
    let exportedAt: Date
    let user: User
    let workstations: [Workstation]
    let wearableDays: [WearableDay]
    let wearableActivities: [WearableActivity]
    let bookChunks: [BookChunkRow]

    struct User: Decodable {
        let name: String?
        let timezone: String
        let personalContext: String?
        let assessment: String?
        let createdAt: Date
    }

    struct Workstation: Decodable {
        let compassDraft: JSONValue?
        let momentumInsights: String?
        let momentumInsightsAt: Date?
        let goals: [GoalRow]
        let checkIns: [CheckInRow]
        let compassSnapshots: [SnapshotRow]
        let coachChats: [ChatRow]
        let habits: [HabitRow]
    }

    struct GoalRow: Decodable {
        let id: String
        let title: String
        let domain: String
        let whyText, timeframe, sourceNote, sourceId: String?
        let status: String
        let createdAt, updatedAt: Date
    }

    struct HabitRow: Decodable {
        let id: String
        let goalId: String?
        let kind: String
        let breakMode, avoidTrigger, replacementAction, frictionDevice: String?
        let checkStyle: String
        let checkQuestion: String?
        let title: String
        let whyText, whyImageUrl, anchorRoutine: String?
        let cueType: String
        let cueTime, cueLocation: String?
        let failSafeAction: String
        let celebration, temptationBundle: String?
        let scheduleType, scheduleDays: String
        let timesPerWeek: Int?
        let reminderTime: String?
        let reminderEnabled: Bool
        let nightstandRule: String?
        let setbackPlans: String
        let systemFocusConfirmed: Bool
        let sectionNotes: String
        let pausedAt, archivedAt: Date?
        let createdAt, updatedAt: Date
        let phases: [PhaseRow]
        let logs: [LogRow]
        let checks: [CheckRow]
        let metricLinks: [MetricLinkRow]
    }

    struct PhaseRow: Decodable {
        let id: String
        let phaseNumber: Int
        let targetText: String
        let definitionOfDone: String?
        let targetCount: Int
        let dailyLimit: Int?
        let status: String
        let graduatedAt: Date?
        let createdAt, updatedAt: Date
    }

    struct LogRow: Decodable {
        let id: String
        let phaseId: String?
        let date, status: String
        let quantity: Int?
        let goldilocks: String?
        let missReasons: String
        let missNote: String?
        let createdAt: Date
    }

    struct CheckRow: Decodable {
        let id, phaseId, scores: String
        let mean: Double
        let passed: Bool
        let createdAt: Date
    }

    struct MetricLinkRow: Decodable {
        let id, metric, direction: String
        let lagDays: Int
        let createdAt: Date
    }

    struct CheckInRow: Decodable {
        let id, weekOf: String
        let rating: Int?
        let tinyVictory, workingWell, notWorking: String?
        let obstacles: String
        let freeform, aiSummary: String?
        let status: String
        let createdAt, updatedAt: Date
    }

    struct SnapshotRow: Decodable {
        let id: String
        let label: String?
        let assessment, vision, goals: JSONValue
        let createdAt: Date
    }

    struct ChatRow: Decodable {
        let id, title: String
        let createdAt, lastMessageAt: Date
        let messages: [MessageRow]
    }

    struct MessageRow: Decodable {
        let id, role, text: String
        let createdAt: Date
    }

    struct WearableDay: Decodable {
        let id, date, source: String
        let sleepMinutes, deepMinutes, remMinutes, sleepScore, restingHr, hrvNight: Int?
        let bodyBatteryHigh, bodyBatteryLow, stressAvg: Int?
        let respirationAvg: Double?
        let steps, activeMinutes, sedentarySeconds, sleepStartMin, sleepEndMin: Int?
        let avgSleepStress: Double?
        let awakeCount, bodyBatteryAtWake, lowStressSeconds, highStressSeconds: Int?
        let minHeartRate, maxHeartRate: Int?
        let avgWakingRespiration: Double?
        let fetchedAt: Date
    }

    struct WearableActivity: Decodable {
        let source, externalId, type: String
        let startedAt: Date
        let localDate: String
        let durationSec: Int
        let distanceM: Double?
        let avgHr: Int?
    }

    struct BookChunkRow: Decodable {
        let idx: Int
        let content: String
    }

    static func decode(_ data: Data) throws -> WebExport {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let s = try decoder.singleValueContainer().decode(String.self)
            if let date = isoFractional.date(from: s) ?? isoPlain.date(from: s) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Bad date \(s)"))
        }
        return try d.decode(WebExport.self, from: data)
    }

    nonisolated(unsafe) private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    nonisolated(unsafe) private static let isoPlain = ISO8601DateFormatter()
}

/// An arbitrary JSON value — Prisma `Json` columns, which the app keeps as
/// JSON strings.
enum JSONValue: Decodable {
    case null, bool(Bool), number(Double), string(String), array([JSONValue]), object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    var any: Any {
        switch self {
        case .null: NSNull()
        case .bool(let b): b
        case .number(let n): n
        case .string(let s): s
        case .array(let a): a.map(\.any)
        case .object(let o): o.mapValues(\.any)
        }
    }

    var jsonString: String {
        guard JSONSerialization.isValidJSONObject(any),
              let data = try? JSONSerialization.data(withJSONObject: any, options: [.sortedKeys]) else {
            if case .string(let s) = self { return s }
            return "null"
        }
        return String(decoding: data, as: UTF8.self)
    }
}
