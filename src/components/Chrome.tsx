import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import BoardBell from './BoardBell';
import BridgeMark from './BridgeMark';
import Ribbon from './Ribbon';
import NewProjectWizard from './NewProjectWizard';
import { useSelfScope } from '../hooks/useSelfScope';

// ★ fix-335 §2: the hero colour, inherited verbatim from fix-320 #73 — a
// literal rather than a theme token because it is a BRAND colour. It belongs to
// the mark, not to the app's semantic palette; pointing it at --color-de would
// mean the logo changed the day somebody retuned the "design" accent. It moved
// here from Ribbon.tsx with the words it colours, unchanged in value, so "The
// Bridge" reads exactly as it did in the ribbon.
//
// ★ fix-320's SECOND colour did not come with it. BRAND_BLUE_LIGHT was the pale
// blue of the small "BLUEPRINT" line above the hero, and that line is not in
// this lockup: Bobby's own reading of the header is "logo, The Bridge", and the
// ribbon's mark (fix-335 §1) now literally spells BLUEPRINT six inches to the
// left. Repeating it here would print the company's name twice on one row.
const BRAND_NAVY = '#1d3f6e'; // "The Bridge"

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
          className="bg-surface border-b border-border flex items-center gap-3.5 px-5 flex-shrink-0 relative"
          style={{ height: 56 }}
          data-testid="chrome-header"
        >
          {/* ★★ fix-335 §2: THE PRODUCT'S NAME, CENTRED, ON EVERY SCREEN.

              Bobby: "we want to move that to the white header on all the
              screens. And we want to add the logo from the tab to the left of
              that. So in the center of all the screens in that white area, it's
              going to read logo, The Bridge."

              ★★ ABSOLUTELY POSITIONED, AND THAT IS THE WHOLE POINT. Put in the
              flex flow it would centre against the REMAINDER — the space left
              over after the bell and the user chip — so it would slide left or
              right by a few pixels as the signed-in person's name changed
              length, and sit at a different spot on two people's screens. Taken
              out of the flow, left:50% + translateX(-50%) pins it to the middle
              of the white bar itself and nothing to either side can move it.

              ★ THE MIDDLE OF THE BAR IS THE MIDDLE OF "THAT WHITE AREA" — which
              is what he pointed at. The bar starts where the ribbon ends, so
              this is not the viewport's centre; centring against the viewport
              would push the lockup left of the bar's own middle by half the
              ribbon's width, and it would MOVE when the ribbon is collapsed.
              Fixed relative to the thing it sits in, so collapsing the ribbon
              re-centres it and it never drifts.

              ★ pointer-events-none: it is a label, not a control. Without it, a
              transparent 200px box would sit over the middle of the header and
              swallow clicks aimed at anything beneath it.

              ★ THE CENTRE WAS FREE BEFORE THIS, verified rather than assumed:
              fix-331 §5 deleted the search bar and §7 deleted the initials
              circle, leaving `<div className="flex-1" />` as the only thing
              between the left edge and the bell.

              ★★ AND IT IS FREE AT EVERY WIDTH THIS APP IS USED AT — but not at
              EVERY width, which is why `hidden lg:flex` is here. Rendered and
              measured rather than reasoned about: the centred lockup is ~138px
              and the right-hand cluster (bell + chip) is ~312px with the
              longest name on the roster, so on a 1280px screen they clear each
              other by about 150px and at 1024px by about 25px. Below roughly
              980px the bell starts crossing the final letters of "The Bridge".
              Because the block is absolutely positioned, its neighbours cannot
              know it is there and will not make room — so rather than let it be
              overlapped, it drops out under Tailwind's `lg` breakpoint. The
              shell is a fixed, non-scrolling desktop layout (Bobby: "the
              horizontal width and the vertical width of the screen is going to
              be fixed so there's no scrolling"), so that window is one nobody
              works in; a name half-covered by a bell would be worse than no
              name at all. */}
          <div
            className="hidden lg:flex absolute inset-y-0 items-center gap-2 pointer-events-none select-none"
            style={{ left: '50%', transform: 'translateX(-50%)' }}
            data-testid="chrome-brand-center"
          >
            {/* ★ "the logo from the tab" is literal — bridge-favicon-256.png,
                the same mark the browser tab shows. See BridgeMark's `favicon`
                variant for why it is that file and not the square crop beside
                it. 26px: the tab icon's own scale, and it sits on the cap
                height of the 16.5px hero rather than towering over it. */}
            <BridgeMark variant="favicon" size={26} />
            <span
              className="font-display whitespace-nowrap"
              style={{
                fontSize: 16.5,
                fontWeight: 750,
                letterSpacing: '-.005em',
                color: BRAND_NAVY,
                lineHeight: 1,
              }}
              data-testid="chrome-brand-title"
            >
              The Bridge
            </span>
          </div>

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
