import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, AlertTriangle, RefreshCw } from 'lucide-react'
import { format, formatDistanceToNow, parseISO } from 'date-fns'
import toast from 'react-hot-toast'
import { wearable as wearableApi } from '@/lib/api'
import { cn } from '@/lib/utils'

// The honest state of the Garmin connection.
//
// Its most important job is showing when the sync is BROKEN. The collector's
// stored token lasts about a year and then needs a manual re-login; without
// this card the app would just quietly stop gaining days and still look fine,
// which is the worst way for a data pipeline to fail.

export function GarminCard() {
  const qc = useQueryClient()

  const { data: status, isLoading } = useQuery({
    queryKey: ['wearable-status'],
    queryFn: () => wearableApi.status(),
  })

  const sync = useMutation({
    mutationFn: () => wearableApi.syncNow(),
    onSuccess: (r) => {
      toast.success(r.detail?.startsWith('ok:') ? r.detail : 'Sync finished')
      qc.invalidateQueries({ queryKey: ['wearable-status'] })
      qc.invalidateQueries({ queryKey: ['wearable-days'] })
    },
    onError: (e: Error & { status?: number }) => {
      toast.error(
        e.status === 503
          ? "Manual sync isn't configured on the server yet."
          : e.message || 'Sync failed'
      )
    },
  })

  if (isLoading) return null

  const failing = status?.status === 'error'

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="mb-1 flex items-center gap-2">
        <Activity size={14} className="text-accent" />
        <h2 className="text-xs font-semibold uppercase tracking-widest text-text-2">Garmin</h2>
      </div>

      {!status?.connected ? (
        <p className="text-xs text-text-3">
          Not connected. Once a sync runs, your sleep, resting heart rate, HRV and Body
          Battery appear on The Body — nothing to log by hand.
        </p>
      ) : (
        <>
          <p className="text-xs text-text-3">
            {status.totalDays} days recorded
            {status.firstDate && `, from ${format(parseISO(status.firstDate), 'd MMM yyyy')}`}.
            {status.lastSyncedAt && (
              <> Last synced {formatDistanceToNow(parseISO(status.lastSyncedAt), { addSuffix: true })}.</>
            )}
          </p>

          {failing && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 p-3">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-text-1">Sync is failing</p>
                <p className="mt-0.5 break-words text-[11px] text-text-2">{status.error}</p>
                <p className="mt-1 text-[11px] text-text-3">
                  Garmin sessions expire after about a year. Re-run{' '}
                  <code className="rounded bg-surface-2 px-1 py-0.5">garmin/login_local.py</code>{' '}
                  and update the stored session.
                </p>
              </div>
            </div>
          )}
        </>
      )}

      <button
        onClick={() => sync.mutate()}
        disabled={sync.isPending}
        className={cn(
          'mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5',
          'text-xs font-medium text-text-2 transition-colors',
          'hover:border-text-3 hover:text-text-1 disabled:opacity-60'
        )}
      >
        <RefreshCw size={12} className={sync.isPending ? 'animate-spin' : undefined} />
        {sync.isPending ? 'Syncing — this takes a minute or two…' : 'Sync now'}
      </button>

      {status?.connected && (
        <p className="mt-2 text-[11px] text-text-3">
          Syncs on its own every 6 hours, and fills the oldest missing days a batch at a time
          until it has two years.
        </p>
      )}
    </section>
  )
}
