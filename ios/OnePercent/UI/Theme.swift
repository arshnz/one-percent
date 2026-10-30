import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

// The web app's palette — warm graphite, one terracotta accent, one green for
// "you showed up" — with dark-mode counterparts. Serif headings use New York,
// the system serif, in place of the web's Newsreader.
enum Theme {
    static let bg = dynamic(0xEEEEEC, 0x121210)
    static let card = dynamic(0xFFFFFF, 0x1D1C19)
    static let panel = dynamic(0xF6F3ED, 0x272520)
    static let line = dynamic(0xECE9E2, 0x2F2D28)
    static let ink = dynamic(0x1B1A17, 0xF2EFE8)
    static let ink2 = dynamic(0x6F6B62, 0xBDB8AE)
    static let muted = dynamic(0x8C887F, 0x938E84)
    static let faint = dynamic(0xA6A199, 0x77736B)
    static let accent = dynamic(0xB8714C, 0xD08A63)
    static let accentSoft = dynamic(0xFBF4EE, 0x33261E)
    static let green = dynamic(0x2F9E6E, 0x3DB884)
    static let red = dynamic(0xC84B31, 0xE0664B)
    static let redSoft = dynamic(0xFCF8F7, 0x2E1E1A)
    static let amber = dynamic(0xE0A93E, 0xE8B54F)
    static let gold = dynamic(0x8A6B3F, 0xC9A472)
    static let rest = dynamic(0xE7E3DB, 0x3A3832)
    static let button = dynamic(0x1B1A17, 0xF2EFE8)
    static let buttonText = dynamic(0xFFFFFF, 0x1B1A17)
    static let breakAccent = dynamic(0x5C6BC0, 0x8592D8)

    /// Deterministic per-habit accent — the same id always gets the same colour.
    static let habitPalette: [Color] = [
        Color(hex: 0x5B7F95), Color(hex: 0x8B6E4E), Color(hex: 0x6B8F71),
        Color(hex: 0x9B7EA4), Color(hex: 0xC2855A), Color(hex: 0x7A9EA0),
    ]

    static func accent(for h: Habit) -> Color {
        if h.kind == "break" { return breakAccent }
        // The web app's string hash, kept so colours carry across.
        var hash: Int32 = 0
        for u in h.uid.utf16 { hash = (hash &<< 5) &- hash &+ Int32(u) }
        return habitPalette[Int(abs(Int64(hash)) % Int64(habitPalette.count))]
    }

    // Nonisolated on purpose: SwiftUI resolves dynamic colours on its render
    // thread, and a main-actor closure there traps at runtime.
    nonisolated private static func dynamic(_ light: UInt32, _ dark: UInt32) -> Color {
        #if os(iOS)
        Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
        #else
        Color(nsColor: NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(hex: dark) : NSColor(hex: light) })
        #endif
    }
}

#if os(iOS)
typealias PlatformColor = UIColor
#else
typealias PlatformColor = NSColor
#endif

extension Color {
    nonisolated init(hex: UInt32) {
        #if os(iOS)
        self.init(uiColor: UIColor(hex: hex))
        #else
        self.init(nsColor: NSColor(hex: hex))
        #endif
    }
}

extension PlatformColor {
    nonisolated convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: 1
        )
    }
}

extension Font {
    static func serif(_ size: CGFloat, italic: Bool = false) -> Font {
        let f = Font.system(size: size, design: .serif)
        return italic ? f.italic() : f
    }

    /// The small uppercase tracking labels the web app uses everywhere.
    static let eyebrow = Font.system(size: 11, weight: .semibold)
}

struct Eyebrow: View {
    let text: String
    var color: Color = Theme.faint

    init(_ text: String, color: Color = Theme.faint) {
        self.text = text
        self.color = color
    }

    var body: some View {
        Text(text.uppercased()).font(.eyebrow).tracking(1.6).foregroundStyle(color)
    }
}

struct CardBackground: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .shadow(color: .black.opacity(0.05), radius: 15, y: 8)
    }
}

extension View {
    func card() -> some View { modifier(CardBackground()) }
}

/// The primary black button.
struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Theme.buttonText)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(Theme.button.opacity(configuration.isPressed ? 0.85 : 1), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(Theme.ink2)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Theme.line, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

struct LinkButtonStyle: ButtonStyle {
    var color: Color = Theme.muted

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13))
            .underline()
            .foregroundStyle(color)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}
