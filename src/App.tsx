import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { router } from './router';
import { supabase } from './lib/supabase';
import { useAuthStore, type TenantMembership } from './stores/authStore';
import { friendlyAuthMessage, shouldLogAuthFailure } from './lib/authEvents';
import { createAuthEventHandler } from './lib/authHandler';
import { useRealtimeInvalidation } from './hooks/useRealtimeInvalidation';
import ToastHost from './components/ToastHost';
import {
  logError,
  messageOf,
  shouldLogQueryFailure,
  shouldSkipBackendRpcLog,
} from './lib/errorLogger';
import { useSaveFailureStore } from './stores/saveFailureStore';
import { describeMutation, isNetworkFailure } from './lib/saveFailure';
import { newBuildIsLive } from './lib/appVersion';

// Q1: app shell. Wires QueryClient + Router + auth bootstrap.
//
// Auth flow:
//   1. On mount, call supabase.auth.getSession() once. Result populates
//      authStore.session (or null), then sets initialized=true.
//   2. Subscribe to onAuthStateChange — every login/logout/refresh event
//      updates the store. The subscription is torn down on unmount.
//
// Q5.5.D additions:
//   3. After session populates, fetch tenant_memberships for the user.
//      RLS on tenant_memberships restricts to the caller's own rows.
//   4. authStore.setMemberships defaults activeTenantId to memberships[0].
//      Phase 2 will add a tenant-switcher; for now first-membership wins.

// fix-87: global onError on the QueryCache + MutationCache catches every
// query / mutation rejection (including ones whose per-hook handlers only
// toast — fingerprint dedupes on the server side, so duplicate logs are
// cheap). RPC errors land here as `{ message, code, details, hint }`
// from supabase-js; we forward all four to context. The own-RPC re-entry
// guard inside logError prevents a failing bp_log_error from triggering
// another bp_log_error via this same path.
//
// Filters: skip logging the bp_log_error RPC itself (defense in depth
// alongside the re-entry guard) and skip the auth queries since a missing
// session is expected user flow, not an app error.
//
// ★ fix-314: that `auth/` clause matches NOTHING — no query in this codebase
// uses an `auth/` key prefix. It was never why error_reports had zero auth
// rows; the real reason is that no auth path called logError at all. Kept as a
// guard for any future auth-keyed query, but the actual telemetry now comes
// from logAuthFailure() below, which fires on the auth EVENT rather than on a
// query that never existed.
//
// fix-165: also skip user-input validation rejections (SQLSTATE 22008 — the
// fix-89 chronology guard in bp_upsert_permit_cycle_row). A user typing an
// out-of-order date isn't a system error: nothing was saved, they already see
// an inline toast + red cell, and logging it floods Error Reports with noise.
// The paired suppression on the toast side (toastStore `log: false`) keeps the
// re-entry guard from simply letting the frontend_toast path log it instead.
//
// ★★ fix-341 §2: THE RULES MOVED TO lib/errorLogger — `shouldSkipBackendRpcLog`
// (shared with mutations) and `shouldLogQueryFailure`, which adds the two this
// ticket needed: a CANCELLED request is not a fault, and a query with no
// observers had nobody to fail in front of. They left this file so they could
// be tested without booting the app; the reasoning lives with them.

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err, query) => {
      const observers = query.getObserversCount();
      // ★★ fix-341 §2: skip rules + "was anybody looking?", in one call.
      if (!shouldLogQueryFailure(err, query.queryKey, observers)) return;
      void logError({
        source: 'backend_rpc',
        level: 'error',
        message: messageOf(err),
        context: {
          kind: 'query',
          queryKey: query.queryKey,
          // ★ fix-341: how many mounted components were waiting on it. Always
          // >0 here, and recorded so a future report cannot be mistaken for the
          // unobserved kind — the URL alone could not tell them apart.
          observers,
          url:
            typeof window !== 'undefined'
              ? window.location?.pathname
              : undefined,
        },
      });
    },
  }),
  mutationCache: new MutationCache({
    onError: (err, _vars, _ctx, mutation) => {
      const key = mutation.options.mutationKey;
      // *** fix-372 section 6: TELL THE PERSON. Before this, a mutation that
      // died at the network layer was logged here and shown nowhere - the
      // screen carried on displaying the edit as though it had saved. Logged in
      // prod: TypeError "Failed to fetch", 3 occurrences, 2 users, 14/17/20 Aug.
      //
      // ** Reported BEFORE the skip check below. That check exists to keep
      // Error Reports quiet about expected rejections; it must never decide
      // whether a person is told their save may not have landed.
      useSaveFailureStore.getState().report({
        kind: isNetworkFailure(err) ? 'network' : 'rejected',
        what: describeMutation(key),
        message: messageOf(err),
        at: Date.now(),
        // fix-371 section 4 already knows whether a new build is live, which
        // makes a deploy restart the likely cause and is worth saying.
        newBuildAvailable: newBuildIsLive(),
      });
      if (shouldSkipBackendRpcLog(err, key)) return;
      void logError({
        source: 'backend_rpc',
        level: 'error',
        message: messageOf(err),
        context: {
          kind: 'mutation',
          mutationKey: key,
          url:
            typeof window !== 'undefined'
              ? window.location?.pathname
              : undefined,
        },
      });
    },
  }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

/** ★ fix-314: the instrument-then-patch half. Before this, error_reports held
 *  ZERO auth/JWT/token rows while Miles hit the bug repeatedly — not because a
 *  filter suppressed them, but because nothing ever emitted one. */
function logAuthFailure(input: {
  event: string;
  hadSession: boolean;
  timedOut: boolean;
  error: unknown;
  stage?: string;
}): void {
  const pathname =
    typeof window !== 'undefined' ? (window.location?.pathname ?? '') : '';
  // A missing session on the login route is expected user flow and stays
  // unlogged; an auth failure for someone who HAS a session is the bug.
  if (!shouldLogAuthFailure({ hadSession: input.hadSession, pathname })) return;
  void logError({
    // ★ NOT a new 'frontend_auth' source, deliberately. error_reports carries
    // a CHECK constraint pinning `source` to exactly four values (verified on
    // prod), so a new one would fail the insert — and logError's re-entry
    // guard would swallow that failure, leaving us with zero auth signal all
    // over again, which is the exact hole this ticket exists to close. The
    // discriminator lives in the context instead, where it costs no migration.
    source: 'frontend_exception',
    level: 'error',
    message: messageOf(input.error) || `auth session lost on ${input.event}`,
    context: {
      kind: 'auth',
      // The event name is what separates a failed refresh from a real
      // sign-out once these start landing.
      authEvent: input.event,
      stage: input.stage ?? 'session-verify',
      settleTimedOut: input.timedOut,
      pathname,
    },
  });
}

async function loadMembershipsForUser(userId: string): Promise<TenantMembership[]> {
  const { data, error } = await supabase
    .from('tenant_memberships')
    .select('tenant_id, role')
    .eq('user_id', userId);
  if (error) throw error;
  return (data ?? []) as TenantMembership[];
}

export default function App() {
  const setSession = useAuthStore((s) => s.setSession);
  const setInitialized = useAuthStore((s) => s.setInitialized);
  const setMemberships = useAuthStore((s) => s.setMemberships);
  const setVerifying = useAuthStore((s) => s.setVerifying);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!mounted) return;
        if (error) setBootstrapError(error.message);
        const session = data.session ?? null;
        setSession(session);

        if (session?.user) {
          try {
            const memberships = await loadMembershipsForUser(session.user.id);
            if (!mounted) return;
            setMemberships(memberships);
          } catch (membershipErr) {
            if (!mounted) return;
            setBootstrapError(
              membershipErr instanceof Error
                ? membershipErr.message
                : String(membershipErr),
            );
          }
        }
      } catch (err: unknown) {
        if (!mounted) return;
        setBootstrapError(err instanceof Error ? err.message : String(err));
      } finally {
        if (mounted) setInitialized(true);
      }
    }

    void bootstrap();

    // ★ fix-314: the handler lives in src/lib/authHandler.ts so it can be
    // tested with fakes. The bug was IN THIS WIRING — the previous version was
    // `onAuthStateChange((_event, session) => setSession(session ?? null))`,
    // which discarded the event and made a TOKEN_REFRESHED carrying a null
    // session indistinguishable from a real SIGNED_OUT.
    const handleAuthEvent = createAuthEventHandler({
      getSession: () => supabase.auth.getSession(),
      currentSession: () => useAuthStore.getState().session,
      setSession,
      setVerifying,
      setMemberships: (m) => setMemberships(m as TenantMembership[]),
      loadMemberships: loadMembershipsForUser,
      logAuthFailure,
      isMounted: () => mounted,
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      void handleAuthEvent(event, session);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [setSession, setInitialized, setMemberships, setVerifying]);

  if (bootstrapError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md bg-surface border border-co-border rounded-xl p-6 text-sm">
          <div className="font-display font-bold text-co mb-2">
            Signed out
          </div>
          {/* ★ fix-314: this said "Auth bootstrap failed" over the raw Supabase
              string ("Invalid Refresh Token: Refresh Token Not Found" and
              friends). A person cannot act on that. The technical text still
              reaches error_reports through logAuthFailure's context. */}
          <div className="text-muted" data-testid="auth-bootstrap-message">
            {friendlyAuthMessage(bootstrapError)}
          </div>
          <a
            href="/login"
            className="inline-block mt-3 text-xs px-3 py-1.5 rounded-md bg-de text-white font-display font-bold"
          >
            Sign in
          </a>
        </div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <RealtimeMount />
      <RouterProvider router={router} />
      <ToastHost />
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}

// Q2: empty component whose only job is to call useRealtimeInvalidation
// inside QueryClientProvider so the hook can read the queryClient. Keeps
// App.tsx body tidy and the realtime side-effect isolated.
function RealtimeMount() {
  useRealtimeInvalidation();
  return null;
}
