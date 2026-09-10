import type { WearableDay, WearableStatus, EffectResult, AvailableMetric, WearableMetric, User, Workstation, Habit, HabitToday, HabitLog, CreateHabitInput, Goldilocks, Momentum, CanvasNode, CanvasNodeType, StickyColor, AutomaticityState, AutomaticityResult, Phase, HabitBlueprint, CanvasSynthesis, CoachConversationSummary, CoachConversation, Goal, GoalDomain, GoalStatus, Assessment, CompassExtract, CheckIn, CheckInCurrent, SetbackPlan, CompassDraft, CompassSnapshot, CompassSnapshotSummary } from '@/types'
import { auth as firebaseAuth } from './firebase'
import { API_BASE } from './config'

const BASE = `${API_BASE}/api`

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  }

  if (firebaseAuth.currentUser) {
    const token = await firebaseAuth.currentUser.getIdToken()
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    const err = Object.assign(new Error(body.message ?? body.error ?? 'Request failed'), {
      status: res.status,
      code: body.error,
    })
    throw err
  }

  return res.json()
}

export const auth = {
  sync: (name?: string) =>
    request<{ user: User }>('/auth/sync', { method: 'POST', body: JSON.stringify({ name }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request<{ user: User }>('/auth/me'),
  updateMe: (data: { name?: string; timezone?: string; personalContext?: string; assessment?: Assessment; emailReminders?: boolean; pushReminders?: boolean }) =>
    request<{ user: User }>('/auth/me', { method: 'PATCH', body: JSON.stringify(data) }),
}

export const notifications = {
  vapidPublicKey: () => request<{ key: string }>('/notifications/vapid-public-key'),
  subscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    request<{ ok: boolean }>('/notifications/subscribe', { method: 'POST', body: JSON.stringify(sub) }),
  unsubscribe: (endpoint: string) =>
    request<{ ok: boolean }>('/notifications/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) }),
  testRun: () =>
    request<{
      reminders: { considered: number; sent: number; emails: number; pushes: number; pruned: number }
      digest: { considered: number; sent: number }
    }>('/notifications/test-run', { method: 'POST' }),
}

// Wearable data is owned by the user, not a workstation — the Body page works
// with no habits at all.
export const wearable = {
  days: (params: { from?: string; to?: string; days?: number } = {}) => {
    const q = new URLSearchParams()
    if (params.from) q.set('from', params.from)
    if (params.to) q.set('to', params.to)
    if (params.days) q.set('days', String(params.days))
    const qs = q.toString()
    return request<{ from: string; to: string; days: WearableDay[] }>(`/wearable/days${qs ? `?${qs}` : ''}`)
  },
  status: () => request<WearableStatus>('/wearable/status'),
  // Proxied through the server, which holds the collector's secret.
  syncNow: () => request<{ ok: boolean; detail: string }>('/wearable/sync-now', { method: 'POST' }),
}

// Whether a habit is associated with a change in a measured metric.
export const effect = {
  get: (wsId: string, habitId: string) =>
    request<{ results: EffectResult[] }>(`/workstations/${wsId}/habits/${habitId}/effect`),
  available: (wsId: string, habitId: string) =>
    request<{ metrics: AvailableMetric[] }>(`/workstations/${wsId}/habits/${habitId}/effect/available`),
  link: (wsId: string, habitId: string, metric: WearableMetric, lagDays = 1) =>
    request(`/workstations/${wsId}/habits/${habitId}/effect/link`, {
      method: 'PUT',
      body: JSON.stringify({ metric, lagDays }),
    }),
  unlink: (wsId: string, habitId: string, metric: WearableMetric) =>
    request(`/workstations/${wsId}/habits/${habitId}/effect/link?metric=${metric}`, { method: 'DELETE' }),
}

export const workstations = {
  list: () => request<{ workstations: Workstation[] }>('/workstations'),
}

export const habits = {
  today: (wsId: string) =>
    request<{ date: string; weekday: number; habits: HabitToday[] }>(`/workstations/${wsId}/habits/today`),
  list: (wsId: string) => request<{ habits: Habit[] }>(`/workstations/${wsId}/habits`),
  get: (wsId: string, id: string) => request<{ habit: HabitToday }>(`/workstations/${wsId}/habits/${id}`),
  create: (wsId: string, data: CreateHabitInput) =>
    request<{ habit: Habit }>(`/workstations/${wsId}/habits`, { method: 'POST', body: JSON.stringify(data) }),
  update: (wsId: string, id: string, data: Partial<Omit<CreateHabitInput, 'phase1'>>) =>
    request<{ habit: Habit }>(`/workstations/${wsId}/habits/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  remove: (wsId: string, id: string) =>
    request<{ ok: boolean }>(`/workstations/${wsId}/habits/${id}`, { method: 'DELETE' }),
  setPaused: (wsId: string, id: string, paused: boolean) =>
    request<{ habit: Habit }>(`/workstations/${wsId}/habits/${id}/pause`, {
      method: 'POST', body: JSON.stringify({ paused }),
    }),
  log: (wsId: string, habitId: string, data: { status?: 'target' | 'failsafe' | 'miss'; quantity?: number; goldilocks?: Goldilocks | null; date?: string; missReasons?: string[]; missNote?: string | null }) =>
    request<{ log: HabitLog; completedReps: number; ready: boolean }>(
      `/workstations/${wsId}/habits/${habitId}/logs`,
      { method: 'POST', body: JSON.stringify(data) }
    ),
  // Record "what got in the way" for a day (annotates the log, or backfills a
  // miss for a silently-skipped day) without touching status/quantity.
  logReason: (wsId: string, habitId: string, data: { date: string; reasons: string[]; note?: string | null }) =>
    request<{ log: HabitLog }>(`/workstations/${wsId}/habits/${habitId}/logs/reason`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  unlog: (wsId: string, habitId: string, date?: string) =>
    request<{ ok: boolean }>(
      `/workstations/${wsId}/habits/${habitId}/logs${date ? `?date=${date}` : ''}`,
      { method: 'DELETE' }
    ),
  automaticity: (wsId: string, habitId: string) =>
    request<AutomaticityState & { lastCheck: unknown }>(`/workstations/${wsId}/habits/${habitId}/automaticity`),
  submitCheck: (wsId: string, habitId: string, scores: number[]) =>
    request<AutomaticityResult & { advanced: boolean; nextPhaseNumber: number | null }>(
      `/workstations/${wsId}/habits/${habitId}/automaticity`,
      { method: 'POST', body: JSON.stringify({ scores }) }
    ),
  addPhase: (wsId: string, habitId: string, data: { targetText: string; definitionOfDone?: string | null; targetCount: number; dailyLimit?: number | null }) =>
    request<{ phase: Phase }>(`/workstations/${wsId}/habits/${habitId}/phases`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  updatePhase: (wsId: string, habitId: string, phaseId: string, data: { targetText?: string; definitionOfDone?: string | null; targetCount?: number; dailyLimit?: number | null }) =>
    request<{ phase: Phase }>(`/workstations/${wsId}/habits/${habitId}/phases/${phaseId}`, {
      method: 'PATCH', body: JSON.stringify(data),
    }),
  deletePhase: (wsId: string, habitId: string, phaseId: string) =>
    request<{ ok: boolean }>(`/workstations/${wsId}/habits/${habitId}/phases/${phaseId}`, {
      method: 'DELETE',
    }),
}

export const momentum = {
  get: (wsId: string) => request<Momentum>(`/workstations/${wsId}/momentum`),
}

export const goals = {
  list: (wsId: string) => request<{ goals: Goal[] }>(`/workstations/${wsId}/goals`),
  create: (wsId: string, data: { title: string; domain?: GoalDomain; whyText?: string | null; timeframe?: string | null; sourceNote?: string | null }) =>
    request<{ goal: Goal }>(`/workstations/${wsId}/goals`, { method: 'POST', body: JSON.stringify(data) }),
  update: (wsId: string, id: string, data: { title?: string; domain?: GoalDomain; whyText?: string | null; timeframe?: string | null; status?: GoalStatus }) =>
    request<{ goal: Goal }>(`/workstations/${wsId}/goals/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  remove: (wsId: string, id: string) =>
    request<{ ok: boolean }>(`/workstations/${wsId}/goals/${id}`, { method: 'DELETE' }),
}

export const compass = {
  getDraft: (wsId: string) =>
    request<{ draft: CompassDraft | null }>(`/workstations/${wsId}/compass/draft`),
  saveDraft: (wsId: string, draft: CompassDraft) =>
    request<{ ok: boolean }>(`/workstations/${wsId}/compass/draft`, { method: 'PUT', body: JSON.stringify({ draft }) }),
  listSnapshots: (wsId: string) =>
    request<{ snapshots: CompassSnapshotSummary[] }>(`/workstations/${wsId}/compass/snapshots`),
  getSnapshot: (wsId: string, id: string) =>
    request<{ snapshot: CompassSnapshot }>(`/workstations/${wsId}/compass/snapshots/${id}`),
  createSnapshot: (wsId: string, data: { label?: string }) =>
    request<{ snapshot: CompassSnapshot }>(`/workstations/${wsId}/compass/snapshots`, { method: 'POST', body: JSON.stringify(data) }),
  restoreSnapshot: (wsId: string, id: string) =>
    request<{ draft: CompassDraft }>(`/workstations/${wsId}/compass/snapshots/${id}/restore`, { method: 'POST' }),
  resetWorksheet: (wsId: string) =>
    request<{ ok: boolean }>(`/workstations/${wsId}/compass/reset`, { method: 'POST' }),
  deleteSnapshot: (wsId: string, id: string) =>
    request<{ ok: boolean }>(`/workstations/${wsId}/compass/snapshots/${id}`, { method: 'DELETE' }),
}

export const checkins = {
  list: (wsId: string) => request<{ checkIns: CheckIn[] }>(`/workstations/${wsId}/checkins`),
  current: (wsId: string) => request<CheckInCurrent>(`/workstations/${wsId}/checkins/current`),
  save: (wsId: string, data: { weekOf: string; rating?: number | null; tinyVictory?: string | null; workingWell?: string | null; notWorking?: string | null; obstacles?: SetbackPlan[]; freeform?: string | null; aiSummary?: string | null }) =>
    request<{ checkIn: CheckIn }>(`/workstations/${wsId}/checkins`, { method: 'POST', body: JSON.stringify(data) }),
  skip: (wsId: string, data: { weekOf: string }) =>
    request<{ checkIn: CheckIn }>(`/workstations/${wsId}/checkins/skip`, { method: 'POST', body: JSON.stringify(data) }),
}

export const ai = {
  atomize: (goal: string, kind: 'build' | 'break' = 'build') =>
    request<{ blueprint: HabitBlueprint }>('/ai/atomize', { method: 'POST', body: JSON.stringify({ goal, kind }) }),
  synthesize: (notes: string[]) =>
    request<{ synthesis: CanvasSynthesis }>('/ai/synthesize', { method: 'POST', body: JSON.stringify({ notes }) }),
  compassExtract: (messages: { role: 'user' | 'model'; text: string }[]) =>
    request<{ extract: CompassExtract }>('/ai/compass/extract', { method: 'POST', body: JSON.stringify({ messages }) }),
  checkinSummary: (messages: { role: 'user' | 'model'; text: string }[]) =>
    request<{ summary: string }>('/ai/checkin-summary', { method: 'POST', body: JSON.stringify({ messages }) }),
  generateInsights: (wsId: string) =>
    request<{ insights: string[]; generatedAt: string }>('/ai/insights', { method: 'POST', body: JSON.stringify({ wsId }) }),
}

export const coach = {
  listConversations: (wsId: string) =>
    request<{ conversations: CoachConversationSummary[] }>(`/workstations/${wsId}/coach/conversations`),
  createConversation: (wsId: string) =>
    request<{ conversation: CoachConversationSummary }>(`/workstations/${wsId}/coach/conversations`, { method: 'POST' }),
  getConversation: (wsId: string, id: string) =>
    request<{ conversation: CoachConversation }>(`/workstations/${wsId}/coach/conversations/${id}`),
  renameConversation: (wsId: string, id: string, title: string) =>
    request<{ conversation: CoachConversationSummary }>(`/workstations/${wsId}/coach/conversations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),
  deleteConversation: (wsId: string, id: string) =>
    request<{ ok: boolean }>(`/workstations/${wsId}/coach/conversations/${id}`, { method: 'DELETE' }),
}

export const canvas = {
  list: (wsId: string) => request<{ nodes: CanvasNode[] }>(`/workstations/${wsId}/canvas/nodes`),
  create: (wsId: string, data: { type: CanvasNodeType; content?: string; imageUrl?: string | null; x: number; y: number; color?: StickyColor }) =>
    request<{ node: CanvasNode }>(`/workstations/${wsId}/canvas/nodes`, { method: 'POST', body: JSON.stringify(data) }),
  update: (wsId: string, id: string, data: Partial<Pick<CanvasNode, 'content' | 'imageUrl' | 'x' | 'y' | 'width' | 'color'>>) =>
    request<{ node: CanvasNode }>(`/workstations/${wsId}/canvas/nodes/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  remove: (wsId: string, id: string) =>
    request<{ ok: boolean }>(`/workstations/${wsId}/canvas/nodes/${id}`, { method: 'DELETE' }),
}
