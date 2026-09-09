// A miss counts as "explained" when the user recorded either reason chips or a
// free-text note for that day — the day-of MissReasonSheet allows note-only
// saves, so every consumer of "does this miss still need a reason?" must check
// both fields, not just the chips.
export function hasMissExplanation(missReasons: string, missNote: string | null | undefined): boolean {
  let reasons: string[] = []
  try {
    const parsed = JSON.parse(missReasons)
    if (Array.isArray(parsed)) reasons = parsed
  } catch { /* malformed → treat as no chips */ }
  return reasons.length > 0 || !!missNote?.trim()
}
