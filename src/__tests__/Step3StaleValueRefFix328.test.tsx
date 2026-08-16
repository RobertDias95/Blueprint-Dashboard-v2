import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import Step3Permits from '../components/wizard/Step3Permits';
import step3Src from '../components/wizard/Step3Permits.tsx?raw';
import {
  makeEmptyWizardState,
  newPermitRowId,
  type WizardPermit,
  type WizardState,
} from '../components/wizard/wizardState';

// fix-328 — THE Step3Permits FLAKE, CAUGHT.
//
// `Step3Permits.test.tsx` flaked in CI across five tickets in three weeks
// (fix-295, fix-297, fix-324b, fix-325 twice). Every time it passed on re-run
// and nobody captured why; three passes had already been made at guessing
// (fix-300's settle(), fix-300b's 27 sleep removals) and the flake survived all
// of them.
//
// ★ REPRODUCED, not guessed. Running the file with the machine's 12 cores
// saturated by CPU burners produced BOTH known signatures within ~15 runs:
//
//   × fix-211: an auto-derived ENT is NOT re-derived on a later DA change
//     AssertionError: expected 'Bri' to be 'Miles'          ← fix-297's sighting
//   × newly added row inherits BP.ent_lead via the cascade
//     AssertionError: expected 0 to be greater than or equal to 2   ← CI's
//
// ★★ THE CAUSE IS A REAL PRODUCTION RACE, not a test artifact.
//
// Step3Permits keeps `valueRef` as a mirror of the latest wizard state, because
// fix-120-a needed async lookup continuations to read state NEWER than the one
// captured when they were queued. But the mirror was assigned in a PASSIVE
// EFFECT:
//
//     const valueRef = useRef(value);
//     useEffect(() => { valueRef.current = value; });   // ← after paint
//
// React commits a render, paints, and flushes passive effects LATER. Anything
// that runs in that window — a resolved promise continuation, or a click
// dispatched by a test the instant a `waitFor` poll sees the new DOM — reads a
// valueRef that is one render behind.
//
// Two writers then build a WHOLE permits array from that stale snapshot and
// send it through onChange, so the newer state is not merely ignored, it is
// OVERWRITTEN:
//
//   · `addPermit()`      → [...stale.permits, newRow]  — reverts the ENT that
//                          had just landed, and the cascade will not re-derive
//                          it because `lastDerivedRef` says that (da, juris)
//                          pair is already done → 0 rows read Miles, forever.
//   · the cascade's `.then` → rebuilds every row from the stale array, which is
//                          how a blank-only guard reads "blank" for a cell that
//                          is already filled → 'Bri' replaces 'Miles'.
//
// ★ THE FIX IS ONE WORD — useEffect → useLayoutEffect — and it is the cause,
// not the symptom. A layout effect runs synchronously inside the commit, so the
// mirror is updated before anything can observe the new DOM. (Assigning it in
// the component body would work too, but breaks the React Compiler's
// no-refs-during-render rule, which this repo enforces; the layout effect is the
// sanctioned way to the same guarantee.) No assertion was weakened, no timeout
// lengthened, no waitFor added.
//
// ★ WHAT THIS FILE CAN AND CANNOT PROVE, said plainly.
//
// The two behavioural tests below pin the INVARIANTS the race broke — adding a
// row must not revert an ENT; a second DA pick must not overwrite one. They pass
// on the old code too, because `act()` flushes passive effects around every
// event, which closes the very window the race needs. They are worth having and
// they are NOT the proof.
//
// The proof is the third test: it pins the CAUSE in the source. A mirror
// assigned only in an effect is one render behind for exactly that window, and
// the window is invisible in a quiet test run — which is why this cost five CI
// re-runs before anyone looked. If someone moves the assignment back into an
// effect, that test fails immediately instead of three weeks later.

const lookupEntLeadForDaMock = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useDaTeamRouting', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useDaTeamRouting')>();
  return {
    ...actual,
    lookupEntLeadForDa: lookupEntLeadForDaMock,
    useDaTeamRouting: () => ({
      data: [
        { da: 'Trevor', jurisdiction: null },
        { da: 'Cam', jurisdiction: null },
      ],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});
vi.mock('../hooks/useDmDaGroups', () => ({
  useDmDaGroups: () => ({
    data: [], isLoading: false, error: null, refetch: vi.fn(), groups: [], rows: [],
  }),
}));
vi.mock('../hooks/usePermitTypes', () => ({
  usePermitTypes: () => ({
    data: [
      { name: 'Building Permit', is_builtin: true, notes: null },
      { name: 'Demolition', is_builtin: true, notes: null },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    all: [
      { id: '1', name: 'Bobby', role: 'ent', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: '2', name: 'Miles', role: 'ent', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: '3', name: 'Bri', role: 'ent', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: 'da-trevor', name: 'Trevor', role: 'da', active: true, former: false, email: null, notes: null, updated_at: '' },
      { id: 'da-cam', name: 'Cam', role: 'da', active: true, former: false, email: null, notes: null, updated_at: '' },
    ],
    activeDas: [], formerDas: [], dms: [], ents: [], acqs: [],
    isLoading: false, error: null, data: [], refetch: vi.fn(),
  }),
}));

function permit(type: string, partial: Partial<WizardPermit> = {}): WizardPermit {
  return {
    rowId: newPermitRowId(),
    type,
    selected: true,
    ent_lead: '',
    dm: '',
    da: '',
    dual_da: '',
    architect: '',
    num: '',
    expected_issue: '',
    target_submit: '',
    manuallyEdited: {},
    taskTemplateIds: [],
    ...partial,
  };
}

function Host({ initial }: { initial: WizardState }) {
  const [state, setState] = useState(initial);
  return (
    <Step3Permits
      value={state}
      onChange={(patch) => setState((s) => ({ ...s, ...patch }))}
    />
  );
}

function renderHost(initial: WizardState) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Host initial={initial} />
    </QueryClientProvider>,
  );
}

/** A promise whose resolution the test controls, so the continuation can be
 *  placed exactly where production puts it. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function entValues(): string[] {
  return (screen.getAllByTestId(/wizard-perm-ent-/) as HTMLSelectElement[]).map(
    (s) => s.value,
  );
}

describe('fix-328: the wizard reads the LATEST state, not the last-flushed one', () => {
  // The invariant behind the CI signature ("expected 0 to be >= 2"): "+ Add
  // permit" builds the new permits array from the mirror, so a lagging mirror
  // REVERTS the ENT that has just landed — and the cascade will not re-derive it,
  // because lastDerivedRef has already recorded that (da, juris) pair. The row
  // comes back on the next render; the ENT never does.
  it('★ adding a row while the ENT lookup resolves does not revert the ENT', async () => {
    const d = deferred<string>();
    lookupEntLeadForDaMock.mockReset();
    lookupEntLeadForDaMock.mockReturnValue(d.promise);

    const init = makeEmptyWizardState();
    init.juris = 'Seattle';
    init.lead_da = 'Trevor';
    init.permits = [permit('Building Permit', { da: 'Trevor' })];
    renderHost(init);

    // The cascade has fired and is in flight.
    await waitFor(() => expect(lookupEntLeadForDaMock).toHaveBeenCalled());

    // ★ THE INTERLEAVING. Both happen inside ONE act: the click commits, and the
    // lookup's continuation runs before act flushes passive effects — which is
    // precisely the window a saturated CI machine opens on its own.
    await act(async () => {
      fireEvent.click(screen.getByTestId('wizard-step-3-add-permit'));
      d.resolve('Miles');
      await Promise.resolve();
    });

    // Both rows survive, and the ENT that landed is not rolled back.
    await waitFor(() => {
      const values = entValues();
      expect(values).toHaveLength(2);
      expect(values.filter((v) => v === 'Miles').length).toBeGreaterThanOrEqual(1);
    });
  });

  // The invariant behind the other signature ('Bri' where 'Miles' was
  // expected): the blank-only guard (fix-211) reads the mirror, so a lagging
  // mirror reports a filled cell as blank and a second DA pick overwrites an ENT
  // it was supposed to leave alone.
  it('★ a second DA pick does not overwrite an ENT that has just landed', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    lookupEntLeadForDaMock.mockReset();
    lookupEntLeadForDaMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const init = makeEmptyWizardState();
    init.juris = 'Seattle';
    init.permits = [permit('Building Permit'), permit('Demolition')];
    renderHost(init);
    const demoRowId = init.permits[1].rowId;

    fireEvent.change(screen.getByTestId(`wizard-perm-da-${demoRowId}`), {
      target: { value: 'Trevor' },
    });
    await act(async () => {
      first.resolve('Miles');
      await Promise.resolve();
    });
    await waitFor(() => {
      const sel = screen.getByTestId(`wizard-perm-ent-${demoRowId}`) as HTMLSelectElement;
      expect(sel.value).toBe('Miles');
    });

    // ★ The second pick and its resolution, interleaved the same way.
    await act(async () => {
      fireEvent.change(screen.getByTestId(`wizard-perm-da-${demoRowId}`), {
        target: { value: 'Cam' },
      });
      second.resolve('Bri');
      await Promise.resolve();
    });

    const sel = screen.getByTestId(`wizard-perm-ent-${demoRowId}`) as HTMLSelectElement;
    expect(sel.value).toBe('Miles'); // fix-211: blank-only. Never 'Bri'.
  });

  // ★★ THE ONE THAT IS THE PROOF. The two above pass either way; this fails on
  // the pre-fix code and passes after, so it is what actually holds the fix in
  // place. Assigning during render is what makes "latest" true.
  it('★ the value mirror is synced in a LAYOUT effect, not a passive one', () => {
    const code = step3Src.replace(/^\s*\/\/.*$/gm, '');
    // A layout effect runs synchronously inside the commit — before paint, and
    // before any continuation can observe the new DOM — so the mirror can never
    // be a render behind.
    expect(code).toMatch(
      /const valueRef = useRef\(value\);\s*useLayoutEffect\(\(\) => \{\s*valueRef\.current = value;/,
    );
    // ★ And NOT the passive-effect shape that flaked five times: that one runs
    // after paint, leaving a window in which every read below is one render old.
    expect(code).not.toMatch(/\buseEffect\(\(\) => \{\s*valueRef\.current = value;/);
  });
});
