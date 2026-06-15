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
import { useRealtimeInvalidation } from './hooks/useRealtimeInvalidation';
import ToastHost from './components/ToastHost';
import { logError, messageOf, isUserInputValidationError } from './lib/errorLogger';

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
// fix-165: also skip user-input validation rejections (SQLSTATE 22008 — the
// fix-89 chronology guard in bp_upsert_permit_cycle_row). A user typing an
// out-of-order date isn't a system error: nothing was saved, they already see
// an inline toast + red cell, and logging it floods Error Reports with noise.
// The paired suppression on the toast side (toastStore `log: false`) keeps the
// re-entry guard from simply letting the frontend_toast path log it instead.
function shouldSkipBackendRpcLog(err: unknown, key: unknown): boolean {
  const k = Array.isArray(key) ? String(key[0] ?? '') : String(key ?? '');
  if (k.startsWith('auth/')) return true;
  if (isUserInputValidationError(err)) return true;
  const m = messageOf(err).toLowerCase();
  return m.includes('bp_log_error');
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err, query) => {
      if (shouldSkipBackendRpcLog(err, query.queryKey)) return;
      void logError({
        source: 'backend_rpc',
        level: 'error',
        message: messageOf(err),
        context: {
          kind: 'query',
          queryKey: query.queryKey,
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

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setSession(session ?? null);
      // Reload memberships on every auth change. Sign-out clears them.
      if (session?.user) {
        loadMembershipsForUser(session.user.id)
          .then((memberships) => {
            if (mounted) setMemberships(memberships);
          })
          .catch((err: unknown) => {
            if (mounted) {
              setBootstrapError(
                err instanceof Error ? err.message : String(err),
              );
            }
          });
      } else {
        setMemberships([]);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [setSession, setInitialized, setMemberships]);

  if (bootstrapError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md bg-surface border border-co-border rounded-xl p-6 text-sm">
          <div className="font-display font-bold text-co mb-2">
            Auth bootstrap failed
          </div>
          <div className="text-muted">{bootstrapError}</div>
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
