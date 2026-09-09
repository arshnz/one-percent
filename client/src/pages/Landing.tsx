import { Link, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { Rocket } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { auth as firebaseAuth } from '@/lib/firebase'

export function LandingPage() {
  const navigate = useNavigate()

  useEffect(() => {
    const unsub = firebaseAuth.onAuthStateChanged((user) => {
      if (user) navigate('/app', { replace: true })
    })
    return unsub
  }, [navigate])

  return (
    <div className="flex min-h-screen min-h-[100dvh] flex-col items-center justify-center bg-bg px-6 text-center text-text-1">
      <span className="mb-6 grid h-12 w-12 place-items-center rounded-2xl bg-accent text-white logo-mark">
        <Rocket size={22} />
      </span>
      <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
        One Percent
      </h1>
      <p className="mt-4 max-w-md font-serif text-lg text-text-2">
        Cast a vote for who you want to be — one tiny rep at a time. A habit engine
        built on the mechanics of <em>Atomic Habits</em>.
      </p>
      <div className="mt-8 flex items-center gap-3">
        <Link to="/auth">
          <Button variant="primary" size="lg">Get started</Button>
        </Link>
      </div>
      <p className="mt-12 max-w-sm text-xs text-text-3">
        No streaks. No guilt. Just identity votes, a permanent fail-safe, and a
        system that never lets you miss twice.
      </p>
    </div>
  )
}
