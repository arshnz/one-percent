import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Settings, Sparkles, Bell, Mail, Smartphone } from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
import { auth as authApi } from '@/lib/api'
import { enablePushOnThisDevice, pushSupported } from '@/lib/push'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { cn } from '@/lib/utils'
import { GarminCard } from '@/components/settings/GarminCard'

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={cn(
        'relative h-[24px] w-[42px] shrink-0 rounded-full transition-colors',
        on ? 'bg-accent' : 'bg-surface-2'
      )}
    >
      <span
        className={cn(
          'absolute top-[2px] h-[20px] w-[20px] rounded-full bg-white shadow transition-all',
          on ? 'left-[20px]' : 'left-[2px]'
        )}
      />
    </button>
  )
}

export function SettingsPage() {
  const { user, setUser } = useAuthStore()

  const [personalContext, setPersonalContext] = useState(user?.personalContext ?? '')
  const [emailReminders, setEmailReminders] = useState(user?.emailReminders ?? true)
  const [pushReminders, setPushReminders] = useState(user?.pushReminders ?? true)
  const [enablingPush, setEnablingPush] = useState(false)

  const save = useMutation({
    mutationFn: () => authApi.updateMe({
      personalContext: personalContext.trim() || undefined,
      emailReminders,
      pushReminders,
    }),
    onSuccess: ({ user: updated }) => {
      setUser(updated)
      toast.success('Settings saved.')
    },
    onError: () => toast.error('Could not save settings.'),
  })

  async function enablePush() {
    setEnablingPush(true)
    try {
      await enablePushOnThisDevice()
      setPushReminders(true)
      toast.success('Push enabled on this device.')
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not enable push.')
    } finally {
      setEnablingPush(false)
    }
  }

  const dirty =
    personalContext !== (user?.personalContext ?? '') ||
    emailReminders !== (user?.emailReminders ?? true) ||
    pushReminders !== (user?.pushReminders ?? true)

  return (
    <div className="animate-fade-in">
      <header className="mb-6">
        <div className="flex items-center gap-2 text-text-3">
          <Settings size={15} />
          <span className="text-xs font-semibold uppercase tracking-widest">Settings</span>
        </div>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-text-1">
          Your profile
        </h1>
        <p className="mt-1 text-sm text-text-2">
          Context stored here is used by the AI coaches to personalise their responses.
        </p>
      </header>

      <div className="space-y-5">
        {/* Account info — read-only */}
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-text-2">Account</h2>
          <div className="space-y-2">
            <div>
              <p className="text-xs font-medium text-text-3">Name</p>
              <p className="text-sm text-text-1">{user?.name ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-text-3">Email</p>
              <p className="text-sm text-text-1">{user?.email}</p>
            </div>
          </div>
        </section>

        {/* Reminders */}
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
          <div className="mb-1 flex items-center gap-2">
            <Bell size={14} className="text-accent" />
            <h2 className="text-xs font-semibold uppercase tracking-widest text-text-2">Reminders</h2>
          </div>
          <p className="mb-4 text-xs text-text-3">
            Get nudged at each habit’s reminder time. Set the time per habit in its Architect page.
          </p>

          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-2.5">
              <Mail size={16} className="text-text-3" />
              <div>
                <p className="text-sm text-text-1">Email reminders</p>
                <p className="text-xs text-text-3">Sent to {user?.email}</p>
              </div>
            </div>
            <Toggle on={emailReminders} onClick={() => setEmailReminders((v) => !v)} label="Toggle email reminders" />
          </div>

          <div className="flex items-center justify-between border-t border-border py-2">
            <div className="flex items-center gap-2.5">
              <Smartphone size={16} className="text-text-3" />
              <div>
                <p className="text-sm text-text-1">Push notifications</p>
                <p className="text-xs text-text-3">Instant, native-style. Enable per device below.</p>
              </div>
            </div>
            <Toggle on={pushReminders} onClick={() => setPushReminders((v) => !v)} label="Toggle push reminders" />
          </div>

          {pushReminders && (
            <div className="mt-3 border-t border-border pt-3">
              {pushSupported() ? (
                <Button variant="secondary" size="sm" loading={enablingPush} onClick={enablePush}>
                  Enable push on this device
                </Button>
              ) : (
                <p className="text-xs text-text-3">
                  This browser can’t receive push. On iPhone, add One Percent to your Home Screen first, then return here.
                </p>
              )}
              <p className="mt-2 text-[11px] text-text-3">
                Do this once on each device you want notified.
              </p>
            </div>
          )}
        </section>

        {/* Personal context for AI */}
        <GarminCard />

        <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
          <div className="mb-1 flex items-center gap-2">
            <Sparkles size={14} className="text-accent" />
            <h2 className="text-xs font-semibold uppercase tracking-widest text-text-2">
              AI personal context
            </h2>
          </div>
          <p className="mb-3 text-xs text-text-3">
            Tell the AI coaches about yourself — your values, life situation, goals, what motivates you.
            The Why Coach uses this to make its responses feel personal rather than generic.
          </p>
          <Textarea
            label=""
            placeholder="e.g. I'm a dad of two, working long hours. I want to model good habits for my kids and have more energy. I've tried exercising before but always fall off after a few weeks..."
            rows={5}
            value={personalContext}
            onChange={(e) => setPersonalContext(e.target.value)}
          />
          <p className="mt-1.5 text-right text-[11px] text-text-3">
            {personalContext.length} / 2000
          </p>
        </section>

        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            size="lg"
            disabled={!dirty || save.isPending}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
          {dirty && (
            <button
              className="text-sm text-text-2 hover:text-text-1"
              onClick={() => setPersonalContext(user?.personalContext ?? '')}
            >
              Discard
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
