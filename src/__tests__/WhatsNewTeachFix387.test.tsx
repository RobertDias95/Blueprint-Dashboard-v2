import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import migrationSql from '../../migrations/fix_387_whats_new_teach.sql?raw';
import draftsSql from '../../migrations/fix_387_entry_drafts_PENDING_APPROVAL.sql?raw';
import pageSource from '../pages/WhatsNew.tsx?raw';
import hookSource from '../hooks/useWhatsNew.ts?raw';
import { isAppPath, readsLikeATicket } from '../lib/whatsNew';

/** ★ These files explain themselves at length, so a "the code does not say X"
 *  assertion has to read the CODE, not the prose — the trap fix-369, fix-371
 *  and fix-372 each hit once. ("marked read" in a comment is not a markdown
 *  renderer.) */
function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

// ===========================================================================
// fix-387 — What's New announces, but it does not teach
// ===========================================================================
//
// From the register: an entry should let a person click through to the feature,
// or expand into a how-to. fix-350's own framing was the diagnosis — "a feature
// nobody knows exists is indistinguishable from one that was never built" — and
// a feature nobody can FIND is the same feature one click later.
//
// Measured on prod: 23 entries, 5 tips, 10 distinct readers. The reading habit
// exists; this gives it somewhere to go.

const sqlCode = migrationSql.replace(/^\s*--.*$/gm, '');

const state = vi.hoisted(() => ({
  entries: [] as Record<string, unknown>[],
  reads: [] as string[],
  admin: false,
  saved: null as Record<string, unknown> | null,
}));

vi.mock('../hooks/useIsTenantAdmin', () => ({
  useIsTenantAdmin: () => state.admin,
}));
vi.mock('../hooks/useWhatsNew', () => ({
  useWhatsNewEntries: () => ({ data: state.entries, isLoading: false }),
  useWhatsNewReads: () => ({ data: state.reads, isLoading: false }),
  useMarkWhatsNewRead: () => ({ mutate: vi.fn(), isPending: false }),
  useUpsertWhatsNewEntry: () => ({
    mutate: (d: Record<string, unknown>, o?: { onSuccess?: () => void }) => {
      state.saved = d;
      o?.onSuccess?.();
    },
    isPending: false,
    isError: false,
    error: null,
  }),
  useDeleteWhatsNewEntry: () => ({ mutate: vi.fn(), isPending: false }),
}));

import WhatsNew from '../pages/WhatsNew';

function entry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'e1',
    published_on: '2026-08-21',
    kind: 'new',
    title: 'Pipeline pills are back',
    body: 'Every project row shows where its permits are.',
    sort_order: 0,
    go_href: null,
    how_to: null,
    ...over,
  };
}

/** Renders the page, with a stub destination so a click-through is a real
 *  react-router navigation rather than a mocked call. */
function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/whats-new']}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <Routes>
      <Route path="/whats-new" element={<WhatsNew />} />
      <Route
        path="/board"
        element={<div data-testid="stub-board">the board</div>}
      />
    </Routes>,
    { wrapper },
  );
}

beforeEach(() => {
  state.entries = [];
  state.reads = [];
  state.admin = false;
  state.saved = null;
});

// ---------------------------------------------------------------------------
// ★★★ THE DEFAULT CASE — all 23 real rows are in it
// ---------------------------------------------------------------------------

describe('fix-387: an entry with neither column is unchanged', () => {
  it('★★★ renders the title and body, and NEITHER affordance', () => {
    state.entries = [entry()];
    renderPage();
    expect(screen.getByTestId('whats-new-entry-e1')).toBeInTheDocument();
    expect(screen.getByText('Pipeline pills are back')).toBeInTheDocument();
    expect(screen.queryByTestId('whats-new-go-e1')).toBeNull();
    expect(screen.queryByTestId('whats-new-how-toggle-e1')).toBeNull();
    expect(screen.queryByTestId('whats-new-how-e1')).toBeNull();
  });

  it('★★ the unread style and kind chip are untouched', () => {
    state.entries = [entry()];
    renderPage();
    const row = screen.getByTestId('whats-new-entry-e1');
    expect(row.dataset.unread).toBe('true');
    expect(row.dataset.kind).toBe('new');
    expect(screen.getByTestId('whats-new-kind-e1')).toBeInTheDocument();
  });

  it('★ an empty string is treated as absent, not as a broken link', () => {
    state.entries = [entry({ go_href: '   ', how_to: '  ' })];
    renderPage();
    expect(screen.queryByTestId('whats-new-go-e1')).toBeNull();
    expect(screen.queryByTestId('whats-new-how-toggle-e1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('fix-387: go_href navigates client-side', () => {
  it('★★★ clicking "Open it →" reaches the destination without a reload', () => {
    state.entries = [entry({ go_href: '/board' })];
    renderPage();
    fireEvent.click(screen.getByTestId('whats-new-go-e1'));
    // The stub route rendered — react-router, in-app, no navigation away.
    expect(screen.getByTestId('stub-board')).toBeInTheDocument();
  });

  it('★★★ it is a button using navigate(), never a bare href', () => {
    state.entries = [entry({ go_href: '/board' })];
    renderPage();
    const go = screen.getByTestId('whats-new-go-e1');
    expect(go.tagName).toBe('BUTTON');
    expect(go.getAttribute('href')).toBeNull();
    expect(pageSource).toContain('onClick={() => navigate(href)}');
  });

  it('★★★ a value that is not an app path renders no link at all', () => {
    // Belt to the CHECK's braces: something that reached the client without
    // passing the constraint still does not become a link.
    for (const bad of ['//evil.com', 'https://evil.com', 'javascript:alert(1)']) {
      state.entries = [entry({ go_href: bad })];
      const { unmount } = renderPage();
      expect(screen.queryByTestId('whats-new-go-e1')).toBeNull();
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------

describe('fix-387: the how-to expands, and never opens itself', () => {
  it('★★ collapsed by default, expands and collapses again', () => {
    state.entries = [entry({ how_to: 'Open My Board.\nClick the tab.' })];
    renderPage();
    // ★ Collapsed on arrival — teaching is opened, never opening.
    expect(screen.queryByTestId('whats-new-how-e1')).toBeNull();
    const toggle = screen.getByTestId('whats-new-how-toggle-e1');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);
    expect(screen.getByTestId('whats-new-how-e1')).toBeInTheDocument();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(toggle);
    expect(screen.queryByTestId('whats-new-how-e1')).toBeNull();
  });

  it('★★ expanding one entry does not expand another', () => {
    state.entries = [
      entry({ id: 'e1', how_to: 'Steps for one.' }),
      entry({ id: 'e2', title: 'Second', how_to: 'Steps for two.' }),
    ];
    renderPage();
    fireEvent.click(screen.getByTestId('whats-new-how-toggle-e1'));
    expect(screen.getByTestId('whats-new-how-e1')).toBeInTheDocument();
    expect(screen.queryByTestId('whats-new-how-e2')).toBeNull();
  });

  it('★ line breaks come from whitespace-pre-line, not a markdown renderer', () => {
    state.entries = [entry({ how_to: 'One.\nTwo.' })];
    renderPage();
    fireEvent.click(screen.getByTestId('whats-new-how-toggle-e1'));
    expect(screen.getByTestId('whats-new-how-e1').className).toContain(
      'whitespace-pre-line',
    );
    // and no renderer was added anywhere — asserted on the CODE, since the
    // comments legitimately talk about entries being "marked read".
    const code = stripComments(pageSource);
    expect(code).not.toMatch(/markdown|remark-|rehype|dangerouslySetInnerHTML/i);
    expect(code).not.toMatch(/from '[^']*markdown[^']*'/i);
  });

  it('★★ nothing opens uninvited — no modal, no tour', () => {
    expect(pageSource).not.toMatch(/role="dialog"|<Modal|useTour|autoFocus/i);
  });
});

// ---------------------------------------------------------------------------
// ★★★ READ STATE — the choice, asserted both ways
// ---------------------------------------------------------------------------

describe('fix-387: neither action touches read state', () => {
  // ★★★ THE CHOICE. fix-350 marks every entry that was unread ON ARRIVAL as
  // read when the page UNMOUNTS — "you have read it when you have had it open".
  // So clicking "Open it →" navigates away, unmounts the page, and is marked
  // read by that existing mechanism; and expanding marks nothing on its own,
  // because a second rule clearing ONE entry while its neighbours wait for
  // unmount would leave two identically-read entries in different states.
  it('★★★ expanding the how-to does not mark that entry read', () => {
    state.entries = [entry({ how_to: 'Steps.' })];
    renderPage();
    expect(screen.getByTestId('whats-new-entry-e1').dataset.unread).toBe('true');
    fireEvent.click(screen.getByTestId('whats-new-how-toggle-e1'));
    // Still unread on screen — it clears on the way out, like every other row.
    expect(screen.getByTestId('whats-new-entry-e1').dataset.unread).toBe('true');
  });

  it('★★★ no second read-marking mechanism was added', () => {
    // The unmount cleanup is the ONE writer. fix-350 references the mutation in
    // four places, but only ONE of them CALLS it — so count invocations, not
    // mentions. If a click handler ever fires it directly, this fails.
    const code = stripComments(pageSource);
    expect(code.match(/markRef\.current\(/g) ?? []).toHaveLength(1);
    expect(code.match(/markRead\.mutate\(/g) ?? []).toHaveLength(0);
    expect(code).toContain('if (toClear.current.length > 0) markRef.current(toClear.current);');
  });

  it('★★ the click-through inherits fix-350 marking by unmounting the page', () => {
    state.entries = [entry({ go_href: '/board' })];
    renderPage();
    fireEvent.click(screen.getByTestId('whats-new-go-e1'));
    // The page is gone — which is precisely what triggers the existing cleanup.
    expect(screen.queryByTestId('whats-new-page')).toBeNull();
    expect(screen.getByTestId('stub-board')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------

describe('fix-387: the admin editor round-trips both fields', () => {
  beforeEach(() => {
    state.admin = true;
  });

  it('★★ saves a path and a how-to', () => {
    state.entries = [];
    renderPage();
    fireEvent.click(screen.getByTestId('whats-new-add'));
    fireEvent.change(screen.getByTestId('whats-new-editor-title'), {
      target: { value: 'Board tabs' },
    });
    fireEvent.change(screen.getByTestId('whats-new-editor-body'), {
      target: { value: 'My Board is three tabs now.' },
    });
    fireEvent.change(screen.getByTestId('whats-new-editor-go-href'), {
      target: { value: '/board?tab=notifications' },
    });
    fireEvent.change(screen.getByTestId('whats-new-editor-how-to'), {
      target: { value: 'Open My Board.\nPick a tab.' },
    });
    fireEvent.click(screen.getByTestId('whats-new-editor-save'));
    expect(state.saved).toMatchObject({
      go_href: '/board?tab=notifications',
      how_to: 'Open My Board.\nPick a tab.',
    });
  });

  it('★★ clearing a field sends a blank, which the hook turns into NULL', () => {
    state.entries = [entry({ go_href: '/board', how_to: 'Steps.' })];
    renderPage();
    fireEvent.click(screen.getByTestId('whats-new-edit-e1'));
    fireEvent.change(screen.getByTestId('whats-new-editor-go-href'), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByTestId('whats-new-editor-how-to'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByTestId('whats-new-editor-save'));
    expect(state.saved).toMatchObject({ go_href: '', how_to: '' });
    // ...and the hook is what maps blank → NULL, so "remove the link" really
    // removes it rather than storing '' (which the CHECK would reject).
    expect(hookSource).toContain("go_href: draft.go_href?.trim() || null");
    expect(hookSource).toContain("how_to: draft.how_to?.trim() || null");
  });

  it('★★★ a non-app path is refused by the editor, not just the database', () => {
    state.entries = [];
    renderPage();
    fireEvent.click(screen.getByTestId('whats-new-add'));
    fireEvent.change(screen.getByTestId('whats-new-editor-title'), {
      target: { value: 'T' },
    });
    fireEvent.change(screen.getByTestId('whats-new-editor-body'), {
      target: { value: 'B' },
    });
    fireEvent.change(screen.getByTestId('whats-new-editor-go-href'), {
      target: { value: '//evil.com' },
    });
    expect(screen.getByTestId('whats-new-editor-href-error')).toBeInTheDocument();
    expect(
      (screen.getByTestId('whats-new-editor-save') as HTMLButtonElement).disabled,
    ).toBe(true);
    // and a real path clears the refusal
    fireEvent.change(screen.getByTestId('whats-new-editor-go-href'), {
      target: { value: '/board' },
    });
    expect(screen.queryByTestId('whats-new-editor-href-error')).toBeNull();
    expect(
      (screen.getByTestId('whats-new-editor-save') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('★ readsLikeATicket lints the HOW-TO too', () => {
    state.entries = [];
    renderPage();
    fireEvent.click(screen.getByTestId('whats-new-add'));
    fireEvent.change(screen.getByTestId('whats-new-editor-how-to'), {
      target: { value: 'As of fix-385 §2 the tab is addressable.' },
    });
    expect(screen.getByTestId('whats-new-editor-warning')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ★★★ THE PATH RULE — the client predicate and the DB CHECK must agree
// ---------------------------------------------------------------------------

describe('fix-387: "starts with a slash" is NOT the rule', () => {
  // ★★★ //evil.com starts with a slash and is a PROTOCOL-RELATIVE URL: a
  // browser given it goes to https://evil.com. /\evil.com is the same trick
  // with a backslash some browsers fold into a slash. Every one of these was
  // also run against the live CHECK on prod and rolled back — same verdicts.
  const ACCEPT = ['/', '/board', '/board?tab=notifications', '/draw-schedule'];
  const REJECT = [
    '//evil.com',
    '/\\evil.com',
    '\\\\evil.com',
    'https://evil.com',
    'javascript:alert(1)',
    'board',
    '///x',
    '/a\\b',
  ];

  it.each(ACCEPT)('★★ accepts %s', (h) => {
    expect(isAppPath(h)).toBe(true);
  });

  it.each(REJECT)('★★★ rejects %s', (h) => {
    expect(isAppPath(h)).toBe(false);
  });

  it('★★ the DB CHECK encodes the same two clauses', () => {
    expect(sqlCode).toContain("go_href ~ '^/($|[^/\\\\])'");
    expect(sqlCode).toContain("position('\\' in go_href) = 0");
    expect(sqlCode).toContain('whats_new_entries_go_href_is_app_path');
  });
});

// ---------------------------------------------------------------------------

describe('fix-387: the migration and the drafts', () => {
  it('★★ both columns are nullable with no default', () => {
    expect(sqlCode).toMatch(/ADD COLUMN IF NOT EXISTS go_href text/);
    expect(sqlCode).toMatch(/ADD COLUMN IF NOT EXISTS how_to\s+text/);
    const alter = sqlCode.slice(
      sqlCode.indexOf('ALTER TABLE public.whats_new_entries'),
      sqlCode.indexOf(';', sqlCode.indexOf('ADD COLUMN IF NOT EXISTS how_to')),
    );
    expect(alter).not.toMatch(/NOT NULL/);
    expect(alter).not.toMatch(/DEFAULT/i);
  });

  it('★★★ no row is written by the migration', () => {
    expect(sqlCode).not.toMatch(/\bUPDATE\s+public\.whats_new_entries\s+SET/i);
    expect(sqlCode).not.toMatch(/\bINSERT INTO\b/i);
  });

  it('★★★ the 23-entry draft is entirely commented out', () => {
    const live = draftsSql
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.trim().startsWith('--'));
    expect(live).toEqual([]);
    expect(draftsSql).toContain('NOT APPLIED');
    expect(draftsSql).toContain('HAS NOT BEEN RUN AGAINST ANY DATABASE');
  });

  it('★ every drafted how-to passes the tone lint', () => {
    // The drafts are prose Bobby may paste straight in, so they are held to the
    // same house rule the editor warns on.
    const quoted = [...draftsSql.matchAll(/^--\s{4,}(?:how_to|go_href)\s*:\s*(.+)$/gm)]
      .map((m) => m[1]);
    expect(quoted.length).toBeGreaterThan(0);
    for (const line of quoted) {
      expect(readsLikeATicket(line), `ticket-speak in: ${line}`).toBe(false);
    }
  });

  it('★★★ the shared select fetches both columns', () => {
    // Otherwise they are written and never read — the fix-122/fix-386 trap.
    expect(hookSource).toContain('go_href, how_to');
  });
});
