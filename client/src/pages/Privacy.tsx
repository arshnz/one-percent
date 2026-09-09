import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

// Public, unauthenticated page. App Store Connect requires a reachable privacy
// policy URL, and Apple's reviewers do open it. Keep it truthful and specific —
// it has to match the privacy nutrition labels on the store listing.

const UPDATED = '9 September 2026'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-lg font-semibold tracking-tight text-text-1">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-text-2">{children}</div>
    </section>
  )
}

export function PrivacyPage() {
  return (
    <div className="min-h-screen min-h-[100dvh] bg-bg px-6 py-12 text-text-1">
      <div className="mx-auto max-w-2xl">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs text-text-3 transition-colors hover:text-text-1"
        >
          <ArrowLeft size={14} />
          One Percent
        </Link>

        <h1 className="mt-8 font-display text-3xl font-semibold tracking-tight">Privacy</h1>
        <p className="mt-3 font-serif text-lg text-text-2">
          One Percent is a personal habit tracker. It holds some genuinely private things —
          what you're trying to change about yourself, and what got in the way. Here is
          exactly what happens to that.
        </p>
        <p className="mt-2 text-xs text-text-3">Last updated {UPDATED}</p>

        <Section title="What is collected">
          <p>
            <strong className="font-medium text-text-1">Your account.</strong> Your email
            address and display name, provided by Google or Apple when you sign in, plus your
            timezone (used to fire reminders at the right local hour).
          </p>
          <p>
            <strong className="font-medium text-text-1">What you write.</strong> Your habits
            and their cues, goals, daily votes, the reasons you record when you miss a day,
            your weekly check-in reflections, Compass answers, Vision Canvas notes and images,
            and your conversations with the Habit Coach.
          </p>
          <p>
            <strong className="font-medium text-text-1">Notification handles.</strong> If you
            turn on reminders, a push token for each device you enable them on.
          </p>
          <p>
            There is no advertising, no analytics, no tracking pixels, and no third-party
            tracking SDK in this app. Nothing you do here is tracked across other apps or
            websites, and nothing is sold or used for advertising — by anyone, ever.
          </p>
        </Section>

        <Section title="Who else touches it">
          <p>
            <strong className="font-medium text-text-1">Google Firebase</strong> handles sign-in
            and runs the servers. <strong className="font-medium text-text-1">Supabase</strong>{' '}
            hosts the database your habits live in. Both act as processors — they store the
            data so the app can work.
          </p>
          <p>
            <strong className="font-medium text-text-1">Google Gemini</strong> powers the AI
            features: the Habit Coach, the blueprint interview, Compass reflection, and the
            check-in summary. When you use one of those, the relevant text — your habit
            details and what you wrote — is sent to Google's API to generate a response. If
            you would rather that not happen, don't use the AI surfaces; the rest of the app
            works completely without them.
          </p>
          <p>
            <strong className="font-medium text-text-1">Gmail</strong> delivers reminder and
            digest emails to your address, if you have email reminders switched on.
          </p>
        </Section>

        <Section title="What you can do">
          <p>
            Turn email or push reminders off at any time in Settings. Delete any habit, log,
            note, or conversation from inside the app.
          </p>
          <p>
            To get a copy of everything held about you, or to have your account and all its
            data permanently deleted, email{' '}
            <a
              href="mailto:arshdeep.m@gmail.com?subject=One%20Percent%20—%20data%20request"
              className="underline decoration-text-3 underline-offset-2 transition-colors hover:text-text-1"
            >
              arshdeep.m@gmail.com
            </a>
            . Deletion is permanent and is actioned within 30 days.
          </p>
        </Section>

        <Section title="The rest">
          <p>
            Data is kept for as long as your account exists. Everything travels over
            encrypted connections. This app is not intended for children under 13.
          </p>
          <p>
            One Percent is built and run by one person, not a company. If something here is
            unclear, or you want to know what is stored about you, just ask — the address
            above reaches a real human.
          </p>
        </Section>

        <p className="mt-12 border-t border-text-3/20 pt-6 text-xs text-text-3">
          Questions about any of this go to arshdeep.m@gmail.com.
        </p>
      </div>
    </div>
  )
}
