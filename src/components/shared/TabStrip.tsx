import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

// ===========================================================================
// ★★★ fix-485 §B (P-137, the tab-strip half) — ONE TAB STRIP, EVERYWHERE
// ===========================================================================
//
// Bobby, 2026-09-02: *"My Board / My Tasks / Notifications doesn't have the
// same view as Draw Schedule / Seattle Intakes or Reports / Overview… we want
// to keep the consistency consistent."*
//
// fix-483 did the two-state TOGGLES (`TwoStateToggle`). This is the other half:
// a page's sibling-view sub-navigation.
//
// ---------------------------------------------------------------------------
// ★★★ WHICH TREATMENT, AND HOW THAT WAS DECIDED
// ---------------------------------------------------------------------------
// Three strips existed and Bobby named exactly one as the odd one out. Read
// side by side:
//
//   Reports (`reports-subtab-bar`)   px-[18px] py-2.5 text-xs font-bold
//                                    font-display border-b-2 -mb-px,
//                                    active `text-de border-de`
//   Draw Schedule (`SubTab`)         **the same class string, character for
//                                    character** — Reports' own comment says
//                                    "matches the DrawSchedule sub-tab styling"
//   My Board (`personal-board-tabs`) 12.5px UPPERCASE extrabold, active tab
//                                    filled `--color-surface` with a `--de`
//                                    underline, on an `--s2` bar
//
// ★★★ SO THE TARGET WAS NEVER IN DOUBT: two of the three are already identical
// and Bobby complained about the third. **My Board moves.** The strip adopts
// the Reports/Draw Schedule underline treatment verbatim.
//
// ★★ AND THE BEHAVIOUR COMES FROM REPORTS, WHICH IS A SEPARATE CHOICE. Draw
// Schedule's `SubTab` had no `role`, no `aria-selected` and no keyboard: to a
// screen reader it was two anonymous buttons. Reports had the full contract —
// `role="tablist"` / `role="tab"` / `aria-selected`, a roving `tabIndex` and
// Arrow-key movement. The best VISUAL and the best BEHAVIOUR happened to live
// in different files; this takes one from each rather than the whole of either.
//
// ---------------------------------------------------------------------------
// ★★★ ROUTE-DRIVEN AND STATE-DRIVEN, AND WHY THAT IS ONE COMPONENT
// ---------------------------------------------------------------------------
// My Board's tabs ARE routes (`/board`, `/tasks`, `/notifications`) — they must
// be links, or a middle-click cannot open one in a new tab and the browser's
// back button skips them. Draw Schedule's and Reports' are local state. A tab
// carries `to` or it does not, and this renders a `NavLink` or a `<button>`
// accordingly; everything else — the classes, the roles, the roving focus, the
// arrow keys — is shared. Two components would be two answers to "what does a
// sub-tab look like", which is the whole defect.
//
// ★ `right` is for the counts My Board carries on its tabs (fix-324's rule:
//   "0 open" is itself an answer, so the numbers always render). It is a slot,
//   not a number — this file has no opinion about what a page counts.

export interface TabSpec<T extends string> {
  id: T;
  label: string;
  /** Present ⇒ the tab is a ROUTE and renders a `NavLink`. Absent ⇒ a button
   *  that calls `onSelect`. */
  to?: string;
  /** Rendered after the label — a count, a badge. Optional. */
  right?: ReactNode;
  /** Defaults to `<testIdPrefix>-<id>`. */
  testid?: string;
  title?: string;
}

const TAB_CLASS =
  'px-[18px] py-2.5 text-xs font-bold font-display border-b-2 transition -mb-px ' +
  'flex items-center gap-2 no-underline bg-transparent cursor-pointer';
const TAB_ACTIVE = 'text-de border-de';
const TAB_INACTIVE = 'text-muted border-transparent hover:text-text';

export default function TabStrip<T extends string>({
  tabs,
  active,
  onSelect,
  ariaLabel,
  testIdPrefix,
  barTestId,
  className = '',
}: {
  tabs: readonly TabSpec<T>[];
  active: T;
  /** Called for BOTH kinds of tab. A routed tab still reports the change so a
   *  page can mirror it into its own state; navigation is the `NavLink`'s. */
  onSelect?: (id: T) => void;
  ariaLabel: string;
  /** `<prefix>-bar` on the strip, `<prefix>-<id>` on each tab unless the tab
   *  names its own. Existing test ids are preserved by passing the prefix each
   *  page already used. */
  testIdPrefix: string;
  /** ★ Overrides `<prefix>-bar` on the strip itself. My Board's container was
   *  `personal-board-tabs`, which no prefix can also produce for its tabs —
   *  and the brief's rule is that no test id moves. One prop rather than a
   *  dozen edited pins. */
  barTestId?: string;
  className?: string;
}) {
  const refs = useRef<(HTMLElement | null)[]>([]);

  // ★★ ARROW KEYS MOVE, AND THE FOCUS GOES WITH THEM. Reports' implementation,
  //    unchanged: a roving `tabIndex` means Tab enters the strip once and lands
  //    on the CURRENT tab, then Left/Right walk it — which is what the WAI-ARIA
  //    tabs pattern asks for and what two of the three strips did not do.
  //
  // ★ Home/End are added: they cost two lines and are the other half of the
  //   same pattern.
  function onKeyDown(e: KeyboardEvent, i: number) {
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    const t = tabs[next];
    if (!t) return;
    onSelect?.(t.id);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`flex items-center gap-0 border-b border-border ${className}`}
      data-testid={barTestId ?? `${testIdPrefix}-bar`}
    >
      {tabs.map((t, i) => {
        const isActive = t.id === active;
        const cls = `${TAB_CLASS} ${isActive ? TAB_ACTIVE : TAB_INACTIVE}`;
        const shared = {
          role: 'tab' as const,
          id: `${testIdPrefix}-tab-${t.id}`,
          'aria-selected': isActive,
          'aria-controls': `${testIdPrefix}-panel-${t.id}`,
          tabIndex: isActive ? 0 : -1,
          onKeyDown: (e: KeyboardEvent) => onKeyDown(e, i),
          className: cls,
          title: t.title,
          'data-testid': t.testid ?? `${testIdPrefix}-${t.id}`,
          'data-active': isActive ? 'true' : 'false',
        };
        const body = (
          <>
            {t.label}
            {t.right}
          </>
        );
        return t.to !== undefined ? (
          <NavLink
            key={t.id}
            to={t.to}
            ref={(el) => {
              refs.current[i] = el;
            }}
            onClick={() => onSelect?.(t.id)}
            {...shared}
          >
            {body}
          </NavLink>
        ) : (
          <button
            key={t.id}
            type="button"
            ref={(el) => {
              refs.current[i] = el;
            }}
            onClick={() => onSelect?.(t.id)}
            {...shared}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}
