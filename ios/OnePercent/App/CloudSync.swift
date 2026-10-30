import Foundation
import CoreData
import SwiftData

// iCloud sync between the iPhone and the Mac, through the private CloudKit
// database of whoever is signed in. SwiftData mirrors the store both ways; the
// models were written CloudKit-shaped from the start, so turning this on was a
// configuration change, not a migration.
//
// What CloudKit can't do is hold a unique constraint, so the rules the app
// enforces in code — one Profile, one log per habit per day, one check-in per
// week, one body row per date and source — can be broken by two devices that
// each wrote before hearing from the other. `Dedupe` puts them back, at launch
// and after every batch of changes arrives from iCloud.
enum CloudSync {
    static let containerID = "iCloud.com.arshdeep.onepercent"

    static func makeContainer() -> ModelContainer {
        let schema = Schema(AppSchema.models)
        let config = ModelConfiguration(schema: schema, cloudKitDatabase: .private(containerID))
        do {
            return try ModelContainer(for: schema, configurations: config)
        } catch {
            fatalError("Couldn't open the store: \(error)")
        }
    }

    /// Run the dedupe now, then again after each remote change settles.
    static func watch(_ container: ModelContainer) {
        Dedupe.run(container.mainContext)
        Task { @MainActor in
            let changes = NotificationCenter.default.notifications(named: .NSPersistentStoreRemoteChange)
            var pending: Task<Void, Never>?
            for await _ in changes {
                // Imports arrive in bursts; tidy once the burst is over.
                pending?.cancel()
                pending = Task { @MainActor in
                    try? await Task.sleep(for: .seconds(2))
                    guard !Task.isCancelled else { return }
                    Dedupe.run(container.mainContext)
                }
            }
        }
    }
}

enum Dedupe {
    /// Keeps the survivor each rule names and deletes the rest. Safe to run any
    /// time; on a clean store it deletes nothing.
    static func run(_ ctx: ModelContext) {
        var removed = 0

        // One Profile: the oldest is the original, anything newer is a device
        // that started before its data arrived.
        if let profiles = try? ctx.fetch(FetchDescriptor<Profile>(sortBy: [SortDescriptor(\.createdAt)])), profiles.count > 1 {
            for p in profiles.dropFirst() { ctx.delete(p); removed += 1 }
        }

        // One log per habit per day: the latest vote stands, as it would have
        // if both had been cast on one device.
        if let logs = try? ctx.fetch(FetchDescriptor<HabitLog>(sortBy: [SortDescriptor(\.createdAt, order: .reverse)])) {
            removed += dropDuplicates(logs, ctx) { l in l.habit.map { "\($0.uid)|\(l.date)" } }
        }

        // One check-in per week: the most recently edited.
        if let checkIns = try? ctx.fetch(FetchDescriptor<CheckIn>(sortBy: [SortDescriptor(\.updatedAt, order: .reverse)])) {
            removed += dropDuplicates(checkIns, ctx) { $0.weekOf }
        }

        // One body row per date and source: the most recently fetched.
        if let days = try? ctx.fetch(FetchDescriptor<BodyDay>(sortBy: [SortDescriptor(\.fetchedAt, order: .reverse)])) {
            removed += dropDuplicates(days, ctx) { "\($0.date)|\($0.source)" }
        }

        if let acts = try? ctx.fetch(FetchDescriptor<BodyActivity>()) {
            removed += dropDuplicates(acts, ctx) { $0.externalId.isEmpty ? nil : "\($0.source)|\($0.externalId)" }
        }

        // One passage per index, preferring one already embedded.
        if let chunks = try? ctx.fetch(FetchDescriptor<BookChunk>()) {
            let ordered = chunks.sorted { ($0.embedding != nil ? 0 : 1) < ($1.embedding != nil ? 0 : 1) }
            removed += dropDuplicates(ordered, ctx) { "\($0.idx)" }
        }

        if removed > 0 {
            try? ctx.save()
            print("Dedupe: removed \(removed) duplicate rows")
        }
    }

    /// Keeps the first row for each key, in the order given; rows with no key
    /// are left alone.
    private static func dropDuplicates<T: PersistentModel>(_ rows: [T], _ ctx: ModelContext, key: (T) -> String?) -> Int {
        var seen = Set<String>()
        var n = 0
        for r in rows {
            guard let k = key(r) else { continue }
            if seen.insert(k).inserted { continue }
            ctx.delete(r)
            n += 1
        }
        return n
    }
}
