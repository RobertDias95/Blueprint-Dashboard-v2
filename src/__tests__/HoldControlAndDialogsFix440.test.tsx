import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// ===========================================================================
// fix-440 — one hold control (P-061), and the dialogs that hold typing (P-057)
// ===========================================================================
//
// Two ruled items, one PR, because both are "a control doing the wrong thing on
// a click" and neither touches data.

// ---------------------------------------------------------------------------
// P-061 — the hold control
// ---------------------------------------------------------------------------

const setHoldMutate = vi.hoisted(() => vi.fn());
const liftHoldMutate = vi.hoisted(() => vi.fn());
const holdsRef = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock('../hooks/usePermitHolds', async (imp) => {
  const actual = await imp<typeof import('../hooks/usePermitHolds')>();
  return {
    ...actual,
    usePermitHolds: () => ({ data: holdsRef.current, isLoading: false, error: null }),
    useSetPermitHold: () => ({ mutate: setHoldMutate, isPending: false }),
    useLiftPermitHold: () => ({ mutate: liftHoldMutate, isPending: false }),
  };
});
vi.mock('../hooks/useProjectHolds', async (imp) => {
  const actual = await imp<typeof import('../hooks/useProjectHolds')>();
  return {
    ...actual,
    useProjectHolds: () => ({ data: [], isLoading: false, error: null }),
  };
});
vi.mock('../hooks/useAppConfig', async (imp) => {
  const actual = await imp<typeof import('../hooks/useAppConfig')>();
  return {
    ...actual,
    // ★ `map` is a real Map — readAppConfigStringArray calls `.get` on it.
    useAppConfig: () => ({
      map: new Map<string, unknown>([
        ['holdReasonOptions', ['Waiting on builder', 'Waiting on city']],
      ]),
      isLoading: false,
      error: null,
    }),
  };
});

import { PermitHoldPanel } from '../components/ProjectDetail/PermitHold';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const PID = 7;
function renderPanel() {
  return render(<PermitHoldPanel permitId={PID} projectId="p-1" />, { wrapper });
}

beforeEach(() => {
  setHoldMutate.mockReset();
  liftHoldMutate.mockReset();
  holdsRef.current = [];
});

describe('fix-440 §A (P-061) — "Hold this permit" IS the reason dropdown', () => {
  it('★★★ ONE control, not two — no orphan reason select on the far side of the bar', () => {
    renderPanel();
    // Bobby: "'Reason…' sits far left and 'Hold this permit' far right — two
    // boxes, one action." The chooser keeps the reason testid because it IS
    // the reason control now.
    const chooser = screen.getByTestId(`permit-hold-reason-${PID}`);
    expect(chooser.tagName).toBe('BUTTON');
    expect(chooser.textContent).toContain('Hold this permit');
    // ★ And nothing else is on the bar at rest: no date, no note, no second
    //   button. They belong to the hold being composed, not to the row.
    expect(screen.queryByTestId(`permit-hold-set-${PID}`)).toBeNull();
    expect(screen.queryByTestId(`permit-hold-${PID}-start`)).toBeNull();
    expect(screen.queryByTestId(`permit-hold-${PID}-note`)).toBeNull();
  });

  it('★★ opening it lists holdReasonOptions, from the same app_config list', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId(`permit-hold-reason-${PID}`));
    const menu = screen.getByTestId(`permit-hold-${PID}-menu`);
    expect(menu.getAttribute('role')).toBe('menu');
    expect(
      Array.from(menu.querySelectorAll('[role="menuitem"]')).map((n) => n.textContent),
    ).toEqual(['Waiting on builder', 'Waiting on city']);
  });

  it('★★★ CHOOSING A REASON DOES NOT HOLD THE PERMIT', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId(`permit-hold-reason-${PID}`));
    fireEvent.click(screen.getByTestId(`permit-hold-${PID}-option-Waiting-on-city`));
    // ★★★ A hold is a status change on a real permit. A mis-click on a menu
    //     item must not make one — which is the whole reason this is two steps
    //     rather than one.
    expect(setHoldMutate).not.toHaveBeenCalled();
    // …it opens the confirm instead, naming what was picked.
    expect(screen.getByTestId(`permit-hold-${PID}-chosen`).textContent).toBe(
      'Waiting on city',
    );
    expect(screen.getByTestId(`permit-hold-set-${PID}`).textContent).toBe('Apply hold');
  });

  it('★★★ CONFIRM holds it, with the reason, date and note it showed', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId(`permit-hold-reason-${PID}`));
    fireEvent.click(screen.getByTestId(`permit-hold-${PID}-option-Waiting-on-builder`));
    fireEvent.change(screen.getByTestId(`permit-hold-${PID}-start`), {
      target: { value: '2026-08-01' },
    });
    fireEvent.change(screen.getByTestId(`permit-hold-${PID}-note`), {
      target: { value: 'closing slipped' },
    });
    fireEvent.click(screen.getByTestId(`permit-hold-set-${PID}`));
    expect(setHoldMutate).toHaveBeenCalledTimes(1);
    expect(setHoldMutate.mock.calls[0][0]).toEqual({
      permitId: PID,
      reason: 'Waiting on builder',
      note: 'closing slipped',
      holdStart: '2026-08-01',
    });
  });

  it('★★ the start date defaults to today and an empty note is null, as before', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId(`permit-hold-reason-${PID}`));
    fireEvent.click(screen.getByTestId(`permit-hold-${PID}-option-Waiting-on-city`));
    const today = (screen.getByTestId(`permit-hold-${PID}-start`) as HTMLInputElement)
      .value;
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    fireEvent.click(screen.getByTestId(`permit-hold-set-${PID}`));
    expect(setHoldMutate.mock.calls[0][0]).toMatchObject({
      note: null,
      holdStart: today,
    });
  });

  it('★ Cancel on the confirm writes nothing and returns to the one button', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId(`permit-hold-reason-${PID}`));
    fireEvent.click(screen.getByTestId(`permit-hold-${PID}-option-Waiting-on-city`));
    fireEvent.click(screen.getByTestId(`permit-hold-${PID}-cancel`));
    expect(setHoldMutate).not.toHaveBeenCalled();
    expect(screen.queryByTestId(`permit-hold-set-${PID}`)).toBeNull();
    expect(screen.getByTestId(`permit-hold-reason-${PID}`)).toBeInTheDocument();
  });

  it('★★ A4: keyboard — ArrowDown opens, arrows move, Escape closes the popover', () => {
    renderPanel();
    const trigger = screen.getByTestId(`permit-hold-reason-${PID}`);
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const menu = screen.getByTestId(`permit-hold-${PID}-menu`);
    expect(document.activeElement).toBe(
      screen.getByTestId(`permit-hold-${PID}-option-Waiting-on-builder`),
    );
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(
      screen.getByTestId(`permit-hold-${PID}-option-Waiting-on-city`),
    );
    // ★ Escape closes THIS popover and returns focus to the button. It holds a
    //   defaulted date and one optional note and was opened a second ago —
    //   see HoldReasonMenu for why fix-411 §1's rule does not reach it.
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByTestId(`permit-hold-${PID}-menu`)).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(setHoldMutate).not.toHaveBeenCalled();
  });

  it('★★ Escape on the CONFIRM closes it without holding', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId(`permit-hold-reason-${PID}`));
    fireEvent.click(screen.getByTestId(`permit-hold-${PID}-option-Waiting-on-city`));
    fireEvent.keyDown(screen.getByTestId(`permit-hold-${PID}-confirm`), {
      key: 'Escape',
    });
    expect(screen.queryByTestId(`permit-hold-${PID}-confirm`)).toBeNull();
    expect(setHoldMutate).not.toHaveBeenCalled();
  });

  it('★★★ A2: the HELD state is untouched — badge, since, note, release date, Release hold', () => {
    holdsRef.current = [
      {
        id: 'h1',
        permit_id: PID,
        reason: 'Waiting on city',
        note: 'plan check queue',
        hold_start: '2026-08-01',
        hold_end: null,
      },
    ];
    renderPanel();
    expect(screen.getByTestId(`permit-hold-state-${PID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`permit-hold-panel-${PID}`).textContent).toContain(
      'since 2026-08-01',
    );
    expect(screen.getByTestId(`permit-hold-panel-${PID}`).textContent).toContain(
      'plan check queue',
    );
    // ★ Releasing does not use the dropdown — the chooser is not even rendered.
    expect(screen.queryByTestId(`permit-hold-reason-${PID}`)).toBeNull();
    fireEvent.change(screen.getByTestId(`permit-hold-end-${PID}`), {
      target: { value: '2026-09-01' },
    });
    fireEvent.click(screen.getByTestId(`permit-hold-lift-${PID}`));
    expect(liftHoldMutate).toHaveBeenCalledWith({ permitId: PID, holdEnd: '2026-09-01' });
  });
});

// ---------------------------------------------------------------------------
// P-057 — the dialogs
// ---------------------------------------------------------------------------

import quickEditSrc from '../components/ProjectDetail/QuickEditPermitModal.tsx?raw';
import projectSettingsSrc from '../components/ProjectDetail/ProjectSettingsModal.tsx?raw';
import planOfRecordSrc from '../components/ProjectDetail/PlanOfRecordCard.tsx?raw';
import entCascadeSrc from '../components/EntCascadePrompt.tsx?raw';
import gapFillSrc from '../components/GapFillPrompt.tsx?raw';
import npResizeSrc from '../components/NpResizeConflictPrompt.tsx?raw';
import npWarningSrc from '../components/NpWarningPrompt.tsx?raw';
import overlapSrc from '../components/OverlapPrompt.tsx?raw';
import addPersonSrc from '../components/Settings/AddPersonDialog.tsx?raw';

/** Strip block, line and JSX comments — every one of these files discusses
 *  backdrops and Escape at length in prose, which is exactly how an assertion
 *  matches a paragraph instead of the code it is about. */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** The backdrop is the element carrying `fixed inset-0`; this reads the props
 *  between that class and the end of the opening tag. */
function backdropProps(src: string): string {
  const s = code(src);
  const i = s.indexOf('fixed inset-0');
  expect(i, 'no fixed inset-0 backdrop found').toBeGreaterThan(-1);
  return s.slice(i, s.indexOf('>', i));
}

describe('fix-440 §B (P-057) — only the ones holding unsaved input go inert', () => {
  it('the comment stripper actually stripped', () => {
    expect(quickEditSrc).toContain('THE BACKDROP DOES NOTHING');
    expect(code(quickEditSrc)).not.toContain('THE BACKDROP DOES NOTHING');
  });

  it('★★★ QuickEditPermitModal: backdrop inert AND the Escape listener is GONE', () => {
    const src = code(quickEditSrc);
    expect(backdropProps(quickEditSrc)).not.toContain('onClick');
    // ★★★ Its own comment said the Escape handler "matches v1's
    //     overlay-click-closes behavior" — it was built to pair with the
    //     backdrop click, and it loses the identical work for the identical
    //     reason. Removing one and keeping the other would have left the defect
    //     with a keyboard shortcut.
    expect(src).not.toContain("e.key === 'Escape'");
    expect(src).not.toMatch(/addEventListener\('keydown'/);
    // The two real exits are untouched.
    expect(src).toContain('onClick={onClose}');
  });

  it('★★★ ProjectSettingsModal: backdrop inert, and Escape stays absent', () => {
    const src = code(projectSettingsSrc);
    expect(backdropProps(projectSettingsSrc)).not.toContain('onClick');
    // ★ It never had a keydown handler — checked, not assumed — and this pins
    //   that nobody "fixes the inconsistency" with QuickEditPermitModal.
    expect(src).not.toContain("e.key === 'Escape'");
    expect(src).toContain('psm-save');
  });

  it('★★ both carry the rule in a comment pointing at fix-411 §1 (B3)', () => {
    for (const src of [quickEditSrc, projectSettingsSrc]) {
      expect(src).toContain('fix-411');
      expect(src).toMatch(/HOLD UNSAVED INPUT/);
    }
  });

  it('★★★ the house pattern is REUSED, not reinvented — AddPersonDialog is the third', () => {
    // fix-436's dialog and fix-411's Add New Project already do this; 0e said
    // reuse them. All three now share one shape: a `fixed inset-0` backdrop
    // with no onClick.
    expect(backdropProps(addPersonSrc)).not.toContain('onClick');
  });
});

describe('fix-440 §B — the five Prompts keep click-to-close, and here is why', () => {
  // ★★★ THE BRIEF'S 0d CLAIM IS FALSIFIED, and reported rather than quietly
  //     worked around: all five DO carry an onClick on the backdrop today. They
  //     are still out of scope, for the OTHER half of the rule — they hold no
  //     unsaved input at all. Zero inputs, zero state, two buttons each.
  const PROMPTS: Array<[string, string]> = [
    ['EntCascadePrompt', entCascadeSrc],
    ['GapFillPrompt', gapFillSrc],
    ['NpResizeConflictPrompt', npResizeSrc],
    ['NpWarningPrompt', npWarningSrc],
    ['OverlapPrompt', overlapSrc],
  ];

  it('★★★ every one of them closes on a backdrop click TODAY', () => {
    for (const [name, src] of PROMPTS) {
      expect(backdropProps(src), name).toContain('onClick');
    }
  });

  it('★★★ …and none of them holds a single field, which is why they stay', () => {
    for (const [name, src] of PROMPTS) {
      const src2 = code(src);
      expect(src2.includes('<input'), `${name} has an input`).toBe(false);
      expect(src2.includes('<textarea'), `${name} has a textarea`).toBe(false);
      expect(src2.includes('useState'), `${name} holds state`).toBe(false);
    }
  });
});

describe('fix-440 §B2 — the plan-of-record lightbox', () => {
  it('★★★ it is a VIEWER, so the backdrop click STAYS (Bobby: "just stale text")', () => {
    expect(backdropProps(planOfRecordSrc)).toContain('onClick={onClose}');
  });

  it('★★★ …and Escape now actually works: a document listener, not a dead onKeyDown', () => {
    const src = code(planOfRecordSrc);
    // ★ It WAS an onKeyDown on a role="presentation" div with no tabIndex. A
    //   div that cannot take focus never receives a keydown, so the handler was
    //   dead from the day it was written.
    expect(src).not.toMatch(/onKeyDown=\{\(e\) => \{\s*if \(e\.key === 'Escape'\)/);
    expect(src).toMatch(/addEventListener\('keydown'/);
    expect(src).toMatch(/removeEventListener\('keydown'/);
  });

  it('★ the dead handler’s div keeps role="presentation" and gains no tabIndex', () => {
    // Stealing focus onto the backdrop would move it off whatever the reader
    // was on, and the lightbox has no field to focus into.
    const props = backdropProps(planOfRecordSrc);
    expect(props).toContain('role="presentation"');
    expect(props).not.toContain('tabIndex');
  });
});

// ★ The lightbox's Escape is asserted as BEHAVIOUR — pressing Escape on the
// document with nothing focused, against the real card — in
// PlanOfRecordCard.test.tsx, which already owns a harness that renders it with
// a real row. A stand-in component here would have tested a copy of the effect
// rather than the component that installs it.
