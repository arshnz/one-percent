import Foundation
import SwiftData
import Testing
@testable import One_Percent

// The body analyses against the server's own lib/stats.ts, habitEffect.ts and
// bodyInsights.ts, run on your real Garmin history (golden.mts, section 2c).
// Exact: same seeded shuffles, same p-values, same sentences.

private let fixtures = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures")

private func golden() -> [String: Any]? {
    guard let d = try? Data(contentsOf: fixtures.appendingPathComponent("golden.json")) else { return nil }
    return try? JSONSerialization.jsonObject(with: d) as? [String: Any]
}

private let iso: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()

private func num(_ v: Any?) -> Double { (v as? NSNumber)?.doubleValue ?? .nan }

/// p-values to 12 significant digits: Foundation's JSON parser can land one
/// bit away from the double JavaScript printed, and the two languages print
/// the same double differently.
private func sig(_ x: Double) -> String { String(format: "%.12g", x) }
private func sig(_ v: Any?) -> String { v.map { sig(num($0)) } ?? "-" }

struct BodyGoldenTests {
    @Test func statsMatchBitForBit() throws {
        guard let g = golden(), let s = g["stats"] as? [String: Any] else { return }
        for (i, c) in (s["cases"] as! [[String: Any]]).enumerated() {
            let a = (c["a"] as! [NSNumber]).map(\.doubleValue), b = (c["b"] as! [NSNumber]).map(\.doubleValue)
            #expect(Stats.median(a) == num(c["medA"]), "median a \(i)")
            #expect(Stats.median(b) == num(c["medB"]), "median b \(i)")
            let p = Stats.permutationTest(a, b, seed: c["seed"] as! Int, iterations: c["iterations"] as! Int)
            #expect(sig(p) == sig(c["p"]), "p \(i): swift \(p) web \(num(c["p"]))")
        }
        let bh = s["bh"] as! [String: Any]
        let q = Stats.benjaminiHochberg((bh["p"] as! [NSNumber]).map(\.doubleValue))
        #expect(q.map(sig) == (bh["q"] as! [NSNumber]).map { sig($0.doubleValue) })
        for c in s["circ"] as! [[String: Any]] {
            let r = try #require(Stats.circularStats((c["f"] as! [NSNumber]).map(\.doubleValue)))
            #expect(abs(r.meanFraction - num(c["mean"])) < 1e-12)
            #expect(abs(r.resultant - num(c["resultant"])) < 1e-12)
            #expect(abs(Stats.circularSdMinutes(r.resultant) - num(c["sd"])) < 1e-9)
        }
    }

    @MainActor @Test func insightsPredictorsAndEffectsMatch() throws {
        guard let g = golden(), let views = g["body"] as? [[String: Any]],
              let data = try? Data(contentsOf: fixtures.appendingPathComponent("export.json")) else { return }
        let container = try ModelContainer(for: Schema(AppSchema.models), configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = container.mainContext
        try Importer.run(data, into: ctx)
        let tz = g["tz"] as! String
        let rows = try ctx.fetch(FetchDescriptor<BodyDay>())
        let samples = BodySample.merged(rows)
        let acts = try ctx.fetch(FetchDescriptor<BodyActivity>(sortBy: [SortDescriptor(\.startedAt)])).map { ActivitySample(type: $0.type, localDate: $0.localDate) }
        let habits = try ctx.fetch(FetchDescriptor<Habit>())
        let (snaps, _, _) = BodyAI.inputs(habits, rows: rows, tz: tz)

        for v in views {
            let now = try #require(iso.date(from: v["now"] as! String))
            let label = v["now"] as! String

            let web = v["insights"] as! [String: Any]
            let got = BodyInsights.compute(days: samples, activities: acts, now: now, tz: tz)
            #expect(got.days == web["days"] as! Int, "\(label) days")
            let wantF = (web["findings"] as! [[String: Any]]).map { f in
                "\(f["kind"]!)|\(f["headline"]!)|\(f["detail"]!)|\(sig(f["pValue"]))"
            }
            let gotF = got.findings.map { "\($0.kind)|\($0.headline)|\($0.detail)|\($0.pValue.map { sig($0) } ?? "-")" }
            #expect(gotF == wantF, "\(label) findings\nswift: \(gotF)\nweb:   \(wantF)")

            let preds = HabitEffect.missPredictors(snaps, days: samples, now: now, tz: tz)
            let wantP = (v["predictors"] as! [[String: Any]]).map { "\($0["metric"]!)|\($0["verdict"]!)|\(sig($0["pValue"]))|\($0["sentence"]!)" }
            let gotP = preds.map { "\($0.metric.rawValue)|\($0.verdict.rawValue)|\(sig($0.pValue))|\($0.sentence)" }
            #expect(gotP == wantP, "\(label) predictors\nswift: \(gotP)\nweb:   \(wantP)")

            for (title, results) in v["effects"] as! [String: [[String: Any]]] {
                let h = try #require(habits.first { $0.title == title })
                let links = (h.metricLinks ?? []).sorted { $0.createdAt < $1.createdAt }.map { (metric: BodyMetric(rawValue: $0.metric)!, lagDays: $0.lagDays) }
                let got = HabitEffect.effects(HabitSnapshot(h, tz: tz), links: links, days: samples, now: now, tz: tz)
                let want = results.map { "\($0["metric"]!)|\($0["verdict"]!)|\(sig($0["pValue"]))|\($0["sentence"]!)" }
                let gotE = got.map { "\($0.metric.rawValue)|\($0.verdict.rawValue)|\(sig($0.pValue))|\($0.sentence)" }
                #expect(gotE == want, "\(label) effects \(title.prefix(20))\nswift: \(gotE)\nweb:   \(want)")
            }
        }
    }
}
