// Timezone-aware date/time helpers. All habit logging and reminder scheduling
// runs in the user's local time, never the server's.

// Local calendar date as YYYY-MM-DD in the given IANA timezone.
export function localDate(d: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(d)
  } catch {
    return new Intl.DateTimeFormat('en-CA').format(d)
  }
}

// Minutes since local midnight (0–1439) in the given timezone.
export function localTimeMinutes(d: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d)
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
    return h * 60 + m
  } catch {
    return d.getHours() * 60 + d.getMinutes()
  }
}

// Local weekday number (0=Sun..6=Sat) in the given timezone.
export function localWeekday(d: Date, timezone: string): number {
  // en-CA gives YYYY-MM-DD; constructing at local-noon avoids any DST edge.
  return new Date(localDate(d, timezone) + 'T12:00:00').getDay()
}

// The Monday (local) of the week containing `d`, as YYYY-MM-DD. The workbook's
// weeks run Monday→Sunday, so a check-in reviews the week that just ended.
export function localWeekStartMonday(d: Date, timezone: string): string {
  const today = localDate(d, timezone)
  const wd = new Date(today + 'T12:00:00').getDay() // 0=Sun..6=Sat
  const daysSinceMonday = (wd + 6) % 7              // Mon=0, Sun=6
  const base = new Date(today + 'T12:00:00')
  base.setDate(base.getDate() - daysSinceMonday)
  return base.toISOString().slice(0, 10)
}

// The last `n` local dates ending today (oldest first), each YYYY-MM-DD.
export function lastNDates(d: Date, timezone: string, n: number): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    out.push(localDate(new Date(d.getTime() - i * 86_400_000), timezone))
  }
  return out
}

// "HH:MM" → minutes since midnight, or null if malformed.
export function parseHHMM(t: string | null | undefined): number | null {
  if (!t) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim())
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}
