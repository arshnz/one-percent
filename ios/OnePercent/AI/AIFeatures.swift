import SwiftUI
import SwiftData

// The AI surfaces, each a port of its web counterpart, and their registration
// into the slots the screens expose.

enum AIFeatures {
    /// Plug every AI surface into its screen. Called once at launch.
    @MainActor static func register() {
        CoachSlot.factory = { AnyView(CoachView()) }
        BlueprintSlot.factory = { kind, goal, seed, apply in
            AnyView(BlueprintInterviewView(kind: kind, goal: goal, seed: seed, onApply: apply))
        }
        CompassAISlot.factory = { stage, draft in AnyView(CompassAIHelper(stage: stage, draft: draft)) }
    }
}

// MARK: - Insights

enum Insights {
    /// Re-read the data and cache fresh "What the data says" on the profile.
    @MainActor static func regenerate(_ ctx: ModelContext, now: Date = Date()) async throws {
        guard let p = try ctx.fetch(FetchDescriptor<Profile>()).first else { return }
        let prompt = Prompts.insightsPrompt(AIEngine.clip(pack(ctx, now: now, tz: p.timezone), to: AIEngine.promptBudget))
        let out = try await AIEngine.generate(InsightsOut.self, system: Prompts.insightsSystem, prompt: prompt)
        let items = out.insights.map(\.trimmed).filter { !$0.isEmpty }.prefix(5)
        p.momentumInsights = JSONText.encode(Array(items))
        p.momentumInsightsAt = now
        try ctx.save()
    }

    @MainActor static func pack(_ ctx: ModelContext, now: Date, tz: String) -> String {
        let habits = (try? ctx.fetch(FetchDescriptor<Habit>())) ?? []
        let checkIns = (try? ctx.fetch(FetchDescriptor<CheckIn>())) ?? []
        let goals = (try? ctx.fetch(FetchDescriptor<Goal>())) ?? []
        return Prompts.insightsPack(habits: habits, checkIns: checkIns, goals: goals, now: now, tz: tz,
                                    wearable: Prompts.wearableBlock?(now, tz) ?? "")
    }

    @MainActor static func handOff(_ ctx: ModelContext, tz: String) -> HandOff {
        HandOff(title: "Hand off your insights", prompt: HandOff.compose(
            system: Prompts.insightsSystem,
            body: Prompts.insightsPrompt(pack(ctx, now: Date(), tz: tz)) + "\n\nReply with the insights only, one per line."
        ), pasteLabel: "Paste the insights (one per line)")
    }
}

// MARK: - Habit Coach

struct CoachView: View {
    @Environment(\.modelContext) private var ctx
    @Environment(Toasts.self) private var toasts
    @Query(sort: \CoachConversation.lastMessageAt, order: .reverse) private var conversations: [CoachConversation]

    @State private var open: CoachConversation?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Label("HABIT COACH", systemImage: "graduationcap").font(.eyebrow).tracking(1.4).foregroundStyle(Theme.faint)
                Text("Ask the coach").font(.system(size: 26, weight: .semibold)).tracking(-0.5).foregroundStyle(Theme.ink)
                Text("Answers grounded in Atomic Habits and your own habits, goals and recent weeks.").font(.system(size: 14)).foregroundStyle(Theme.ink2)
            }
            Button {
                let c = CoachConversation()
                ctx.insert(c)
                try? ctx.save()
                open = c
            } label: { Label("New chat", systemImage: "plus") }
            .buttonStyle(PrimaryButtonStyle())

            if conversations.isEmpty {
                Text("No chats yet. Start one — ask anything about building or breaking a habit.").font(.system(size: 13)).foregroundStyle(Theme.faint)
            }
            ForEach(conversations) { c in
                Button { open = c } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.title).font(.system(size: 15, weight: .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                            Text(c.lastMessageAt.formatted(.relative(presentation: .named))).font(.system(size: 12)).foregroundStyle(Theme.faint)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(Theme.faint)
                    }
                    .padding(14).card()
                }
                .buttonStyle(.plain)
                .contextMenu {
                    Button("Delete chat", systemImage: "trash", role: .destructive) {
                        ctx.delete(c)
                        try? ctx.save()
                    }
                }
            }
        }
        .sheet(item: $open) { CoachChatView(conversation: $0).macSheet(width: 680, height: 760) }
    }
}

struct CoachChatView: View {
    let conversation: CoachConversation

    @Environment(\.modelContext) private var ctx
    @Environment(\.dismiss) private var dismiss
    @Query private var profiles: [Profile]
    @Query private var habits: [Habit]
    @Query private var goals: [Goal]
    @Query private var checkIns: [CheckIn]

    @State private var input = ""
    @State private var streaming = ""
    @State private var asking = ""
    @State private var busy = false
    @State private var error: String?
    @State private var renaming = false
    @State private var newTitle = ""
    @State private var confirmDelete = false
    @State private var handOff: HandOff?

    private static let starters = [
        "How do I make a new habit stick?",
        "I keep breaking my streak — what should I do?",
        "How do I make a bad habit harder to do?",
        "What does the book say about motivation vs. systems?",
    ]

    private var messages: [ChatMessage] { conversation.sortedMessages.map { ChatMessage(role: $0.role, text: $0.text) } }
    private var tz: String { profiles.first?.timezone ?? TimeZone.current.identifier }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        if messages.isEmpty {
                            Text("Ask about building or breaking a habit — the coach knows your habits, goals and recent weeks.")
                                .font(.system(size: 14)).foregroundStyle(Theme.ink2)
                            ForEach(Self.starters, id: \.self) { s in
                                Button { ask(s) } label: {
                                    Text(s).font(.system(size: 14)).foregroundStyle(Theme.ink).frame(maxWidth: .infinity, alignment: .leading)
                                        .padding(12).background(Theme.panel, in: RoundedRectangle(cornerRadius: 12))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        ForEach(Array(conversation.sortedMessages.enumerated()), id: \.offset) { _, m in
                            MessageBubble(message: ChatMessage(role: m.role, text: m.text))
                        }
                        if busy {
                            MessageBubble(message: ChatMessage(role: "user", text: asking))
                            MessageBubble(message: ChatMessage(role: "model", text: streaming.isEmpty ? "…" : streaming), streaming: true)
                        }
                        if let error { Text(error).font(.system(size: 13)).foregroundStyle(Theme.red) }
                        Color.clear.frame(height: 1).id("end")
                    }
                    .padding(16)
                }
                .onChange(of: streaming) { proxy.scrollTo("end", anchor: .bottom) }
                .onChange(of: conversation.messages?.count) { proxy.scrollTo("end", anchor: .bottom) }
            }
            .background(Theme.bg)
            .safeAreaInset(edge: .bottom) { composer }
            .navigationTitle(conversation.title)
            .inlineTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button("Hand off to another AI", systemImage: "arrow.up.forward.app") { openHandOff() }
                        Button("Rename", systemImage: "pencil") { newTitle = conversation.title; renaming = true }
                        Button("Delete chat", systemImage: "trash", role: .destructive) { confirmDelete = true }
                    } label: { Image(systemName: "ellipsis.circle") }
                }
            }
            .alert("Rename chat", isPresented: $renaming) {
                TextField("Title", text: $newTitle)
                Button("Save") {
                    if let t = newTitle.trimmed.nonEmpty { conversation.title = String(t.prefix(120)); try? ctx.save() }
                }
                Button("Cancel", role: .cancel) {}
            }
            .confirmationDialog("Delete this chat?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) { ctx.delete(conversation); try? ctx.save(); dismiss() }
            } message: { Text("This can’t be undone.") }
            .sheet(item: $handOff) { h in
                HandOffSheet(handOff: h) { reply in save(question: pendingQuestion ?? "", answer: reply) }
            }
        }
    }

    @State private var pendingQuestion: String?

    private var composer: some View {
        VStack(spacing: 6) {
            HStack(alignment: .bottom, spacing: 8) {
                TextField("Ask the coach anything about your habits…", text: $input, axis: .vertical)
                    .lineLimit(1...5)
                    .padding(.horizontal, 12).padding(.vertical, 10)
                    .background(Theme.card, in: RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.line))
                Button { ask(input) } label: {
                    Image(systemName: "arrow.up").font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.buttonText)
                        .frame(width: 40, height: 40).background(Theme.button, in: Circle())
                }
                .disabled(input.trimmed.isEmpty || busy)
                .opacity(input.trimmed.isEmpty || busy ? 0.4 : 1)
            }
            HStack {
                AIStatusBadge()
                Spacer()
                Button { openHandOff() } label: { Label("Hand off", systemImage: "arrow.up.forward.app").font(.system(size: 12, weight: .medium)) }
                    .foregroundStyle(Theme.ink2)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(.bar)
    }

    private func systemPrompt(for query: String, budget: Int) async -> String {
        let context = Prompts.userContext(habits: habits, goals: goals, checkIns: checkIns, personalContext: profiles.first?.personalContext, now: Date(), tz: tz)
        // Half the room for the book, the rest for who they are.
        let passages = await BookIndex.passages(for: query, k: budget > 20_000 ? 6 : 3, budget: budget / 2, container: ctx.container)
        return Prompts.coachSystem(userContext: AIEngine.clip(context, to: budget / 3), passages: passages)
    }

    private func openHandOff() {
        let q = input.trimmed.nonEmpty ?? messages.last(where: { $0.role == "user" })?.text ?? "What should I focus on next?"
        pendingQuestion = input.trimmed.nonEmpty
        var ms = messages
        if let p = pendingQuestion { ms.append(ChatMessage(role: "user", text: p)) }
        let label = pendingQuestion == nil ? nil : "Paste their answer to save it in this chat"
        Task {
            let system = await systemPrompt(for: q, budget: 60_000)
            handOff = HandOff(title: "Hand off to another AI",
                              prompt: HandOff.compose(system: system, body: AIEngine.chatPrompt(ms, modelName: "Habit Coach", budget: 40_000)),
                              pasteLabel: label)
        }
    }

    private func ask(_ raw: String) {
        let q = raw.trimmed
        guard !q.isEmpty, !busy else { return }
        input = ""
        error = nil
        asking = q
        busy = true
        streaming = ""
        let budget = AIEngine.promptBudget
        let prompt = AIEngine.chatPrompt(messages + [ChatMessage(role: "user", text: q)], modelName: "Habit Coach", budget: budget / 2)
        Task {
            let system = await systemPrompt(for: q, budget: budget)
            var full = ""
            do {
                for try await partial in AIEngine.stream(system: system, prompt: prompt) {
                    full = partial
                    streaming = partial
                }
                // Persist the exchange only on a reply, so a failed turn
                // leaves no orphaned question.
                if !full.isEmpty { save(question: q, answer: full) }
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription
                input = q
            }
            busy = false
            streaming = ""
        }
    }

    private func save(question: String, answer: String) {
        guard !question.isEmpty, !answer.isEmpty else { return }
        let now = Date()
        let u = CoachMessage(role: "user", text: question)
        u.createdAt = now
        let m = CoachMessage(role: "model", text: answer)
        m.createdAt = now.addingTimeInterval(0.001)
        ctx.insert(u); ctx.insert(m)
        u.conversation = conversation
        m.conversation = conversation
        conversation.lastMessageAt = now
        if conversation.title == "New chat" { conversation.title = Prompts.deriveTitle(question) }
        try? ctx.save()
        pendingQuestion = nil
    }
}

// MARK: - Blueprint interview

struct BlueprintInterviewView: View {
    let kind: String
    let goal: Goal?
    let seed: String?
    let onApply: (HabitDraft) -> Void

    @Query private var profiles: [Profile]
    @State private var open = false
    @State private var messages: [ChatMessage] = []
    @State private var streaming = false
    @State private var drafting = false
    @State private var error: String?
    @State private var handOff: HandOff?

    private var breaking: Bool { kind == "break" }
    private var opener: String {
        breaking
            ? "Let's design your way out of this properly — a plan you'll actually keep. First, the honest question: what's the real problem this habit is solving for you? What do you get from it in the moment?"
            : "Let's co-design this habit so it's genuinely yours. First, the real question underneath it: what problem is this habit actually solving for you — what do you want it to change?"
    }
    private var userTurns: Int { messages.filter { $0.role == "user" }.count }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Co-design it with AI", systemImage: "bubble.left.and.text.bubble.right").font(.system(size: 15, weight: .semibold))
                Spacer()
                if open { Button("Minimize") { open = false }.font(.system(size: 13)) }
            }
            Text(breaking ? "A few quick questions and I'll draft the whole plan — in your own words — for you to review below."
                 : "Answer a few questions and I'll draft the whole blueprint — in your own words — for you to review and tweak below.")
                .font(.system(size: 13)).foregroundStyle(Theme.ink2)
            if open {
                GuidedChatView(messages: $messages, modelName: "Interviewer", system: system, placeholder: "Type your answer…", onStreamingChange: { streaming = $0 })
                if let error { Text(error).font(.system(size: 13)).foregroundStyle(Theme.red) }
                HStack {
                    Button { draft() } label: {
                        Label(drafting ? "Drafting…" : "Draft it", systemImage: "sparkles")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(userTurns < 2 || streaming || drafting)
                    .opacity(userTurns < 2 || streaming || drafting ? 0.4 : 1)
                    Button { handOff = draftHandOff() } label: { Image(systemName: "arrow.up.forward.app") }
                        .buttonStyle(SecondaryButtonStyle()).frame(width: 60)
                        .accessibilityLabel("Hand off the draft")
                }
                if userTurns < 2 { Text("Answer a couple of questions first.").font(.system(size: 12)).foregroundStyle(Theme.faint) }
            } else {
                Button("Start co-design") { open = true }.buttonStyle(SecondaryButtonStyle())
            }
        }
        .padding(18)
        .card()
        .onAppear {
            guard messages.isEmpty else { return }
            messages = [ChatMessage(role: "model", text: opener)]
            // From the Compass: its rough sentence opens the interview.
            if let s = seed?.trimmed.nonEmpty {
                messages.append(ChatMessage(role: "user", text: s))
                open = true
            }
        }
        .sheet(item: $handOff) { h in
            HandOffSheet(handOff: h) { pasted in
                guard let obj = PastedJSON.object(pasted) as? [String: Any],
                      let data = try? JSONSerialization.data(withJSONObject: obj),
                      let b = try? JSONDecoder().decode(PastedBlueprint.self, from: data) else {
                    error = "That didn’t look like the blueprint JSON — try copying the whole reply."
                    return
                }
                onApply(b.draft(kind: kind, goal: goal))
            }
        }
    }

    private func system() -> String {
        Prompts.blueprintInterviewSystem(kind: kind, personalContext: profiles.first?.personalContext, assessment: profiles.first?.assessment, goalTitle: goal?.title)
    }

    private func draft() {
        drafting = true
        error = nil
        let budget = AIEngine.promptBudget
        let prompt = AIEngine.clip(Prompts.blueprintDraftPrompt(messages, personalContext: profiles.first?.personalContext, assessment: profiles.first?.assessment), to: budget)
        Task {
            do {
                let out = try await AIEngine.generate(BlueprintOut.self, system: Prompts.blueprintDraftSystem(kind: kind), prompt: prompt)
                var d = out.draft(kind: kind)
                d.goal = goal
                onApply(d)
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription
            }
            drafting = false
        }
    }

    private func draftHandOff() -> HandOff {
        let body = Prompts.blueprintDraftPrompt(messages, personalContext: profiles.first?.personalContext, assessment: profiles.first?.assessment)
            + "\n\nReply with ONLY a JSON object with these keys: identityStatement, why, cueType (habit_stack|time|location), anchorRoutine, cueTime, cueLocation, failSafeAction, celebration, temptationBundle, nightstandRule"
            + (breaking ? ", breakMode (abstain|taper), avoidTrigger, replacementAction, frictionDevice" : "")
            + ", phases (array of {targetText, definitionOfDone, targetCount, dailyLimit})."
        return HandOff(title: "Hand off the blueprint", prompt: HandOff.compose(system: Prompts.blueprintDraftSystem(kind: kind), body: body), pasteLabel: "Paste the JSON they send back")
    }
}

/// A blueprint pasted back from another AI — every field optional.
struct PastedBlueprint: Decodable {
    var identityStatement, why, cueType, anchorRoutine, cueTime, cueLocation, failSafeAction: String?
    var celebration, temptationBundle, nightstandRule, breakMode, avoidTrigger, replacementAction, frictionDevice: String?
    var phases: [Step]?

    struct Step: Decodable {
        var targetText: String?
        var definitionOfDone: String?
        var targetCount: Int?
        var dailyLimit: Int?
    }

    func draft(kind: String, goal: Goal?) -> HabitDraft {
        let out = BlueprintOut(
            identityStatement: identityStatement ?? "", why: why ?? "", cueType: cueType ?? "habit_stack", anchorRoutine: anchorRoutine ?? "",
            cueTime: cueTime ?? "", cueLocation: cueLocation ?? "", failSafeAction: failSafeAction ?? "", celebration: celebration ?? "",
            temptationBundle: temptationBundle ?? "", nightstandRule: nightstandRule ?? "", breakMode: breakMode ?? "",
            avoidTrigger: avoidTrigger ?? "", replacementAction: replacementAction ?? "", frictionDevice: frictionDevice ?? "",
            phases: (phases ?? []).map { BlueprintPhase(targetText: $0.targetText ?? "", definitionOfDone: $0.definitionOfDone ?? "", targetCount: $0.targetCount ?? 14, dailyLimit: $0.dailyLimit ?? 0) }
        )
        var d = out.draft(kind: kind)
        d.goal = goal
        return d
    }
}

// MARK: - Compass helper

struct CompassAIHelper: View {
    let stage: String
    @Binding var draft: CompassDraft

    @Environment(Toasts.self) private var toasts
    @Query private var profiles: [Profile]
    @State private var open = false
    @State private var messages: [ChatMessage] = []
    @State private var pulling = false
    @State private var handOff: HandOff?

    private var canPull: Bool { stage != "first-step" }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !open {
                Button { open = true } label: { Label("Talk it through with AI", systemImage: "sparkles").font(.system(size: 14, weight: .medium)) }
                    .foregroundStyle(Theme.accent)
            } else {
                HStack {
                    Label("Talk it through", systemImage: "message").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.ink2)
                    Spacer()
                    Button { open = false } label: { Image(systemName: "xmark") }.foregroundStyle(Theme.faint)
                }
                GuidedChatView(messages: $messages, modelName: "Compass", system: {
                    Prompts.compassSystem(stage: stage, personalContext: profiles.first?.personalContext, assessment: profiles.first?.assessment)
                })
                if canPull {
                    HStack {
                        Button { pull() } label: { Label(pulling ? "Reading…" : "Pull answers into the form", systemImage: "arrow.down.doc") }
                            .buttonStyle(SecondaryButtonStyle())
                            .disabled(!messages.contains { $0.role == "user" } || pulling)
                        Button { handOff = extractHandOff() } label: { Image(systemName: "arrow.up.forward.app") }
                            .buttonStyle(SecondaryButtonStyle()).frame(width: 60)
                    }
                    Text("Fills the fields above from this chat. You can edit everything after.").font(.system(size: 12)).foregroundStyle(Theme.faint)
                }
            }
        }
        .padding(16)
        .card()
        .onAppear { if messages.isEmpty { messages = [ChatMessage(role: "model", text: Prompts.compassOpeners[stage] ?? "")] } }
        .sheet(item: $handOff) { h in
            HandOffSheet(handOff: h) { pasted in
                guard let obj = PastedJSON.object(pasted) as? [String: Any] else { toasts.error("That didn’t look like JSON."); return }
                merge(PastedExtract(obj))
            }
        }
    }

    private func pull() {
        pulling = true
        let transcript = Prompts.transcript(messages, model: "COMPASS")
        Task {
            do {
                let ex = try await AIEngine.generate(CompassExtract.self, system: Prompts.compassExtractSystem,
                                                     prompt: AIEngine.clip("Transcript:\n\n\(transcript)", to: AIEngine.promptBudget))
                merge(PastedExtract(ex))
            } catch {
                toasts.error((error as? LocalizedError)?.errorDescription ?? "Could not read the chat.")
            }
            pulling = false
        }
    }

    private func extractHandOff() -> HandOff {
        HandOff(title: "Hand off the extraction", prompt: HandOff.compose(
            system: Prompts.compassExtractSystem,
            body: "Transcript:\n\n\(Prompts.transcript(messages, model: "COMPASS"))\n\nReply with ONLY a JSON object: {\"assessment\": {\"contentment\": [{\"domain\", \"score\"}], \"priorities\": [], \"highQualityHours\": \"\", \"pastStickyHabits\": [{\"habit\", \"whyItStuck\"}], \"obstacles\": []}, \"goals\": [{\"title\", \"domain\", \"whyText\", \"timeframe\"}]}"
        ), pasteLabel: "Paste the JSON they send back")
    }

    /// Merge into the worksheet without clobbering anything already filled in.
    private func merge(_ ex: PastedExtract) {
        if stage == "reality" {
            var a = draft.assessment
            if a.contentmentPersonal == nil, let s = ex.contentment.first(where: { $0.0.range(of: "person", options: .caseInsensitive) != nil }) { a.contentmentPersonal = s.1 }
            if a.contentmentProfessional == nil, let s = ex.contentment.first(where: { $0.0.range(of: "prof|work|career", options: [.regularExpression, .caseInsensitive]) != nil }) { a.contentmentProfessional = s.1 }
            if (a.priorities ?? []).filter({ !$0.isEmpty }).isEmpty, !ex.priorities.isEmpty { a.priorities = ex.priorities }
            if (a.highQualityHours ?? "").isEmpty, !ex.highQualityHours.isEmpty { a.highQualityHours = ex.highQualityHours }
            if (a.obstacles ?? []).filter({ !$0.isEmpty }).isEmpty, !ex.obstacles.isEmpty { a.obstacles = ex.obstacles }
            if (a.pastStickyHabits ?? []).filter({ !$0.habit.isEmpty }).isEmpty, !ex.sticky.isEmpty { a.pastStickyHabits = ex.sticky }
            draft.assessment = a
            toasts.show("Pulled into your worksheet — edit anything that isn’t quite you.")
        } else {
            let existing = Set(draft.goals.map { $0.title.trimmed.lowercased() })
            let fresh = ex.goals.filter { !$0.title.trimmed.isEmpty && !existing.contains($0.title.trimmed.lowercased()) }
            guard !fresh.isEmpty else { toasts.show("No new goals to add yet — talk it through a bit more.", icon: "safari"); return }
            draft.goals += fresh
            toasts.show("Added \(fresh.count) goal\(fresh.count == 1 ? "" : "s") — refine them below.")
        }
    }
}

/// The Compass extraction, from the model or pasted JSON alike.
struct PastedExtract {
    var contentment: [(String, Int)] = []
    var priorities: [String] = []
    var highQualityHours = ""
    var sticky: [CompassDraft.StickyHabit] = []
    var obstacles: [String] = []
    var goals: [CompassDraft.GoalForm] = []

    init(_ ex: CompassExtract) {
        contentment = ex.assessment.contentment.map { ($0.domain, $0.score) }
        priorities = ex.assessment.priorities
        highQualityHours = ex.assessment.highQualityHours
        sticky = ex.assessment.pastStickyHabits.map { .init(habit: $0.habit, whyItStuck: $0.whyItStuck) }
        obstacles = ex.assessment.obstacles
        goals = ex.goals.map { .init(title: $0.title, domain: $0.domain, whyText: $0.whyText, timeframe: $0.timeframe) }
    }

    init(_ obj: [String: Any]) {
        let a = obj["assessment"] as? [String: Any] ?? [:]
        contentment = (a["contentment"] as? [[String: Any]] ?? []).compactMap { c in
            guard let d = c["domain"] as? String, let s = (c["score"] as? NSNumber)?.intValue else { return nil }
            return (d, s)
        }
        priorities = a["priorities"] as? [String] ?? []
        highQualityHours = a["highQualityHours"] as? String ?? ""
        sticky = (a["pastStickyHabits"] as? [[String: String]] ?? []).map { .init(habit: $0["habit"] ?? "", whyItStuck: $0["whyItStuck"] ?? "") }
        obstacles = a["obstacles"] as? [String] ?? []
        goals = (obj["goals"] as? [[String: Any]] ?? []).map {
            let domain = $0["domain"] as? String ?? "health"
            return .init(title: $0["title"] as? String ?? "", domain: Compass.domains.contains { $0.0 == domain } ? domain : "health",
                         whyText: $0["whyText"] as? String, timeframe: $0["timeframe"] as? String)
        }
    }
}
