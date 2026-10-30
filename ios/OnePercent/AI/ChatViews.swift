import SwiftUI

// The shared conversation UI (a port of GuidedChat.tsx) and the hand-off sheet.

/// A message bubble. Model replies render their Markdown.
struct MessageBubble: View {
    let message: ChatMessage
    var streaming = false

    var body: some View {
        let mine = message.role == "user"
        HStack {
            if mine { Spacer(minLength: 40) }
            Group {
                if mine {
                    Text(message.text)
                } else {
                    Text((try? AttributedString(markdown: message.text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(message.text))
                }
            }
            .font(.system(size: 15))
            .foregroundStyle(mine ? Theme.buttonText : Theme.ink)
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(mine ? Theme.button : Theme.panel, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(alignment: .bottomTrailing) {
                if streaming { ProgressView().controlSize(.mini).padding(6) }
            }
            .textSelection(.enabled)
            if !mine { Spacer(minLength: 40) }
        }
    }
}

/// A guided conversation: bubbles, a composer, streaming replies, and a
/// hand-off of the whole conversation to another AI.
struct GuidedChatView: View {
    @Binding var messages: [ChatMessage]
    /// Who the model is, for prompts ("COMPASS", "COMPANION"…).
    let modelName: String
    /// Builds the system prompt at send time, so it sees the latest data.
    let system: () -> String
    var placeholder = "Say it in your own words…"
    var onStreamingChange: ((Bool) -> Void)?

    @State private var input = ""
    @State private var streaming = false
    @State private var error: String?
    @State private var handOff: HandOff?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(messages) { m in
                MessageBubble(message: m, streaming: streaming && m.id == messages.last?.id && m.role == "model")
            }
            if let error {
                Text(error).font(.system(size: 13)).foregroundStyle(Theme.red)
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField(placeholder, text: $input, axis: .vertical)
                    .lineLimit(1...5)
                    .focused($focused)
                    .padding(.horizontal, 12).padding(.vertical, 10)
                    .background(Theme.card, in: RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.line))
                    .disabled(streaming)
                Button(action: send) {
                    Image(systemName: "arrow.up").font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.buttonText)
                        .frame(width: 40, height: 40).background(Theme.button, in: Circle())
                }
                .disabled(input.trimmed.isEmpty || streaming)
                .opacity(input.trimmed.isEmpty || streaming ? 0.4 : 1)
                .accessibilityLabel("Send")
            }
            HStack {
                AIStatusBadge()
                Spacer()
                Button { handOff = HandOff(title: "Hand off this conversation", prompt: handOffPrompt(), pasteLabel: "Paste their reply") } label: {
                    Label("Hand off", systemImage: "arrow.up.forward.app").font(.system(size: 12, weight: .medium))
                }
                .foregroundStyle(Theme.ink2)
            }
        }
        .sheet(item: $handOff) { h in
            HandOffSheet(handOff: h) { reply in
                messages.append(ChatMessage(role: "model", text: reply))
            }
        }
    }

    private func handOffPrompt() -> String {
        var ms = messages
        if !input.trimmed.isEmpty { ms.append(ChatMessage(role: "user", text: input.trimmed)) }
        return HandOff.compose(system: system(), body: AIEngine.chatPrompt(ms, modelName: modelName, budget: 60_000))
    }

    private func send() {
        let text = input.trimmed
        guard !text.isEmpty, !streaming else { return }
        input = ""
        error = nil
        messages.append(ChatMessage(role: "user", text: text))
        let prompt = AIEngine.chatPrompt(messages, modelName: modelName, budget: AIEngine.promptBudget)
        let sys = AIEngine.clip(system(), to: AIEngine.promptBudget)
        let reply = ChatMessage(role: "model", text: "")
        messages.append(reply)
        streaming = true
        onStreamingChange?(true)
        Task {
            do {
                for try await partial in AIEngine.stream(system: sys, prompt: prompt) {
                    if let i = messages.firstIndex(where: { $0.id == reply.id }) { messages[i].text = partial }
                }
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? "The AI couldn’t answer just now."
                messages.removeAll { $0.id == reply.id && $0.text.isEmpty }
            }
            streaming = false
            onStreamingChange?(false)
        }
    }
}

/// Which model is answering — or why none is.
struct AIStatusBadge: View {
    var body: some View {
        let s = AIEngine.status
        Label(s.isAvailable ? s.label : "Built-in AI unavailable — use Hand off", systemImage: s.isAvailable ? (s == .cloud ? "lock.icloud" : "iphone") : "exclamationmark.circle")
            .font(.system(size: 11))
            .foregroundStyle(Theme.faint)
            .lineLimit(1)
    }
}

// MARK: - Hand-off

/// A prompt ready to paste into Claude (or any assistant), with the app's full
/// context — no API, no cost. The answer can be pasted back in.
struct HandOff: Identifiable {
    let title: String
    let prompt: String
    var pasteLabel: String?
    let id = UUID()

    static func compose(system: String, body: String) -> String {
        """
        I use a habit app called One Percent, built on Atomic Habits. Please take on the role and rules below, then respond to what follows.

        --- ROLE AND RULES ---
        \(system)

        --- OVER TO YOU ---
        \(body)
        """
    }
}

struct HandOffSheet: View {
    let handOff: HandOff
    var onPaste: ((String) -> Void)?

    @Environment(\.dismiss) private var dismiss
    @State private var copied = false
    @State private var pasted = ""
    @State private var share = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Copy this into Claude or any AI assistant. It carries your habits, goals and recent week, so the answer is about you.")
                        .font(.system(size: 14)).foregroundStyle(Theme.ink2)
                    HStack(spacing: 10) {
                        Button {
                            Clipboard.string = handOff.prompt
                            copied = true
                        } label: { Label(copied ? "Copied" : "Copy prompt", systemImage: copied ? "checkmark" : "doc.on.doc") }
                        .buttonStyle(PrimaryButtonStyle())
                        .sensoryFeedback(.success, trigger: copied)
                        Button { share = true } label: { Label("Share…", systemImage: "square.and.arrow.up") }
                            .buttonStyle(SecondaryButtonStyle())
                    }
                    Text(handOff.prompt)
                        .font(.system(size: 12, design: .monospaced)).foregroundStyle(Theme.ink2)
                        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 12))
                        .textSelection(.enabled)
                    if let onPaste, let label = handOff.pasteLabel {
                        Divider()
                        Text(label).font(.system(size: 14, weight: .semibold))
                        TextField("Paste the answer here", text: $pasted, axis: .vertical)
                            .lineLimit(4...12)
                            .padding(10).background(Theme.card, in: RoundedRectangle(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.line))
                        HStack {
                            Button("Paste from clipboard") { pasted = Clipboard.string ?? pasted }.font(.system(size: 13))
                            Spacer()
                            Button("Use this answer") {
                                onPaste(pasted.trimmed)
                                dismiss()
                            }
                            .fontWeight(.semibold)
                            .disabled(pasted.trimmed.isEmpty)
                        }
                    }
                }
                .padding(18)
            }
            .navigationTitle(handOff.title)
            .inlineTitle()
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .sheet(isPresented: $share) { ShareSheet(items: [handOff.prompt]) }
        }
        .macSheet(width: 640, height: 720)
    }
}

/// JSON pasted back from another AI, tolerant of ```json fences and chatter.
enum PastedJSON {
    static func object(_ text: String) -> Any? {
        guard let start = text.firstIndex(of: "{"), let end = text.lastIndex(of: "}") else { return nil }
        return try? JSONSerialization.jsonObject(with: Data(text[start...end].utf8))
    }
}
