import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';

// ===========================================================================
// fix-659 (P-318) — three saves that stored the wrong thing
//   32 · the wizard's builder pick is the link; pickers hide deactivated rows
//   29 · "permits with no lead" saves the way Project Details does
//   42 · a sign-in email has one editor, which moves login + roster together
// ===========================================================================

const SRC = join(process.cwd(), 'src');
const MIGRATION = readFileSync(
  join(process.cwd(), 'migrations/fix_659_three_wrong_saves.sql'),
  'utf8',
);

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
const st = vi.hoisted(() => ({
  builders: [] as Array<Record<string, unknown>>,
  update: vi.fn(),
  hasLogin: true as boolean | undefined,
  isAdmin: true,
  change: vi.fn(),
  save: vi.fn(),
}));

vi.mock('../hooks/useBuilderSearch', () => ({
  useBuilderSearch: (q: string) => ({
    data: q ? st.builders : [],
    isLoading: false,
  }),
}));
vi.mock('../hooks/useBuilderRegistry', () => ({
  useAddBuilderFromProject: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../hooks/usePermits', () => ({
  usePermits: () => ({
    data: [
      { id: 1, project_id: 'pA', num: 'x-1', type: 'Building Permit', status: 'Issued', da: 'Fisk', ent_lead: null, updated_at: 'u1' },
      { id: 2, project_id: 'pB', num: 'x-2', type: 'Building Permit', status: 'Issued', da: 'Nobody', ent_lead: null, updated_at: 'u2' },
    ],
    isLoading: false,
  }),
}));
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({
    data: [
      { id: 'pA', address: '1 A St', juris: 'Seattle', updated_at: 'pa' },
      { id: 'pB', address: '2 B St', juris: 'Seattle', updated_at: 'pb' },
    ],
    isLoading: false,
  }),
}));
vi.mock('../hooks/useAllPermitTasks', () => ({
  useAllPermitTasks: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/useUpdateProjectWithPermits', () => ({
  useUpdateProjectWithPermits: () => ({ mutate: st.update, isPending: false }),
}));

vi.mock('../hooks/useSignInEmail', () => ({
  useRosterNameHasLogin: () => ({ data: st.hasLogin, isLoading: st.hasLogin === undefined }),
  useChangeSignInEmail: () => ({ mutate: st.change, isPending: false }),
}));
vi.mock('../hooks/useSetPersonDetails', () => ({
  useSetPersonDetails: () => ({ mutate: st.save, isPending: false, error: null }),
}));
vi.mock('../hooks/useUpsertTeamMember', () => ({
  useUpsertTeamMember: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useAgendaMember', () => ({
  useAgendaMemberNames: () => [],
  useSetAgendaMember: () => ({ mutate: vi.fn(), isPending: false }),
  useIsAgendaMember: () => false,
}));
vi.mock('../hooks/useSetTeamDepartment', () => ({
  useSetTeamDepartment: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useIsTenantAdmin', () => ({ useIsTenantAdmin: () => st.isAdmin }));
vi.mock('../hooks/useAvatars', () => ({
  useProfileIdForRosterName: () => ({ data: null, isLoading: false }),
  useAvatarPathFor: () => () => null,
  useAvatarIndex: () => new Map(),
  useSignedAvatarUrl: () => ({ data: null, isLoading: false }),
  useSetAvatar: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { default: BuilderAutocompleteField } = await import(
  '../components/builder/BuilderAutocompleteField'
);
const { default: BuilderPicker } = await import('../components/builder/BuilderPicker');
const { makeRedesignWizardState } = await import('../components/wizard/wizardState');
const { default: PermitsMissingLeadPanel } = await import(
  '../components/Settings/PermitsMissingLeadPanel'
);
const { missingLeadSaveInput } = await import('../lib/unclaimedWork');
const { routedEntLeadFor } = await import('../lib/daRouting');
const { default: PersonDetailsDialog } = await import(
  '../components/Settings/PersonDetailsDialog'
);
const handler = await import('../../supabase/functions/admin-change-sign-in-email/handler');

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  st.builders = [];
  st.update.mockReset();
  st.change.mockReset();
  st.save.mockReset();
  st.hasLogin = true;
  st.isAdmin = true;
});

// ===========================================================================
// 32 — the builder
// ===========================================================================
describe('fix-659 · 32 — the wizard builder pick', () => {
  const LIVE = { id: 'b-live', name: 'Jerry Allensworth', company: null, active: true };
  const DEAD = { id: 'b-dead', name: 'Jerry Old', company: 'Old LLC', active: false };

  it('★★★ the autocomplete offers active builders only', () => {
    st.builders = [LIVE, DEAD];
    wrap(
      <BuilderAutocompleteField
        value="Jer"
        onChange={() => {}}
        onSelectBuilder={() => {}}
        field="name"
        label="Builder Name"
        testid="wiz-b"
      />,
    );
    fireEvent.focus(screen.getByTestId('wiz-b'));
    const menu = screen.getByTestId('wiz-b-menu');
    expect(menu.textContent).toContain('Jerry Allensworth');
    expect(menu.textContent).not.toContain('Jerry Old');
  });

  it('★★★ picking hands the parent the ROW (its id), not just text', () => {
    st.builders = [LIVE];
    const onSelect = vi.fn();
    wrap(
      <BuilderAutocompleteField
        value="Jer"
        onChange={() => {}}
        onSelectBuilder={onSelect}
        field="name"
        label="Builder Name"
        testid="wiz-b"
      />,
    );
    fireEvent.focus(screen.getByTestId('wiz-b'));
    fireEvent.click(screen.getByText('Jerry Allensworth'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'b-live' }));
  });

  it('★★ the wizard stores the pick as builder_id and sends it to the RPC', () => {
    const step1 = readFileSync(join(SRC, 'components/wizard/Step1ProjectInfo.tsx'), 'utf8');
    expect(step1).toMatch(/builder_id: b\.id,/);
    // typing over the name or the company drops the link
    expect(step1).toMatch(/onChange\(\{ builder_name: v, builder_id: null \}\)/);
    expect(step1).toMatch(/onChange\(\{ builder_company: v, builder_id: null \}\)/);
    const wiz = readFileSync(join(SRC, 'components/NewProjectWizard.tsx'), 'utf8');
    expect(wiz).toMatch(/builder_id: state\.builder_name\.trim\(\) \? state\.builder_id : null/);
  });

  it('★★ a redesign carries the parent builder LINK, deactivated or not', () => {
    const s = makeRedesignWizardState(
      { id: 'p1', address: '1 A St', builder_id: 'b-dead', builder_name: 'Jerry Old' },
      null,
    );
    expect(s.builder_id).toBe('b-dead');
    expect(s.builder_name).toBe('Jerry Old');
  });

  it('★★★ Overview: a deactivated linked builder stays shown, marked (inactive)', () => {
    wrap(
      <BuilderPicker
        projectId="p1"
        value="Jerry Old — Old LLC"
        onPick={() => {}}
        onCreated={() => {}}
        onClear={() => {}}
        inactive
        testid="pd-b"
      />,
    );
    expect((screen.getByTestId('pd-b') as HTMLInputElement).value).toBe('Jerry Old — Old LLC');
    expect(screen.getByTestId('pd-b-inactive').textContent).toBe('(inactive)');
  });

  it('★ an active linked builder carries no mark', () => {
    wrap(
      <BuilderPicker
        projectId="p1"
        value="Jerry Allensworth"
        onPick={() => {}}
        onCreated={() => {}}
        onClear={() => {}}
        testid="pd-b"
      />,
    );
    expect(screen.queryByTestId('pd-b-inactive')).toBeNull();
  });

  it('★★★ the RPC links a picked id as-is and reuses a NULL-company row (no duplicate)', () => {
    expect(MIGRATION).toMatch(/WHERE b\.id = \(v_pd->>''builder_id''\)::uuid AND b\.tenant_id = p_tenant_id/);
    expect(MIGRATION).toMatch(/b\.company IS NOT DISTINCT FROM NULLIF/);
    expect(MIGRATION).toMatch(/ORDER BY \(b\.active IS NOT FALSE\) DESC/);
    // the anchor guard: exactly one match or the migration aborts
    expect(MIGRATION).toMatch(/IF v_n <> 1 THEN/);
  });
});

// ===========================================================================
// 29 — the lead-less permits list
// ===========================================================================
describe('fix-659 · 29 — the lead-less list saves like Project Details', () => {
  const ROUTING = [
    { da: 'Fisk', jurisdiction: null, ent_lead: 'Miles' },
    { da: 'Fisk', jurisdiction: 'Seattle', ent_lead: 'Briana' },
  ];

  it('★★★ routedEntLeadFor mirrors bp_ent_lead_for_da (specific beats default)', () => {
    expect(routedEntLeadFor('Fisk', 'Seattle', ROUTING)).toBe('Briana');
    expect(routedEntLeadFor('Fisk', 'Bellevue', ROUTING)).toBe('Miles');
    expect(routedEntLeadFor('Nobody', 'Seattle', ROUTING)).toBeNull();
    expect(routedEntLeadFor(null, 'Seattle', ROUTING)).toBeNull();
  });

  it('★★★ the save is one permit upsert through bp_update_project_with_permits', () => {
    expect(
      missingLeadSaveInput({ permitId: 9, projectId: 'pX', updatedAt: 'ux' }, ' Miles ', 'pux'),
    ).toEqual({
      projectId: 'pX',
      projectExpectedUpdatedAt: 'pux',
      projectPatch: {},
      permitUpserts: [{ id: 9, expected_updated_at: 'ux', ent_lead: 'Miles' }],
      permitDeletes: [],
    });
  });

  it('★★★ it is the SAME permit element Project Details sends for that lead', () => {
    // Project Details builds { id, expected_updated_at, ...fields } with
    // `ent_lead: row.ent_lead.trim() || null` — the list sends the same keys
    // for the field it edits, through the same mutation hook.
    const pd = readFileSync(join(SRC, 'hooks/useProjectDetailsForm.ts'), 'utf8');
    expect(pd).toMatch(/ent_lead: row\.ent_lead\.trim\(\) \|\| null/);
    expect(pd).toMatch(/expected_updated_at: row\.updated_at/);
    expect(pd).toMatch(/updateProjectWithPermits\.mutateAsync/);
    const panel = readFileSync(
      join(SRC, 'components/Settings/PermitsMissingLeadPanel.tsx'),
      'utf8',
    );
    expect(panel).toMatch(/useUpdateProjectWithPermits\(\)/);
    expect(panel).not.toMatch(/from '\.\.\/\.\.\/hooks\/useUpdatePermit'/);
  });

  it('★★ the routed lead is offered first, and picking it saves it', () => {
    wrap(
      <PermitsMissingLeadPanel
        ents={[{ id: 'e1', name: 'Miles' }, { id: 'e2', name: 'Briana' }] as never}
        routing={ROUTING}
        readOnly={false}
      />,
    );
    const routed = screen.getByTestId('missing-lead-routed-1') as HTMLOptionElement;
    expect(routed.textContent).toBe('Briana (routed for Fisk)');
    // the unrouted DA gets no suggestion
    expect(screen.queryByTestId('missing-lead-routed-2')).toBeNull();
    fireEvent.change(screen.getByTestId('missing-lead-set-1'), {
      target: { value: 'Briana' },
    });
    expect(st.update).toHaveBeenCalledTimes(1);
    expect(st.update.mock.calls[0]![0]).toEqual({
      projectId: 'pA',
      projectExpectedUpdatedAt: 'pa',
      projectPatch: {},
      permitUpserts: [{ id: 1, expected_updated_at: 'u1', ent_lead: 'Briana' }],
      permitDeletes: [],
    });
  });
});

// ===========================================================================
// 42 — the sign-in email
// ===========================================================================
const RICE = {
  name: 'Rice',
  roles: ['ca'],
  active: true,
  first_name: 'David',
  last_name: 'Rice',
  email: 'davidr@blueprintcap.com',
  rows: 1,
  split: [],
} as never;

describe('fix-659 · 42 — People: one editor for a sign-in email', () => {
  it('★★★ with a login: the email is read-only and says it is the sign-in', () => {
    wrap(<PersonDetailsDialog person={RICE} onClose={() => {}} />);
    const box = screen.getByTestId('person-details-email') as HTMLInputElement;
    expect(box.readOnly).toBe(true);
    expect(box.disabled).toBe(true);
    expect(screen.getByTestId('person-details-dialog').textContent).toContain(
      'This is their sign-in email.',
    );
    expect(screen.getByTestId('person-details-change-signin')).toBeTruthy();
  });

  it('★★★ Save never sends a changed sign-in email', () => {
    wrap(<PersonDetailsDialog person={RICE} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId('person-details-first'), {
      target: { value: 'Dave' },
    });
    fireEvent.submit(screen.getByTestId('person-details-form'));
    expect(st.save.mock.calls[0]![0]).toMatchObject({
      name: 'Rice',
      first_name: 'Dave',
      email: 'davidr@blueprintcap.com',
    });
  });

  it('★★★ Change sign-in email: type, confirm in plain words, then the function', () => {
    wrap(<PersonDetailsDialog person={RICE} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('person-details-change-signin'));
    fireEvent.change(screen.getByTestId('person-details-change-signin-input'), {
      target: { value: 'David.Rice@BlueprintCap.com' },
    });
    fireEvent.click(screen.getByTestId('person-details-change-signin-next'));
    expect(screen.getByTestId('person-details-change-signin-confirm').textContent).toContain(
      'Rice will sign in with david.rice@blueprintcap.com from now on.',
    );
    // nothing has been sent yet
    expect(st.change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('person-details-change-signin-confirm-btn'));
    expect(st.change.mock.calls[0]![0]).toEqual({
      name: 'Rice',
      new_email: 'david.rice@blueprintcap.com',
    });
    // and the outer Save did not fire
    expect(st.save).not.toHaveBeenCalled();
  });

  it('★★ the action is admin-only', () => {
    st.isAdmin = false;
    wrap(<PersonDetailsDialog person={RICE} onClose={() => {}} />);
    expect(screen.queryByTestId('person-details-change-signin')).toBeNull();
  });

  it('★★★ WITHOUT a login: a plain editable email, saved as before', () => {
    st.hasLogin = false;
    wrap(<PersonDetailsDialog person={RICE} onClose={() => {}} />);
    const box = screen.getByTestId('person-details-email') as HTMLInputElement;
    expect(box.readOnly).toBe(false);
    expect(screen.queryByTestId('person-details-change-signin')).toBeNull();
    fireEvent.change(box, { target: { value: 'new@example.com' } });
    fireEvent.submit(screen.getByTestId('person-details-form'));
    expect(st.save.mock.calls[0]![0]).toMatchObject({ email: 'new@example.com' });
  });

  it('★★ while the answer loads, the safe side: read-only', () => {
    st.hasLogin = undefined;
    wrap(<PersonDetailsDialog person={RICE} onClose={() => {}} />);
    expect((screen.getByTestId('person-details-email') as HTMLInputElement).readOnly).toBe(true);
  });

  it('★★★ the server refuses the change in bp_set_person_details too', () => {
    expect(MIGRATION).toMatch(/if public\.bp_roster_name_has_login\(v_name\)/);
    expect(MIGRATION).toMatch(/Use "Change sign-in email" to change it\./);
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\.bp_roster_name_has_login\(text\) FROM PUBLIC, anon;/,
    );
  });
});

// ---------------------------------------------------------------------------
// The Edge Function's decisions, with fakes
// ---------------------------------------------------------------------------
type Deps = Parameters<typeof handler.changeSignInEmail>[0];

function fakes(over: Partial<Deps> = {}) {
  const calls: string[] = [];
  const auth = new Map<string, string>([['u-rice', 'davidr@blueprintcap.com']]);
  const deps: Deps = {
    callerId: async () => 'u-admin',
    callerTenantId: async () => 't1',
    membershipRole: async (uid) => (uid === 'u-admin' ? 'admin' : 'editor'),
    rosterEmailsForName: async (name) => (name === 'Rice' ? ['DavidR@blueprintcap.com'] : []),
    rosterNamesForEmail: async (email) => (email === 'taken@blueprintcap.com' ? ['Miles'] : []),
    loginByEmail: async (email) => {
      for (const [id, e] of auth) if (e.toLowerCase() === email.toLowerCase()) return { id, email: e };
      return null;
    },
    setAuthEmail: async (id, email) => {
      calls.push(`auth:${email}`);
      auth.set(id, email);
      return {};
    },
    setProfileEmail: async (_id, email) => {
      calls.push(`profile:${email}`);
    },
    setRosterEmail: async (_n, _t, email) => {
      calls.push(`roster:${email}`);
      return 1;
    },
    ...over,
  };
  return { deps, calls, auth };
}

describe('fix-659 · 42 — admin-change-sign-in-email handler', () => {
  it('★★★ moves auth, profile and roster together', async () => {
    const { deps, calls } = fakes();
    const r = await handler.changeSignInEmail(deps, 'jwt', {
      name: 'Rice',
      new_email: ' David.Rice@blueprintcap.com ',
    });
    expect(r).toMatchObject({ ok: true, new_email: 'david.rice@blueprintcap.com', roster_rows: 1 });
    expect(calls).toEqual([
      'auth:david.rice@blueprintcap.com',
      'profile:david.rice@blueprintcap.com',
      'roster:david.rice@blueprintcap.com',
    ]);
  });

  it('★★★ a roster failure puts the login back (no half-change)', async () => {
    const { deps, calls, auth } = fakes({
      setRosterEmail: async () => {
        throw new Error('boom');
      },
    });
    const r = await handler.changeSignInEmail(deps, 'jwt', {
      name: 'Rice',
      new_email: 'david.rice@blueprintcap.com',
    });
    expect(r).toMatchObject({ ok: false, code: 'roster_failed' });
    expect(auth.get('u-rice')).toBe('davidr@blueprintcap.com');
    expect(calls.at(-2)).toBe('auth:davidr@blueprintcap.com');
  });

  it('★★★ not an admin → refused, nothing written', async () => {
    const { deps, calls } = fakes({ membershipRole: async () => 'editor' });
    const r = await handler.changeSignInEmail(deps, 'jwt', { name: 'Rice', new_email: 'a@b.co' });
    expect(r).toMatchObject({ ok: false, code: 'not_admin' });
    expect(handler.ERROR_STATUS.not_admin).toBe(403);
    expect(calls).toEqual([]);
  });

  it('★★ a login outside the caller’s organization is not touched', async () => {
    const { deps, calls } = fakes({
      membershipRole: async (uid) => (uid === 'u-admin' ? 'admin' : null),
    });
    expect(
      await handler.changeSignInEmail(deps, 'jwt', { name: 'Rice', new_email: 'a@b.co' }),
    ).toMatchObject({ ok: false, code: 'no_login' });
    expect(calls).toEqual([]);
  });

  it('★★ no token → unauthenticated', async () => {
    const { deps } = fakes();
    expect(await handler.changeSignInEmail(deps, null, null)).toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('★★ a person with no login is sent back to the plain field', async () => {
    const { deps } = fakes({ rosterEmailsForName: async () => ['nobody@example.com'] });
    expect(
      await handler.changeSignInEmail(deps, 'jwt', { name: 'Alex', new_email: 'a@b.co' }),
    ).toMatchObject({ ok: false, code: 'no_login' });
  });

  it('★★ an address already in use is refused before anything writes', async () => {
    const { deps, calls } = fakes();
    expect(
      await handler.changeSignInEmail(deps, 'jwt', {
        name: 'Rice',
        new_email: 'taken@blueprintcap.com',
      }),
    ).toMatchObject({ ok: false, code: 'email_taken' });
    expect(calls).toEqual([]);
  });

  it('★ a bad address and an unknown name are refused', async () => {
    const { deps } = fakes();
    expect(
      await handler.changeSignInEmail(deps, 'jwt', { name: 'Rice', new_email: 'nope' }),
    ).toMatchObject({ code: 'invalid' });
    expect(
      await handler.changeSignInEmail(deps, 'jwt', { name: 'Ghost', new_email: 'a@b.co' }),
    ).toMatchObject({ code: 'not_found' });
  });

  it('★ the same address (any case) is a no-op, not a write', async () => {
    const { deps, calls } = fakes();
    const r = await handler.changeSignInEmail(deps, 'jwt', {
      name: 'Rice',
      new_email: 'DAVIDR@blueprintcap.com',
    });
    expect(r).toMatchObject({ ok: true, unchanged: true });
    expect(calls).toEqual([]);
  });

  it('★★★ handler.ts has no way to reach a key; index.ts keeps verify_jwt notes', () => {
    const fn = join(process.cwd(), 'supabase/functions/admin-change-sign-in-email');
    const h = readFileSync(join(fn, 'handler.ts'), 'utf8').replace(/\/\/.*$/gm, '');
    expect(h).not.toMatch(/Deno|SERVICE_ROLE|fetch\(|createClient/);
    const idx = readFileSync(join(fn, 'index.ts'), 'utf8');
    expect(idx).toMatch(/updateUserById\(userId, \{\s*email,\s*email_confirm: true,/);
  });
});
