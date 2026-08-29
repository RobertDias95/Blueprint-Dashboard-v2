import { useState } from 'react';
import AddPersonDialog from './AddPersonDialog';

// ===========================================================================
// ★★★ fix-436 §C1 — WHERE THE SCREEN LIVES, AND WHY IT IS NOT ITS OWN TAB
// ===========================================================================
//
// It is the first card in Settings → Team, above the roster pills.
//
// ★★★ THE TWO HALVES OF MANAGING A PERSON BELONG ON ONE SCREEN. Adding someone
// and retiring them are the same job a month apart, and fix-407 already put
// retiring on this tab. Its own description already says what it is for —
// "Manage people + draw schedule groupings" — so a person looking for "add a
// person" is looking here, and C4's "link to the roster pills" becomes a scroll
// rather than a second destination.
//
// ★★ A SIXTH SETTINGS SECTION WAS THE OTHER OPTION AND WAS REJECTED. fix-415's
// lesson cuts the other way here: that was about a section named for ONE thing
// (Projects) hiding six vocabularies, and the fix was a truer NAME, not more
// sections. A section holding a single button would make the rail longer
// without making anything easier to find — and it would move three pinned test
// lists, a router entry and the fix-315 route-coverage guard for no product
// gain.
//
// ★ ADMIN-GATED BY ITS HOST. Settings → Team is `adminOnly` in
// settingsSections, AdminRoute guards `/settings/team` at the router, and
// AdminTeamTab passes `readOnly={!isAdmin}` to everything it renders. This
// takes the same flag and renders nothing at all without it — the button is not
// disabled, it is absent, because a control that cannot work should not be
// there. The function's own `profiles.role='admin'` check is the real gate
// regardless.

export default function AddPersonSection({ readOnly }: { readOnly: boolean }) {
  const [open, setOpen] = useState(false);
  if (readOnly) return null;

  return (
    <section
      className="bg-surface border border-border rounded-lg p-4"
      data-testid="add-person-section"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-display font-bold text-text m-0">
            People
          </h2>
          <p className="text-[11px] text-dim m-0 mt-0.5 max-w-[46ch]">
            Create someone&rsquo;s login and their roster row together, so their
            name plate and their work show up the first time they sign in.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[12px] font-bold px-3 py-1.5 rounded border border-de bg-de text-white hover:opacity-90 whitespace-nowrap"
          data-testid="add-person-open"
        >
          + Add a person
        </button>
      </div>

      {/* ★ C4: deactivating is fix-407's job and stays there. Saying so — and
          pointing at where it lives — is cheaper than a second control that
          does half of it. */}
      <p className="text-[11px] text-dim mt-2.5 mb-0">
        Removing someone is not done here.{' '}
        <a
          href="#team-roster"
          className="text-de underline"
          data-testid="add-person-deactivate-link"
        >
          Retire them in the roster below
        </a>{' '}
        — that keeps their name on the work they did.
      </p>

      <AddPersonDialog open={open} onClose={() => setOpen(false)} />
    </section>
  );
}
