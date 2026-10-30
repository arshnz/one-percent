import SwiftUI
import SwiftData

@main
struct OnePercentApp: App {
    let container: ModelContainer
    /// App-wide so the Mac's menu bar can drive it as well as the views.
    @State private var router = AppRouter()

    init() {
        // Synced through iCloud — see CloudSync.
        container = CloudSync.makeContainer()
        DevImport.runIfRequested(into: container.mainContext)
        ModelContextHolder.main = container.mainContext
        AIFeatures.register()
        BodyFeatures.register()
        BookIndex.warm(container)
        CloudSync.watch(container)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(router)
                #if os(macOS)
                .frame(minWidth: 820, minHeight: 600)
                #endif
        }
        .modelContainer(container)
        #if os(macOS)
        .defaultSize(width: 1180, height: 820)
        .commands { MacCommands(router: router) }
        #endif
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
            // Relative paths resolve against Documents — how a file copied onto
            // a device with `devicectl device copy to` is found.
            let raw = args[i + 1]
            let url = raw.hasPrefix("/") ? URL(fileURLWithPath: raw)
                : URL.documentsDirectory.appendingPathComponent(raw)
            let summary = try Importer.run(try Data(contentsOf: url), into: ctx)
            print("DevImport:", summary)
        } catch {
            print("DevImport failed:", error)
        }
        #endif
    }
}
