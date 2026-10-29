import SwiftUI
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

                Section {
                    Toggle("Habit reminders", isOn: $remindersOn).tint(Theme.accent)
                    if notificationStatus == .denied {
                        Button("Notifications are off for One Percent — open Settings") {
                            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                        }
                        .font(.system(size: 13))
                    }
                    if remindersOn && notificationStatus != .denied {
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
                    Text("Reminders")
                } footer: {
                    Text("Each habit nudges you at its own reminder time, set in the Architect. Weekly habits stay quiet while you have slack. The weekly check-in nudge arrives Sunday at 5pm.")
                }

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
                    Text("Everything lives on this phone. A backup is one file you can keep in iCloud Drive or AirDrop to a new phone — it restores exactly like your original import.")
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
            .navigationBarTitleDisplayMode(.inline)
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
            Task {
                notificationStatus = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
                nextReminder = await Reminders.next()
            }
        }
        .sheet(item: $backup) { file in ShareSheet(items: [file.url]) }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { restore($0) }
        .confirmationDialog("Erase everything on this phone?", isPresented: $confirmErase, titleVisibility: .visible) {
            Button("Erase all data", role: .destructive) { erase() }
        } message: {
            Text("Habits, history, check-ins, coach chats — all of it. Back up first if you might want it back. This can’t be undone.")
        }
    }

    private func save() {
        guard let p = profile else { return }
        p.name = name.trimmed.nonEmpty
        p.personalContext = personalContext.trimmed.nonEmpty
        let tzChanged = p.timezone != timezone
        p.timezone = timezone
        p.remindersEnabled = remindersOn
        try? ctx.save()
        let habits = habits, checkIns = checkIns
        Task { await Reminders.reschedule(habits: habits, checkIns: checkIns, tz: timezone, enabled: remindersOn) }
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

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

/// Where the Apple Health card plugs in (the Body layer registers it).
enum HealthSettingsSlot {
    @MainActor static var factory: (() -> AnyView)?

    @MainActor @ViewBuilder static func make() -> some View {
        if let f = factory { f() }
    }
}
