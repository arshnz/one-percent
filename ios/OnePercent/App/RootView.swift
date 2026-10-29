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

struct MainTabView: View {
    var body: some View {
        TabView {
            Tab("Today", systemImage: "sun.max") {
                LaunchpadView()
            }
        }
    }
}
