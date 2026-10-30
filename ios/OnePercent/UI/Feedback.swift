import SwiftUI

/// Transient messages — the native stand-in for the web app's toasts.
@Observable final class Toasts {
    struct Toast: Identifiable, Equatable {
        let id = UUID()
        let text: String
        let icon: String?
        let isError: Bool
    }

    var current: Toast?

    func show(_ text: String, icon: String? = nil) { present(Toast(text: text, icon: icon, isError: false)) }
    func error(_ text: String) { present(Toast(text: text, icon: "exclamationmark.circle", isError: true)) }

    private func present(_ t: Toast) {
        withAnimation(.spring(duration: 0.3)) { current = t }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(3.2))
            if current?.id == t.id { withAnimation(.easeOut(duration: 0.25)) { current = nil } }
        }
    }
}

struct ToastOverlay: ViewModifier {
    @Environment(Toasts.self) private var toasts

    func body(content: Content) -> some View {
        content.overlay(alignment: .top) {
            if let t = toasts.current {
                HStack(spacing: 8) {
                    if let icon = t.icon { Image(systemName: icon) }
                    Text(t.text).font(.ui(14, weight: .medium))
                }
                .foregroundStyle(t.isError ? Theme.red : Theme.ink)
                .padding(.horizontal, 16).padding(.vertical, 12)
                .background(.regularMaterial, in: Capsule())
                .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .transition(.move(edge: .top).combined(with: .opacity))
                .onTapGesture { toasts.current = nil }
            }
        }
    }
}

extension View {
    func toasts() -> some View { modifier(ToastOverlay()) }
}

/// A short burst of confetti, in the web app's graphite tones plus one green.
struct ConfettiBurst: View {
    let trigger: Int

    private struct Piece {
        let angle: Double, speed: Double, spin: Double, color: Color, size: CGSize
    }

    @State private var start: Date?
    @State private var pieces: [Piece] = []
    private let duration = 1.6
    private let colors = [Color(hex: 0x2F2F2C), Color(hex: 0x6E6E68), Color(hex: 0xAEAEA7), Color(hex: 0x3F6B4D), Color(hex: 0xB8714C)]

    var body: some View {
        TimelineView(.animation(paused: start == nil)) { tl in
            Canvas { ctx, size in
                guard let start else { return }
                let t = tl.date.timeIntervalSince(start)
                guard t < duration else { return }
                let origin = CGPoint(x: size.width / 2, y: size.height * 0.55)
                for p in pieces {
                    let x = origin.x + cos(p.angle) * p.speed * t
                    let y = origin.y + sin(p.angle) * p.speed * t + 600 * t * t
                    var c = ctx
                    c.opacity = max(0, 1 - t / duration)
                    c.translateBy(x: x, y: y)
                    c.rotate(by: .radians(p.spin * t))
                    c.fill(Path(CGRect(origin: CGPoint(x: -p.size.width / 2, y: -p.size.height / 2), size: p.size)), with: .color(p.color))
                }
            }
        }
        .allowsHitTesting(false)
        .onChange(of: trigger) {
            pieces = (0..<90).map { _ in
                // Upward cone, ~70° spread, like canvas-confetti's defaults.
                Piece(
                    angle: -Double.pi / 2 + Double.random(in: -0.62...0.62),
                    speed: .random(in: 380...760), spin: .random(in: -9...9),
                    color: colors.randomElement()!, size: CGSize(width: .random(in: 5...9), height: .random(in: 3...6))
                )
            }
            start = Date()
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(duration))
                start = nil
            }
        }
    }
}
