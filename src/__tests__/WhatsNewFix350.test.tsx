import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import MIGRATION from '../../migrations/fix_350_whats_new.sql?raw';
import routerSrc from '../router.tsx?raw';
import PAGE_SRC from '../pages/WhatsNew.tsx?raw';
import {
  KIND_LABEL,
  WHATS_NEW_KINDS,
  formatDay,
  groupByDay,
  readsLikeATicket,
  sortEntries,
  unreadCount,
  unreadEntries,
  type WhatsNewEntry,
} from '../lib/whatsNew';
import {
  RIBBON_ENTRIES,
  allRibbonRoutes,
  isRibbonEntryActive,
  ribbonExemptPaths,
  visibleEntries,
} from '../lib/ribbonNav';

// ===========================================================================
// fix-350 — What's New: nobody knows what the tool can do
// ===========================================================================
//
// Bobby: *"We should add a what's new thing to the ribbon so people are aware of
// the features, tips and tricks etc."*
//
// ★★★ THE PROBLEM IS NOT THAT THE FEATURES ARE MISSING. Between 2026-08-14 and
// 2026-08-19 this tool gained project chat, @mentions, reactions, tags, a
// notification centre, live updates, a new logo and a dozen other things. Bobby
// has seen every one because he asked for it; the other 28 logins have been told
// about none of them.
//
// ★ SQL comments are stripped before any assertion about the executable text —
// this file's own prose quotes Bobby and names tickets, and a test that cannot
// tell prose from code would forbid a migration from explaining itself.

const SQL = MIGRATION.split(/\r?\n/)
  .map((l) => (l.trim().startsWith('--') ? '' : l))
  .join('\n');

/** Everything between the seed's VALUES and its closing paren — the entries as
 *  they will actually read to a person. */
const SEED = SQL.slice(SQL.indexOf('CROSS JOIN (VALUES'), SQL.indexOf(') AS v('));

/** The page source, for the assertions that are about how it is WRITTEN rather
 *  than what it renders — the ticket-number warning being a warning and not a
 *  guard on the Save button is one of those. */
function pageSource(): string {
  return PAGE_SRC;
}
const state = vi.hoisted(() => ({
  role: 'editor' as 'admin' | 'editor',
  userId: 'user-1',
  entries: [] as WhatsNewEntry[],
  reads: [] as string[],
  marked: [] as string[][],
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) =>
    sel({
      session: { user: { id: state.userId } },
      user: { id: state.userId, email: 'x@test' },
      initialized: true,
      memberships: [{ tenant_id: 't1', role: state.role }],
      activeTenantId: 't1',
    }),
}));

vi.mock('../hooks/useWhatsNew', () => ({
  useWhatsNewEntries: () => ({ data: state.entries, isLoading: false }),
  useWhatsNewReads: () => ({ data: state.reads, isLoading: false }),
  useMarkWhatsNewRead: () => ({
    mutate: (ids: string[]) => {
      state.marked.push(ids);
      // ★ The real mutation invalidates the reads query, so a read row lands.
      // Modelled here so the "reading clears it" test is about the behaviour
      // rather than about the mock.
      state.reads = [...state.reads, ...ids];
    },
    isPending: false,
  }),
  useUpsertWhatsNewEntry: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useDeleteWhatsNewEntry: () => ({ mutate: vi.fn(), isPending: false }),
}));

import WhatsNew from '../pages/WhatsNew';

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function mkEntry(over: Partial<WhatsNewEntry>): WhatsNewEntry {
  return {
    id: 'e1',
    published_on: '2026-08-18',
    kind: 'new',
    title: 'A thing',
    body: 'It does a thing.',
    sort_order: 0,
    ...over,
  };
}

beforeEach(() => {
  state.role = 'editor';
  state.userId = 'user-1';
  state.entries = [];
  state.reads = [];
  state.marked = [];
});

// ---------------------------------------------------------------------------
// §1 — where it lives
// ---------------------------------------------------------------------------

describe('fix-350 §1: a ribbon entry, visible to everyone', () => {
  it('★★★ a NON-ADMIN sees it — the whole ticket depends on this', () => {
    // 23 of the 29 logins are non-admin editors. Gating this would hide the
    // announcement from exactly the people it exists for.
    const forEditor = visibleEntries(false)
      .filter((e) => e.kind === 'link')
      .map((e) => (e.kind === 'link' ? e.link.to : ''));
    expect(forEditor).toContain('/whats-new');

    const entry = RIBBON_ENTRIES.find(
      (e) => e.kind === 'link' && e.link.to === '/whats-new',
    );
    expect(entry).toBeTruthy();
    if (entry?.kind === 'link') {
      // Not merely absent — `adminOnly` must not be true by any route.
      expect(entry.link.adminOnly).toBeUndefined();
      expect(entry.link.label).toBe("What's New");
    }
  });

  it('★ the route exists, is covered by the ribbon, and is not also exempt', () => {
    // fix-315's rule: every route is reachable by clicking or explicitly
    // exempt, never both.
    expect(routerSrc).toContain("path: 'whats-new'");
    expect(allRibbonRoutes()).toContain('/whats-new');
    expect(ribbonExemptPaths()).not.toContain('/whats-new');
  });

  it('★★ the route is NOT wrapped in AdminRoute', () => {
    // The page being ungated is a claim about router.tsx, not just about the
    // ribbon — a gated route with an ungated rail entry would be a link
    // everybody can see and nobody can follow.
    const line = routerSrc
      .split(/\r?\n/)
      .find((l) => l.includes("path: 'whats-new'"));
    expect(line).toBeTruthy();
    expect(line).not.toContain('AdminRoute');
  });

  it('★ exactly one ribbon entry is active on it — fix-335 §5 still holds', () => {
    const active = allRibbonRoutes().filter((to) => {
      const link = RIBBON_ENTRIES.flatMap((e) =>
        e.kind === 'link' ? [e.link] : e.kind === 'group' ? e.group.children : [],
      ).find((l) => l.to === to);
      return isRibbonEntryActive(to, '/whats-new', link?.exact);
    });
    expect(active).toEqual(['/whats-new']);
  });
});

// ---------------------------------------------------------------------------
// §1b — the unread marker
// ---------------------------------------------------------------------------

describe('fix-350 §1: the unread marker, and it is per person', () => {
  const entries = [mkEntry({ id: 'a' }), mkEntry({ id: 'b' })];

  it('★★★ clears for one person and NOT for another', () => {
    // The brief: "Bobby reading an entry must not clear it for Cam."
    const bobbyRead = new Set(['a', 'b']);
    const camRead = new Set<string>();
    expect(unreadCount(entries, bobbyRead)).toBe(0);
    expect(unreadCount(entries, camRead)).toBe(2);
  });

  it('★★ a NEW entry re-marks it unread, and reading clears it again', () => {
    const read = new Set(['a', 'b']);
    expect(unreadCount(entries, read)).toBe(0);
    // An admin writes a tip…
    const withNew = [...entries, mkEntry({ id: 'c', title: 'A tip', kind: 'tip' })];
    expect(unreadCount(withNew, read)).toBe(1);
    expect(unreadEntries(withNew, read).map((e) => e.id)).toEqual(['c']);
    // …and reading it goes quiet again.
    expect(unreadCount(withNew, new Set(['a', 'b', 'c']))).toBe(0);
  });

  it('★★ it reuses fix-335 §9\'s vocabulary and adds no second one', async () => {
    const ribbonSrc = (await import('../components/Ribbon.tsx?raw')).default as string;
    const marker = ribbonSrc.slice(ribbonSrc.indexOf('function WhatsNewMarker'));
    const body = marker.slice(0, marker.indexOf('\n}'));
    // --color-de, the same token every unread row in the bell and the centre
    // uses. NOT a hex literal — the rule UnreadBellFix335 asserts.
    expect(body).toContain("background: 'var(--color-de)'");
    expect(body).not.toMatch(/#[0-9a-f]{3,8}/i);
    // ★ And it is the marker shape, not the error badge's red count.
    expect(body).not.toContain('ERROR_BADGE_RED');
  });

  it('★ it is a MARKER, not a count — fix-307\'s lesson', () => {
    // A badge counting outstanding things never reaches zero and stops being a
    // signal. This one reaches zero, so "there is something" is the message.
    const entry = RIBBON_ENTRIES.find(
      (e) => e.kind === 'link' && e.link.to === '/whats-new',
    );
    expect(entry?.kind === 'link' && entry.link.badge).toBe('whats-new');
  });
});

// ---------------------------------------------------------------------------
// §2 / §3 — the entries themselves
// ---------------------------------------------------------------------------

describe('fix-350 §2: entries are written by a person', () => {
  it('★★★ NOT ONE seeded entry mentions a ticket number', () => {
    // "fix-347" means nothing to a design associate, and an entry generated
    // from a commit message is worse than no entry — it teaches people this
    // page is not for them.
    expect(SEED).not.toMatch(/\bfix-\d+/i);
    expect(SEED).not.toMatch(/\B#\d{2,}\b/);
    expect(SEED).not.toMatch(/\bPR\b|\bcommit\b|\bmerge[ds]?\b/i);
  });

  it('★★ and the same rule is a predicate the editor warns on', () => {
    expect(readsLikeATicket('fix-347: smart tags with resolved mention ids')).toBe(true);
    expect(readsLikeATicket('See #327 for the details')).toBe(true);
    expect(readsLikeATicket('Type @project in any project chat')).toBe(false);
    // ★ A warning, not a refusal — a tool that will not save is a tool arguing
    // with the person writing the words. Asserted on the page source so the
    // predicate cannot quietly become a guard on the Save button.
    const pageSrc = pageSource();
    expect(pageSrc).toContain("readsLikeATicket");
    expect(pageSrc).toMatch(/const canSave =[^;]*title[^;]*body[^;]*;/);
    expect(pageSrc).not.toMatch(/canSaves*=.*ticketish/);
  });

  it('★ three kinds, and the database agrees with the client', () => {
    expect([...WHATS_NEW_KINDS]).toEqual(['new', 'improved', 'tip']);
    expect(SQL).toMatch(/CHECK \(kind IN \('new', 'improved', 'tip'\)\)/);
    for (const k of WHATS_NEW_KINDS) expect(KIND_LABEL[k]).toBe(k);
  });

  it('★★ the seed carries all three kinds — it is not just release notes', () => {
    // Bobby asked for "features, tips and tricks". A seed with no tips would
    // have quietly delivered half the request.
    for (const k of WHATS_NEW_KINDS) expect(SEED).toContain(`'${k}',`);
    const tips = SEED.split("'tip',").length - 1;
    expect(tips).toBeGreaterThanOrEqual(4);
  });

  it('★ 15 entries, dated across the five days they shipped', () => {
    const titles = SEED.match(/^\s+\('20\d\d-\d\d-\d\d'::date/gm) ?? [];
    expect(titles).toHaveLength(15);
    for (const d of ['2026-08-19', '2026-08-18', '2026-08-17']) {
      expect(SEED).toContain(`'${d}'::date`);
    }
    // ★ Not all stamped with the day the migration ran, which is what a
    // generated changelog would have done.
    expect(SEED).not.toMatch(/current_date/);
  });

  it('★ the seed is idempotent and writes nothing else', () => {
    expect(SQL).toMatch(/WHERE NOT EXISTS/);
    // ★ Standing rule: a new table is expected, existing rows are not written.
    const writes = new Set<string>();
    for (const m of SQL.matchAll(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.(\w+)/gi)) {
      writes.add(m[1]!);
    }
    expect([...writes]).toEqual(['whats_new_entries']);
  });
});

describe('fix-350 §3: storage and who may write', () => {
  it('★★★ everyone in the tenant reads; only admins write — in the DATABASE', () => {
    // fix-234's lesson, which fix-331 §6 had to go back and apply: a page
    // hidden from a non-admin is a decoration, not a permission.
    expect(SQL).toMatch(
      /CREATE POLICY whats_new_entries_tenant_select[\s\S]*?FOR SELECT USING \(tenant_id = ANY \(public\.auth_tenant_ids\(\)\)\)/,
    );
    expect(SQL).toMatch(
      /CREATE POLICY whats_new_entries_tenant_admin_write[\s\S]*?FOR ALL USING \(public\.is_tenant_admin\(tenant_id\)\)[\s\S]*?WITH CHECK \(public\.is_tenant_admin\(tenant_id\)\)/,
    );
    expect(SQL).toMatch(/ALTER TABLE public\.whats_new_entries ENABLE ROW LEVEL SECURITY/);
  });

  it('★★★ read rows are confined to their own login, both directions', () => {
    // This is what makes "per person" a fact rather than a convention.
    expect(SQL).toMatch(
      /CREATE POLICY whats_new_reads_own_select[\s\S]*?USING \(\s*user_id = auth\.uid\(\) AND tenant_id = ANY \(public\.auth_tenant_ids\(\)\)/,
    );
    expect(SQL).toMatch(
      /CREATE POLICY whats_new_reads_own_insert[\s\S]*?WITH CHECK \(\s*user_id = auth\.uid\(\) AND tenant_id = ANY \(public\.auth_tenant_ids\(\)\)/,
    );
    // ★ Append-only: no DELETE policy, and no DELETE grant.
    expect(SQL).not.toMatch(/whats_new_reads_own_delete/);
    expect(SQL).toMatch(/GRANT SELECT, INSERT ON public\.whats_new_reads/);
  });

  it('★ a deleted entry takes its read rows with it', () => {
    // The reason this is its own table rather than a key in board_item_reads.
    expect(SQL).toMatch(
      /entry_id\s+uuid NOT NULL\s+REFERENCES public\.whats_new_entries\(id\) ON DELETE CASCADE/,
    );
  });

  it('★★ both tables are PUBLISHED to realtime — fix-336\'s silent failure', () => {
    // A subscription to an unpublished table is silent: no error, no warning,
    // the handler simply never fires. queryKeys names both, so they must be here.
    expect(SQL).toMatch(/ALTER PUBLICATION supabase_realtime ADD TABLE public\.whats_new_entries/);
    expect(SQL).toMatch(/ALTER PUBLICATION supabase_realtime ADD TABLE public\.whats_new_reads/);
  });
});

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

describe('fix-350: the page', () => {
  it('★ renders entries newest first, grouped under their date', () => {
    state.entries = [
      mkEntry({ id: 'old', published_on: '2026-08-17', title: 'Older' }),
      mkEntry({ id: 'new', published_on: '2026-08-19', title: 'Newer' }),
      mkEntry({ id: 'mid', published_on: '2026-08-18', title: 'Middle' }),
    ];
    wrap(<WhatsNew />);
    const list = screen.getByTestId('whats-new-list');
    const days = Array.from(list.querySelectorAll('[data-testid^="whats-new-day-"]')).map(
      (d) => d.getAttribute('data-testid'),
    );
    expect(days).toEqual([
      'whats-new-day-2026-08-19',
      'whats-new-day-2026-08-18',
      'whats-new-day-2026-08-17',
    ]);
  });

  it('★★ an unread entry is tinted, a read one is not', () => {
    state.entries = [mkEntry({ id: 'a' }), mkEntry({ id: 'b', title: 'Second' })];
    state.reads = ['a'];
    wrap(<WhatsNew />);
    expect(screen.getByTestId('whats-new-entry-a').getAttribute('data-unread')).toBe('false');
    expect(screen.getByTestId('whats-new-entry-b').getAttribute('data-unread')).toBe('true');
    expect(screen.getByTestId('whats-new-entry-b').className).toContain('bg-de-bg');
  });

  it('★★★ leaving the page marks the unread ones read — for THIS person', async () => {
    state.entries = [mkEntry({ id: 'a' }), mkEntry({ id: 'b', title: 'Second' })];
    state.reads = ['a'];
    const view = wrap(<WhatsNew />);
    // ★ Nothing is marked while you are still on it — that is what keeps the
    // highlight from vanishing under the reader.
    expect(state.marked).toEqual([]);
    view.unmount();
    await waitFor(() => expect(state.marked.length).toBeGreaterThan(0));
    // Only the one that was unread, and never the already-read one twice.
    expect(state.marked[0]).toEqual(['b']);
  });

  it('★★★ and the highlight SURVIVES the visit that cleared it', async () => {
    // ★ Without freezing what was unread on arrival the page would erase its
    // own highlight while you were looking at it: marking on mount lands a read
    // row, the reads query re-resolves, and the tint you came to see vanishes
    // mid-read. The re-render below is what a landed read row looks like.
    state.entries = [mkEntry({ id: 'b' })];
    state.reads = [];
    const view = wrap(<WhatsNew />);
    expect(screen.getByTestId('whats-new-entry-b').getAttribute('data-unread')).toBe('true');
    // ★ A re-render mid-visit — the thing that would happen if anything landed
    // a read row while the page was open. The row must still be tinted.
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <WhatsNew />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('whats-new-entry-b').getAttribute('data-unread')).toBe('true');
    expect(state.marked).toEqual([]);
    // …and only on the way out does it clear.
    view.unmount();
    await waitFor(() => expect(state.reads).toContain('b'));
  });

  it('★ …and on the NEXT visit it is quiet', () => {
    state.entries = [mkEntry({ id: 'b' })];
    state.reads = ['b'];
    wrap(<WhatsNew />);
    expect(screen.getByTestId('whats-new-entry-b').getAttribute('data-unread')).toBe('false');
    expect(state.marked).toEqual([]);
  });

  it('★ a non-admin gets no editor and no write controls', () => {
    state.role = 'editor';
    state.entries = [mkEntry({ id: 'a' })];
    wrap(<WhatsNew />);
    expect(screen.queryByTestId('whats-new-add')).toBeNull();
    expect(screen.queryByTestId('whats-new-edit-a')).toBeNull();
    expect(screen.queryByTestId('whats-new-delete-a')).toBeNull();
  });

  it('★★ an admin gets them, and the editor warns on a ticket number', () => {
    state.role = 'admin';
    state.entries = [mkEntry({ id: 'a' })];
    wrap(<WhatsNew />);
    fireEvent.click(screen.getByTestId('whats-new-add'));
    const body = screen.getByTestId('whats-new-editor-body');
    fireEvent.change(body, { target: { value: 'fix-347 shipped smart tags' } });
    expect(screen.getByTestId('whats-new-editor-warning')).toBeInTheDocument();
    // ★ A warning, not a refusal — Save stays available.
    fireEvent.change(screen.getByTestId('whats-new-editor-title'), {
      target: { value: 'Tags' },
    });
    expect(
      (screen.getByTestId('whats-new-editor-save') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('★ filtering by kind narrows the list without hiding the vocabulary', () => {
    state.entries = [
      mkEntry({ id: 'n', kind: 'new', title: 'A new thing' }),
      mkEntry({ id: 't', kind: 'tip', title: 'A tip' }),
    ];
    wrap(<WhatsNew />);
    fireEvent.click(screen.getByTestId('whats-new-filter-tip'));
    expect(screen.queryByTestId('whats-new-entry-n')).toBeNull();
    expect(screen.getByTestId('whats-new-entry-t')).toBeInTheDocument();
    // All three chips stay on screen — they are chips, not tabs.
    for (const k of WHATS_NEW_KINDS) {
      expect(screen.getByTestId(`whats-new-filter-${k}`)).toBeInTheDocument();
    }
  });

  it('★★ NO interruption: nothing here is a modal, a tour or an app-wide banner', () => {
    // The brief rules all three out by name. The entire announcement is one dot
    // on one ribbon entry.
    state.entries = [mkEntry({ id: 'a' })];
    const view = wrap(<WhatsNew />);
    expect(view.container.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.queryByTestId('whats-new-dismiss')).toBeNull();
  });

  it('★ no comments or reactions on entries — that is what the chat is for', () => {
    state.entries = [mkEntry({ id: 'a' })];
    wrap(<WhatsNew />);
    expect(screen.queryByTestId('whats-new-react-a')).toBeNull();
    expect(screen.queryByTestId('whats-new-comment-a')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The pure helpers
// ---------------------------------------------------------------------------

describe('fix-350: the ordering is total', () => {
  it('★ newest date, then sort_order, then title', () => {
    const a = mkEntry({ id: 'a', published_on: '2026-08-18', sort_order: 1, title: 'B' });
    const b = mkEntry({ id: 'b', published_on: '2026-08-18', sort_order: 1, title: 'A' });
    const c = mkEntry({ id: 'c', published_on: '2026-08-19', sort_order: 0, title: 'Z' });
    const d = mkEntry({ id: 'd', published_on: '2026-08-18', sort_order: 9, title: 'Q' });
    expect(sortEntries([a, b, c, d]).map((e) => e.id)).toEqual(['c', 'd', 'b', 'a']);
  });

  it('★ grouping preserves that order and never splits a day', () => {
    const days = groupByDay([
      mkEntry({ id: '1', published_on: '2026-08-18' }),
      mkEntry({ id: '2', published_on: '2026-08-19' }),
      mkEntry({ id: '3', published_on: '2026-08-18', title: 'Zed' }),
    ]);
    expect(days.map((d) => d.date)).toEqual(['2026-08-19', '2026-08-18']);
    expect(days[1]!.entries).toHaveLength(2);
  });

  it('★ one date format — fix-320\'s', () => {
    expect(formatDay('2026-08-18')).toBe('18 Aug 2026');
    expect(formatDay('not a date')).toBe('not a date');
  });
});
