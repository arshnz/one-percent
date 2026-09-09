import { addDays, format } from 'date-fns'

// "Snooze until tomorrow" for the weekly check-in card. Device-local on
// purpose: a snooze is a UI-nuisance control, not data — losing it on another
// device just shows the card again, which is harmless. Keyed by workstation;
// the stored weekOf must match the current check-in's weekOf, so a snooze
// self-expires when the week rolls over.
const key = (wsId: string) => `op:checkin-snooze:${wsId}`

export interface CheckinSnooze {
  weekOf: string
  until: string // local YYYY-MM-DD; snoozed while today < until
}

export function readSnooze(wsId: string): CheckinSnooze | null {
  try {
    const raw = localStorage.getItem(key(wsId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.weekOf === 'string' && typeof parsed?.until === 'string') return parsed
    return null
  } catch {
    return null
  }
}

export function writeSnooze(wsId: string, weekOf: string): CheckinSnooze {
  const snooze: CheckinSnooze = { weekOf, until: format(addDays(new Date(), 1), 'yyyy-MM-dd') }
  try { localStorage.setItem(key(wsId), JSON.stringify(snooze)) } catch { /* storage full/blocked — card just stays */ }
  return snooze
}

export function isSnoozed(snooze: CheckinSnooze | null, weekOf: string | undefined): boolean {
  if (!snooze || !weekOf) return false
  const today = format(new Date(), 'yyyy-MM-dd')
  return snooze.weekOf === weekOf && snooze.until > today
}
