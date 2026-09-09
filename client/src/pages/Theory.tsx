import { BookOpen, TrendingUp, Mountain, Cog, Fingerprint, Repeat, Scale } from 'lucide-react'
import type { ReactNode } from 'react'
import { LearningTabs } from '@/components/layout/LearningTabs'

/**
 * A static refresher of "The Science of Habit" — the theory chapter that opens
 * the Atomic Habits Workbook. Everything else in the app (Compass, Coach,
 * Check-in, build/break habits) is built on these mental models, so they live
 * here as an always-available reference. No data, no state — pure content.
 */

function Eyebrow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-accent">
      {icon}
      <span className="text-[11px] font-semibold uppercase tracking-widest">{children}</span>
    </div>
  )
}

function Card({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card md:p-6">
      {children}
    </section>
  )
}

function Heading({ children }: { children: ReactNode }) {
  return <h2 className="font-display text-xl font-semibold tracking-tight text-text-1">{children}</h2>
}

function Quote({ children }: { children: ReactNode }) {
  return (
    <blockquote className="mt-4 border-l-2 border-accent pl-4 font-display text-[15px] italic leading-relaxed text-text-2">
      {children}
    </blockquote>
  )
}

/* ── Graphs ──────────────────────────────────────────────────────────────── */

// Redrawn from the book's own sketch: a flat "1% improvement" baseline, a
// rising curve above it, and a declining curve below — axes labelled RESULTS
// only (no x-axis label in the original).
function CompoundingGraph() {
  const w = 520
  const h = 240
  const x0 = 40
  const y0 = h - 60
  const right = w - 20
  const top = 20
  const up: string[] = []
  const down: string[] = []
  const n = 60
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = x0 + t * (right - x0)
    const yUp = y0 - Math.pow(t, 2.4) * (y0 - top)
    const yDown = y0 + Math.pow(t, 0.55) * (h - 20 - y0)
    up.push(`${x.toFixed(1)},${yUp.toFixed(1)}`)
    down.push(`${x.toFixed(1)},${yDown.toFixed(1)}`)
  }
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-4 h-auto w-full" role="img" aria-label="1 percent improvement compounds upward over time while 1 percent decline compounds downward, drawn from the book's own sketch">
      {/* axes */}
      <line x1={x0} y1={top} x2={x0} y2={h - 20} className="stroke-text-1" strokeWidth="2" />
      <line x1={x0} y1={h - 20} x2={right} y2={h - 20} className="stroke-text-1" strokeWidth="2" />
      <text x={x0 + 8} y={top + 4} className="fill-text-1 text-[11px] font-semibold">RESULTS</text>
      {/* 1% improvement baseline (dashed) */}
      <line x1={x0} y1={y0} x2={right - 10} y2={y0} className="stroke-text-1" strokeWidth="2" strokeDasharray="6 5" />
      <text x={x0 + 4} y={y0 - 8} className="fill-text-1 text-[11px] font-semibold">1% IMPROVEMENT</text>
      <text x={x0 + 4} y={y0 + 22} className="fill-text-1 text-[11px] font-semibold">1% DECLINE</text>
      {/* growth curve */}
      <polyline points={up.join(' ')} fill="none" className="stroke-text-1" strokeWidth="2.5" strokeLinecap="round" />
      {/* decline curve */}
      <polyline points={down.join(' ')} fill="none" className="stroke-text-1" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

// Redrawn from the book's own sketch: a straight "what you think should
// happen" line, and an actual results curve that dips into the Valley of
// Disappointment before breaking upward past it.
function PlateauGraph() {
  const w = 520
  const h = 300
  const x0 = 40
  const y0 = h - 70
  const right = w - 20
  const top = 20
  // expectation: straight diagonal line
  const exp = `${x0},${y0} ${right - 20},${top + 40}`
  // actual: dips slightly below the line, then breaks sharply upward
  const actual: string[] = []
  const n = 60
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = x0 + t * (right - 20 - x0)
    const y = y0 - Math.pow(t, 3.4) * (y0 - top - 30)
    actual.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-4 h-auto w-full" role="img" aria-label="What you think should happen is a straight line, but actual results dip into the Valley of Disappointment before breaking upward past the Plateau of Latent Potential, drawn from the book's own sketch">
      {/* axes */}
      <line x1={x0} y1={top} x2={x0} y2={y0} className="stroke-text-1" strokeWidth="2" />
      <line x1={x0} y1={y0} x2={right} y2={y0} className="stroke-text-1" strokeWidth="2" />
      <text x={x0 + 8} y={top + 4} className="fill-text-1 text-[11px] font-semibold">RESULTS</text>
      <text x={right - 4} y={y0 + 20} textAnchor="end" className="fill-text-1 text-[11px] font-semibold">TIME</text>
      {/* expectation line */}
      <polyline points={exp} fill="none" className="stroke-text-1" strokeWidth="2.5" />
      {/* actual curve */}
      <polyline points={actual.join(' ')} fill="none" className="stroke-text-1" strokeWidth="1.75" />
      {/* callouts */}
      <text x={x0 + 90} y={top + 30} className="fill-text-1 text-[11px] font-semibold">WHAT YOU THINK</text>
      <text x={x0 + 90} y={top + 44} className="fill-text-1 text-[11px] font-semibold">SHOULD HAPPEN</text>
      <text x={x0 + (right - x0) * 0.62} y={y0 - 16} className="fill-text-1 text-[11px] font-semibold">WHAT ACTUALLY HAPPENS</text>
      <text x={x0 + 30} y={y0 + 24} className="fill-text-1 text-[11px] font-semibold">VALLEY OF</text>
      <text x={x0 + 30} y={y0 + 40} className="fill-text-1 text-[11px] font-semibold">DISAPPOINTMENT</text>
    </svg>
  )
}

/* ── The Four Laws table ─────────────────────────────────────────────────── */

const LAWS = [
  { n: '1', cue: 'Cue', build: 'Make it obvious', break: 'Make it invisible' },
  { n: '2', cue: 'Craving', build: 'Make it attractive', break: 'Make it unattractive' },
  { n: '3', cue: 'Response', build: 'Make it easy', break: 'Make it difficult' },
  { n: '4', cue: 'Reward', build: 'Make it satisfying', break: 'Make it unsatisfying' },
]

const LOOP = [
  { step: 'Cue', desc: 'The trigger that signals a reward might be nearby — a piece of information your brain notices.' },
  { step: 'Craving', desc: 'The motivational force. Your mind interprets the cue and wants the change in state it promises.' },
  { step: 'Response', desc: 'The habit itself — the thought or action you actually perform to get the reward.' },
  { step: 'Reward', desc: 'What you were after. It satisfies you and teaches your brain that this behaviour is worth repeating.' },
]

export function TheoryPage() {
  return (
    <div className="animate-fade-in">
      <LearningTabs />
      <header className="mb-6">
        <div className="flex items-center gap-2 text-text-3">
          <BookOpen size={15} />
          <span className="text-xs font-semibold uppercase tracking-widest">Theory</span>
        </div>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-text-1">
          The science of habit
        </h1>
        <p className="mt-1 text-sm text-text-2">
          A quick refresher on the ideas behind behaviour change — the foundation everything else in
          this app is built on. Skim it whenever you need to reset your thinking.
        </p>
      </header>

      <div className="space-y-5">
        {/* 1. 1% better every day */}
        <Card>
          <Eyebrow icon={<TrendingUp size={14} />}>Compounding</Eyebrow>
          <Heading>1 percent better every day</Heading>
          <p className="mt-2 text-sm leading-relaxed text-text-2">
            Success is the product of daily habits, not once-in-a-lifetime transformations. A single 1%
            improvement is barely noticeable today — but repeated daily it compounds into something huge.
            Focus on your current trajectory, not your current results.
          </p>
          <CompoundingGraph />
          <Quote>“Time magnifies the margin between success and failure. Good habits make time your ally; bad habits make time your enemy.”</Quote>
        </Card>

        {/* 2. Plateau of Latent Potential */}
        <Card>
          <Eyebrow icon={<Mountain size={14} />}>Patience</Eyebrow>
          <Heading>The Plateau of Latent Potential</Heading>
          <p className="mt-2 text-sm leading-relaxed text-text-2">
            We expect progress to be linear, but change often lags behind effort before arriving all at
            once. The early flat stretch — the Valley of Disappointment — is where most people quit. The
            work isn’t wasted; it just hasn’t crossed the threshold of visibility yet.
          </p>
          <PlateauGraph />
          <Quote>“When you finally break through, people will call it an overnight success. Only you know about the work you did long ago that made the jump possible.”</Quote>
        </Card>

        {/* 3. Systems over goals */}
        <Card>
          <Eyebrow icon={<Cog size={14} />}>Process</Eyebrow>
          <Heading>Systems over goals</Heading>
          <p className="mt-2 text-sm leading-relaxed text-text-2">
            Goals are the results you want; systems are the processes that get you there. Goals are good
            for setting direction, but you make progress through systems. If you’re stuck, the problem
            usually isn’t motivation — it’s the system. Change the system and you change the outcome.
          </p>
          <Quote>“You do not rise to the level of your goals. You fall to the level of your systems.”</Quote>
        </Card>

        {/* 4. Identity-based habits */}
        <Card>
          <Eyebrow icon={<Fingerprint size={14} />}>Identity</Eyebrow>
          <Heading>Identity-based habits</Heading>
          <p className="mt-2 text-sm leading-relaxed text-text-2">
            Behaviours that match your identity feel effortless; ones that fight it feel like a chore. So
            lasting change starts with a new identity, not a new goal. It’s a two-step loop:
          </p>
          <ol className="mt-3 space-y-1.5 text-sm text-text-2">
            <li className="flex gap-2.5">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-bold text-white">1</span>
              Decide the type of person you want to be.
            </li>
            <li className="flex gap-2.5">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-bold text-white">2</span>
              Prove it to yourself with small wins.
            </li>
          </ol>
          <Quote>“Every action you take is a vote for the type of person you wish to become. True behaviour change is identity change.”</Quote>
        </Card>

        {/* 5. The habit loop */}
        <Card>
          <Eyebrow icon={<Repeat size={14} />}>Mechanics</Eyebrow>
          <Heading>The habit loop</Heading>
          <p className="mt-2 text-sm leading-relaxed text-text-2">
            Every habit runs through the same four-step neurological feedback loop. Learn to spot these
            in your own routines — it’s the skill underneath both building good habits and breaking bad ones.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {LOOP.map((s, i) => (
              <div key={s.step} className="rounded-xl border border-border bg-surface-2/40 p-3.5">
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-accent/12 text-[12px] font-bold text-accent">{i + 1}</span>
                  <span className="text-sm font-semibold text-text-1">{s.step}</span>
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-text-3">{s.desc}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[13px] text-text-3">
            Cue → craving → response → reward. The cue notices the reward, the craving wants it, the
            response obtains it, and the reward teaches your brain to do it again.
          </p>
        </Card>

        {/* 6. The Four Laws */}
        <Card>
          <Eyebrow icon={<Scale size={14} />}>The playbook</Eyebrow>
          <Heading>The Four Laws of Behavior Change</Heading>
          <p className="mt-2 text-sm leading-relaxed text-text-2">
            The Four Laws turn each step of the habit loop into a lever. Set the levers one way to build a
            good habit; invert them to break a bad one.
          </p>
          <div className="mt-4 overflow-hidden rounded-xl border border-border">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="bg-surface-2/50 text-[11px] uppercase tracking-wider text-text-3">
                  <th className="px-3 py-2.5 font-semibold">Step</th>
                  <th className="px-3 py-2.5 font-semibold text-accent">Build a good habit</th>
                  <th className="px-3 py-2.5 font-semibold">Break a bad habit</th>
                </tr>
              </thead>
              <tbody>
                {LAWS.map((l) => (
                  <tr key={l.n} className="border-t border-border">
                    <td className="px-3 py-2.5 font-medium text-text-2">
                      <span className="text-text-3">{l.n}. </span>{l.cue}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-text-1">{l.build}</td>
                    <td className="px-3 py-2.5 text-text-3">{l.break}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[13px] text-text-3">
            This is the same build/break framing your habits use — good habits lean on the laws, habits
            you’re quitting lean on their inverse.
          </p>
        </Card>
      </div>
    </div>
  )
}
