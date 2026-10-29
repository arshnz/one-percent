import SwiftUI
import SwiftData

struct RootView: View {
    @Query private var profiles: [Profile]

    var body: some View {
        if profiles.isEmpty {
            ImportView()
        } else {
            TodayView()
        }
    }
}
