import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ProjectMessage, TeamMember, TeamRole } from '../lib/database.types';

// ===========================================================================
// fix-343 §3 — the avatar's initials, rendered
// ===========================================================================
//
// ★★ THE BUG THE BRIEF ASKED ME TO CHECK FOR: "initialsOf() should now yield BD
// for Bobby, not BO. Check what it actually reads from. If the avatar is fed
// team_members.name (still `Bobby`, one word) rather than first + last, it will
// still say BO and this ticket must fix it."
//
// ★ IT DID NOT FIX ITSELF. The avatar is fed `author_name`, which the server
// resolves through bp_profile_display_name → `team_members.name` → "Bobby". One
// word, so initialsOf took its first two letters. The roster gained first_name
// and last_name on prod 2026-08-18, and the fix is to feed the avatar the full
// name — `initialsOf` itself is untouched, because it was never the wrong half.
//
// ★ The AUTHOR LABEL is deliberately still the roster name: mentions are typed
// and matched against it, so promoting the label to a full name would break
// `@Bobby` for a cosmetic win.
//
// ---------------------------------------------------------------------------
// ★★ THE OTHER §3 ITEM — mention + authorship names — NEEDED NO CODE.
// ---------------------------------------------------------------------------
// Verified on prod 2026-08-18, and recorded here because "verified, no change
// needed" is the useful answer and silence is not:
//
//   · `author_name` is NOT a stored column. project_messages has no such
//     field; bp_list_project_messages computes it per read through
//     bp_profile_display_name. So the roster landing fixed every message ever
//     written, not just new ones.
//   · That function falls back through profiles.name → profiles.full_name →
//     team_members.name (matched on email) → the email. profiles.name and
//     full_name are NULL on all 29 logins, so the roster row is what answers —
//     and all 29 login emails now match one (there were 9 that did not).
//     Bobby's `@dave` message renders "Dave", not dave@blueprintcap.com.
//   · The same function feeds bp_mentionable_people (the @ picker) and the
//     post-request panels, so all three fixed themselves together.

const rosterRef = vi.hoisted(() => ({ rows: [] as TeamMember[] }));

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      user: { id: 'u-1', email: 'robertd@blueprintcap.com' },
      activeTenantId: 't1',
      memberships: [{ tenant_id: 't1', role: 'admin' }],
      initialized: true,
      session: null,
    }),
}));
vi.mock('../hooks/useProjectMessages', async (orig) => {
  const actual = await orig<typeof import('../hooks/useProjectMessages')>();
  return {
    ...actual,
    useEditMessage: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteMessage: () => ({ mutate: vi.fn(), isPending: false }),
    useCreateTaskFromMessage: () => ({ mutate: vi.fn(), isPending: false }),
  };
});
vi.mock('../hooks/useTeamMembers', async (orig) => {
  const actual = await orig<typeof import('../hooks/useTeamMembers')>();
  return {
    ...actual, // the real activeMemberNamesOf
    useTeamMembers: () => ({
      all: rosterRef.rows,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/useDmDaGroups', () => ({ useDmDaGroups: () => ({ rows: [] }) }));

import ChatMessageRow from '../components/ProjectDetail/ChatMessageRow';

function member(over: Partial<TeamMember>): TeamMember {
  return {
    id: `m-${over.name}`,
    name: over.name ?? 'Someone',
    role: (over.role ?? 'da') as TeamRole,
    active: true,
    former: false,
    email: null,
    notes: null,
    updated_at: '2026-08-18T00:00:00Z',
    active_start_quarter: null,
    active_end_quarter: null,
    ...over,
  } as TeamMember;
}

function message(over: Partial<ProjectMessage> = {}): ProjectMessage {
  return {
    id: 'm-1',
    project_id: 'p-1',
    author_id: 'u-1',
    author_name: 'Bobby',
    body: 'Plans are in.',
    mentions: [],
    attachments: [],
    created_at: '2026-08-18T10:00:00Z',
    task_id: null,
    task_text: null,
    task_permit_id: null,
    parent_message_id: 'post-1',
    title: null,
    edited_at: null,
    deleted_at: null,
    revisions: [],
    reply_count: null,
    last_activity_at: null,
    ...over,
  } as unknown as ProjectMessage;
}

function renderRow(msg = message()) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <ChatMessageRow
      message={msg}
      projectId="p-1"
      userId="u-1"
      people={[]}
      permits={[]}
    />,
    { wrapper },
  );
}

beforeEach(() => {
  rosterRef.rows = [
    member({ name: 'Bobby', role: 'ent_lead', first_name: 'Bobby', last_name: 'Dias' }),
    member({ name: 'Fisk', role: 'da', first_name: 'Matt', last_name: 'Fisk' }),
    member({ name: 'Alex', role: 'da', active: false, former: true }),
  ];
});

describe('fix-343 §3: the chat avatar shows BD, not BO', () => {
  it('★★ Bobby Dias is BD', () => {
    renderRow();
    expect(screen.getByTestId('chat-avatar').textContent).toBe('BD');
  });

  it('★★ and it is NOT the old two-letters-of-one-word answer', () => {
    renderRow();
    expect(screen.getByTestId('chat-avatar').textContent).not.toBe('BO');
  });

  // ★ `name` is a KEY, not a name — "Fisk" is Matt Fisk. Only the roster knows.
  it('★ a key that is a surname resolves too', () => {
    renderRow(message({ author_name: 'Fisk' }));
    expect(screen.getByTestId('chat-avatar').textContent).toBe('MF');
  });

  // ★ The label is the identity; the circle is decoration. Mentions are matched
  // against the label, so it must stay the roster name.
  it('★ the visible author label is still the roster name', () => {
    const view = renderRow();
    const row = within(view.container).getByTestId('project-chat-message-m-1');
    expect(row.textContent).toContain('Bobby');
    expect(row.textContent).not.toContain('Bobby Dias');
  });

  // ★ Fails open: a departed row with no first/last, or a name the roster has
  // never heard of, still draws something rather than blank.
  it('★ an unresolvable name falls back to the old behaviour', () => {
    renderRow(message({ author_name: 'Alex' }));
    expect(screen.getByTestId('chat-avatar').textContent).toBe('AL');
  });

  it('★ a stranger to the roster still draws initials', () => {
    renderRow(message({ author_name: 'Stranger' }));
    expect(screen.getByTestId('chat-avatar').textContent).toBe('ST');
  });
});
