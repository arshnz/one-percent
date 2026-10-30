#if os(macOS)
import SwiftUI
import SwiftData

// The Mac's own window. The iPhone puts five screens behind a tab bar; a Mac
// window has room for a sidebar that lists both where you can go and what
// you're building — your habits — with the screen itself beside it.
//
// Only the frame is Mac-specific. Every screen inside it is the shared view
// (or, for Today, the shared habit card), so the iPhone and Mac can't drift.

enum MacDestination: Hashable {
    case section(AppRouter.TabKey)
    case habit(String)
}

struct MacMainView: View {
    @Environment(AppRouter.self) private var router
    @Environment(\.modelContext) private var ctx
    @Environment(Toasts.self) private var toasts
    @Query(sort: \Habit.createdAt) private var habits: [Habit]
    @Query private var logs: [HabitLog]
    @Query private var profiles: [Profile]

    @State private var selection: MacDestination? = .section(.today)
    @State private var archiving: Habit?

    private var tz: String { profiles.first?.timezone ?? TimeZone.current.identifier }

    var body: some View {
        @Bindable var router = router
        let live = habits.filter { $0.archivedAt == nil }
        let today = LocalDate.today(tz: tz)
        let _ = logs.count

        NavigationSplitView {
            List(selection: $selection) {
                Section {
                    sectionRow(.today, "Today", "sun.max")
                    sectionRow(.compass, "Compass", "safari")
                    sectionRow(.learn, "Learn", "graduationcap")
                    sectionRow(.momentum, "Momentum", "chart.line.uptrend.xyaxis")
                    if BodyTabSlot.factory != nil { sectionRow(.body, "Body", "heart.text.square") }
                }
                let running = live.filter { $0.pausedAt == nil }
                if !running.isEmpty {
                    Section("Habits") {
                        ForEach(running) { h in habitRow(h, today: today) }
                    }
                }
                let paused = live.filter { $0.pausedAt != nil }
                if !paused.isEmpty {
                    Section("Paused") {
                        ForEach(paused) { h in habitRow(h, today: today) }
                    }
                }
            }
            .navigationSplitViewColumnWidth(min: 200, ideal: 240, max: 320)
        } detail: {
            detail
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { router.architect = ArchitectSeed() } label: { Label("New Habit", systemImage: "plus") }
                    .help("Engineer a new habit (⌘N)")
                    .disabled(live.count >= LaunchpadView.slots)
            }
        }
        // ⌘1–5 in the Go menu set the router's tab; follow it here.
        .onChange(of: router.tab) { selection = .section(router.tab) }
        .onChange(of: selection) {
            if case .section(let t) = selection, router.tab != t { router.tab = t }
        }
        .sheet(item: $router.architect) { ArchitectView(seed: $0).environment(router).macSheet(width: 640, height: 760) }
        .sheet(isPresented: $router.showSettings) { SettingsView().macSheet(width: 560, height: 720) }
        .confirmationDialog("Archive this habit?", isPresented: Binding(get: { archiving != nil }, set: { if !$0 { archiving = nil } }), titleVisibility: .visible) {
            Button("Archive", role: .destructive) {
                guard let h = archiving else { return }
                do {
                    try HabitDesign.archive(h, ctx: ctx)
                    if selection == .habit(h.uid) { selection = .section(.today) }
                } catch { toasts.error("Could not archive habit") }
                archiving = nil
            }
        } message: {
            Text("It leaves your habits and frees a slot. Its history stays in Momentum.")
        }
    }

    private func sectionRow(_ tab: AppRouter.TabKey, _ title: String, _ icon: String) -> some View {
        Label(title, systemImage: icon).tag(MacDestination.section(tab))
    }

    private func habitRow(_ h: Habit, today: String) -> some View {
        let log = (h.logs ?? []).first { $0.date == today }
        return Label {
            Text(Self.shortName(h.title)).lineLimit(1)
        } icon: {
            Image(systemName: h.kind == "break" ? "shield.fill" : "circle.fill")
                .foregroundStyle(Theme.accent(for: h))
                .imageScale(.small)
        }
        .badge(log.map { $0.status == "miss" ? Text(Image(systemName: "xmark")) : Text(Image(systemName: "checkmark")) })
        .help(h.title)
        .tag(MacDestination.habit(h.uid))
        .contextMenu { MacHabitMenu(habit: h, onArchive: { archiving = h }) }
    }

    /// Identity statements all open the same way ("I am someone who…"), which
    /// truncates every habit in a sidebar to the same words. Drop the opening
    /// so what's left is what makes each one different.
    static func shortName(_ title: String) -> String {
        let openings = ["i am someone who ", "i am someone that ", "i am going to be ", "i am becoming ",
                        "i am a person who ", "i'm someone who ", "i’m someone who ", "i am an ", "i am a ", "i am ", "i'm ", "i’m "]
        var t = title.trimmingCharacters(in: .whitespaces)
        if let o = openings.first(where: { t.lowercased().hasPrefix($0) }) { t = String(t.dropFirst(o.count)) }
        if t.hasSuffix(".") { t.removeLast() }
        return t.prefix(1).uppercased() + t.dropFirst()
    }

    @ViewBuilder private var detail: some View {
        switch selection ?? .section(.today) {
        case .section(.today):
            MacTodayView(onSelectHabit: { selection = .habit($0) })
        case .section(.compass):
            CompassView().macColumn()
                .navigationTitle("Compass").navigationSubtitle("Where you are, where you’re heading")
        case .section(.learn):
            LearningView().macColumn()
                .navigationTitle("Learn")
        case .section(.momentum):
            MomentumView(
                onEditHabit: { router.architect = ArchitectSeed(habit: $0) },
                onAddHabit: { router.architect = ArchitectSeed() },
                habitFooter: HabitFooterSlot.factory,
                measuredExtra: AnyView(WearableSeriesView())
            )
            .macColumn(1120)
            .navigationTitle("Momentum").navigationSubtitle("Who you’re becoming")
        case .section(.body):
            (BodyTabSlot.factory?() ?? AnyView(EmptyView())).macColumn(1120)
                .navigationTitle("Body").navigationSubtitle("What your body recorded")
        case .habit(let uid):
            if let h = habits.first(where: { $0.uid == uid }) {
                MacHabitDetail(habit: h, onArchive: { archiving = h })
            } else {
                ContentUnavailableView("Habit not found", systemImage: "questionmark.circle")
            }
        }
    }
}

/// The same actions wherever a habit is right-clicked.
struct MacHabitMenu: View {
    let habit: Habit
    var onArchive: () -> Void

    @Environment(AppRouter.self) private var router
    @Environment(\.modelContext) private var ctx
    @Environment(Toasts.self) private var toasts

    var body: some View {
        Button("Edit Habit…", systemImage: "pencil") { router.architect = ArchitectSeed(habit: habit) }
        if habit.pausedAt == nil {
            Button("Pause", systemImage: "pause.circle") { setPaused(true) }
        } else {
            Button("Resume", systemImage: "play.circle") { setPaused(false) }
        }
        Divider()
        Button("Archive…", systemImage: "archivebox", role: .destructive, action: onArchive)
    }

    private func setPaused(_ paused: Bool) {
        do {
            try DailyLoop.setPaused(habit, paused, ctx: ctx)
            toasts.show(paused ? "Paused — no votes owed while it rests." : "Welcome back — this habit’s live again.")
        } catch { toasts.error("Could not update this habit") }
    }
}

// MARK: - Today

/// Today on the Mac: the day's habits as a list, and the one you're on beside
/// it — the same card the iPhone shows, with room to breathe.
struct MacTodayView: View {
    var onSelectHabit: (String) -> Void

    @Environment(AppRouter.self) private var router
    @Environment(\.scenePhase) private var scenePhase
    @Query(sort: \Habit.createdAt) private var habits: [Habit]
    @Query private var logs: [HabitLog]
    @Query private var checkIns: [CheckIn]
    @Query private var goals: [Goal]
    @Query private var phases: [Phase]
    @Query private var profiles: [Profile]

    @State private var now = Date()
    @State private var snoozeTick = 0
    @State private var selected: String?
    @State private var archiving: Habit?

    private var tz: String { profiles.first?.timezone ?? TimeZone.current.identifier }

    var body: some View {
        let _ = (logs.count, phases.map(\.status), checkIns.count, snoozeTick)
        let payload = TodayState.build(habits, now: now, tz: tz)
        let items = TodayState.sorted(payload)
        let pack = CheckInPack.current(habits: habits, checkIns: checkIns, goals: goals, now: now, tz: tz)
        let left = TodayState.remaining(payload)
        let current = items.first { $0.habit.uid == selected } ?? defaultItem(items, payload)

        HStack(spacing: 0) {
            list(items, payload, current)
                .frame(width: 300)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(spacing: 12) {
                        Theme.accent.opacity(0.5).frame(width: 2)
                        Text("“\(Quotes.ofTheDay(now))”").font(.serif(15, italic: true)).foregroundStyle(Theme.ink2)
                    }
                    .fixedSize(horizontal: false, vertical: true)

                    if pack.isDue {
                        CheckInCardView(pack: pack, onChanged: replan, onSnooze: {
                            CheckInSnooze.snooze(weekOf: pack.weekOf, today: payload.date)
                            snoozeTick += 1
                        })
                    }
                    if goals.isEmpty {
                        GroupBox {
                            HStack {
                                Text("Habits stick when they serve something bigger. Ten minutes in the Compass maps where you are and where you’re heading.")
                                    .font(.ui(13)).foregroundStyle(Theme.ink2)
                                Spacer()
                                Button("Open Compass") { router.tab = .compass }
                            }
                        } label: { Label("Set your bearings first", systemImage: "safari") }
                    }
                    if let current {
                        HabitCardView(item: current, today: payload.date, weekday: payload.weekday,
                                      onEdit: { router.architect = ArchitectSeed(habit: $0) }, onChanged: replan)
                            .id(current.habit.uid)
                    } else {
                        ContentUnavailableView {
                            Label("No habits yet", systemImage: "sparkles")
                        } description: {
                            Text("One habit, built properly, beats six started at once.")
                        } actions: {
                            Button("New Habit") { router.architect = ArchitectSeed() }.buttonStyle(.borderedProminent)
                        }
                        .padding(.top, 60)
                    }
                }
                .frame(maxWidth: 620)
                .padding(28)
                .frame(maxWidth: .infinity)
            }
            .background(Theme.bg)
        }
        .navigationTitle(LaunchpadView.greeting(now) + (LaunchpadView.firstName(profiles.first?.name).map { ", \($0)" } ?? ""))
        .navigationSubtitle(DateText.long(payload.date) + (payload.habits.isEmpty ? "" : " · \(left) \(left == 1 ? "vote" : "votes") left"))
        .onChange(of: scenePhase) { if scenePhase == .active { now = Date() } }
        .task(id: payload.date) {
            let secondsToMidnight = 86_400 - Double(LocalDate.minutesOfDay(Date(), tz: tz) * 60) + 5
            try? await Task.sleep(for: .seconds(secondsToMidnight))
            now = Date()
        }
        .confirmationDialog("Archive this habit?", isPresented: Binding(get: { archiving != nil }, set: { if !$0 { archiving = nil } }), titleVisibility: .visible) {
            Button("Archive", role: .destructive) {
                if let h = archiving { try? HabitDesign.archive(h, ctx: h.modelContext!) }
                archiving = nil
            }
        }
    }

    private func list(_ items: [HabitToday], _ p: TodayPayload, _ current: HabitToday?) -> some View {
        let due = items.filter { TodayState.tier($0, weekday: p.weekday) < 2 }
        let off = items.filter { TodayState.tier($0, weekday: p.weekday) == 2 }
        return List(selection: Binding(get: { current?.habit.uid }, set: { selected = $0 })) {
            if !due.isEmpty {
                Section("Today") { ForEach(due) { row($0, p) } }
            }
            if !off.isEmpty {
                Section("Not today") { ForEach(off) { row($0, p) } }
            }
            let running = habits.filter { $0.archivedAt == nil && $0.pausedAt == nil }.count
            if running > 2 {
                Section {
                    Text("You’re running \(running) habits. The rule of thumb is one personal, one professional — consider pausing the rest until one feels automatic.")
                        .font(.ui(12)).foregroundStyle(Theme.ink2)
                } header: { Text("A word on focus") }
            }
        }
        .listStyle(.inset)
        .scrollContentBackground(.hidden)
        .background(Theme.bg)
    }

    private func row(_ item: HabitToday, _ p: TodayPayload) -> some View {
        let h = item.habit
        let log = item.todayLog
        let danger = TodayState.tier(item, weekday: p.weekday) == 0 && log == nil && item.wasPreviousMissed
        return HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 2).fill(Theme.accent(for: h)).frame(width: 4, height: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text(h.title).font(.ui(14, weight: .medium)).lineLimit(2)
                Text(subtitle(item)).font(.ui(12)).foregroundStyle(Theme.ink2).lineLimit(1)
            }
            Spacer(minLength: 6)
            Group {
                if let log, log.status != "miss" {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.green)
                } else if log?.status == "miss" {
                    Image(systemName: "xmark.circle").foregroundStyle(Theme.red)
                } else if danger {
                    Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Theme.amber)
                        .help("You missed last time — never miss twice.")
                } else {
                    Image(systemName: "circle").foregroundStyle(Theme.faint)
                }
            }
            .font(.system(size: 15))
        }
        .padding(.vertical, 4)
        .tag(h.uid)
        .contextMenu {
            Button("Open Habit Page", systemImage: "arrow.right.circle") { onSelectHabit(h.uid) }
            MacHabitMenu(habit: h, onArchive: { archiving = h })
        }
    }

    private func subtitle(_ item: HabitToday) -> String {
        if let wp = item.weekProgress { return "\(wp.hits) of \(wp.quota) this week" }
        return item.phase?.targetText ?? ""
    }

    /// The first habit still owed today, else the first on the list.
    private func defaultItem(_ items: [HabitToday], _ p: TodayPayload) -> HabitToday? {
        items.first { TodayState.tier($0, weekday: p.weekday) == 0 && ($0.todayLog == nil || $0.todayLog?.status == "miss") } ?? items.first
    }

    private func replan() { now = Date() }
}

// MARK: - One habit

/// A habit's own page: today's card, its momentum and what it's doing to
/// your body, in one place.
struct MacHabitDetail: View {
    let habit: Habit
    var onArchive: () -> Void

    @Environment(AppRouter.self) private var router
    @Query(sort: \Habit.createdAt) private var habits: [Habit]
    @Query private var logs: [HabitLog]
    @Query private var phases: [Phase]
    @Query(sort: \CheckIn.weekOf, order: .reverse) private var checkIns: [CheckIn]
    @Query private var profiles: [Profile]
    @State private var now = Date()
    @State private var trajectory: MomentumData.HabitTrajectory?

    private var tz: String { profiles.first?.timezone ?? TimeZone.current.identifier }

    var body: some View {
        let _ = (logs.count, phases.map(\.status))
        let payload = TodayState.build(habits, now: now, tz: tz)
        let item = payload.habits.first { $0.habit.uid == habit.uid }

        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let item {
                    HabitCardView(item: item, today: payload.date, weekday: payload.weekday,
                                  onEdit: { router.architect = ArchitectSeed(habit: $0) }, onChanged: { now = Date() })
                } else if habit.pausedAt != nil {
                    GroupBox {
                        HStack {
                            Text("Resting — no votes owed, no streak lost.").foregroundStyle(Theme.ink2)
                            Spacer()
                        }
                    } label: { Label("Paused", systemImage: "pause.circle") }
                }
                if let trajectory {
                    HabitMomentumCard(t: trajectory, onEdit: { router.architect = ArchitectSeed(habit: $0) },
                                      footer: HabitFooterSlot.factory?(habit))
                }
            }
            .frame(maxWidth: 680)
            .padding(28)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.bg)
        .navigationTitle(habit.title)
        .navigationSubtitle(habit.activePhase.map { "Phase \($0.phaseNumber) · \($0.targetText)" } ?? "")
        .toolbar {
            ToolbarItem {
                Button { router.architect = ArchitectSeed(habit: habit) } label: { Label("Edit Habit", systemImage: "pencil") }
                    .help("Edit this habit in the Architect")
            }
            ToolbarItem {
                Menu { MacHabitMenu(habit: habit, onArchive: onArchive) } label: { Label("More", systemImage: "ellipsis.circle") }
            }
        }
        .task(id: "\(habit.uid)-\(logs.count)-\(phases.count)") {
            let data = Momentum.compute(habits: habits, checkIns: checkIns, now: now, tz: tz)
            trajectory = data.trajectory.first { $0.habit.uid == habit.uid }
        }
    }
}
#endif
