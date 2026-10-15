// ===========================================================================
// fix-670 §C (P-351) — the welcome email
// ===========================================================================
//
// Bobby: *"its a nice welcoming, a link to the bridge, and maybe some high
// level info and guiding to how to navigate etc."* — and on the draft: *"in v1,
// we want them to see things that viewers/others can see not admins - so
// reports category that is hidden for most people, should not be visible to
// them yet."*
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import {
  ACCESS_LINE,
  BRIDGE_APP_ORIGIN,
  WELCOME_AREA_COPY,
  WELCOME_CODE_VALID_HOURS,
  codeLifetimeWords,
  renderWelcomeEmail,
  welcomeSignInUrl,
} from '../../supabase/functions/admin-create-user/welcome';
import {
  createPerson,
  resendWelcome,
  type AddPersonRequest,
  type Deps,
} from '../../supabase/functions/admin-create-user/handler';
import {
  WELCOME_AREAS,
  visibleRibbonPaths,
  welcomeAreas,
  type WelcomeArea,
} from '../lib/welcomeAreas';
import { RIBBON_ENTRIES } from '../lib/ribbonNav';
import { welcomeEmailFromHash, WELCOME_CODE_NOTICE } from '../lib/welcomeLink';
import loginErrorsSrc from '../lib/loginErrors.ts?raw';

// ---------------------------------------------------------------------------
// Mocks for the two rendered surfaces (the dialog and Login)
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  logError: vi.fn(),
}));
vi.mock('../lib/supabase', () => ({
  supabase: {
    functions: { invoke: mocks.invoke },
    from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }),
    auth: {
      signInWithPassword: async () => ({ data: {}, error: null }),
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
    },
  },
  supabaseUrl: 'http://test.local',
}));
vi.mock('../lib/errorLogger', async (orig) => ({
  ...(await orig<typeof import('../lib/errorLogger')>()),
  logError: mocks.logError,
}));

import { useAuthStore } from '../stores/authStore';
import AddPersonSection from '../components/Settings/AddPersonSection';

// ---------------------------------------------------------------------------
// The email itself
// ---------------------------------------------------------------------------
const VIEWER = renderWelcomeEmail({
  audience: 'viewer',
  firstName: 'Greg',
  adderFirstName: 'Bobby',
  plate: 'Greg · Underwriting',
  email: 'greg@blueprintcap.com',
  code: '482913',
  areas: welcomeAreas('viewer', false),
});
const EDITOR = renderWelcomeEmail({
  audience: 'works',
  firstName: 'Sam',
  adderFirstName: 'Bobby',
  plate: 'Sam · Design Associate · Design & Permitting',
  email: 'sam@blueprintcap.com',
  code: '104729',
  areas: welcomeAreas('da', false),
});

/** The "Where to look first" labels, in order, from the HTML. */
function areaLabels(html: string): string[] {
  const table = html.slice(html.indexOf('data-welcome="areas"'));
  const body = table.slice(0, table.indexOf('</table>'));
  return [...body.matchAll(/<strong>([^<]+)<\/strong>/g)].map((m) => m[1]!);
}

describe('fix-670 §C — the email, for a viewer and for an editor', () => {
  it('★★★ subject, greeting, adder and plate — the approved words', () => {
    expect(VIEWER.subject).toBe('Welcome to the Bridge, Greg');
    expect(VIEWER.html).toContain('Welcome to the Bridge, Greg.');
    expect(VIEWER.text).toContain(
      "Bobby has set you up on the Bridge — Blueprint's home for every project we're designing and permitting, from the first drawing to the issued permit.",
    );
    expect(VIEWER.html).toContain('Greg · Underwriting');
    expect(EDITOR.html).toContain('Sam · Design Associate · Design &amp; Permitting');
    expect(VIEWER.text).toContain("Questions about the Bridge? Ask Bobby, or ask in any project's chat.");
    expect(VIEWER.text).toContain("New here? Open What's New in the left menu.");
  });

  it('★★★ the viewer list: no Reports, no My Board — snapshot', () => {
    expect(areaLabels(VIEWER.html)).toEqual(['Projects', 'Draw Schedule', 'Library', 'Chat']);
    expect(VIEWER.html).not.toContain('Reports');
  });

  it('★★★ the works-in-the-Bridge list starts at My Board — snapshot', () => {
    expect(areaLabels(EDITOR.html)).toEqual([
      'My Board',
      'Projects',
      'Draw Schedule',
      'Library',
      'Chat',
    ]);
    expect(EDITOR.html).not.toContain('Reports');
  });

  it('★★ each version uses its own approved descriptions', () => {
    expect(VIEWER.text).toContain(`Draw Schedule — ${WELCOME_AREA_COPY.draw_schedule.viewer}`);
    expect(EDITOR.text).toContain(`Draw Schedule — ${WELCOME_AREA_COPY.draw_schedule.works}`);
    expect(EDITOR.text).toContain("you'll see your mentions on My Board");
  });

  it('★★★ the access line is what is TRUE: a viewer can reply, not post', () => {
    // project_messages insert policy: parent_message_id IS NOT NULL OR admin.
    expect(ACCESS_LINE.viewer).toBe(
      'View access — you can see every project and reply in project chats. The project team makes the edits.',
    );
    expect(ACCESS_LINE.works).toBe(
      'Editor access — you can update the projects and tasks you work on.',
    );
    expect(VIEWER.text).toContain(ACCESS_LINE.viewer);
    expect(EDITOR.text).toContain(ACCESS_LINE.works);
  });

  // ★ fix-678 moved the value to 24 h (Supabase set to 86400 s on 10-15) and
  //   made the Login page read the same constant — see AnyCodeLengthFix678.
  it('★★★ the expiry sentence states the configured value', () => {
    expect(WELCOME_CODE_VALID_HOURS).toBe(24);
    expect(codeLifetimeWords()).toBe('24 hours');
    expect(VIEWER.text).toContain(
      "You'll sign in with greg@blueprintcap.com. The code works for 24 hours. If it has expired, open the sign-in page and choose Send a new code.",
    );
    expect(VIEWER.html + VIEWER.text).not.toMatch(/Forgot password/);
    // ★ and it agrees with what the Login page tells people
    expect(loginErrorsSrc).toContain('codes are good for');
    expect(loginErrorsSrc).toContain('codeLifetimeWords()');
  });

  it('★★ the code and the button are both in it; the button opens the code step', () => {
    expect(VIEWER.html).toContain('data-welcome="code">482913<');
    expect(VIEWER.text).toContain('482913');
    const url = welcomeSignInUrl('greg@blueprintcap.com');
    expect(url).toBe(`${BRIDGE_APP_ORIGIN}/login#welcome=greg%40blueprintcap.com`);
    expect(VIEWER.html).toContain(url);
    // twin: the Login page reads back exactly that address
    expect(welcomeEmailFromHash(new URL(url).hash)).toBe('greg@blueprintcap.com');
  });

  it('★ the plate is escaped, never trusted as HTML', () => {
    const e = renderWelcomeEmail({
      audience: 'viewer',
      firstName: 'X',
      adderFirstName: null,
      plate: '<script>x</script>',
      email: 'x@blueprintcap.com',
      code: '000000',
      areas: [],
    });
    expect(e.html).not.toContain('<script>');
    expect(e.text).toContain('Your Blueprint admin has set you up');
  });

  it('★ it wears the branded shell, with a plain-text part', () => {
    expect(VIEWER.inlineImages.length).toBe(2);
    expect(VIEWER.text.length).toBeGreaterThan(200);
  });
});

// ---------------------------------------------------------------------------
// Where to look first — derived from lib/ribbonNav
// ---------------------------------------------------------------------------
/** ★ THE TEST THE RED PROOF BREAKS: every area listed for a recipient is a
 *  ribbon destination that recipient can see. */
function assertEveryAreaVisible(
  role: Parameters<typeof welcomeAreas>[0],
  isAdmin: boolean,
  areas: readonly WelcomeArea[] = WELCOME_AREAS,
) {
  const listed = welcomeAreas(role, isAdmin, false, areas);
  const paths = visibleRibbonPaths(isAdmin);
  for (const key of listed) {
    const area = areas.find((a) => a.key === key)!;
    expect(paths.has(area.to), `${key} → ${area.to}`).toBe(true);
  }
  return listed;
}

describe('fix-670 §C — "Where to look first" shows only what they can open', () => {
  it('★★★ viewer: Projects, Draw Schedule, Library, Chat — each a ribbon entry they can see', () => {
    expect(assertEveryAreaVisible('viewer', false)).toEqual([
      'projects',
      'draw_schedule',
      'library',
      'chat',
    ]);
  });

  it('★★★ works in the Bridge: My Board first', () => {
    expect(assertEveryAreaVisible('da', false)).toEqual([
      'my_board',
      'projects',
      'draw_schedule',
      'library',
      'chat',
    ]);
  });

  it('★★★ Reports is not visible to a non-admin (only Project View sits under it)', () => {
    const paths = visibleRibbonPaths(false);
    expect(paths.has('/reports')).toBe(false);
    expect(welcomeAreas('da', false)).not.toContain('reports');
  });

  it('★★ the labels are the ribbon’s own words (twin — the function cannot import src/)', () => {
    const labelByPath = new Map<string, string>();
    for (const e of RIBBON_ENTRIES) if (e.kind === 'link') labelByPath.set(e.link.to, e.link.label);
    for (const a of WELCOME_AREAS) {
      if (a.key === 'chat') continue; // lives inside each project — no ribbon entry
      expect(WELCOME_AREA_COPY[a.key].label, a.key).toBe(labelByPath.get(a.to));
    }
  });
});

// ---------------------------------------------------------------------------
// The function: send, failure, resend
// ---------------------------------------------------------------------------
type Outbox = Parameters<Deps['recordOutbox']>[0];
function deps(over: Partial<Deps> = {}) {
  const outbox: Outbox[] = [];
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const created: Array<{ email: string; password: string }> = [];
  const deleted: string[] = [];
  const d: Deps = {
    callerId: async (jwt) => (jwt === 'good' ? 'caller-1' : null),
    membershipRole: async () => 'admin',
    callerTenantId: async () => 'tenant-1',
    createAuthUser: async (email, password) => {
      created.push({ email, password });
      return { id: 'user-new' };
    },
    deleteAuthUser: async (id) => {
      deleted.push(id);
    },
    findRosterRows: async () => [],
    updateRosterRow: async () => undefined,
    insertRosterRow: async () => 'roster-new',
    ensureMembership: async () => false,
    setProfileRole: async () => undefined,
    departmentExists: async (_t, key) => key !== 'gone',
    callerFirstName: async () => 'Bobby',
    randomPassword: () => 'RANDOM-nobody-sees-this',
    recoveryCode: async () => ({ code: '482913' }),
    sendWelcome: async (to, email) => {
      sent.push({ to, subject: email.subject, text: email.text });
      return { ok: true };
    },
    recordOutbox: async (row) => {
      outbox.push(row);
    },
    ...over,
  };
  return { d, outbox, sent, created, deleted };
}

const GREG: Partial<AddPersonRequest> = {
  email: 'greg@blueprintcap.com',
  first_name: 'Greg',
  last_name: 'Smith',
  name: 'Greg',
  role: 'viewer',
  notes: null,
  bridge_role: 'editor',
  department: 'underwriting',
  send_welcome: true,
  welcome: { plate: 'Greg · Underwriting', areas: ['projects', 'draw_schedule', 'library', 'chat'] },
};

describe('fix-670 §C — admin-create-user sends it', () => {
  it('★★★ ticked: no password asked for, a random one set, the email sent, the outbox written', async () => {
    const f = deps();
    const res = await createPerson(f.d, 'good', { ...GREG, password: '' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(f.created[0]!.password).toBe('RANDOM-nobody-sees-this');
    expect(res.welcome).toEqual({ sent: true });
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]!.subject).toBe('Welcome to the Bridge, Greg');
    expect(f.sent[0]!.text).toContain('Bobby has set you up');
    expect(f.outbox).toEqual([
      {
        kind: 'welcome',
        to_email: 'greg@blueprintcap.com',
        subject: 'Welcome to the Bridge, Greg',
        status: 'sent',
        error: null,
      },
    ]);
  });

  it('★★★ a failed send keeps the login and says why', async () => {
    const f = deps({ sendWelcome: async () => ({ ok: false, error: 'Graph said 503' }) });
    const res = await createPerson(f.d, 'good', GREG);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.welcome).toEqual({ sent: false, error: 'Graph said 503' });
    expect(f.deleted).toEqual([]);
    expect(f.outbox[0]).toMatchObject({ status: 'failed', error: 'Graph said 503' });
  });

  it('★★ no code means no email — reported, login kept', async () => {
    const f = deps({ recoveryCode: async () => ({ error: 'rate limited' }) });
    const res = await createPerson(f.d, 'good', GREG);
    expect(res.ok && res.welcome).toEqual({
      sent: false,
      error: 'Could not make a sign-in code — rate limited',
    });
    expect(f.sent).toEqual([]);
  });

  it('★★★ unticked: today’s flow — the password is required and used, no email', async () => {
    const f = deps();
    const bad = await createPerson(f.d, 'good', { ...GREG, send_welcome: false, password: 'short' });
    expect(bad.ok).toBe(false);
    const res = await createPerson(f.d, 'good', {
      ...GREG,
      send_welcome: false,
      password: 'Correct-Horse-9',
    });
    expect(res.ok && res.welcome).toBeNull();
    expect(f.created.at(-1)!.password).toBe('Correct-Horse-9');
    expect(f.sent).toEqual([]);
  });

  it('★★★ a viewer without a department is refused before any login exists', async () => {
    const f = deps();
    const res = await createPerson(f.d, 'good', { ...GREG, department: null });
    expect(res).toMatchObject({ ok: false, code: 'invalid', field: 'department' });
    expect(f.created).toEqual([]);
  });

  it('★★ a department no longer on the list is refused before any login exists', async () => {
    const f = deps();
    const res = await createPerson(f.d, 'good', { ...GREG, department: 'gone' });
    expect(res).toMatchObject({ ok: false, field: 'department' });
    expect(f.created).toEqual([]);
  });

  it('★★ resend: admin only, and only for an address on the caller’s roster', async () => {
    const editor = deps({ membershipRole: async () => 'editor' });
    expect(
      await resendWelcome(editor.d, 'good', { ...GREG, action: 'resend_welcome' } as never),
    ).toMatchObject({ ok: false, code: 'not_admin' });

    const stranger = deps();
    expect(
      await resendWelcome(stranger.d, 'good', { ...GREG, action: 'resend_welcome' } as never),
    ).toMatchObject({ ok: false, field: 'email' });
    expect(stranger.sent).toEqual([]);

    const ok = deps({
      findRosterRows: async () => [
        { id: 'r1', name: 'Greg', role: 'viewer', email: 'greg@blueprintcap.com', active: true, former: false },
      ],
    });
    const res = await resendWelcome(ok.d, 'good', { ...GREG, action: 'resend_welcome' } as never);
    expect(res).toEqual({ ok: true, welcome: { sent: true } });
    expect(ok.sent).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The dialog: ticked by default, failure shows Resend and reaches triage
// ---------------------------------------------------------------------------
function wrap(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const SUCCESS_BASE = {
  ok: true,
  user_id: 'user-new',
  email: 'greg@blueprintcap.com',
  roster: { action: 'inserted', id: 'r1', name: 'Greg', role: 'viewer', was_retired: false },
  profile: { role: 'editor', created_by: 'trigger' },
  membership: { role: 'editor', source: 'trigger' },
};

describe('fix-670 §C — the dialog', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.logError.mockReset();
    useAuthStore.setState({
      user: { id: 'u-bobby', email: 'robertd@blueprintcap.com' } as never,
      activeTenantId: 'tenant-1',
      memberships: [{ tenant_id: 'tenant-1', role: 'admin' }],
    });
  });

  function fillGreg() {
    wrap(<AddPersonSection readOnly={false} />);
    fireEvent.click(screen.getByTestId('add-person-open'));
    const set = (id: string, value: string) =>
      fireEvent.change(screen.getByTestId(id), { target: { value } });
    set('add-person-email', 'greg@blueprintcap.com');
    set('add-person-first', 'Greg');
    set('add-person-last', 'Smith');
    set('add-person-role', 'viewer');
    set('add-person-department', 'underwriting');
  }

  it('★★★ ticked by default: no password field, and the body asks for the email', async () => {
    mocks.invoke.mockResolvedValue({ data: { ...SUCCESS_BASE, welcome: { sent: true } }, error: null });
    fillGreg();
    expect((screen.getByTestId('add-person-send-welcome') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByTestId('add-person-password')).toBeNull();
    fireEvent.click(screen.getByTestId('add-person-submit'));
    await waitFor(() => expect(screen.getByTestId('add-person-welcome-sent')).toBeInTheDocument());
    const [, opts] = mocks.invoke.mock.calls[0]!;
    expect(opts.body).toMatchObject({
      send_welcome: true,
      department: 'underwriting',
      welcome: {
        plate: 'Greg · Underwriting',
        areas: ['projects', 'draw_schedule', 'library', 'chat'],
      },
    });
    expect(screen.queryByTestId('add-person-password-readout')).toBeNull();
  });

  it('★★ unticked: the old hint is gone and the new one says the choice', () => {
    fillGreg();
    fireEvent.click(screen.getByTestId('add-person-send-welcome'));
    expect(screen.getByTestId('add-person-password')).toBeInTheDocument();
    expect(screen.getByTestId('add-person-form').textContent).toContain(
      'Shown once. Hand it to them yourself, or tick Send welcome email instead.',
    );
    expect(screen.getByTestId('add-person-form').textContent).not.toContain(
      'the Bridge cannot email it yet',
    );
  });

  it('★★★ a failed send: "Login created — …", Resend, and Error Triage', async () => {
    mocks.invoke
      .mockResolvedValueOnce({
        data: { ...SUCCESS_BASE, welcome: { sent: false, error: 'Graph said 503' } },
        error: null,
      })
      .mockResolvedValueOnce({ data: { ok: true, welcome: { sent: true } }, error: null });
    fillGreg();
    fireEvent.click(screen.getByTestId('add-person-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('add-person-welcome-failed').textContent).toContain(
        "Login created — the welcome email didn't send (Graph said 503).",
      ),
    );
    expect(mocks.logError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Welcome email did not send — Graph said 503',
        context: expect.objectContaining({ write: 'admin-create-user' }),
      }),
    );
    fireEvent.click(screen.getByTestId('add-person-welcome-resend'));
    await waitFor(() => expect(screen.getByTestId('add-person-welcome-sent')).toBeInTheDocument());
    const [, opts] = mocks.invoke.mock.calls[1]!;
    expect(opts.body).toMatchObject({
      action: 'resend_welcome',
      email: 'greg@blueprintcap.com',
      first_name: 'Greg',
      role: 'viewer',
    });
  });
});

// ---------------------------------------------------------------------------
// The landing: /login#welcome=<email>
// ---------------------------------------------------------------------------
describe('fix-670 §C — the button lands on the code step', () => {
  it('★ reads only a well-formed address', () => {
    expect(welcomeEmailFromHash('#welcome=greg%40blueprintcap.com')).toBe('greg@blueprintcap.com');
    expect(welcomeEmailFromHash('#welcome=nope')).toBeNull();
    expect(welcomeEmailFromHash('')).toBeNull();
  });

  it('★★★ the Login page opens at the code step with the address filled in', async () => {
    window.location.hash = '#welcome=greg%40blueprintcap.com';
    const { default: Login } = await import('../pages/Login');
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );
    expect(screen.getByText(WELCOME_CODE_NOTICE)).toBeInTheDocument();
    expect(screen.getByText('Code from the email')).toBeInTheDocument();
    window.location.hash = '';
  });
});
