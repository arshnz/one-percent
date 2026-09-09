// "What got in the way?" quick-pick chips. The defaults cover the common
// culprits; a habit's own setback-plan obstacles are merged in so the chips
// speak the user's language.

export const DEFAULT_MISS_REASONS = [
  'Tired',
  'No time',
  'Travel',
  'Forgot',
  'Sick',
  'Social event',
  'Low mood',
]

const MAX_CHIPS = 10

// Merge the default chips with a habit's setback-plan obstacles (JSON string of
// {obstacle, plan} pairs) and any extra strings, deduped case-insensitively.
export function mergeReasonChips(setbackPlansJson?: string | null, extra: string[] = []): string[] {
  let obstacles: string[] = []
  try {
    const plans = setbackPlansJson ? (JSON.parse(setbackPlansJson) as { obstacle?: string }[]) : []
    obstacles = plans.map((p) => (p.obstacle ?? '').trim()).filter(Boolean)
  } catch {
    // malformed JSON → just the defaults
  }

  const chips: string[] = []
  const seen = new Set<string>()
  for (const chip of [...obstacles, ...extra, ...DEFAULT_MISS_REASONS]) {
    const key = chip.toLowerCase()
    if (!chip || seen.has(key)) continue
    seen.add(key)
    // Setback obstacles can be sentences — keep chips tappable-short.
    chips.push(chip.length > 40 ? `${chip.slice(0, 40).replace(/\s+\S*$/, '')}…` : chip)
    if (chips.length >= MAX_CHIPS) break
  }
  return chips
}
