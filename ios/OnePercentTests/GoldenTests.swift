import Foundation
import SwiftData
import Testing
@testable import One_Percent

// The Swift ports against the web app's own TypeScript. Fixtures come from
// ios/Tools/golden.ts — real data plus 300 randomised schedules — and are
// gitignored, so these skip on a machine that hasn't generated them.

private let fixtures = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures")

private struct Golden: Decodable {
    let today: String
    let tz: String
    let real: [Real]
    let series: SeriesSummary
    let weeklyActive: Int
    let random: [RandomCase]
    let fans: [Fan]
    let formats: [Format]

    struct Real: Decodable {
        let uid: String
        let scheduled: [String]
        let gridCount: Int
        let weekProgress: WP?
        let dueToday: Bool
    }

    struct WP: Decodable, Equatable {
        let quota, hits, remaining, daysLeft: Int
        let obligatedToday: Bool
    }

    struct SeriesSummary: Decodable {
        let progressDays: Double
        let activeDays: Int
        let first, last: String?
        let length: Int
        let lastValue, lastCeiling: Double?
    }

    struct RandomCase: Decodable {
        let input: Input
        let scheduled: [String]
        let count: Int
        let weekProgress: WP?
        let dueToday: Bool

        struct Input: Decodable {
            let scheduleType, scheduleDays: String
            let timesPerWeek: Int?
            let createdOn: String
            let pausedOn, archivedOn: String?
            let hits: [String]
            let today, from: String
        }
    }

    struct Fan: Decodable {
        let rhythm: Double
        let weeklyActive: Int
        let current, paceEnd, oneMoreEnd: Double
    }

    struct Format: Decodable {
        let v: Double
        let s: String
    }
}

private func loadGolden() throws -> Golden? {
    guard let data = try? Data(contentsOf: fixtures.appendingPathComponent("golden.json")) else { return nil }
    return try JSONDecoder().decode(Golden.self, from: data)
}

private extension WeekProgress {
    var golden: Golden.WP { .init(quota: quota, hits: hits, remaining: remaining, daysLeft: daysLeft, obligatedToday: obligatedToday) }
}

private func close(_ a: Double, _ b: Double) -> Bool { abs(a - b) <= 1e-9 * max(1, abs(b)) }

@MainActor
struct GoldenTests {
    @Test func randomSchedulesMatchTypeScript() throws {
        guard let g = try loadGolden() else { return }
        for (i, c) in g.random.enumerated() {
            let inp = c.input
            let sched = Schedule(scheduleType: inp.scheduleType, scheduleDays: inp.scheduleDays, timesPerWeek: inp.timesPerWeek)
            let bounds = ScheduleBounds(createdOn: inp.createdOn, pausedOn: inp.pausedOn, archivedOn: inp.archivedOn)
            let hits = Set(inp.hits)
            let resolved = ScheduleResolver.resolveRange(sched, from: inp.from, to: inp.today, hitDates: hits, bounds: bounds)
            #expect(resolved.count == c.count, "case \(i) count")
            #expect(resolved.filter(\.scheduled).map(\.date) == c.scheduled, "case \(i) scheduled days")
            #expect(ScheduleResolver.weekProgress(sched, today: inp.today, hitDates: hits, bounds: bounds)?.golden == c.weekProgress, "case \(i) weekProgress")
            #expect(ScheduleResolver.isDue(sched, on: inp.today, hitDates: hits, bounds: bounds) == c.dueToday, "case \(i) due")
        }
    }

    @Test func importedHabitsMatchTypeScript() throws {
        guard let g = try loadGolden(),
              let data = try? Data(contentsOf: fixtures.appendingPathComponent("export.json")) else { return }

        let container = try ModelContainer(
            for: Schema(AppSchema.models),
            configurations: ModelConfiguration(isStoredInMemoryOnly: true)
        )
        let ctx = container.mainContext
        let summary = try Importer.run(data, into: ctx)
        #expect(summary.habits == g.real.count)
        #expect(throws: Importer.ImportError.self) { try Importer.run(data, into: ctx) }

        let habits = try ctx.fetch(FetchDescriptor<Habit>())
        let byUid = Dictionary(uniqueKeysWithValues: habits.map { ($0.uid, $0) })

        for r in g.real {
            let h = try #require(byUid[r.uid])
            let grid = MomentumInputs.grid(h, today: g.today, tz: g.tz)
            #expect(grid.count == r.gridCount, "\(r.uid) grid size")
            #expect(grid.filter(\.scheduled).map(\.date) == r.scheduled, "\(r.uid) scheduled days")
            let sched = Schedule(h)
            let bounds = ScheduleBounds(h, tz: g.tz)
            let hits = MomentumInputs.hitDates(h)
            #expect(ScheduleResolver.weekProgress(sched, today: g.today, hitDates: hits, bounds: bounds)?.golden == r.weekProgress)
            #expect(ScheduleResolver.isDue(sched, on: g.today, hitDates: hits, bounds: bounds) == r.dueToday)
        }

        let series = Compound.progressSeries(habits.map { MomentumInputs.curveHabit($0, today: g.today, tz: g.tz) })
        #expect(close(series.progressDays, g.series.progressDays))
        #expect(series.activeDays == g.series.activeDays)
        #expect(series.actual.count == g.series.length)
        #expect(series.actual.first?.date == g.series.first)
        #expect(series.actual.last?.date == g.series.last)
        #expect(close(series.actual.last?.value ?? 0, g.series.lastValue ?? 0))
        #expect(close(series.ceiling.last?.value ?? 0, g.series.lastCeiling ?? 0))

        let live = habits.filter { $0.archivedAt == nil }
        let weeklyActive = Compound.activeDaysPerWeek(live.map { .init(paused: $0.pausedAt != nil, schedule: Schedule($0)) })
        #expect(weeklyActive == g.weeklyActive)

        for f in g.fans {
            let p = Compound.projectFan(progressDays: series.progressDays, rhythmPct: f.rhythm, weeklyActive: f.weeklyActive)
            #expect(close(p.current, f.current))
            #expect(close(p.paceEnd, f.paceEnd), "pace r=\(f.rhythm) wa=\(f.weeklyActive)")
            #expect(close(p.oneMoreEnd, f.oneMoreEnd), "oneMore r=\(f.rhythm) wa=\(f.weeklyActive)")
        }
    }

    @Test func multiplierFormattingMatchesTypeScript() throws {
        guard let g = try loadGolden() else { return }
        for f in g.formats {
            #expect(Compound.format(f.v) == f.s, "\(f.v)")
        }
    }
}
