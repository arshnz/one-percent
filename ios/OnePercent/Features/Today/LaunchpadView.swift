import SwiftUI
import SwiftData

// The Launchpad — a port of client/src/pages/Launchpad.tsx.
struct LaunchpadView: View {
    @Environment(AppRouter.self) private var router
    @Environment(\.modelContext) private var ctx
    @Environment(\.scenePhase) private var scenePhase
    @Environment(Toasts.self) private var toasts
    @Query(sort: \Habit.createdAt) private var habits: [Habit]
    @Query private var logs: [HabitLog]
    @Query private var checkIns: [CheckIn]
    @Query private var goals: [Goal]
    @Query private var phases: [Phase]
    @Query private var profiles: [Profile]

    @State private var now = Date()
    @State private var snoozeTick = 0

    /// The workbook's cap on concurrent habits.
    static let slots = 6

    private var tz: String { profiles.first?.timezone ?? TimeZone.current.identifier }

    var body: some View {
        // Reading these keeps the view in step with every write, wherever it lands.
        let _ = (logs.count, phases.map(\.status), checkIns.count, snoozeTick)
        let payload = TodayState.build(habits, now: now, tz: tz)
        let pack = CheckInPack.current(habits: habits, checkIns: checkIns, goals: goals, now: now, tz: tz)
        let live = habits.filter { $0.archivedAt == nil }
        let paused = live.filter { $0.pausedAt != nil }
        let running = live.count - paused.count
        let onAddHabit: (() -> Void)? = { router.architect = ArchitectSeed() }
        let onEditHabit: ((Habit) -> Void)? = { router.architect = ArchitectSeed(habit: $0) }
        let onOpenCompass: (() -> Void)? = { router.tab = .compass }

        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    header(payload)

                    if pack.isDue {
                        CheckInCardView(pack: pack, onChanged: replan, onSnooze: {
                            CheckInSnooze.snooze(weekOf: pack.weekOf, today: payload.date)
                            snoozeTick += 1
                        })
                    }

                    if goals.isEmpty, let onOpenCompass {
                        compassNudge(onOpenCompass)
                    }
                    if live.isEmpty {
                        Text("One habit, built properly, beats six started at once. Engineer your first — every vote you cast is a step toward who you want to become.")
                            .font(.system(size: 14.5)).foregroundStyle(Theme.muted)
                    }
                    if running > 2 {
                        (Text("A word on focus: ").fontWeight(.semibold).foregroundStyle(Theme.ink)
                         + Text("the more change you take on at once, the less of it sticks. The rule of thumb is one personal habit, one professional — you’re running \(running). Consider pausing the rest until one feels automatic."))
                            .font(.system(size: 13.5)).foregroundStyle(Theme.ink2)
                            .padding(.horizontal, 16).padding(.vertical, 12)
                            .background(Color(hex: 0xFBF7EC).opacity(0.9), in: RoundedRectangle(cornerRadius: 14))
                            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: 0xE4DCC9)))
                    }

                    ForEach(TodayState.sorted(payload)) { item in
                        HabitCardView(item: item, today: payload.date, weekday: payload.weekday, onEdit: onEditHabit, onChanged: replan)
                    }

                    if live.count < Self.slots, let onAddHabit {
                        Button(action: onAddHabit) {
                            VStack(spacing: 10) {
                                Image(systemName: "plus").font(.system(size: 18, weight: .medium))
                                    .frame(width: 42, height: 42).background(Theme.rest, in: Circle())
                                Text("Add a habit").font(.system(size: 14, weight: .semibold))
                            }
                            .foregroundStyle(Theme.faint)
                            .frame(maxWidth: .infinity, minHeight: 140)
                            .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Theme.faint.opacity(0.6), style: StrokeStyle(lineWidth: 1.5, dash: [6, 5])))
                        }
                        .buttonStyle(.plain)
                    }

                    if !paused.isEmpty { pausedSection(paused) }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 32)
            }
            .background(Theme.bg)
            .refreshable { now = Date() }
            .toolbar(.hidden, for: .navigationBar)
        }
        .onChange(of: scenePhase) { if scenePhase == .active { now = Date() } }
        // Replan notifications whenever anything they depend on changes.
        .task(id: reminderInputs) {
            let enabled = profiles.first?.remindersEnabled ?? true
            let prefs = Reminders.Prefs(profiles.first)
            await Reminders.reschedule(
                habits: habits, checkIns: checkIns, tz: tz, enabled: enabled, prefs: prefs
            )
        }
        // Midnight rolls the day over even if the app stays open.
        .task(id: payload.date) {
            let secondsToMidnight = 86_400 - Double(LocalDate.minutesOfDay(Date(), tz: tz) * 60) + 5
            try? await Task.sleep(for: .seconds(secondsToMidnight))
            now = Date()
        }
    }

    private func header(_ p: TodayPayload) -> some View {
        let left = TodayState.remaining(p)
        let first = Self.firstName(profiles.first?.name)
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: "paperplane").font(.system(size: 12))
                Eyebrow("The Launchpad")
                Spacer()
                Button { router.showSettings = true } label: {
                    Image(systemName: "gearshape").font(.system(size: 17)).foregroundStyle(Theme.ink2).frame(width: 36, height: 36)
                }
                .accessibilityLabel("Settings")
            }
            .foregroundStyle(Theme.faint)
            Text(Self.greeting(now) + (first.map { ", \($0)" } ?? ""))
                .font(.system(size: 27, weight: .bold)).tracking(-0.5).foregroundStyle(Theme.ink)
            Text(DateText.long(p.date) + (p.habits.isEmpty ? "" : " · \(left) \(left == 1 ? "vote" : "votes") left to cast"))
                .font(.system(size: 14.5)).foregroundStyle(Theme.muted)
            HStack(spacing: 14) {
                Theme.accent.opacity(0.45).frame(width: 2)
                Text("“\(Quotes.ofTheDay(now))”").font(.serif(16.5, italic: true)).foregroundStyle(Theme.ink)
            }
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 12)
        }
        .padding(.top, 12)
    }

    private func compassNudge(_ open: @escaping () -> Void) -> some View {
        Button(action: open) {
            HStack(alignment: .top, spacing: 16) {
                Image(systemName: "safari").font(.system(size: 19)).foregroundStyle(.white)
                    .frame(width: 44, height: 44).background(Theme.button, in: Circle())
                VStack(alignment: .leading, spacing: 4) {
                    Text("Set your bearings first").font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink)
                    Text("Habits stick when they serve something bigger. Ten minutes in the Compass maps where you are, where you’re heading, and the one habit that starts the path.")
                        .font(.system(size: 13.5)).foregroundStyle(Theme.ink2).multilineTextAlignment(.leading)
                    Text("Open the Compass →").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.gold).padding(.top, 4)
                }
            }
            .padding(20)
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: 18))
        }
        .buttonStyle(.plain)
    }

    private func pausedSection(_ paused: [Habit]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Eyebrow("Paused · \(paused.count)")
            ForEach(paused) { h in
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(h.title).font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.ink2).lineLimit(1)
                        Text("Resting — no votes owed, no streak lost.").font(.system(size: 12)).foregroundStyle(Theme.faint)
                    }
                    Spacer()
                    Button {
                        do {
                            try DailyLoop.setPaused(h, false, ctx: ctx)
                            toasts.show("Welcome back — this habit’s live again.")
                            replan()
                        } catch { toasts.error("Could not resume this habit") }
                    } label: {
                        Label("Resume", systemImage: "play.circle").font(.system(size: 13, weight: .semibold))
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .background(Theme.card, in: RoundedRectangle(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.line))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.ink)
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
                .background(Theme.panel, in: RoundedRectangle(cornerRadius: 14))
            }
        }
        .padding(.top, 18)
    }

    private func replan() { now = Date() }

    private var reminderInputs: Int {
        var h = Hasher()
        h.combine(LocalDate.of(now, tz: tz))
        h.combine(profiles.first?.remindersEnabled)
        h.combine(profiles.first?.habitRemindersEnabled)
        h.combine(profiles.first?.digestEnabled)
        h.combine(profiles.first?.digestTime)
        h.combine(profiles.first?.checkInNudgeEnabled)
        h.combine(profiles.first?.checkInTime)
        for x in habits {
            h.combine(x.uid); h.combine(x.reminderTime); h.combine(x.reminderEnabled); h.combine(x.pausedAt); h.combine(x.archivedAt)
            h.combine(x.scheduleType); h.combine(x.scheduleDays); h.combine(x.timesPerWeek); h.combine(x.title)
        }
        for l in logs { h.combine(l.date); h.combine(l.status) }
        for c in checkIns { h.combine(c.weekOf) }
        return h.finalize()
    }

    static func greeting(_ d: Date) -> String {
        let h = Calendar.current.component(.hour, from: d)
        return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"
    }

    /// "arshdeep.matharu@x" → "Arshdeep"; "Arsh Matharu" → "Arsh".
    static func firstName(_ s: String?) -> String? {
        guard var base = s?.split(separator: "@").first.map(String.init) else { return nil }
        base = base.split(separator: " ").first.map(String.init) ?? base
        base = base.split(separator: ".").first.map(String.init) ?? base
        guard !base.isEmpty else { return nil }
        return base.prefix(1).uppercased() + base.dropFirst().lowercased()
    }
}
