import SwiftUI

// The bottom sheets around a vote: calibration, "what got in the way", fixing
// a past day, the Automaticity Check and setting the next phase. All of them
// are skippable — closing a sheet never changes anything.

struct SheetHeader: View {
    let title: String
    var subtitle: String?
    var closeLabel = "Skip"
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Eyebrow(title)
                Spacer()
                Button(closeLabel, action: onClose).buttonStyle(LinkButtonStyle())
            }
            if let subtitle {
                Text(subtitle).font(.system(size: 13)).foregroundStyle(Theme.muted)
            }
        }
    }
}

struct ChipFlow<Item: Hashable>: View {
    let items: [Item]
    let label: (Item) -> String
    let isOn: (Item) -> Bool
    let toggle: (Item) -> Void

    var body: some View {
        FlowLayout(spacing: 8) {
            ForEach(items, id: \.self) { item in
                let on = isOn(item)
                Button { toggle(item) } label: {
                    Text(label(item))
                        .font(.system(size: 13.5, weight: .medium))
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .foregroundStyle(on ? Theme.gold : Theme.ink)
                        .background(on ? Theme.accentSoft : Theme.panel, in: Capsule())
                        .overlay(Capsule().stroke(on ? Theme.accent : Theme.line, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

/// Wraps children onto new lines, like CSS flex-wrap.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        rows(proposal.width ?? .infinity, subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for (i, p) in rows(bounds.width, subviews).points.enumerated() {
            subviews[i].place(at: CGPoint(x: bounds.minX + p.x, y: bounds.minY + p.y), proposal: .unspecified)
        }
    }

    private func rows(_ width: CGFloat, _ subviews: Subviews) -> (size: CGSize, points: [CGPoint]) {
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0, maxX: CGFloat = 0
        var points: [CGPoint] = []
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width { x = 0; y += rowH + spacing; rowH = 0 }
            points.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            rowH = max(rowH, size.height)
            maxX = max(maxX, x - spacing)
        }
        return (CGSize(width: maxX, height: y + rowH), points)
    }
}

// MARK: - Goldilocks

struct GoldilocksSheet: View {
    let onRate: (String) -> Void
    let onClose: () -> Void

    private let options = [("too_easy", "Too Easy"), ("just_right", "Just Right"), ("too_hard", "Too Hard")]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SheetHeader(title: "How did that feel?", onClose: onClose)
            HStack(spacing: 8) {
                ForEach(options, id: \.0) { value, label in
                    Button(label) { onRate(value) }
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Theme.ink)
                        .frame(maxWidth: .infinity, minHeight: 46)
                        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.line))
                }
            }
        }
        .padding(20)
        .presentationDetents([.height(150)])
    }
}

// MARK: - What got in the way?

struct MissReasonSheet: View {
    let title: String
    let chips: [String]
    let onSave: ([String], String) -> Void
    let onClose: () -> Void

    @State private var selected: [String] = []
    @State private var note = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SheetHeader(title: title, subtitle: "No judgment — naming it helps you plan around it.", onClose: onClose)
            ChipFlow(items: chips, label: { $0 }, isOn: { selected.contains($0) }) { chip in
                if let i = selected.firstIndex(of: chip) { selected.remove(at: i) }
                else if selected.count < 5 { selected.append(chip) }
            }
            TextField("Anything else? (optional)", text: $note)
                .textFieldStyle(.roundedBorder)
                .onChange(of: note) { if note.count > 500 { note = String(note.prefix(500)) } }
            Button("Save") { onSave(selected, note.trimmed) }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(selected.isEmpty && note.trimmed.isEmpty)
                .opacity(selected.isEmpty && note.trimmed.isEmpty ? 0.4 : 1)
        }
        .padding(20)
        .presentationDetents([.medium, .large])
    }
}

// MARK: - Fix a past day

struct EditDaySheet: View {
    let date: String
    let breaking: Bool
    let taper: Bool
    let dailyLimit: Int
    let currentStatus: String?
    let currentQuantity: Int?
    let onSetStatus: (String) -> Void
    let onSetCount: (Int) -> Void
    let onClear: () -> Void
    let onClose: () -> Void

    @State private var qty = 0

    private var options: [(String, String, String, Color)] {
        breaking
            ? [("target", "Clean day", "checkmark", Theme.green), ("failsafe", "Resisted the urge", "shield", Theme.accent), ("miss", "Relapsed", "xmark", Theme.red)]
            : [("target", "Cast the vote", "checkmark", Theme.green), ("failsafe", "Fail-safe — still counts", "shield", Theme.accent), ("miss", "Missed it", "xmark", Theme.red)]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SheetHeader(
                title: "Fix \(DateText.dayMonth(date))",
                subtitle: "Forgot to log this day? Set what really happened — it counts just the same.",
                closeLabel: "Close", onClose: onClose
            )
            if taper {
                VStack(spacing: 14) {
                    Text("Limit that day: \(dailyLimit). Under the line is a vote.").font(.system(size: 13)).foregroundStyle(Theme.muted)
                    Stepper3(value: $qty)
                    Button { onSetCount(qty) } label: { Label("Save that day’s count", systemImage: "checkmark") }
                        .buttonStyle(PrimaryButtonStyle())
                }
                .padding(16)
                .background(Theme.panel, in: RoundedRectangle(cornerRadius: 14))
            } else {
                VStack(spacing: 8) {
                    ForEach(options, id: \.0) { status, label, icon, tone in
                        let active = currentStatus == status
                        Button { onSetStatus(status) } label: {
                            HStack(spacing: 12) {
                                Image(systemName: icon).foregroundStyle(tone).frame(width: 20)
                                Text(label).foregroundStyle(Theme.ink)
                                Spacer()
                                if active { Eyebrow("Current", color: Theme.accent) }
                            }
                            .font(.system(size: 15, weight: .medium))
                            .padding(.horizontal, 16).frame(minHeight: 50)
                            .background(active ? Theme.accentSoft : Theme.panel, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(active ? Theme.accent : Theme.line))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            if currentStatus != nil {
                Button(role: .destructive, action: onClear) {
                    Label("Clear this day", systemImage: "trash").frame(maxWidth: .infinity)
                }
                .buttonStyle(LinkButtonStyle(color: Theme.faint))
            }
        }
        .padding(20)
        .presentationDetents([.medium])
        .onAppear { qty = currentQuantity ?? 0 }
    }
}

/// The − n + counter used by taper habits.
struct Stepper3: View {
    @Binding var value: Int

    var body: some View {
        HStack(spacing: 22) {
            round("minus") { value = max(0, value - 1) }
            Text("\(value)").font(.serif(32)).foregroundStyle(Theme.ink).frame(minWidth: 44).monospacedDigit()
            round("plus") { value = min(1000, value + 1) }
        }
        .sensoryFeedback(.selection, trigger: value)
    }

    private func round(_ icon: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 17, weight: .medium)).foregroundStyle(Theme.ink)
                .frame(width: 44, height: 44).background(Theme.card, in: Circle())
                .shadow(color: .black.opacity(0.08), radius: 2, y: 1)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Automaticity Check

struct AutomaticityCheckSheet: View {
    let habitTitle: String
    let onSubmit: ([Int]) -> DailyLoop.CheckResult?
    let onPassed: (Bool) -> Void
    let onClose: () -> Void

    @State private var scores: [Int?] = [nil, nil, nil, nil]
    @State private var failed = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if failed {
                        VStack(spacing: 10) {
                            Text("Not automatic yet — and that’s fine.").font(.serif(19)).foregroundStyle(Theme.ink)
                            Text("Keep casting votes. We’ll check again in about a week. Habits become second nature through repetition in a stable context, not by hitting a number.")
                                .font(.system(size: 14)).foregroundStyle(Theme.ink2).multilineTextAlignment(.center)
                            Button("Keep going", action: onClose).buttonStyle(PrimaryButtonStyle()).padding(.top, 8)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.top, 20)
                    } else {
                        Text("How true is each of these about “\(habitTitle)” right now?")
                            .font(.system(size: 14)).foregroundStyle(Theme.ink2)
                        ForEach(0..<4, id: \.self) { i in
                            VStack(alignment: .leading, spacing: 10) {
                                Text(Automaticity.items[i]).font(.system(size: 15, weight: .medium)).foregroundStyle(Theme.ink)
                                HStack(spacing: 6) {
                                    ForEach(1...5, id: \.self) { n in
                                        let on = scores[i] == n
                                        Button { scores[i] = n } label: {
                                            Text("\(n)").font(.system(size: 15, weight: .semibold))
                                                .frame(maxWidth: .infinity, minHeight: 42)
                                                .foregroundStyle(on ? Theme.buttonText : Theme.ink)
                                                .background(on ? Theme.button : Theme.panel, in: RoundedRectangle(cornerRadius: 10))
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                                HStack {
                                    Text("Disagree"); Spacer(); Text("Agree")
                                }
                                .font(.system(size: 11)).foregroundStyle(Theme.faint)
                            }
                        }
                        Button("Submit") {
                            guard let result = onSubmit(scores.compactMap { $0 }) else { return }
                            if result.passed { onPassed(result.advanced) } else { failed = true }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(scores.contains(nil))
                        .opacity(scores.contains(nil) ? 0.4 : 1)
                    }
                }
                .padding(20)
            }
            .navigationTitle("Automaticity Check")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close", action: onClose) } }
        }
        .sensoryFeedback(.selection, trigger: scores)
    }
}

// MARK: - Next phase

struct NextPhaseSheet: View {
    let habitTitle: String
    let nextPhaseNumber: Int
    let onSave: (String, String?, Int) -> Void
    let onClose: () -> Void

    @State private var target = ""
    @State private var done = ""
    @State private var count = 14

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("**\(habitTitle)** is on autopilot. Raise the bar a little — the next target should stretch you without breaking the routine.")
                        .font(.system(size: 14)).foregroundStyle(Theme.ink2)
                }
                Section("New daily target") {
                    TextField("Walk 25 mins on the treadmill", text: $target, axis: .vertical)
                }
                Section("Done when… (optional)") {
                    TextField("I’m back inside after 25 minutes", text: $done, axis: .vertical)
                }
                Section("Reps before the next check") {
                    Stepper("\(count) reps", value: $count, in: 1...365)
                }
            }
            .navigationTitle("Phase \(nextPhaseNumber)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Later", action: onClose) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { onSave(target.trimmed, done.trimmed.nonEmpty, count) }
                        .disabled(target.trimmed.isEmpty)
                }
            }
        }
    }
}
