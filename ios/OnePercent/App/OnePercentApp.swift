import SwiftUI
import SwiftData

@main
struct OnePercentApp: App {
    let container: ModelContainer

    init() {
        // CloudKit sync switches on once the app is signed with a team and has
        // an iCloud container; the models are already CloudKit-shaped, so that
        // is a configuration change, not a migration.
        let config = ModelConfiguration(schema: Schema(AppSchema.models), cloudKitDatabase: .none)
        do {
            container = try ModelContainer(for: Schema(AppSchema.models), configurations: config)
        } catch {
            fatalError("Couldn't open the store: \(error)")
        }
        DevImport.runIfRequested(into: container.mainContext)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
        }
        .modelContainer(container)
    }
}

/// Simulator convenience: `-importPath /abs/path/to/export.json` imports on
/// launch, so testing against real data doesn't mean clicking through the Files
/// picker every time. Debug builds only.
enum DevImport {
    static func runIfRequested(into ctx: ModelContext) {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-importPath"), i + 1 < args.count else { return }
        do {
            if args.contains("-eraseFirst") { try Importer.eraseAll(ctx) }
            guard try !Importer.hasData(ctx) else { return }
            let summary = try Importer.run(try Data(contentsOf: URL(fileURLWithPath: args[i + 1])), into: ctx)
            print("DevImport:", summary)
        } catch {
            print("DevImport failed:", error)
        }
        #endif
    }
}
