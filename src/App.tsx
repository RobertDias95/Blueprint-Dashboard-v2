import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { router } from './router';
import { supabase } from './lib/supabase';
import { useAuthStore } from './stores/authStore';
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
// Defaults for QueryClient kept conservative for Q1; Q2 will tune
// staleTime/refetchOnWindowFocus per query as views go live.

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Don't refetch when the user just tabs back. Realtime invalidation will
      // be the canonical update path; tab-focus refetches add noise.
      refetchOnWindowFocus: false,
      // 30s stale time: cached data shows instantly, refetches on demand.
      staleTime: 30_000,
    },
  },
});

export default function App() {
  const setSession = useAuthStore((s) => s.setSession);
  const setInitialized = useAuthStore((s) => s.setInitialized);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    // Step 1: restore session from storage on mount.
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) {
          setBootstrapError(error.message);
        }
        setSession(data.session ?? null);
        setInitialized(true);
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setBootstrapError(err instanceof Error ? err.message : String(err));
        setInitialized(true);
      });

    // Step 2: keep authStore in sync with future auth events.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setSession(session ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [setSession, setInitialized]);

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
