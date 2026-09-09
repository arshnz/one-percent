import type { CueType, HabitKind } from '@/types'

// The shape the Architect form feeds the scorer. Kept loose so it can score a
// draft mid-edit, not just a complete habit.
export interface ConcretenessInput {
  kind: HabitKind
  title: string
  cueType: CueType
  anchorRoutine: string
  cueTime: string
  cueLocation: string
  failSafeAction: string
  targetText: string
  definitionOfDone: string
  celebration: string
  temptationBundle: string
  // Break-only fields (inverted Four Laws).
  avoidTrigger: string
  replacementAction: string
  frictionDevice: string
  needsTarget: boolean // false when editing a habit whose phase has graduated
}

export interface ConcretenessCheck {
  key: string
  label: string
  passed: boolean
  weight: number
  hint: string
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean)

// Does the fail-safe read like one genuinely tiny (<2 min) action? Mirrors the
// server's intent: short, single action, no conjunctions.
export function failSafeIsTiny(s: string): boolean {
  const t = s.trim()
  if (!t) return false
  return t.length <= 80 && words(t).length <= 12 && !/ and /i.test(t)
}

// A target is concrete when it names a measurable quantity — a number with a
// unit (mins, reps, pages, km…) or a clock duration.
export function targetIsMeasurable(s: string): boolean {
  // A digit plus a unit, allowing singular or "s"/"es" plurals (min/mins,
  // glass/glasses, page/pages…).
  return (
    /\d/.test(s) &&
    /\d\s*(min|minute|sec|second|hour|hr|rep|page|pp|km|mile|set|round|lap|glass|cup|bottle|serving|word|step|x|m)(?:es|s)?\b/i.test(s)
  )
}

// An identity statement should read as identity, not a to-do ("I am someone who…").
export function isIdentityPhrased(s: string): boolean {
  return /^\s*i\s*('?m| am|\s+am)\b|^\s*i\s+am\s+(a|an|someone|the kind)/i.test(s.trim())
}

function cueIsConcrete(i: ConcretenessInput): boolean {
  if (i.cueType === 'habit_stack') return words(i.anchorRoutine).length >= 2
  if (i.cueType === 'time') return /\d/.test(i.cueTime)
  if (i.cueType === 'location') return i.cueLocation.trim().length >= 2
  return false
}

// Build-habit guardrails — the original Four Laws made concrete.
function buildChecks(i: ConcretenessInput): ConcretenessCheck[] {
  const checks: ConcretenessCheck[] = [
    {
      key: 'identity',
      label: 'Identity-phrased name',
      passed: !!i.title.trim() && isIdentityPhrased(i.title),
      weight: 15,
      hint: 'Start with “I am someone who…” so the name names a person, not a task.',
    },
    {
      key: 'cue',
      label: 'Concrete cue',
      passed: cueIsConcrete(i),
      weight: 25,
      hint: 'Pin the trigger to a specific routine, a clock time, or a place.',
    },
    {
      key: 'failsafe',
      label: 'Two-minute fail-safe',
      passed: failSafeIsTiny(i.failSafeAction),
      weight: 20,
      hint: 'Shrink the gateway to one action you could do in under two minutes.',
    },
    {
      key: 'celebration',
      label: 'Chosen celebration',
      passed: !!i.celebration.trim(),
      weight: 10,
      hint: 'Pick a small immediate reward — it wires the habit in faster.',
    },
    {
      key: 'temptation',
      label: 'Temptation bundle',
      passed: !!i.temptationBundle.trim(),
      weight: 10,
      hint: 'Pair the habit with something you already enjoy — it makes starting attractive.',
    },
  ]
  if (i.needsTarget) {
    checks.push(
      {
        key: 'measurable',
        label: 'Measurable target',
        passed: targetIsMeasurable(i.targetText),
        weight: 15,
        hint: 'Give the target a number and unit (e.g. “Walk 15 mins”).',
      },
      {
        key: 'done',
        label: 'Definition of done',
        passed: !!i.definitionOfDone.trim(),
        weight: 15,
        hint: 'Name the exact finish line so there’s nothing to negotiate.',
      },
    )
  }
  return checks
}

// Break-habit guardrails — the Four Laws inverted (invisible, unattractive,
// difficult, unsatisfying) made concrete.
function breakChecks(i: ConcretenessInput): ConcretenessCheck[] {
  const checks: ConcretenessCheck[] = [
    {
      key: 'identity',
      label: 'Identity-phrased name',
      passed: !!i.title.trim() && isIdentityPhrased(i.title),
      weight: 15,
      hint: 'Frame it as freedom — “I am someone who is free of…”.',
    },
    {
      key: 'trigger',
      label: 'Trigger identified',
      passed: !!i.avoidTrigger.trim(),
      weight: 15,
      hint: 'Name the cue that sets the habit off — the thing to make invisible.',
    },
    {
      key: 'risk',
      label: 'Moment of risk',
      passed: cueIsConcrete(i),
      weight: 10,
      hint: 'Pin when the urge usually strikes — a time, a routine, or a place.',
    },
    {
      key: 'replacement',
      label: 'Replacement defined',
      passed: !!i.replacementAction.trim(),
      weight: 10,
      hint: 'Decide what you’ll do instead when the urge hits.',
    },
    {
      key: 'failsafe',
      label: 'Two-minute resist',
      passed: failSafeIsTiny(i.failSafeAction),
      weight: 10,
      hint: 'One tiny action to ride out the urge (e.g. “phone face-down, 3 breaths”).',
    },
    {
      key: 'friction',
      label: 'Friction device',
      passed: !!i.frictionDevice.trim(),
      weight: 15,
      hint: 'Add a barrier that makes the habit harder (a blocker, distance, a rule).',
    },
    {
      key: 'cost',
      label: 'Real cost named',
      passed: !!i.temptationBundle.trim(),
      weight: 10,
      hint: 'Name what this habit truly costs you — make it unattractive.',
    },
    {
      key: 'accountability',
      label: 'Accountability set',
      passed: !!i.celebration.trim(),
      weight: 10,
      hint: 'Pick an accountability hook — make a relapse unsatisfying.',
    },
  ]
  if (i.needsTarget) {
    checks.push({
      key: 'milestone',
      label: 'Clean-day milestone',
      passed: targetIsMeasurable(i.targetText),
      weight: 15,
      hint: 'Set a measurable milestone (e.g. “Stay scroll-free 14 days”).',
    })
  }
  return checks
}

export function scoreConcreteness(i: ConcretenessInput): {
  score: number
  checks: ConcretenessCheck[]
} {
  const checks = i.kind === 'break' ? breakChecks(i) : buildChecks(i)
  const totalWeight = checks.reduce((s, c) => s + c.weight, 0)
  const earned = checks.reduce((s, c) => s + (c.passed ? c.weight : 0), 0)
  const score = Math.round((earned / totalWeight) * 100)
  return { score, checks }
}
