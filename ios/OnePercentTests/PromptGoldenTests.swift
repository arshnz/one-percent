import Foundation
import SwiftData
import Testing
@testable import One_Percent

// The AI prompts against what the web routes actually sent to Gemini,
// captured by the harness's Gemini stand-in (golden.mts, section 3c).

/// Lists the web read in database order compare as sets.
private func normalise(_ text: String) -> String {
    text.components(separatedBy: "\n").map { line -> String in
        for prefix in ["Their active goals: ", "Active goals: ", "Their bigger goals: "] where line.hasPrefix(prefix) {
            let body = String(line.dropFirst(prefix.count).dropLast())
            return prefix + body.components(separatedBy: "; ").sorted().joined(separator: "; ") + "."
        }
        if line.hasPrefix("Habits: ") {
            let body = String(line.dropFirst("Habits: ".count).dropLast())
            return "Habits: " + body.components(separatedBy: ", \"").map { $0.hasPrefix("\"") ? $0 : "\"" + $0 }.sorted().joined(separator: ", ") + "."
        }
        return line
    }.joined(separator: "\n")
}

/// The wearable block belongs to the Body layer's own test.
private func withoutWearable(_ text: String) -> String {
    guard let r = text.range(of: "\n\nWearable data") else { return text }
    let tail = text[r.lowerBound...]
    guard let end = tail.range(of: "\n\"\"\"") else { return String(text[..<r.lowerBound]) }
    return String(text[..<r.lowerBound]) + String(tail[end.lowerBound...])
}

@MainActor
func expectPrompts(_ p: [String: Any], ctx: ModelContext, now: Date, tz: String) throws {
    let habits = try ctx.fetch(FetchDescriptor<Habit>())
    let goals = try ctx.fetch(FetchDescriptor<Goal>())
    let checkIns = try ctx.fetch(FetchDescriptor<CheckIn>())
    let profile = try ctx.fetch(FetchDescriptor<Profile>()).first!
    let pc = profile.personalContext, assessment = profile.assessment

    func same(_ label: String, _ got: String, _ want: Any?) {
        let w = normalise(want as? String ?? "<missing>"), g = normalise(got)
        if g != w {
            let i = Array(zip(g, w)).firstIndex { $0.0 != $0.1 } ?? min(g.count, w.count)
            let at = g.index(g.startIndex, offsetBy: max(0, i - 80))
            let wat = w.index(w.startIndex, offsetBy: max(0, min(i, w.count) - 80))
            Issue.record("\(label) differs at \(i):\nswift: …\(g[at...].prefix(240))\nweb:   …\(w[wat...].prefix(240))")
        }
    }

    same("check-in", Prompts.checkinSystemWithPack(Prompts.checkinPack(habits: habits, goals: goals, now: now, tz: tz)), p["checkin"])
    let rows = try ctx.fetch(FetchDescriptor<BodyDay>())
    let (snaps, links, samples) = BodyAI.inputs(habits, rows: rows, tz: tz)
    let wearable = BodyAI.wearableBlock(habits: snaps, links: links, days: samples, now: now, tz: tz)
    same("insights", Prompts.insightsPrompt(Prompts.insightsPack(habits: habits, checkIns: checkIns, goals: goals, now: now, tz: tz, wearable: wearable)),
         p["insights"])
    same("compass A", Prompts.compassSystem(stage: "reality", personalContext: pc, assessment: assessment), p["compassReality"])
    same("compass B", Prompts.compassSystem(stage: "first-step", personalContext: pc, assessment: assessment), p["compassFirstStep"])
    same("interview build", Prompts.blueprintInterviewSystem(kind: "build", personalContext: pc, assessment: assessment, goalTitle: nil), p["interviewBuild"])
    same("interview break", Prompts.blueprintInterviewSystem(kind: "break", personalContext: pc, assessment: assessment, goalTitle: p["goalTitle"] as? String), p["interviewBreak"])

    let draft = p["draftBreak"] as! [String: Any]
    let draftMessages = [("model", "Hello."), ("user", "Ready."), ("model", "Why?"), ("user", "Sleep.")].map { ChatMessage(role: $0.0, text: $0.1) }
    same("draft system", Prompts.blueprintDraftSystem(kind: "break"), draft["system"])
    same("draft prompt", Prompts.blueprintDraftPrompt(draftMessages, personalContext: pc, assessment: assessment), draft["prompt"])

    let context = Prompts.userContext(habits: habits, goals: goals, checkIns: checkIns, personalContext: pc, now: now, tz: tz)
    same("coach", Prompts.coachSystem(userContext: context, passages: ""), p["coach"])

    let summary = p["summary"] as! [String: Any]
    let summaryMessages = [("model", "Hello."), ("user", "Ready."), ("model", "How was it?"), ("user", "Good.")].map { ChatMessage(role: $0.0, text: $0.1) }
    same("summary system", Prompts.checkinSummarySystem, summary["system"])
    same("summary prompt", Prompts.transcript(summaryMessages, model: "COMPANION"), summary["prompt"])
}
