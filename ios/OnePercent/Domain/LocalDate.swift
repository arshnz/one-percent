import Foundation

// Local calendar dates as "YYYY-MM-DD" strings — the convention the whole app
// (and the data imported from the web app) runs on. Strings sort correctly, so
// `a < b` is date order, which the ported logic leans on everywhere.
//
// Arithmetic on a date string is done in UTC: a calendar date has no time zone,
// and UTC has no DST, so "add one day" can never skip or repeat. A time zone
// only enters when turning an instant (a Date) into a local date.
nonisolated enum LocalDate {
    private static let utc: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    private static func formatter(_ tz: TimeZone) -> DateFormatter {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = tz
        f.dateFormat = "yyyy-MM-dd"
        return f
    }

    private static let utcFormatter = formatter(TimeZone(identifier: "UTC")!)

    /// The local calendar date of an instant in the given IANA time zone.
    static func of(_ date: Date, tz: String) -> String {
        formatter(TimeZone(identifier: tz) ?? .current).string(from: date)
    }

    /// Today, in the given time zone.
    static func today(tz: String, now: Date = Date()) -> String { of(now, tz: tz) }

    private static func parse(_ iso: String) -> Date? { utcFormatter.date(from: iso) }

    /// 0 = Sunday … 6 = Saturday.
    static func weekday(_ iso: String) -> Int {
        guard let d = parse(iso) else { return 0 }
        return utc.component(.weekday, from: d) - 1
    }

    static func shift(_ iso: String, by days: Int) -> String {
        guard let d = parse(iso), let out = utc.date(byAdding: .day, value: days, to: d) else { return iso }
        return utcFormatter.string(from: out)
    }

    /// Every date from `from` to `to`, inclusive. Empty if `to < from`.
    static func range(_ from: String, _ to: String) -> [String] {
        guard from <= to else { return [] }
        var out: [String] = []
        var d = from
        // Ten years of days is a runaway guard, not a limit anyone will reach.
        while d <= to && out.count < 3700 {
            out.append(d)
            d = shift(d, by: 1)
        }
        return out
    }

    /// The Monday of the week containing `iso`. Weeks run Monday → Sunday.
    static func mondayOf(_ iso: String) -> String {
        shift(iso, by: -((weekday(iso) + 6) % 7))
    }

    /// Minutes since local midnight (0–1439) of an instant.
    static func minutesOfDay(_ date: Date, tz: String) -> Int {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: tz) ?? .current
        let parts = c.dateComponents([.hour, .minute], from: date)
        return (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
    }

    /// "HH:MM" → minutes since midnight, or nil if malformed.
    static func parseHHMM(_ t: String?) -> Int? {
        guard let t = t?.trimmingCharacters(in: .whitespaces) else { return nil }
        let parts = t.split(separator: ":")
        guard parts.count == 2, parts[1].count == 2,
              let h = Int(parts[0]), let m = Int(parts[1]),
              (0...23).contains(h), (0...59).contains(m) else { return nil }
        return h * 60 + m
    }
}
