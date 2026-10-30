import SwiftUI

// "What the data says" — a natural-language read of recent check-ins and miss
// reasons, cached on the profile. A port of InsightsCard.tsx; refreshing is
// handed in by the AI layer.
struct InsightsCardView: View {
    let profile: Profile?

    @Environment(\.modelContext) private var ctx
    @Environment(Toasts.self) private var toasts
    @State private var refreshing = false
    @State private var handOff: HandOff?

    private func refresh() {
        refreshing = true
        Task {
            do {
                try await Insights.regenerate(ctx)
                toasts.show("Insights refreshed")
            } catch {
                toasts.error((error as? LocalizedError)?.errorDescription ?? "Couldn’t refresh insights")
            }
            refreshing = false
        }
    }

    var body: some View {
        let items = JSONText.strings(profile?.momentumInsights)
        if items.isEmpty {
            // No cached read yet: offer to write the first one.
            HStack {
                Label("What the data says", systemImage: "sparkles").font(.ui(13, weight: .semibold)).foregroundStyle(Theme.ink2)
                Spacer()
                Button(refreshing ? "Reading…" : "Read my data") { refresh() }.font(.ui(13, weight: .medium)).disabled(refreshing || !AIEngine.status.isAvailable)
                Button { if let p = profile { handOff = Insights.handOff(ctx, tz: p.timezone) } } label: { Image(systemName: "arrow.up.forward.app") }
            }
            .padding(16).card()
            .sheet(item: $handOff) { h in HandOffSheet(handOff: h) { save($0) } }
        } else {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Label("What the data says", systemImage: "sparkles").font(.ui(13, weight: .semibold)).foregroundStyle(Theme.ink2)
                    Spacer()
                    Menu {
                        Button("Refresh with Apple Intelligence", systemImage: "arrow.clockwise") { refresh() }.disabled(!AIEngine.status.isAvailable)
                        Button("Hand off to another AI", systemImage: "arrow.up.forward.app") { if let p = profile { handOff = Insights.handOff(ctx, tz: p.timezone) } }
                    } label: {
                        Group {
                            Label(refreshing ? "Reading…" : "Refresh", systemImage: "arrow.clockwise")
                                .font(.ui(11, weight: .medium))
                                .symbolEffect(.rotate, isActive: refreshing)
                        }
                    }
                    .foregroundStyle(Theme.faint)
                    .disabled(refreshing)
                }
                ForEach(Array(items.enumerated()), id: \.offset) { _, line in
                    HStack(alignment: .top, spacing: 8) {
                        Circle().fill(Theme.accent).frame(width: 5, height: 5).padding(.top, 7)
                        Text(line).font(.ui(14)).foregroundStyle(Theme.ink)
                    }
                }
                if let at = profile?.momentumInsightsAt {
                    Text("Written \(at.formatted(.dateTime.day().month(.abbreviated)))").font(.ui(11)).foregroundStyle(Theme.faint)
                }
            }
            .padding(18)
            .card()
            .sheet(item: $handOff) { h in HandOffSheet(handOff: h) { save($0) } }
        }
    }

    /// Insights pasted back from another AI, one per line.
    private func save(_ text: String) {
        let lines = text.split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "-•*0123456789. ").union(.whitespaces)) }
            .filter { !$0.isEmpty }
        guard let p = profile, !lines.isEmpty else { return }
        p.momentumInsights = JSONText.encode(Array(lines.prefix(5)))
        p.momentumInsightsAt = Date()
        try? ctx.save()
    }
}
