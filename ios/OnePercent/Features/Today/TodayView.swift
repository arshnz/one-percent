import SwiftUI
import SwiftData

/// Placeholder for the Launchpad (Phase 2). For now it proves the foundation:
/// imported habits, today's schedule, and the compound multiplier — all read
/// from on-device data through the ported logic.
struct TodayView: View {
    @Query(filter: #Predicate<Habit> { $0.archivedAt == nil }, sort: \Habit.createdAt)
    private var habits: [Habit]
    @Query private var allHabits: [Habit]
    @Query private var profiles: [Profile]

    private var tz: String { profiles.first?.timezone ?? TimeZone.current.identifier }

    var body: some View {
        let today = LocalDate.today(tz: tz)
        NavigationStack {
            List {
                Section {
                    LabeledContent("Compound", value: Compound.format(Compound.multiplier(curve(today: today).progressDays)))
                }
                Section("Today") {
                    ForEach(habits) { h in
                        HabitRowView(habit: h, today: today, tz: tz)
                    }
                }
            }
            .navigationTitle("Today")
        }
    }

    private func curve(today: String) -> Compound.Series {
        Compound.progressSeries(allHabits.map { MomentumInputs.curveHabit($0, today: today, tz: tz) })
    }
}

private struct HabitRowView: View {
    let habit: Habit
    let today: String
    let tz: String

    var body: some View {
        let hits = MomentumInputs.hitDates(habit)
        let sched = Schedule(habit)
        let bounds = ScheduleBounds(habit, tz: tz)
        let due = ScheduleResolver.isDue(sched, on: today, hitDates: hits, bounds: bounds)
        let done = hits.contains(today)
        VStack(alignment: .leading, spacing: 4) {
            Text(habit.activePhase?.targetText ?? habit.title).font(.headline)
            HStack {
                if habit.pausedAt != nil {
                    Text("Paused")
                } else if done {
                    Label("Voted today", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                } else if due {
                    Text("Due today")
                } else {
                    Text("Rest day")
                }
                if let p = ScheduleResolver.weekProgress(sched, today: today, hitDates: hits, bounds: bounds) {
                    Text("· \(p.hits)/\(p.quota) this week")
                }
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
    }
}
