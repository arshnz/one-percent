// The subset of WearableDay columns a habit can be linked to and measured
// against. Shared by the metric-link routes, the effect analysis and the client,
// so "which numbers can this app reason about?" has exactly one answer.
//
// `direction` is what counts as an improvement. It drives the *phrasing* of a
// result — never the maths, which is direction-blind by design.

export const WEARABLE_METRICS = {
  restingHr: {
    label: 'Resting heart rate',
    // Mid-sentence form — never derive this with toLowerCase(), which would
    // flatten the acronyms below into "hrv".
    inline: 'resting heart rate',
    short: 'Resting HR',
    unit: 'bpm',
    direction: 'lower_better',
    // Fractional digits when showing a difference.
    precision: 1,
  },
  sleepMinutes: {
    label: 'Sleep duration',
    inline: 'sleep duration',
    short: 'Sleep',
    unit: 'min',
    direction: 'higher_better',
    precision: 0,
  },
  hrvNight: {
    label: 'Overnight HRV',
    inline: 'overnight HRV',
    short: 'HRV',
    unit: 'ms',
    direction: 'higher_better',
    precision: 1,
  },
  bodyBatteryHigh: {
    label: 'Body Battery peak',
    inline: 'Body Battery peak',
    short: 'Body Battery',
    unit: '',
    direction: 'higher_better',
    precision: 1,
  },
  stressAvg: {
    label: 'Average stress',
    inline: 'average stress',
    short: 'Stress',
    unit: '',
    direction: 'lower_better',
    precision: 1,
  },
} as const

export type WearableMetric = keyof typeof WEARABLE_METRICS

export const WEARABLE_METRIC_KEYS = Object.keys(WEARABLE_METRICS) as WearableMetric[]

export function isWearableMetric(s: string): s is WearableMetric {
  return Object.prototype.hasOwnProperty.call(WEARABLE_METRICS, s)
}
