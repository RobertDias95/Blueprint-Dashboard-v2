import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { router } from './router';
import { supabase } from './lib/supabase';
import { useAuthStore, type TenantMembership } from './stores/authStore';
import { useRealtimeInvalidation } from './hooks/useRealtimeInvalidation';
import ToastHost from './components/ToastHost';

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

const queryClient = new QueryClient({
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
