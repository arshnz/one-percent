import Foundation
import FoundationModels

// The AI behind the coach, the interviews, the check-in companion and the
// insights. No API keys and no bill: Apple's Private Cloud Compute model when
// this device has it (iOS 27+, larger and much stronger), otherwise the
// on-device model. When neither is available, every AI surface still offers a
// hand-off: the full prompt, ready for Claude or any other assistant.
enum AIEngine {
    enum Status: Equatable {
        case cloud
        case device
        case unavailable(String)

        var isAvailable: Bool { if case .unavailable = self { return false } else { return true } }

        var label: String {
            switch self {
            case .cloud: "Apple Private Cloud Compute"
            case .device: "Apple Intelligence, on this iPhone"
            case .unavailable(let why): why
            }
        }
    }

    enum AIError: LocalizedError {
        case unavailable(String), refused, tooLong, failed(String)

        var errorDescription: String? {
            switch self {
            case .unavailable(let why): why
            case .refused: "The model declined that one. Try rephrasing — or hand it off to another AI."
            case .tooLong: "That conversation got too long for the model. Start a fresh one, or hand it off."
            case .failed(let s): s
            }
        }
    }

    /// Private Cloud Compute needs Apple's managed entitlement
    /// (com.apple.developer.private-cloud-compute, requested on the developer
    /// site). Without it the model still reports itself available and then
    /// traps on first use — so it's opt-in via Info.plist (OPUsePrivateCloudCompute)
    /// once the entitlement is granted and added to the target.
    static let cloudEnabled = Bundle.main.object(forInfoDictionaryKey: "OPUsePrivateCloudCompute") as? Bool ?? false

    @available(iOS 27.0, macOS 27.0, *)
    private static var cloudModel: PrivateCloudComputeLanguageModel? {
        guard cloudEnabled else { return nil }
        let m = PrivateCloudComputeLanguageModel()
        return m.isAvailable ? m : nil
    }

    static var status: Status {
        #if targetEnvironment(simulator)
        // Apple's models refuse to run in the Simulator; say so rather than
        // failing on the first message.
        return .unavailable("Apple Intelligence doesn’t run in the Simulator — try it on your iPhone, or hand prompts off to another AI.")
        #else
        if #available(iOS 27.0, macOS 27.0, *), cloudModel != nil { return .cloud }
        switch SystemLanguageModel.default.availability {
        case .available: return .device
        case .unavailable(.deviceNotEligible): return .unavailable("This device doesn’t support Apple Intelligence. You can still hand prompts off to another AI.")
        case .unavailable(.appleIntelligenceNotEnabled): return .unavailable("Turn on Apple Intelligence in Settings to use the coach here — or hand prompts off to another AI.")
        case .unavailable(.modelNotReady): return .unavailable("Apple Intelligence is still getting ready on this device. Try again shortly.")
        case .unavailable: return .unavailable("Apple Intelligence isn’t available right now.")
        }
        #endif
    }

    /// Roughly how many characters of prompt the active model can take, leaving
    /// room for its reply. The on-device model's window is small (~4k tokens),
    /// so long data packs get trimmed for it.
    static var promptBudget: Int {
        switch status {
        case .cloud: 60_000
        default: 7_000
        }
    }

    static func session(instructions: String) -> LanguageModelSession {
        if #available(iOS 27.0, macOS 27.0, *), let pcc = cloudModel {
            return LanguageModelSession(model: pcc, instructions: instructions)
        }
        return LanguageModelSession(instructions: instructions)
    }

    /// Keep text within a character budget, cutting at a line break if it can.
    static func clip(_ s: String, to max: Int) -> String {
        guard s.count > max else { return s }
        let cut = String(s.prefix(max))
        if let nl = cut.lastIndex(of: "\n"), cut.distance(from: cut.startIndex, to: nl) > max / 2 { return String(cut[..<nl]) + "\n…" }
        return cut + "…"
    }

    /// A multi-turn chat as one prompt: the conversation so far, then the
    /// latest message to answer. Old turns drop first when space runs short.
    static func chatPrompt(_ messages: [ChatMessage], modelName: String, budget: Int) -> String {
        guard let last = messages.last else { return "" }
        var earlier = Array(messages.dropLast())
        // The UI's opening line from the model isn't something the user said.
        while earlier.first?.role == "model" && earlier.count > 1 && !earlier.contains(where: { $0.role == "user" }) { earlier.removeFirst() }
        func render(_ ms: [ChatMessage]) -> String {
            ms.map { "\($0.role == "user" ? "USER" : modelName.uppercased()): \($0.text)" }.joined(separator: "\n\n")
        }
        var history = render(earlier)
        while history.count + last.text.count > budget && !earlier.isEmpty {
            earlier.removeFirst()
            history = render(earlier)
        }
        let tail = "Reply to the user's latest message as the \(modelName), following your instructions.\n\nUSER: \(last.text)"
        return history.isEmpty ? tail : "The conversation so far:\n\n\(history)\n\n\(tail)"
    }

    static func describe(_ error: Error) -> AIError {
        if let e = error as? AIError { return e }
        if let e = error as? LanguageModelSession.GenerationError {
            switch e {
            case .exceededContextWindowSize: return .tooLong
            case .guardrailViolation, .refusal: return .refused
            default: return .failed("The AI couldn’t answer just now. Try again, or hand it off.")
            }
        }
        // Framework-internal failures (guardrail backends, model assets) carry
        // messages meant for engineers, not people.
        return .failed("The AI couldn’t answer just now. Try again, or hand it off.")
    }

    /// Stream a reply; each element is the whole reply so far.
    static func stream(system: String, prompt: String) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                guard status.isAvailable else {
                    if case .unavailable(let why) = status { continuation.finish(throwing: AIError.unavailable(why)) }
                    return
                }
                do {
                    let s = session(instructions: system)
                    for try await snapshot in s.streamResponse(to: prompt) {
                        continuation.yield(snapshot.content)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: describe(error))
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    static func respond(system: String, prompt: String) async throws -> String {
        guard status.isAvailable else { if case .unavailable(let why) = status { throw AIError.unavailable(why) }; throw AIError.refused }
        do {
            return try await session(instructions: system).respond(to: prompt).content
        } catch { throw describe(error) }
    }

    static func generate<T: Generable>(_ type: T.Type, system: String, prompt: String) async throws -> T {
        guard status.isAvailable else { if case .unavailable(let why) = status { throw AIError.unavailable(why) }; throw AIError.refused }
        do {
            return try await session(instructions: system).respond(to: prompt, generating: T.self).content
        } catch { throw describe(error) }
    }
}

// MARK: - Structured outputs

@Generable
struct BlueprintOut {
    @Guide(description: "present tense identity, e.g. I am someone who…")
    var identityStatement: String
    @Guide(description: "one emotionally resonant sentence in the user's voice")
    var why: String
    @Guide(description: "habit_stack, time or location", .anyOf(["habit_stack", "time", "location"]))
    var cueType: String
    var anchorRoutine: String
    @Guide(description: "24-hour HH:MM, only when cueType is time, else empty")
    var cueTime: String
    var cueLocation: String
    var failSafeAction: String
    var celebration: String
    var temptationBundle: String
    var nightstandRule: String
    @Guide(description: "abstain or taper — only for a habit being broken; empty for one being built")
    var breakMode: String
    var avoidTrigger: String
    var replacementAction: String
    var frictionDevice: String
    @Guide(description: "2 to 4 steps, easiest first", .count(2...4))
    var phases: [BlueprintPhase]
}

@Generable
struct BlueprintPhase {
    @Guide(description: "must include a number and unit, e.g. Walk 15 mins")
    var targetText: String
    var definitionOfDone: String
    @Guide(description: "reps before the automaticity check, typically 14 to 30", .range(1...365))
    var targetCount: Int
    @Guide(description: "taper habits only: the daily cap; 0 otherwise", .range(0...1000))
    var dailyLimit: Int
}

extension BlueprintOut {
    /// Into the Architect form.
    @MainActor func draft(kind: String, base: HabitDraft = HabitDraft()) -> HabitDraft {
        var d = base
        d.kind = kind
        if kind == "break" { d.breakMode = breakMode == "taper" ? "taper" : "abstain" }
        d.avoidTrigger = avoidTrigger
        d.replacementAction = replacementAction
        d.frictionDevice = frictionDevice
        d.title = identityStatement.nonEmpty ?? d.title
        d.whyText = why.nonEmpty ?? d.whyText
        d.cueType = ["habit_stack", "time", "location"].contains(cueType) ? cueType : "habit_stack"
        d.anchorRoutine = anchorRoutine
        d.cueTime = cueTime
        d.cueLocation = cueLocation
        if !cueTime.isEmpty { d.reminderTime = cueTime }
        d.failSafeAction = failSafeAction
        d.celebration = celebration
        d.temptationBundle = temptationBundle
        d.nightstandRule = nightstandRule
        if let first = phases.first {
            d.targetText = first.targetText
            d.definitionOfDone = first.definitionOfDone
            d.targetCount = max(1, first.targetCount)
            d.dailyLimit = first.dailyLimit
        }
        d.extraPhases = phases.dropFirst().prefix(5).map {
            LadderStep(targetText: $0.targetText, definitionOfDone: $0.definitionOfDone, targetCount: max(1, $0.targetCount), dailyLimit: $0.dailyLimit)
        }
        return d
    }
}

@Generable
struct CompassExtract {
    var assessment: ExtractAssessment
    @Guide(description: "the 2 to 4 goals the user landed on")
    var goals: [ExtractGoal]
}

@Generable
struct ExtractAssessment {
    @Guide(description: "content scores 1 to 5 for the personal and professional domains, if discussed")
    var contentment: [ExtractScore]
    var priorities: [String]
    var highQualityHours: String
    var pastStickyHabits: [ExtractSticky]
    var obstacles: [String]
}

@Generable
struct ExtractScore {
    @Guide(description: "personal or professional")
    var domain: String
    @Guide(.range(1...5))
    var score: Int
}

@Generable
struct ExtractSticky {
    var habit: String
    var whyItStuck: String
}

@Generable
struct ExtractGoal {
    var title: String
    @Guide(.anyOf(["health", "career", "relationships", "money", "mind"]))
    var domain: String
    var whyText: String
    var timeframe: String
}

@Generable
struct InsightsOut {
    @Guide(description: "3 to 5 insights, 1 to 2 sentences each, no markdown", .count(3...5))
    var insights: [String]
}
