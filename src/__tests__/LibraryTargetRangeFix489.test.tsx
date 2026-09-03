import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useAuthStore } from '../stores/authStore';

// ===========================================================================
// ★★★ fix-489 (P-151) — THE ± BOXES HAVE TO FIT WHAT THEY HOLD
// ===========================================================================
//
// Bobby, 2026-09-03, with a screenshot of the Library where the LOT SIZE box
// reads **"5"** and the UNIT SIZE box reads **"1"**: *"the unit and lot size is
// not fully visable. that is a problem. the lot size should default +/- 500 and
// the unit size should be +/- 100"*
//
// ---------------------------------------------------------------------------
// ★★★ STEP 0's ANSWER: THE DEFAULTS WERE NEVER WRONG
// ---------------------------------------------------------------------------
// `lotsizeBuf` is 500 and `unitsizeBuf` is 100 in `INITIAL_FILTERS`, and both
// of the paths that could have replaced them restore from that same object —
// `clearCardFilters(filters, keys, initial)` and `loadLibraryFilters`'
// `?? fallback.lotsizeBuf`. Nothing resets them to 5 and 1. The rendered VALUE
// was always right; the 40px BOX was showing its first glyph.
//
// The first two tests below are what would have caught it in CI, and the third
// is the pair that could not be: jsdom has no layout, so `clientWidth` and
// `scrollWidth` are both 0 there and a width assertion in this file would pass
// against any width at all. That half is measured in Chrome through
// `harness/library-size-boxes-489.html`, and the numbers are in the PR.

const T = 'test-tenant-uuid';

const fixtures = vi.hoisted(() => ({
  projects: [
    {
      id: 'a',
      address: '100 Apple Way',
      juris: 'Seattle',
      archived: false,
      notes: null,
      units: 1,
      num_lots: 1,
      is_corner_lot: null,
      zone: 'NR',
      lot_width: 40,
      lot_depth: 100,
      lot_size_sf: 7200,
      alley: 'No',
      product_types: ['Detached'],
      project_tags: [],
      unit_types: [
        { label: 'Detached', width_ft: 20, depth_ft: 40, qty: 1, size_sf: 1700 },
      ],
      updated_at: '2026-09-03T10:00:00Z',
    },
  ],
  permits: [] as unknown[],
}));

vi.mock('../hooks/useUpdateProject', () => ({
  useUpdateProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: fixtures.projects,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({
    data: fixtures.permits,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../hooks/useAppConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useAppConfig')>();
  return { ...actual, useAppConfig: () => ({ map: new Map() }) };
});

import LibraryMatrix from '../components/LibraryMatrix';

beforeEach(() => {
  // ★ fix-403's filter memory persists to sessionStorage. A run that inherited
  //   a previous test's filters would assert against those, not the defaults —
  //   which is the very thing this file is about.
  sessionStorage.clear();
  localStorage.clear();
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  } as never);
});

function renderIt() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LibraryMatrix />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const input = (id: string) => screen.getByTestId(id) as HTMLInputElement;

// ---------------------------------------------------------------------------
// STEP 0 · THE DEFAULTS
// ---------------------------------------------------------------------------

describe('fix-489 STEP 0: the defaults Bobby asked for were already there', () => {
  it('★★★ the six ± boxes render 2 · 2 · 500 · 2 · 2 · 100', () => {
    // ★★★ THE ANSWER TO *"the lot size should default +/- 500 and the unit size
    //     should be +/- 100"* — they do, and they did before this ticket. What
    //     he could not see was the second and third digit.
    renderIt();
    expect(input('lotw-buf').value).toBe('2');
    expect(input('lotd-buf').value).toBe('2');
    expect(input('lotsize-buf').value).toBe('500');

    fireEvent.click(screen.getByTestId('filter-chip-unit'));
    expect(input('unitw-buf').value).toBe('2');
    expect(input('unitd-buf').value).toBe('2');
    expect(input('unitsize-buf').value).toBe('100');
  });

  it('★★ the two sf targets start EMPTY, with the "Target" placeholder', () => {
    // ★ Bobby's *"instead of Target it would say Varies"* was about the lot's
    //   DEPTH field on the project, not this — the filter's empty state is
    //   still "Target", and this pins that the two are different controls.
    renderIt();
    expect(input('lotsize-target').value).toBe('');
    expect(input('lotsize-target').placeholder).toBe('Target');
    fireEvent.click(screen.getByTestId('filter-chip-unit'));
    expect(input('unitsize-target').value).toBe('');
    expect(input('unitsize-target').placeholder).toBe('Target');
  });

  it('★★★ Clear restores 500 and 100, not 0 and not blank', () => {
    // ★★ The path that COULD have made Bobby's reading right. `clearCardFilters`
    //    writes back from `INITIAL_FILTERS`, so a cleared card returns to the
    //    defaults rather than to empty — and the ± box is never left at 0,
    //    which would silently narrow every search to an exact match.
    renderIt();
    fireEvent.change(input('lotsize-target'), { target: { value: '7200' } });
    fireEvent.change(input('lotsize-buf'), { target: { value: '25' } });
    expect(input('lotsize-buf').value).toBe('25');

    fireEvent.click(screen.getByTestId('filter-clear-site'));
    expect(input('lotsize-target').value).toBe('');
    expect(input('lotsize-buf').value).toBe('500');
  });
});

// ---------------------------------------------------------------------------
// §A · THE WIDTHS
// ---------------------------------------------------------------------------

describe('fix-489 §A: the sf boxes are wider, and only the sf boxes', () => {
  it('★★★ the two sf controls carry the wide classes', () => {
    renderIt();
    expect(input('lotsize-target').className).toContain('w-20');
    expect(input('lotsize-buf').className).toContain('w-16');
    fireEvent.click(screen.getByTestId('filter-chip-unit'));
    expect(input('unitsize-target').className).toContain('w-20');
    expect(input('unitsize-buf').className).toContain('w-16');
  });

  it('★★★ the four ft controls are UNTOUCHED — the `ft` default is the guard', () => {
    // ★★★ THE MUST-NOT-CHANGE, ASSERTED. `unit` defaults to `'ft'`, so the four
    //     width/depth callers pass nothing and render exactly what they did
    //     before this ticket. A regression here means somebody widened the
    //     shared control instead of the two callers that needed it.
    renderIt();
    for (const id of ['lotw', 'lotd']) {
      expect(input(`${id}-target`).className).toContain('w-16');
      expect(input(`${id}-buf`).className).toContain('w-10');
      expect(input(`${id}-buf`).className).not.toContain('w-16');
    }
    fireEvent.click(screen.getByTestId('filter-chip-unit'));
    for (const id of ['unitw', 'unitd']) {
      expect(input(`${id}-target`).className).toContain('w-16');
      expect(input(`${id}-buf`).className).toContain('w-10');
    }
  });

  it('★★★ ONE control, not two — the chrome is identical either way', () => {
    // ★★ D-2026-09-02, consistency is a brand rule. Only the width class may
    //    differ; border, padding, font, centring and the focus ring come from
    //    the one `FIELD_CLASS` that all nine boxes share.
    renderIt();
    const shared = 'bg-surface border border-border rounded px-2 py-1 text-[11px]';
    for (const id of ['lotw-buf', 'lotd-buf', 'lotsize-buf', 'lotsize-target']) {
      expect(input(id).className, id).toContain(shared);
      expect(input(id).className, id).toContain('text-center');
      expect(input(id).type, id).toBe('number');
    }
  });

  it('★★★ jsdom CANNOT measure this, and says so out loud', () => {
    // ★★★ THE HONEST HALF. jsdom has no layout engine: every element reports
    //     clientWidth 0 and scrollWidth 0, so `expect(scrollWidth <=
    //     clientWidth)` passes here for a 1px box holding a novel. Asserting it
    //     in this file would be a test that cannot fail — worse than no test,
    //     because it reads like coverage.
    //
    // ★ So the width claim is measured in Chrome via
    //   `harness/library-size-boxes-489.html`, and this asserts the reason,
    //   so the next person does not "strengthen" this file into a lie.
    renderIt();
    const el = input('lotsize-buf');
    expect(el.clientWidth).toBe(0);
    expect(el.scrollWidth).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// THE HARNESS IS PINNED TO THE SOURCE
// ---------------------------------------------------------------------------

describe('fix-489: the measuring harness measures the REAL control', () => {
  const matrix = readFileSync(
    resolve(process.cwd(), 'src/components/LibraryMatrix.tsx'),
    'utf8',
  );
  const harness = readFileSync(
    resolve(process.cwd(), 'src/harness/librarySizeBoxes489.tsx'),
    'utf8',
  );

  it('★★★ the harness\'s FIELD_CLASS copy is VERBATIM from LibraryMatrix', () => {
    // ★★★ `TargetRange` and `FIELD_CLASS` are module-private and must stay so
    //     (`react-refresh/only-export-components` is an ERROR here), so the
    //     harness transcribes them — the fix-479 method. This is what stops it
    //     measuring a stale copy and reporting numbers about nothing.
    const grab = (src: string) => {
      const at = src.indexOf('const FIELD_CLASS =');
      expect(at, 'FIELD_CLASS not found').toBeGreaterThan(-1);
      return src.slice(at, src.indexOf(';', at)).replace(/\s+/g, ' ');
    };
    expect(grab(harness)).toBe(grab(matrix));
  });

  it('★★★ the harness measures the widths the app actually ships', () => {
    // ★ The four numbers that matter, in both files. If a caller is retuned and
    //   the harness is not, the next measurement is about the wrong control.
    expect(matrix).toContain("unit === 'sf' ? 'w-20' : 'w-16'");
    expect(matrix).toContain("unit === 'sf' ? 'w-16' : 'w-10'");
    expect(harness).toContain("sf: { target: 'w-20', buf: 'w-16' }");
    expect(harness).toContain("ft: { target: 'w-16', buf: 'w-10' }");
  });

  it('★★ both sf callers opt in, and no ft caller does', () => {
    const optIns = matrix.match(/unit="sf"/g) ?? [];
    expect(optIns).toHaveLength(2);
    expect(matrix).not.toContain('unit="ft"');
  });
});
