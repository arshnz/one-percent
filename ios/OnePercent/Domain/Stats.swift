import Foundation

// The small statistics this app is allowed to do, in one place — a port of
// server/src/lib/stats.ts. There must be exactly one permutation test: the
// honesty of every claim the app makes rests on it.
//
// Bit-for-bit with the web: the same seeded generator, the same shuffle, the
// same p-values. Pure and nonisolated so the analyses can run off the main
// thread.

nonisolated enum Stats {
    /// mulberry32 — the web's deterministic RNG, in 32-bit integer arithmetic.
    /// The same data must give the same p-value on every run.
    nonisolated struct Mulberry32 {
        private var seed: UInt32

        init(_ seed: Int) { self.seed = UInt32(truncatingIfNeeded: seed) }

        mutating func next() -> Double {
            seed = seed &+ 0x6D2B_79F5
            var t = (seed ^ (seed >> 15)) &* (1 | seed)
            t = (t &+ ((t ^ (t >> 7)) &* (61 | t))) ^ t
            return Double(t ^ (t >> 14)) / 4_294_967_296
        }
    }

    nonisolated static func median(_ xs: [Double]) -> Double {
        guard !xs.isEmpty else { return .nan }
        let s = xs.sorted()
        let mid = s.count >> 1
        return s.count % 2 == 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
    }

    nonisolated static func median(_ xs: ArraySlice<Double>) -> Double { median(Array(xs)) }

    /// Two-tailed permutation test on the difference of medians: shuffle the
    /// labels and count how often chance alone opens a gap this wide.
    nonisolated static func permutationTest(_ a: [Double], _ b: [Double], seed: Int = 12345, iterations: Int = 10_000) -> Double {
        let observed = abs(median(a) - median(b))
        let nA = a.count
        var buf = a + b
        var rand = Mulberry32(seed)
        var atLeastAsExtreme = 0
        for _ in 0..<iterations {
            var i = buf.count - 1
            while i > 0 {
                let j = Int(rand.next() * Double(i + 1))
                buf.swapAt(i, j)
                i -= 1
            }
            if abs(median(buf[0..<nA]) - median(buf[nA...])) >= observed { atLeastAsExtreme += 1 }
        }
        // +1 both sides: p = 0 is not a claim any finite number of shuffles supports.
        return Double(atLeastAsExtreme + 1) / Double(iterations + 1)
    }

    /// Benjamini–Hochberg false-discovery-rate correction; q-values in input order.
    nonisolated static func benjaminiHochberg(_ p: [Double]) -> [Double] {
        let n = p.count
        guard n > 0 else { return [] }
        // A stable sort, as JS's is.
        let order = p.enumerated().sorted { $0.element != $1.element ? $0.element < $1.element : $0.offset < $1.offset }
        var q = [Double](repeating: 0, count: n)
        var prev = 1.0
        for k in stride(from: n - 1, through: 0, by: -1) {
            let adj = min(prev, order[k].element * Double(n) / Double(k + 1))
            prev = adj
            q[order[k].offset] = min(adj, 1)
        }
        return q
    }

    /// Circular mean and concentration for times of day (fractions of 24h).
    nonisolated static func circularStats(_ fractions: [Double]) -> (meanFraction: Double, resultant: Double)? {
        guard fractions.count >= 3 else { return nil }
        var sx = 0.0, sy = 0.0
        for f in fractions {
            sx += cos(f * 2 * .pi)
            sy += sin(f * 2 * .pi)
        }
        let n = Double(fractions.count)
        let resultant = sqrt(sx * sx + sy * sy) / n
        var angle = atan2(sy / n, sx / n)
        if angle < 0 { angle += 2 * .pi }
        return (angle / (2 * .pi), resultant)
    }

    /// Circular standard deviation in minutes.
    nonisolated static func circularSdMinutes(_ resultant: Double) -> Double {
        if resultant <= 0 { return 720 }
        if resultant >= 1 { return 0 }
        return sqrt(-2 * log(resultant)) * (1440 / (2 * .pi))
    }

    /// JavaScript's Number.prototype.toFixed — rounds halves away from zero,
    /// where printf would round them to even.
    nonisolated static func toFixed(_ x: Double, _ digits: Int) -> String {
        let p = pow(10, Double(digits))
        let r = (x * p).rounded(.toNearestOrAwayFromZero) / p
        return String(format: "%.\(digits)f", r == 0 ? 0 : r)
    }

    /// JavaScript's Math.round — halves round up (toward +∞).
    nonisolated static func jsRound(_ x: Double) -> Double { (x + 0.5).rounded(.down) }
}

/// The metrics a habit can be measured against — a port of wearableMetrics.ts.
nonisolated enum BodyMetric: String, CaseIterable, Identifiable, Codable {
    case restingHr, sleepMinutes, hrvNight, bodyBatteryHigh, stressAvg

    nonisolated var id: String { rawValue }

    nonisolated var label: String {
        switch self {
        case .restingHr: "Resting heart rate"
        case .sleepMinutes: "Sleep duration"
        case .hrvNight: "Overnight HRV"
        case .bodyBatteryHigh: "Body Battery peak"
        case .stressAvg: "Average stress"
        }
    }

    /// Mid-sentence form.
    nonisolated var inline: String {
        switch self {
        case .restingHr: "resting heart rate"
        case .sleepMinutes: "sleep duration"
        case .hrvNight: "overnight HRV"
        case .bodyBatteryHigh: "Body Battery peak"
        case .stressAvg: "average stress"
        }
    }

    nonisolated var short: String {
        switch self {
        case .restingHr: "Resting HR"
        case .sleepMinutes: "Sleep"
        case .hrvNight: "HRV"
        case .bodyBatteryHigh: "Body Battery"
        case .stressAvg: "Stress"
        }
    }

    nonisolated var unit: String {
        switch self {
        case .restingHr: "bpm"
        case .sleepMinutes: "min"
        case .hrvNight: "ms"
        default: ""
        }
    }

    /// What counts as an improvement — drives phrasing, never the maths.
    nonisolated var lowerIsBetter: Bool { self == .restingHr || self == .stressAvg }

    nonisolated var precision: Int { self == .sleepMinutes ? 0 : 1 }

    /// Garmin-only: Apple Health has no equivalent.
    nonisolated var garminOnly: Bool { self == .bodyBatteryHigh || self == .stressAvg }
}

/// One day of body numbers as the analyses read them — Apple Health and the
/// imported Garmin history folded together, Health winning where both exist.
nonisolated struct BodySample: Sendable {
    var date: String
    var sleepMinutes, deepMinutes, remMinutes: Double?
    var sleepStartMin: Double?
    var restingHr, hrvNight, bodyBatteryHigh, bodyBatteryLow, stressAvg, steps: Double?

    subscript(_ m: BodyMetric) -> Double? {
        switch m {
        case .restingHr: restingHr
        case .sleepMinutes: sleepMinutes
        case .hrvNight: hrvNight
        case .bodyBatteryHigh: bodyBatteryHigh
        case .stressAvg: stressAvg
        }
    }
}

extension BodySample {
    /// Merge every source's rows into one sample per date, oldest first.
    @MainActor static func merged(_ rows: [BodyDay]) -> [BodySample] {
        var byDate: [String: BodySample] = [:]
        // Garmin first so Health overwrites it field by field.
        for r in rows.sorted(by: { ($0.source == "health" ? 1 : 0) < ($1.source == "health" ? 1 : 0) }) {
            var s = byDate[r.date] ?? BodySample(date: r.date)
            func take(_ v: Int?, _ kp: WritableKeyPath<BodySample, Double?>) { if let v { s[keyPath: kp] = Double(v) } }
            take(r.sleepMinutes, \.sleepMinutes)
            take(r.deepMinutes, \.deepMinutes)
            take(r.remMinutes, \.remMinutes)
            take(r.sleepStartMin, \.sleepStartMin)
            take(r.restingHr, \.restingHr)
            take(r.hrvNight, \.hrvNight)
            take(r.bodyBatteryHigh, \.bodyBatteryHigh)
            take(r.bodyBatteryLow, \.bodyBatteryLow)
            take(r.stressAvg, \.stressAvg)
            take(r.steps, \.steps)
            byDate[r.date] = s
        }
        return byDate.values.sorted { $0.date < $1.date }
    }
}
