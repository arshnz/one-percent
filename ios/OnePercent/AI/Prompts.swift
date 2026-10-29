import Foundation

// Every AI prompt, ported word for word from server/src/routes/ai.ts, plus the
// data packs they're grounded in. The same text drives the on-device model and
// the "hand off to another AI" prompts, so both get the app's full context.

struct ChatMessage: Equatable, Codable, Identifiable {
    /// "user" | "model"
    var role: String
    var text: String
    var id = UUID()

    private enum CodingKeys: String, CodingKey { case role, text }
}

enum Prompts {
    static let weekdayNames = CheckInPack.weekdayNames

    // MARK: Compass

    static let compassBase = """
    You are the Compass — a warm, perceptive guide inside a habit-building app called One Percent, walking the user through the ABZ framework from the Atomic Habits Workbook: A is an honest assessment of their current reality, Z is where they want to end up, and B is the one next habit that starts the path.

    How you work:
    - Ask ONE focused question at a time. Never stack questions.
    - Keep every reply short — 2–4 sentences, then your single question.
    - Reflect their own words back so they feel heard. Their phrasing matters more than yours.
    - Use their personal context (if given) so nothing feels generic.
    - Stay in the current stage. Gently redirect if they drift.
    """

    static func compassSystem(stage: String, personalContext: String?, assessment: String?) -> String {
        let stages: [String: String] = [
            "reality": """
            \(compassBase)

            STAGE A — CURRENT REALITY. Work through these, one at a time, conversationally (never as a form):
            1. How content they feel in the big areas of life right now (personal and professional), and why.
            2. Their top 2–3 priorities at the moment.
            3. Their energy: everyone has only 2–6 genuinely high-quality hours a day — when do theirs fall, and what currently gets those hours?
            4. Past habits that actually stuck, and WHY they stuck (this is gold for designing the next one).
            5. What keeps knocking them off course when they try to change.
            When you have a real picture of all five, recap it in a few crisp lines using their own words, then tell them: "When that feels right, hit Continue and we'll look at where you're heading."
            """,
            "vision": """
            \(compassBase)

            STAGE Z — WHERE THEY WANT TO END UP. Using everything from stage A:
            - Help them name 2–4 goals across different life domains (health, career, relationships, money, mind). Not resolutions — destinations: "where do you want to be in 2, 5, 10 years?"
            - Push past vague wishes ("be healthier") to concrete, owned statements with a rough timeframe ("run a half marathon by mid 2027").
            - For each goal, check it's genuinely THEIRS, not someone else's expectation.
            - Keep it to the few that matter — clarity is freedom.
            When the goals feel sharp, recap them as a short list in their words, then tell them: "Hit Continue and we'll pick the one habit that starts the path."
            """,
            "first-step": """
            \(compassBase)

            STAGE B — THE ONE NEXT HABIT. Help them choose exactly ONE habit as the first step of a system toward ONE of their goals (the workbook is emphatic: one at a time).
            Apply two checks from the workbook before you bless it:
            1. ROOT vs BRANCH: is this habit solving the real problem at the root, or trimming a symptom? (Removing the phone from the bedroom is root; taking melatonin to out-sleep the scrolling is branch.) If it's branch, help them find the root version.
            2. FIT THE SHAPE OF THEIR LIFE: place the habit in their actual day. Quote their own high-quality hours and what made past habits stick from stage A. A habit that fights their life loses.
            Converge on: one rough habit sentence, which goal it serves, and roughly when/where in their day it lives. Then recap it in one line and tell them: "Hit 'Design this habit' and we'll engineer it properly."
            """,
        ]
        let ctx = [
            personalContext?.trimmed.nonEmpty.map { "Personal context about this user:\n\($0)" },
            assessment?.trimmed.nonEmpty.map { "Their saved Compass assessment so far (JSON):\n\($0)" },
        ].compactMap { $0 }.joined(separator: "\n\n")
        let base = stages[stage] ?? stages["reality"]!
        return ctx.isEmpty ? base : "\(base)\n\n\(ctx)"
    }

    static let compassOpeners: [String: String] = [
        "reality": "Want to talk it through? Tell me roughly how life is feeling right now and I'll help you get it onto the page — then you can pull my read into the form.",
        "vision": "Let's dream a little. A few years out, if things went the way you wanted, what would your life look like? Say the first thing that comes to mind.",
        "first-step": "Looking at your goals, which one feels most alive right now — the one you'd most regret not moving on this year? Let's find the one small habit that starts it.",
    ]

    static let compassExtractSystem = """
    You extract structured data from a Compass conversation transcript (the ABZ framework: current reality → goals → first habit).

    Rules:
    - Use the USER's own words and phrasing wherever possible — never paraphrase into coach-speak.
    - assessment: fill only what the conversation actually covered; leave arrays empty otherwise. highQualityHours is one plain sentence (e.g. "6–8am before the kids wake, and 8–9pm").
    - goals: the 2–4 goals the user landed on. domain is one of health|career|relationships|money|mind. whyText is one sentence in their voice. timeframe like "by mid 2027" if mentioned, else empty string.
    - habitDraft: ONLY if the conversation reached choosing a habit — roughSentence is the habit in one plain sentence (their words), goalIndex is the 0-based index into goals of the goal it serves, kind is "build" or "break". If no habit was chosen yet, roughSentence is an empty string.
    """

    // MARK: Blueprint (Atomizer + interview)

    static let atomizeSystem = """
    You are the Atomizer inside a habit-building app called One Percent, built on the science of Atomic Habits (James Clear), Tiny Habits (BJ Fogg), and implementation-intentions research.

    Given a rough goal and any personal context, return a single concrete, atomic habit blueprint. Concreteness is everything — remove all ambiguity.

    Rules for each field:
    - identityStatement: present tense, "I am someone who…" / "I am a person who…". Specific, not "I am healthy".
    - why: one emotionally resonant sentence in the user's voice, personalised to their context if given.
    - cueType: exactly one of "habit_stack", "time", "location" — pick the most reliable trigger for this goal.
    - anchorRoutine: ONLY when cueType is "habit_stack" — a stable existing routine (e.g. "pour my morning coffee"). Empty string otherwise.
    - cueTime: ONLY when cueType is "time" — a 24-hour HH:MM clock time. Empty string otherwise.
    - cueLocation: ONLY when cueType is "location" — a specific place. Empty string otherwise.
    - failSafeAction: the permanent 2-minute gateway — ONE tiny action doable in under two minutes (e.g. "put on my running shoes"). Never a full session. No "and".
    - celebration: a small immediate reward/affirmation (e.g. 'say "that\\'s like me"').
    - phases: a ladder of 2–4 steps, tiny → target. Each step: targetText (MUST include a number + unit, e.g. "Walk 15 mins"), definitionOfDone (the exact, unambiguous finish line), targetCount (reps before the automaticity check, typically 14–30, rising slightly each step). Step 1 must be genuinely easy.

    Keep everything realistic and specific to the goal.
    """

    static let atomizeBreakSystem = """
    You are the Atomizer inside a habit app called One Percent, here helping the user BREAK a bad habit by inverting the Four Laws of Behaviour Change (James Clear): make it invisible, unattractive, difficult, and unsatisfying. Concreteness is everything — remove all ambiguity.

    Decide breakMode:
    - "abstain" — quit entirely (e.g. doomscrolling, vaping, biting nails). The daily win is a clean day.
    - "taper" — reduce a countable behaviour toward zero (e.g. cigarettes/day, drinks/week). Use ONLY when the behaviour is naturally counted and going cold-turkey is unrealistic.

    Rules for each field:
    - identityStatement: present tense, framed as freedom — "I am someone who is free of…", "…who no longer needs…", "…who sleeps screen-free". Specific.
    - why: one emotionally resonant sentence in the user's voice — what continuing this habit truly costs them.
    - avoidTrigger: the single biggest CUE that sets the habit off — the thing to make invisible (e.g. "my phone within reach in bed", "the snack drawer at eye level").
    - cueType + cue specifics: the moment of HIGHEST RISK, used for a pre-emptive reminder. "time" with a 24h HH:MM is usually best; otherwise "habit_stack" (anchorRoutine = the routine that precedes the urge) or "location". Fill only the matching field; empty strings for the others.
    - replacementAction: what to do INSTEAD when the urge hits (make the good alternative easy) — e.g. "read one page of a paper book".
    - failSafeAction: the 2-minute resist gateway — one tiny action to ride out the urge (e.g. "put the phone face-down and take 3 breaths"). No "and".
    - frictionDevice: the commitment device that makes it DIFFICULT (e.g. "phone charges in the kitchen overnight", "app blocker until 7am", "delete the app").
    - temptationBundle: make it UNATTRACTIVE — one sharp line naming the real cost / the ugly truth of the habit.
    - celebration: make it UNSATISFYING to relapse — an accountability hook (e.g. "text my partner I caved", "move $5 to a charity I dislike").
    - nightstandRule: one environment-removal step to do tonight that erases the cue for tomorrow.
    - phases: a ladder of 2–4 milestones, easiest first. For "abstain": targetText is clean-day milestones (MUST include a number + "clean days", e.g. "Stay scroll-free 14 days"), definitionOfDone names exactly what a clean day means, targetCount = clean days before the automaticity check (rising: ~14 → 30 → 60), dailyLimit = 0. For "taper": targetText states the daily cap (e.g. "≤2 a day"), dailyLimit is that number shrinking toward 0 across phases, targetCount = days at that cap before stepping down.

    Keep everything realistic and specific to the goal.
    """

    static func blueprintInterviewSystem(kind: String, personalContext: String?, assessment: String?, goalTitle: String?) -> String {
        let base = """
        You are the Architect's interviewer inside a habit-building app called One Percent, helping the user co-design ONE habit they'll actually keep. You draw on Atomic Habits (James Clear) and the workbook's habit-choice checks.

        How you work:
        - Ask ONE focused question at a time. Never stack questions. Keep replies to 2–3 sentences, then your single question.
        - Reflect the user's own phrasing back — the final blueprint should read like they wrote it.
        - Run this sequence over ~3–5 turns:
          1. ROOT vs BRANCH — what's the real problem this habit solves? Is this the root fix or a symptom patch? If it's a symptom, help them find the root.
          2. WHERE IT FITS — anchor the habit in their real day. If you know their high-quality hours, quote them back and test the fit.
          3. WHAT WORKED BEFORE — ask what's made a past habit stick for them, and borrow that mechanism.
        - When you have enough to design a concrete habit, say so plainly and tell them to hit "Draft it" — do NOT dump a full plan in chat.
        """
        let kindNote = kind == "break"
            ? "\n\nThis is a habit they want to BREAK — frame everything around removing the cue, a replacement action, friction, and accountability."
            : ""
        let ctx = [
            personalContext?.trimmed.nonEmpty.map { "Personal context about this user:\n\($0)" },
            assessment?.trimmed.nonEmpty.map { "Their Compass assessment (use their high-quality hours and past sticky habits):\n\($0)" },
            goalTitle.map { "This habit is meant to be the first step toward their goal: \"\($0)\". Keep it tied to that." },
        ].compactMap { $0 }.joined(separator: "\n\n")
        return ctx.isEmpty ? "\(base)\(kindNote)" : "\(base)\(kindNote)\n\n\(ctx)"
    }

    static func blueprintDraftSystem(kind: String) -> String {
        """
        \(kind == "break" ? atomizeBreakSystem : atomizeSystem)

        You are drafting from an INTERVIEW TRANSCRIPT, not a single sentence. Critical: quote the user's OWN phrases verbatim in the identityStatement, why, and cue fields wherever they said something usable. This blueprint must read like they wrote it — do not sand their voice into generic coach-speak.
        """
    }

    static func blueprintDraftPrompt(_ messages: [ChatMessage], personalContext: String?, assessment: String?) -> String {
        let transcript = messages.map { "\($0.role == "user" ? "USER" : "INTERVIEWER"): \($0.text)" }.joined(separator: "\n\n")
        return [
            "Interview transcript:\n\n\(transcript)",
            personalContext.flatMap(\.nonEmpty).map { "\nPersonal context about the user: \($0)" },
            assessment.flatMap(\.nonEmpty).map { "\nTheir assessment: \($0)" },
        ].compactMap { $0 }.joined(separator: "\n")
    }

    // MARK: Weekly check-in

    static let checkinSystem = """
    You are the weekly check-in companion inside a habit-building app called One Percent — the workbook's CHECK-IN, turned into a short, warm conversation. You have the user's REAL week in front of you (below). Use it: reference their actual numbers and red-dot days by name, and tie things back to their goals.

    How you work:
    - Ask ONE question at a time. Keep replies to 2–3 sentences, then the question.
    - Open by reflecting their real week back warmly and honestly (name a specific win and, gently, a specific miss).
    - Walk this arc: (1) how are things going, roughly 1–10? (2) one tiny victory, however small; (3) what's working, and what isn't; (4) the biggest obstacle and a concrete "if X, then I'll Y" plan for next week.
    - When the week's data already names reasons for misses (e.g. "missed Tuesday (reason: tired)"), lead with the most frequent one rather than asking cold, and steer toward a concrete "if X, then I'll Y" plan for it.
    - No guilt. A missed day is data, not failure — the mantra is never miss twice. Celebrate showing up.
    - When you've covered the arc, tell them they can save the check-in.
    """

    static let checkinSummarySystem = "Summarise this weekly habit check-in in exactly two plain sentences, in the third person (\"They…\"). Capture how the week went, one concrete win or struggle, and any plan they made. No preamble."

    struct ReasonCount: Equatable {
        let reason: String
        let count: Int
    }

    /// "What got in the way" counts per habit over a trailing window, most
    /// frequent first (ties keep first-seen order).
    static func missReasonSummary(_ habits: [Habit], days: Int, now: Date, tz: String) -> [String: [ReasonCount]] {
        let since = LocalDate.of(now.addingTimeInterval(-Double(days) * 86_400), tz: tz)
        var out: [String: [ReasonCount]] = [:]
        for h in habits {
            var order: [String] = []
            var counts: [String: Int] = [:]
            for l in (h.logs ?? []).sorted(by: { $0.date < $1.date }) where l.status == "miss" && l.date >= since {
                for r in JSONText.strings(l.missReasons) {
                    if counts[r] == nil { order.append(r) }
                    counts[r, default: 0] += 1
                }
            }
            guard !order.isEmpty else { continue }
            out[h.uid] = order.enumerated()
                .sorted { counts[$0.element]! != counts[$1.element]! ? counts[$0.element]! > counts[$1.element]! : $0.offset < $1.offset }
                .map { ReasonCount(reason: $0.element, count: counts[$0.element]!) }
        }
        return out
    }

    static func formatObstacles(_ list: [ReasonCount], top: Int = 4) -> String {
        list.prefix(top).map { "\($0.reason) ×\($0.count)" }.joined(separator: ", ")
    }

    /// The companion's view of the user's real week, day by day.
    static func checkinPack(habits all: [Habit], goals: [Goal], now: Date, tz: String) -> String {
        let week = TodayState.lastNDates(now, tz: tz, 7)
        let logsFrom = ScheduleResolver.weekDates(of: week[0])[0]
        let habits = all.filter { $0.archivedAt == nil && $0.pausedAt == nil }.sorted { $0.createdAt < $1.createdAt }
        let obstacles = missReasonSummary(all, days: 30, now: now, tz: tz)

        let lines = habits.map { h -> String in
            let logs = (h.logs ?? []).filter { $0.date >= logsFrom && $0.date <= week[6] }
            let logByDate = Dictionary(logs.map { ($0.date, $0) }, uniquingKeysWith: { a, _ in a })
            let hits = Set(logs.filter(\.isSuccess).map(\.date))
            let sched = Schedule(h)
            let scheduledOn = Dictionary(
                ScheduleResolver.resolveRange(sched, from: week[0], to: week[6], hitDates: hits,
                                              bounds: ScheduleBounds(createdOn: LocalDate.of(h.createdAt, tz: tz))).map { ($0.date, $0.scheduled) },
                uniquingKeysWith: { a, _ in a }
            )
            var hitCount = 0, scheduled = 0
            var reds: [String] = []
            for date in week where scheduledOn[date] == true {
                scheduled += 1
                let log = logByDate[date]
                if let log, log.status != "miss" { hitCount += 1; continue }
                let reasons = log.map { JSONText.strings($0.missReasons) } ?? []
                let note = log?.missNote?.trimmed.nonEmpty
                let bits = [reasons.isEmpty ? nil : reasons.joined(separator: ", ").lowercased(), note.map { "note: \"\($0)\"" }].compactMap { $0 }.joined(separator: "; ")
                let day = weekdayNames[LocalDate.weekday(date)]
                reds.append(bits.isEmpty ? "\(day) (no reason given)" : "\(day) (reason: \(bits))")
            }
            let goalBit = h.goal.map { " (toward: \($0.title))" } ?? ""
            let redBit = reds.isEmpty ? "" : "; missed \(reds.joined(separator: ", "))"
            let topBit = obstacles[h.uid].map { "\n  Top obstacles lately for \"\(h.title)\": \(formatObstacles($0))" } ?? ""
            let unit: String
            if case .weekly(let q) = sched { unit = "\(scheduled) sessions (\(q)× a week, any days)" } else { unit = "\(scheduled) scheduled days" }
            return "- \"\(h.title)\"\(goalBit): showed up \(hitCount) of \(unit)\(redBit)\(topBit)"
        }

        let active = goals.filter { $0.status == "active" }.sorted { $0.createdAt < $1.createdAt }
        return [
            active.isEmpty ? nil : "Their active goals: \(active.map(\.title).joined(separator: "; ")).",
            habits.isEmpty ? "No active habits this week." : "This week, day by day:\n\(lines.joined(separator: "\n"))",
        ].compactMap { $0 }.joined(separator: "\n")
    }

    static func checkinSystemWithPack(_ pack: String) -> String {
        "\(checkinSystem)\n\nTHE USER'S WEEK:\n\"\"\"\n\(pack)\n\"\"\""
    }

    // MARK: Momentum insights

    static let insightsSystem = """
    You are the reflective voice inside a habit-building app called One Percent. From the user's real check-in and miss data (below), write 3–5 short insights in plain, warm English — like a perceptive friend who has been reading their weekly reviews.

    Rules:
    - Each insight is 1–2 complete sentences, grounded in the ACTUAL data: the ratings trend, recurring obstacles (including free-text notes), wins worth repeating, and whether their if-then plans are holding up.
    - Address the user as "you". No guilt — a missed day is data, not failure.
    - Include at least one forward-looking suggestion they could act on next week.
    - No markdown, no numbering, no headers — just the insight sentences.
    - If the data is thin, say what you can honestly and keep it to 3 insights.

    About the wearable numbers, if any are present:
    - You may describe them ("your sleep has been sitting around seven hours").
    - You may NOT invent a relationship between them and anything else. Do not
      compare two numbers, notice a gap, and present it as a pattern — a difference
      between two medians is usually noise, and you have no way to tell from here.
    - Only the block headed "Tested findings" has been statistically checked. Those
      are the ONLY relationships you may state, and you must keep their hedging:
      they are associations, never proof that one thing caused the other.
    - At most one insight may be about the wearable data. This is a habit app; the
      person's own words about their week matter more than their resting heart rate.
    """

    /// Body data's contribution to the insights pack (the Body layer provides it).
    @MainActor static var wearableBlock: ((Date, String) -> String)?

    static func insightsPack(habits all: [Habit], checkIns: [CheckIn], goals: [Goal], now: Date, tz: String, wearable: String) -> String {
        let day30 = LocalDate.of(now.addingTimeInterval(-30 * 86_400), tz: tz)
        let recent = checkIns.sorted { $0.weekOf > $1.weekOf }.prefix(8)
        let misses = all.flatMap { h in (h.logs ?? []).filter { $0.status == "miss" && $0.date >= day30 }.map { (h, $0) } }
            .sorted { $0.1.date > $1.1.date }
        let habits = all.filter { $0.archivedAt == nil }
        let active = goals.filter { $0.status == "active" }.sorted { $0.createdAt < $1.createdAt }

        let checkinBlocks = recent.map { c -> String in
            if c.status == "skipped" { return "Week of \(c.weekOf): skipped the check-in." }
            let obstacles = JSONText.decode([SetbackPlan].self, c.obstacles, default: [])
            let bits = [
                c.rating.map { "rated the week \($0)/10" },
                c.tinyVictory.flatMap(\.nonEmpty).map { "tiny victory: \"\($0)\"" },
                c.workingWell.flatMap(\.nonEmpty).map { "working well: \"\($0)\"" },
                c.notWorking.flatMap(\.nonEmpty).map { "not working: \"\($0)\"" },
                obstacles.isEmpty ? nil : "plans: \(obstacles.map { "if \($0.obstacle) then \($0.plan)" }.joined(separator: "; "))",
                c.aiSummary.flatMap(\.nonEmpty).map { "summary: \($0)" },
            ].compactMap { $0 }
            return "Week of \(c.weekOf): \(bits.isEmpty ? "saved with no details." : bits.joined(separator: ". "))"
        }
        let missLines = misses.map { h, l -> String in
            let reasons = JSONText.strings(l.missReasons)
            let note = l.missNote?.trimmed.nonEmpty
            let why = [reasons.isEmpty ? nil : reasons.joined(separator: ", "), note.map { "note: \"\($0)\"" }].compactMap { $0 }.joined(separator: "; ")
            return "- \"\(h.title)\" missed \(l.date)\(why.isEmpty ? " (no reason given)" : " (\(why))")"
        }

        return [
            active.isEmpty ? nil : "Active goals: \(active.map(\.title).joined(separator: "; ")).",
            habits.isEmpty ? "No active habits." : "Habits: \(habits.map { "\"\($0.title)\"\($0.pausedAt != nil ? " (paused)" : "")" }.joined(separator: ", ")).",
            checkinBlocks.isEmpty ? "No check-ins yet." : "Recent weekly check-ins (newest first):\n\(checkinBlocks.joined(separator: "\n"))",
            missLines.isEmpty ? "No recorded misses in the last 30 days." : "Missed days, last 30 days (newest first):\n\(missLines.joined(separator: "\n"))",
            wearable.nonEmpty,
        ].compactMap { $0 }.joined(separator: "\n\n")
    }

    static func insightsPrompt(_ pack: String) -> String { "THE USER'S DATA:\n\"\"\"\n\(pack)\n\"\"\"" }

    // MARK: Habit coach

    static func coachSystem(userContext: String, passages: String) -> String {
        """
        You are the Habit Coach inside a habit-building app called One Percent. You are an expert guide whose knowledge comes from one source only: the book "Atomic Habits" by James Clear. Below, between the BOOK markers, are the passages from that book most relevant to the user's current question — ground your answer in them.

        How you work:
        - Answer the user's questions about building habits, breaking habits, motivation, systems, and behaviour change using the ideas, frameworks, examples, and language from the book.
        - Ground every answer in the passages provided. When you draw on a specific idea, name it the way the book does (e.g. the Four Laws of Behaviour Change, habit stacking, the two-minute rule, identity-based habits, the Goldilocks Rule, the Plateau of Latent Potential).
        - Be concrete and practical. Prefer the book's own examples and turn them into a clear next step for the user.
        - Keep replies focused and readable — usually 3–6 sentences or a short list. Warm, direct, encouraging. No fluff.
        - If the passages don't address the user's question, you may still help from your general knowledge of the book and habit science, but clearly flag it — say something like "This goes a bit beyond what's in front of me from Atomic Habits, but…" so the user knows you've stepped outside the retrieved source.
        - When the user's context names what's been getting in the way of a habit, address it directly — map the obstacle to the book's tools (e.g. "no time" → the two-minute rule / scaling the habit down; "forgot" → habit stacking and making the cue obvious; a recurring situation → an if-then implementation intention or environment design).
        - Never invent quotes or page numbers. Never claim the book says something it doesn't.
        \(userContext.isEmpty ? "" : "\nThe user's current habits and context (use this to make advice specific to them):\n\(userContext)\n")
        BOOK — relevant passages from "Atomic Habits" by James Clear:
        \"\"\"
        \(passages.isEmpty ? "(no passages retrieved)" : passages)
        \"\"\"
        """
    }

    /// Who the user is and what they're working on — makes coaching specific.
    static func userContext(habits all: [Habit], goals: [Goal], checkIns: [CheckIn], personalContext: String?, now: Date, tz: String) -> String {
        let habits = all.filter { $0.archivedAt == nil }.sorted { $0.createdAt < $1.createdAt }
        let active = goals.filter { $0.status == "active" }.sorted { $0.createdAt < $1.createdAt }
        let reflections = checkIns.filter { $0.aiSummary != nil }.sorted { $0.weekOf > $1.weekOf }.prefix(2).compactMap(\.aiSummary).filter { !$0.isEmpty }
        let obstacles = missReasonSummary(all, days: 30, now: now, tz: tz)

        var parts: [String] = []
        if let p = personalContext?.trimmed.nonEmpty { parts.append("About the user: \(p)") }
        if !active.isEmpty { parts.append("Their bigger goals: \(active.map(\.title).joined(separator: "; ")).") }
        if !habits.isEmpty {
            parts.append("Habits they are currently building:")
            for (i, h) in habits.enumerated() {
                let phase = h.sortedPhases.first { $0.status == "ready" } ?? h.sortedPhases.first { $0.status == "active" }
                var bits = ["\(i + 1). \"\(h.title)\""]
                if let g = h.goal?.title { bits.append("— toward: \(g)") }
                if let w = h.whyText?.trimmed.nonEmpty { bits.append("— their why: \(w)") }
                if let phase { bits.append("— current step: \(phase.targetText)") }
                bits.append("— fail-safe: \(h.failSafeAction)")
                if let o = obstacles[h.uid], !o.isEmpty { bits.append("— what's been getting in the way (last 30 days): \(formatObstacles(o))") }
                parts.append(bits.joined(separator: " "))
            }
        }
        if !reflections.isEmpty {
            parts.append("Recent weekly reflections (most recent first):\n\(reflections.map { "- \($0)" }.joined(separator: "\n"))")
        }
        return parts.joined(separator: "\n")
    }

    /// A chat's title is its first question, trimmed.
    static func deriveTitle(_ text: String) -> String {
        let clean = text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        guard clean.count > 60 else { return clean }
        let cut = String(clean.prefix(60))
        if let r = cut.range(of: #"\s+\S*$"#, options: .regularExpression) { return String(cut[..<r.lowerBound]) + "…" }
        return cut + "…"
    }

    /// A transcript as labelled turns, for one-shot prompts and hand-offs.
    static func transcript(_ messages: [ChatMessage], user: String = "USER", model: String) -> String {
        messages.map { "\($0.role == "user" ? user : model): \($0.text)" }.joined(separator: "\n\n")
    }
}
