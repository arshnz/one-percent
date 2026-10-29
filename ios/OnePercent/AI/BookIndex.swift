import Foundation
import NaturalLanguage
import SwiftData

// Retrieval for the Habit Coach: the book passages most relevant to a question.
// The web app embedded with Gemini and searched in pgvector; here the passages
// are embedded on-device with Apple's sentence embeddings, once, in the
// background, and searched by cosine similarity — 241 passages is small enough
// to scan. Everything here runs off the main thread on its own context.
enum BookIndex {
    nonisolated private static func vector(_ text: String) -> [Double]? {
        // Sentence embeddings work best on a passage's opening stretch.
        NLEmbedding.sentenceEmbedding(for: .english)?.vector(for: String(text.prefix(1500)))
    }

    nonisolated private static func encode(_ v: [Double]) -> Data {
        v.map { Float($0) }.withUnsafeBufferPointer { Data(buffer: $0) }
    }

    nonisolated private static func decode(_ d: Data) -> [Float] {
        d.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
    }

    /// Embed any passages without a vector yet. Called at launch; cheap once done.
    nonisolated static func warm(_ container: ModelContainer) {
        Task.detached(priority: .utility) {
            let ctx = ModelContext(container)
            guard let chunks = try? ctx.fetch(FetchDescriptor<BookChunk>(predicate: #Predicate { $0.embedding == nil })), !chunks.isEmpty else { return }
            for c in chunks { if let v = vector(c.content) { c.embedding = encode(v) } }
            try? ctx.save()
        }
    }

    /// The top `k` passages for a query, formatted as the coach expects, within
    /// a character budget. Passages not yet embedded are skipped.
    nonisolated static func passages(for query: String, k: Int, budget: Int, container: ModelContainer) async -> String {
        await Task.detached(priority: .userInitiated) {
            let ctx = ModelContext(container)
            guard let q = vector(query), let chunks = try? ctx.fetch(FetchDescriptor<BookChunk>()), !chunks.isEmpty else { return "" }
            let qn = sqrt(q.reduce(0) { $0 + $1 * $1 })
            let scored = chunks.compactMap { c -> (Double, String)? in
                guard let e = c.embedding else { return nil }
                let v = decode(e)
                guard v.count == q.count else { return nil }
                var dot = 0.0, vn = 0.0
                for i in 0..<v.count { dot += Double(v[i]) * q[i]; vn += Double(v[i]) * Double(v[i]) }
                return (dot / (sqrt(vn) * qn + 1e-9), c.content)
            }
            .sorted { $0.0 > $1.0 }
            .prefix(k)
            let per = max(400, budget / max(1, k))
            return scored.enumerated()
                .map { i, s in "[Passage \(i + 1)]\n\(clip(s.1, to: per))" }
                .joined(separator: "\n\n")
        }.value
    }

    nonisolated private static func clip(_ s: String, to max: Int) -> String {
        s.count > max ? String(s.prefix(max)) + "…" : s
    }
}
