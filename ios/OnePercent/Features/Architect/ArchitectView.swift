import SwiftUI
import SwiftData
import PhotosUI

// The Architect — a port of client/src/pages/Architect.tsx. Turn an emotional
// spark into a rigid behavioural rule: the habit and the identity it serves,
// then the four laws (cue, craving, response, reward) and setback plans.

struct ArchitectSeed: Identifiable {
    var habit: Habit?
    var goal: Goal?
    /// A rough sentence handed over by the Compass, for the blueprint interview.
    var interviewSeed: String?
    let id = UUID()
}

struct ArchitectView: View {
    let seed: ArchitectSeed

    @Environment(\.modelContext) private var ctx
    @Environment(\.dismiss) private var dismiss
    @Environment(Toasts.self) private var toasts
    @Query(sort: \Goal.createdAt) private var goals: [Goal]
    @Query(filter: #Predicate<Habit> { $0.archivedAt == nil }) private var live: [Habit]

    @State private var d = HabitDraft()
    @State private var removedPhaseUids: [String] = []
    @State private var photo: PhotosPickerItem?
    @State private var confirmDelete = false
    @State private var loaded = false

    private var editing: Habit? { seed.habit }
    private var breaking: Bool { d.breaking }
    private var taper: Bool { d.taper }
    private var needsTarget: Bool { editing == nil || editing.flatMap(HabitDesign.editingPhase) != nil }
    private var activeGoals: [Goal] { goals.filter { $0.status == "active" } }
    private var atCap: Bool { editing == nil && live.count >= HabitDesign.maxHabits }
    private var valid: Bool { HabitDesign.isValid(d, editing: editing, liveCount: live.count) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    intro
                    if editing == nil { kindPicker }
                    if editing == nil, let interview = BlueprintSlot.make(kind: d.kind, goal: d.goal, seed: seed.interviewSeed, apply: applyBlueprint) {
                        interview
                    }
                    habitSection
                    systemDivider
                    cueStage
                    cravingStage
                    responseStage
                    rewardStage
                    setbacksSection
                    hints
                    if atCap {
                        Text("You’re already running 6 habits — that’s the ceiling, and one at a time sticks best. Pause or archive one before engineering another.")
                            .font(.system(size: 14)).foregroundStyle(Theme.ink)
                            .padding(14).background(Theme.amber.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                    }
                    if editing != nil { editActions }
                }
                .padding(16)
                .padding(.bottom, 80)
            }
            .background(Theme.bg)
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(editing == nil ? (breaking ? "Engineer your escape" : "Engineer a habit") : "Edit habit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(editing == nil ? (breaking ? "Engineer" : "Engineer") : "Save") { save() }
                        .fontWeight(.semibold)
                        .disabled(!valid)
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button(editing == nil ? (breaking ? "Engineer my escape" : "Engineer habit") : "Save changes") { save() }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(!valid).opacity(valid ? 1 : 0.4)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(.bar)
            }
        }
        .onAppear(perform: load)
        .onChange(of: photo) {
            Task {
                if let data = try? await photo?.loadTransferable(type: Data.self) { d.whyImageData = Self.downscale(data) }
            }
        }
        .confirmationDialog("Delete this habit?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete habit", role: .destructive) { archive() }
        } message: {
            Text("It leaves your Launchpad and Momentum. Every vote you already cast stays on your compound curve.")
        }
    }

    // MARK: Sections

    private var intro: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label("THE ARCHITECT", systemImage: "hammer").font(.eyebrow).tracking(1.4).foregroundStyle(Theme.faint)
            Text(editing != nil ? "Refine the blueprint. Changes apply to your current phase."
                 : breaking ? "Design the bad habit out — make it invisible, unattractive, difficult, and unsatisfying."
                 : "Turn an emotional spark into a rigid behavioural rule. Ambiguity is the enemy.")
                .font(.system(size: 14)).foregroundStyle(Theme.ink2)
        }
    }

    private var kindPicker: some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                kindButton("build", "Build a habit", "Grow a good one", "leaf")
                kindButton("break", "Break a habit", "Quit a bad one", "nosign")
            }
            if breaking {
                HStack {
                    Text("How will you beat it?").font(.system(size: 13, weight: .medium)).foregroundStyle(Theme.ink2)
                    Picker("", selection: $d.breakMode) {
                        Text("Quit entirely").tag("abstain")
                        Text("Taper down").tag("taper")
                    }
                    .pickerStyle(.segmented)
                }
            }
        }
        .padding(8)
        .card()
    }

    private func kindButton(_ value: String, _ label: String, _ sub: String, _ icon: String) -> some View {
        let on = d.kind == value
        return Button { withAnimation { d.kind = value } } label: {
            HStack(spacing: 10) {
                Image(systemName: icon)
                VStack(alignment: .leading, spacing: 1) {
                    Text(label).font(.system(size: 14, weight: .semibold))
                    Text(sub).font(.system(size: 12)).opacity(0.8)
                }
                Spacer(minLength: 0)
            }
            .foregroundStyle(on ? Theme.buttonText : Theme.ink2)
            .padding(12)
            .background(on ? Theme.button : Theme.panel, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }

    private var habitSection: some View {
        SectionCard(title: breaking ? "The habit you’re breaking" : "The habit", icon: "pin") {
            Field(breaking ? "Habit you’re breaking (as an identity)" : "Habit (as an identity)") {
                TextField(breaking ? "I am someone who is free of late-night scrolling" : "I am someone who moves every day", text: $d.title, axis: .vertical)
            }
            if !activeGoals.isEmpty {
                Field(breaking ? "Identity / goal that breaking this supports" : "Identity / goal this habit supports") {
                    Picker("Goal", selection: Binding(get: { d.goal?.uid ?? "" }, set: { uid in d.goal = goals.first { $0.uid == uid } })) {
                        Text("No goal (just a good habit)").tag("")
                        ForEach(activeGoals) { Text($0.title).tag($0.uid) }
                    }
                    .pickerStyle(.menu)
                    .tint(Theme.ink)
                }
                if d.goal == nil {
                    Text("Habits stick better when they serve something bigger — consider linking this to a goal.").font(.system(size: 12)).foregroundStyle(Theme.faint)
                }
            } else {
                Text("No goals yet. The Compass helps you name where you’re heading, so every habit serves something bigger.")
                    .font(.system(size: 12)).foregroundStyle(Theme.faint)
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.line, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
            }
            Field("Your why") {
                TextField(breaking ? "Why break this? What life are you voting for by quitting?" : "Why does this matter? What life are you voting for?", text: $d.whyText, axis: .vertical)
                    .lineLimit(3...)
            }
            HStack {
                PhotosPicker(selection: $photo, matching: .images) {
                    Label(d.whyImageData == nil ? "Add a why image (optional)" : "Change the image", systemImage: "photo")
                        .font(.system(size: 13, weight: .medium))
                }
                Spacer()
                if d.whyImageData != nil {
                    Button("Remove", role: .destructive) { d.whyImageData = nil }.font(.system(size: 13))
                }
            }
            if let data = d.whyImageData, let img = UIImage(data: data) {
                Image(uiImage: img).resizable().scaledToFill().frame(height: 128).frame(maxWidth: .infinity).clipShape(RoundedRectangle(cornerRadius: 12))
            }
            Divider()
            Toggle(isOn: $d.systemFocusConfirmed) {
                VStack(alignment: .leading, spacing: 2) {
                    (Text("I’m focusing on a ") + Text("system, not a goal").fontWeight(.medium) + Text(".")).font(.system(size: 14))
                    Text(breaking ? "Quitting is the goal; the daily system — invisible, difficult, unsatisfying — is what actually gets you free."
                         : "The goal sets the direction; the daily system is what actually gets you there.")
                        .font(.system(size: 12)).foregroundStyle(Theme.faint)
                }
            }
            .toggleStyle(CheckboxStyle())
        }
    }

    private var systemDivider: some View {
        HStack(spacing: 10) {
            Eyebrow("The system", color: Theme.ink2)
            Theme.line.frame(height: 1)
            Text("Cue → Craving → Response → Reward").font(.system(size: 11)).foregroundStyle(Theme.faint)
        }
    }

    private var cueStage: some View {
        LoopStage(step: 1, title: "Cue", law: breaking ? "Make it invisible" : "Make it obvious",
                  blurb: breaking ? "Remove the trigger and redesign the moments where the urge usually strikes."
                  : "Pin the exact trigger — a time, a place, or an existing routine — so the habit has a starting gun.") {
            SectionCard(title: breaking ? "Remove the trigger, plan the swap" : "Implementation intention") {
                if breaking {
                    Field("The trigger to remove — make it invisible") { TextField("My phone within reach in bed", text: $d.avoidTrigger, axis: .vertical) }
                }
                Text(breaking ? "When does the urge usually strike?" : "What triggers it?").font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.ink2)
                Picker("Cue", selection: $d.cueType) {
                    Label("After a habit", systemImage: "repeat").tag("habit_stack")
                    Label("At a time", systemImage: "clock").tag("time")
                    Label("At a place", systemImage: "mappin").tag("location")
                }
                .pickerStyle(.segmented)
                VStack(alignment: .leading, spacing: 8) {
                    switch d.cueType {
                    case "time":
                        HStack {
                            Text("At").font(.serif(18))
                            TimeField(text: $d.cueTime)
                        }
                    case "location":
                        InlineField(prefix: "When I get to", placeholder: "a specific place", text: $d.cueLocation)
                    default:
                        InlineField(prefix: "After I", placeholder: "existing reliable routine", text: $d.anchorRoutine)
                    }
                    InlineField(prefix: breaking ? "I will instead" : "I will immediately",
                                placeholder: breaking ? "a better thing to do" : "2-minute gateway",
                                text: breaking ? $d.replacementAction : $d.failSafeAction)
                }
                Text(breaking ? "When the urge hits, run the replacement instead of reaching for the habit."
                     : "The gateway must take under two minutes. This is your permanent fail-safe — it never scales.")
                    .font(.system(size: 12)).foregroundStyle(Theme.faint)
                if !breaking && !d.failSafeAction.trimmed.isEmpty && !Concreteness.failSafeIsTiny(d.failSafeAction) {
                    Text("That gateway looks too big. Shrink it to one tiny action you could do in under two minutes (e.g. “put on my running shoes”, not a whole workout).")
                        .font(.system(size: 12)).foregroundStyle(Theme.amber)
                }
            }
            scheduleCard
            NotesBox(key: "cue", breaking: breaking, notes: $d.sectionNotes)
        }
    }

    private var scheduleCard: some View {
        SectionCard(title: "Schedule & environment") {
            Picker("How often", selection: $d.scheduleType) {
                Text("Specific days").tag("days")
                Text("Times per week").tag("weekly")
            }
            .pickerStyle(.segmented)
            if d.scheduleType == "days" {
                HStack(spacing: 6) {
                    ForEach(0..<7, id: \.self) { i in
                        let on = d.days.contains(i)
                        Button { if on { d.days.removeAll { $0 == i } } else { d.days = (d.days + [i]).sorted() } } label: {
                            Text(["S", "M", "T", "W", "T", "F", "S"][i]).font(.system(size: 14, weight: .medium))
                                .frame(width: 38, height: 38)
                                .foregroundStyle(on ? Theme.buttonText : Theme.faint)
                                .background(on ? Theme.button : Theme.panel, in: Circle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .sensoryFeedback(.selection, trigger: d.days)
            } else {
                HStack(spacing: 6) {
                    ForEach(1...6, id: \.self) { n in
                        Button { d.timesPerWeek = n } label: {
                            Text("\(n)").font(.system(size: 14, weight: .medium)).frame(width: 38, height: 38)
                                .foregroundStyle(d.timesPerWeek == n ? Theme.buttonText : Theme.faint)
                                .background(d.timesPerWeek == n ? Theme.button : Theme.panel, in: Circle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                Text("\(d.timesPerWeek)× a week, any days. Nothing counts as a miss while you can still get there — the pressure only shows up once the week runs short.")
                    .font(.system(size: 12)).foregroundStyle(Theme.faint)
            }
            if !taper {
                Divider()
                Text("How you’ll check in each day").font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.ink2)
                Picker("Check style", selection: $d.checkStyle) {
                    Text("Hold to log").tag("hold")
                    Text("Yes-or-no question").tag("yesno")
                }
                .pickerStyle(.segmented)
                if d.checkStyle == "yesno" {
                    Field("The question your card will ask") { TextField("Did I sleep 8 hours last night?", text: $d.checkQuestion) }
                    Text("Answering no asks what got in the way — that’s the useful data. Leave blank to use your phase target.")
                        .font(.system(size: 12)).foregroundStyle(Theme.faint)
                }
            }
            Divider()
            Toggle(isOn: $d.reminderEnabled) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Reminder").font(.system(size: 14, weight: .medium))
                    Text("A nudge at the moment you decided to act.").font(.system(size: 12)).foregroundStyle(Theme.faint)
                }
            }
            .tint(Theme.accent)
            if d.reminderEnabled {
                HStack {
                    Image(systemName: "clock").foregroundStyle(Theme.faint)
                    TimeField(text: Binding(get: { d.reminderTime.isEmpty && d.cueType == "time" ? d.cueTime : d.reminderTime }, set: { d.reminderTime = $0 }))
                    Text(d.cueType == "time" && d.reminderTime.trimmed.isEmpty ? "Defaults to your cue time" : "On scheduled days")
                        .font(.system(size: 12)).foregroundStyle(Theme.faint)
                }
            }
            Field(breaking ? "Environment redesign — what I’ll remove tonight (optional)" : "Nightstand check (optional) — tomorrow’s environment prep") {
                TextField(breaking ? "Phone charges in the kitchen, not the bedroom" : "Weighted pack sitting on the treadmill belt", text: $d.nightstandRule, axis: .vertical)
            }
        }
    }

    private var cravingStage: some View {
        LoopStage(step: 2, title: "Craving", law: breaking ? "Make it unattractive" : "Make it attractive",
                  blurb: breaking ? "Name the real cost so the habit loses its shine." : "Bundle the habit with something you genuinely want, so you crave the doing.") {
            SectionCard {
                Field(breaking ? "Make it unattractive — the real cost of this habit" : "Make it attractive — only do this while… (optional)") {
                    TextField(breaking ? "steals the calm sleep I actually want" : "listening to my favourite podcast, with my good coffee", text: $d.temptationBundle, axis: .vertical)
                }
            }
            NotesBox(key: "craving", breaking: breaking, notes: $d.sectionNotes)
        }
    }

    private var responseStage: some View {
        LoopStage(step: 3, title: "Response", law: breaking ? "Make it difficult" : "Make it easy",
                  blurb: breaking ? "Add friction between you and the habit, define what a clean day looks like, and plan the comeback."
                  : "Start with a two-minute version, climb the phase ladder, and plan for setbacks before they happen.") {
            if breaking {
                SectionCard(title: "When the urge wins ground") {
                    Field("If the urge is strong — my 2-minute resist") { TextField("Put the phone face-down and take 3 breaths", text: $d.failSafeAction, axis: .vertical) }
                    if !d.failSafeAction.trimmed.isEmpty && !Concreteness.failSafeIsTiny(d.failSafeAction) {
                        Text("That resist looks too big. Shrink it to one tiny action you could do in under two minutes (e.g. “phone face-down, 3 breaths”, not a whole ritual).")
                            .font(.system(size: 12)).foregroundStyle(Theme.amber)
                    }
                    Field("Make it difficult — my friction or commitment device") { TextField("Phone charges in the kitchen overnight", text: $d.frictionDevice, axis: .vertical) }
                }
            }
            ladderCard
            NotesBox(key: "response", breaking: breaking, notes: $d.sectionNotes)
        }
    }

    private var ladderCard: some View {
        SectionCard(title: breaking ? "Clean-day milestones" : "Just-in-time phase mapper") {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "shield").foregroundStyle(Theme.green)
                VStack(alignment: .leading, spacing: 2) {
                    Text(breaking ? "2-minute resist" : "Permanent fail-safe").font(.system(size: 14, weight: .medium))
                    Text(d.failSafeAction.trimmed.nonEmpty ?? "Set the 2-minute \(breaking ? "resist" : "gateway") above")
                        .font(.system(size: 14)).foregroundStyle(d.failSafeAction.trimmed.isEmpty ? Theme.faint : Theme.ink2)
                }
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading).background(Theme.bg, in: RoundedRectangle(cornerRadius: 12))
            Toggle(isOn: $d.confirmedQuick) {
                Text(breaking ? "I can do this 2-minute resist whenever the urge hits." : "I can do this fail-safe in under two minutes.").font(.system(size: 14))
            }
            .toggleStyle(CheckboxStyle())

            VStack(alignment: .leading, spacing: 10) {
                Label(editing != nil ? "Current milestone" : breaking ? "Phase 1 — first milestone" : "Phase 1 — the automaticity target", systemImage: "target")
                    .font(.system(size: 14, weight: .semibold))
                if editing != nil && !needsTarget {
                    Text("This habit’s current phase has graduated. Define the next \(breaking ? "milestone" : "target") from its card on the Launchpad.")
                        .font(.system(size: 13)).foregroundStyle(Theme.faint)
                } else {
                    stepFields(target: $d.targetText, done: $d.definitionOfDone, count: $d.targetCount, limit: $d.dailyLimit, first: true)
                }
            }
            .padding(14)
            .background(Theme.bg, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.accent.opacity(0.3)))

            if needsTarget {
                ForEach($d.extraPhases) { $step in
                    let i = d.extraPhases.firstIndex { $0.id == step.id } ?? 0
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Label(editing != nil ? "Upcoming milestone \(i + 1) — locked" : "Phase \(i + 2) — locked", systemImage: "lock")
                                .font(.system(size: 14, weight: .semibold))
                            Spacer()
                            Button(role: .destructive) {
                                if let uid = step.uid { removedPhaseUids.append(uid) }
                                d.extraPhases.removeAll { $0.id == step.id }
                            } label: { Image(systemName: "trash") }
                            .foregroundStyle(Theme.faint)
                        }
                        stepFields(target: $step.targetText, done: $step.definitionOfDone, count: $step.targetCount, limit: $step.dailyLimit, first: false)
                    }
                    .padding(14)
                    .background(Theme.bg, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line))
                }
                if d.extraPhases.count < 5 {
                    Button { d.extraPhases.append(LadderStep()) } label: {
                        Label("Add the next step", systemImage: "plus").font(.system(size: 14, weight: .medium)).frame(maxWidth: .infinity, minHeight: 42)
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.line, style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
                    }
                    .foregroundStyle(Theme.ink2)
                } else {
                    Text(editing != nil ? "That’s five upcoming steps mapped — plenty of runway." : "That’s a full staircase — six phases is the max.")
                        .font(.system(size: 12)).foregroundStyle(Theme.faint).frame(maxWidth: .infinity)
                }
                Label("Each step unlocks automatically when the one before it passes its Automaticity Check. Start tiny — the climb takes care of itself.", systemImage: "lock")
                    .font(.system(size: 12)).foregroundStyle(Theme.faint)
            }
        }
    }

    @ViewBuilder
    private func stepFields(target: Binding<String>, done: Binding<String>, count: Binding<Int>, limit: Binding<Int>, first: Bool) -> some View {
        Field(breaking ? (taper ? "Daily cap (in words)" : "Milestone") : "Daily target") {
            TextField(breaking ? (taper ? "≤2 a day" : "Stay scroll-free 14 days") : (first ? "Walk 15 mins on the treadmill" : "Walk 25 mins on the treadmill"), text: target, axis: .vertical)
        }
        if taper {
            Stepper("Daily limit: \(limit.wrappedValue)", value: limit, in: 0...1000).font(.system(size: 14))
        }
        Field(breaking ? "What counts as a clean day" : (first ? "Definition of done — the exact finish line" : "Definition of done")) {
            TextField(breaking ? "No scrolling in bed after 10pm" : "Both shoes on and standing on the treadmill belt", text: done, axis: .vertical)
        }
        Stepper("\(count.wrappedValue) \(breaking ? "clean days" : "reps") before the Automaticity Check", value: count, in: 1...1000)
            .font(.system(size: 14))
    }

    private var rewardStage: some View {
        LoopStage(step: 4, title: "Reward", law: breaking ? "Make it unsatisfying" : "Make it satisfying",
                  blurb: breaking ? "Give a slip an immediate cost — accountability makes caving expensive."
                  : "End every rep with an immediate payoff, however small — what gets rewarded gets repeated.") {
            SectionCard {
                Field(breaking ? "Make it unsatisfying — who I’ll be accountable to (optional)" : "Then I’ll celebrate by… (optional)") {
                    TextField(breaking ? "text my partner that I caved" : "say “that’s like me”, fist-pump, tick the box", text: $d.celebration, axis: .vertical)
                }
                Text(breaking ? "Also: every clean day you log casts a visible vote — the streak itself becomes the reward."
                     : "Your vote on the Launchpad is the built-in reward — this celebration seals it in the moment.")
                    .font(.system(size: 12)).foregroundStyle(Theme.faint)
            }
            NotesBox(key: "reward", breaking: breaking, notes: $d.sectionNotes)
        }
    }

    private var setbacksSection: some View {
        SectionCard(title: "Prepare for setbacks") {
            Text("Never expect to fail, but always plan for it. When you miss a day, your plan shows up right on the card.")
                .font(.system(size: 12)).foregroundStyle(Theme.faint)
            ForEach(d.setbacks.indices, id: \.self) { i in
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 6) {
                        InlineField(prefix: "If", placeholder: "the day gets away from me", text: $d.setbacks[i].obstacle)
                        InlineField(prefix: "then I will", placeholder: "do the 2-minute version before bed", text: $d.setbacks[i].plan)
                    }
                    Button(role: .destructive) { d.setbacks.remove(at: i) } label: { Image(systemName: "trash") }.foregroundStyle(Theme.faint)
                }
                .padding(12).background(Theme.bg, in: RoundedRectangle(cornerRadius: 12))
            }
            if d.setbacks.count < 3 {
                Button { d.setbacks.append(SetbackPlan(obstacle: "", plan: "")) } label: {
                    Label(d.setbacks.isEmpty ? "Add an if–then plan" : "Add another plan", systemImage: "plus")
                        .font(.system(size: 14, weight: .medium)).frame(maxWidth: .infinity, minHeight: 42)
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.line, style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
                }
                .foregroundStyle(Theme.ink2)
            }
            NotesBox(key: "setbacks", breaking: breaking, notes: $d.sectionNotes, bare: true)
        }
    }

    /// Only the checks still fuzzy — it disappears once the habit is concrete.
    @ViewBuilder private var hints: some View {
        let failing = Concreteness.checks(d, needsTarget: needsTarget).filter { !$0.passed }
        if !failing.isEmpty {
            SectionCard(title: "A few ways to sharpen it", icon: "leaf") {
                ForEach(failing, id: \.key) { c in
                    HStack(alignment: .top, spacing: 8) {
                        Circle().fill(Theme.accent.opacity(0.5)).frame(width: 6, height: 6).padding(.top, 7)
                        (Text(c.label + ". ").fontWeight(.medium).foregroundStyle(Theme.ink) + Text(c.hint).foregroundStyle(Theme.ink2)).font(.system(size: 14))
                    }
                }
                Text("These are nudges, not gates — you can save whenever you’re ready.").font(.system(size: 12)).foregroundStyle(Theme.faint)
            }
        }
    }

    private var editActions: some View {
        HStack {
            Button {
                guard let h = editing else { return }
                do {
                    let pausing = h.pausedAt == nil
                    try DailyLoop.setPaused(h, pausing, ctx: ctx)
                    toasts.show(pausing ? "Paused. Resume it anytime from the Launchpad." : "Resumed — this habit’s live again.")
                    dismiss()
                } catch { toasts.error("Could not update this habit") }
            } label: {
                Label(editing?.pausedAt != nil ? "Resume habit" : "Pause habit", systemImage: editing?.pausedAt != nil ? "play.circle" : "pause.circle")
            }
            Spacer()
            Button(role: .destructive) { confirmDelete = true } label: { Label("Delete habit", systemImage: "trash") }
        }
        .font(.system(size: 14))
        .foregroundStyle(Theme.ink2)
        .padding(.horizontal, 4)
    }

    // MARK: Actions

    private func load() {
        guard !loaded else { return }
        loaded = true
        if let h = editing {
            d = HabitDraft(h)
        } else {
            d.goal = seed.goal
        }
    }

    /// The blueprint interview hands back a whole draft — drop it into the form.
    private func applyBlueprint(_ b: HabitDraft) {
        let keepGoal = d.goal
        d = b
        if d.goal == nil { d.goal = keepGoal }
        toasts.show("Draft ready — review and tweak before engineering.", icon: "sparkles")
    }

    private func save() {
        guard valid else { return }
        do {
            if let h = editing {
                try HabitDesign.update(h, with: d, removedPhaseUids: removedPhaseUids, ctx: ctx)
                toasts.show("Habit updated.")
            } else {
                try HabitDesign.create(d, ctx: ctx)
                toasts.show("Habit engineered. Time to vote.", icon: "hammer")
            }
            dismiss()
        } catch {
            toasts.error(error.localizedDescription)
        }
    }

    private func archive() {
        guard let h = editing else { return }
        do {
            try HabitDesign.archive(h, ctx: ctx)
            dismiss()
        } catch { toasts.error("Could not archive habit") }
    }

    /// Why images are stored on-device; keep them modest.
    static func downscale(_ data: Data, maxSide: CGFloat = 1200) -> Data {
        guard let img = UIImage(data: data) else { return data }
        let scale = min(1, maxSide / max(img.size.width, img.size.height))
        let size = CGSize(width: img.size.width * scale, height: img.size.height * scale)
        let out = UIGraphicsImageRenderer(size: size).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
        return out.jpegData(compressionQuality: 0.8) ?? data
    }
}

/// Where the AI blueprint interview plugs in (the AI layer registers it).
enum BlueprintSlot {
    @MainActor static var factory: ((String, Goal?, String?, @escaping (HabitDraft) -> Void) -> AnyView)?

    @MainActor static func make(kind: String, goal: Goal?, seed: String?, apply: @escaping (HabitDraft) -> Void) -> AnyView? {
        factory?(kind, goal, seed, apply)
    }
}

// MARK: - Form pieces

struct SectionCard<Content: View>: View {
    var title: String?
    var icon: String?
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let title {
                HStack(spacing: 6) {
                    if let icon { Image(systemName: icon).font(.system(size: 12)) }
                    Eyebrow(title, color: Theme.ink2)
                }
            }
            content
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }
}

struct Field<Content: View>: View {
    let label: String
    @ViewBuilder let content: Content

    init(_ label: String, @ViewBuilder content: () -> Content) {
        self.label = label
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.ink2)
            content
                .font(.system(size: 16))
                .padding(.horizontal, 12).padding(.vertical, 10)
                .background(Theme.bg, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.line))
        }
    }
}

/// "After I ___" — the implementation-intention sentence, typed inline.
struct InlineField: View {
    let prefix: String
    let placeholder: String
    @Binding var text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(prefix).font(.serif(18)).foregroundStyle(Theme.ink)
            VStack(spacing: 2) {
                TextField(placeholder, text: $text, axis: .vertical).font(.system(size: 16))
                Theme.accent.frame(height: 2)
            }
        }
    }
}

/// An "HH:MM" string edited with the native time wheel.
struct TimeField: View {
    @Binding var text: String

    var body: some View {
        HStack {
            DatePicker("", selection: Binding(
                get: {
                    let m = LocalDate.parseHHMM(text) ?? 7 * 60
                    return Calendar.current.date(bySettingHour: m / 60, minute: m % 60, second: 0, of: Date()) ?? Date()
                },
                set: {
                    let c = Calendar.current.dateComponents([.hour, .minute], from: $0)
                    text = String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
                }
            ), displayedComponents: .hourAndMinute)
            .labelsHidden()
            if text.isEmpty { Text("not set").font(.system(size: 12)).foregroundStyle(Theme.faint) }
        }
    }
}

/// One stage of the habit loop, under a numbered header naming its law.
struct LoopStage<Content: View>: View {
    let step: Int
    let title: String
    let law: String
    let blurb: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Text("\(step)").font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.accent)
                    .frame(width: 32, height: 32).background(Theme.accent.opacity(0.15), in: Circle())
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        Text(title).font(.system(size: 18, weight: .semibold)).foregroundStyle(Theme.ink)
                        Text(law.uppercased()).font(.system(size: 10, weight: .semibold)).tracking(0.6).foregroundStyle(Theme.ink2)
                            .padding(.horizontal, 7).padding(.vertical, 3).background(Theme.panel, in: Capsule())
                    }
                    Text(blurb).font(.system(size: 12)).foregroundStyle(Theme.faint)
                }
            }
            VStack(alignment: .leading, spacing: 14) { content }
                .padding(.leading, 14)
                .overlay(alignment: .leading) { Theme.line.frame(width: 2) }
        }
    }
}

/// The user's own tactics per law, with the workbook's other ideas beneath.
struct NotesBox: View {
    let key: String
    let breaking: Bool
    @Binding var notes: [String: String]
    var bare = false

    private static let suggestions: [String: (build: [String], break: [String])] = [
        "cue": (["habit stacking", "make cues obvious in your space"], ["identify & remove the cue", "redesign the space to hide triggers"]),
        "craving": (["temptation bundling", "try the fun version", "a supportive circle"], ["reframe the mindset", "find a better way to meet the craving"]),
        "response": (["two-minute rule", "reduce friction", "commitment device", "master the decisive moment"], ["add friction", "commitment device", "master the decisive moment"]),
        "reward": (["an immediate reward", "track your habits"], ["an accountability partner", "a habit contract"]),
        "setbacks": (["never miss twice", "plan the comeback before you need it"], ["never miss twice", "plan the comeback before you need it"]),
    ]

    var body: some View {
        let body = VStack(alignment: .leading, spacing: 6) {
            Field("Your own notes (optional)") {
                TextField("Anything else you’ll try here — in your own words.", text: Binding(get: { notes[key] ?? "" }, set: { notes[key] = $0 }), axis: .vertical)
                    .lineLimit(2...)
            }
            if let s = Self.suggestions[key] {
                Text("Other ways: " + (breaking ? s.break : s.build).joined(separator: " · ")).font(.system(size: 11)).foregroundStyle(Theme.faint)
            }
        }
        if bare {
            body
        } else {
            body.padding(14)
                .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.line, style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
        }
    }
}

struct CheckboxStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button { configuration.isOn.toggle() } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
                    .font(.system(size: 18)).foregroundStyle(configuration.isOn ? Theme.accent : Theme.faint)
                configuration.label.foregroundStyle(Theme.ink2)
                Spacer(minLength: 0)
            }
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: configuration.isOn)
    }
}
