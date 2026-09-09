import { Router } from 'express'
import { z } from 'zod'
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import { requireAuth, AuthRequest } from '../middleware/auth.js'
import { prisma } from '../lib/prisma.js'
import { assertWorkstation } from '../lib/workstation.js'
import { embed, toVectorLiteral } from '../lib/embeddings.js'
import { parseSchedule, resolveRange, weekDatesOf, weekdayOf } from '../lib/schedule.js'

const router = Router()
router.use(requireAuth)

const MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview'

function getGenAI() {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY is not set')
  return new GoogleGenerativeAI(key)
}

const MessageSchema = z.object({
  role: z.enum(['user', 'model']),
  text: z.string().max(2000),
})

function sendSSE(res: any, chunk: string) {
  res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`)
}

// Streams the model's reply to the client and returns the full accumulated text
// (empty string if the stream errored) so callers can persist it if needed.
async function streamToResponse(res: any, endpoint: string, systemPrompt: string, messages: Array<{ role: 'user' | 'model'; text: string }>): Promise<string> {
  void endpoint
  const genAI = getGenAI()
  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: systemPrompt,
  })

  // The UI shows a static opening message from the model before the first user
  // turn. Gemini's chat API requires history to start with a user message, so
  // strip any leading model messages before building the history array.
  const priorMessages = messages.slice(0, -1)
  const firstUserIdx = priorMessages.findIndex((m) => m.role === 'user')
  const history = (firstUserIdx >= 0 ? priorMessages.slice(firstUserIdx) : []).map((m) => ({
    role: m.role,
    parts: [{ text: m.text }],
  }))
  const lastMessage = messages[messages.length - 1].text

  const chat = model.startChat({ history })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  // Disable proxy buffering so chunks reach the client incrementally.
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  // Once headers are flushed we can no longer hand the error to Express's
  // errorHandler (it would throw ERR_HTTP_HEADERS_SENT and the client would
  // hang on an unterminated stream). Instead, emit an SSE error event and
  // close the stream cleanly so the UI can surface it.
  let full = ''
  try {
    const result = await chat.sendMessageStream(lastMessage)
    for await (const chunk of result.stream) {
      const text = chunk.text()
      if (text) { full += text; sendSSE(res, text) }
    }
    res.write('data: [DONE]\n\n')
  } catch (err) {
    console.error('[ai stream error]', err instanceof Error ? err.message : err)
    res.write(`data: ${JSON.stringify({ error: 'The AI coach is unavailable right now. Try again in a moment.' })}\n\n`)
    full = ''
  } finally {
    res.end()
  }
  return full
}

// ── Reflection exercises ─────────────────────────────────────────────────────
// Guided, single-purpose coaches that help the user think through what they
// actually want in life. Each drops insights onto their Vision Canvas.

const REFLECT_BASE = `You are a warm, perceptive reflection coach inside a life-vision tool called the Vision Canvas. You help the user think deeply, not give them answers.

How you work:
- Ask ONE focused question at a time. Never stack questions.
- Keep every reply short — 2–4 sentences, then your single question.
- Listen and build on what they say. Reflect their own words back so they feel heard.
- Use their personal context (if given) to make it specific to their life.
- When a meaningful insight surfaces, name it crisply in one sentence and tell them they can add it to their canvas.
- Stay entirely within this exercise. Gently redirect if they drift.`

const EXERCISES: Record<string, string> = {
  eulogy: `${REFLECT_BASE}

THE EXERCISE — The Eulogy:
Guide them to imagine their own funeral, years from now. Walk them, one at a time, through what they'd want different people to say — a partner or spouse, a child or close family member, a long-time friend, a colleague. The goal is to surface the values and character they most want to be remembered for. Start by gently setting the scene and asking who the first speaker would be.`,

  perfect_day: `${REFLECT_BASE}

THE EXERCISE — A Perfect Average Day:
Guide them to describe one ordinary (not fantasy) day in their ideal life, a few years out. Move through it in order — waking, morning, work, people, afternoon, evening — one beat at a time. Surface what it reveals about what they value: environment, relationships, work, health, pace. Start by asking where they wake up and how the day begins.`,

  values: `${REFLECT_BASE}

THE EXERCISE — Core Values:
Help them surface and name the handful of values that actually drive them. Use concrete prompts (a moment they felt most alive; a time they were proud; what angers them about the world) to pull values out of stories rather than asking abstractly. Help them name and rank the top few. Start with one vivid story prompt.`,

  future_self: `${REFLECT_BASE}

THE EXERCISE — Your 90-Year-Old Self:
Have them speak with themselves at 90, looking back on a life well lived. Surface what that older self is most proud of, what they'd urge the present self to start now, and what to stop wasting time on. Keep it warm and a little urgent. Start by inviting them to picture meeting their 90-year-old self.`,
}

router.post('/reflect', async (req: AuthRequest, res, next) => {
  try {
    const { exercise, messages } = z.object({
      exercise: z.enum(['eulogy', 'perfect_day', 'values', 'future_self']),
      messages: z.array(MessageSchema).min(1).max(30),
    }).parse(req.body)

    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { personalContext: true },
    })

    const system = user?.personalContext
      ? `${EXERCISES[exercise]}\n\nPersonal context about this user:\n${user.personalContext}`
      : EXERCISES[exercise]

    await streamToResponse(res, 'reflect', system, messages)
  } catch (err) {
    next(err)
  }
})

// ── The Compass ──────────────────────────────────────────────────────────────
// The workbook's ABZ framework as one guided conversation: A = an honest look
// at current reality, Z = where the user wants to end up (their goals), B = the
// ONE habit that is the first step of a system toward Z. One continuous thread;
// the stage only swaps the system prompt so the model keeps full memory.

const COMPASS_BASE = `You are the Compass — a warm, perceptive guide inside a habit-building app called One Percent, walking the user through the ABZ framework from the Atomic Habits Workbook: A is an honest assessment of their current reality, Z is where they want to end up, and B is the one next habit that starts the path.

How you work:
- Ask ONE focused question at a time. Never stack questions.
- Keep every reply short — 2–4 sentences, then your single question.
- Reflect their own words back so they feel heard. Their phrasing matters more than yours.
- Use their personal context (if given) so nothing feels generic.
- Stay in the current stage. Gently redirect if they drift.`

function compassSystem(stage: 'reality' | 'vision' | 'first-step', personalContext: string | null, assessment: string | null): string {
  const stages: Record<typeof stage, string> = {
    reality: `${COMPASS_BASE}

STAGE A — CURRENT REALITY. Work through these, one at a time, conversationally (never as a form):
1. How content they feel in the big areas of life right now (personal and professional), and why.
2. Their top 2–3 priorities at the moment.
3. Their energy: everyone has only 2–6 genuinely high-quality hours a day — when do theirs fall, and what currently gets those hours?
4. Past habits that actually stuck, and WHY they stuck (this is gold for designing the next one).
5. What keeps knocking them off course when they try to change.
When you have a real picture of all five, recap it in a few crisp lines using their own words, then tell them: "When that feels right, hit Continue and we'll look at where you're heading."`,

    vision: `${COMPASS_BASE}

STAGE Z — WHERE THEY WANT TO END UP. Using everything from stage A:
- Help them name 2–4 goals across different life domains (health, career, relationships, money, mind). Not resolutions — destinations: "where do you want to be in 2, 5, 10 years?"
- Push past vague wishes ("be healthier") to concrete, owned statements with a rough timeframe ("run a half marathon by mid 2027").
- For each goal, check it's genuinely THEIRS, not someone else's expectation.
- Keep it to the few that matter — clarity is freedom.
When the goals feel sharp, recap them as a short list in their words, then tell them: "Hit Continue and we'll pick the one habit that starts the path."`,

    'first-step': `${COMPASS_BASE}

STAGE B — THE ONE NEXT HABIT. Help them choose exactly ONE habit as the first step of a system toward ONE of their goals (the workbook is emphatic: one at a time).
Apply two checks from the workbook before you bless it:
1. ROOT vs BRANCH: is this habit solving the real problem at the root, or trimming a symptom? (Removing the phone from the bedroom is root; taking melatonin to out-sleep the scrolling is branch.) If it's branch, help them find the root version.
2. FIT THE SHAPE OF THEIR LIFE: place the habit in their actual day. Quote their own high-quality hours and what made past habits stick from stage A. A habit that fights their life loses.
Converge on: one rough habit sentence, which goal it serves, and roughly when/where in their day it lives. Then recap it in one line and tell them: "Hit 'Design this habit' and we'll engineer it properly."`,
  }
  const ctx = [
    personalContext?.trim() ? `Personal context about this user:\n${personalContext.trim()}` : '',
    assessment?.trim() ? `Their saved Compass assessment so far (JSON):\n${assessment.trim()}` : '',
  ].filter(Boolean).join('\n\n')
  return ctx ? `${stages[stage]}\n\n${ctx}` : stages[stage]
}

router.post('/compass', async (req: AuthRequest, res, next) => {
  try {
    const { stage, messages } = z.object({
      stage: z.enum(['reality', 'vision', 'first-step']),
      messages: z.array(MessageSchema).min(1).max(80),
    }).parse(req.body)

    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { personalContext: true, assessment: true },
    })

    await streamToResponse(res, 'compass', compassSystem(stage, user?.personalContext ?? null, user?.assessment ?? null), messages)
  } catch (err) {
    next(err)
  }
})

// One-shot structured extraction over the Compass transcript. Called after
// stage Z (assessment + goals) and again after stage B (habitDraft). Nothing is
// saved here — the client shows everything for review first.
const COMPASS_EXTRACT_SYSTEM = `You extract structured data from a Compass conversation transcript (the ABZ framework: current reality → goals → first habit).

Rules:
- Use the USER's own words and phrasing wherever possible — never paraphrase into coach-speak.
- assessment: fill only what the conversation actually covered; leave arrays empty otherwise. highQualityHours is one plain sentence (e.g. "6–8am before the kids wake, and 8–9pm").
- goals: the 2–4 goals the user landed on. domain is one of health|career|relationships|money|mind. whyText is one sentence in their voice. timeframe like "by mid 2027" if mentioned, else empty string.
- habitDraft: ONLY if the conversation reached choosing a habit — roughSentence is the habit in one plain sentence (their words), goalIndex is the 0-based index into goals of the goal it serves, kind is "build" or "break". If no habit was chosen yet, roughSentence is an empty string.`

const compassExtractSchema = {
  type: SchemaType.OBJECT,
  properties: {
    assessment: {
      type: SchemaType.OBJECT,
      properties: {
        contentment: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              domain: { type: SchemaType.STRING },
              score: { type: SchemaType.NUMBER },
            },
            required: ['domain', 'score'],
          },
        },
        priorities: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        highQualityHours: { type: SchemaType.STRING },
        pastStickyHabits: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              habit: { type: SchemaType.STRING },
              whyItStuck: { type: SchemaType.STRING },
            },
            required: ['habit', 'whyItStuck'],
          },
        },
        obstacles: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
      },
      required: ['priorities', 'highQualityHours', 'pastStickyHabits', 'obstacles'],
    },
    goals: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          title: { type: SchemaType.STRING },
          domain: { type: SchemaType.STRING, format: 'enum', enum: ['health', 'career', 'relationships', 'money', 'mind'] },
          whyText: { type: SchemaType.STRING },
          timeframe: { type: SchemaType.STRING },
        },
        required: ['title', 'domain', 'whyText', 'timeframe'],
      },
    },
    habitDraft: {
      type: SchemaType.OBJECT,
      properties: {
        roughSentence: { type: SchemaType.STRING },
        goalIndex: { type: SchemaType.NUMBER },
        kind: { type: SchemaType.STRING, format: 'enum', enum: ['build', 'break'] },
      },
      required: ['roughSentence', 'goalIndex', 'kind'],
    },
  },
  required: ['assessment', 'goals', 'habitDraft'],
} as const

router.post('/compass/extract', async (req: AuthRequest, res, next) => {
  try {
    const { messages } = z.object({
      messages: z.array(MessageSchema).min(2).max(120),
    }).parse(req.body)

    const genAI = getGenAI()
    const model = genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: COMPASS_EXTRACT_SYSTEM,
      generationConfig: {
        responseMimeType: 'application/json',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        responseSchema: compassExtractSchema as any,
      },
    })

    const transcript = messages.map((m) => `${m.role === 'user' ? 'USER' : 'COMPASS'}: ${m.text}`).join('\n\n')
    const result = await model.generateContent(`Transcript:\n\n${transcript}`)
    const extract = JSON.parse(result.response.text())
    res.json({ extract })
  } catch (err) {
    next(err)
  }
})

// ── The Atomizer ─────────────────────────────────────────────────────────────
// One rough sentence in → a full, concrete habit blueprint out. Returns
// structured JSON (not prose) so the client can pre-fill the Architect form.

const ATOMIZE_SYSTEM = `You are the Atomizer inside a habit-building app called One Percent, built on the science of Atomic Habits (James Clear), Tiny Habits (BJ Fogg), and implementation-intentions research.

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

Keep everything realistic and specific to the goal.`

// Breaking a bad habit inverts the Four Laws — make it invisible, unattractive,
// difficult, unsatisfying. The blueprint reuses the same field names so the
// Architect form can pre-fill identically; the meaning of each is inverted.
const ATOMIZE_BREAK_SYSTEM = `You are the Atomizer inside a habit app called One Percent, here helping the user BREAK a bad habit by inverting the Four Laws of Behaviour Change (James Clear): make it invisible, unattractive, difficult, and unsatisfying. Concreteness is everything — remove all ambiguity.

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

Keep everything realistic and specific to the goal.`

function atomizeSchemaFor(kind: 'build' | 'break') {
  const base = {
    type: SchemaType.OBJECT,
    properties: {
      identityStatement: { type: SchemaType.STRING },
      why: { type: SchemaType.STRING },
      cueType: { type: SchemaType.STRING, format: 'enum', enum: ['habit_stack', 'time', 'location'] },
      anchorRoutine: { type: SchemaType.STRING },
      cueTime: { type: SchemaType.STRING },
      cueLocation: { type: SchemaType.STRING },
      failSafeAction: { type: SchemaType.STRING },
      celebration: { type: SchemaType.STRING },
      temptationBundle: { type: SchemaType.STRING },
      nightstandRule: { type: SchemaType.STRING },
      phases: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            targetText: { type: SchemaType.STRING },
            definitionOfDone: { type: SchemaType.STRING },
            targetCount: { type: SchemaType.NUMBER },
            dailyLimit: { type: SchemaType.NUMBER },
          },
          required: ['targetText', 'definitionOfDone', 'targetCount'],
        },
      },
    },
    required: ['identityStatement', 'why', 'cueType', 'anchorRoutine', 'cueTime', 'cueLocation', 'failSafeAction', 'celebration', 'phases'],
  }
  if (kind === 'break') {
    Object.assign(base.properties, {
      breakMode: { type: SchemaType.STRING, format: 'enum', enum: ['abstain', 'taper'] },
      avoidTrigger: { type: SchemaType.STRING },
      replacementAction: { type: SchemaType.STRING },
      frictionDevice: { type: SchemaType.STRING },
    })
    base.required.push('breakMode', 'avoidTrigger', 'replacementAction', 'frictionDevice')
  }
  return base
}

// ── The Blueprint Interview ──────────────────────────────────────────────────
// The co-authored replacement for the one-shot Atomizer. A short guided
// conversation (3–5 turns) that walks the workbook's habit-choice checks, then
// drafts a blueprint in the USER'S OWN WORDS for them to edit. Two endpoints:
// the streaming interview, and a one-shot draft over the transcript.

function blueprintInterviewSystem(
  kind: 'build' | 'break',
  personalContext: string | null,
  assessment: string | null,
  goalTitle: string | null,
): string {
  const base = `You are the Architect's interviewer inside a habit-building app called One Percent, helping the user co-design ONE habit they'll actually keep. You draw on Atomic Habits (James Clear) and the workbook's habit-choice checks.

How you work:
- Ask ONE focused question at a time. Never stack questions. Keep replies to 2–3 sentences, then your single question.
- Reflect the user's own phrasing back — the final blueprint should read like they wrote it.
- Run this sequence over ~3–5 turns:
  1. ROOT vs BRANCH — what's the real problem this habit solves? Is this the root fix or a symptom patch? If it's a symptom, help them find the root.
  2. WHERE IT FITS — anchor the habit in their real day. If you know their high-quality hours, quote them back and test the fit.
  3. WHAT WORKED BEFORE — ask what's made a past habit stick for them, and borrow that mechanism.
- When you have enough to design a concrete habit, say so plainly and tell them to hit "Draft it" — do NOT dump a full plan in chat.`
  const kindNote = kind === 'break'
    ? '\n\nThis is a habit they want to BREAK — frame everything around removing the cue, a replacement action, friction, and accountability.'
    : ''
  const ctx = [
    personalContext?.trim() ? `Personal context about this user:\n${personalContext.trim()}` : '',
    assessment?.trim() ? `Their Compass assessment (use their high-quality hours and past sticky habits):\n${assessment.trim()}` : '',
    goalTitle ? `This habit is meant to be the first step toward their goal: "${goalTitle}". Keep it tied to that.` : '',
  ].filter(Boolean).join('\n\n')
  return ctx ? `${base}${kindNote}\n\n${ctx}` : `${base}${kindNote}`
}

router.post('/blueprint-interview', async (req: AuthRequest, res, next) => {
  try {
    const { messages, kind, wsId, goalId } = z.object({
      messages: z.array(MessageSchema).min(1).max(40),
      kind: z.enum(['build', 'break']).default('build'),
      wsId: z.string().min(1).optional(),
      goalId: z.string().min(1).optional(),
    }).parse(req.body)

    const [user, goal] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId! }, select: { personalContext: true, assessment: true } }),
      goalId && wsId
        ? prisma.goal.findFirst({ where: { id: goalId, workstationId: wsId }, select: { title: true } })
        : Promise.resolve(null),
    ])

    await streamToResponse(
      res,
      'blueprint-interview',
      blueprintInterviewSystem(kind, user?.personalContext ?? null, user?.assessment ?? null, goal?.title ?? null),
      messages,
    )
  } catch (err) {
    next(err)
  }
})

router.post('/blueprint-draft', async (req: AuthRequest, res, next) => {
  try {
    const { messages, kind } = z.object({
      messages: z.array(MessageSchema).min(2).max(60),
      kind: z.enum(['build', 'break']).default('build'),
    }).parse(req.body)

    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { personalContext: true, assessment: true },
    })

    const genAI = getGenAI()
    const draftSystem = `${kind === 'break' ? ATOMIZE_BREAK_SYSTEM : ATOMIZE_SYSTEM}

You are drafting from an INTERVIEW TRANSCRIPT, not a single sentence. Critical: quote the user's OWN phrases verbatim in the identityStatement, why, and cue fields wherever they said something usable. This blueprint must read like they wrote it — do not sand their voice into generic coach-speak.`

    const model = genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: draftSystem,
      generationConfig: {
        responseMimeType: 'application/json',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        responseSchema: atomizeSchemaFor(kind) as any,
      },
    })

    const transcript = messages.map((m) => `${m.role === 'user' ? 'USER' : 'INTERVIEWER'}: ${m.text}`).join('\n\n')
    const prompt = [
      `Interview transcript:\n\n${transcript}`,
      user?.personalContext ? `\nPersonal context about the user: ${user.personalContext}` : '',
      user?.assessment ? `\nTheir assessment: ${user.assessment}` : '',
    ].filter(Boolean).join('\n')

    const result = await model.generateContent(prompt)
    const blueprint = { kind, ...JSON.parse(result.response.text()) }
    res.json({ blueprint })
  } catch (err) {
    next(err)
  }
})

router.post('/atomize', async (req: AuthRequest, res, next) => {
  try {
    const { goal, kind } = z.object({
      goal: z.string().trim().min(3).max(500),
      kind: z.enum(['build', 'break']).default('build'),
    }).parse(req.body)

    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { personalContext: true },
    })

    const genAI = getGenAI()
    const model = genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: kind === 'break' ? ATOMIZE_BREAK_SYSTEM : ATOMIZE_SYSTEM,
      generationConfig: {
        responseMimeType: 'application/json',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        responseSchema: atomizeSchemaFor(kind) as any,
      },
    })

    const prompt = [
      kind === 'break' ? `Bad habit to break: ${goal}` : `Goal: ${goal}`,
      user?.personalContext ? `Personal context about the user: ${user.personalContext}` : '',
    ].filter(Boolean).join('\n')

    const result = await model.generateContent(prompt)
    const blueprint = { kind, ...JSON.parse(result.response.text()) }
    res.json({ blueprint })
  } catch (err) {
    next(err)
  }
})

// ── Synthesize ───────────────────────────────────────────────────────────────
// Reads the whole Vision Canvas (all note/quote text) and distils it into
// themes, candidate identity statements, and habits — closing the loop from
// "what I want" to "who that makes me" to "habits that vote for it".

const SYNTHESIZE_SYSTEM = `You are a perceptive life coach reading a person's Vision Canvas — a scattered board of notes, quotes, and reflections about the life they want.

Distil it into a clear picture of who they are becoming:
- themes: 2–4 recurring threads across their notes. Each has a short title and a one-sentence summary in their own spirit.
- identityStatements: 2–3 candidate identity statements in the form "I am someone who…" that capture who this person wants to be. Specific, present tense.
- suggestedGoals: 2–4 concrete goals (destinations, not habits) hiding in their canvas — where they want to end up. Each has a title ("Run a half marathon by 2027" not "go running"), a domain (one of health|career|relationships|money|mind), and a one-sentence why tied to their canvas.

Be specific to what's actually on their canvas — never generic. If the canvas is sparse, infer gently but stay grounded in what's there.`

const synthesizeSchema = {
  type: SchemaType.OBJECT,
  properties: {
    themes: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          title: { type: SchemaType.STRING },
          summary: { type: SchemaType.STRING },
        },
        required: ['title', 'summary'],
      },
    },
    identityStatements: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    suggestedGoals: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          title: { type: SchemaType.STRING },
          domain: { type: SchemaType.STRING, format: 'enum', enum: ['health', 'career', 'relationships', 'money', 'mind'] },
          why: { type: SchemaType.STRING },
        },
        required: ['title', 'domain', 'why'],
      },
    },
  },
  required: ['themes', 'identityStatements', 'suggestedGoals'],
} as const

router.post('/synthesize', async (req: AuthRequest, res, next) => {
  try {
    const { notes } = z.object({
      notes: z.array(z.string().trim().max(4000)).min(1).max(60),
    }).parse(req.body)

    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { personalContext: true },
    })

    const genAI = getGenAI()
    const model = genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: SYNTHESIZE_SYSTEM,
      generationConfig: {
        responseMimeType: 'application/json',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        responseSchema: synthesizeSchema as any,
      },
    })

    const prompt = [
      'Vision Canvas notes:',
      ...notes.filter((n) => n.trim()).map((n, i) => `${i + 1}. ${n}`),
      user?.personalContext ? `\nPersonal context about the user: ${user.personalContext}` : '',
    ].filter(Boolean).join('\n')

    const result = await model.generateContent(prompt)
    const synthesis = JSON.parse(result.response.text())
    res.json({ synthesis })
  } catch (err) {
    next(err)
  }
})

// ── Weekly check-in ──────────────────────────────────────────────────────────
// The workbook's CHECK-IN, as a short reflective conversation grounded in the
// user's ACTUAL week (so it can say "you showed up 5 of 7, Tuesday was the red
// dot"). Walks: rating → tiny victory → what's working/not → obstacles + plans.

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function safeParseJSON<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T } catch { return fallback }
}

// Compact, factual summary of the last 7 days per habit — the data pack the
// companion speaks from. Built here so the AI route stays self-contained.
// Count recorded "what got in the way" reasons per habit over a trailing
// window, e.g. Map habitId → [{reason: 'No time', count: 3}, …].
async function missReasonSummary(wsId: string, days: number): Promise<Map<string, { reason: string; count: number }[]>> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const missLogs = await prisma.habitLog.findMany({
    where: { habit: { workstationId: wsId }, status: 'miss', date: { gte: since } },
    select: { habitId: true, missReasons: true },
  })
  const perHabit = new Map<string, Map<string, number>>()
  for (const l of missLogs) {
    const reasons = safeParseJSON<string[]>(l.missReasons, [])
    if (!reasons.length) continue
    let counts = perHabit.get(l.habitId)
    if (!counts) { counts = new Map(); perHabit.set(l.habitId, counts) }
    for (const r of reasons) counts.set(r, (counts.get(r) ?? 0) + 1)
  }
  const out = new Map<string, { reason: string; count: number }[]>()
  for (const [habitId, counts] of perHabit) {
    out.set(habitId, [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count })))
  }
  return out
}

function formatObstacles(list: { reason: string; count: number }[], top = 4): string {
  return list.slice(0, top).map((o) => `${o.reason} ×${o.count}`).join(', ')
}

async function buildCheckinPack(wsId: string): Promise<string> {
  const now = Date.now()
  const week: string[] = []
  for (let i = 6; i >= 0; i--) week.push(new Date(now - i * 86_400_000).toISOString().slice(0, 10))

  const [habits, logs, goals, obstacles30d] = await Promise.all([
    prisma.habit.findMany({
      where: { workstationId: wsId, archivedAt: null, pausedAt: null },
      include: { goal: { select: { title: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.habitLog.findMany({
      where: { habit: { workstationId: wsId }, date: { gte: weekDatesOf(week[0])[0], lte: week[6] } },
    }),
    prisma.goal.findMany({ where: { workstationId: wsId, status: 'active' }, select: { title: true } }),
    missReasonSummary(wsId, 30),
  ])

  const logByHabitDate = new Map(logs.map((l) => [`${l.habitId}|${l.date}`, l]))
  const hitsByHabit = new Map<string, Set<string>>()
  for (const l of logs) {
    if (l.status === 'miss') continue
    let s = hitsByHabit.get(l.habitId)
    if (!s) { s = new Set(); hitsByHabit.set(l.habitId, s) }
    s.add(l.date)
  }
  const lines = habits.map((h) => {
    const sched = parseSchedule(h)
    const createdOn = h.createdAt.toISOString().slice(0, 10)
    const scheduledOn = new Map(
      resolveRange(sched, week[0], week[6], hitsByHabit.get(h.id) ?? new Set(), { createdOn })
        .map((d) => [d.date, d.scheduled])
    )
    let hits = 0, scheduled = 0
    const reds: string[] = []
    for (const date of week) {
      const wd = weekdayOf(date)
      if (!scheduledOn.get(date)) continue
      scheduled++
      const log = logByHabitDate.get(`${h.id}|${date}`)
      if (log && log.status !== 'miss') { hits++; continue }
      // Name what got in the way when the user recorded it for that day —
      // chips and/or the free-text note both count.
      const reasons = log ? safeParseJSON<string[]>(log.missReasons, []) : []
      const note = log?.missNote?.trim()
      const reasonBits = [
        reasons.length ? reasons.join(', ').toLowerCase() : '',
        note ? `note: "${note}"` : '',
      ].filter(Boolean).join('; ')
      reds.push(reasonBits ? `${WEEKDAY_NAMES[wd]} (reason: ${reasonBits})` : `${WEEKDAY_NAMES[wd]} (no reason given)`)
    }
    const goalBit = h.goal?.title ? ` (toward: ${h.goal.title})` : ''
    const redBit = reds.length ? `; missed ${reds.join(', ')}` : ''
    const topBit = obstacles30d.has(h.id)
      ? `\n  Top obstacles lately for "${h.title}": ${formatObstacles(obstacles30d.get(h.id)!)}`
      : ''
    // A weekly habit's denominator is reps owed, not days of the week it fell on.
    const unit = sched.type === 'weekly' ? `${scheduled} sessions (${sched.quota}× a week, any days)` : `${scheduled} scheduled days`
    return `- "${h.title}"${goalBit}: showed up ${hits} of ${unit}${redBit}${topBit}`
  })

  return [
    goals.length ? `Their active goals: ${goals.map((g) => g.title).join('; ')}.` : '',
    habits.length ? `This week, day by day:\n${lines.join('\n')}` : 'No active habits this week.',
  ].filter(Boolean).join('\n')
}

const CHECKIN_SYSTEM = `You are the weekly check-in companion inside a habit-building app called One Percent — the workbook's CHECK-IN, turned into a short, warm conversation. You have the user's REAL week in front of you (below). Use it: reference their actual numbers and red-dot days by name, and tie things back to their goals.

How you work:
- Ask ONE question at a time. Keep replies to 2–3 sentences, then the question.
- Open by reflecting their real week back warmly and honestly (name a specific win and, gently, a specific miss).
- Walk this arc: (1) how are things going, roughly 1–10? (2) one tiny victory, however small; (3) what's working, and what isn't; (4) the biggest obstacle and a concrete "if X, then I'll Y" plan for next week.
- When the week's data already names reasons for misses (e.g. "missed Tuesday (reason: tired)"), lead with the most frequent one rather than asking cold, and steer toward a concrete "if X, then I'll Y" plan for it.
- No guilt. A missed day is data, not failure — the mantra is never miss twice. Celebrate showing up.
- When you've covered the arc, tell them they can save the check-in.`

router.post('/checkin', async (req: AuthRequest, res, next) => {
  try {
    const { messages, wsId } = z.object({
      messages: z.array(MessageSchema).min(1).max(40),
      wsId: z.string().min(1),
    }).parse(req.body)

    await assertWorkstation(wsId, req.userId!)
    const pack = await buildCheckinPack(wsId)
    const system = `${CHECKIN_SYSTEM}\n\nTHE USER'S WEEK:\n"""\n${pack}\n"""`
    await streamToResponse(res, 'checkin', system, messages)
  } catch (err) {
    next(err)
  }
})

// One-shot: distil the check-in conversation to two plain sentences. Stored on
// the CheckIn and layered into coach context so the app remembers what was said.
router.post('/checkin-summary', async (req: AuthRequest, res, next) => {
  try {
    const { messages } = z.object({
      messages: z.array(MessageSchema).min(2).max(60),
    }).parse(req.body)

    const genAI = getGenAI()
    const model = genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: 'Summarise this weekly habit check-in in exactly two plain sentences, in the third person ("They…"). Capture how the week went, one concrete win or struggle, and any plan they made. No preamble.',
    })
    const transcript = messages.map((m) => `${m.role === 'user' ? 'USER' : 'COMPANION'}: ${m.text}`).join('\n\n')
    const result = await model.generateContent(transcript)
    res.json({ summary: result.response.text().trim() })
  } catch (err) {
    next(err)
  }
})

// ── Momentum insights ────────────────────────────────────────────────────────
// A natural-language read of the user's recent check-ins + miss reasons,
// regenerated after each check-in save and cached on the workstation so the
// Momentum page is a pure fast read.

async function buildInsightsPack(wsId: string): Promise<string> {
  const day30 = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
  const [checkins, missLogs, habits, goals] = await Promise.all([
    prisma.checkIn.findMany({ where: { workstationId: wsId }, orderBy: { weekOf: 'desc' }, take: 8 }),
    prisma.habitLog.findMany({
      where: { habit: { workstationId: wsId }, status: 'miss', date: { gte: day30 } },
      select: { date: true, missReasons: true, missNote: true, habit: { select: { title: true } } },
      orderBy: { date: 'desc' },
    }),
    prisma.habit.findMany({
      where: { workstationId: wsId, archivedAt: null },
      select: { title: true, pausedAt: true },
    }),
    prisma.goal.findMany({ where: { workstationId: wsId, status: 'active' }, select: { title: true } }),
  ])

  const checkinBlocks = checkins.map((c) => {
    if (c.status === 'skipped') return `Week of ${c.weekOf}: skipped the check-in.`
    const obstacles = safeParseJSON<{ obstacle: string; plan: string }[]>(c.obstacles, [])
    const bits = [
      c.rating != null ? `rated the week ${c.rating}/10` : '',
      c.tinyVictory ? `tiny victory: "${c.tinyVictory}"` : '',
      c.workingWell ? `working well: "${c.workingWell}"` : '',
      c.notWorking ? `not working: "${c.notWorking}"` : '',
      obstacles.length ? `plans: ${obstacles.map((o) => `if ${o.obstacle} then ${o.plan}`).join('; ')}` : '',
      c.aiSummary ? `summary: ${c.aiSummary}` : '',
    ].filter(Boolean)
    return `Week of ${c.weekOf}: ${bits.length ? bits.join('. ') : 'saved with no details.'}`
  })

  const missLines = missLogs.map((l) => {
    const reasons = safeParseJSON<string[]>(l.missReasons, [])
    const note = l.missNote?.trim()
    const why = [reasons.join(', '), note ? `note: "${note}"` : ''].filter(Boolean).join('; ')
    return `- "${l.habit.title}" missed ${l.date}${why ? ` (${why})` : ' (no reason given)'}`
  })

  return [
    goals.length ? `Active goals: ${goals.map((g) => g.title).join('; ')}.` : '',
    habits.length
      ? `Habits: ${habits.map((h) => `"${h.title}"${h.pausedAt ? ' (paused)' : ''}`).join(', ')}.`
      : 'No active habits.',
    checkinBlocks.length ? `Recent weekly check-ins (newest first):\n${checkinBlocks.join('\n')}` : 'No check-ins yet.',
    missLines.length ? `Missed days, last 30 days (newest first):\n${missLines.join('\n')}` : 'No recorded misses in the last 30 days.',
  ].filter(Boolean).join('\n\n')
}

const INSIGHTS_SYSTEM = `You are the reflective voice inside a habit-building app called One Percent. From the user's real check-in and miss data (below), write 3–5 short insights in plain, warm English — like a perceptive friend who has been reading their weekly reviews.

Rules:
- Each insight is 1–2 complete sentences, grounded in the ACTUAL data: the ratings trend, recurring obstacles (including free-text notes), wins worth repeating, and whether their if-then plans are holding up.
- Address the user as "you". No guilt — a missed day is data, not failure.
- Include at least one forward-looking suggestion they could act on next week.
- No markdown, no numbering, no headers — just the insight sentences.
- If the data is thin, say what you can honestly and keep it to 3 insights.`

router.post('/insights', async (req: AuthRequest, res, next) => {
  try {
    const { wsId } = z.object({ wsId: z.string().min(1) }).parse(req.body)
    await assertWorkstation(wsId, req.userId!)

    const pack = await buildInsightsPack(wsId)
    const genAI = getGenAI()
    const model = genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: INSIGHTS_SYSTEM,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            insights: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          },
          required: ['insights'],
        },
      },
    })
    const result = await model.generateContent(`THE USER'S DATA:\n"""\n${pack}\n"""`)
    const parsed = safeParseJSON<{ insights?: string[] }>(result.response.text(), {})
    const insights = (parsed.insights ?? []).filter((s) => typeof s === 'string' && s.trim()).slice(0, 5)

    const ws = await prisma.workstation.update({
      where: { id: wsId },
      data: { momentumInsights: JSON.stringify(insights), momentumInsightsAt: new Date() },
    })
    res.json({ insights, generatedAt: ws.momentumInsightsAt })
  } catch (err) {
    next(err)
  }
})

// ── Habit Coach ──────────────────────────────────────────────────────────────
// A conversational coach grounded in "Atomic Habits" (James Clear) via RAG: the
// book is pre-chunked and embedded into habit."BookChunk" (pgvector). Each turn
// we embed the user's question, pull the most relevant passages, and ground the
// answer in those — ~5k tokens per query instead of the whole 116k-token book.
// The user's own habits are layered in so advice applies to their real situation.

// Retrieve the book passages most relevant to a query, via cosine similarity.
async function retrieveBookPassages(query: string, k = 6): Promise<string> {
  const qVec = await embed(query)
  const rows = await prisma.$queryRawUnsafe<Array<{ content: string }>>(
    `SELECT content FROM habit."BookChunk" ORDER BY embedding <=> $1::vector LIMIT $2`,
    toVectorLiteral(qVec),
    k
  )
  return rows.map((r, i) => `[Passage ${i + 1}]\n${r.content}`).join('\n\n')
}

function coachSystem(userContext: string, passages: string): string {
  return `You are the Habit Coach inside a habit-building app called One Percent. You are an expert guide whose knowledge comes from one source only: the book "Atomic Habits" by James Clear. Below, between the BOOK markers, are the passages from that book most relevant to the user's current question — ground your answer in them.

How you work:
- Answer the user's questions about building habits, breaking habits, motivation, systems, and behaviour change using the ideas, frameworks, examples, and language from the book.
- Ground every answer in the passages provided. When you draw on a specific idea, name it the way the book does (e.g. the Four Laws of Behaviour Change, habit stacking, the two-minute rule, identity-based habits, the Goldilocks Rule, the Plateau of Latent Potential).
- Be concrete and practical. Prefer the book's own examples and turn them into a clear next step for the user.
- Keep replies focused and readable — usually 3–6 sentences or a short list. Warm, direct, encouraging. No fluff.
- If the passages don't address the user's question, you may still help from your general knowledge of the book and habit science, but clearly flag it — say something like "This goes a bit beyond what's in front of me from Atomic Habits, but…" so the user knows you've stepped outside the retrieved source.
- When the user's context names what's been getting in the way of a habit, address it directly — map the obstacle to the book's tools (e.g. "no time" → the two-minute rule / scaling the habit down; "forgot" → habit stacking and making the cue obvious; a recurring situation → an if-then implementation intention or environment design).
- Never invent quotes or page numbers. Never claim the book says something it doesn't.
${userContext ? `\nThe user's current habits and context (use this to make advice specific to them):\n${userContext}\n` : ''}
BOOK — relevant passages from "Atomic Habits" by James Clear:
"""
${passages || '(no passages retrieved)'}
"""`
}

// Compact summary of the user's habits to personalise coaching. Identity-framed
// title + why + the active phase's target, mirroring how habits are modelled.
function buildUserContext(
  habits: Array<{
    id: string
    title: string
    whyText: string | null
    failSafeAction: string
    phases: Array<{ phaseNumber: number; targetText: string; status: string }>
    goal?: { title: string } | null
  }>,
  personalContext: string | null,
  goals: Array<{ title: string }> = [],
  recentReflections: string[] = [],
  obstaclesByHabit: Map<string, { reason: string; count: number }[]> = new Map(),
): string {
  const parts: string[] = []
  if (personalContext?.trim()) parts.push(`About the user: ${personalContext.trim()}`)
  if (goals.length) parts.push(`Their bigger goals: ${goals.map((g) => g.title).join('; ')}.`)
  if (habits.length) {
    parts.push('Habits they are currently building:')
    habits.forEach((h, i) => {
      const active = h.phases.find((p) => p.status === 'ready') ?? h.phases.find((p) => p.status === 'active')
      const bits = [`${i + 1}. "${h.title}"`]
      if (h.goal?.title) bits.push(`— toward: ${h.goal.title}`)
      if (h.whyText?.trim()) bits.push(`— their why: ${h.whyText.trim()}`)
      if (active) bits.push(`— current step: ${active.targetText}`)
      bits.push(`— fail-safe: ${h.failSafeAction}`)
      const obstacles = obstaclesByHabit.get(h.id)
      if (obstacles?.length) bits.push(`— what's been getting in the way (last 30 days): ${formatObstacles(obstacles)}`)
      parts.push(bits.join(' '))
    })
  }
  if (recentReflections.length) {
    parts.push(`Recent weekly reflections (most recent first):\n${recentReflections.map((r) => `- ${r}`).join('\n')}`)
  }
  return parts.join('\n')
}

// A chat's title is derived from its first user message — no extra AI call.
function deriveTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= 60) return clean
  return `${clean.slice(0, 60).replace(/\s+\S*$/, '')}…`
}

router.post('/coach', async (req: AuthRequest, res, next) => {
  try {
    const { messages, wsId, conversationId } = z.object({
      messages: z.array(MessageSchema).min(1).max(30),
      wsId: z.string().min(1),
      conversationId: z.string().min(1).optional(),
    }).parse(req.body)

    await assertWorkstation(wsId, req.userId!)

    // When a conversation is given, confirm it belongs to this workstation so we
    // only ever persist into the user's own threads.
    const convo = conversationId
      ? await prisma.coachConversation.findFirst({ where: { id: conversationId, workstationId: wsId } })
      : null
    if (conversationId && !convo) { res.status(404).json({ error: 'Conversation not found' }); return }

    // The latest user turn drives retrieval.
    const query = messages[messages.length - 1].text

    const [user, habits, goals, recentCheckins, passages, obstaclesByHabit] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId! }, select: { personalContext: true } }),
      prisma.habit.findMany({
        where: { workstationId: wsId, archivedAt: null },
        include: { phases: true, goal: { select: { title: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.goal.findMany({ where: { workstationId: wsId, status: 'active' }, select: { title: true } }),
      prisma.checkIn.findMany({
        where: { workstationId: wsId, aiSummary: { not: null } },
        orderBy: { weekOf: 'desc' },
        take: 2,
        select: { aiSummary: true },
      }),
      retrieveBookPassages(query),
      missReasonSummary(wsId, 30),
    ])

    const reflections = recentCheckins.map((c) => c.aiSummary!).filter(Boolean)
    const userContext = buildUserContext(habits, user?.personalContext ?? null, goals, reflections, obstaclesByHabit)
    const full = await streamToResponse(res, 'coach', coachSystem(userContext, passages), messages)

    // Persist the exchange only on a successful reply — saving both turns
    // together avoids orphaned user messages when the stream errors.
    if (convo && full) {
      const now = new Date()
      await prisma.$transaction([
        prisma.coachMessage.create({ data: { conversationId: convo.id, role: 'user', text: query } }),
        prisma.coachMessage.create({ data: { conversationId: convo.id, role: 'model', text: full } }),
        prisma.coachConversation.update({
          where: { id: convo.id },
          data: {
            lastMessageAt: now,
            // First message names the chat; later turns leave the title alone.
            ...(convo.title === 'New chat' ? { title: deriveTitle(query) } : {}),
          },
        }),
      ])
    }
  } catch (err) {
    next(err)
  }
})

export default router
