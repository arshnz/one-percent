// A stand-in for @google/generative-ai that records exactly what the routes
// would have sent to Gemini — system prompt, chat history, prompt — and
// answers with canned text. Lets the golden tests compare prompts and the data
// packs inside them, character for character.

export const calls: any[] = []

class Model {
  constructor(private opts: any) {}

  startChat({ history }: any) {
    const opts = this.opts
    return {
      async sendMessageStream(message: string) {
        calls.push({ kind: 'chat', system: opts.systemInstruction, history, message })
        return { stream: (async function* () { yield { text: () => 'ok' } })() }
      },
    }
  }

  async generateContent(prompt: string) {
    calls.push({ kind: 'generate', system: this.opts.systemInstruction, prompt })
    return { response: { text: () => '{"insights":["stub insight"],"summary":"stub"}' } }
  }

  async embedContent() {
    return { embedding: { values: [0] } }
  }
}

export class GoogleGenerativeAI {
  constructor(_key: string) {}
  getGenerativeModel(opts: any) { return new Model(opts) }
}

export const SchemaType = { OBJECT: 'object', ARRAY: 'array', STRING: 'string', NUMBER: 'number', BOOLEAN: 'boolean', INTEGER: 'integer' }
