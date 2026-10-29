import SwiftUI

// "What the data says" — a natural-language read of recent check-ins and miss
// reasons, cached on the profile. A port of InsightsCard.tsx; refreshing is
// handed in by the AI layer.
struct InsightsCardView: View {
    let profile: Profile?
    var refreshing = false
    var onRefresh: (() -> Void)?

    var body: some View {
        let items = JSONText.strings(profile?.momentumInsights)
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Label("What the data says", systemImage: "sparkles").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.ink2)
                    Spacer()
                    if let onRefresh {
                        Button(action: onRefresh) {
                            Label(refreshing ? "Reading…" : "Refresh", systemImage: "arrow.clockwise")
                                .font(.system(size: 11, weight: .medium))
                                .symbolEffect(.rotate, isActive: refreshing)
                        }
                        .foregroundStyle(Theme.faint)
                        .disabled(refreshing)
                    }
                }
                ForEach(Array(items.enumerated()), id: \.offset) { _, line in
                    HStack(alignment: .top, spacing: 8) {
                        Circle().fill(Theme.accent).frame(width: 5, height: 5).padding(.top, 7)
                        Text(line).font(.system(size: 14)).foregroundStyle(Theme.ink)
                    }
                }
                if let at = profile?.momentumInsightsAt {
                    Text("Written \(at.formatted(.dateTime.day().month(.abbreviated)))").font(.system(size: 11)).foregroundStyle(Theme.faint)
                }
            }
            .padding(18)
            .card()
        }
    }
}
