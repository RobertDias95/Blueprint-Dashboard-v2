import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import migrationSql from '../../migrations/fix_339_post_requests.sql?raw';
import {
  acknowledgeableItems,
  buildNewItems,
  keyForPostRequest,
  keyForPostRequestOutcome,
  unseenCount,
  unseenItems,
  type PostRequestItemInput,
} from '../lib/boardReads';

// fix-339 — "request a post", and the first SHARED board item.
//
// ★★★ THE HARD PART, and what these tests are mostly about: everything on the
// board before this was PER-PERSON (fix-307's board_item_reads). A post request
// lands with several people and clears from ALL of their queues the moment any
// one of them acts — Bobby: "once it is created/read/satisfied, as a
// notification, it gets removed from all queues."
//
// ★ The database half (recipient resolution, first-responder-wins, the
// unreachable recipient) is proved on PROD with a rolled-back multi-identity
// probe, recorded in the PR and the migration. CI has no database, so what is
// asserted here is the DERIVATION — which is where the shared/personal
// distinction actually lives — plus the policy text that cannot run in jsdom.

const ME = 'me-uuid';
const PROJ = 'p-1';

function request(over: Partial<PostRequestItemInput> = {}): PostRequestItemInput {
  return {
    id: 'req-1',
    project_id: PROJ,
    project_address: '3921 43rd Ave S',
    title: 'Corrections round 2',
    reason: 'City came back and it needs its own thread',
    status: 'open',
    requester_name: 'Trevor',
    resolver_name: null,
    created_post_id: null,
    created_at: '2026-08-18T10:00:00Z',
    resolved_at: null,
    is_recipient: true,
    ...over,
  };
}

const BASE = {
  flips: [],
  tasks: [],
  acks: [],
  permits: [],
  projects: [],
  viewerName: 'Gena',
  viewerUserId: ME,
};

// ===========================================================================
// ★★★ The shared item
// ===========================================================================

describe('fix-339: a post request is a SHARED board item', () => {
  it('a recipient sees an open request as a new item', () => {
    const items = buildNewItems({ ...BASE, postRequests: [request()] });
    expect(items).toHaveLength(1);
    expect(items[0]!.source).toBe('post_request');
    expect(items[0]!.title).toContain('Corrections round 2');
    expect(items[0]!.subtitle).toContain('Trevor');
    expect(items[0]!.subtitle).toContain('City came back');
    expect(items[0]!.where).toBe('3921 43rd Ave S');
  });

  // ★★ THE WHOLE POINT. A shared item has NO read rows, so it cannot be
  // "already read" for one person and not another — it is present while the
  // request is open and absent the instant it is not.
  it('★★ is NOT filtered by per-user read state', () => {
    const items = buildNewItems({ ...BASE, postRequests: [request()] });
    const key = keyForPostRequest('req-1');
    expect(items[0]!.key).toBe(key);
    expect(items[0]!.audience).toBe('shared');
    // Even with a read row against its key — which nothing writes — it stays.
    expect(unseenItems(items, new Set([key]))).toHaveLength(1);
    expect(unseenCount(items, new Set([key]))).toBe(1);
  });

  // ★★★ THE CORE CONTRACT: two recipients, one acts, it leaves BOTH queues.
  // Modelled the way it actually works — one row, one status, both views
  // derived from it — rather than by writing two read rows.
  it('★★★ two recipients; one acts; it disappears from BOTH queues', () => {
    const open = request();
    const gena = buildNewItems({ ...BASE, viewerName: 'Gena', viewerUserId: 'gena', postRequests: [open] });
    const bobby = buildNewItems({ ...BASE, viewerName: 'Bobby', viewerUserId: 'bobby', postRequests: [open] });
    expect(unseenCount(gena, new Set())).toBe(1);
    expect(unseenCount(bobby, new Set())).toBe(1);

    // Gena acknowledges. The ROW changes — there is nothing per-person to change.
    const resolved = { ...open, status: 'acknowledged' as const, resolved_at: '2026-08-18T11:00:00Z', resolver_name: 'Gena' };

    // Both recipients now derive nothing from it.
    const genaAfter = buildNewItems({ ...BASE, viewerName: 'Gena', viewerUserId: 'gena', postRequests: [resolved] });
    const bobbyAfter = buildNewItems({ ...BASE, viewerName: 'Bobby', viewerUserId: 'bobby', postRequests: [resolved] });
    expect(unseenCount(genaAfter, new Set())).toBe(0);
    expect(unseenCount(bobbyAfter, new Set())).toBe(0);
  });

  it('declining clears it from every queue too', () => {
    const declined = request({ status: 'declined', resolved_at: '2026-08-18T11:00:00Z' });
    const items = buildNewItems({ ...BASE, postRequests: [declined] });
    expect(items.filter((i) => i.source === 'post_request')).toHaveLength(0);
  });

  // ★ Marking a shared item "read" would write a row nothing reads and leave it
  // on screen — a control that lies. So it is excluded from "mark all read".
  it('★ "mark all read" does not pretend to clear a shared item', () => {
    const items = buildNewItems({
      ...BASE,
      postRequests: [request()],
      tasks: [
        {
          id: 't-1',
          assigned_to: 'Gena',
          co_assignees: [],
          text: 'A task',
          created_at: '2026-08-18T09:00:00Z',
          permit_id: 1,
          project_id: PROJ,
          project_address: 'x',
          permit_type: 'Building Permit',
        },
      ],
    } as never);
    expect(items).toHaveLength(2);
    const ack = acknowledgeableItems(items);
    expect(ack).toHaveLength(1);
    expect(ack[0]!.source).toBe('task');
  });
});

// ===========================================================================
// ★ The personal outcome, and how the two models coexist
// ===========================================================================

describe('fix-339: the requester learns the outcome — personally', () => {
  // ★ A request that vanishes silently teaches people not to bother asking.
  it('★ the requester gets a personal notice once it is resolved', () => {
    const mine = request({
      is_recipient: false,
      status: 'created',
      resolved_at: '2026-08-18T11:00:00Z',
      resolver_name: 'Gena',
      created_post_id: 'post-9',
    });
    const items = buildNewItems({ ...BASE, viewerName: 'Trevor', postRequests: [mine] });
    expect(items).toHaveLength(1);
    expect(items[0]!.source).toBe('post_request_outcome');
    expect(items[0]!.title).toContain('Your post was created');
    expect(items[0]!.subtitle).toBe('by Gena');
  });

  it('names the outcome it actually got', () => {
    const at = '2026-08-18T11:00:00Z';
    const of = (status: 'created' | 'declined' | 'acknowledged') =>
      buildNewItems({
        ...BASE,
        viewerName: 'Trevor',
        postRequests: [request({ is_recipient: false, status, resolved_at: at })],
      })[0]!.title;
    expect(of('created')).toContain('created');
    expect(of('declined')).toContain('declined');
    expect(of('acknowledged')).toContain('acknowledged');
  });

  // ★★ AND IT IS PERSONAL, so it acknowledges the ordinary fix-307 way. The two
  // models in one list is the clearest statement of how they differ.
  it('★★ the outcome IS acknowledgeable, unlike the shared ask', () => {
    const mine = request({ is_recipient: false, status: 'created', resolved_at: '2026-08-18T11:00:00Z' });
    const items = buildNewItems({ ...BASE, viewerName: 'Trevor', postRequests: [mine] });
    expect(items[0]!.audience).toBe('personal');
    const key = keyForPostRequestOutcome('req-1');
    expect(items[0]!.key).toBe(key);
    expect(unseenCount(items, new Set([key]))).toBe(0);
    expect(acknowledgeableItems(items)).toHaveLength(1);
  });

  it('an open request produces no outcome notice for its requester', () => {
    const items = buildNewItems({
      ...BASE,
      viewerName: 'Trevor',
      postRequests: [request({ is_recipient: false, status: 'open' })],
    });
    expect(items).toHaveLength(0);
  });

  // ★ The bell and the board call the same builder with the same input, so an
  // open request cannot be news in one and not the other.
  it('★ the badge and the board agree about an open request', () => {
    const items = buildNewItems({ ...BASE, postRequests: [request()] });
    // The bell's number and the board's list are both this function.
    expect(unseenCount(items, new Set())).toBe(1);
    expect(unseenItems(items, new Set()).map((i) => i.key)).toEqual([
      keyForPostRequest('req-1'),
    ]);
  });
});

// ===========================================================================
// ★ The database contracts CI cannot run
// ===========================================================================

/** The SQL with `--` comments removed. The migration's prose NAMES
 *  board_item_reads in order to explain what this table deliberately is not, and
 *  a guard that trips on the explanation of the thing it guards is a guard
 *  nobody keeps. Same trick fix-300b's ratchet and fix-338 use. */
function executableSql(src: string): string {
  return src
    .split(String.fromCharCode(10))
    .map((line) => {
      const i = line.indexOf('--');
      return i === -1 ? line : line.slice(0, i);
    })
    .join(String.fromCharCode(10));
}

describe('fix-339: the policies that make it shared', () => {
  // ★★ FIRST-RESPONDER-WINS IS THE POLICY'S, not the client's. `status = open`
  // in USING means a second resolver affects zero rows.
  it('★★ the UPDATE policy refuses an already-resolved request', () => {
    expect(migrationSql).toMatch(
      /CREATE POLICY post_requests_recipient_resolve[\s\S]*?USING \([\s\S]*?status = 'open'/,
    );
  });

  it('★ only a recipient (or an admin) may resolve one', () => {
    expect(migrationSql).toMatch(
      /auth\.uid\(\) = ANY \(recipients\)\s*OR public\.is_tenant_admin\(tenant_id\)/,
    );
  });

  // ★ ANYONE may ask — that is the whole point of the escape hatch.
  it('★ anyone may raise a request, and it starts open', () => {
    expect(migrationSql).toMatch(
      /CREATE POLICY post_requests_tenant_insert[\s\S]*?WITH CHECK \([\s\S]*?status = 'open'/,
    );
    // ...and nothing here grants non-admins the right to create a POST.
    expect(migrationSql).not.toMatch(/project_messages_tenant_insert/);
  });

  // ★ fix-334's column-grant pattern: RLS picks rows, the grant picks fields.
  it('★ a resolver cannot rewrite the title, reason or recipients', () => {
    expect(migrationSql).toMatch(
      /GRANT UPDATE \(status, resolved_by, resolved_at, resolution_note, created_post_id\)/,
    );
    expect(migrationSql).toMatch(
      /REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public\.post_requests FROM authenticated;/,
    );
  });

  // ★★ THE RECIPIENTS: oversight + the project's ent lead, the latter resolved
  // through team_members.name because ent_lead is a NAME, not an id.
  it('★★ recipients are the oversight holders plus the ent lead', () => {
    expect(migrationSql).toMatch(/tm\.is_oversight IS TRUE/);
    expect(migrationSql).toMatch(
      /NULLIF\(btrim\(tm\.name\), ''\) = NULLIF\(btrim\(pe\.ent_lead\), ''\)/,
    );
  });

  it('★ the requester is not a recipient of their own request', () => {
    expect(migrationSql).toMatch(/m\.user_id <> v_me/);
  });

  // ★★ DAVE. Oversight, no email on his roster row, so his login cannot be
  // matched — he is KEPT BY NAME rather than silently dropped, and the request
  // still works for everyone else. The roster is NOT modified here.
  it('★★ a recipient who cannot be resolved is kept by name, not dropped', () => {
    expect(migrationSql).toMatch(
      /array_agg\(DISTINCT m\.name\) FILTER \(WHERE m\.user_id IS NULL\)/,
    );
    expect(migrationSql).toMatch(/unresolved_recipients/);
    // ...and nothing writes to team_members.
    expect(migrationSql).not.toMatch(/UPDATE public\.team_members/);
    expect(migrationSql).not.toMatch(/INSERT INTO public\.team_members/);
  });

  // ★ No per-recipient read rows anywhere — the thing the brief forbids.
  // ★★ THE THING THE BRIEF FORBIDS, and the heart of the design: no read row
  // per recipient anywhere. The item's existence IS its unread state.
  it('★ nothing writes a read row per recipient', () => {
    expect(executableSql(migrationSql)).not.toMatch(/board_item_reads/);
    // ...and the table carries no per-user column that could become one.
    expect(executableSql(migrationSql)).not.toMatch(/read_by|seen_by|dismissed_by/);
  });

  it('a request is never hard-deleted — the requester is owed the outcome', () => {
    expect(migrationSql).not.toMatch(/FOR DELETE/);
    expect(migrationSql).not.toMatch(/DELETE FROM public\.post_requests/);
  });

  it('★ still one realtime channel', async () => {
    expect(migrationSql).toMatch(
      /ALTER PUBLICATION supabase_realtime ADD TABLE public\.post_requests/,
    );
    const realtime = (await import('../hooks/useRealtimeInvalidation.ts?raw'))
      .default as string;
    expect(realtime.match(/supabase\.channel\(/g) ?? []).toHaveLength(1);
  });
});

// ===========================================================================
// The chat surface
// ===========================================================================

const mocks = vi.hoisted(() => ({
  isAdmin: false,
  projectRequests: [] as Record<string, unknown>[],
  requested: [] as Record<string, unknown>[],
  resolved: [] as Record<string, unknown>[],
  posted: [] as Record<string, unknown>[],
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      user: { id: ME, email: 'x@x.com' },
      activeTenantId: 't1',
      memberships: [{ tenant_id: 't1', role: 'admin' }],
      initialized: true,
      session: null,
    }),
}));
vi.mock('../hooks/useIsTenantAdmin', () => ({
  useIsTenantAdmin: () => mocks.isAdmin,
}));
// ★ fix-354: the EIGHTH board source, mocked here for the same reason
// fix-339 mocked the seventh — these suites deliberately render without a
// QueryClient, and an unmocked query would reach for one.
vi.mock('../hooks/useAutoClosures', () => ({
  useAutoClosures: () => ({ data: [], isLoading: false, error: null }),
}));
// ★ fix-360 mocks the ninth, for the same reason: this suite renders without a
// QueryClient and an unmocked query would reach for one.
vi.mock('../hooks/useMyPostReactions', () => ({
  useMyPostReactions: () => ({ data: [], isLoading: false, error: null }),
}));
vi.mock('../hooks/usePostRequests', async (orig) => {
  const actual = await orig<typeof import('../hooks/usePostRequests')>();
  return {
    ...actual,
    useMyPostRequests: () => ({ data: [], isLoading: false, error: null }),
    useProjectPostRequests: () => ({
      data: mocks.projectRequests,
      isLoading: false,
      error: null,
    }),
    useRequestPost: () => ({
      mutate: (input: Record<string, unknown>, opts?: { onSuccess?: () => void }) => {
        mocks.requested.push(input);
        opts?.onSuccess?.();
      },
      isPending: false,
    }),
    useResolvePostRequest: () => ({
      mutate: (input: Record<string, unknown>) => {
        mocks.resolved.push(input);
      },
      isPending: false,
    }),
  };
});
vi.mock('../hooks/useProjectMessages', async (orig) => {
  const actual = await orig<typeof import('../hooks/useProjectMessages')>();
  return {
    ...actual,
    useProjectMessages: () => ({ data: [], isLoading: false, error: null }),
    useMentionablePeople: () => ({ data: [], isLoading: false, error: null }),
    useMyMentions: () => ({ data: [], isLoading: false, error: null }),
    usePostMessage: () => ({
      mutate: (
        input: Record<string, unknown>,
        opts?: { onSuccess?: (id: string) => void },
      ) => {
        mocks.posted.push(input);
        opts?.onSuccess?.('new-post-id');
      },
      isPending: false,
    }),
  };
});
vi.mock('../hooks/useBoardReads', () => ({
  useBoardReads: () => ({ data: [], isLoading: false, error: null }),
  useMarkBoardItemsRead: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useTeamMembers', async (orig) => {
  const actual = await orig<typeof import('../hooks/useTeamMembers')>();
  return {
    ...actual,
    useTeamMembers: () => ({ all: [], isLoading: false, error: null, refetch: vi.fn() }),
  };
});
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useDmDaGroups', () => ({ useDmDaGroups: () => ({ rows: [] }) }));

import ProjectChatModal from '../components/ProjectDetail/ProjectChatModal';

function renderModal() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <ProjectChatModal projectId={PROJ} permits={[]} onClose={vi.fn()} />,
    { wrapper },
  );
}

beforeEach(() => {
  mocks.isAdmin = false;
  mocks.projectRequests = [];
  mocks.requested = [];
  mocks.resolved = [];
  mocks.posted = [];
});

describe('fix-339: asking, from the chat', () => {
  // ★ A non-admin sees the ask where an admin sees the create.
  it('★ a non-admin sees "Request a post", not "New post"', () => {
    renderModal();
    expect(screen.getByTestId('project-chat-request-post')).toBeInTheDocument();
    expect(screen.queryByTestId('project-chat-new-post')).toBeNull();
  });

  it('★ an admin still sees "New post" and no ask', () => {
    mocks.isAdmin = true;
    renderModal();
    expect(screen.getByTestId('project-chat-new-post')).toBeInTheDocument();
    expect(screen.queryByTestId('project-chat-request-post')).toBeNull();
  });

  it('a request carries a title AND a reason', async () => {
    renderModal();
    fireEvent.click(screen.getByTestId('project-chat-request-post'));
    // Both are required — the recipient should not need a conversation first.
    expect(screen.getByTestId('post-request-submit')).toBeDisabled();
    fireEvent.change(screen.getByTestId('post-request-title'), {
      target: { value: 'Corrections round 2' },
    });
    expect(screen.getByTestId('post-request-submit')).toBeDisabled();
    fireEvent.change(screen.getByTestId('post-request-reason'), {
      target: { value: 'City came back' },
    });
    fireEvent.click(screen.getByTestId('post-request-submit'));
    await waitFor(() => expect(mocks.requested).toHaveLength(1));
    expect(mocks.requested[0]).toMatchObject({
      projectId: PROJ,
      title: 'Corrections round 2',
      reason: 'City came back',
    });
  });
});

describe('fix-339: answering, as an admin', () => {
  const OPEN = {
    id: 'req-1',
    title: 'Corrections round 2',
    reason: 'City came back and it needs its own thread',
    status: 'open',
    requested_by: 'trevor',
    requester_name: 'Trevor',
    unresolved_recipients: [] as string[],
    created_at: '2026-08-18T10:00:00Z',
  };

  it('★ an admin sees the open request, who asked and why', () => {
    mocks.isAdmin = true;
    mocks.projectRequests = [OPEN];
    renderModal();
    const row = screen.getByTestId('post-request-req-1');
    expect(row).toHaveTextContent('Corrections round 2');
    expect(row).toHaveTextContent('Trevor');
    expect(row).toHaveTextContent('City came back');
  });

  it('a non-admin does not see the answering panel', () => {
    mocks.projectRequests = [OPEN];
    renderModal();
    expect(screen.queryByTestId('post-requests-open')).toBeNull();
  });

  // ★★ ONE STEP: creating the post pre-fills from the request, resolves it for
  // everyone, and records WHICH post answered it so the requester can be taken
  // there.
  it('★★ "Create this post" pre-fills, then resolves the request as created', async () => {
    mocks.isAdmin = true;
    mocks.projectRequests = [OPEN];
    renderModal();
    fireEvent.click(screen.getByTestId('post-request-create-req-1'));

    const title = screen.getByTestId('project-chat-new-post-title') as HTMLInputElement;
    expect(title.value).toBe('Corrections round 2');
    expect(
      (screen.getByTestId('project-chat-new-post-body') as HTMLTextAreaElement).value,
    ).toContain('City came back');

    fireEvent.click(screen.getByTestId('project-chat-new-post-submit'));
    await waitFor(() => expect(mocks.posted).toHaveLength(1));
    expect(mocks.resolved).toHaveLength(1);
    expect(mocks.resolved[0]).toMatchObject({
      id: 'req-1',
      status: 'created',
      createdPostId: 'new-post-id',
    });
  });

  it('★ declining resolves it too — and clears it for everyone', () => {
    mocks.isAdmin = true;
    mocks.projectRequests = [OPEN];
    renderModal();
    fireEvent.click(screen.getByTestId('post-request-decline-req-1'));
    expect(mocks.resolved[0]).toMatchObject({ id: 'req-1', status: 'declined' });
  });

  // ★★ DAVE'S LIVE STATE. A recipient who could not be reached is named on the
  // request rather than silently missing.
  it('★★ an unreachable recipient is named, and the request still works', () => {
    mocks.isAdmin = true;
    mocks.projectRequests = [{ ...OPEN, unresolved_recipients: ['Dave'] }];
    renderModal();
    expect(screen.getByTestId('post-request-unreachable-req-1')).toHaveTextContent(
      'Dave',
    );
    // ...and it is still fully actionable.
    expect(screen.getByTestId('post-request-create-req-1')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('post-request-decline-req-1'));
    expect(mocks.resolved).toHaveLength(1);
  });

  it('no panel renders when there is nothing to answer', () => {
    mocks.isAdmin = true;
    renderModal();
    expect(screen.queryByTestId('post-requests-open')).toBeNull();
  });

  it('the panel counts what is waiting', () => {
    mocks.isAdmin = true;
    mocks.projectRequests = [OPEN, { ...OPEN, id: 'req-2', title: 'Survey' }];
    renderModal();
    expect(
      within(screen.getByTestId('post-requests-open')).getByText(/Requested posts \(2\)/),
    ).toBeInTheDocument();
  });
});
