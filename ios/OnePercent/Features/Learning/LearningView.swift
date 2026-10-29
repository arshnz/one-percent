import SwiftUI

// Learning — the coach and the theory, side by side as on the web.
struct LearningView: View {
    enum Page: String { case coach, theory }
    @State private var page: Page = .coach

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Picker("Learning", selection: $page) {
                        Text("Habit Coach").tag(Page.coach)
                        Text("Theory").tag(Page.theory)
                    }
                    .pickerStyle(.segmented)
                    .padding(.top, 12)
                    switch page {
                    case .coach: CoachSlot.make()
                    case .theory: TheoryView()
                    }
                }
                .padding(16)
                .padding(.bottom, 32)
            }
            .background(Theme.bg)
            .toolbar(.hidden, for: .navigationBar)
        }
    }
}

/// Where the AI habit coach plugs in.
enum CoachSlot {
    @MainActor static var factory: (() -> AnyView)?

    @MainActor @ViewBuilder static func make() -> some View {
        if let f = factory {
            f()
        } else {
            Text("The habit coach arrives with the on-device AI.").font(.system(size: 14)).foregroundStyle(Theme.faint)
        }
    }
}
