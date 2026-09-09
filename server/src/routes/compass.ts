import { Router } from 'express'
import { z } from 'zod'
import { Prisma } from '../../generated/prisma/index.js'
import { prisma } from '../lib/prisma.js'
import { requireAuth, AuthRequest } from '../middleware/auth.js'
import { assertWorkstation } from '../lib/workstation.js'

// The Compass worksheet — the workbook's ABZ framework as a structured form.
// Each container keeps ONE autosaved working draft (Workstation.compassDraft),
// and that draft IS the live document: every save syncs its goals + assessment
// straight into the rest of the app (Launchpad, coaches, habits). Snapshots are
// optional, read-only, point-in-time copies you can look back on or Restore.

const router = Router({ mergeParams: true })
router.use(requireAuth)

const Domain = z.enum(['health', 'career', 'relationships', 'money', 'mind'])

// Kept permissive: autosave fires on partial forms, so nearly everything is
// optional. passthrough() means a future field can't 400 an in-flight draft.
const AssessmentForm = z.object({
  contentmentPersonal: z.number().nullable().optional(),
  contentmentPersonalWhy: z.string().optional(),
  contentmentProfessional: z.number().nullable().optional(),
  contentmentProfessionalWhy: z.string().optional(),
  priorities: z.array(z.string()).optional(),
  highQualityHours: z.string().optional(),
  workingWell: z.array(z.string()).optional(),
  notWorking: z.array(z.string()).optional(),
  obstacles: z.array(z.string()).optional(),
  pastStickyHabits: z.array(z.object({ habit: z.string(), whyItStuck: z.string() })).optional(),
}).passthrough()

const VisionForm = z.object({
  dreamBig: z.string().optional(),
  successMeaning: z.string().optional(),
  domainVisions: z.array(z.object({ domain: Domain, vision: z.string() })).optional(),
  timeline6mo: z.string().optional(),
  timeline2yr: z.string().optional(),
  timeline10yr: z.string().optional(),
  idealIdentity: z.string().optional(),
}).passthrough()

const GoalForm = z.object({
  // Stable client-generated id so a goal survives title edits. Optional for
  // legacy drafts/snapshots saved before ids existed (reconcile falls back to title).
  id: z.string().max(64).optional(),
  title: z.string().max(300),
  domain: Domain.default('health'),
  whyText: z.string().max(2000).optional(),
  timeframe: z.string().max(120).optional(),
  currentSystem: z.string().max(2000).optional(),
  idealSystem: z.string().max(2000).optional(),
}).passthrough()

const DraftSchema = z.object({
  assessment: AssessmentForm.optional(),
  vision: VisionForm.optional(),
  goals: z.array(GoalForm).max(20).optional(),
}).passthrough()

type Draft = z.infer<typeof DraftSchema>

// Derive the app-wide Assessment (stored as a JSON string on User.assessment)
// from a snapshot's stage-A form, so the coaches see the live worksheet.
function toAssessment(form: z.infer<typeof AssessmentForm>): string {
  const contentment: { domain: string; score: number }[] = []
  if (typeof form.contentmentPersonal === 'number') contentment.push({ domain: 'personal', score: form.contentmentPersonal })
  if (typeof form.contentmentProfessional === 'number') contentment.push({ domain: 'professional', score: form.contentmentProfessional })
  return JSON.stringify({
    contentment,
    priorities: (form.priorities ?? []).filter(Boolean),
    highQualityHours: form.highQualityHours ?? '',
    pastStickyHabits: (form.pastStickyHabits ?? []).filter((p) => p.habit?.trim()),
    obstacles: (form.obstacles ?? []).filter(Boolean),
    workingWell: (form.workingWell ?? []).filter(Boolean),
    notWorking: (form.notWorking ?? []).filter(Boolean),
    updatedAt: new Date().toISOString(),
  })
}

const norm = (s: string) => s.trim().toLowerCase()

// ── Working draft ────────────────────────────────────────────────────────────

router.get('/draft', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const ws = await prisma.workstation.findUnique({ where: { id: wsId }, select: { compassDraft: true } })
    res.json({ draft: ws?.compassDraft ?? null })
  } catch (err) { next(err) }
})

router.put('/draft', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const draft = DraftSchema.parse(req.body?.draft ?? req.body)
    await prisma.workstation.update({
      where: { id: wsId },
      data: { compassDraft: draft as Prisma.InputJsonValue },
    })
    // The draft is the live document — every save flows goals + assessment into
    // the rest of the app. No "make live" step.
    await syncWorksheet(wsId, req.userId!, draft)
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// ── Snapshots ────────────────────────────────────────────────────────────────

router.get('/snapshots', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    // List is metadata-only (+ goal count) — the full payload loads on demand.
    const rows = await prisma.compassSnapshot.findMany({
      where: { workstationId: wsId },
      select: { id: true, label: true, goals: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
    const snapshots = rows.map((r) => ({
      id: r.id,
      label: r.label,
      goalCount: Array.isArray(r.goals) ? r.goals.length : 0,
      createdAt: r.createdAt,
    }))
    res.json({ snapshots })
  } catch (err) { next(err) }
})

router.get('/snapshots/:id', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const snapshot = await prisma.compassSnapshot.findFirst({
      where: { id: req.params.id as string, workstationId: wsId },
    })
    if (!snapshot) { res.status(404).json({ error: 'Snapshot not found' }); return }
    res.json({ snapshot })
  } catch (err) { next(err) }
})

const CreateSchema = z.object({
  label: z.string().trim().max(120).optional(),
})

// Freeze the current live draft into an immutable, read-only history copy.
router.post('/snapshots', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const { label } = CreateSchema.parse(req.body)

    const ws = await prisma.workstation.findUnique({ where: { id: wsId }, select: { compassDraft: true } })
    const draft = DraftSchema.parse(ws?.compassDraft ?? {})

    const snapshot = await prisma.compassSnapshot.create({
      data: {
        workstationId: wsId,
        label: label || null,
        assessment: (draft.assessment ?? {}) as Prisma.InputJsonValue,
        vision: (draft.vision ?? {}) as Prisma.InputJsonValue,
        goals: (draft.goals ?? []) as Prisma.InputJsonValue,
      },
    })

    res.status(201).json({ snapshot })
  } catch (err) { next(err) }
})

// Restore a historic snapshot back into the live worksheet: copy its content
// onto the draft, then re-sync so goals + assessment match it.
router.post('/snapshots/:id/restore', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const snapshot = await prisma.compassSnapshot.findFirst({
      where: { id: req.params.id as string, workstationId: wsId },
    })
    if (!snapshot) { res.status(404).json({ error: 'Snapshot not found' }); return }
    const draft = DraftSchema.parse({
      assessment: snapshot.assessment ?? {},
      vision: snapshot.vision ?? {},
      goals: snapshot.goals ?? [],
    })
    await prisma.workstation.update({
      where: { id: wsId },
      data: { compassDraft: draft as Prisma.InputJsonValue },
    })
    await syncWorksheet(wsId, req.userId!, draft)
    res.json({ draft })
  } catch (err) { next(err) }
})

// Start fresh: shelve all compass goals, pause their linked habits (user's
// preference — keeps them visible but owed nothing), clear the user's
// assessment, and blank the worksheet draft.
router.post('/reset', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)

    const compassGoals = await prisma.goal.findMany({
      where: { workstationId: wsId, sourceNote: 'compass' },
      select: { id: true },
    })
    const goalIds = compassGoals.map((g) => g.id)

    await prisma.$transaction(async (tx) => {
      if (goalIds.length) {
        await tx.goal.updateMany({ where: { id: { in: goalIds } }, data: { status: 'shelved' } })
        // Pause (not archive) habits linked to those goals — recoverable.
        await tx.habit.updateMany({
          where: { goalId: { in: goalIds }, archivedAt: null, pausedAt: null },
          data: { pausedAt: new Date() },
        })
      }
      await tx.user.update({ where: { id: req.userId! }, data: { assessment: null } })
      await tx.workstation.update({ where: { id: wsId }, data: { compassDraft: Prisma.JsonNull } })
    })

    res.json({ ok: true })
  } catch (err) { next(err) }
})

router.delete('/snapshots/:id', async (req: AuthRequest, res, next) => {
  try {
    const wsId = req.params.wsId as string
    await assertWorkstation(wsId, req.userId!)
    const existing = await prisma.compassSnapshot.findFirst({
      where: { id: req.params.id as string, workstationId: wsId },
    })
    if (!existing) { res.status(404).json({ error: 'Snapshot not found' }); return }
    await prisma.compassSnapshot.delete({ where: { id: existing.id } })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// Sync the live worksheet draft into the app: write the assessment onto the
// User and reconcile compass-sourced Goals to match. Never deletes goals —
// absent ones are shelved so linked habits keep their goalId.
async function syncWorksheet(wsId: string, userId: string, draft: Draft) {
  const assessmentForm = AssessmentForm.parse(draft.assessment ?? {})
  const snapGoals = z.array(GoalForm).parse(draft.goals ?? []).filter((g) => g.title?.trim())

  const existing = await prisma.goal.findMany({
    where: { workstationId: wsId, sourceNote: 'compass' },
  })
  // Match on the stable compass goal id first; fall back to normalised title
  // only for legacy goals that predate ids (no sourceId), backfilling as we go.
  const existingById = new Map(existing.filter((g) => g.sourceId).map((g) => [g.sourceId as string, g]))
  const existingByTitleLegacy = new Map(existing.filter((g) => !g.sourceId).map((g) => [norm(g.title), g]))

  await prisma.$transaction(async (tx) => {
    // Assessment → the app-wide snapshot the coaches read.
    await tx.user.update({ where: { id: userId }, data: { assessment: toAssessment(assessmentForm) } })

    // Upsert the worksheet's goals; revive matches, create new ones. Track which
    // existing rows a worksheet goal claimed so the rest can be shelved.
    const claimed = new Set<string>()
    for (const g of snapGoals) {
      const match = (g.id && existingById.get(g.id)) || existingByTitleLegacy.get(norm(g.title))
      const data = {
        title: g.title.trim(),
        domain: g.domain,
        whyText: g.whyText?.trim() || null,
        timeframe: g.timeframe?.trim() || null,
        sourceId: g.id ?? match?.sourceId ?? null,
      }
      if (match && !claimed.has(match.id)) {
        claimed.add(match.id)
        await tx.goal.update({ where: { id: match.id }, data: { ...data, status: 'active' } })
      } else {
        await tx.goal.create({ data: { workstationId: wsId, sourceNote: 'compass', status: 'active', ...data } })
      }
    }

    // Compass goals absent from the worksheet → shelved (not deleted).
    const toShelve = existing.filter((g) => !claimed.has(g.id))
    if (toShelve.length) {
      await tx.goal.updateMany({ where: { id: { in: toShelve.map((g) => g.id) } }, data: { status: 'shelved' } })
    }
  })
}

export default router
