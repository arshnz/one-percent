import SwiftUI
import SwiftData

struct RootView: View {
    @Query private var profiles: [Profile]
    @State private var toasts = Toasts()

    var body: some View {
        Group {
            if profiles.isEmpty {
                ImportView()
            } else {
                MainTabView()
            }
        }
        // The overlay reads Toasts from the environment, so it must sit inside it.
        .toasts()
        .environment(toasts)
        .tint(Theme.ink)
    }
}

/// App-wide navigation: the selected tab and the sheets any screen can open.
@Observable final class AppRouter {
    enum TabKey: Hashable { case today, compass, learn, momentum, body }

    var tab: TabKey = .today
    var architect: ArchitectSeed?
    var showSettings = false
}

struct MainTabView: View {
    @State private var router = AppRouter()

    var body: some View {
        @Bindable var router = router
        TabView(selection: $router.tab) {
            Tab("Today", systemImage: "sun.max", value: AppRouter.TabKey.today) {
                LaunchpadView()
            }
            Tab("Compass", systemImage: "safari", value: AppRouter.TabKey.compass) {
                CompassView()
            }
            Tab("Learn", systemImage: "graduationcap", value: AppRouter.TabKey.learn) {
                LearningView()
            }
            Tab("Momentum", systemImage: "chart.line.uptrend.xyaxis", value: AppRouter.TabKey.momentum) {
                MomentumView(
                    onEditHabit: { router.architect = ArchitectSeed(habit: $0) },
                    onAddHabit: { router.architect = ArchitectSeed() },
                    habitFooter: HabitFooterSlot.factory,
                    measuredExtra: AnyView(WearableSeriesView())
                )
            }
            BodyTabSlot.make()
        }
        .environment(router)
        .sheet(item: $router.architect) { ArchitectView(seed: $0).environment(router) }
        .sheet(isPresented: $router.showSettings) { SettingsView() }
    }
}

/// Where the Body tab plugs in (the Health layer registers it).
enum BodyTabSlot {
    @MainActor static var factory: (() -> AnyView)?

    @MainActor @TabContentBuilder<AppRouter.TabKey> static func make() -> some TabContent<AppRouter.TabKey> {
        if let f = factory {
            Tab("Body", systemImage: "heart.text.square", value: AppRouter.TabKey.body) { f() }
        }
    }
}
