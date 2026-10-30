import SwiftUI
import SwiftData

// One habit on the Launchpad — a port of client/src/components/habit/HabitCard.tsx.
// Three states: open (hold to vote / yes-no / taper count), voted, and missed.

struct HabitCardView: View {
    let item: HabitToday
    let today: String
    let weekday: Int
    var onEdit: ((Habit) -> Void)?
    /// Called after anything is written, so the Launchpad can replan reminders.
    let onChanged: () -> Void

    @Environment(\.modelContext) private var ctx
    @Environment(Toasts.self) private var toasts

    private enum Sheet: Identifiable {
        case goldilocks, reason(String), edit(String), check, nextPhase
        var id: String {
            switch self {
            case .goldilocks: "g"
            case .reason(let d): "r\(d)"
            case .edit(let d): "e\(d)"
            case .check: "c"
            case .nextPhase: "n"
            }
        }
    }

    @State private var failSafe = false
    @State private var sheet: Sheet?
    @State private var qty = 0
    @State private var holding = false
    @State private var holdProgress: CGFloat = 0
    @State private var confetti = 0
    @State private var voteTick = 0
    @State private var confirmPause = false

    private static let holdSeconds = 1.3

    private var h: Habit { item.habit }
    private var breaking: Bool { h.kind == "break" }
    private var taper: Bool { breaking && h.breakMode == "taper" }
    private var yesNo: Bool { !taper && h.checkStyle == "yesno" }
    private var done: Bool { item.todayLog.map { $0.status != "miss" } ?? false }
    private var relapsedToday: Bool { item.todayLog?.status == "miss" }
    private var votedFailSafe: Bool { item.todayLog?.status == "failsafe" }
    private var target: String { item.phase?.targetText ?? "Do the thing" }
    private var finishLine: String? { item.phase?.definitionOfDone?.trimmed.nonEmpty }
    private var reps: Int { item.completedReps }
    private var goal: Int { item.phase?.targetCount ?? 0 }
    private var checkDue: Bool { item.automaticity.eligible && item.automaticity.due }
    private var accent: Color { Theme.accent(for: h) }
    private var wp: WeekProgress? { item.weekProgress }

    private var isRequiredToday: Bool {
        if let wp { return wp.obligatedToday }
        if case .days(let days) = Schedule(h) { return days.contains(weekday) }
        return true
    }

    /// A weekly habit with reps still to give is open, not off.
    private var isGrayedOut: Bool { wp.map { $0.remaining == 0 && !done } ?? (!isRequiredToday && !done) }
    private var danger: Bool { isRequiredToday && !done && item.wasPreviousMissed }

    var body: some View {
        VStack(spacing: 0) {
            accent.frame(height: 3)
            if danger { neverMissTwice }
            header
            Theme.line.frame(height: 1)
            Group {
                if done { votedZone } else if relapsedToday { missedZone } else { openZone }
            }
            .padding(.horizontal, 24).padding(.vertical, 22)
        }
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .card()
        .opacity(isGrayedOut ? 0.6 : 1)
        .overlay { ConfettiBurst(trigger: confetti) }
        .sensoryFeedback(.success, trigger: voteTick)
        .sheet(item: $sheet) { sheetView($0).macSheet(width: 520, height: 620) }
        .confirmationDialog("Pause this habit?", isPresented: $confirmPause, titleVisibility: .visible) {
            Button("Pause") { pause() }
        } message: {
            Text("It’ll drop off your Today list and stop reminding you until you resume it — your history stays put.")
        }
    }

    // MARK: Header

    private var neverMissTwice: some View {
        VStack(spacing: 6) {
            Eyebrow("Never miss twice", color: Theme.red).frame(maxWidth: .infinity)
            let plans = h.setbackPlanList.filter { !$0.obstacle.isEmpty && !$0.plan.isEmpty }
            if plans.isEmpty {
                if let onEdit {
                    Button("Make a plan for days like this") { onEdit(h) }.buttonStyle(LinkButtonStyle(color: Theme.red))
                }
            } else {
                ForEach(plans.prefix(2), id: \.self) { p in
                    Text("**Your plan:** If \(p.obstacle.trimmed.trimmingSuffix(".")), then \(p.plan.trimmed.trimmingSuffix("."))." )
                        .font(.ui(12.5)).foregroundStyle(Theme.red.opacity(0.85))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            if item.previousMissNeedsReason, let d = item.previousMissDate {
                Button("What got in the way yesterday?") { sheet = .reason(d) }.buttonStyle(LinkButtonStyle(color: Theme.red))
            }
        }
        .padding(.horizontal, 24).padding(.vertical, 10)
        .background(Theme.redSoft)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                HStack(spacing: 5) {
                    if breaking { Image(systemName: "shield").font(.ui(11, weight: .semibold)) }
                    Text(caps(breaking ? "Leaving behind" : "I am becoming")).font(.eyebrow).capsTracking(1.6)
                }
                .foregroundStyle(breaking ? accent : Theme.faint)
                Spacer()
                if let onEdit {
                    Button { onEdit(h) } label: {
                        Image(systemName: "pencil").font(.ui(13)).foregroundStyle(Theme.faint)
                            .frame(width: 32, height: 32).background(Theme.panel, in: Circle())
                    }
                    .accessibilityLabel("Edit habit")
                }
            }
            .padding(.bottom, 12)

            Text(h.title).font(.serif(21)).foregroundStyle(Theme.ink).lineLimit(3)
            if let g = h.goal?.title {
                Text("→ \(g)").font(.ui(12.5, weight: .medium)).foregroundStyle(Theme.gold).padding(.top, 4)
            }
            WeekStripView(days: item.weekStrip, accent: accent) { sheet = .edit($0) }
            if let wp {
                Text(weekCopy(wp))
                    .font(.ui(12, weight: .medium))
                    .foregroundStyle(wp.remaining > 0 && wp.obligatedToday ? Theme.red : Theme.muted)
                    .padding(.top, 8)
            }
            if let why = h.whyText?.trimmed.nonEmpty, !done {
                quoteBar(why).padding(.top, 16)
            }
            if let cue = cueLine { cueView(cue).padding(.top, 16) }
        }
        .padding(.horizontal, 24).padding(.top, 22).padding(.bottom, 20)
    }

    private func weekCopy(_ wp: WeekProgress) -> String {
        if wp.remaining == 0 { return "\(wp.hits) of \(wp.quota) this week — done." }
        if wp.obligatedToday {
            return wp.daysLeft == 1
                ? "\(wp.hits) of \(wp.quota) — last day to make it \(wp.quota)."
                : "\(wp.hits) of \(wp.quota) — \(wp.remaining) left, \(wp.daysLeft) days to do them in."
        }
        return "\(wp.hits) of \(wp.quota) this week — \(wp.remaining) to go, \(wp.daysLeft) days left."
    }

    private func quoteBar(_ text: String) -> some View {
        HStack(spacing: 12) {
            Theme.accent.opacity(0.45).frame(width: 2)
            Text(text).font(.serif(14, italic: true)).foregroundStyle(Theme.ink2).lineLimit(4)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    /// Break habits pair the cue with the replacement swap; build habits show
    /// the cue alone.
    private var cueLine: (String, String?)? {
        var phrase: String?
        switch h.cueType {
        case "habit_stack": if let a = h.anchorRoutine?.nonEmpty { phrase = breaking ? "When I \(a)" : "After I \(a)" }
        case "time": if let t = h.cueTime?.nonEmpty { phrase = breaking ? "Around \(t)" : "At \(t)" }
        case "location": if let l = h.cueLocation?.nonEmpty { phrase = breaking ? "At \(l)" : "When I get to \(l)" }
        default: break
        }
        guard let phrase else { return nil }
        guard breaking else { return (phrase, nil) }
        guard let response = (h.replacementAction?.nonEmpty ?? h.failSafeAction.nonEmpty) else { return nil }
        let swap = response.lowercased().replacingOccurrences(of: #"^i will\s+"#, with: "", options: [.regularExpression, .caseInsensitive])
        return (phrase, ", I’ll \(swap) instead")
    }

    private func cueView(_ cue: (String, String?)) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "bolt").font(.ui(12)).foregroundStyle(Theme.faint).padding(.top, 2)
            (Text(cue.0).fontWeight(.medium).foregroundStyle(Theme.ink) + Text(cue.1 ?? "").foregroundStyle(Theme.ink2))
                .font(.ui(13))
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: Action zones

    private var checkCTA: some View {
        Button { sheet = .check } label: {
            HStack(spacing: 8) {
                Image(systemName: "sparkles").foregroundStyle(Theme.accent)
                (Text("This milestone’s ready — ") + Text("take the Automaticity Check").fontWeight(.semibold) + Text(" to unlock your next step"))
                    .font(.ui(13)).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }

    private var votedZone: some View {
        VStack(spacing: 0) {
            Image(systemName: "checkmark").font(.ui(22, weight: .bold)).foregroundStyle(.white)
                .frame(width: 52, height: 52).background(Theme.green, in: Circle())
                .shadow(color: Theme.green.opacity(0.3), radius: 8, y: 6)
                .padding(.bottom, 14)
                .transition(.scale.combined(with: .opacity))
            Text(breaking ? (goal > 0 ? "Clean day #\(reps)" : "Clean day logged") : (goal > 0 ? "Vote #\(reps) cast" : "Vote cast"))
                .font(.serif(21)).foregroundStyle(Theme.ink).padding(.bottom, 6)
            if let why = h.whyText?.trimmed.nonEmpty {
                Eyebrow(breaking ? "This clean day is for" : "This vote is for")
                Text("“\(why)”").font(.serif(14.5, italic: true)).foregroundStyle(Theme.ink2)
                    .multilineTextAlignment(.center).lineLimit(4).padding(.top, 4).frame(maxWidth: 280)
                if let g = h.goal?.title {
                    Text("One step closer to: \(g)").font(.ui(12, weight: .medium)).foregroundStyle(Theme.gold)
                        .multilineTextAlignment(.center).padding(.top, 8).frame(maxWidth: 280)
                }
            } else {
                Text(doneSubtitle).font(.ui(13.5)).foregroundStyle(Theme.ink2).multilineTextAlignment(.center).frame(maxWidth: 270)
            }

            if goal > 0 {
                VStack(spacing: 6) {
                    Tally(filled: min(reps, goal), total: goal, color: accent)
                    HStack {
                        Text("\(min(reps, goal)) of \(goal) \(breaking ? "clean days" : "votes")").font(.ui(12)).foregroundStyle(Theme.muted)
                        Spacer()
                        Button("Undo") { clear(today) }.buttonStyle(LinkButtonStyle())
                    }
                }
                .padding(.top, 18)
            } else {
                Button("Undo") { clear(today) }.buttonStyle(LinkButtonStyle()).padding(.top, 12)
            }
            if checkDue { checkCTA.padding(.top, 12) }
            if let c = h.celebration?.trimmed.nonEmpty {
                Text("🎉 \(c)").font(.ui(13)).foregroundStyle(Theme.ink2)
                    .frame(maxWidth: .infinity).padding(11).background(Theme.panel, in: RoundedRectangle(cornerRadius: 11))
                    .padding(.top, 12)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var doneSubtitle: String {
        if breaking {
            return votedFailSafe
                ? "You felt the urge and held — that resistance is the vote. Keep stacking the evidence."
                : "\(reps) clean \(reps == 1 ? "day" : "days") voting for who you’re becoming. This is who you are now — keep it going."
        }
        return votedFailSafe
            ? "Fail-safe still counts — showing up is the vote. Keep stacking the evidence."
            : "\(reps) \(reps == 1 ? "vote" : "votes") toward who you’re becoming. This is who you are now — keep stacking the evidence."
    }

    private var missedZone: some View {
        VStack(spacing: 0) {
            Image(systemName: "shield.slash").font(.ui(20, weight: .semibold)).foregroundStyle(Theme.red)
                .frame(width: 52, height: 52).background(Theme.red.opacity(0.1), in: Circle()).padding(.bottom, 14)
            Text(breaking ? "Relapse logged" : "Logged — not today").font(.serif(21)).foregroundStyle(Theme.ink).padding(.bottom, 6)
            Text(breaking
                 ? "One slip doesn’t erase your progress — your \(reps) clean \(reps == 1 ? "day" : "days") still stand. Never miss twice; tomorrow is the comeback."
                 : "An honest no is still data — your \(reps) \(reps == 1 ? "vote" : "votes") still stand. Never miss twice; tomorrow’s a fresh vote.")
                .font(.ui(13.5)).foregroundStyle(Theme.ink2).multilineTextAlignment(.center).frame(maxWidth: 270)
            if JSONText.strings(item.todayLog?.missReasons).isEmpty {
                Button("What got in the way?") { sheet = .reason(today) }.buttonStyle(LinkButtonStyle(color: Theme.red)).padding(.top, 10)
            }
            if checkDue { checkCTA.padding(.top, 12) }
            Button(breaking ? "Undo — that wasn’t a relapse" : "Undo — I actually did it") { clear(today) }
                .buttonStyle(LinkButtonStyle()).padding(.top, 8)
        }
        .frame(maxWidth: .infinity)
    }

    private var openZone: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Eyebrow(sectionLabel, color: failSafe ? Theme.accent : Theme.faint)
                Spacer()
                Text("Phase \(item.phase?.phaseNumber ?? 1)").font(.ui(12)).foregroundStyle(Theme.faint)
            }
            .padding(.bottom, 12)
            if checkDue { checkCTA.padding(.bottom, 12) }

            if taper { taperPanel } else if yesNo { yesNoPanel } else { holdPanel }

            if goal > 0 {
                VStack(alignment: .leading, spacing: 6) {
                    Tally(filled: min(reps, goal), total: goal, color: accent)
                    Text("\(min(reps, goal)) of \(goal) \(breaking ? "clean days toward breaking free" : "votes toward who you’re becoming")")
                        .font(.ui(12)).foregroundStyle(Theme.muted)
                }
                .padding(.top, 18)
            }

            if !taper && !yesNo {
                Toggle(isOn: $failSafe.animation()) {
                    Text(failSafe
                         ? (breaking ? "Used the 2-minute resist today. Back to full strength tomorrow." : "Fail-safe is on for today. Back to the full version tomorrow.")
                         : (breaking ? "Urge hit but you held? Log it as a resist." : "Too much today? Switch to fail-safe."))
                        .font(.ui(12.5)).foregroundStyle(Theme.ink2)
                }
                .toggleStyle(LeadingSwitch(tint: Theme.accent))
                .padding(.top, 16)
            }

            if breaking && !yesNo {
                Button("I slipped today — log a relapse") { relapse() }
                    .buttonStyle(LinkButtonStyle(color: Theme.faint)).frame(maxWidth: .infinity).padding(.top, 12)
            }
            Button { confirmPause = true } label: {
                Label("Too much right now? Pause this habit", systemImage: "pause.circle").font(.ui(12))
            }
            .foregroundStyle(Theme.faint).frame(maxWidth: .infinity).padding(.top, 10)
        }
    }

    private var sectionLabel: String {
        if failSafe { return breaking ? "Resisted · still counts" : "Fail-safe · still counts" }
        if isRequiredToday { return breaking ? "Today’s clean day" : "Today’s vote" }
        if let wp { return wp.remaining > 0 ? "Optional today" : "Week complete" }
        return "Not scheduled today"
    }

    private var holdPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(failSafe ? h.failSafeAction : target).font(.ui(16.5, weight: .semibold)).foregroundStyle(Theme.ink).padding(.bottom, 4)
            if failSafe {
                Text(breaking ? "Feeling the urge and holding is the vote. The 2-minute resist always counts." : "Showing up is the vote. The 2-minute version never scales away.")
                    .font(.ui(12.5)).foregroundStyle(Theme.accent).padding(.bottom, 16)
            } else if let finishLine {
                Text("\(breaking ? "Clean when" : "Done when") \(finishLine)").font(.ui(12.5)).foregroundStyle(Theme.muted).padding(.bottom, 16)
            } else {
                Spacer().frame(height: 12)
            }
            if !failSafe, let b = h.temptationBundle?.trimmed.nonEmpty {
                Label(breaking ? "The cost: \(b)" : "Only while \(b)", systemImage: "sparkles")
                    .font(.ui(12.5)).foregroundStyle(Theme.pausedInk)
                    .padding(.horizontal, 11).padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.pausedBg, in: RoundedRectangle(cornerRadius: 10))
                    .padding(.bottom, 16)
            }
            holdButton
        }
        .padding(18)
        .background(failSafe ? Theme.accentSoft : Theme.panel, in: RoundedRectangle(cornerRadius: 16))
    }

    /// Press and hold for 1.3s — deliberate enough that a vote is never cast by
    /// a stray tap or a scroll.
    private var holdButton: some View {
        ZStack(alignment: .leading) {
            Theme.button
            GeometryReader { g in Color.white.opacity(0.15).frame(width: g.size.width * holdProgress) }
            Label(holding ? "Keep holding…" : breaking ? "Hold to log a clean day" : "Hold to cast your vote", systemImage: "target")
                .font(.ui(15, weight: .semibold)).foregroundStyle(Theme.buttonText)
                .frame(maxWidth: .infinity)
        }
        .frame(height: 52)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .contentShape(Rectangle())
        .onLongPressGesture(minimumDuration: Self.holdSeconds, maximumDistance: 24) {
            holding = false
            holdProgress = 0
            complete()
        } onPressingChanged: { pressing in
            holding = pressing
            if pressing {
                withAnimation(.linear(duration: Self.holdSeconds)) { holdProgress = 1 }
            } else {
                withAnimation(.easeOut(duration: 0.15)) { holdProgress = 0 }
            }
        }
        .sensoryFeedback(.impact(weight: .light), trigger: holding) { _, new in new }
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel(breaking ? "Log a clean day" : "Cast your vote")
        .accessibilityAction { complete() }
    }

    private var yesNoPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(h.checkQuestion?.trimmed.nonEmpty ?? target).font(.ui(16.5, weight: .semibold)).foregroundStyle(Theme.ink).padding(.bottom, 4)
            if let finishLine {
                Text("\(breaking ? "Clean when" : "Yes when") \(finishLine)").font(.ui(12.5)).foregroundStyle(Theme.muted)
            }
            HStack(spacing: 8) {
                Button { complete() } label: { Label("Yes", systemImage: "checkmark") }.buttonStyle(PrimaryButtonStyle())
                Button { sayNo() } label: { Label("Not this time", systemImage: "xmark") }.buttonStyle(SecondaryButtonStyle())
            }
            .padding(.top, 14)
        }
        .padding(18)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 16))
    }

    private var taperPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(target).font(.ui(16.5, weight: .semibold)).foregroundStyle(Theme.ink).padding(.bottom, 4)
            Text("Limit today: \(item.phase?.dailyLimit ?? 0). Log honestly — under the line is a vote.")
                .font(.ui(12.5)).foregroundStyle(Theme.muted).padding(.bottom, 16)
            Stepper3(value: $qty).frame(maxWidth: .infinity).padding(.bottom, 16)
            Button { logTaper() } label: { Label("Log today’s count", systemImage: "checkmark") }.buttonStyle(PrimaryButtonStyle())
        }
        .padding(18)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 16))
    }

    // MARK: Sheets

    @ViewBuilder private func sheetView(_ s: Sheet) -> some View {
        switch s {
        case .goldilocks:
            GoldilocksSheet(onRate: { rate($0) }, onClose: { sheet = nil })
        case .reason(let date):
            MissReasonSheet(
                title: date == today ? "What got in the way?" : "What got in the way \(DateText.weekday(date))?",
                chips: MissReasons.chips(setbackPlans: h.setbackPlans),
                onSave: { reasons, note in saveReason(date, reasons, note) },
                onClose: { sheet = nil }
            )
        case .edit(let date):
            let log = DailyLoop.log(on: h, date: date)
            EditDaySheet(
                date: date, breaking: breaking, taper: taper, dailyLimit: item.phase?.dailyLimit ?? 0,
                currentStatus: log?.status, currentQuantity: log?.quantity,
                onSetStatus: { status in
                    write { try DailyLoop.vote(h, status: status, date: date, today: today, ctx: ctx) }
                    // A backfilled miss deserves the same "what got in the way?".
                    sheet = status == "miss" ? .reason(date) : nil
                },
                onSetCount: { n in
                    write { try DailyLoop.vote(h, quantity: n, date: date, today: today, ctx: ctx) }
                    sheet = nil
                },
                onClear: {
                    write { try DailyLoop.clear(h, date: date, today: today, ctx: ctx) }
                    sheet = nil
                },
                onClose: { sheet = nil }
            )
        case .check:
            AutomaticityCheckSheet(
                habitTitle: h.title,
                onSubmit: { scores in
                    do { return try DailyLoop.submitCheck(h, scores: scores, ctx: ctx) } catch {
                        toasts.error(error.localizedDescription)
                        return nil
                    }
                },
                onPassed: { advanced in
                    confetti += 1
                    onChanged()
                    if advanced {
                        sheet = nil
                        toasts.show("Phase cleared — your next step is now live.", icon: "stairs")
                    } else {
                        sheet = .nextPhase
                    }
                },
                onClose: { sheet = nil; onChanged() }
            )
        case .nextPhase:
            NextPhaseSheet(
                habitTitle: h.title, nextPhaseNumber: (item.phase?.phaseNumber ?? 1) + 1,
                onSave: { target, done, count in
                    write { try DailyLoop.addPhase(h, targetText: target, definitionOfDone: done, targetCount: count, ctx: ctx) }
                    toasts.show("Next phase set — onward.")
                    sheet = nil
                },
                onClose: { sheet = nil }
            )
        }
    }

    // MARK: Actions

    private func write(_ body: () throws -> Void) {
        do {
            try body()
            onChanged()
        } catch {
            toasts.error(error.localizedDescription)
        }
    }

    private func complete() {
        guard !done else { return }
        var ready = false
        write { ready = try DailyLoop.vote(h, status: failSafe ? "failsafe" : "target", today: today, ctx: ctx).ready }
        voteTick += 1
        confetti += 1
        if ready { toasts.show("This habit might be on autopilot — take the Automaticity Check.", icon: "sparkles") }
        // Calibration is occasional, not per-rep admin: after a fail-safe day
        // (the target may be too big) or every 7th rep.
        if failSafe || (reps + 1) % 7 == 0 { sheet = .goldilocks }
    }

    private func rate(_ g: String) {
        write { try DailyLoop.vote(h, status: failSafe ? "failsafe" : "target", goldilocks: g, today: today, ctx: ctx) }
        sheet = nil
    }

    private func relapse() {
        write { try DailyLoop.vote(h, status: "miss", today: today, ctx: ctx) }
        toasts.show("Relapse logged. Never miss twice — tomorrow’s clean day is the comeback.", icon: "sunrise")
        sheet = .reason(today)
    }

    private func sayNo() {
        write { try DailyLoop.vote(h, status: "miss", today: today, ctx: ctx) }
        sheet = .reason(today)
    }

    private func logTaper() {
        let limit = item.phase?.dailyLimit ?? 0
        write { try DailyLoop.vote(h, quantity: qty, today: today, ctx: ctx) }
        if qty <= limit {
            voteTick += 1
            confetti += 1
            if (reps + 1) % 7 == 0 { sheet = .goldilocks }
        } else {
            sheet = .reason(today)
        }
    }

    private func clear(_ date: String) {
        write { try DailyLoop.clear(h, date: date, today: today, ctx: ctx) }
    }

    private func saveReason(_ date: String, _ reasons: [String], _ note: String) {
        write { try DailyLoop.recordReason(h, date: date, reasons: reasons, note: note.nonEmpty, today: today, ctx: ctx) }
        sheet = nil
        toasts.show("Noted. That’s useful data, not a verdict.", icon: "note.text")
    }

    private func pause() {
        write { try DailyLoop.setPaused(h, true, ctx: ctx) }
        toasts.show("Paused. Resume it from the Launchpad whenever you’re ready.", icon: "pause.circle")
    }
}

/// The vote tally — a tangible row of ticks, one per rep toward graduation.
struct Tally: View {
    let filled: Int
    let total: Int
    let color: Color

    var body: some View {
        GeometryReader { g in
            // Long ladders compress into a bar rather than hairline ticks.
            if total <= 60 {
                HStack(spacing: 3) {
                    ForEach(0..<total, id: \.self) { i in
                        Capsule().fill(i < filled ? color : Theme.rest)
                    }
                }
            } else {
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.rest)
                    Capsule().fill(color).frame(width: g.size.width * CGFloat(filled) / CGFloat(max(total, 1)))
                }
            }
        }
        .frame(height: 5)
        .accessibilityElement()
        .accessibilityLabel("\(filled) of \(total)")
    }
}

/// A switch with its label to the right, like the web toggle.
struct LeadingSwitch: ToggleStyle {
    let tint: Color

    func makeBody(configuration: Configuration) -> some View {
        Button { configuration.isOn.toggle() } label: {
            HStack(spacing: 10) {
                Capsule().fill(configuration.isOn ? tint : Theme.rest)
                    .frame(width: 38, height: 22)
                    .overlay(alignment: configuration.isOn ? .trailing : .leading) {
                        Circle().fill(.white).padding(2).shadow(color: .black.opacity(0.15), radius: 1, y: 1)
                    }
                configuration.label
                Spacer(minLength: 0)
            }
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: configuration.isOn)
    }
}

extension String {
    func trimmingSuffix(_ s: String) -> String { hasSuffix(s) ? String(dropLast(s.count)) : self }
}
