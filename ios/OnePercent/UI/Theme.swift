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
    #if os(macOS)
    // The Mac follows the system: its window and control colours, label
    // greys and separators, so the app sits in macOS like any other — light,
    // dark and accessibility contrast included. The terracotta stays as the
    // accent, which is what keeps it recognisably One Percent.
    static let bg = Color(nsColor: .windowBackgroundColor)
    static let card = Color(nsColor: .controlBackgroundColor)
    static let panel = Color(nsColor: .quaternarySystemFill)
    static let line = Color(nsColor: .separatorColor)
    static let ink = Color(nsColor: .labelColor)
    static let ink2 = Color(nsColor: .secondaryLabelColor)
    static let muted = Color(nsColor: .secondaryLabelColor)
    static let faint = Color(nsColor: .tertiaryLabelColor)
    static let accent = dynamic(0xB8714C, 0xD08A63)
    static let accentSoft = accent.opacity(0.12)
    static let green = Color(nsColor: .systemGreen)
    static let red = Color(nsColor: .systemRed)
    static let redSoft = Color(nsColor: .systemRed).opacity(0.08)
    static let amber = Color(nsColor: .systemOrange)
    static let gold = dynamic(0x8A6B3F, 0xC9A472)
    static let rest = Color(nsColor: .tertiarySystemFill)
    static let button = accent
    static let buttonText = Color.white
    static let breakAccent = Color(nsColor: .systemIndigo)

    #else
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
    #endif

    /// The "Paused" badge — muted violet, with a dark-mode pair.
    static let pausedInk = dynamic(0x5B4B86, 0xB8ABDF)
    static let pausedBg = dynamic(0xEFEAF7, 0x2B2539)

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
    /// A fixed point size, scaled for the platform. The screens were sized for
    /// a phone; a Mac app's body text is 13pt, not 15, so the Mac draws every
    /// size about an eighth smaller. The iPhone gets exactly what's written.
    static func ui(_ size: CGFloat, weight: Font.Weight = .regular, design: Font.Design = .default) -> Font {
        #if os(macOS)
        .system(size: (size * 0.88).rounded(), weight: weight, design: design)
        #else
        .system(size: size, weight: weight, design: design)
        #endif
    }

    /// Headings in New York on the iPhone, as on the web. The Mac uses the
    /// system face throughout, as Mac apps do.
    static func serif(_ size: CGFloat, italic: Bool = false) -> Font {
        #if os(macOS)
        let f = italic ? Font.ui(size) : Font.ui(size, weight: .semibold)
        #else
        let f = Font.ui(size, design: .serif)
        #endif
        return italic ? f.italic() : f
    }

    /// The small uppercase tracking labels the web app uses everywhere.
    static let eyebrow = Font.ui(11, weight: .semibold)
}

/// Small label text: tracked capitals on the iPhone, as on the web; plain
/// sentence case on the Mac, which doesn't shout its section labels.
func caps(_ s: String) -> String {
    #if os(macOS)
    s
    #else
    s.uppercased()
    #endif
}

extension View {
    /// Letter-spacing for `caps` text — the Mac's sentence case doesn't want it.
    @ViewBuilder func capsTracking(_ t: CGFloat) -> some View {
        #if os(macOS)
        self
        #else
        tracking(t)
        #endif
    }
}

struct Eyebrow: View {
    let text: String
    var color: Color = Theme.faint

    init(_ text: String, color: Color = Theme.faint) {
        self.text = text
        self.color = color
    }

    var body: some View {
        #if os(macOS)
        // Mac section headers are sentence case, not tracked capitals.
        Text(text).font(.ui(13, weight: .semibold)).foregroundStyle(color == Theme.faint ? Theme.ink2 : color)
        #else
        Text(text.uppercased()).font(.eyebrow).tracking(1.6).foregroundStyle(color)
        #endif
    }
}

struct CardBackground: ViewModifier {
    func body(content: Content) -> some View {
        #if os(macOS)
        // A grouped box, as in System Settings: a hairline, no floating shadow.
        content
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.line, lineWidth: 0.5))
        #else
        content
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .shadow(color: .black.opacity(0.05), radius: 15, y: 8)
        #endif
    }
}

extension View {
    func card() -> some View { modifier(CardBackground()) }
}

/// The primary black button — on the Mac, an accent-filled control at Mac size.
struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        #if os(macOS)
        configuration.label
            .font(.ui(14, weight: .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 32)
            .background(Theme.accent.opacity(configuration.isPressed ? 0.8 : 1), in: Capsule())
        #else
        configuration.label
            .font(.ui(15, weight: .semibold))
            .foregroundStyle(Theme.buttonText)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(Theme.button.opacity(configuration.isPressed ? 0.85 : 1), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        #endif
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        #if os(macOS)
        configuration.label
            .font(.ui(14, weight: .medium))
            .foregroundStyle(Theme.ink)
            .frame(maxWidth: .infinity, minHeight: 32)
            .background(Theme.rest.opacity(configuration.isPressed ? 1.5 : 1), in: Capsule())
        #else
        configuration.label
            .font(.ui(15, weight: .medium))
            .foregroundStyle(Theme.ink2)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Theme.line, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.8 : 1)
        #endif
    }
}

struct LinkButtonStyle: ButtonStyle {
    var color: Color = Theme.muted

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.ui(13))
            #if os(iOS)
            .underline()
            #endif
            .foregroundStyle(color)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}
