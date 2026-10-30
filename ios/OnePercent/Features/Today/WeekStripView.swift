import SwiftUI

// The never-miss-twice strip — the workbook's green-dot/red-dot tracker.
// Accent = showed up, amber = fail-safe (still a vote), red = missed a
// scheduled day, hollow = today still open, faint = rest day or before the
// habit existed. Two reds in a row get a warning ring.
struct WeekStripView: View {
    let days: [WeekStripDay]
    let accent: Color
    /// Tap a past day to correct it.
    var onEdit: ((String) -> Void)?

    private enum Kind { case vote, failsafe, miss, open, rest }
    private static let letters = ["S", "M", "T", "W", "T", "F", "S"]

    private func kind(_ d: WeekStripDay, isToday: Bool) -> Kind {
        if !d.scheduled { return .rest }
        switch d.status {
        case "target": return .vote
        case "failsafe": return .failsafe
        case "miss": return .miss
        default: return isToday ? .open : .miss
        }
    }

    var body: some View {
        let kinds = days.enumerated().map { kind($1, isToday: $0 == days.count - 1) }
        HStack(alignment: .bottom, spacing: 10) {
            ForEach(Array(days.enumerated()), id: \.element.date) { i, d in
                let k = kinds[i]
                let isToday = i == days.count - 1
                let canEdit = onEdit != nil && d.editable && !isToday
                VStack(spacing: 4) {
                    dot(k, secondMiss: k == .miss && i > 0 && kinds[i - 1] == .miss)
                        .frame(width: 28, height: 28)
                        .contentShape(Circle())
                        .onTapGesture { if canEdit { onEdit?(d.date) } }
                        .accessibilityLabel(label(d, k))
                        .accessibilityAddTraits(canEdit ? .isButton : [])
                    Text(Self.letters[LocalDate.weekday(d.date)])
                        .font(.ui(9, weight: .medium))
                        .foregroundStyle(isToday ? Theme.ink2 : Theme.faint)
                }
            }
        }
        .padding(.top, 10)
    }

    @ViewBuilder private func dot(_ k: Kind, secondMiss: Bool) -> some View {
        let size: CGFloat = 11
        Group {
            switch k {
            case .vote: Circle().fill(accent)
            case .failsafe: Circle().fill(Theme.amber)
            case .miss: Circle().fill(Theme.red)
            case .open: Circle().strokeBorder(Theme.faint, lineWidth: 1.5)
            case .rest: Circle().fill(Theme.rest)
            }
        }
        .frame(width: size, height: size)
        .overlay {
            if secondMiss { Circle().stroke(Theme.red.opacity(0.3), lineWidth: 2).frame(width: size + 6, height: size + 6) }
        }
    }

    private func label(_ d: WeekStripDay, _ k: Kind) -> String {
        let what = switch k {
        case .vote: "voted"
        case .failsafe: "fail-safe"
        case .miss: "missed"
        case .open: "still open"
        case .rest: "rest day"
        }
        return "\(DateText.weekday(d.date)), \(what)"
    }
}

nonisolated enum DateText {
    private static func date(_ iso: String) -> Date {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: iso) ?? Date()
    }

    private static func format(_ iso: String, _ pattern: String) -> String {
        let f = DateFormatter()
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = pattern
        return f.string(from: date(iso))
    }

    /// "Wednesday"
    static func weekday(_ iso: String) -> String { format(iso, "EEEE") }
    /// "Wednesday, Oct 29"
    static func dayMonth(_ iso: String) -> String { format(iso, "EEEE, MMM d") }
    /// "October 27"
    static func monthDay(_ iso: String) -> String { format(iso, "MMMM d") }
    /// "Wednesday, October 29"
    static func long(_ iso: String) -> String { format(iso, "EEEE, MMMM d") }
}
