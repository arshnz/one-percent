import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import confetti from 'canvas-confetti'
import { format, isToday, isYesterday, addDays, nextMonday } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  if (isToday(d)) return 'Today'
  if (isYesterday(d)) return 'Yesterday'
  return format(d, 'MMM d')
}

export function getLocalDateString(date = new Date()): string {
  return format(date, 'yyyy-MM-dd')
}

/** Snooze target dates as local "YYYY-MM-DD" strings, comparable to getLocalDateString(). */
export function snoozeInDays(n: number): string {
  return getLocalDateString(addDays(new Date(), n))
}

export function snoozeTomorrow(): string {
  return snoozeInDays(1)
}

/** Next Monday (always a future Monday — today never counts even if it's Monday). */
export function snoozeNextMonday(): string {
  return getLocalDateString(nextMonday(new Date()))
}

/**
 * Calculate target sessions from energy level and available minutes.
 * Session length is fixed at 25 min + 5 min break = 30 min per session slot.
 * Energy determines session density per 90-min block.
 */
export function calcTargetSessions(
  energyLevel: number,
  unallocatedMinutes: number,
  sessionMins = 25,
  breakMins = 5
): number {
  if (unallocatedMinutes < sessionMins) return 0

  const slotMins = sessionMins + breakMins
  const blocks90 = unallocatedMinutes / 90

  const densityPerBlock = [0, 1, 2, 2, 3, 3][energyLevel] ?? 2

  // Bonus session if more than 2 blocks and energy ≥ 3
  const bonus = blocks90 > 2 && energyLevel >= 3 ? 1 : 0

  // Cap by actual available time
  const maxByTime = Math.floor(unallocatedMinutes / slotMins)
  const target = Math.min(Math.round(blocks90 * densityPerBlock) + bonus, maxByTime)

  return Math.max(target, 1)
}

/** Midpoint ordering — returns value between a and b */
export function midpoint(a: number, b: number): number {
  return (a + b) / 2
}

/** Days since a date string (rounded down). */
export function daysAgo(dateStr: string): number {
  const ms = Date.now() - new Date(dateStr).getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

/** Default staleness thresholds (days). */
export const STALE_DEFAULTS = { kanban: 7, backlog: 14 }

export function getStaleThresholds() {
  return {
    kanban: parseInt(localStorage.getItem('ff_stale_kanban') ?? String(STALE_DEFAULTS.kanban), 10),
    backlog: parseInt(localStorage.getItem('ff_stale_backlog') ?? String(STALE_DEFAULTS.backlog), 10),
  }
}

/** Format minutes as "Xh Ym" or "Xm" */
export function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** Bell tone via Web Audio API. Call after a user gesture. */
export function playChime() {
  try {
    const ctx = new AudioContext()
    const now = ctx.currentTime

    // Two harmonics: 432 Hz + 864 Hz
    const freqs = [432, 864]
    for (const freq of freqs) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now)
      gain.gain.setValueAtTime(0.3 / freqs.length, now)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.5)
      osc.start(now)
      osc.stop(now + 2.5)
    }
  } catch {
    // Audio blocked or not supported — silent fallback
  }
}

/** Trigger confetti release */
export function triggerConfetti() {
  confetti({
    particleCount: 100,
    spread: 70,
    origin: { y: 0.6 },
    // Graphite tones + one muted green (the single positive signal)
    colors: ['#2f2f2c', '#6e6e68', '#aeaea7', '#3f6b4d']
  })
}

/**
 * Curated 6-color palette for habit accents.
 * Muted, premium tones that complement the graphite design system.
 * Deterministic: same habitId always → same color.
 */
const HABIT_PALETTE = [
  { border: '#5B7F95', bg: '#5B7F950F', text: '#5B7F95', name: 'slate' },    // Muted steel blue
  { border: '#8B6E4E', bg: '#8B6E4E0F', text: '#8B6E4E', name: 'umber' },    // Warm brown
  { border: '#6B8F71', bg: '#6B8F710F', text: '#6B8F71', name: 'sage' },      // Sage green
  { border: '#9B7EA4', bg: '#9B7EA40F', text: '#9B7EA4', name: 'lavender' },  // Muted purple
  { border: '#C2855A', bg: '#C2855A0F', text: '#C2855A', name: 'amber' },     // Warm amber
  { border: '#7A9EA0', bg: '#7A9EA00F', text: '#7A9EA0', name: 'teal' },      // Dusty teal
] as const

export type HabitColor = typeof HABIT_PALETTE[number]

export function getHabitColor(habitId: string): HabitColor {
  // Simple hash of habitId to pick a stable color index
  let hash = 0
  for (let i = 0; i < habitId.length; i++) {
    hash = ((hash << 5) - hash + habitId.charCodeAt(i)) | 0
  }
  return HABIT_PALETTE[Math.abs(hash) % HABIT_PALETTE.length]
}

