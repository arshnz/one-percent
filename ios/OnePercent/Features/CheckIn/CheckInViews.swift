import SwiftUI
import SwiftData

// The weekly check-in — a port of CheckInCard.tsx. A compact card on the
// Launchpad; the full review opens as a sheet. The reflective AI conversation
// arrives with the AI phase; everything else is here.

struct CheckInCardView: View {
    let pack: CheckInPack
    let onChanged: () -> Void
    let onSnooze: () -> Void

    @Environment(\.modelContext) private var ctx
    @Environment(Toasts.self) private var toasts
    @Query private var checkIns: [CheckIn]
    @State private var open = false

    private let green = Color(hex: 0x2F9E6E)

    var body: some View {
        HStack(alignment: .top) {
            Button { open = true } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Look back on your week", systemImage: "calendar.badge.checkmark")
                        .font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink)
                    Text("A few honest minutes, when you’re ready. Tap to look back.")
                        .font(.system(size: 13)).foregroundStyle(Theme.ink2).multilineTextAlignment(.leading)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            Menu {
                Button("Snooze until tomorrow", systemImage: "moon.zzz", action: onSnooze)
                Button("Skip this week", systemImage: "forward") {
                    do {
                        try CheckInPack.skip(weekOf: pack.weekOf, existing: checkIns, ctx: ctx)
                        toasts.show("Skipped this week — see you Monday.")
                        onChanged()
                    } catch { toasts.error("Could not skip the check-in.") }
                }
            } label: {
                Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted)
                    .frame(width: 32, height: 32)
            }
            .accessibilityLabel("Dismiss the check-in")
        }
        .padding(18)
        .background(green.opacity(0.08), in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(green.opacity(0.25)))
        .sheet(isPresented: $open) {
            CheckInSheet(pack: pack, onSaved: { open = false; onChanged() }).macSheet(width: 600, height: 760)
        }
    }
}

struct CheckInSheet: View {
    let pack: CheckInPack
    let onSaved: () -> Void

    @Environment(\.modelContext) private var ctx
    @Environment(\.dismiss) private var dismiss
    @Environment(Toasts.self) private var toasts
    @Query private var checkIns: [CheckIn]
    @Query private var profiles: [Profile]

    @State private var draft = CheckInPack.Draft()
    @State private var messages: [ChatMessage] = []
    @State private var saving = false
    @Query private var habits: [Habit]
    @Query private var goals: [Goal]
    /// "What got in the way?" sweep picks, keyed habit|date.
    @State private var sweep: [String: (reasons: [String], note: String)] = [:]
    @State private var savedMisses: Set<String> = []

    private let green = Color(hex: 0x2F9E6E)
    private var tz: String { profiles.first?.timezone ?? TimeZone.current.identifier }

    var body: some View {
        NavigationStack {
            Form {
                if !pack.summary.isEmpty {
                    Section("This week, habit by habit") {
                        ForEach(Array(pack.summary.enumerated()), id: \.offset) { _, s in
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(s.title).font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.ink)
                                    if !s.redDots.isEmpty {
                                        Text("Missed: \(s.redDots.joined(separator: ", "))").font(.system(size: 12)).foregroundStyle(Theme.muted)
                                    }
                                }
                                Spacer()
                                Text("\(s.hits)/\(s.scheduled) \(s.scheduleType == "weekly" ? "sessions" : "days")")
                                    .font(.system(size: 12, weight: .medium))
                                    .padding(.horizontal, 10).padding(.vertical, 4)
                                    .foregroundStyle(s.hits >= s.scheduled ? green : Theme.muted)
                                    .background((s.hits >= s.scheduled ? green.opacity(0.12) : Color.black.opacity(0.06)), in: Capsule())
                            }
                        }
                    }
                }

                let misses = pack.unexplainedMisses.filter { !savedMisses.contains($0.id) }
                if !misses.isEmpty {
                    Section {
                        ForEach(misses) { m in missRow(m) }
                        let answered = misses.filter { row($0.id).reasons.count > 0 || !row($0.id).note.trimmed.isEmpty }
                        if !answered.isEmpty {
                            Button("Save \(answered.count == 1 ? "this reason" : "\(answered.count) reasons")") { saveReasons(answered) }
                        }
                    } header: {
                        Text("What got in the way?")
                    } footer: {
                        Text("A few scheduled days slipped by — naming why helps next week’s plan. Skip any you like.")
                    }
                }

                Section {
                    GuidedChatView(messages: $messages, modelName: "Companion", system: {
                        Prompts.checkinSystemWithPack(Prompts.checkinPack(habits: habits, goals: goals, now: Date(), tz: tz))
                    }, placeholder: "Reflect honestly...")
                    .listRowInsets(EdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12))
                } header: {
                    Text("Talk it through")
                } footer: {
                    Text("Optional. A short, warm conversation about your real week — what you say is distilled into two sentences the coach remembers.")
                }

                Section("Overall, how did the week feel?") {
                    HStack(spacing: 4) {
                        ForEach(1...10, id: \.self) { n in
                            let on = draft.rating == n
                            Button { draft.rating = on ? nil : n } label: {
                                Text("\(n)").font(.system(size: 14, weight: .semibold))
                                    .frame(maxWidth: .infinity, minHeight: 36)
                                    .foregroundStyle(on ? .white : Theme.ink)
                                    .background(on ? green : Theme.panel, in: RoundedRectangle(cornerRadius: 8))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .sensoryFeedback(.selection, trigger: draft.rating)
                }

                Section("One tiny victory") {
                    TextField("However small — it counts.", text: $draft.tinyVictory, axis: .vertical)
                }
                Section("What’s working") { TextField("", text: $draft.workingWell, axis: .vertical).lineLimit(2...) }
                Section("What’s not working") { TextField("", text: $draft.notWorking, axis: .vertical).lineLimit(2...) }

                Section {
                    ForEach($draft.obstacles.indices, id: \.self) { i in
                        VStack(alignment: .leading, spacing: 6) {
                            TextField("If… the week gets busy", text: $draft.obstacles[i].obstacle)
                            TextField("…then I’ll do the 2-minute version", text: $draft.obstacles[i].plan)
                        }
                    }
                    .onDelete { draft.obstacles.remove(atOffsets: $0) }
                    if draft.obstacles.count < 5 {
                        Button("Add an if-then plan", systemImage: "plus") { draft.obstacles.append(SetbackPlan(obstacle: "", plan: "")) }
                    }
                } header: {
                    Text("Plans for next week’s obstacles")
                } footer: {
                    if !pack.priorObstacles.isEmpty {
                        Text("Last time: " + pack.priorObstacles.map { "if \($0.obstacle), then \($0.plan)" }.joined(separator: "; "))
                    }
                }

                Section("Anything else") { TextField("", text: $draft.freeform, axis: .vertical).lineLimit(2...) }

                Section {
                    Button(saving ? "Saving…" : pack.existing.map { $0.status != "skipped" } == true ? "Update this week’s check-in" : "Save this week’s check-in") { save() }
                        .frame(maxWidth: .infinity)
                        .fontWeight(.semibold)
                        .disabled(saving)
                }
            }
            .navigationTitle("Week of \(DateText.monthDay(pack.weekOf))")
            .inlineTitle()
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
        .onAppear {
            if let e = pack.existing { draft = CheckInPack.Draft(e) }
            guard messages.isEmpty else { return }
            let wins = pack.summary.filter { $0.scheduled > 0 }
            let opener = wins.isEmpty
                ? "Let's look back on your week together — an honest, no-guilt review."
                : "You showed up \(wins.reduce(0) { $0 + $1.hits }) times across \(wins.count) \(wins.count == 1 ? "habit" : "habits") this week. Let's look back together — no scores, just an honest look."
            messages = [ChatMessage(role: "model", text: "\(opener) First: overall, how did the week feel, roughly 1 to 10?")]
        }
    }

    private func row(_ id: String) -> (reasons: [String], note: String) { sweep[id] ?? ([], "") }

    private func missRow(_ m: CheckInPack.UnexplainedMiss) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(m.habit.title) — \(m.weekdayName)").font(.system(size: 13.5, weight: .medium)).foregroundStyle(Theme.ink)
            ChipFlow(items: MissReasons.chips(setbackPlans: nil, extra: m.obstacles), label: { $0 }, isOn: { row(m.id).reasons.contains($0) }) { chip in
                var r = row(m.id)
                if let i = r.reasons.firstIndex(of: chip) { r.reasons.remove(at: i) } else if r.reasons.count < 5 { r.reasons.append(chip) }
                sweep[m.id] = r
            }
            TextField("Anything else? (optional)", text: Binding(get: { row(m.id).note }, set: { var r = row(m.id); r.note = String($0.prefix(500)); sweep[m.id] = r }))
                .font(.system(size: 13.5))
        }
        .padding(.vertical, 4)
    }

    private func saveReasons(_ answered: [CheckInPack.UnexplainedMiss]) {
        let today = LocalDate.today(tz: tz)
        do {
            for m in answered {
                let r = row(m.id)
                try DailyLoop.recordReason(m.habit, date: m.date, reasons: r.reasons, note: r.note.trimmed.nonEmpty, today: today, ctx: ctx)
                savedMisses.insert(m.id)
                sweep[m.id] = nil
            }
            toasts.show("Noted — that’s next week’s plan taking shape.")
        } catch { toasts.error("Could not save those reasons.") }
    }

    private func save() {
        saving = true
        Task {
            var d = draft
            // Distil the conversation to two sentences the coach will remember.
            if messages.contains(where: { $0.role == "user" }) {
                d.aiSummary = try? await AIEngine.respond(
                    system: Prompts.checkinSummarySystem,
                    prompt: AIEngine.clip(Prompts.transcript(messages, model: "COMPANION"), to: AIEngine.promptBudget)
                ).trimmed.nonEmpty ?? d.aiSummary
            }
            do {
                try CheckInPack.save(weekOf: pack.weekOf, d, existing: checkIns, ctx: ctx)
                toasts.show("Check-in saved. See you next week.")
                onSaved()
                // Refresh the Momentum insights in the background — a bonus, so
                // a failure here never blocks or toasts.
                Task { try? await Insights.regenerate(ctx) }
            } catch { toasts.error("Could not save your check-in.") }
            saving = false
        }
    }
}
