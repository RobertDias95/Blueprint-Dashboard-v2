import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@supabase/supabase-js';
import '../index.css';
import EmailNotificationsPanel from '../components/Settings/EmailNotificationsPanel';
import { useAuthStore } from '../stores/authStore';
import { queryKeys } from '../lib/queryKeys';
import { preferencesFromRows } from '../lib/notificationPreferences';

// ===========================================================================
// ★★ fix-648 (P-339) — Settings → My account → Email notifications, RENDERED
// ===========================================================================
//
// The real panel, seeded with what the hook would read for a login with NO
// rows — every person Add Person creates from now on. Mentions and Task
// assignments must show OFF with "Off unless you turn it on."; the Weekly
// Update and Resubmit-by must show ON.
//
// ⚠️ No session, so a click's upsert fails here — the write is proven in
//    EmailOptInPanelFix648.test.tsx, not in this page.
//
// HOW TO RUN
//     npm run dev  →  http://localhost:5173/harness/email-opt-in-648.html

const USER_ID = 'harness-new-login';
useAuthStore.setState({ user: { id: USER_ID } as User });

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, retry: false } },
});
qc.setQueryData(queryKeys.notificationPreferences(USER_ID), preferencesFromRows([]));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <div className="min-h-screen bg-bg p-8">
        <div className="max-w-md rounded-lg border border-border bg-surface p-5">
          <h2 className="font-display font-semibold text-text mb-3">Email notifications</h2>
          <EmailNotificationsPanel />
        </div>
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
