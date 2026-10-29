import SwiftUI
import SwiftData

// The Compass — a port of client/src/pages/Compass.tsx. Where you are (A),
// where you're heading (Z), and the one habit that starts the path (B). It
// autosaves, and every save syncs goals and the assessment into the app.
struct CompassView: View {
    @Environment(\.modelContext) private var ctx
    @Environment(Toasts.self) private var toasts
    @Environment(AppRouter.self) private var router
    @Query private var profiles: [Profile]
    @Query(sort: \Goal.createdAt) private var goals: [Goal]
    @Query(filter: #Predicate<Habit> { $0.archivedAt == nil }, sort: \Habit.createdAt) private var habits: [Habit]
    @Query(sort: \CompassSnapshot.createdAt, order: .reverse) private var snapshots: [CompassSnapshot]

    enum Section: String, CaseIterable { case a = "A", z = "Z", b = "B", history = "Saved" }

    @State private var section: Section = .a
    @State private var draft = CompassDraft()
    @State private var loaded = false
    @State private var saveTask: Task<Void, Never>?
    @State private var label = ""
    @State private var viewing: CompassSnapshot?
    @State private var confirmRestore: CompassSnapshot?
    @State private var confirmReset = false

    private var profile: Profile? { profiles.first }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header
                    Picker("Section", selection: $section) {
                        Text("A · Now").tag(Section.a)
                        Text("Z · Heading").tag(Section.z)
                        Text("B · First habit").tag(Section.b)
                        Text("Saved").tag(Section.history)
                    }
                    .pickerStyle(.segmented)
                    switch section {
                    case .a: sectionA
                    case .z: sectionZ
                    case .b: sectionB
                    case .history: history
                    }
                }
                .padding(16)
                .padding(.bottom, 40)
            }
            .background(Theme.bg)
            .scrollDismissesKeyboard(.interactively)
            .toolbar(.hidden, for: .navigationBar)
        }
        .onAppear {
            guard !loaded, let p = profile else { return }
            draft = Compass.load(p)
            loaded = true
        }
        .onChange(of: draft) { scheduleSave() }
        .sheet(item: $viewing) { SnapshotViewer(snapshot: $0) }
        .confirmationDialog("Restore this snapshot?", isPresented: Binding(get: { confirmRestore != nil }, set: { if !$0 { confirmRestore = nil } }), titleVisibility: .visible) {
            Button("Restore") { if let s = confirmRestore { restore(s) } }
        } message: {
            Text("It replaces what’s in your worksheet now — your current goals re-sync to match.")
        }
        .confirmationDialog("Clear your Compass?", isPresented: $confirmReset, titleVisibility: .visible) {
            Button("Clear worksheet & start fresh", role: .destructive) { reset() }
        } message: {
            Text("Goals will be shelved, linked habits paused, and your assessment cleared. Saved snapshots are kept.")
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: "safari").font(.system(size: 12))
                Eyebrow("The Compass")
                Spacer()
                Label("Autosaves — goals sync live", systemImage: "square.and.arrow.down").font(.system(size: 10)).foregroundStyle(Theme.faint)
            }
            .foregroundStyle(Theme.faint)
            Text("Set your bearings").font(.system(size: 26, weight: .semibold)).tracking(-0.5).foregroundStyle(Theme.ink)
            Text("Where you are (A), where you’re heading (Z), and the one habit that starts the path (B). Fill it in your own words — it autosaves as you go.")
                .font(.system(size: 14)).foregroundStyle(Theme.ink2)
        }
        .padding(.top, 12)
    }

    // MARK: A

    private var sectionA: some View {
        VStack(spacing: 16) {
            SectionCard(title: "Your current reality") {
                rating("Personal life", value: $draft.assessment.contentmentPersonal, why: $draft.assessment.contentmentPersonalWhy)
                rating("Professional life", value: $draft.assessment.contentmentProfessional, why: $draft.assessment.contentmentProfessionalWhy)
                ListEditor(label: "Top priorities right now", hint: "The two or three that actually matter.", placeholder: "e.g. Be present with the kids", values: $draft.assessment.priorities)
                Field("Your best hours — everyone gets only a few genuinely high-quality hours a day") {
                    TextField("e.g. 6–8am before the house wakes", text: opt($draft.assessment.highQualityHours))
                }
                ListEditor(label: "What’s working well", values: $draft.assessment.workingWell)
                ListEditor(label: "What isn’t working", values: $draft.assessment.notWorking)
                ListEditor(label: "What keeps knocking you off course", hint: "The obstacles that show up when you try to change.", values: $draft.assessment.obstacles)
                stickyHabits
            }
            CompassAISlot.make(stage: "reality", draft: $draft)
        }
    }

    private func rating(_ label: String, value: Binding<Int?>, why: Binding<String?>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.ink)
            Text("How content are you, 1–5?").font(.system(size: 12)).foregroundStyle(Theme.faint)
            HStack(spacing: 6) {
                ForEach(1...5, id: \.self) { n in
                    Button { value.wrappedValue = n } label: {
                        Text("\(n)").font(.system(size: 14, weight: .semibold)).frame(width: 40, height: 40)
                            .foregroundStyle(value.wrappedValue == n ? Theme.buttonText : Theme.ink2)
                            .background(value.wrappedValue == n ? Theme.button : Theme.panel, in: RoundedRectangle(cornerRadius: 10))
                    }
                    .buttonStyle(.plain)
                }
            }
            .sensoryFeedback(.selection, trigger: value.wrappedValue)
            TextField("Why that number?", text: opt(why), axis: .vertical).font(.system(size: 15))
                .padding(10).background(Theme.bg, in: RoundedRectangle(cornerRadius: 10))
        }
    }

    private var stickyHabits: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Past sticky habits").font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.ink)
            Text("Habits that actually stuck before — and why. This is gold for the next one.").font(.system(size: 12)).foregroundStyle(Theme.faint)
            let rows = Binding<[CompassDraft.StickyHabit]>(
                get: { (draft.assessment.pastStickyHabits ?? []).isEmpty ? [.init()] : draft.assessment.pastStickyHabits! },
                set: { draft.assessment.pastStickyHabits = $0 }
            )
            ForEach(rows.wrappedValue.indices, id: \.self) { i in
                HStack {
                    VStack(spacing: 6) {
                        TextField("The habit", text: rows[i].habit)
                        TextField("Why it stuck", text: rows[i].whyItStuck)
                    }
                    .font(.system(size: 15))
                    if rows.wrappedValue.count > 1 {
                        Button { rows.wrappedValue.remove(at: i) } label: { Image(systemName: "trash") }.foregroundStyle(Theme.faint)
                    }
                }
                .padding(10).background(Theme.bg, in: RoundedRectangle(cornerRadius: 10))
            }
            Button { rows.wrappedValue.append(.init()) } label: { Label("Add another", systemImage: "plus").font(.system(size: 13)) }
        }
    }

    // MARK: Z

    private var sectionZ: some View {
        VStack(spacing: 16) {
            SectionCard(title: "Where you want to end up") {
                Field("Dream big — what does the life look like? Forget your current commitments for a moment.") {
                    TextField("If it were going the way you want…", text: opt($draft.vision.dreamBig), axis: .vertical).lineLimit(3...)
                }
                Field("What does success mean to you?") { TextField("", text: opt($draft.vision.successMeaning), axis: .vertical).lineLimit(2...) }
                VStack(alignment: .leading, spacing: 8) {
                    Text("Your vision by life domain").font(.system(size: 14, weight: .medium))
                    Text("A line each — leave blank any that don’t matter to you.").font(.system(size: 12)).foregroundStyle(Theme.faint)
                    ForEach(Compass.domains, id: \.0) { value, name in
                        HStack {
                            Text(name).font(.system(size: 13, weight: .medium)).frame(width: 100, alignment: .leading).foregroundStyle(Theme.ink2)
                            TextField("…", text: Binding(
                                get: { draft.vision.domainVisions?.first { $0.domain == value }?.vision ?? "" },
                                set: { v in
                                    var others = (draft.vision.domainVisions ?? []).filter { $0.domain != value }
                                    if !v.isEmpty { others.append(.init(domain: value, vision: v)) }
                                    draft.vision.domainVisions = others
                                }
                            ))
                        }
                        .padding(10).background(Theme.bg, in: RoundedRectangle(cornerRadius: 10))
                    }
                }
                Field("Six months") { TextField("", text: opt($draft.vision.timeline6mo), axis: .vertical).lineLimit(2...) }
                Field("Two years") { TextField("", text: opt($draft.vision.timeline2yr), axis: .vertical).lineLimit(2...) }
                Field("Ten years") { TextField("", text: opt($draft.vision.timeline10yr), axis: .vertical).lineLimit(2...) }
                Field("Your ideal identity — who do you hope to be? Behaviour follows identity.") {
                    TextField("I am someone who…", text: opt($draft.vision.idealIdentity), axis: .vertical)
                }
            }
            SectionCard(title: "Your concrete goals") {
                Text("The destinations your habits will serve. Big-picture is fine — they go live as you type.").font(.system(size: 12)).foregroundStyle(Theme.faint)
                if draft.goals.isEmpty {
                    Text("No goals yet. Add one, or talk it through with the AI helper to pull some in.").font(.system(size: 13)).foregroundStyle(Theme.faint)
                }
                ForEach($draft.goals) { $g in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            TextField("e.g. Run a half marathon", text: $g.title, axis: .vertical).font(.system(size: 16, weight: .medium))
                            Button { draft.goals.removeAll { $0.id == g.id } } label: { Image(systemName: "trash") }.foregroundStyle(Theme.faint)
                        }
                        HStack {
                            Picker("Domain", selection: $g.domain) {
                                ForEach(Compass.domains, id: \.0) { Text($0.1).tag($0.0) }
                            }
                            .pickerStyle(.menu).tint(Theme.ink2)
                            TextField("by when? (optional)", text: opt($g.timeframe)).font(.system(size: 14))
                        }
                        TextField("why it matters", text: opt($g.whyText), axis: .vertical).font(.system(size: 14)).foregroundStyle(Theme.ink2)
                    }
                    .padding(12).background(Theme.bg, in: RoundedRectangle(cornerRadius: 12))
                }
                Button { draft.goals.append(.init()) } label: { Label("Add goal", systemImage: "plus").font(.system(size: 14, weight: .medium)) }
            }
            CompassAISlot.make(stage: "vision", draft: $draft)
        }
    }

    // MARK: B

    private func liveGoal(_ g: CompassDraft.GoalForm) -> Goal? {
        goals.first { $0.title.trimmed.lowercased() == g.title.trimmed.lowercased() }
    }

    private var sectionB: some View {
        VStack(spacing: 16) {
            SectionCard(title: "Goals → systems → the first habit") {
                Text("Z is your goal; B is the first habit of the system that gets you there. For each goal, sketch the system — then hand one habit to the Architect to engineer properly.")
                    .font(.system(size: 13)).foregroundStyle(Theme.ink2)
                if draft.goals.isEmpty {
                    Button("Add some goals in the Z section first.") { section = .z }.font(.system(size: 13))
                }
                ForEach($draft.goals) { $g in
                    let live = liveGoal(g)
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text(Compass.domains.first { $0.0 == g.domain }?.1.uppercased() ?? "").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.faint)
                            Text(g.title.trimmed.nonEmpty ?? "Untitled goal").font(.system(size: 15, weight: .medium)).foregroundStyle(g.title.trimmed.isEmpty ? Theme.faint : Theme.ink)
                        }
                        Field("Current system — what are you doing now? Write “none” if nothing.") { TextField("", text: opt($g.currentSystem), axis: .vertical) }
                        Field("Ideal system — what would the ideal system for YOU look like?") { TextField("", text: opt($g.idealSystem), axis: .vertical) }
                        let linked = habits.filter { live != nil && $0.goal === live }
                        if !linked.isEmpty {
                            Eyebrow("Habits serving this goal")
                            ForEach(linked) { h in
                                Button { router.architect = ArchitectSeed(habit: h) } label: {
                                    HStack {
                                        Text(h.title).font(.system(size: 13)).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
                                        if h.pausedAt != nil { Text("paused").font(.system(size: 11)).foregroundStyle(Theme.faint) }
                                        Spacer()
                                        Image(systemName: "arrow.up.right").font(.system(size: 12)).foregroundStyle(Theme.faint)
                                    }
                                }
                            }
                        }
                        HStack {
                            Text(live != nil ? "Linked to your live goal." : "Give this goal a title — it links automatically.").font(.system(size: 12)).foregroundStyle(Theme.faint)
                            Spacer()
                            Button {
                                let seed = g.idealSystem?.trimmed.nonEmpty ?? g.currentSystem?.trimmed.nonEmpty ?? g.title
                                router.architect = ArchitectSeed(goal: live, interviewSeed: seed)
                            } label: { Label("Design this habit", systemImage: "hammer").font(.system(size: 13, weight: .semibold)) }
                            .buttonStyle(.borderedProminent).tint(Theme.button)
                            .disabled(g.title.trimmed.isEmpty)
                        }
                    }
                    .padding(12).background(Theme.bg, in: RoundedRectangle(cornerRadius: 12))
                }
            }
            let unassigned = habits.filter { $0.goal == nil }
            let active = goals.filter { $0.status == "active" }
            if !unassigned.isEmpty {
                SectionCard(title: "Unassigned habits", icon: "link") {
                    Text("These aren’t linked to a goal yet — habits stick better when they serve something bigger. Pick a goal for each.")
                        .font(.system(size: 12)).foregroundStyle(Theme.faint)
                    ForEach(unassigned) { h in
                        HStack {
                            Text(h.title).font(.system(size: 13)).foregroundStyle(Theme.ink)
                            Spacer()
                            Menu("Link to a goal…") {
                                ForEach(active) { g in
                                    Button(g.title) {
                                        h.goal = g
                                        try? ctx.save()
                                        toasts.show("Linked to your goal.")
                                    }
                                }
                            }
                            .font(.system(size: 13))
                            .disabled(active.isEmpty)
                        }
                    }
                    if active.isEmpty {
                        Text("Add a goal in the Z section first — it becomes linkable straight away.").font(.system(size: 12)).foregroundStyle(Theme.faint)
                    }
                }
            }
            CompassAISlot.make(stage: "first-step", draft: $draft)
        }
    }

    // MARK: Saved versions

    private var history: some View {
        VStack(spacing: 16) {
            SectionCard(title: "Save a snapshot", icon: "square.and.arrow.down") {
                Text("Your worksheet is already live — goals sync as you go. A snapshot just freezes a read-only copy of this moment you can look back on or restore later.")
                    .font(.system(size: 12)).foregroundStyle(Theme.faint)
                HStack {
                    TextField("e.g. Winter reset", text: $label).textFieldStyle(.roundedBorder)
                    Button("Save snapshot") {
                        guard let p = profile else { return }
                        flushSave()
                        do {
                            try Compass.snapshot(label: label, profile: p, ctx: ctx)
                            label = ""
                            toasts.show("Snapshot saved.")
                        } catch { toasts.error("Could not save the snapshot.") }
                    }
                    .buttonStyle(.borderedProminent).tint(Theme.button)
                }
            }
            SectionCard(title: "Your snapshots", icon: "clock.arrow.circlepath") {
                if snapshots.isEmpty {
                    Text("No snapshots yet. Fill in the worksheet, then save one above.").font(.system(size: 13)).foregroundStyle(Theme.faint)
                }
                ForEach(snapshots) { s in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(s.label ?? "Untitled").font(.system(size: 14, weight: .medium))
                            let n = Compass.draft(of: s).goals.count
                            Text("\(s.createdAt.formatted(date: .abbreviated, time: .omitted)) · \(n) goal\(n == 1 ? "" : "s")").font(.system(size: 12)).foregroundStyle(Theme.faint)
                        }
                        Spacer()
                        Button { viewing = s } label: { Image(systemName: "eye") }
                        Button("Restore") { confirmRestore = s }.font(.system(size: 13, weight: .medium))
                        Button(role: .destructive) {
                            ctx.delete(s)
                            try? ctx.save()
                        } label: { Image(systemName: "trash") }
                    }
                    .foregroundStyle(Theme.ink2)
                }
            }
            SectionCard(title: "Start fresh", icon: "flame") {
                Text("Clear the worksheet and shelve its goals — linked habits pause (nothing owed, recoverable) and your assessment resets. Saved snapshots stay untouched.")
                    .font(.system(size: 12)).foregroundStyle(Theme.faint)
                Button { confirmReset = true } label: { Label("Clear worksheet & start fresh", systemImage: "arrow.counterclockwise") }
                    .buttonStyle(SecondaryButtonStyle())
            }
        }
    }

    // MARK: Saving

    private func scheduleSave() {
        guard loaded else { return }
        saveTask?.cancel()
        saveTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(700))
            guard !Task.isCancelled else { return }
            flushSave()
        }
    }

    private func flushSave() {
        guard let p = profile else { return }
        try? Compass.save(draft, profile: p, ctx: ctx)
    }

    private func restore(_ s: CompassSnapshot) {
        guard let p = profile else { return }
        do {
            loaded = false
            draft = try Compass.restore(s, profile: p, ctx: ctx)
            loaded = true
            section = .a
            toasts.show("Restored into your worksheet.")
        } catch { toasts.error("Could not restore.") }
    }

    private func reset() {
        guard let p = profile else { return }
        do {
            saveTask?.cancel()
            loaded = false
            try Compass.reset(profile: p, ctx: ctx)
            draft = CompassDraft()
            loaded = true
            section = .a
            toasts.show("Cleared. Starting fresh.")
        } catch { toasts.error("Could not clear the worksheet.") }
    }

    private func opt(_ b: Binding<String?>) -> Binding<String> {
        Binding(get: { b.wrappedValue ?? "" }, set: { b.wrappedValue = $0 })
    }
}

/// A growing list of one-line entries (priorities, obstacles…).
struct ListEditor: View {
    let label: String
    var hint: String?
    var placeholder = ""
    @Binding var values: [String]?

    var body: some View {
        let rows = (values ?? []).isEmpty ? [""] : values!
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.ink)
            if let hint { Text(hint).font(.system(size: 12)).foregroundStyle(Theme.faint) }
            ForEach(rows.indices, id: \.self) { i in
                HStack {
                    TextField(placeholder, text: Binding(get: { rows.indices.contains(i) ? rows[i] : "" }, set: { v in
                        var r = rows
                        r[i] = v
                        values = r
                    }))
                    .font(.system(size: 15))
                    if rows.count > 1 {
                        Button { var r = rows; r.remove(at: i); values = r } label: { Image(systemName: "trash") }.foregroundStyle(Theme.faint)
                    }
                }
                .padding(10).background(Theme.bg, in: RoundedRectangle(cornerRadius: 10))
            }
            Button { values = (values ?? []) + [""] } label: { Label("Add another", systemImage: "plus").font(.system(size: 13)) }
        }
    }
}

struct SnapshotViewer: View {
    let snapshot: CompassSnapshot
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let d = Compass.draft(of: snapshot)
        NavigationStack {
            List {
                Section("A · Where you were") {
                    line("Personal life", d.assessment.contentmentPersonal.map { "\($0)/5" })
                    line("Professional life", d.assessment.contentmentProfessional.map { "\($0)/5" })
                    line("Priorities", d.assessment.priorities?.filter { !$0.isEmpty }.joined(separator: " · ").nonEmpty)
                    line("Best hours", d.assessment.highQualityHours?.nonEmpty)
                    line("Obstacles", d.assessment.obstacles?.filter { !$0.isEmpty }.joined(separator: " · ").nonEmpty)
                }
                Section("Z · Where you were heading") {
                    line("Dream big", d.vision.dreamBig?.nonEmpty)
                    line("Success", d.vision.successMeaning?.nonEmpty)
                    line("Ideal identity", d.vision.idealIdentity?.nonEmpty)
                }
                Section("Goals") {
                    ForEach(d.goals) { g in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(g.title).font(.system(size: 15, weight: .medium))
                            if let w = g.whyText?.nonEmpty { Text(w).font(.system(size: 13)).foregroundStyle(Theme.ink2) }
                        }
                    }
                }
            }
            .navigationTitle(snapshot.label ?? "Snapshot")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    @ViewBuilder private func line(_ label: String, _ value: String?) -> some View {
        if let value {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.system(size: 12)).foregroundStyle(Theme.faint)
                Text(value).font(.system(size: 15))
            }
        }
    }
}

/// Where the Compass's "talk it through" AI helper plugs in.
enum CompassAISlot {
    @MainActor static var factory: ((String, Binding<CompassDraft>) -> AnyView)?

    @MainActor @ViewBuilder static func make(stage: String, draft: Binding<CompassDraft>) -> some View {
        if let f = factory { f(stage, draft) }
    }
}
