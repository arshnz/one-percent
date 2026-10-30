import SwiftUI
import UserNotifications
import SwiftData
import UniformTypeIdentifiers

// Settings — a port of client/src/pages/Settings.tsx, reshaped for a phone
// with no server: your profile and AI context, reminders, Apple Health (the
// Body layer adds it), and your data — backup, restore, erase.
struct SettingsView: View {
    @Environment(\.modelContext) private var ctx
    @Environment(\.dismiss) private var dismiss
    @Environment(Toasts.self) private var toasts
    @Query private var profiles: [Profile]
    @Query private var habits: [Habit]
    @Query private var checkIns: [CheckIn]

    @State private var name = ""
    @State private var personalContext = ""
    @State private var timezone = TimeZone.current.identifier
    @State private var remindersOn = true
    @State private var backup: BackupFile?
    @State private var importing = false
    @State private var confirmErase = false
    @State private var notificationStatus: UNAuthorizationStatus = .notDetermined
    @State private var habitRemindersOn = true
    @State private var digestOn = true
    @State private var digestAt = Date()
    @State private var checkInOn = true
    @State private var checkInAt = Date()
    @State private var nextReminder: (title: String, at: Date)?

    private var profile: Profile? { profiles.first }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Your name", text: $name)
                    Picker("Time zone", selection: $timezone) {
                        ForEach(Self.zones(including: timezone), id: \.self) { Text($0).tag($0) }
                    }
                } header: {
                    Text("Profile")
                } footer: {
                    Text("Days roll over at midnight in this time zone.")
                }

                #if os(iOS)
                Section {
                    Toggle("Notifications", isOn: $remindersOn).tint(Theme.accent)
                    if notificationStatus == .denied {
                        Button("Notifications are off for One Percent — open Settings") {
                            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                        }
                        .font(.system(size: 13))
                    }
                    if remindersOn && notificationStatus != .denied {
                        Toggle("Morning digest", isOn: $digestOn).tint(Theme.accent)
                        if digestOn {
                            DatePicker("Digest at", selection: $digestAt, displayedComponents: .hourAndMinute)
                        }
                        Toggle("Habit reminders", isOn: $habitRemindersOn).tint(Theme.accent)
                        Toggle("Weekly check-in", isOn: $checkInOn).tint(Theme.accent)
                        if checkInOn {
                            DatePicker("Check-in at", selection: $checkInAt, displayedComponents: .hourAndMinute)
                        }
                        if let n = nextReminder {
                            LabeledContent("Next") {
                                VStack(alignment: .trailing, spacing: 2) {
                                    Text(n.at.formatted(.dateTime.weekday(.abbreviated).hour().minute()))
                                    Text(n.title).font(.system(size: 11)).foregroundStyle(Theme.faint).lineLimit(1)
                                }
                            }
                        } else {
                            LabeledContent("Next", value: "Nothing this week")
                        }
                    }
                } header: {
                    Text("Notifications")
                } footer: {
                    Text("The digest lists today's intentions in one notification. Each habit nudges you at its own reminder time, set in the Architect — weekly habits stay quiet while you have slack. The check-in nudge arrives on Sundays.")
                }
                #else
                Section {
                    Text("Reminders come from your iPhone, so nothing arrives twice. Their times and switches are set there, in Settings.")
                        .font(.system(size: 13)).foregroundStyle(Theme.ink2)
                } header: {
                    Text("Notifications")
                }
                #endif

                HealthSettingsSlot.make()

                Section {
                    TextField("e.g. I’m a dad of two, working long hours. I want to model good habits for my kids…", text: $personalContext, axis: .vertical)
                        .lineLimit(5...)
                        .onChange(of: personalContext) { if personalContext.count > 2000 { personalContext = String(personalContext.prefix(2000)) } }
                    Text("\(personalContext.count) / 2000").font(.system(size: 11)).foregroundStyle(Theme.faint)
                } header: {
                    Text("AI personal context")
                } footer: {
                    Text("Tell the coach about yourself — your values, life situation, what motivates you. It shapes every AI answer and every prompt you hand off.")
                }

                Section {
                    Button("Back up my data", systemImage: "square.and.arrow.up") { makeBackup() }
                    Button("Restore from a backup", systemImage: "square.and.arrow.down") { importing = true }
                    Button("Erase all data", systemImage: "trash", role: .destructive) { confirmErase = true }
                } header: {
                    Text("Your data")
                } footer: {
                    Text("Your data lives on your devices and in your own iCloud, which keeps the iPhone and Mac in step — there is no server. A backup is one file you can keep anywhere; it restores exactly like your original import.")
                }

                Section {
                    LabeledContent("Habits", value: "\(habits.filter { $0.archivedAt == nil }.count) live, \(habits.filter { $0.archivedAt != nil }.count) archived")
                    LabeledContent("Votes cast", value: "\(habits.flatMap { $0.logs ?? [] }.filter(\.isSuccess).count)")
                    LabeledContent("Check-ins", value: "\(checkIns.count)")
                } header: {
                    Text("At a glance")
                }
            }
            .navigationTitle("Settings")
            .inlineTitle()
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { save(); dismiss() } }
            }
        }
        .onAppear {
            guard let p = profile else { return }
            name = p.name ?? ""
            personalContext = p.personalContext ?? ""
            timezone = p.timezone
            remindersOn = p.remindersEnabled
            habitRemindersOn = p.habitRemindersEnabled
            digestOn = p.digestEnabled
            digestAt = Self.time(from: p.digestTime, fallback: Reminders.digestHour)
            checkInOn = p.checkInNudgeEnabled
            checkInAt = Self.time(from: p.checkInTime, fallback: Reminders.checkInHour)
            Task {
                notificationStatus = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
                nextReminder = await Reminders.next()
            }
        }
        .sheet(item: $backup) { file in ShareSheet(items: [file.url]) }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { restore($0) }
        .confirmationDialog("Erase everything, on every device?", isPresented: $confirmErase, titleVisibility: .visible) {
            Button("Erase all data", role: .destructive) { erase() }
        } message: {
            Text("Habits, history, check-ins, coach chats — all of it, on your iPhone and Mac alike, because they share one copy in iCloud. Back up first if you might want it back. This can’t be undone.")
        }
    }

    /// "06:00" → a Date today at 06:00, for the picker. The date part is
    /// never used; only the hour and minute are read back out.
    static func time(from hhmm: String, fallback hour: Int) -> Date {
        let mins = LocalDate.parseHHMM(hhmm) ?? hour * 60
        return Calendar.current.date(
            bySettingHour: mins / 60, minute: mins % 60, second: 0, of: Date()
        ) ?? Date()
    }

    /// The picker's time back as "HH:MM", which is what the model stores and
    /// what `Reminders.Prefs` parses.
    static func hhmm(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    private func save() {
        guard let p = profile else { return }
        p.name = name.trimmed.nonEmpty
        p.personalContext = personalContext.trimmed.nonEmpty
        let tzChanged = p.timezone != timezone
        p.timezone = timezone
        p.remindersEnabled = remindersOn
        p.habitRemindersEnabled = habitRemindersOn
        p.digestEnabled = digestOn
        p.digestTime = Self.hhmm(digestAt)
        p.checkInNudgeEnabled = checkInOn
        p.checkInTime = Self.hhmm(checkInAt)
        try? ctx.save()
        let habits = habits, checkIns = checkIns
        let prefs = Reminders.Prefs(p)
        Task {
            await Reminders.reschedule(
                habits: habits, checkIns: checkIns, tz: timezone, enabled: remindersOn, prefs: prefs
            )
            nextReminder = await Reminders.next()
        }
        if tzChanged { toasts.show("Time zone updated.") }
    }

    private func makeBackup() {
        do {
            let data = try Exporter.run(ctx)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("one-percent-backup-\(LocalDate.today(tz: timezone)).json")
            try data.write(to: url)
            backup = BackupFile(url: url)
        } catch {
            toasts.error("Could not build the backup.")
        }
    }

    private func restore(_ result: Result<URL, Error>) {
        do {
            let url = try result.get()
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let data = try Data(contentsOf: url)
            _ = try WebExport.decode(data)
            try Importer.eraseAll(ctx)
            let s = try Importer.run(data, into: ctx)
            toasts.show("Restored \(s.habits) habits and \(s.logs) votes.")
            dismiss()
        } catch {
            toasts.error((error as? LocalizedError)?.errorDescription ?? "That file couldn’t be restored.")
        }
    }

    private func erase() {
        do {
            try Importer.eraseAll(ctx)
            UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
            dismiss()
        } catch { toasts.error("Could not erase.") }
    }

    static func zones(including current: String) -> [String] {
        var z = Set(["Pacific/Auckland", "Australia/Sydney", "Asia/Kolkata", "Europe/London", "America/New_York", "America/Los_Angeles", "UTC"])
        z.insert(current)
        z.insert(TimeZone.current.identifier)
        return z.sorted()
    }
}

struct BackupFile: Identifiable {
    let url: URL
    var id: URL { url }
}

/// Where the Apple Health card plugs in (the Body layer registers it).
enum HealthSettingsSlot {
    @MainActor static var factory: (() -> AnyView)?

    @MainActor @ViewBuilder static func make() -> some View {
        if let f = factory { f() }
    }
}
