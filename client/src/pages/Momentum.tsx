import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { BarChart3, Check, Lock, Target, Vote, Gauge, Repeat, Clock, Sparkles, Shield, Info, CloudRain } from 'lucide-react'
import { format } from 'date-fns'
import { useAuthStore } from '@/stores/auth'
import { momentum as momentumApi } from '@/lib/api'
import { ContributionGrid } from '@/components/momentum/ContributionGrid'
import { CompoundCurve } from '@/components/momentum/CompoundCurve'
import { HabitSparkline } from '@/components/momentum/HabitSparkline'
import { MeasuredSeries } from '@/components/momentum/MeasuredSeries'
import { CheckInHistory } from '@/components/momentum/CheckInHistory'
import { InsightsCard } from '@/components/momentum/InsightsCard'
import { Button } from '@/components/ui/Button'
import { cn, getHabitColor } from '@/lib/utils'

export function MomentumPage() {
  const wsId = useAuthStore((s) => s.activeWorkstationId)

  const { data, isLoading } = useQuery({
    queryKey: ['momentum', wsId],
    queryFn: () => momentumApi.get(wsId!),
    enabled: !!wsId,
  })

  return (
    <div className="animate-fade-in">
      <header className="mb-6">
        <div className="flex items-center gap-2 text-text-3">
          <BarChart3 size={15} />
          <span className="text-xs font-semibold uppercase tracking-widest">Momentum</span>
        </div>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-text-1">
          Who you’re becoming
        </h1>
        <p className="mt-1 text-sm text-text-2">
          Every rep is a vote. Here’s what they’re compounding into.
        </p>
      </header>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : !data || data.habitCount === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface p-10 text-center shadow-card">
          <h2 className="font-serif text-lg font-medium text-text-1">No votes cast yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-text-2">
            Engineer a habit and start casting votes — your curve starts climbing from the first rep.
          </p>
          <Link to="/app/architect" className="mt-5 inline-block">
            <Button variant="primary" size="lg">Open the Architect</Button>
          </Link>
        </div>
      ) : (
        (() => {
        const c = data.consistency ?? { consistency: 0, rhythm: 0, anchoring: null }
        return (
        <div className="space-y-5">
          {/* The headline: where these reps are actually heading. */}
          <CompoundCurve data={data} />

          {/* Natural-language read of recent check-ins, served from cache. */}
          <InsightsCard insights={data.insights} />

          {/* Primary metrics */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
              <div className="mb-2 flex items-center gap-2 text-text-3">
                <Vote size={15} />
                <span className="text-xs font-semibold uppercase tracking-widest">Total identity votes</span>
                <div className="group relative ml-auto flex items-center justify-center">
                  <Info size={14} className="text-text-3 cursor-help hover:text-text-2 transition-colors" />
                  <div className="absolute bottom-full right-0 mb-2 w-56 scale-95 opacity-0 rounded-lg bg-text-1 px-3 py-2 text-xs text-white shadow-lg transition-all group-hover:scale-100 group-hover:opacity-100 pointer-events-none z-10 text-left">
                    The sum of every target and failsafe log ever completed across all your habits.
                  </div>
                </div>
              </div>
              <p className="font-display text-5xl font-semibold tracking-tight text-text-1">
                {data.totalVotes}
              </p>
              <p className="mt-1 text-sm text-text-2">
                lifetime reps — each one a vote for who you want to be
              </p>
            </div>

            <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
              <div className="mb-2 flex items-center gap-2 text-text-3">
                <Gauge size={15} />
                <span className="text-xs font-semibold uppercase tracking-widest">Showing up</span>
                <div className="group relative ml-auto flex items-center justify-center">
                  <Info size={14} className="text-text-3 cursor-help hover:text-text-2 transition-colors" />
                  <div className="absolute bottom-full right-0 mb-2 w-56 scale-95 opacity-0 rounded-lg bg-text-1 px-3 py-2 text-xs text-white shadow-lg transition-all group-hover:scale-100 group-hover:opacity-100 pointer-events-none z-10 text-left">
                    How often you've shown up on your scheduled days lately. Recent days count more, so one bad week fades fast.
                  </div>
                </div>
              </div>
              <p className="font-display text-5xl font-semibold tracking-tight text-text-1">
                {c.rhythm}<span className="text-2xl text-text-3">%</span>
              </p>
              <p className="mt-1 text-sm text-text-2">
                how often you've shown up lately — recent days count more
              </p>
            </div>
          </div>

          {/* The finer-grained scores live behind a disclosure — useful when you
              want them, invisible admin when you don't. */}
          <details className="group">
            <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-widest text-text-3 hover:text-text-2">
              <span className="group-open:hidden">Show the details</span>
              <span className="hidden group-open:inline">Hide the details</span>
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <SmallStat icon={Repeat} label="Showing up" value={`${c.rhythm}`}
                hint="lately, weighted recent"
                infoTooltip="How often you've shown up on scheduled days, with recent days counting more." />
              <SmallStat icon={Clock} label="Same time of day"
                value={c.anchoring === null ? '—' : `${c.anchoring}`}
                hint={c.anchoring === null ? 'building…' : 'a steady rhythm'}
                infoTooltip="How tightly your reps cluster around the same time of day — steady timing is what makes a habit automatic." />
              <SmallStat icon={Shield} label="Bounce-backs" value={`${data.totalRecoveries}`}
                hint="never missed twice"
                infoTooltip="Times you missed a day but showed up on the very next scheduled day — the never-miss-twice save." />
              <SmallStat icon={CloudRain} label="Top obstacle"
                value={data.topObstacle ? `${data.topObstacle.reason} ×${data.topObstacle.count}` : '—'}
                hint={data.topObstacle ? 'across all habits, 30 days' : 'nothing recorded yet'}
                infoTooltip="Your most common 'what got in the way' answer across all habits in the last 30 days." />
            </div>
          </details>

          {/* Per-habit cards: each with its own heatmap + phase climb */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-text-2">
                Habit by habit
              </h2>
              
              <div className="flex flex-wrap items-center gap-4 text-[10px] text-text-3">
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-[2px] bg-[#211F1B]" />
                  <span>Target hit</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-[2px]" style={{ background: 'repeating-linear-gradient(-45deg, #211F1B, #211F1B 2px, #F5D24F 2px, #F5D24F 4px)' }} />
                  <span>Failsafe hit</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="relative h-2.5 w-2.5 rounded-[2px] overflow-hidden">
                    <svg viewBox="0 0 14 14" className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
                      <rect width="14" height="14" fill="#FDFBF7" stroke="#EAE0D5" strokeWidth="0.5"/>
                      <path d="M 1.5 11 L 4.5 8 L 6.5 10 L 9.5 3 L 12.5 4" stroke="#D1B98E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                    </svg>
                  </div>
                  <span>Saved miss</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-[2px]" style={{ background: '#CBC7BF' }} />
                  <span>Rest day</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-[2px] border border-border/50 bg-white" />
                  <span>Miss</span>
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {data.trajectory.map((h) => {
                const breaking = h.kind === 'break'
                const color = breaking ? { border: '#5C6BC0' } : getHabitColor(h.habitId)
                return (
                <section key={h.habitId} className="flex flex-col rounded-2xl border border-border bg-surface p-5 shadow-card" style={{ borderLeftWidth: 3, borderLeftColor: color.border }}>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {breaking && (
                      <span className="mb-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                        style={{ color: '#5C6BC0', backgroundColor: '#5C6BC014' }}>
                        <Shield size={10} /> Breaking{h.breakMode === 'taper' ? ' · taper' : ''}
                      </span>
                    )}
                    <p className="text-sm font-medium text-text-1 line-clamp-2">{h.title}</p>
                  </div>
                  <span className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-xs',
                    h.paused ? 'bg-[#EFEAF7] text-[#5B4B86]' : 'bg-surface-2 text-text-2'
                  )}>
                    {h.paused ? 'Paused' : `Showing up ${h.consistency.rhythm}%`}
                  </span>
                </div>

                <div className="mb-3">
                  <HabitSparkline habit={h} color={color.border} />
                </div>

                <ContributionGrid cells={h.contributions ?? []} max={1} />

                {/* What gets in the way — recorded miss reasons, last 90 days. */}
                {(h.topObstacles?.length > 0 || h.missPattern) && (
                  <div className="mt-4">
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-text-3">
                      What gets in the way
                    </p>
                    {h.topObstacles?.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {h.topObstacles.map((o) => (
                          <span key={o.reason} className="rounded-full border border-border bg-bg px-2 py-0.5 text-xs text-text-2">
                            {o.reason} <span className="text-text-3">×{o.count}</span>
                          </span>
                        ))}
                        {(() => {
                          // A reason that keeps recurring with no matching if/then
                          // plan is the next setback plan waiting to be written.
                          const unplanned = h.topObstacles.find((o) =>
                            o.count >= 3 &&
                            !(h.setbackObstacles ?? []).some((s) =>
                              s.toLowerCase().includes(o.reason.toLowerCase()) || o.reason.toLowerCase().includes(s.toLowerCase())
                            )
                          )
                          return unplanned ? (
                            <Link
                              to={`/app/architect/${h.habitId}`}
                              className="text-xs font-medium text-accent hover:underline"
                            >
                              Make a plan for this →
                            </Link>
                          ) : null
                        })()}
                      </div>
                    )}
                    {h.missPattern && (
                      <p className="mt-1.5 text-xs italic text-text-3">{h.missPattern}</p>
                    )}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {h.phases.map((p, i) => (
                    <div key={p.phaseNumber} className="flex items-center gap-2">
                      {i > 0 && <span className="text-text-3">→</span>}
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
                          p.status === 'graduated' && 'border-success/40 bg-success/10 text-text-1',
                          p.status === 'active' && 'border-accent/40 bg-accent/10 text-text-1',
                          p.status === 'ready' && 'border-amber/40 bg-amber/10 text-text-1',
                          p.status === 'locked' && 'border-border bg-bg text-text-3'
                        )}
                        title={p.graduatedAt ? `Graduated ${format(new Date(p.graduatedAt), 'MMM d, yyyy')}` : undefined}
                      >
                        {p.status === 'graduated' ? <Check size={12} className="text-success" />
                          : p.status === 'ready' ? <Sparkles size={12} className="text-amber" />
                          : p.status === 'locked' ? <Lock size={12} />
                          : <Target size={12} />}
                        Phase {p.phaseNumber}
                        {p.status === 'ready' && <span className="text-text-3">· ready for check</span>}
                        {p.status === 'graduated' && p.graduatedAt && (
                          <span className="text-text-3">· {format(new Date(p.graduatedAt), 'MMM d')}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
              )
            })}
            </div>
          </div>

          <MeasuredSeries data={data} />

          {/* The look-back shelf — every past check-in, skipped weeks included. */}
          <CheckInHistory wsId={wsId!} />
        </div>
      )
      })()
      )}
    </div>
  )
}

function SmallStat({ icon: Icon, label, value, hint, infoTooltip }: { icon: typeof Repeat; label: string; value: string; hint: string; infoTooltip?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3 shadow-card">
      <div className="mb-1 flex items-center gap-1.5 text-text-3">
        <Icon size={13} />
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
        {infoTooltip && (
          <div className="group relative ml-auto flex items-center justify-center">
            <Info size={13} className="text-text-3 cursor-help hover:text-text-2 transition-colors" />
            <div className="absolute bottom-full right-0 mb-2 w-48 scale-95 opacity-0 rounded-lg bg-text-1 px-3 py-2 text-xs text-white shadow-lg transition-all group-hover:scale-100 group-hover:opacity-100 pointer-events-none z-10 text-left">
              {infoTooltip}
            </div>
          </div>
        )}
      </div>
      <p className="font-display text-xl font-semibold text-text-1">{value}</p>
      <p className="text-xs text-text-3">{hint}</p>
    </div>
  )
}
