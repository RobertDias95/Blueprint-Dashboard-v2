import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { landingAfterSignIn } from '../lib/authEvents';

// Q1: minimal email/password login. On success → /dashboard. Error → inline
// message. No password reset, no signup — those flows are out of scope until
// the rebuild has parity with v1.
//
// ★ fix-314: on success → back WHERE YOU WERE, not /dashboard. AuthGuard has
// always recorded `state={{ from: location }}` when it bounced someone; this
// file never read it, so every recovery landed on the index route and then
// /dashboard. That is the "takes me back to the home page" half of Miles's
// report, and it was one missing read, not a missing feature.
export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, initialized } = useAuthStore();
  const landing = landingAfterSignIn(
    (location.state as { from?: unknown } | null)?.from,
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already authenticated — e.g. the session came back while this screen was
  // up. Return to where the bounce came from, not the dashboard.
  if (initialized && session) {
    return <Navigate to={landing} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setSubmitting(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    navigate(landing, { replace: true });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-surface border border-border rounded-xl p-8 shadow-sm"
      >
        <h1 className="font-display font-extrabold text-2xl text-text mb-1">
          Blueprint Capital
        </h1>
        <p className="text-sm text-muted mb-6">Entitlements — v2</p>

        <label className="block text-xs font-semibold text-muted mb-1 uppercase tracking-wide">
          Email
        </label>
        <input
          type="email"
          autoComplete="email"
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 mb-4 border border-border rounded-md bg-bg focus:outline-none focus:border-de focus:ring-1 focus:ring-de"
        />

        <label className="block text-xs font-semibold text-muted mb-1 uppercase tracking-wide">
          Password
        </label>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 mb-6 border border-border rounded-md bg-bg focus:outline-none focus:border-de focus:ring-1 focus:ring-de"
        />

        {error && (
          <div className="text-sm text-co bg-co-bg border border-co-border rounded-md px-3 py-2 mb-4">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-de hover:bg-de/90 disabled:opacity-50 text-white font-semibold py-2 rounded-md transition"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
