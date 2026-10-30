import Foundation
import SwiftData
#if os(iOS)
import HealthKit

// Apple Health in place of the Garmin collector. Reads what Health holds —
// written by an Apple Watch, by Garmin Connect, or any other app — and folds it
// into one BodyDay per local date (source "health"). The imported Garmin
// history stays as it was; where both exist for a day, the analyses prefer
// Health field by field.
//
// What Health can't supply: Body Battery and Garmin's stress score. Those
// panels keep showing the imported history and say so.
@MainActor
enum HealthSync {
    static let store = HKHealthStore()
    private static let lastSyncKey = "health-last-sync"

    static var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    static var lastSync: Date? {
        get { UserDefaults.standard.object(forKey: lastSyncKey) as? Date }
        set { UserDefaults.standard.set(newValue, forKey: lastSyncKey) }
    }

    private static var readTypes: Set<HKObjectType> {
        var s: Set<HKObjectType> = [HKCategoryType(.sleepAnalysis), HKWorkoutType.workoutType()]
        for q: HKQuantityTypeIdentifier in [.restingHeartRate, .heartRateVariabilitySDNN, .stepCount, .appleExerciseTime, .respiratoryRate, .heartRate] {
            s.insert(HKQuantityType(q))
        }
        return s
    }

    /// Ask once; iOS remembers. Health never says whether read access was
    /// granted (privacy), so an empty result just means "nothing to read".
    static func requestAccess() async throws {
        try await store.requestAuthorization(toShare: [], read: readTypes)
    }

    /// Pull the last `days` days (a year on first sync, a few days after).
    @discardableResult
    static func sync(_ ctx: ModelContext, tz: String, now: Date = Date()) async throws -> Int {
        guard isAvailable else { return 0 }
        let days = lastSync == nil ? 365 : 7
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: tz) ?? .current
        let end = now
        let start = cal.startOfDay(for: now.addingTimeInterval(-Double(days) * 86_400))

        // In sequence: each query is quick, and HealthKit serves them from one store.
        let sl = try await sleepNights(from: start.addingTimeInterval(-86_400), to: end, tz: tz)
        let r = try await daily(.restingHeartRate, .discreteAverage, HKUnit.count().unitDivided(by: .minute()), start, end, cal)
        let h = try await daily(.heartRateVariabilitySDNN, .discreteAverage, .secondUnit(with: .milli), start, end, cal)
        let st = try await daily(.stepCount, .cumulativeSum, .count(), start, end, cal)
        let ex = try await daily(.appleExerciseTime, .cumulativeSum, .minute(), start, end, cal)
        let rs = try await daily(.respiratoryRate, .discreteAverage, HKUnit.count().unitDivided(by: .minute()), start, end, cal)
        let mn = try await daily(.heartRate, .discreteMin, HKUnit.count().unitDivided(by: .minute()), start, end, cal)
        let mx = try await daily(.heartRate, .discreteMax, HKUnit.count().unitDivided(by: .minute()), start, end, cal)
        let wo = try await workoutsBetween(start, end)

        let existing = try ctx.fetch(FetchDescriptor<BodyDay>(predicate: #Predicate { $0.source == "health" }))
        var byDate = Dictionary(existing.map { ($0.date, $0) }, uniquingKeysWith: { a, _ in a })
        let dates = Set(sl.keys).union(r.keys).union(h.keys).union(st.keys).union(ex.keys).union(rs.keys).union(mn.keys).union(mx.keys)
        for date in dates {
            let d = byDate[date] ?? {
                let n = BodyDay(date: date, source: "health")
                ctx.insert(n)
                byDate[date] = n
                return n
            }()
            if let s = sl[date] {
                d.sleepMinutes = s.asleep
                d.deepMinutes = s.deep
                d.remMinutes = s.rem
                d.sleepStartMin = s.startMin
                d.sleepEndMin = s.endMin
                d.awakeCount = s.awakenings
            }
            d.restingHr = r[date].map { Int($0.rounded()) } ?? d.restingHr
            d.hrvNight = h[date].map { Int($0.rounded()) } ?? d.hrvNight
            d.steps = st[date].map { Int($0.rounded()) } ?? d.steps
            d.activeMinutes = ex[date].map { Int($0.rounded()) } ?? d.activeMinutes
            d.respirationAvg = rs[date] ?? d.respirationAvg
            d.minHeartRate = mn[date].map { Int($0.rounded()) } ?? d.minHeartRate
            d.maxHeartRate = mx[date].map { Int($0.rounded()) } ?? d.maxHeartRate
            d.fetchedAt = now
        }

        let known = Set(try ctx.fetch(FetchDescriptor<BodyActivity>()).map(\.externalId))
        for w in wo where !known.contains(w.uuid.uuidString) {
            let a = BodyActivity()
            a.source = "health"
            a.externalId = w.uuid.uuidString
            a.type = Self.typeName(w.workoutActivityType)
            a.startedAt = w.startDate
            a.localDate = LocalDate.of(w.startDate, tz: tz)
            a.durationSec = Int(w.duration)
            a.distanceM = w.totalDistance?.doubleValue(for: .meter())
            ctx.insert(a)
        }
        try ctx.save()
        lastSync = now
        return dates.count
    }

    // MARK: Queries

    private static func daily(_ id: HKQuantityTypeIdentifier, _ option: HKStatisticsOptions, _ unit: HKUnit,
                              _ start: Date, _ end: Date, _ cal: Calendar) async throws -> [String: Double] {
        let type = HKQuantityType(id)
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end)
        let descriptor = HKStatisticsCollectionQueryDescriptor(
            predicate: .quantitySample(type: type, predicate: predicate),
            options: option, anchorDate: cal.startOfDay(for: start), intervalComponents: DateComponents(day: 1)
        )
        let collection = try await descriptor.result(for: store)
        var out: [String: Double] = [:]
        let f = DateFormatter()
        f.calendar = cal
        f.timeZone = cal.timeZone
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        collection.enumerateStatistics(from: start, to: end) { stats, _ in
            let q: HKQuantity? = switch option {
            case .cumulativeSum: stats.sumQuantity()
            case .discreteMin: stats.minimumQuantity()
            case .discreteMax: stats.maximumQuantity()
            default: stats.averageQuantity()
            }
            if let q { out[f.string(from: stats.startDate)] = q.doubleValue(for: unit) }
        }
        return out
    }

    struct Night {
        var asleep = 0, deep = 0, rem = 0
        var startMin: Int?
        var endMin: Int?
        var awakenings = 0
    }

    /// Sleep is credited to the morning it ends on — the date Garmin used.
    private static func sleepNights(from start: Date, to end: Date, tz: String) async throws -> [String: Night] {
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.categorySample(type: HKCategoryType(.sleepAnalysis), predicate: HKQuery.predicateForSamples(withStart: start, end: end))],
            sortDescriptors: [SortDescriptor(\.startDate)]
        )
        let samples = try await descriptor.result(for: store)
        var nights: [String: Night] = [:]
        var firstStart: [String: Date] = [:]
        for s in samples {
            guard let v = HKCategoryValueSleepAnalysis(rawValue: s.value) else { continue }
            let night = LocalDate.of(s.endDate, tz: tz)
            var n = nights[night] ?? Night()
            let mins = Int(s.endDate.timeIntervalSince(s.startDate) / 60)
            switch v {
            case .asleepDeep: n.deep += mins; n.asleep += mins
            case .asleepREM: n.rem += mins; n.asleep += mins
            case .asleepCore, .asleepUnspecified: n.asleep += mins
            case .awake: n.awakenings += 1
            default: break
            }
            if v != .inBed && v != .awake {
                if firstStart[night].map({ s.startDate < $0 }) ?? true {
                    firstStart[night] = s.startDate
                    n.startMin = LocalDate.minutesOfDay(s.startDate, tz: tz)
                }
                n.endMin = LocalDate.minutesOfDay(s.endDate, tz: tz)
            }
            nights[night] = n
        }
        return nights.filter { $0.value.asleep > 0 }
    }

    private static func workoutsBetween(_ start: Date, _ end: Date) async throws -> [HKWorkout] {
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.workout(HKQuery.predicateForSamples(withStart: start, end: end))],
            sortDescriptors: [SortDescriptor(\.startDate)]
        )
        return try await descriptor.result(for: store)
    }

    /// Workout types named the way the Garmin history named them.
    static func typeName(_ t: HKWorkoutActivityType) -> String {
        switch t {
        case .running: "running"
        case .walking: "walking"
        case .hiking: "hiking"
        case .cycling: "cycling"
        case .swimming: "lap_swimming"
        case .traditionalStrengthTraining, .functionalStrengthTraining: "strength_training"
        case .highIntensityIntervalTraining: "hiit"
        case .yoga: "yoga"
        case .cricket: "cricket"
        case .mindAndBody: "breathwork"
        case .rowing: "rowing"
        case .elliptical: "elliptical"
        default: "other"
        }
    }
}
#else
/// The Mac has no Apple Health. Body data arrives from the iPhone through
/// iCloud, so "last synced" is when the phone last read Health.
@MainActor
enum HealthSync {
    static let isAvailable = false

    static var lastSync: Date? {
        guard let ctx = ModelContextHolder.main else { return nil }
        var d = FetchDescriptor<BodyDay>(predicate: #Predicate { $0.source == "health" }, sortBy: [SortDescriptor(\.fetchedAt, order: .reverse)])
        d.fetchLimit = 1
        return (try? ctx.fetch(d))?.first?.fetchedAt
    }

    struct Unavailable: Error {}
    static func requestAccess() async throws { throw Unavailable() }
    @discardableResult
    static func sync(_ ctx: ModelContext, tz: String, now: Date = Date()) async throws -> Int { throw Unavailable() }
}
#endif
