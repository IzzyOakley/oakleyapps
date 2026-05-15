import type { Metadata } from 'next'
import LoginForm from './LoginForm'

export const metadata: Metadata = {
  title: 'Sign In — Oakley Apps',
}

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-4"
      style={{
        background: 'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(99, 102, 241, 0.06) 0%, transparent 100%), #09090F',
      }}
    >
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <span className="text-2xl font-semibold text-text-primary">Oakley</span>
          <span className="text-2xl font-semibold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent"> Apps</span>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-8 shadow-xl shadow-black/40">
          <h1 className="text-2xl font-semibold text-text-primary tracking-tight">Welcome back</h1>
          <p className="text-sm text-text-secondary mt-1">Sign in to access your tools</p>

          <div className="mt-6">
            <LoginForm />
          </div>

          <p className="text-xs text-text-muted text-center mt-4">
            Restricted to @oakleyhomebuilders.com accounts
          </p>
        </div>
      </div>
    </main>
  )
}
