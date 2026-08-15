import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import BoardBell from './BoardBell';
import ErrorTriageBell from './ErrorTriageBell';
import Ribbon from './Ribbon';
import NewProjectWizard from './NewProjectWizard';
import { useSelfScope } from '../hooks/useSelfScope';

// fix-313 — the Blueprint Bridge shell, built to Bridge_Shell_Mockup_v1.
//
// ★ fix-319 #76: the SettingsModal this used to mount is gone. Settings is a
// PAGE at /settings now, so the ribbon navigates there like any other entry —
// Bobby: "Settings should no longer be a pop-up screen."
//
// WHAT CHANGED: the top tab bar and the logo-as-home-button are gone
// (#59), replaced by the collapsible left ribbon (#57/#58/#60). Add a Project
// moved into the ribbon (#61). My Tasks stopped being a destination (#62).
//
// ★ WHAT DID NOT CHANGE: any page. This ticket moves navigation. Every screen
// renders exactly what it rendered before, in the same <Outlet />.
//
// ★ THE LAYOUT CONTRACT (Bobby): "The horizontal width and the vertical width
// of the screen is going to be fixed so there's no scrolling. Now the
// individual boxes will scroll."
//
// So the shell is h-screen + overflow-hidden, the ribbon and the main pane are
// independent flex children, and <main> owns `overflow-auto` — the page never
// grows a scrollbar, the panel does. Draw Schedule and the wide reports already
// carry their own overflow-x-auto, which is why they fit here without being
// touched: their horizontal scroll happens inside <main>, not on <body>.

export default function Chrome() {
  const [wizardOpen, setWizardOpen] = useState(false);
  const { identity, userId } = useSelfScope();

  return (
    <div
      className="h-screen w-screen flex overflow-hidden"
      data-testid="bridge-shell"
      style={{ overflow: 'hidden' }}
    >
      {/* Keyed on the user so the ribbon re-reads that person's stored
          collapsed/open preferences when auth resolves — which is what lets
          Ribbon read them in a lazy initialiser instead of an effect. */}
      <Ribbon key={userId ?? 'anon'} onAddProject={() => setWizardOpen(true)} />

      <div className="flex-1 min-w-0 flex flex-col h-screen" data-testid="bridge-main">
        <header
          className="bg-surface border-b border-border flex items-center gap-3.5 px-5 flex-shrink-0"
          style={{ height: 56 }}
          data-testid="chrome-header"
        >
          {/* ★ #59: search is NEW FURNITURE — there is no app-wide search today.
              Rendered DISABLED with a "coming soon" affordance rather than as a
              live-looking control that does nothing. This codebase has shipped
              that defect four times (Show All, /settings/team, the milestone
              click, every board link), and a search box is the single most
              inviting thing on a toolbar. */}
          <div
            className="flex items-center gap-2 rounded-lg border border-border bg-bg text-dim select-none"
            style={{ flex: '0 1 380px', padding: '6px 10px', fontSize: 12.5, opacity: 0.62 }}
            data-testid="chrome-search"
            data-disabled="true"
            aria-disabled="true"
            title="Search is not built yet — coming soon"
          >
            <span aria-hidden>⌕</span>
            <span>Search — coming soon</span>
            <span
              className="ml-auto rounded border border-border bg-surface"
              style={{ fontSize: 10, padding: '1px 5px' }}
            >
              ⌘K
            </span>
          </div>

          <div className="flex-1" />

          {/* fix-307's unseen badge lives in here — untouched. */}
          <BoardBell />
          <span className="ml-1">
            <ErrorTriageBell />
          </span>

          {/* The user chip. The mockup's third top-bar element; it replaces the
              gear, which moved into the ribbon. */}
          <div
            className="flex items-center gap-2.5 pl-3.5 border-l border-border"
            data-testid="chrome-user-chip"
          >
            <div
              className="rounded-full bg-s2 text-muted font-display font-bold flex items-center justify-center"
              style={{ width: 29, height: 29, fontSize: 11 }}
              aria-hidden
            >
              {initials(identity.name)}
            </div>
            <div className="leading-tight">
              <div className="font-display font-semibold text-text" style={{ fontSize: 12.5 }}>
                {identity.name ?? 'Signed in'}
              </div>
              <div className="text-dim" style={{ fontSize: 10.5 }}>
                {identity.roles[0] ?? 'Blueprint Services'}
              </div>
            </div>
          </div>
        </header>

        {/* ★ The only scroll container in the shell. Pages keep the p-6 they
            have always relied on. */}
        <main className="flex-1 min-h-0 overflow-auto p-6" data-testid="bridge-pane">
          <Outlet />
        </main>
      </div>

      {/* #61: one wizard, opened from one place — the ribbon. */}
      <NewProjectWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}

function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '··';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
