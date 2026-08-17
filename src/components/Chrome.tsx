import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import BoardBell from './BoardBell';
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
          {/* ★★ fix-331 §5: THE SEARCH BAR IS GONE, and its own justification is
              what dated it. fix-313 rendered it disabled with an honest deferral
              label rather than as a live control that did nothing — the right
              call for a shell that had just been built. Bobby has now used it:

                "On a bunch of the screens, whether it's Pipeline or Project
                Overview, there was this second search bar that said it was not
                built yet. I think we want to delete that for now… most screens
                have a search feature already, so it's kind of a redundant
                thing."

              An honest placeholder is still a placeholder, and this one sat
              beside real per-screen search on every page. Deleted rather than
              hidden: there is no app-wide search to re-enable, so a commented-out
              box would be a promise with nothing behind it.

              ★ NOTHING DEPENDED ON THE SLOT. It was the header's first flex
              child and the only thing holding the left edge; the spacer below
              now does that job alone, so the bell and the user chip stay hard
              right exactly as before. */}
          <div className="flex-1" />

          {/* ★ fix-331 §6: the error-triage bell has LEFT this bar. It is an
              admin tool, and it sat here beside a bell every user needs, looking
              like a peer of it. It is a ribbon entry now, gated by
              useIsTenantAdmin — see Ribbon / ribbonNav.

              fix-307's unseen badge stays here and is untouched. */}
          <BoardBell />

          {/* The user chip. The mockup's third top-bar element; it replaces the
              gear, which moved into the ribbon.

              ★ fix-331 §7: THE INITIALS CIRCLE IS GONE. Bobby: "I don't know if
              it needs to say the BO part, because it's not like a setting,
              there's no button functionality." He is right that it read as
              interactive — a 29px circle at the top-right corner of a web app is
              an account menu everywhere else — and it was not. The rule this
              codebase keeps re-learning is that a control either does something
              or it goes; there is no account menu to attach, so it goes. Name
              and position remain, with the bell to their left. */}
          <div
            className="flex items-center gap-2.5 pl-3.5 border-l border-border"
            data-testid="chrome-user-chip"
          >
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

// ★ fix-331 §7: the `initials()` helper went with the circle it fed. Leaving a
// dead formatter behind is how the next person concludes the avatar is meant to
// come back.
