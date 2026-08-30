import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NOT_REQUIRED, isNotRequired } from '../lib/externalTeam';
import { groupByDisciplineThenFirm } from '../hooks/useWaitingOnTasks';
import type { ExternalTeamDirectoryFirm } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-451 PART TWO (P-100/P-101) — THE CONSULTANT DIRECTORY
// ===========================================================================
//
// ★★★ NOT A NEW REGISTRY. fix-227's directory exists and works; the columns
// `contact_name / contact_email / contact_phone / notes` have been there since,
// `useExternalTeamDirectory`'s SELECT reads all four and
// `useUpsertDirectoryFirm` writes all four on BOTH paths. Nothing in the UI
// ever passed one, so all 15 prod firms hold NULL in every contact column.
// Two narrow gaps: a form field, and a place to show what it stores.

const upsertMutate = vi.hoisted(() => vi.fn());
const firms = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock('../hooks/useExternalTeamDirectory', () => ({
  useExternalTeamDirectory: () => ({ data: firms.current, isLoading: false }),
  useUpsertDirectoryFirm: () => ({ mutate: upsertMutate, isPending: false }),
}));

import ExternalTeamDirectoryEditor from '../components/Settings/ExternalTeamDirectoryEditor';

function firm(over: Partial<ExternalTeamDirectoryFirm>): ExternalTeamDirectoryFirm {
  return {
    id: 'f1',
    discipline: 'Surveyor',
    name: 'Emerald',
    contact_name: null,
    contact_email: null,
    contact_phone: null,
    notes: null,
    active: true,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  } as ExternalTeamDirectoryFirm;
}

beforeEach(() => {
  upsertMutate.mockReset();
  firms.current = [];
});

// ---------------------------------------------------------------------------
// §E — the editor gains the contact it already stores
// ---------------------------------------------------------------------------
describe('fix-451 §E: the directory editor', () => {
  it('★★★ saving a contact calls the EXISTING writer with the four fields', () => {
    firms.current = [firm({ id: 'f1' })];
    render(<ExternalTeamDirectoryEditor readOnly={false} />);
    fireEvent.click(screen.getByTestId('etd-details-f1'));
    fireEvent.change(screen.getByTestId('etd-contact-name-f1'), {
      target: { value: '  Dana Survey  ' },
    });
    fireEvent.change(screen.getByTestId('etd-contact-email-f1'), {
      target: { value: 'dana@emerald.test' },
    });
    fireEvent.click(screen.getByTestId('etd-contact-save-f1'));
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      id: 'f1',
      discipline: 'Surveyor',
      name: 'Emerald',
      contact_name: 'Dana Survey', // ★ trimmed on commit (§E2)
      contact_email: 'dana@emerald.test',
      // ★★ EMPTY PERSISTS AS NULL, never '' — so "has a contact" stays a null
      //    check rather than becoming a null-or-empty check everywhere.
      contact_phone: null,
      notes: null,
    });
  });

  it('★★ §E2: a doubtful email is flagged but never BLOCKS the save', () => {
    firms.current = [firm({ id: 'f1' })];
    render(<ExternalTeamDirectoryEditor readOnly={false} />);
    fireEvent.click(screen.getByTestId('etd-details-f1'));
    const email = screen.getByTestId('etd-contact-email-f1');
    fireEvent.change(email, { target: { value: 'not-an-address' } });
    expect((email as HTMLInputElement).style.borderColor).not.toBe('');
    fireEvent.click(screen.getByTestId('etd-contact-save-f1'));
    // ★ It saved anyway. A format guess must not stand between somebody and
    //   recording what they know.
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate.mock.calls[0][0].contact_email).toBe('not-an-address');
  });

  it('★★★ §E3: readOnly SHOWS an existing contact and offers no editing', () => {
    // A DA needs the surveyor's email; what they must not have is the ability
    // to change it.
    firms.current = [
      firm({ id: 'f1', contact_name: 'Dana', contact_email: 'dana@emerald.test' }),
    ];
    render(<ExternalTeamDirectoryEditor readOnly />);
    fireEvent.click(screen.getByTestId('etd-details-f1'));
    expect(screen.getByTestId('etd-contact-email-f1').tagName).not.toBe('INPUT');
    expect(screen.getByTestId('etd-contact-email-f1').textContent).toBe(
      'dana@emerald.test',
    );
    expect(screen.queryByTestId('etd-contact-save-f1')).toBeNull();
    expect(screen.queryByTestId('etd-toggle-f1')).toBeNull();
  });

  it('★★ §E4: a firm with no contact says so instead of showing four empty boxes', () => {
    // 15 of 15 prod firms are in this state; unexplained empty inputs would
    // make Settings look broken rather than unfilled.
    firms.current = [firm({ id: 'f1' })];
    render(<ExternalTeamDirectoryEditor readOnly={false} />);
    fireEvent.click(screen.getByTestId('etd-details-f1'));
    expect(screen.getByTestId('etd-no-contact-f1')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// §G — "not required" is an answer
// ---------------------------------------------------------------------------
describe('fix-451 §G: not required', () => {
  it('★★★ the sentinel is the string PROD ALREADY CARRIES', () => {
    // ★★★ Choosing a fresh token would have turned 4017 Corliss Ave N's stored
    //     'Not Required' into an off-list value needing a migration just to be
    //     READ. Matching it makes that row correct the moment the code ships.
    expect(NOT_REQUIRED).toBe('Not Required');
    expect(isNotRequired('Not Required')).toBe(true);
    // ★ Typed by hand, so compared trimmed and case-insensitively.
    expect(isNotRequired('  not required ')).toBe(true);
    expect(isNotRequired('NOT REQUIRED')).toBe(true);
  });

  it('★★ a real firm, a blank, and null are all NOT the answer', () => {
    // Three states must stay distinguishable (§G2): assigned · not required ·
    // blank. Blank is "nobody has answered", which fix-193 renders as the
    // reminder slot and this ticket does not touch.
    expect(isNotRequired('Emerald')).toBe(false);
    expect(isNotRequired('')).toBe(false);
    expect(isNotRequired(null)).toBe(false);
    expect(isNotRequired(undefined)).toBe(false);
  });

  it('★★★ §G3: a not-required discipline is NOT a chase group', () => {
    // ★ The rows still appear — they are genuinely waiting on something — but
    //   with no firm, so no per-firm CSV button and nobody to email. The
    //   exclusion falls out of resolving the firm to null in useWaitingOnTasks.
    const groups = groupByDisciplineThenFirm([
      {
        id: 't1',
        project_id: 'p1',
        waiting_on: 'Geotech',
        firm_id: null,
        firm_name: null,
        firm_active: true,
      },
      {
        id: 't2',
        project_id: 'p1',
        waiting_on: 'Surveyor',
        firm_id: 'Emerald',
        firm_name: 'Emerald',
        firm_active: true,
      },
    ] as never);
    const geotech = groups.find((g) => g.discipline === 'Geotech')!;
    expect(geotech.firms).toHaveLength(1);
    expect(geotech.firms[0]!.firmId).toBeNull();
    const surveyor = groups.find((g) => g.discipline === 'Surveyor')!;
    expect(surveyor.firms[0]!.firmId).toBe('Emerald');
  });
});
