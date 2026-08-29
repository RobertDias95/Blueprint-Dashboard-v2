import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import {
  BRIDGE_ROLES,
  ERROR_STATUS,
  MIN_PASSWORD_LENGTH,
  TEAM_ROLES,
  createPerson,
  resolveRosterAction,
  validateAddPerson,
  type AddPersonRequest,
  type Deps,
  type RosterRow,
} from '../../supabase/functions/admin-create-user/handler';
import {
  ADD_PERSON_ROLE_OPTIONS,
  generatePassword,
  namePlatePreview,
} from '../lib/addPerson';
import { rosterRoleTitle } from '../lib/roleLabels';
import type { TeamRole } from '../lib/database.types';

// ===========================================================================
// fix-436 (P-086) — Bobby can add a person to the Bridge himself
// ===========================================================================
//
// Darin and Eric were created on 2026-08-28 by hand-writing `auth.users`.
//
// ★★★ THE FUNCTION'S DECISIONS ARE TESTED FOR REAL, NOT MOCKED AROUND.
// `handler.ts` has no Deno, no fetch and no Supabase client in it — everything
// arrives through `Deps` — so CI, which has neither a Deno runtime nor a
// database, exercises the admin gate, the roster-reuse rule and the rollback
// exactly as they will run on the edge.

// ---------------------------------------------------------------------------
// Fake deps
// ---------------------------------------------------------------------------

interface Fake {
  deps: Deps;
  calls: string[];
  rosterRows: RosterRow[];
  authUsers: Set<string>;
  profileRoles: Map<string, 'admin' | 'editor'>;
  inserted: Record<string, unknown> | null;
  updated: { id: string; patch: Record<string, unknown> } | null;
  membershipInserted: boolean;
}

function fake(over: Partial<{
  callerRole: 'admin' | 'editor' | null;
  rosterRows: RosterRow[];
  createFails: { error: string; taken?: boolean } | null;
  rosterWriteThrows: string | null;
  tenantId: string | null;
  membershipMissing: boolean;
}> = {}): Fake {
  const state: Fake = {
    calls: [],
    rosterRows: over.rosterRows ?? [],
    authUsers: new Set<string>(),
    profileRoles: new Map(),
    inserted: null,
    updated: null,
    membershipInserted: false,
    deps: null as unknown as Deps,
  };
  const callerRole = over.callerRole === undefined ? 'admin' : over.callerRole;
  state.deps = {
    async callerId(jwt) {
      state.calls.push('callerId');
      return jwt === 'good' ? 'caller-1' : null;
    },
    async profileRole() {
      state.calls.push('profileRole');
      return callerRole;
    },
    async callerTenantId() {
      state.calls.push('callerTenantId');
      return over.tenantId === undefined ? 'tenant-1' : over.tenantId;
    },
    async findRosterRows() {
      state.calls.push('findRosterRows');
      return state.rosterRows;
    },
    async createAuthUser(email) {
      state.calls.push('createAuthUser');
      if (over.createFails) return over.createFails;
      state.authUsers.add('user-new');
      state.profileRoles.set('user-new', 'editor'); // ← the trigger
      void email;
      return { id: 'user-new' };
    },
    async deleteAuthUser(id) {
      state.calls.push('deleteAuthUser');
      state.authUsers.delete(id);
    },
    async updateRosterRow(id, patch) {
      state.calls.push('updateRosterRow');
      if (over.rosterWriteThrows) throw new Error(over.rosterWriteThrows);
      state.updated = { id, patch: { ...patch } };
    },
    async insertRosterRow(row) {
      state.calls.push('insertRosterRow');
      if (over.rosterWriteThrows) throw new Error(over.rosterWriteThrows);
      state.inserted = { ...row };
      return 'roster-new';
    },
    async ensureMembership(_u, _t, role) {
      state.calls.push('ensureMembership');
      void role;
      state.membershipInserted = over.membershipMissing === true;
      return state.membershipInserted;
    },
    async setProfileRole(userId, role) {
      state.calls.push('setProfileRole');
      state.profileRoles.set(userId, role);
    },
  };
  return state;
}

function req(over: Partial<AddPersonRequest> = {}): AddPersonRequest {
  return {
    email: 'nadia@blueprintcap.com',
    password: 'Correct-Horse-9',
    first_name: 'Nadia',
    last_name: 'Okafor',
    name: 'Nadia',
    role: 'da',
    notes: null,
    bridge_role: 'editor',
    ...over,
  };
}

function rosterRow(over: Partial<RosterRow> & Pick<RosterRow, 'name' | 'role'>): RosterRow {
  return {
    id: `r-${over.name}-${over.role}`,
    email: null,
    active: true,
    former: false,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// A2 — the gate
// ---------------------------------------------------------------------------

describe('fix-436 §A2 — the caller gate is inside the function', () => {
  it('★★★ a NON-ADMIN gets 403 and nothing is created', async () => {
    const f = fake({ callerRole: 'editor' });
    const res = await createPerson(f.deps, 'good', req());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('not_admin');
    expect(ERROR_STATUS[res.code]).toBe(403);
    expect(res.message).toBe('You are not an admin, so you cannot add people.');
    // ★★ The refusal happens BEFORE anything is written — no auth user, no
    //    roster lookup, nothing to roll back.
    expect(f.calls).not.toContain('createAuthUser');
    expect(f.calls).not.toContain('findRosterRows');
    expect(f.authUsers.size).toBe(0);
  });

  it('★★ an unreadable token is 401, and the profile is never consulted', async () => {
    const f = fake();
    const res = await createPerson(f.deps, 'rubbish', req());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('unauthenticated');
    expect(ERROR_STATUS[res.code]).toBe(401);
    expect(f.calls).not.toContain('profileRole');
  });

  it('★★ no token at all is 401', async () => {
    const f = fake();
    const res = await createPerson(f.deps, null, req());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('unauthenticated');
    expect(f.calls).toEqual([]);
  });

  it('★ the gate runs before validation, so a bad body cannot leak the shape', async () => {
    const f = fake({ callerRole: 'editor' });
    const res = await createPerson(f.deps, 'good', { email: 'nope' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('not_admin');
  });
});

// ---------------------------------------------------------------------------
// A5 — the roster rule
// ---------------------------------------------------------------------------

describe('fix-436 §A5 — reuse before insert', () => {
  it('★★★ DARIN’S CASE: a name-matched row with NO email is filled in, not duplicated', async () => {
    // Measured on prod: `Darin`/`viewer` sat with a NULL email for ten days
    // after his login was hand-made.
    const f = fake({ rosterRows: [rosterRow({ name: 'Darin', role: 'viewer' })] });
    const res = await createPerson(
      f.deps,
      'good',
      req({
        email: 'darin@blueprintcap.com',
        first_name: 'Darin',
        last_name: 'Granger',
        name: 'Darin',
        role: 'viewer',
        notes: 'CEO',
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.roster.action).toBe('reused');
    expect(f.inserted).toBeNull();
    expect(f.updated).toEqual({
      id: 'r-Darin-viewer',
      patch: {
        email: 'darin@blueprintcap.com',
        first_name: 'Darin',
        last_name: 'Granger',
        notes: 'CEO',
      },
    });
    // ★★★ name and role are NOT in the patch — the name is a join key across
    //     ~2,209 assignment rows and this path may never move it.
    expect(Object.keys(f.updated!.patch)).not.toContain('name');
    expect(Object.keys(f.updated!.patch)).not.toContain('role');
  });

  it('★★ the EMAIL wins over the name — the row already carrying it is the person', () => {
    const rows = [
      rosterRow({ name: 'Nadia', role: 'da', email: null }),
      rosterRow({ name: 'Nads', role: 'dm', email: 'Nadia@BluePrintCap.com ' }),
    ];
    const action = resolveRosterAction(rows, {
      name: 'Nadia',
      role: 'da',
      email: 'nadia@blueprintcap.com',
    });
    expect(action.kind).toBe('reuse');
    if (action.kind === 'reuse') expect(action.row.name).toBe('Nads');
  });

  it('★★★ a name held by SOMEBODY ELSE is refused, never merged', async () => {
    // ★ Eric (viewer, eric@) and Erick (da, eruivo@) are one letter apart on
    //   the real roster. Reusing a name-matched row that already carries a
    //   different address would hand one person's work to another.
    const f = fake({
      rosterRows: [
        rosterRow({ name: 'Eric', role: 'viewer', email: 'eric@blueprintcap.com' }),
      ],
    });
    const res = await createPerson(
      f.deps,
      'good',
      req({ name: 'Eric', email: 'enewman@blueprintcap.com', role: 'da' }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('roster_name_taken');
    expect(ERROR_STATUS[res.code]).toBe(409);
    expect(res.field).toBe('name');
    expect(res.message).toContain('eric@blueprintcap.com');
    // ★★ Checked BEFORE the auth user exists, so this common mistake never
    //    needs a rollback.
    expect(f.calls).not.toContain('createAuthUser');
  });

  it('★★ (name, role) is the unique key, so an exact role match is preferred', () => {
    const rows = [
      rosterRow({ name: 'Derry', role: 'dm' }),
      rosterRow({ name: 'Derry', role: 'schematic' }),
    ];
    const action = resolveRosterAction(rows, {
      name: 'Derry',
      role: 'schematic',
      email: 'derry@blueprintcap.com',
    });
    expect(action.kind).toBe('reuse');
    if (action.kind === 'reuse') expect(action.row.role).toBe('schematic');
  });

  it('★ nobody matching → a fresh row, active and not former', async () => {
    const f = fake();
    const res = await createPerson(f.deps, 'good', req());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.roster.action).toBe('inserted');
    expect(f.inserted).toEqual({
      name: 'Nadia',
      role: 'da',
      email: 'nadia@blueprintcap.com',
      first_name: 'Nadia',
      last_name: 'Okafor',
      notes: null,
      tenant_id: 'tenant-1',
      active: true,
      former: false,
    });
  });

  it('★ a reused row that is RETIRED is reported, never silently revived', async () => {
    const f = fake({
      rosterRows: [rosterRow({ name: 'Nadia', role: 'da', active: false, former: true })],
    });
    const res = await createPerson(f.deps, 'good', req());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.roster.was_retired).toBe(true);
    // fix-407's two-flag rule is somebody else's decision — untouched here.
    expect(Object.keys(f.updated!.patch)).not.toContain('active');
    expect(Object.keys(f.updated!.patch)).not.toContain('former');
  });
});

// ---------------------------------------------------------------------------
// A3/A4/A6/A7 — creation, the trigger's half, and the rollback
// ---------------------------------------------------------------------------

describe('fix-436 §A3–A7 — one logical operation', () => {
  it('★★★ a duplicate email is a clean error, not a stack trace', async () => {
    const f = fake({
      createFails: { error: 'A user with this email address has already been registered', taken: true },
    });
    const res = await createPerson(f.deps, 'good', req());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('email_taken');
    expect(ERROR_STATUS[res.code]).toBe(409);
    expect(res.message).toBe('That email already has a login.');
    expect(res.field).toBe('email');
    // ★ Nothing to delete: the user was never created.
    expect(f.calls).not.toContain('deleteAuthUser');
  });

  it('★★★ A6 — a roster write that fails DELETES the auth user. No half-people.', async () => {
    const f = fake({ rosterWriteThrows: 'duplicate key value violates unique constraint' });
    const res = await createPerson(f.deps, 'good', req());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('roster_failed');
    expect(res.message).toContain('rolled back');
    expect(f.calls).toContain('deleteAuthUser');
    // ★★ A login with no roster row is exactly the state this ticket exists to
    //    stop: the person signs in and the Bridge shows them no name, no title
    //    and no work, because resolveRosterIdentity has nothing to match.
    expect(f.authUsers.size).toBe(0);
  });

  it('★★ THE TRIGGER OWNS profiles — the function never inserts it', async () => {
    const f = fake();
    const res = await createPerson(f.deps, 'good', req({ bridge_role: 'editor' }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.profile.created_by).toBe('trigger');
    // An editor needs no profile write at all — the trigger already wrote
    // role='editor'.
    expect(f.calls).not.toContain('setProfileRole');
    expect(f.profileRoles.get('user-new')).toBe('editor');
  });

  it('★★★ A4 — an ADMIN gets BOTH rows raised, not one', async () => {
    const f = fake();
    const res = await createPerson(f.deps, 'good', req({ bridge_role: 'admin' }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // profiles.role — read by the server-side admin RLS and by this function's
    // own gate for the next person they add.
    expect(f.profileRoles.get('user-new')).toBe('admin');
    expect(f.calls).toContain('setProfileRole');
    // tenant_memberships.role — read by useIsTenantAdmin for the UI.
    expect(res.membership.role).toBe('admin');
    expect(f.calls).toContain('ensureMembership');
  });

  it('★★ a NON-blueprintcap address gets the membership the trigger skipped', async () => {
    const f = fake({ membershipMissing: true });
    const res = await createPerson(
      f.deps,
      'good',
      req({ email: 'contractor@example.com' }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.membership.source).toBe('function');
  });

  it('★ a @blueprintcap.com address reports the trigger as the source', async () => {
    const f = fake({ membershipMissing: false });
    const res = await createPerson(f.deps, 'good', req());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.membership.source).toBe('trigger');
  });

  it('★ a caller with no organization of their own is refused', async () => {
    const f = fake({ tenantId: null });
    const res = await createPerson(f.deps, 'good', req());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('no_tenant');
    expect(f.calls).not.toContain('createAuthUser');
  });

  it('★ A7 — the response says which rows were touched', async () => {
    const f = fake();
    const res = await createPerson(f.deps, 'good', req());
    expect(res).toMatchObject({
      ok: true,
      user_id: 'user-new',
      email: 'nadia@blueprintcap.com',
      roster: { action: 'inserted', id: 'roster-new', name: 'Nadia', role: 'da' },
      profile: { role: 'editor', created_by: 'trigger' },
      membership: { role: 'editor', source: 'trigger' },
    });
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('fix-436 — validation', () => {
  it('rejects a malformed email, a short password and empty names', () => {
    const cases: Array<[Partial<AddPersonRequest>, keyof AddPersonRequest]> = [
      [{ email: 'not-an-email' }, 'email'],
      [{ password: 'short' }, 'password'],
      [{ first_name: '   ' }, 'first_name'],
      [{ last_name: '' }, 'last_name'],
      [{ role: 'nonsense' as never }, 'role'],
      [{ bridge_role: 'viewer' as never }, 'bridge_role'],
    ];
    for (const [patch, field] of cases) {
      const r = validateAddPerson({ ...req(), ...patch });
      expect(r.ok, field).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe('invalid');
        expect(r.field).toBe(field);
      }
    }
  });

  it('★★ bridge_role is TWO values, because profiles_role_check allows two', () => {
    // Measured on prod: CHECK (role = ANY (ARRAY['admin','editor'])). There is
    // no read-only tier, so the screen must not offer one.
    expect([...BRIDGE_ROLES]).toEqual(['admin', 'editor']);
    expect(validateAddPerson({ ...req(), bridge_role: 'editor' }).ok).toBe(true);
    expect(validateAddPerson({ ...req(), bridge_role: 'admin' }).ok).toBe(true);
  });

  it('★ roster name defaults to the first name, trimmed', () => {
    const r = validateAddPerson({ ...req(), name: '   ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.name).toBe('Nadia');
  });

  it('★ an empty title becomes NULL rather than an empty string', () => {
    const r = validateAddPerson({ ...req(), notes: '  ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.notes).toBeNull();
  });

  it('★★ TEAM_ROLES matches the app’s TeamRole union exactly', () => {
    // The function cannot import from src/ (Deno would have to resolve the app
    // tree), so this is the seam. A role added to the app and not here would be
    // silently unofferable; the reverse would be written and never read.
    const appRoles: TeamRole[] = [
      'da',
      'dm',
      'ent',
      'ent_lead',
      'acq',
      'acq_lead',
      'schematic',
      'viewer',
      'director',
    ];
    expect([...TEAM_ROLES].sort()).toEqual([...appRoles].sort());
    expect(ADD_PERSON_ROLE_OPTIONS.map((o) => o.value).sort()).toEqual(
      [...appRoles].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// The plate preview + the generator
// ---------------------------------------------------------------------------

describe('fix-436 §C2 — the name plate preview', () => {
  it('★★★ "Darin / CEO" — a viewer prints its NOTE, per fix-343', () => {
    expect(namePlatePreview('Darin', 'viewer', 'CEO')).toEqual({
      name: 'Darin',
      title: 'CEO',
    });
  });

  it('★★ a real role prints its ROLE TITLE and ignores the note', () => {
    expect(namePlatePreview('Nadia', 'da', 'whatever')).toEqual({
      name: 'Nadia',
      title: 'Design Associate',
    });
  });

  it('★★ it is built from the SAME function Chrome uses, not a copy', () => {
    for (const role of ADD_PERSON_ROLE_OPTIONS.map((o) => o.value)) {
      expect(namePlatePreview('X', role, 'Note').title).toBe(
        rosterRoleTitle([role], 'Note') ?? 'Blueprint Services',
      );
    }
  });

  it('★ a viewer with no note falls back to the chip’s own neutral line', () => {
    expect(namePlatePreview('Sam', 'viewer', null).title).toBe('Blueprint Services');
  });

  it('★ the generated password is long enough and avoids look-alike glyphs', () => {
    const pw = generatePassword(() => 0.5);
    expect(pw.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
    expect(pw).not.toMatch(/[Il1O0]/);
    expect(validateAddPerson({ ...req(), password: pw }).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({
  supabase: { functions: { invoke: invokeMock } },
}));

import AddPersonSection from '../components/Settings/AddPersonSection';

function renderSection(readOnly = false) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<AddPersonSection readOnly={readOnly} />, { wrapper });
}

function fillForm(over: Record<string, string> = {}) {
  const set = (testid: string, value: string) =>
    fireEvent.change(screen.getByTestId(testid), { target: { value } });
  set('add-person-email', over.email ?? 'nadia@blueprintcap.com');
  set('add-person-first', over.first ?? 'Nadia');
  set('add-person-last', over.last ?? 'Okafor');
  set('add-person-password', over.password ?? 'Correct-Horse-9');
}

beforeEach(() => {
  invokeMock.mockReset();
  useAuthStore.setState({
    user: { id: 'u-bobby', email: 'bobby@blueprintcap.com' } as never,
    activeTenantId: 'tenant-1',
    memberships: [{ tenant_id: 'tenant-1', role: 'admin' }],
  });
});

describe('fix-436 §C — the screen', () => {
  it('★★★ admin-gated: a non-admin sees no control at all', () => {
    const { container } = renderSection(true);
    expect(screen.queryByTestId('add-person-section')).toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('★ an admin gets the card, and C4’s pointer at the roster', () => {
    renderSection();
    expect(screen.getByTestId('add-person-open')).toBeInTheDocument();
    const link = screen.getByTestId('add-person-deactivate-link');
    expect(link.getAttribute('href')).toBe('#team-roster');
    expect(
      screen.getByTestId('add-person-section').textContent,
    ).toContain('Removing someone is not done here');
  });

  it('★★★ C5 — a BACKDROP CLICK DOES NOT DISCARD INPUT', () => {
    renderSection();
    fireEvent.click(screen.getByTestId('add-person-open'));
    fillForm();
    // ★ The dialog root IS the backdrop; clicking it must do nothing at all.
    fireEvent.click(screen.getByTestId('add-person-dialog'));
    expect(screen.getByTestId('add-person-dialog')).toBeInTheDocument();
    expect((screen.getByTestId('add-person-email') as HTMLInputElement).value).toBe(
      'nadia@blueprintcap.com',
    );
    // ★★ …and neither does Escape, which is the same decision for the same
    //    reason (fix-411 §1). Written down so nobody "fixes the
    //    inconsistency".
    fireEvent.keyDown(screen.getByTestId('add-person-dialog'), { key: 'Escape' });
    expect(screen.getByTestId('add-person-dialog')).toBeInTheDocument();
    expect((screen.getByTestId('add-person-first') as HTMLInputElement).value).toBe(
      'Nadia',
    );
  });

  it('★ Cancel is an explicit exit and clears the form', () => {
    renderSection();
    fireEvent.click(screen.getByTestId('add-person-open'));
    fillForm();
    fireEvent.click(screen.getByTestId('add-person-cancel'));
    expect(screen.queryByTestId('add-person-dialog')).toBeNull();
    fireEvent.click(screen.getByTestId('add-person-open'));
    expect((screen.getByTestId('add-person-email') as HTMLInputElement).value).toBe('');
  });

  it('★★ the roster name follows the first name until it is typed over', () => {
    renderSection();
    fireEvent.click(screen.getByTestId('add-person-open'));
    fireEvent.change(screen.getByTestId('add-person-first'), {
      target: { value: 'Chris' },
    });
    expect((screen.getByTestId('add-person-roster-name') as HTMLInputElement).value).toBe(
      'Chris',
    );
    fireEvent.change(screen.getByTestId('add-person-roster-name'), {
      target: { value: 'Chris R' },
    });
    fireEvent.change(screen.getByTestId('add-person-first'), {
      target: { value: 'Christopher' },
    });
    expect((screen.getByTestId('add-person-roster-name') as HTMLInputElement).value).toBe(
      'Chris R',
    );
  });

  it('★★★ the plate preview moves with the role, live', () => {
    renderSection();
    fireEvent.click(screen.getByTestId('add-person-open'));
    fireEvent.change(screen.getByTestId('add-person-first'), {
      target: { value: 'Darin' },
    });
    expect(screen.getByTestId('add-person-plate-title').textContent).toBe(
      'Design Associate',
    );
    fireEvent.change(screen.getByTestId('add-person-role'), {
      target: { value: 'viewer' },
    });
    fireEvent.change(screen.getByTestId('add-person-notes'), {
      target: { value: 'CEO' },
    });
    expect(screen.getByTestId('add-person-plate-name').textContent).toBe('Darin');
    expect(screen.getByTestId('add-person-plate-title').textContent).toBe('CEO');
  });

  it('★ Generate fills a password the function would accept', () => {
    renderSection();
    fireEvent.click(screen.getByTestId('add-person-open'));
    fireEvent.click(screen.getByTestId('add-person-generate'));
    const pw = (screen.getByTestId('add-person-password') as HTMLInputElement).value;
    expect(pw.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
  });

  it('★★★ success shows the plate, the password once, and what was written', async () => {
    invokeMock.mockResolvedValue({
      data: {
        ok: true,
        user_id: 'user-new',
        email: 'nadia@blueprintcap.com',
        roster: {
          action: 'inserted',
          id: 'r1',
          name: 'Nadia',
          role: 'da',
          was_retired: false,
        },
        profile: { role: 'editor', created_by: 'trigger' },
        membership: { role: 'editor', source: 'trigger' },
      },
      error: null,
    });
    renderSection();
    fireEvent.click(screen.getByTestId('add-person-open'));
    fillForm();
    fireEvent.click(screen.getByTestId('add-person-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('add-person-success')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('add-person-plate-name').textContent).toBe('Nadia');
    expect(screen.getByTestId('add-person-plate-title').textContent).toBe(
      'Design Associate',
    );
    expect(
      screen.getByTestId('add-person-password-readout').textContent,
    ).toContain('Correct-Horse-9');
    expect(screen.getByTestId('add-person-receipt').textContent).toContain(
      'Roster row created',
    );

    // ★ The call carried the roster name and the role, and nothing about the
    //   caller — the function reads that from the token.
    const [fnName, opts] = invokeMock.mock.calls[0];
    expect(fnName).toBe('admin-create-user');
    expect(opts.body).toMatchObject({
      email: 'nadia@blueprintcap.com',
      name: 'Nadia',
      role: 'da',
      bridge_role: 'editor',
    });
    expect(Object.keys(opts.body)).not.toContain('tenant_id');
    expect(Object.keys(opts.body)).not.toContain('user_id');
  });

  it('★★★ C3 — the function’s own sentence is what the screen shows', async () => {
    invokeMock.mockResolvedValue({
      data: {
        ok: false,
        code: 'email_taken',
        field: 'email',
        message: 'That email already has a login.',
      },
      error: null,
    });
    renderSection();
    fireEvent.click(screen.getByTestId('add-person-open'));
    fillForm();
    fireEvent.click(screen.getByTestId('add-person-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('add-person-error').textContent).toBe(
        'That email already has a login.',
      ),
    );
    // ★ And the typing survives the refusal — the form is still there to fix.
    expect((screen.getByTestId('add-person-first') as HTMLInputElement).value).toBe(
      'Nadia',
    );
  });

  it('★★ an undeployed function says so, and says nothing was created', async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('Requested function was not found'), {}),
    });
    renderSection();
    fireEvent.click(screen.getByTestId('add-person-open'));
    fillForm();
    fireEvent.click(screen.getByTestId('add-person-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('add-person-error').textContent).toContain(
        'not deployed yet',
      ),
    );
    expect(screen.getByTestId('add-person-error').textContent).toContain(
      'Nothing was created',
    );
  });
});

// ---------------------------------------------------------------------------
// Source contract
// ---------------------------------------------------------------------------

import indexSrc from '../../supabase/functions/admin-create-user/index.ts?raw';
import handlerSrc from '../../supabase/functions/admin-create-user/handler.ts?raw';
import teamTabSrc from '../components/Settings/AdminTeamTab.tsx?raw';
import dialogSrc from '../components/Settings/AddPersonDialog.tsx?raw';

function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('fix-436 — source contract', () => {
  it('the stripper actually stripped', () => {
    expect(handlerSrc).toContain('NO HALF-PEOPLE');
    expect(code(handlerSrc)).not.toContain('NO HALF-PEOPLE');
  });

  it('★★★ the service-role key is read in the function and nowhere else', () => {
    expect(code(indexSrc)).toContain("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')");
    // ★★ handler.ts is the file CI runs; it must have no way to reach a key,
    //    an env var or the network.
    expect(code(handlerSrc)).not.toMatch(/Deno|SERVICE_ROLE|fetch\(|createClient/);
  });

  it('★★★ the function never inserts profiles — the trigger owns it', () => {
    const src = code(indexSrc);
    expect(src).not.toMatch(/from\('profiles'\)\s*\.insert/);
    // It may only ever UPDATE the role.
    expect(src).toContain("from('profiles').update({ role })");
  });

  it('★★ the roster patch cannot carry a name or a role', () => {
    const src = code(handlerSrc);
    expect(src).toMatch(/interface RosterPatch \{[^}]*\}/);
    const patch = /interface RosterPatch \{([^}]*)\}/.exec(src)?.[1] ?? '';
    const fields = patch
      .split(/\r?\n/)
      .map((l) => l.trim().split(/[?:]/)[0].trim())
      .filter(Boolean);
    // ★ `first_name` and `last_name` are fine — they are display columns. The
    //   two that may never travel on the reuse path are the JOIN KEY and the
    //   role that pairs with it in the unique index.
    expect(fields).toEqual(['email', 'first_name', 'last_name', 'notes']);
    expect(fields).not.toContain('name');
    expect(fields).not.toContain('role');
  });

  it('★★★ the dialog has NO backdrop onClick and NO Escape handler', () => {
    const src = code(dialogSrc);
    // The dialog root carries role="dialog"; the only handlers in the file are
    // on real controls.
    expect(src).not.toMatch(/aria-modal="true"[\s\S]{0,200}onClick=/);
    expect(src).not.toContain('onKeyDown');
    expect(src).not.toContain("key === 'Escape'");
  });

  it('★ the card is mounted on the Team tab, above the roster anchor', () => {
    const src = code(teamTabSrc);
    expect(src).toContain('<AddPersonSection readOnly={!isAdmin} />');
    expect(src.indexOf('<AddPersonSection')).toBeLessThan(
      src.indexOf('id="team-roster"'),
    );
  });
});
