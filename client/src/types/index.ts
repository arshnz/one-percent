export interface User {
  id: string
  email: string
  name: string | null
  timezone: string
  personalContext: string | null
  // Compass assessment snapshot (JSON string of Assessment) — see Assessment.
  assessment: string | null
  emailReminders: boolean
  pushReminders: boolean
}

// ── The Compass (ABZ framework) ──────────────────────────────────────────────
export type GoalDomain = 'health' | 'career' | 'relationships' | 'money' | 'mind'
export type GoalStatus = 'active' | 'achieved' | 'shelved'

export interface Goal {
  id: string
  workstationId: string
  title: string
  domain: GoalDomain
  whyText: string | null
  timeframe: string | null
  sourceNote: string | null
  status: GoalStatus
  createdAt: string
  updatedAt: string
  habits?: { id: string; title: string }[]
}

// Stage-A snapshot of the user's current reality, stored on User.assessment.
export interface Assessment {
  contentment?: { domain: string; score: number }[]
  priorities?: string[]
  highQualityHours?: string
  pastStickyHabits?: { habit: string; whyItStuck: string }[]
  obstacles?: string[]
  workingWell?: string[]
  notWorking?: string[]
  updatedAt?: string
}

// ── The Compass worksheet ────────────────────────────────────────────────────
// The ABZ framework rendered as a structured form the user fills in directly.
// A working draft autosaves per container; "Save snapshot" freezes it.

// Stage A · Your Current Reality
export interface CompassAssessmentForm {
  contentmentPersonal?: number | null
  contentmentPersonalWhy?: string
  contentmentProfessional?: number | null
  contentmentProfessionalWhy?: string
  priorities?: string[]
  highQualityHours?: string
  workingWell?: string[]
  notWorking?: string[]
  obstacles?: string[]
  pastStickyHabits?: { habit: string; whyItStuck: string }[]
}

// Stage Z · Where You Want to End Up
export interface CompassVision {
  dreamBig?: string
  successMeaning?: string
  domainVisions?: { domain: GoalDomain; vision: string }[]
  timeline6mo?: string
  timeline2yr?: string
  timeline10yr?: string
  idealIdentity?: string
}

// A concrete goal in the worksheet (Z + the B stage's system fields).
export interface CompassGoalForm {
  // Stable client-generated id so a goal survives title edits (reconciliation
  // matches on this, not the title). Optional for drafts saved before ids.
  id?: string
  title: string
  domain: GoalDomain
  whyText?: string
  timeframe?: string
  currentSystem?: string
  idealSystem?: string
}

export interface CompassDraft {
  assessment?: CompassAssessmentForm
  vision?: CompassVision
  goals?: CompassGoalForm[]
}

// Full frozen snapshot (GET /snapshots/:id).
export interface CompassSnapshot {
  id: string
  workstationId: string
  label: string | null
  assessment: CompassAssessmentForm
  vision: CompassVision
  goals: CompassGoalForm[]
  createdAt: string
}

// List-row metadata (GET /snapshots).
export interface CompassSnapshotSummary {
  id: string
  label: string | null
  goalCount: number
  createdAt: string
}

// ── Weekly check-in ──────────────────────────────────────────────────────────
export interface CheckIn {
  id: string
  workstationId: string
  weekOf: string
  rating: number | null
  tinyVictory: string | null
  workingWell: string | null
  notWorking: string | null
  obstacles: string // JSON array of SetbackPlan pairs
  freeform: string | null
  aiSummary: string | null
  // 'skipped' = the user dismissed the week rather than reviewing it.
  status: 'completed' | 'skipped'
  createdAt: string
  updatedAt: string
}

// A missed scheduled day this week with no "what got in the way" recorded yet.
export interface UnexplainedMiss {
  habitId: string
  habitTitle: string
  date: string
  weekdayName: string
  obstacles: string[] // the habit's setback-plan obstacles, for chip seeding
}

// The data pack behind /checkins/current — this week's real behaviour.
export interface CheckInCurrent {
  weekOf: string
  existing: CheckIn | null
  // `scheduled` is scheduled days for a fixed habit, reps owed for a weekly one.
  summary: { title: string; goalTitle: string | null; scheduleType: ScheduleType; scheduled: number; hits: number; redDots: string[] }[]
  unexplainedMisses: UnexplainedMiss[]
  goals: string[]
  priorObstacles: SetbackPlan[]
}

// Structured output of /ai/compass/extract over the Compass transcript.
export interface CompassExtract {
  assessment: Assessment
  goals: { title: string; domain: GoalDomain; whyText: string; timeframe: string }[]
  habitDraft: { roughSentence: string; goalIndex: number; kind: 'build' | 'break' }
}

export interface Workstation {
  id: string
  userId: string
  name: string
  createdAt: string
}

export type PhaseStatus = 'active' | 'locked' | 'ready' | 'graduated'

export interface Phase {
  id: string
  habitId: string
  phaseNumber: number
  targetText: string
  definitionOfDone: string | null
  targetCount: number
  dailyLimit: number | null
  status: PhaseStatus
  createdAt: string
  updatedAt: string
}

export type CueType = 'habit_stack' | 'time' | 'location'

// 'build' = grow a good habit (original 4 laws); 'break' = quit a bad one (inverted).
export type HabitKind = 'build' | 'break'
// How a break habit is tracked: a daily clean-day vote, or a count under a limit.
export type BreakMode = 'abstain' | 'taper'

export type LogStatus = 'target' | 'failsafe' | 'miss'
export type Goldilocks = 'too_easy' | 'just_right' | 'too_hard'
// How the daily check-in is presented on the card: hold-to-vote, or a
// yes-or-no question ("Did I sleep 8 hours last night?").
export type CheckStyle = 'hold' | 'yesno'

export interface HabitLog {
  id: string
  habitId: string
  phaseId: string | null
  date: string
  status: LogStatus
  quantity: number | null
  goldilocks: Goldilocks | null
  missReasons: string // JSON array of "what got in the way" chip strings
  missNote: string | null
  createdAt: string
}

// Workbook "Prepare for Setbacks": an if/then recovery pair.
export interface SetbackPlan {
  obstacle: string
  plan: string
}

export type ScheduleType = 'days' | 'weekly'

// Week-to-date state of a 'weekly' quota habit, computed server-side. Null for
// fixed-day habits — the client never resolves a schedule itself.
export interface WeekProgress {
  /** Reps owed this week, prorated down if the habit is younger than the week. */
  quota: number
  hits: number
  remaining: number
  /** Days left in the Mon–Sun week, today included. */
  daysLeft: number
  /** remaining >= daysLeft — the buffer is gone, today is a must. */
  obligatedToday: boolean
}

// One day of the never-miss-twice strip (last 7 days, today last).
export interface WeekStripDay {
  date: string
  scheduled: boolean
  status: LogStatus | null
  // True for days you can still correct from the strip (creation → today).
  editable?: boolean
}

export interface Habit {
  id: string
  workstationId: string
  // The goal this habit is the next step toward (ABZ: this habit is B).
  goalId: string | null
  goal?: { id: string; title: string } | null
  kind: HabitKind
  breakMode: BreakMode | null
  avoidTrigger: string | null
  replacementAction: string | null
  frictionDevice: string | null
  checkStyle: CheckStyle
  checkQuestion: string | null
  title: string
  whyText: string | null
  whyImageUrl: string | null
  cueType: CueType
  anchorRoutine: string | null
  cueTime: string | null
  cueLocation: string | null
  failSafeAction: string
  celebration: string | null
  temptationBundle: string | null
  // 'days' = fixed weekdays (scheduleDays) | 'weekly' = timesPerWeek on any days.
  scheduleType: ScheduleType
  scheduleDays: string // JSON array of weekday numbers — 'days' mode only
  timesPerWeek: number | null // 1–6 — 'weekly' mode only
  reminderTime: string | null
  reminderEnabled: boolean
  nightstandRule: string | null
  setbackPlans: string // JSON array of SetbackPlan pairs
  systemFocusConfirmed: boolean
  sectionNotes: string // JSON SectionNotes object
  pausedAt: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  phases: Phase[]
}

// Free-text notes per worksheet section — the user's own tactics beyond the
// structured blocks. Stored as a JSON string on Habit.sectionNotes.
export interface SectionNotes {
  cue?: string
  craving?: string
  response?: string
  reward?: string
  setbacks?: string
}

export interface AutomaticityState {
  eligible: boolean
  due: boolean
}

// Shape returned by GET /habits/today and GET /habits/:id
export interface HabitToday extends Habit {
  activePhase: Phase | null
  completedReps: number
  todayLog: HabitLog | null
  automaticity: AutomaticityState
  wasPreviousMissed?: boolean
  // The missed previous scheduled day, when it still needs a "what got in the
  // way" — drives the next-day catch-up on the card.
  previousMissDate?: string | null
  previousMissNeedsReason?: boolean
  weekStrip?: WeekStripDay[]
  // Present only for scheduleType 'weekly'. The card reads this instead of
  // parsing scheduleDays.
  weekProgress?: WeekProgress | null
}

export interface AutomaticityResult {
  passed: boolean
  mean: number
}

// ── Momentum ─────────────────────────────────────────────────────────────────
export interface Contribution {
  date: string
  count: number
  wasSavedMiss?: boolean
  status?: 'target' | 'failsafe'
  scheduled?: boolean
  missReasons?: string[]
}

export interface TrajectoryPhase {
  phaseNumber: number
  targetText: string
  targetCount: number
  status: PhaseStatus
  graduatedAt: string | null
}

export interface ConsistencyScore {
  consistency: number
  rhythm: number
  anchoring: number | null
}

export interface AutomaticityPoint {
  habitId: string
  mean: number
  passed: boolean
  createdAt: string
}

export interface WeeklyRating {
  weekOf: string
  rating: number | null
}

export interface Momentum {
  totalVotes: number
  totalRecoveries: number
  consistency: {
    consistency: number
    rhythm: number
    anchoring: number | null
  }
  automaticity: AutomaticityPoint[]
  weeklyRatings: WeeklyRating[]
  ratio: {
    successes: number
    expected: number
    pct: number
    windowDays: number
  }
  contributions: Contribution[]
  trajectory: {
    habitId: string
    title: string
    kind: HabitKind
    breakMode: BreakMode | null
    paused: boolean
    pausedAt: string | null
    scheduleType: ScheduleType
    // JSON array of weekday ints, e.g. "[1,3,5]" — 'days' mode only
    scheduleDays: string
    timesPerWeek: number | null
    createdAt: string
    consistency: { rhythm: number; anchoring: number | null; consistency: number }
    contributions: Contribution[]
    phases: { phaseNumber: number; targetText: string; targetCount: number; status: string; graduatedAt: string | null }[]
    topObstacles: { reason: string; count: number }[]
    missPattern: string | null
    setbackObstacles: string[]
  }[]
  // Deleted/retired habits — kept only to feed the compound curve, frozen at
  // their archive date. Not rendered as cards; not part of any current-state
  // metric or the projection.
  archived: {
    contributions: Contribution[]
    createdAt: string
    pausedAt: string | null
    archivedAt: string | null
  }[]
  habitCount: number
  topObstacle: { reason: string; count: number } | null
  // Cached natural-language read of recent check-ins + miss reasons —
  // regenerated after each check-in save, null until the first one lands.
  insights: { items: string[]; generatedAt: string } | null
}

// ── Vision Canvas ────────────────────────────────────────────────────────────
export type CanvasNodeType = 'text' | 'quote' | 'note' | 'image'
export type StickyColor = 'yellow' | 'blue' | 'green' | 'pink' | 'plain'

export interface CanvasNode {
  id: string
  workstationId: string
  type: CanvasNodeType
  content: string
  imageUrl: string | null
  x: number
  y: number
  width: number
  color: StickyColor
  createdAt: string
  updatedAt: string
}

// ── Habit Coach ──────────────────────────────────────────────────────────────
export interface CoachConversationSummary {
  id: string
  title: string
  createdAt: string
  lastMessageAt: string
}

export interface CoachMessage {
  role: 'user' | 'model'
  text: string
}

export interface CoachConversation extends CoachConversationSummary {
  messages: CoachMessage[]
}

export interface PhaseInput {
  targetText: string
  definitionOfDone?: string | null
  targetCount: number
  dailyLimit?: number | null
}

export interface CreateHabitInput {
  kind?: HabitKind
  goalId?: string | null
  breakMode?: BreakMode | null
  avoidTrigger?: string | null
  replacementAction?: string | null
  frictionDevice?: string | null
  checkStyle?: CheckStyle
  checkQuestion?: string | null
  title: string
  whyText?: string | null
  whyImageUrl?: string | null
  cueType: CueType
  anchorRoutine?: string | null
  cueTime?: string | null
  cueLocation?: string | null
  failSafeAction: string
  celebration?: string | null
  temptationBundle?: string | null
  scheduleType?: ScheduleType
  scheduleDays?: number[]
  timesPerWeek?: number | null
  reminderTime?: string | null
  reminderEnabled?: boolean
  nightstandRule?: string | null
  setbackPlans?: SetbackPlan[]
  systemFocusConfirmed?: boolean
  sectionNotes?: SectionNotes
  // The pre-mapped phase ladder: first step active, the rest locked.
  phases: PhaseInput[]
}

// Structured output from the Vision Canvas synthesis.
export interface CanvasSynthesis {
  themes: { title: string; summary: string }[]
  identityStatements: string[]
  // Destinations hiding in the canvas — saved as Goals, which habits then serve.
  suggestedGoals: { title: string; domain: GoalDomain; why: string }[]
}

// Structured output from the Atomizer AI — pre-fills the whole Architect form.
// Break-only fields are empty strings / omitted for build blueprints.
export interface HabitBlueprint {
  kind?: HabitKind
  breakMode?: BreakMode
  identityStatement: string
  why: string
  cueType: CueType
  anchorRoutine: string
  cueTime: string
  cueLocation: string
  failSafeAction: string
  celebration: string
  temptationBundle?: string
  nightstandRule?: string
  avoidTrigger?: string
  replacementAction?: string
  frictionDevice?: string
  phases: { targetText: string; definitionOfDone: string; targetCount: number; dailyLimit?: number }[]
}

// ── Wearables ────────────────────────────────────────────────────────────────
// One recorded day from a wearable (Garmin today). Every field is nullable and
// days can be missing entirely: the watch comes off, and a chart that quietly
// interpolates over a gap is lying about what was measured.
export interface WearableDay {
  date: string
  sleepMinutes: number | null
  deepMinutes: number | null
  remMinutes: number | null
  sleepScore: number | null
  restingHr: number | null
  hrvNight: number | null
  bodyBatteryHigh: number | null
  bodyBatteryLow: number | null
  stressAvg: number | null
  respirationAvg: number | null
  steps: number | null
  activeMinutes: number | null
}

// The metrics a habit can be measured against. Mirrors WEARABLE_METRICS in
// server/src/lib/wearableMetrics.ts.
export type WearableMetric =
  | 'restingHr'
  | 'sleepMinutes'
  | 'hrvNight'
  | 'bodyBatteryHigh'
  | 'stressAvg'

export interface WearableStatus {
  connected: boolean
  totalDays: number
  firstDate: string | null
  lastSyncedAt: string | null
  lastDate: string | null
  status: 'ok' | 'error' | null
  error: string | null
}

// ── Habit effect ─────────────────────────────────────────────────────────────
// "Does this habit move this number?" See server/src/lib/habitEffect.ts.
// `sentence` is already correctly hedged for display — render it verbatim
// rather than composing a stronger claim from the raw numbers.
export type EffectVerdict = 'insufficient' | 'no_effect' | 'associated'

export interface EffectResult {
  metric: WearableMetric
  label: string
  unit: string
  lagDays: number
  windowDays: number
  hit: { n: number; median: number }
  miss: { n: number; median: number }
  difference: number
  pValue: number
  verdict: EffectVerdict
  improved: boolean | null
  needMoreDays?: number
  sentence: string
}

export interface AvailableMetric {
  key: WearableMetric
  label: string
  short: string
  unit: string
  direction: 'lower_better' | 'higher_better'
  linked: boolean
}
