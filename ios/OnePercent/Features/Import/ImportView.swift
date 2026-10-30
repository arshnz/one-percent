import SwiftUI
import SwiftData
import UniformTypeIdentifiers

/// First run: bring the web app's data across, or start fresh.
struct ImportView: View {
    @Environment(\.modelContext) private var ctx
    @State private var picking = false
    @State private var error: String?
    @State private var summary: Importer.Summary?

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Text("One Percent")
                .font(.largeTitle.bold())
            Text("Bring your habits, history and check-ins across from the web app, or start with a clean slate.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Spacer()
            // A second device lands here before iCloud has delivered anything.
            // The data will arrive on its own — importing again would double it.
            HStack(spacing: 10) {
                ProgressView().controlSize(.small)
                Text("Checking iCloud for your data… if you already use One Percent on another device, it will appear here on its own. Leave this open for a minute.")
                    .font(.system(size: 13)).foregroundStyle(.secondary)
            }
            .padding(14)
            .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
            if let error {
                Text(error).foregroundStyle(.red).multilineTextAlignment(.center)
            }
            Button {
                picking = true
            } label: {
                Text("Import my data").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)

            Button("Start fresh") {
                let p = Profile()
                p.timezone = TimeZone.current.identifier
                ctx.insert(p)
                try? ctx.save()
            }
            .controlSize(.large)
        }
        .padding(24)
        .frame(maxWidth: 520)
        .fileImporter(isPresented: $picking, allowedContentTypes: [.json]) { result in
            do {
                let url = try result.get()
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                summary = try Importer.run(try Data(contentsOf: url), into: ctx)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
