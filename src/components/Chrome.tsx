import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import BoardBell from './BoardBell';
import BridgeMark from './BridgeMark';
import Ribbon from './Ribbon';
import NewProjectWizard from './NewProjectWizard';
import { useSelfScope } from '../hooks/useSelfScope';
import { useDesktopAlerts } from '../hooks/useDesktopAlerts';
import { rosterRoleTitle } from '../lib/roleLabels';
import {
  BRAND_LOCKUP_DROP,
  BRAND_LOCKUP_HEIGHT,
  SHELL_HEADER_HEIGHT,
} from '../lib/shellMetrics';

// ★★★ fix-351 — BRAND_NAVY AND BRAND_TITLE_SIZE ARE GONE, NOT REPOINTED.
//
// They described a styled <span> reading "the Bridge": #1d3f6e, chosen by
// fix-320 for the wordmark, at 41px, sized by fix-345. Bobby's new artwork
// contains those words, so the <span> is gone and the two constants describe
// nothing.
//
// ★ Deleting them WITH the words is the point. fix-345 moved them into this
// file precisely so they would sit next to the thing they coloured; leaving
// them behind, pointing at nothing, is how the next person concludes the
// wordmark is meant to come back. BRAND_MARK_SIZE and BRAND_LOCKUP_GAP go the
// same way and for the same reason — one image has no gap, and its size is
// BRAND_LOCKUP_HEIGHT now because the alignment is computed from the height.
//
// ★ AND THE COLOUR CHANGED ANYWAY, which is the second reason not to keep it
// "just in case": the rules in the new lockup are rgb(79, 99, 177), not
// #1d3f6e. A constant kept for a future revival would have been the wrong
// value from the day it was orphaned.

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

  // ★★ fix-369: MOUNTED ONCE, HERE. The shell is the only component that is
  // always present and never remounts on navigation, which is exactly what a
  // "something arrived while you had the app open" driver needs — a second
  // mount would announce everything twice, and a mount inside a page would
  // reset its seed on every route change and re-announce the backlog. It
  // renders nothing; it reads fix-360's list and pushes it to the OS.
  useDesktopAlerts();

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
          style={{ height: SHELL_HEADER_HEIGHT }}
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
              EVERY width, which is why there is a breakpoint here at all.
              Because the block is absolutely positioned, the bell and the chip
              cannot know it exists and will not make room for it, so the only
              two outcomes are "fits" and "overlapped".

              ★★★ fix-345 §2 MADE THE LOCKUP 2.5x BIGGER, so this was
              re-MEASURED rather than re-reasoned. Rendered with the longest
              name on the roster, clearance from the lockup's right edge to the
              bell:

                  width     1x (fix-335)     2.5x (now)
                  1280          209px           129px
                  1440          289px           209px
                  1920          529px           449px

              ★ It still fits at 1280 with room to spare, which is the question
              the brief asked. What moved is the FLOOR: clearance falls by half
              of any width lost, so 129px at 1280 reaches zero at about 1022px —
              and `lg` (1024px) is now within a pixel of touching. Hence `xl`.
              Nothing is lost at any width people work at: the shell is a fixed,
              non-scrolling desktop layout (Bobby: "the horizontal width and the
              vertical width of the screen is going to be fixed so there's no
              scrolling"), and a name half-covered by a bell would be worse than
              no name at all. */}
          <div
            className="hidden xl:flex absolute inset-y-0 items-end pointer-events-none select-none"
            style={{
              left: '50%',
              transform: 'translateX(-50%)',
              // ★ The 2.27px that lands the artwork's rule on the border. The
              // box is inset-y-0, so a negative margin-bottom extends it below
              // the padding box; with items-end the image follows. Derived in
              // shellMetrics from the file's own pixels, never nudged by eye.
              marginBottom: -BRAND_LOCKUP_DROP,
            }}
            data-testid="chrome-brand-center"
          >
            {/* ★★★ fix-351 — ONE IMAGE. THE MARK AND THE WORDS ARE BOTH IN IT.
                This was `<BridgeMark variant="favicon" size={65} />` beside a
                styled `<span>the Bridge</span>`. Bobby's new artwork contains
                the bridge, the words, and the two blue rules beneath them, so
                assembling a lockup out of two elements would now be drawing a
                second version of a thing the file already is.

                ★ fix-345 §2's lowercase requirement is satisfied BY THE ASSET.
                The word is in the artwork, so the `<span>` is gone and nothing
                renders it a second time — a CSS copy underneath the picture
                would be the same word twice to a screen reader.

                ★★ `items-end`, NOT `items-center`, and that is the alignment.
                The block spans the header's padding box, so ending it puts the
                image's bottom edge on the border's top edge; BRAND_LOCKUP_DROP
                then pushes it down by the 2.27px that lands the artwork's own
                rule on the centre of that border. Both numbers are derived in
                shellMetrics from pixels measured off the file — see there for
                why the header height is not what moves.

                ★ Height-driven, because the alignment is arithmetic on the
                height. 72px tall is 412px wide; the clearance that leaves is
                measured in the comment above. */}
            <BridgeMark variant="lockup" size={BRAND_LOCKUP_HEIGHT} />
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
              {/* ★★ fix-343: A JOB TITLE, NOT A DATABASE KEY.
                  Bobby: "it says Bobby and then it says entitlement lead, but
                  it's like ENT underscore lead. First off, I am entitlements
                  manager, so let's update that to reflect it."

                  ★ This line used to print `identity.roles[0]` — the raw stored
                  value, and the FIRST element of an unordered array. Both
                  halves were bugs: everyone saw a database key, and the five
                  people who hold two roles saw an arbitrary one of them, which
                  could differ between two users looking at the same screen.

                  ★ `rosterRoleTitle` decides both — the most senior role in a
                  family wins (ent_lead over ent) and two genuinely different
                  jobs are both shown (Derry is "Design Manager · Schematic
                  Design"). It returns null only when there is nothing true to
                  say — an unmapped login, or a viewer with no recorded
                  function — and the neutral line that was already the fallback
                  here covers that case rather than a placeholder. */}
              <div className="text-dim" style={{ fontSize: 10.5 }} data-testid="chrome-user-role">
                {rosterRoleTitle(identity.roles, identity.notes) ?? 'Blueprint Services'}
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
