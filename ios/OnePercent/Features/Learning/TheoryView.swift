import SwiftUI

// "The Science of Habit" — a port of client/src/pages/Theory.tsx. A static
// refresher of the workbook's opening chapter; everything else in the app is
// built on these models. No data, no state.
struct TheoryView: View {
    private static let loop = [
        ("Cue", "The trigger that signals a reward might be nearby — a piece of information your brain notices."),
        ("Craving", "The motivational force. Your mind interprets the cue and wants the change in state it promises."),
        ("Response", "The habit itself — the thought or action you actually perform to get the reward."),
        ("Reward", "What you were after. It satisfies you and teaches your brain that this behaviour is worth repeating."),
    ]
    private static let laws = [
        ("1", "Cue", "Make it obvious", "Make it invisible"),
        ("2", "Craving", "Make it attractive", "Make it unattractive"),
        ("3", "Response", "Make it easy", "Make it difficult"),
        ("4", "Reward", "Make it satisfying", "Make it unsatisfying"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Label(caps("Theory"), systemImage: "book").font(.eyebrow).capsTracking(1.4).foregroundStyle(Theme.faint)
                Text("The science of habit").font(.ui(26, weight: .semibold)).tracking(-0.5).foregroundStyle(Theme.ink)
                Text("A quick refresher on the ideas behind behaviour change — the foundation everything else in this app is built on. Skim it whenever you need to reset your thinking.")
                    .font(.ui(14)).foregroundStyle(Theme.ink2)
            }
            card("Compounding", icon: "chart.line.uptrend.xyaxis", title: "1 percent better every day",
                 text: "Success is the product of daily habits, not once-in-a-lifetime transformations. A single 1% improvement is barely noticeable today — but repeated daily it compounds into something huge. Focus on your current trajectory, not your current results.",
                 quote: "Time magnifies the margin between success and failure. Good habits make time your ally; bad habits make time your enemy.") {
                CompoundingSketch().frame(height: 170)
            }
            card("Patience", icon: "mountain.2", title: "The Plateau of Latent Potential",
                 text: "We expect progress to be linear, but change often lags behind effort before arriving all at once. The early flat stretch — the Valley of Disappointment — is where most people quit. The work isn’t wasted; it just hasn’t crossed the threshold of visibility yet.",
                 quote: "When you finally break through, people will call it an overnight success. Only you know about the work you did long ago that made the jump possible.") {
                PlateauSketch().frame(height: 190)
            }
            card("Process", icon: "gearshape", title: "Systems over goals",
                 text: "Goals are the results you want; systems are the processes that get you there. Goals are good for setting direction, but you make progress through systems. If you’re stuck, the problem usually isn’t motivation — it’s the system. Change the system and you change the outcome.",
                 quote: "You do not rise to the level of your goals. You fall to the level of your systems.") { EmptyView() }
            card("Identity", icon: "person.text.rectangle", title: "Identity-based habits",
                 text: "Behaviours that match your identity feel effortless; ones that fight it feel like a chore. So lasting change starts with a new identity, not a new goal. It’s a two-step loop:",
                 quote: "Every action you take is a vote for the type of person you wish to become. True behaviour change is identity change.") {
                VStack(alignment: .leading, spacing: 8) {
                    numbered(1, "Decide the type of person you want to be.")
                    numbered(2, "Prove it to yourself with small wins.")
                }
            }
            card("Mechanics", icon: "repeat", title: "The habit loop",
                 text: "Every habit runs through the same four-step neurological feedback loop. Learn to spot these in your own routines — it’s the skill underneath both building good habits and breaking bad ones.",
                 quote: nil) {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(Array(Self.loop.enumerated()), id: \.offset) { i, s in
                        VStack(alignment: .leading, spacing: 4) {
                            numbered(i + 1, s.0, bold: true)
                            Text(s.1).font(.ui(13)).foregroundStyle(Theme.ink2)
                        }
                        .padding(12).frame(maxWidth: .infinity, alignment: .leading).background(Theme.bg, in: RoundedRectangle(cornerRadius: 12))
                    }
                    Text("Cue → craving → response → reward. The cue notices the reward, the craving wants it, the response obtains it, and the reward teaches your brain to do it again.")
                        .font(.ui(13)).foregroundStyle(Theme.ink2)
                }
            }
            card("The playbook", icon: "scalemass", title: "The Four Laws of Behavior Change",
                 text: "The Four Laws turn each step of the habit loop into a lever. Set the levers one way to build a good habit; invert them to break a bad one.",
                 quote: nil) {
                Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 10) {
                    GridRow {
                        Text("Step"); Text("Build a good habit"); Text("Break a bad habit")
                    }
                    .font(.ui(11, weight: .semibold)).foregroundStyle(Theme.faint)
                    Divider()
                    ForEach(Self.laws, id: \.0) { n, step, build, brk in
                        GridRow {
                            Text("\(n). \(step)").fontWeight(.medium)
                            Text(build)
                            Text(brk).foregroundStyle(Theme.ink2)
                        }
                        .font(.ui(13))
                    }
                }
                Text("This is the same build/break framing your habits use — good habits lean on the laws, habits you’re quitting lean on their inverse.")
                    .font(.ui(12)).foregroundStyle(Theme.faint)
            }
        }
    }

    private func numbered(_ n: Int, _ text: String, bold: Bool = false) -> some View {
        HStack(spacing: 10) {
            Text("\(n)").font(.ui(12, weight: .bold)).foregroundStyle(Theme.accent)
                .frame(width: 24, height: 24).background(Theme.accent.opacity(0.15), in: Circle())
            Text(text).font(.ui(14, weight: bold ? .semibold : .regular)).foregroundStyle(Theme.ink)
        }
    }

    private func card<Extra: View>(_ eyebrow: String, icon: String, title: String, text: String, quote: String?, @ViewBuilder extra: () -> Extra) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(caps(eyebrow), systemImage: icon).font(.ui(11, weight: .semibold)).capsTracking(1).foregroundStyle(Theme.faint)
            Text(title).font(.serif(21)).foregroundStyle(Theme.ink)
            Text(text).font(.ui(14)).foregroundStyle(Theme.ink2)
            extra()
            if let quote {
                HStack(spacing: 12) {
                    Theme.accent.opacity(0.45).frame(width: 2)
                    Text("“\(quote)”").font(.serif(15, italic: true)).foregroundStyle(Theme.ink)
                }
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }
}

/// The book's sketch: a flat baseline, compounding up and compounding down.
private struct CompoundingSketch: View {
    var body: some View {
        Canvas { ctx, size in
            let x0: CGFloat = 8, y0 = size.height * 0.62, right = size.width - 4, top: CGFloat = 8, bottom = size.height - 6
            var axes = Path()
            axes.move(to: CGPoint(x: x0, y: top)); axes.addLine(to: CGPoint(x: x0, y: bottom)); axes.addLine(to: CGPoint(x: right, y: bottom))
            ctx.stroke(axes, with: .color(Theme.faint), lineWidth: 1.5)
            var base = Path(); base.move(to: CGPoint(x: x0, y: y0)); base.addLine(to: CGPoint(x: right, y: y0))
            ctx.stroke(base, with: .color(Theme.faint), style: StrokeStyle(lineWidth: 1.5, dash: [6, 5]))
            var up = Path(), down = Path()
            for i in 0...60 {
                let t = CGFloat(i) / 60
                let x = x0 + t * (right - x0)
                let pu = CGPoint(x: x, y: y0 - pow(t, 2.4) * (y0 - top))
                let pd = CGPoint(x: x, y: y0 + pow(t, 0.55) * (bottom - y0))
                if i == 0 { up.move(to: pu); down.move(to: pd) } else { up.addLine(to: pu); down.addLine(to: pd) }
            }
            ctx.stroke(up, with: .color(Theme.accent), style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
            ctx.stroke(down, with: .color(Theme.ink2), style: StrokeStyle(lineWidth: 2, lineCap: .round))
            ctx.draw(Text("1% IMPROVEMENT").font(.ui(9, weight: .semibold)).foregroundStyle(Theme.faint), at: CGPoint(x: x0 + 6, y: y0 - 10), anchor: .leading)
            ctx.draw(Text("1% DECLINE").font(.ui(9, weight: .semibold)).foregroundStyle(Theme.faint), at: CGPoint(x: right - 4, y: bottom - 16), anchor: .trailing)
            ctx.draw(Text("RESULTS").font(.ui(9, weight: .semibold)).foregroundStyle(Theme.faint), at: CGPoint(x: x0 + 6, y: top + 4), anchor: .leading)
        }
        .accessibilityLabel("1 percent improvement compounds upward over time while 1 percent decline compounds downward")
    }
}

/// The book's sketch: what you think should happen vs the Valley of Disappointment.
private struct PlateauSketch: View {
    var body: some View {
        Canvas { ctx, size in
            let x0: CGFloat = 8, y0 = size.height - 34, right = size.width - 14, top: CGFloat = 8
            var axes = Path()
            axes.move(to: CGPoint(x: x0, y: top)); axes.addLine(to: CGPoint(x: x0, y: y0)); axes.addLine(to: CGPoint(x: right, y: y0))
            ctx.stroke(axes, with: .color(Theme.faint), lineWidth: 1.5)
            var expect = Path(); expect.move(to: CGPoint(x: x0, y: y0)); expect.addLine(to: CGPoint(x: right - 10, y: top + 30))
            ctx.stroke(expect, with: .color(Theme.ink2), lineWidth: 2)
            var actual = Path()
            for i in 0...60 {
                let t = CGFloat(i) / 60
                let p = CGPoint(x: x0 + t * (right - 10 - x0), y: y0 - pow(t, 3.4) * (y0 - top - 20))
                if i == 0 { actual.move(to: p) } else { actual.addLine(to: p) }
            }
            ctx.stroke(actual, with: .color(Theme.accent), lineWidth: 2.2)
            for (s, p) in [
                ("WHAT YOU THINK SHOULD HAPPEN", CGPoint(x: x0 + 40, y: top + 12)),
                ("WHAT ACTUALLY HAPPENS", CGPoint(x: size.width * 0.5, y: y0 - 12)),
                ("VALLEY OF DISAPPOINTMENT", CGPoint(x: x0 + 16, y: y0 + 16)),
                ("TIME", CGPoint(x: right - 26, y: y0 + 16)),
            ] {
                ctx.draw(Text(s).font(.ui(9, weight: .semibold)).foregroundStyle(Theme.faint), at: p, anchor: .leading)
            }
        }
        .accessibilityLabel("Expected progress is a straight line; actual results dip into the Valley of Disappointment before breaking upward")
    }
}
