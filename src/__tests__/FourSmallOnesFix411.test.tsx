import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import wizardSource from '../components/NewProjectWizard.tsx?raw';
import matrixSource from '../components/LibraryMatrix.tsx?raw';
import headerSource from '../components/ProjectDetail/ProjectDetailHeader.tsx?raw';
import attachmentsSource from '../components/ProjectDetail/ChatAttachments.tsx?raw';
import {
  formatLotFeet,
  formatLotPair,
  roundLotFeet,
} from '../lib/lotDimensions';
import { sortLibraryRows, type LibraryRow } from '../lib/libraryHelpers';
import { reuseContextLine } from '../components/wizard/reuseSourceHelpers';

/** ★★ COMMENT-STRIPPED SOURCE. Every one of these files now EXPLAINS the thing
 *  this suite asserts is absent — "it read `n.toFixed(2)`", "there WAS an
 *  onClick here" — so a raw `not.toContain` fails on the note describing the
 *  fix. The trap fix-387, fix-390, fix-395, fix-405 and fix-406 each hit; this
 *  is the sixth, and it is stripped rather than rediscovered a seventh time. */
const stripComments = (src: string): string =>
  src
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, ' ')
    .split(/\r?\n/)
    .map((l) => (l.trim().startsWith('//') ? '' : l.replace(/\s\/\/.*$/, '')))
    .join('\n');

// ===========================================================================
// fix-411 — four small, unrelated corrections from Bobby's 2026-08-26 list
// ===========================================================================
//
//   §1 (P-049) Add New Project must not close on an outside click
//   §2 (P-051) lot dimensions display as whole feet
//   §3 (P-053) the Units table's "Deck" header becomes "RD"
//   §4 (P-054) snips from project chat open in-app, not in a new tab
//
// ★★ STEP 0's TWO CORRECTIONS TO THE BRIEF, pinned here so they are not
// rediscovered:
//
//   · The brief lists "the SITE card on Project Overview" and "the project edit
//     view's read-only displays" as places to round. **They are not read-only.**
//     All three lot-dimension surfaces outside the Library are
//     `<input type="number">` whose blur COMMITS the draft, so rounding them
//     would write the rounded number back — a data change from a display-only
//     ticket. §2 asserts they were left alone.
//   · "The design worker" appears nowhere in this codebase. The in-app viewer
//     it describes is PlanOfRecordCard's `Lightbox`; §4 follows that shape
//     rather than inventing a third.

// ---------------------------------------------------------------------------
// §1 · THE DIALOG THAT MUST NOT VANISH
// ---------------------------------------------------------------------------

const T = 'test-tenant-uuid';

vi.mock('../lib/supabase', () => ({
  supabase: { rpc: () => Promise.resolve({ data: null, error: null }) },
}));
vi.mock('../hooks/useJurisdictions', () => ({
  useJurisdictions: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermitTypes', () => ({
  usePermitTypes: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({ all: [], isLoading: false, error: null, refetch: vi.fn() }),
  activeMemberNamesOf: () => [],
}));
vi.mock('../hooks/useDaTeamRouting', () => ({
  useDaTeamRouting: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useDmDaGroups', () => ({ useDmDaGroups: () => ({ rows: [] }) }));
vi.mock('../hooks/useJurisPermitStats', () => ({
  useJurisPermitStats: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useTaskTemplates', () => ({
  useTaskTemplates: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePlaceNewProjectOnDa', () => ({
  usePlaceNewProjectOnDa: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useBuilders', () => ({
  useBuilders: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useAppConfig', async (orig) => {
  const actual = await orig<typeof import('../hooks/useAppConfig')>();
  return { ...actual, useAppConfig: () => ({ map: new Map<string, unknown>() }) };
});

import NewProjectWizard from '../components/NewProjectWizard';
import { useAuthStore } from '../stores/authStore';

function renderWizard(onClose: () => void) {
  useAuthStore.setState({
    user: { id: 'u-1', email: 'b@x.com' } as never,
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <NewProjectWizard open onClose={onClose} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('fix-411 §1 (P-049): Add New Project survives a stray click', () => {
  it('★★★ clicking the BACKDROP does not close it', () => {
    // Bobby: "if you click anywhere outside of the pop-up, it closes and you
    // have to restart and re-input all that information."
    const onClose = vi.fn();
    renderWizard(onClose);
    const backdrop = screen.getByTestId('new-project-wizard');
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
    // ...and the dialog is still on screen, not merely un-notified.
    expect(screen.getByTestId('new-project-wizard')).toBeInTheDocument();
  });

  it('★★★ ESCAPE does not close it either — the same work, the same loss', () => {
    const onClose = vi.fn();
    renderWizard(onClose);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(screen.getByTestId('new-project-wizard'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('★★★ the × close control STILL closes — the exits are unchanged', () => {
    const onClose = vi.fn();
    renderWizard(onClose);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('★★★ Cancel STILL closes', () => {
    const onClose = vi.fn();
    renderWizard(onClose);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('★★ the backdrop handler is GONE from the source, not merely neutered', () => {
    // ★ A handler that calls handleClose() under a condition that happens to be
    //   false is one refactor away from firing again. There is no onClick on
    //   the overlay at all.
    const stripped = stripComments(wizardSource);
    expect(stripped).not.toContain('e.target === e.currentTarget');
    // ...and no keydown listener was added while we were in here.
    expect(stripped).not.toContain("'Escape'");
  });
});

// ---------------------------------------------------------------------------
// §2 · LOT DIMENSIONS IN WHOLE FEET
// ---------------------------------------------------------------------------

describe('fix-411 §2 (P-051): the rounding helper', () => {
  it('★★★ Bobby\'s own examples: .5 or higher up, .49 or lower down', () => {
    expect(formatLotFeet(100.47)).toBe('100');
    expect(formatLotFeet(120.5)).toBe('121');
    expect(formatLotFeet(100.49)).toBe('100');
    expect(formatLotFeet(100.5)).toBe('101');
    expect(roundLotFeet(100.47)).toBe(100);
    expect(roundLotFeet(120.5)).toBe(121);
  });

  it('★★ whole numbers are unchanged', () => {
    expect(formatLotFeet(40)).toBe('40');
    expect(formatLotFeet(0)).toBe('0');
    expect(formatLotPair(40, 100)).toBe('40×100');
  });

  it('★★★ null / undefined / NaN never render "NaN"', () => {
    // ★ A missing dimension is a missing dimension. "NaN×NaN" in the LOT W×D
    //   column is the failure this signature exists to prevent.
    for (const bad of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatLotFeet(bad as number | null | undefined)).toBeNull();
    }
    expect(formatLotPair(null, 100)).toBeNull();
    expect(formatLotPair(40, undefined)).toBeNull();
    expect(formatLotPair(null, null)).toBeNull();
  });

  it('★★ BOTH halves or neither — a lot is never rendered "40×"', () => {
    expect(formatLotPair(40, null)).toBeNull();
  });
});

const lotRow = (id: string, w: number, d: number): LibraryRow =>
  ({
    projectId: id,
    address: id,
    juris: '',
    productTypes: [],
    units: 0,
    zone: '',
    lotWidth: w,
    lotDepth: d,
    alley: '',
    tags: [],
    stage: 'de',
    unitTypes: [],
    numLots: null,
    isCornerLot: null,
    isRegularShape: null,
    updatedAt: null,
  }) as LibraryRow;

describe('fix-411 §2: sorting still uses the UNROUNDED value', () => {
  it('★★★ 100.47 and 100.4 keep their real order though both render "100"', () => {
    // ★ Rounding before sorting would make the order arbitrary inside each
    //   whole foot — the one thing display-rounding must not leak into.
    const rows = [
      lotRow('c', 100.47, 100),
      lotRow('a', 100.4, 100),
      lotRow('b', 100.9, 100),
    ];
    const asc = sortLibraryRows(rows, { col: 'lotWidth', asc: true });
    expect(asc.map((r) => r.projectId)).toEqual(['a', 'c', 'b']);
    // ...and all three render the same string, which is the point of the ticket.
    expect(asc.map((r) => formatLotFeet(r.lotWidth))).toEqual(['100', '100', '101']);
  });

  it('★★ descending is the exact reverse — no rounding in the comparator', () => {
    const rows = [lotRow('c', 100.47, 100), lotRow('a', 100.4, 100)];
    expect(
      sortLibraryRows(rows, { col: 'lotWidth', asc: false }).map((r) => r.projectId),
    ).toEqual(['c', 'a']);
  });
});

describe('fix-411 §2: every render site, and the ones deliberately untouched', () => {
  it('★★★ the Library LOT W×D cell uses the shared helper', () => {
    expect(matrixSource).toContain('formatLotPair(row.lotWidth, row.lotDepth)');
  });

  it('★★★ the local fmtDim is DELETED, not repointed', () => {
    // ★ It read `n.toFixed(2)` — the "100.47" complaint, spelled out. One
    //   formatter now, so no second local one can drift back to decimals.
    const code = stripComments(matrixSource);
    expect(code).not.toContain('function fmtDim');
    expect(code).not.toContain('toFixed(2)');
  });

  it('★★ the reuse-source context line rounds too', () => {
    expect(
      reuseContextLine({
        id: 'p1',
        address: '1 Main St',
        juris: 'Seattle',
        zone: 'LR2',
        lot_width: 100.47,
        lot_depth: 120.5,
        primaryDa: null,
        product_types: [],
      } as never),
    ).toContain('100×121 lot');
  });

  it('★★★ the EDITABLE inputs are NOT rounded — they would write it back', () => {
    // ★★ The brief called these "read-only displays". They are not: each is an
    //    <input type="number"> whose onBlur commits the draft through
    //    useUpdateProject. Rounding the draft would round the DATABASE on the
    //    next blur — a data write from a display-only ticket.
    const siteRow = headerSource.slice(
      headerSource.indexOf('function SiteLotRow'),
      headerSource.indexOf('function SiteLotRow') + 2200,
    );
    expect(siteRow).toContain('String(project.lot_width)');
    expect(siteRow).not.toContain('formatLotFeet');
    expect(siteRow).not.toContain('Math.round');
  });
});

// ---------------------------------------------------------------------------
// §3 · "Deck" → "RD"
// ---------------------------------------------------------------------------

describe('fix-411 §3 (P-053): the Units table header reads RD', () => {
  it('★★★ the PROPOSAL → Units column header is RD, and "Deck" is gone', () => {
    // Bobby: "we want that to say RD, which would stand for roof deck, so that
    // we can distinguish a deck from a roof deck."
    const strip = headerSource.slice(
      headerSource.indexOf('style={{ width: 62 }}>Parking'),
      headerSource.indexOf('style={{ width: 62 }}>Parking') + 1400,
    );
    expect(strip).toContain('style={{ width: 52 }}>RD</span>');
    expect(strip).not.toContain('>Deck</span>');
  });

  it('★★ no bare "Deck" label is left anywhere in that file', () => {
    // ★ A bare "Deck" is the ambiguity Bobby is removing — a ground-level deck
    //   and a roof deck are different things to a builder. "Roof Deck" in full
    //   is fine and is what every other surface already says.
    expect(headerSource).not.toMatch(/>\s*Deck\s*</);
  });

  it('★★★ the surfaces that already say "Roof Deck" IN FULL are left alone', () => {
    // ★ The brief allows the full words where there is room. The Library's
    //   filter, its column header and its unit mini-table all have room and are
    //   already unambiguous, so changing them would be churn.
    expect(matrixSource).toContain('<FieldLabel label="Roof Deck">');
    expect(matrixSource.match(/Roof Deck/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// §4 · SNIPS OPEN IN-APP
// ---------------------------------------------------------------------------

describe('fix-411 §4 (P-054): a snip does not open a new tab', () => {
  const code = stripComments(attachmentsSource);
  // ★ The two branches, split at the anchor's `href`, which now exists ONLY in
  //   the file branch. Not at `data-kind` (the LAST attribute on the anchor,
  //   so the whole anchor would land in the "image" slice) and not at
  //   `lastIndexOf('return (')` (that is SnipLightbox's own return) — both
  //   were tried and both silently mis-sliced.
  const split = code.indexOf('href={url ?? undefined}');
  const imageBranch = code.slice(code.indexOf('if (image) {'), split);
  const fileBranch = code.slice(split, code.indexOf('function SnipLightbox'));

  it('★★★ the IMAGE branch has no target="_blank" and no window.open', () => {
    expect(imageBranch.length).toBeGreaterThan(200);
    expect(imageBranch).toContain('data-kind="image"');
    expect(imageBranch).not.toContain('target="_blank"');
    expect(imageBranch).not.toContain('window.open');
    // ★ It is a button opening an overlay, not a navigation of any kind.
    expect(imageBranch).toContain('setViewing(true)');
  });

  it('★★★ nothing in this file calls window.open', () => {
    expect(code).not.toContain('window.open');
  });

  it('★★★ it follows PlanOfRecordCard\'s Lightbox, not a third pattern', () => {
    // "open just like the design worker" — the app's one existing in-app file
    // viewer. Same overlay geometry, same backdrop dismissal, same no-upscale
    // cap at the image's own natural width.
    expect(code).toContain('fixed inset-0 z-50 flex items-center justify-center p-4');
    expect(code).toContain('naturalWidth');
    expect(code).toContain('chat-attachment-lightbox');
  });

  it('★★ a NON-image keeps its tab, deliberately', () => {
    // ★ A snip is a Ctrl+V paste and is always an image, so Bobby's case is
    //   covered. The other attachment kind is a PDF plan set, which this app
    //   cannot render — a modal saying "no preview" would be worse than the
    //   browser tab that renders it natively.
    expect(fileBranch).toContain('data-kind="file"');
    expect(fileBranch).toContain('target="_blank"');
  });

  it('★★ the viewer closes on backdrop, Close and Escape — it loses nothing', () => {
    // ★ The opposite ruling to §1, on purpose: a dismissed VIEWER costs one
    //   click to reopen; a dismissed WIZARD costs four steps of typing.
    expect(code).toContain('onClick={onClose}');
    expect(code).toContain('chat-attachment-lightbox-close');
    expect(code).toContain("e.key === 'Escape'");
  });
});
