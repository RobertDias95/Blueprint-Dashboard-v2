import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TeamMember, TeamRole } from '../lib/database.types';

// ===========================================================================
// fix-343 §1/§2 — the top-right nameplate, rendered
// ===========================================================================
//
// ★ The pure decision is asserted in RoleLabelsFix343.test.ts. THIS file
// asserts the wiring, because the bug was never in a pure function: it was
// `identity.roles[0]` reaching a <div>. The roster hook is mocked with real
// prod-shaped rows and the REAL resolveRosterIdentity runs, so the ordering and
// the notes lookup are exercised end to end — mocking useSelfScope would have
// tested the mock.

const rosterRef = vi.hoisted(() => ({ rows: [] as TeamMember[] }));
const emailRef = vi.hoisted(() => ({ email: 'robertd@blueprintcap.com' }));

vi.mock('../lib/supabase', () => {
  const channelChain = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() };
  return {
    supabase: {
      auth: { signOut: vi.fn().mockResolvedValue({ error: null }) },
      from: () => ({ select: vi.fn().mockResolvedValue({ data: [], error: null }) }),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      channel: vi.fn(() => channelChain),
      removeChannel: vi.fn().mockResolvedValue(undefined),
    },
    supabaseUrl: 'http://test.local',
  };
});

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      session: null,
      user: { id: 'u1', email: emailRef.email },
      initialized: true,
      memberships: [{ tenant_id: 't1', role: 'editor' }],
      activeTenantId: 't1',
      setSession: vi.fn(),
      setInitialized: vi.fn(),
    }),
}));

vi.mock('../hooks/useTeamMembers', async (orig) => {
  const actual = await orig<typeof import('../hooks/useTeamMembers')>();
  return {
    ...actual,
    useTeamMembers: () => ({
      all: rosterRef.rows,
      activeDas: [],
      formerDas: [],
      dms: [],
      ents: [],
      acqs: [],
      schematics: [],
      activeMemberNames: actual.activeMemberNamesOf(rosterRef.rows),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: [], isLoading: false, error: null }),
}));
vi.mock('../components/NewProjectWizard', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="wizard-stub" /> : null),
}));

import Chrome from '../components/Chrome';

function member(over: Partial<TeamMember>): TeamMember {
  return {
    id: `m-${over.name}-${over.role}`,
    name: over.name ?? 'Someone',
    role: (over.role ?? 'da') as TeamRole,
    active: true,
    former: false,
    email: over.email ?? null,
    notes: null,
    updated_at: '2026-08-18T00:00:00Z',
    active_start_quarter: null,
    active_end_quarter: null,
    ...over,
  } as TeamMember;
}

function renderShell() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Chrome />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function roleLine(): string {
  return screen.getByTestId('chrome-user-role').textContent ?? '';
}

beforeEach(() => {
  window.localStorage.clear();
  emailRef.email = 'robertd@blueprintcap.com';
  rosterRef.rows = [];
});

// ---------------------------------------------------------------------------

describe('fix-343 §1: the plate shows a job title', () => {
  it("★★ Bobby's plate reads Entitlements Manager", () => {
    rosterRef.rows = [
      member({ name: 'Bobby', role: 'ent', email: 'robertd@blueprintcap.com' }),
      member({ name: 'Bobby', role: 'ent_lead', email: 'robertd@blueprintcap.com' }),
    ];
    renderShell();
    expect(screen.getByTestId('chrome-user-chip').textContent).toContain('Bobby');
    expect(roleLine()).toBe('Entitlements Manager');
  });

  // ★★ THE BUG, not a tidy-up: `roles[0]` took the first element of an array
  // with no guaranteed order. Same set, other order, same title.
  it('★★ …in either order the roster rows arrive in', () => {
    rosterRef.rows = [
      member({ name: 'Bobby', role: 'ent_lead', email: 'robertd@blueprintcap.com' }),
      member({ name: 'Bobby', role: 'ent', email: 'robertd@blueprintcap.com' }),
    ];
    renderShell();
    expect(roleLine()).toBe('Entitlements Manager');
  });

  it('★ a DA sees Design Associate, not "da"', () => {
    emailRef.email = 'nicky@blueprintcap.com';
    rosterRef.rows = [member({ name: 'Nicky', role: 'da', email: 'nicky@blueprintcap.com' })];
    renderShell();
    expect(roleLine()).toBe('Design Associate');
  });

  // ★ Derry and Lindsay do two real jobs. Both are shown.
  it('★★ Derry reads "Design Manager · Schematic Design"', () => {
    emailRef.email = 'derry@blueprintcap.com';
    rosterRef.rows = [
      member({ name: 'Derry', role: 'schematic', email: 'derry@blueprintcap.com' }),
      member({ name: 'Derry', role: 'dm', email: 'derry@blueprintcap.com' }),
    ];
    renderShell();
    expect(roleLine()).toBe('Design Manager · Schematic Design');
  });

  it('★★ no raw stored value reaches the plate', () => {
    for (const rows of [
      [member({ name: 'Bobby', role: 'ent_lead', email: 'robertd@blueprintcap.com' })],
      [member({ name: 'Bobby', role: 'da', email: 'robertd@blueprintcap.com' })],
      [member({ name: 'Bobby', role: 'acq_lead', email: 'robertd@blueprintcap.com' })],
      [member({ name: 'Bobby', role: 'schematic', email: 'robertd@blueprintcap.com' })],
      [member({ name: 'Bobby', role: 'viewer', email: 'robertd@blueprintcap.com', notes: 'IT' })],
    ]) {
      rosterRef.rows = rows;
      const view = renderShell();
      expect(roleLine(), rows[0].role).not.toMatch(
        /^(ent_lead|ent|dm|da|schematic|acq_lead|acq|viewer)$/,
      );
      expect(roleLine(), rows[0].role).not.toMatch(/_/);
      view.unmount();
    }
  });
});

describe('fix-343: a viewer shows their function', () => {
  it('★★ EJ reads Underwriting, and never "viewer"', () => {
    emailRef.email = 'ej@blueprintcap.com';
    rosterRef.rows = [
      member({ name: 'EJ', role: 'viewer', email: 'ej@blueprintcap.com', notes: 'Underwriting' }),
    ];
    renderShell();
    expect(roleLine()).toBe('Underwriting');
    expect(screen.getByTestId('chrome-user-chip').textContent).not.toMatch(/viewer/i);
  });

  it('★★ Darin reads CEO', () => {
    emailRef.email = 'darin@blueprintcap.com';
    rosterRef.rows = [
      member({ name: 'Darin', role: 'viewer', email: 'darin@blueprintcap.com', notes: 'CEO' }),
    ];
    renderShell();
    expect(roleLine()).toBe('CEO');
  });

  // ★ NO PLACEHOLDER. Nothing true is known about their job, so the plate falls
  // back to the neutral line it already used for an unmapped login.
  it('★ a viewer with no note still shows something sensible', () => {
    emailRef.email = 'quiet@blueprintcap.com';
    rosterRef.rows = [
      member({ name: 'Quiet', role: 'viewer', email: 'quiet@blueprintcap.com', notes: '' }),
    ];
    renderShell();
    expect(roleLine()).toBe('Blueprint Services');
    expect(roleLine()).not.toMatch(/viewer/i);
  });

  it('★ and an unmapped login is unchanged', () => {
    emailRef.email = 'stranger@example.com';
    rosterRef.rows = [];
    renderShell();
    expect(roleLine()).toBe('Blueprint Services');
    expect(screen.getByTestId('chrome-user-chip').textContent).toContain('Signed in');
  });
});
