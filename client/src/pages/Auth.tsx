import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
} from 'firebase/auth'
import { Rocket } from 'lucide-react'
import { auth as firebaseAuth } from '@/lib/firebase'
import { auth as authApi } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

export function AuthPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const unsub = firebaseAuth.onAuthStateChanged((user) => {
      if (user) navigate('/app', { replace: true })
    })
    return unsub
  }, [navigate])

  async function handleGoogleSignIn() {
    setError('')
    setLoading(true)
    try {
      await signInWithPopup(firebaseAuth, new GoogleAuthProvider())
      await authApi.sync()
      navigate('/app', { replace: true })
    } catch (err: any) {
      if (err?.code !== 'auth/popup-closed-by-user') {
        setError(err?.message ?? 'Google sign-in failed.')
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'signup') {
        await createUserWithEmailAndPassword(firebaseAuth, email, password)
      } else {
        await signInWithEmailAndPassword(firebaseAuth, email, password)
      }
      await authApi.sync()
      navigate('/app', { replace: true })
    } catch (err: any) {
      const code = err?.code ?? ''
      setError(
        code.includes('invalid-credential') || code.includes('wrong-password')
          ? 'Wrong email or password.'
          : code.includes('email-already-in-use')
          ? 'That email already has an account — sign in instead.'
          : code.includes('weak-password')
          ? 'Password should be at least 6 characters.'
          : err?.message ?? 'Something went wrong.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen min-h-[100dvh] items-center justify-center bg-bg px-6">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-white logo-mark">
            <Rocket size={17} />
          </span>
          <span className="font-display text-lg font-semibold tracking-tight text-text-1">
            One Percent
          </span>
        </Link>

        <div className="rounded-2xl border border-border bg-surface p-6 shadow-card">
          <h1 className="font-serif text-xl font-medium text-text-1">
            {mode === 'signin' ? 'Welcome back' : 'Create your account'}
          </h1>
          <p className="mt-1 text-sm text-text-2">
            {mode === 'signin' ? 'Sign in to cast today’s votes.' : 'Start building your identity.'}
          </p>

          <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3">
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              label="Password"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {error && <p className="text-xs text-danger">{error}</p>}
            <Button type="submit" variant="primary" size="lg" loading={loading} className="mt-1">
              {mode === 'signin' ? 'Sign in' : 'Sign up'}
            </Button>
          </form>

          <div className="mt-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-text-2">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface py-2.5 text-sm font-medium text-text-1 transition hover:bg-bg disabled:opacity-50"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"/>
              <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332Z"/>
              <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58Z"/>
            </svg>
            Continue with Google
          </button>

          <button
            onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError('') }}
            className="mt-4 w-full text-center text-xs text-text-2 hover:text-text-1"
          >
            {mode === 'signin' ? 'No account yet? Sign up' : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
  )
}
