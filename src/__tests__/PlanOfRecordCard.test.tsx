import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SHARE_TOAST,
  SHARE_TTL_DAYS,
  SHARE_TTL_SECONDS,
} from '../lib/planOfRecordShare';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { ProjectPlanOfRecordRow } from '../lib/database.types';
// ★ fix-467 §3: imported so the "not painted" property is checked against the
//   REAL constant, and so this file fails if somebody deletes it.
import {
  CHIP_INK_HUE_PCT,
  STAGE_CHIP,
  STAGE_CHIP_MIX,
} from '../lib/planOfRecord';
import { POR_IMAGE_MAX_HEIGHT } from '../lib/projectCardLayout';

// fix-285: the Design Plan of Record card.
//
// The supabase client is mocked at the module level so the REAL hooks run —
// which is what makes the "signed, never public" assertions mean something: if
// the component ever reached for getPublicUrl, the spy would record it.

const T = 'test-tenant-uuid';
const PROJECT_ID = '3e1f84c4-92fe-4c70-aaa2-2758c5f13d68';

const state = vi.hoisted(() => ({
  row: null as unknown,
  rowError: null as unknown,
  // ★★★ fix-523 §B2: `project_plan_of_record_sets` IS ON PROD NOW (334 rows,
  //     measured 2026-09-11) and the card's availability guard reads it, so the
  //     suite declares set rows instead of leaving the query to resolve into
  //     nothing. `null` keeps the pre-fix-504 behaviour — no set information for
  //     the stage, so nothing grays.
  sets: null as null | Array<Record<string, unknown>>,
  rpcCalls: [] as Array<[string, unknown]>,
  rpcResult: null as unknown,
  signedUrl: 'https://example.supabase.co/storage/v1/object/sign/plan-thumbnails/x.jpg?token=abc',
  signError: null as unknown,
  calls: [] as string[],
  publicUrlCalls: 0,
  signArgs: [] as Array<[string, number]>,
  buckets: [] as string[],
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      state.rpcCalls.push([name, args]);
      return Promise.resolve({ data: state.rpcResult, error: null });
    },
    functions: {
      invoke: () => Promise.resolve({ data: { pages: [], thumb: null }, error: null }),
    },
    from: (table: string) => {
      state.calls.push(`from:${table}`);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.is = () => chain;
      chain.gt = () => chain;
      // ★ Awaitable, so a query that ends at `.eq()` gets a real answer rather
      //   than the chain object itself — which destructures to
      //   `{ data: undefined }` and quietly reads as "the view exists and is
      //   empty", a state that does not occur on prod.
      chain.then = (
        resolve: (v: { data: unknown; error: unknown }) => unknown,
      ) =>
        Promise.resolve({
          data:
            table === 'project_plan_of_record_sets' ? state.sets : [],
          error: table === 'project_plan_of_record_sets' && state.sets === null
            ? { code: '42P01' }
            : null,
        }).then(resolve);
      chain.maybeSingle = () =>
        Promise.resolve({ data: state.row, error: state.rowError });
      // Anything that would WRITE is recorded so the read-only test can see it.
      chain.insert = () => { state.calls.push(`insert:${table}`); return chain; };
      chain.update = () => { state.calls.push(`update:${table}`); return chain; };
      chain.upsert = () => { state.calls.push(`upsert:${table}`); return chain; };
      chain.delete = () => { state.calls.push(`delete:${table}`); return chain; };
      return chain;
    },
    storage: {
      from: (bucket: string) => {
        state.buckets.push(bucket);
        return {
          createSignedUrl: (path: string, ttl: number) => {
            state.calls.push('createSignedUrl');
            state.signArgs.push([path, ttl]);
            return Promise.resolve({
              data: state.signError ? null : { signedUrl: state.signedUrl },
              error: state.signError,
            });
          },
          getPublicUrl: (path: string) => {
            // ★ Must never be reached for this bucket.
            state.publicUrlCalls += 1;
            state.calls.push('getPublicUrl');
            return { data: { publicUrl: `https://public/${path}` } };
          },
          upload: () => { state.calls.push('upload'); return Promise.resolve({ data: null, error: null }); },
          remove: () => { state.calls.push('remove'); return Promise.resolve({ data: null, error: null }); },
        };
      },
    },
  },
}));

const toastMock = vi.hoisted(() => vi.fn());
vi.mock('../stores/toastStore', () => ({ pushToast: toastMock }));

import PlanOfRecordCard from '../components/ProjectDetail/PlanOfRecordCard';

const UNC =
  '\\\\bpc-file\\SoleilData\\--- Blueprint Services ---\\Building Permits\\'
  + '10044 37th Ave SW - Haushund - MA\\10044 - Marketing Plans\\'
  + '10044 - Plan Set - Marketing Update 260618.pdf';

function row(over: Partial<ProjectPlanOfRecordRow> = {}): ProjectPlanOfRecordRow {
  return {
    project_id: PROJECT_ID,
    tenant_id: T,
    file_index_id: 'fi-1',
    set_type: 'marketing',
    stage_rank: 3,
    file_name: '10044 - Plan Set - Marketing Update 260618.pdf',
    unc_path: UNC,
    folder_name: '10044 - Marketing Plans',
    modified_at: '2026-06-18T00:00:00Z',
    size_kb: 17398,
    thumb_path: `${PROJECT_ID}/marketing.jpg`,
    thumb_status: 'ok',
    thumb_generated_at: '2026-08-11T00:00:00Z',
    ...over,
  };
}

/** ★ fix-525: a `project_plan_of_record_sets` row, so the card's availability
 *  guard (fix-523 §B2) leaves the button live and its share glyph mounted. */
function marketingSet(variant: 'internal' | 'external') {
  return {
    project_id: PROJECT_ID,
    set_type: 'marketing',
    variant,
    page_count: variant === 'external' ? 6 : 1,
    pages_status: 'ok',
    pages_prefix: `${PROJECT_ID}/marketing_${variant}/`,
    is_archived_fallback: false,
    thumb_path: `${PROJECT_ID}/marketing_${variant}.jpg`,
    thumb_status: 'ok',
    file_name: `3505 - Marketing - ${variant}.pdf`,
    // ★ fix-528 §C: 336 of 336 current sets carry one on prod, so the fixture
    //   carries one too — a fixture that never has a PDF would make the
    //   Download item untestable and the ABSENCE test meaningless.
    pdf_path: `${PROJECT_ID}/marketing_${variant}/source.pdf`,
    pdf_bytes: 2774619,
  };
}

function renderCard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<PlanOfRecordCard projectId={PROJECT_ID} />, { wrapper });
}

beforeEach(() => {
  useAuthStore.setState({
    activeTenantId: T,
    memberships: [{ tenant_id: T, role: 'admin' }],
  });
  state.row = null;
  state.rowError = null;
  state.sets = null;
  state.rpcCalls = [];
  state.rpcResult = null;
  state.signError = null;
  state.calls = [];
  state.publicUrlCalls = 0;
  state.signArgs = [];
  state.buckets = [];
  toastMock.mockClear();
});

// ------------------------------------------------------------ the stages --

describe('fix-285 the card renders each stage with its own chip', () => {
  // ★★★ SUPERSEDED BY fix-522 §A (P-217) — THE CHIP NAMES WHAT IS ON SCREEN.
  //
  //     fix-285 had it name the STAGE, which was right while a stage had one
  //     document. Marketing has two — a Site Plan and a Marketing set, chosen
  //     by two buttons — and BOTH rows are `set_type = 'marketing'`, so the
  //     chip read `MARKETING` in both states. Bobby: *"right now it is
  //     displaying site plan (marketing internal) but if i click marketing, it
  //     should show marketing external."* "Marketing" was doing double duty as
  //     a set type AND a variant label, so pressing *Site Plan* changed nothing
  //     above the drawing and nothing confirmed the switch.
  //
  // ★★ THE OTHER TWO STAGES ARE UNCHANGED, which is the tell that this is a
  //    narrowing rather than a rewrite: they have one button each, so the
  //    button's label and the stage's name are the same word.
  //
  // ★ The chip's TESTID still carries the stage — the element four suites
  //   reach for has not moved.
  it.each([
    ['marketing', 'Site Plan'],
    ['schematic', 'Schematic'],
    ['design_guidance', 'Design Guidance'],
  ] as const)('%s', async (setType, label) => {
    state.row = row({ set_type: setType });
    renderCard();
    const chip = await screen.findByTestId(`plan-of-record-stage-${setType}`);
    expect(chip).toHaveTextContent(label);
  });

  // ★★★ SUPERSEDED BY fix-467 §3 (P-113), NOT MISTAKEN. This assertion used to
  //     read `expect(seen.size).toBe(3)` — three chips, three distinct styles.
  //     Bobby: *"I dont think we need color for schematic, design guidance or
  //     marketing."*
  //
  // ★★★ AND THE REASON IS STRUCTURAL, WHICH IS WHY THE INVERSION IS SAFE. The
  //     test above it — *"does NOT re-derive which stage wins — it renders the
  //     row it is given"* — is the proof: fix-284 applies precedence in the
  //     VIEW and this card renders ONE row. **The three colours therefore never
  //     appeared beside one another anywhere in the app.** A colour never
  //     adjacent to its alternatives distinguishes nothing; it was a key the
  //     reader had to learn and then apply from memory, two millimetres from
  //     the stage printed in words.
  //
  // ★★ WHAT SURVIVES, AND IS NOW WHAT THIS TEST DEFENDS: the chip is still
  //    there, still per stage, still carrying the label — only the hue is gone,
  //    and all three now render IDENTICALLY, which is the new claim.
  it('fix-467 §3: the three chips are neutral — and identical to one another', async () => {
    const seen = new Set<string>();
    for (const setType of ['marketing', 'schematic', 'design_guidance'] as const) {
      state.row = row({ set_type: setType });
      const { unmount } = renderCard();
      const chip = await screen.findByTestId(`plan-of-record-stage-${setType}`);
      const style = chip.getAttribute('style') ?? '';
      seen.add(style);
      // ★ THE PROPERTY: no value from STAGE_CHIP reaches the card. Checked
      //   against the real constant rather than against three hard-coded
      //   hexes, so re-tinting it any colour fails here.
      for (const { bg, fg } of Object.values(STAGE_CHIP)) {
        expect(style).not.toContain(bg);
        expect(style).not.toContain(fg);
      }
      unmount();
    }
    expect(seen.size).toBe(1);
  });

  it('fix-467 §3: STAGE_CHIP still EXISTS and is still exported — it is just not painted', async () => {
    // ★★★ THE OTHER HALF OF THE RULING, AND THE EASY MISTAKE. fix-407 derived
    //     all three tints and proved each clears 4.5:1 on its own surface
    //     (6.47 / 5.21 / 4.68). **None of that was wrong.** What changed is not
    //     the measurement's correctness but what the value was FOR — so the
    //     derivation stays exported, with its own suite intact, and the next
    //     person to want a stage colour finds the numbers instead of
    //     re-deriving them. Deleting it would have been the wrong fix passing
    //     the same tests.
    expect(Object.keys(STAGE_CHIP).sort()).toEqual([
      'design_guidance',
      'marketing',
      'schematic',
    ]);
    for (const v of Object.values(STAGE_CHIP)) {
      expect(v.bg).toMatch(/^#[0-9a-f]{6}$/i);
      expect(v.fg).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(Object.keys(STAGE_CHIP_MIX)).toHaveLength(3);
    expect(CHIP_INK_HUE_PCT).toBe(65);
  });

  it('does NOT re-derive which stage wins — it renders the row it is given', async () => {
    // A schematic row on a project that also has marketing would be a fix-284
    // question. The card must not second-guess the view.
    state.row = row({ set_type: 'schematic', stage_rank: 2 });
    renderCard();
    expect(await screen.findByTestId('plan-of-record-stage-schematic'))
      .toBeInTheDocument();
    expect(screen.queryByTestId('plan-of-record-stage-marketing')).toBeNull();
  });
});

// ------------------------------------------------------------- file detail --

describe('fix-285 the file card', () => {
  // ★★ SUPERSEDED BY fix-331 §2, inverted here rather than deleted so the file
  // cannot go on claiming a contract the card no longer has.
  //
  // fix-285 put the filename and the Modified/size line on the card FACE. Bobby
  // highlighted all of it: "It should just be, here's the marketing, click to
  // enlarge, copy path, that's it. And when you click to enlarge, we can have
  // that text inside of there." The information is NOT gone — the test below
  // this one proves the enlarged view carries all three.
  it('★ fix-331 §2: the card face shows no filename, date or size', async () => {
    state.row = row();
    renderCard();
    await screen.findByTestId('plan-of-record-set-internal');
    expect(screen.queryByTestId('plan-of-record-filename')).toBeNull();
    expect(screen.queryByTestId('plan-of-record-meta')).toBeNull();
    const card = screen.getByTestId('plan-of-record-card');
    expect(card.textContent ?? '').not.toContain('10044 - Plan Set');
    expect(card.textContent ?? '').not.toContain('17 MB');
    // ★★★ THE DATE COMES BACK, AND BOBBY PUT IT THERE. fix-331 §2 took all
    //     three off the face — *"here's the marketing, click to enlarge, copy
    //     path, that's it"* — and v14's caption is explicit: `Marketing plan
    //     (internal) · <date> · N pages`. The FILENAME and SIZE, which are what
    //     he actually highlighted as noise, are still off it; a modified date
    //     is how you tell a current plan from a stale one at a glance, which is
    //     the job of a caption under a picture.
    expect(screen.getByTestId('plan-of-record-set-caption').textContent ?? '')
      .toMatch(/Jun 18, 2026/);
    expect(screen.getByTestId('plan-of-record-set-caption').textContent ?? '')
      .toMatch(/1 page/);
  });

  // ★ MOVED, NOT DELETED — the other half of §2, and the half that makes the
  // removal above safe.
  it('★ fix-331 §2: the ENLARGED view carries all three', async () => {
    state.row = row();
    renderCard();
    fireEvent.click(await screen.findByTestId('plan-of-record-preview'));
    const dialog = screen.getByTestId('plan-of-record-lightbox');
    expect(dialog).toHaveTextContent('10044 - Plan Set - Marketing Update 260618.pdf');
    expect(dialog).toHaveTextContent('Jun 18, 2026');
    expect(dialog).toHaveTextContent('17 MB');
  });

  // ★ fix-295: the path is OFF the card face. It wrapped to three or four
  // lines and was the tallest single element on the card -- a third of its
  // height spent on a string nobody acts on. The room went to the preview.
  it('does NOT show the UNC path on the card face', async () => {
    state.row = row();
    renderCard();
    await screen.findByTestId('plan-of-record-set-internal');
    expect(screen.queryByTestId('plan-of-record-path')).toBeNull();
    // ...and the card does not smuggle it back in as loose text.
    expect(screen.queryByText(UNC)).toBeNull();
  });

  // It is moved, not deleted -- the lightbox has room, and somebody who has
  // deliberately opened the file is far likelier to want it.
  it('shows the FULL UNC path inside the lightbox, selectable and monospace', async () => {
    state.row = row();
    renderCard();
    fireEvent.click(await screen.findByTestId('plan-of-record-preview'));
    const path = screen.getByTestId('plan-of-record-lightbox-path');
    expect(path.textContent).toBe(UNC);
    expect(path.className).toContain('font-mono');
    expect(path.className).toContain('select-all');
  });

  // ★ fix-331 §2: the loose "paste into File Explorer to open" hint beside the
  // button was the third thing Bobby highlighted. The instruction survives on
  // the button's own title, so nobody who wonders what Copy path is for is left
  // guessing — it just no longer spends a line of a card whose height every
  // other card in the row has to match.
  it('★★★ SUPERSEDED by fix-506 §E: the face is two set buttons, not Copy path', async () => {
    // ★★★ THE BRIEF: *"Delete Copy path as a control; keep the UNC path visible
    //     in the viewer footer (fix-295's rule) for staff."* The card face is
    //     Bobby's v14 pair — **Marketing · Internal** and **Marketing ·
    //     External**, the picked one blue, a share glyph at each right end.
    //
    // ★★ fix-289's FINDING IS UNTOUCHED AND STILL THE REASON THE PATH MATTERS:
    //    Chrome and Edge silently refuse to navigate an https page to a `file:`
    //    URL or a UNC path, so copying is the one thing that reliably works and
    //    an "Open" button must never come back. The test below still asserts
    //    that. What moved is WHERE the path lives — the enlarged view, one
    //    click away, beside the rest of the file's facts.
    state.row = row();
    renderCard();
    const internal = await screen.findByTestId('plan-of-record-set-internal');
    // ★ fix-508 §H (P-186) renamed the pair: `Marketing · Internal` → **Site
    //   Plan**, `Marketing · External` → **Marketing**. The face is still two
    //   set buttons and still not `Copy path`, which is what this test is for.
    expect(internal.textContent).toBe('Site Plan');
    expect(internal.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('plan-of-record-set-external')).toBeInTheDocument();
    expect(screen.queryByTestId('plan-of-record-copy')).toBeNull();
    expect(screen.queryByTestId('plan-of-record-copy-hint')).toBeNull();
  });

  // ★★★ SUPERSEDED BY fix-523 §B2 (P-239), AND ITS PREMISE IS THE PART THAT
  //     EXPIRED. This asserted *"External is DISABLED until the indexer writes
  //     its pages"* on the strength of `project_plan_of_record_sets` being
  //     ABSENT from prod. It landed with fix-504 and carries 334 rows, all of
  //     them `pages_status = 'ok'` (measured 2026-09-11), so the branch this
  //     test called *"the one that actually runs today"* runs for nothing.
  //
  // ★★★ AND THE GUARD IT PINNED WAS ONE-SIDED. `b.variant === 'external' &&
  //     !externalReady` names one direction, so it can only ever ask about one:
  //     the 74 external-only projects rendered a live Site Plan with nothing
  //     behind it, against 5 internal-only ones where the guard fired. **Same
  //     assertion, arguments swapped** is the replacement, because a one-sided
  //     guard that only ever gets a one-sided test is how this class keeps
  //     shipping.
  it('★★★ fix-523 §B2: the empty button grays — in BOTH directions', async () => {
    const marketing = (variant: string) => ({
      project_id: PROJECT_ID,
      set_type: 'marketing',
      variant,
      page_count: variant === 'external' ? 6 : 1,
      pages_status: 'ok',
      pages_prefix: `${PROJECT_ID}/marketing_${variant}/`,
      is_archived_fallback: false,
      thumb_path: `${PROJECT_ID}/marketing_${variant}.jpg`,
      thumb_status: 'ok',
      file_name: `3505 - Marketing - ${variant}.pdf`,
    });

    // ── the 5: Site Plan only ────────────────────────────────────────────
    state.row = row();
    state.sets = [marketing('internal')];
    const first = renderCard();
    expect(
      ((await screen.findByTestId('plan-of-record-set-external')) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId('plan-of-record-set-internal') as HTMLButtonElement).disabled,
    ).toBe(false);
    first.unmount();

    // ── the 74: Marketing only. SAME ASSERTION, ARGUMENTS SWAPPED. ───────
    state.sets = [marketing('external')];
    renderCard();
    expect(
      ((await screen.findByTestId('plan-of-record-set-internal')) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId('plan-of-record-set-external') as HTMLButtonElement).disabled,
    ).toBe(false);
    // ★ …and the card OPENS on the button that works, rather than on a grayed
    //   Site Plan with the live control unpicked beside it.
    expect(
      screen.getByTestId('plan-of-record-set-external').getAttribute('aria-pressed'),
    ).toBe('true');

    // ★★★ AND THE SHARE GLYPH BESIDE THE GRAY BUTTON IS **GONE**, by the same
    //     guard. Bobby's screenshot of `5947 32ND AVE SW` shows one rendered
    //     beside a gray Marketing button, reading as an offer. **A set you
    //     cannot open is a set you cannot share** — and `bp_create_plan_share`
    //     raises `P0002` when no current set matches, so the UI was able to
    //     reach a call that could only fail.
    expect(screen.queryByTestId('plan-of-record-set-internal-share')).toBeNull();
    expect(screen.getByTestId('plan-of-record-set-external-share')).toBeInTheDocument();

    // ★★ Clicking the gray button opens neither a viewer nor a menu.
    fireEvent.click(screen.getByTestId('plan-of-record-set-internal'));
    expect(
      screen.getByTestId('plan-of-record-set-external').getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.queryByTestId('plan-of-record-set-internal-share-menu')).toBeNull();
    expect(screen.queryByTestId('plan-of-record-lightbox')).toBeNull();

    // ⚠⚠ AND NO EXPLANATORY TEXT. Ruled 2026-09-11: *"just dont make it
    //    clickable if it isnt available… adding that additional text makes it
    //    more busy."* The gray IS the message.
    expect(screen.queryByText(/External pages arrive/i)).toBeNull();
    expect(screen.queryByText(/no set available/i)).toBeNull();
    expect(
      screen.getByTestId('plan-of-record-set-internal').getAttribute('title'),
    ).toBeNull();
  });

  // ★★★ SUPERSEDED BY fix-523 §A (P-187) — THE LINK IS A ROUTE NOW.
  //
  //     This asserted that Copy link signs ONE PAGE OBJECT in the private
  //     bucket for `SHARE_TTL_SECONDS`. That was fix-506's ruling and it was
  //     right for a ticket with no table, no RPC and no route — P-187 is the
  //     complaint that the result is *"one page and unpresentable"*, 500-odd
  //     characters of query string carrying one sheet out of a set.
  //
  // ★★★ WHAT THE ASSERTION WAS PROTECTING IS UNCHANGED AND IS ALL STILL HERE:
  //     thirty days from one constant, no login, and the bucket still private —
  //     `getPublicUrl` is still never called. What moved is that the SERVER
  //     mints the credential (`bp_create_plan_share`, `authenticated` only) and
  //     the browser hands over `/s/<token>` instead of a signature.
  it('★★★ fix-523 §A: Copy link hands over /s/<token>, not a signed object', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    state.row = row();
    state.rpcResult = [{ token: 'a7Kd92xQ', expires_at: '2026-10-11T00:00:00Z' }];
    renderCard();
    fireEvent.click(await screen.findByTestId('plan-of-record-set-internal-share'));
    fireEvent.click(await screen.findByTestId('plan-of-record-set-internal-share-copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());

    // ★★★ §A4: minted on the PICK, and by the RPC — never on the menu opening,
    //     which would write a row every time a card was looked at.
    const mint = state.rpcCalls.filter(([n]) => n === 'bp_create_plan_share');
    expect(mint).toHaveLength(1);
    expect(mint[0][1]).toMatchObject({
      p_project_id: PROJECT_ID,
      p_set_type: 'marketing',
      p_variant: 'internal',
    });
    // ★ No `p_ttl_days`: the RPC defaults to 30 and caps at 90, and a client
    //   sending its own number is a second place for the copy and the expiry to
    //   disagree.
    expect(mint[0][1]).not.toHaveProperty('p_ttl_days');

    const url = String(writeText.mock.calls[0][0]);
    expect(url).toContain('/s/a7Kd92xQ');
    // ★★★ §A5: A TOKEN AND NOTHING ELSE. No project id, no set id, no address.
    expect(url).not.toContain(PROJECT_ID);
    expect(url).not.toMatch(/marketing/i);

    // ★★ NOTHING WAS SIGNED **FOR THE SHARE**, and the bucket is still
    //    private. The card face still signs its own thumbnail for the person
    //    looking at it — that is a logged-in read at the preview's own short
    //    TTL — so the assertion is that no signature was minted at the SHARE
    //    TTL, which is the one a recipient would have been handed.
    expect(state.signArgs.map(([, ttl]) => ttl)).not.toContain(SHARE_TTL_SECONDS);
    expect(state.publicUrlCalls).toBe(0);
    // ★ Thirty days, still one constant, still saying "no login".
    expect(SHARE_TOAST).toContain(String(SHARE_TTL_DAYS));
    expect(SHARE_TOAST).toMatch(/no login/i);
  });

  // =========================================================================
  // ★★★ fix-525 §A (P-241) — THE CARD'S OWN SHARE ICON, CLICKED WHERE BOBBY
  //     CLICKS IT
  // =========================================================================
  //
  // Bobby, 2026-09-11: *"the share icon still doesnt open with options."*
  // Measured in his browser: no menu in the accessibility tree, no network
  // call, no console error. **Nothing fired at all.**
  //
  // ★★★ AND IT WAS NEVER A HANDLER. The menu mounted every time. It was
  //     rendered `absolute … top-full` INSIDE `SetButton`'s frame, which has
  //     carried `overflow-hidden` since fix-506 — and inside `OverviewCard`'s
  //     root, which has carried it since fix-290. `top-full` puts the menu
  //     entirely below the frame's content box, so it was clipped to nothing by
  //     two separate ancestors. **The control has never opened in a browser**,
  //     which makes this a fix-522 defect, not a fix-523 regression.
  //
  // ★★★ WHY THE SUITE MISSED IT, AND WHAT CHANGED: fix-523's test DID click
  //     this icon and DID find the item — because **jsdom has no layout engine
  //     and cannot see clipping** (fix-417 banked exactly that). Clicking
  //     harder would never have caught it. The assertion that does is
  //     structural: the menu must not have a clipping ancestor.
  function clippingAncestors(el: HTMLElement | null): string[] {
    const out: string[] = [];
    for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
      if (n.className && String(n.className).includes('overflow-hidden')) {
        out.push(String(n.className));
      }
    }
    return out;
  }

  it.each(['internal', 'external'] as const)(
    '★★★ fix-525 §A: the %s button’s share icon opens a menu with its items',
    async (variant) => {
      // ★★ BOTH BUTTONS, because fix-523 §B2 made one of them conditional —
      //    the glyph is absent beside a set that does not exist, so a test that
      //    only ever presses `internal` cannot tell "no menu" from "no button".
      state.row = row();
      state.sets = [marketingSet('internal'), marketingSet('external')];
      renderCard();
      fireEvent.click(
        await screen.findByTestId(`plan-of-record-set-${variant}-share`),
      );
      const menu = await screen.findByTestId(
        `plan-of-record-set-${variant}-share-menu`,
      );
      expect(menu).toBeInTheDocument();
      expect(menu.getAttribute('role')).toBe('menu');
      expect(
        screen.getByTestId(`plan-of-record-set-${variant}-share-copy`),
      ).toBeInTheDocument();
      // ★ fix-528 §A/§B: `Email it…` is gone and **Download PDF** is the second
      //   item. The mailto carried a LINK, which is the thing Bobby complained
      //   about four times; the Graph draft that carries an attachment is
      //   behind an IT gate (§A4) and is not built, so the item is ABSENT
      //   rather than dead.
      expect(
        screen.queryByTestId(`plan-of-record-set-${variant}-share-email`),
      ).toBeNull();
      expect(
        screen.getByTestId(`plan-of-record-set-${variant}-share-download`),
      ).toBeInTheDocument();

      // ★★★ THE ASSERTION THAT WOULD HAVE CAUGHT IT. jsdom cannot see the
      //     clipping, so the test asks about the ANCESTRY instead.
      expect(clippingAncestors(menu)).toEqual([]);
      // ★★ And the strongest form of that: it is not inside the card at all.
      expect(
        screen.getByTestId('plan-of-record-card').contains(menu),
      ).toBe(false);
    },
  );

  it('★★★ fix-525 §A: the LIGHTBOX share is a SEPARATE control, asserted separately', async () => {
    // ★★★ *"Two controls, two tests — this is the whole lesson of P-241."* The
    //     Lightbox share DID fire in Bobby's browser (it is what produced the
    //     `expires_at` server error), and the card's did not. They were
    //     verified as one thing and they are not one thing: this one is a plain
    //     button in a fixed-position dialog with nothing clipping it.
    state.row = row();
    state.sets = [marketingSet('internal')];
    state.rpcResult = [{ token: 'a7Kd92xQrTvB', expires_at: '2026-10-11T00:00:00Z' }];
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderCard();
    fireEvent.click(await screen.findByTestId('plan-of-record-preview'));
    const share = await screen.findByTestId('plan-of-record-lightbox-share');
    // ★★ IT IS IN FLOW, which is why it survived where the card's did not. A
    //    clipping ancestor only destroys an element that has been taken OUT of
    //    the flow — this one is a plain button laid out inside the dialog, so
    //    the panel's own `overflow-hidden` cannot swallow it. That difference,
    //    and not a handler, is the entire distance between the two controls.
    expect(String(share.className)).not.toContain('absolute');
    expect(share.tagName).toBe('BUTTON');
    fireEvent.click(share);
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(
      state.rpcCalls.filter(([n]) => n === 'bp_create_plan_share'),
    ).toHaveLength(1);
  });

  it('★★ fix-525 §A: picking an item still reaches its handler through the portal', async () => {
    // ★★★ THE TRAP THE PORTAL INTRODUCES, GUARDED. The outside-click handler
    //     closes on any mousedown outside `wrapRef` — and a portaled menu is
    //     outside it. Without checking the menu's own ref too, mousedown would
    //     unmount the item before its `click` fired: the menu would open, look
    //     right, and do nothing when pressed. Which is the bug this section is
    //     about, reintroduced one layer down.
    state.row = row();
    state.sets = [marketingSet('internal')];
    state.rpcResult = [{ token: 'a7Kd92xQrTvB', expires_at: '2026-10-11T00:00:00Z' }];
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderCard();
    fireEvent.click(await screen.findByTestId('plan-of-record-set-internal-share'));
    const copy = await screen.findByTestId('plan-of-record-set-internal-share-copy');
    fireEvent.mouseDown(copy);
    expect(
      screen.queryByTestId('plan-of-record-set-internal-share-menu'),
    ).toBeInTheDocument();
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalled());
  });

  // ★ fix-289: the whole point of the ticket. Chrome and Edge silently refuse
  // to navigate from https to file:/UNC, so a button offering it does nothing
  // when clicked. These two assertions are what stop it being reintroduced.
  it('offers NO Open button and NO "Show in folder" button', async () => {
    state.row = row();
    renderCard();
    await screen.findByTestId('plan-of-record-set-internal');
    expect(screen.queryByTestId('plan-of-record-open')).toBeNull();
    expect(screen.queryByTestId('plan-of-record-folder')).toBeNull();
    expect(screen.queryByText('Open')).toBeNull();
    // ★ fix-506 §E: nor does the SHARE control offer one — it copies a signed
    //   https URL, never a path the browser cannot follow.
    expect(screen.queryByText(/show in folder/i)).toBeNull();
  });

  it('renders no link to a file: URL or a UNC path anywhere in the card', async () => {
    state.row = row();
    const { container } = renderCard();
    await screen.findByTestId('plan-of-record-set-internal');
    for (const a of Array.from(container.querySelectorAll('a[href]'))) {
      const href = a.getAttribute('href') ?? '';
      expect(href.toLowerCase().startsWith('file:')).toBe(false);
      expect(href.startsWith('\\\\')).toBe(false);
    }
  });
});

// ------------------------------------------------------------ empty state --

// ★★★ fix-358 SPLIT THIS ONE STATE INTO THREE, and that split is the ticket.
//
// fix-285 had a single empty state — "No design set on file yet" — for every
// project with no file row. fix-356 then computed the REASONING and showed that
// the one state was covering three different facts:
//
//     the indexer chose a set          -> the body, unchanged
//     it looked and nothing qualified  -> "No approved design set filed" + why
//     it has not walked this project   -> "Not indexed yet"
//
// ★★ The last two are the pair the brief refuses to let render identically:
// "this project has no design set" and "the tool has no opinion" are different
// statements, and 19 projects are in the second — four of them live projects
// carrying 3 to 9 permits. Telling those "no design set filed" accuses the team
// of not filing something they filed.
//
// ★ So these four tests keep their SUBJECT (a project with no file row is a
// real case, says so plainly, offers no controls, and never reads like an
// error) and change the state they assert on. The old wording is gone because
// it was the conflation.
describe('fix-285 -> fix-358: no file row, and the tool has not looked', () => {
  it('renders the NOT-INDEXED state, not a blank card', async () => {
    state.row = null;
    renderCard();
    const empty = await screen.findByTestId('plan-of-record-not-indexed');
    expect(empty).toHaveTextContent('Not indexed yet');
  });

  it('★ says what is actually true — nobody has looked', async () => {
    state.row = null;
    renderCard();
    const empty = await screen.findByTestId('plan-of-record-not-indexed');
    expect(empty.textContent).toMatch(/has not walked/i);
    // ★★ And it makes no CLAIM about what has been filed — that claim is the
    // accusation this state exists to avoid. It says the opposite outright,
    // which is why the assertion is on the claim rather than on the word.
    expect(empty.textContent).not.toMatch(/no design set/i);
    expect(empty.textContent).not.toMatch(/(nothing|no set) has been filed/i);
    expect(empty.textContent).toMatch(/not a statement about what has been filed/i);
  });

  it('shows no chip, no path and no actions', async () => {
    state.row = null;
    renderCard();
    await screen.findByTestId('plan-of-record-not-indexed');
    expect(screen.queryByTestId('plan-of-record-copy')).toBeNull();
    expect(screen.queryByTestId('plan-of-record-preview')).toBeNull();
  });

  it('does not read like an error', async () => {
    state.row = null;
    renderCard();
    const empty = await screen.findByTestId('plan-of-record-not-indexed');
    expect(empty.textContent?.toLowerCase()).not.toContain('error');
    expect(empty.textContent?.toLowerCase()).not.toContain('failed');
  });
});

// -------------------------------------------------------- missing thumbnail --

describe('fix-285 a missing thumbnail degrades to the file card', () => {
  it('a failed render shows the file card, never a broken image', async () => {
    state.row = row({ thumb_status: 'failed', thumb_path: null });
    renderCard();
    await screen.findByTestId('plan-of-record-no-preview');
    expect(screen.queryByTestId('plan-of-record-preview-img')).toBeNull();
    // ★ fix-331 §2: the filename and meta line are no longer on the face, so
    // what has to survive a failed render is the REASON and Copy path.
    expect(screen.getByTestId('plan-of-record-no-preview').textContent ?? '')
      .not.toBe('');
    // ★★★ fix-506 §E: Copy path left the face, so what has to survive a failed
    //     render is the SET PICKER — the route to the enlarged view, which is
    //     where the selectable UNC path now lives (fix-295's rule, one click
    //     further in). A card whose thumbnail failed must still get a person to
    //     the file.
    expect(screen.getByTestId('plan-of-record-set-internal')).toBeInTheDocument();
  });

  it('a not-yet-generated thumbnail says so plainly', async () => {
    state.row = row({ thumb_status: null, thumb_path: null });
    renderCard();
    const note = await screen.findByTestId('plan-of-record-no-preview');
    expect(note).toHaveTextContent(/next file-server index/i);
  });

  it('a status of ok with no path still degrades rather than rendering empty src', async () => {
    state.row = row({ thumb_status: 'ok', thumb_path: null });
    renderCard();
    await screen.findByTestId('plan-of-record-no-preview');
    expect(screen.queryByTestId('plan-of-record-preview-img')).toBeNull();
  });

  it('a failed SIGNING also degrades, and shows no broken image', async () => {
    state.row = row();
    state.signError = { message: 'Object not found' };
    renderCard();
    await screen.findByTestId('plan-of-record-no-preview');
    expect(screen.queryByTestId('plan-of-record-preview-img')).toBeNull();
  });

  it('never renders an img with an empty src', async () => {
    for (const over of [
      { thumb_status: 'failed' as const, thumb_path: null },
      { thumb_status: null, thumb_path: null },
    ]) {
      state.row = row(over);
      const { unmount } = renderCard();
      await screen.findByTestId('plan-of-record-no-preview');
      for (const img of Array.from(document.querySelectorAll('img'))) {
        expect(img.getAttribute('src')).toBeTruthy();
      }
      unmount();
    }
  });
});

// --------------------------------------------------------------- lightbox --

describe('fix-285 the lightbox', () => {
  it('opens on clicking the preview and closes again', async () => {
    state.row = row();
    renderCard();
    fireEvent.click(await screen.findByTestId('plan-of-record-preview'));
    expect(screen.getByTestId('plan-of-record-lightbox')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('plan-of-record-lightbox-close'));
    expect(screen.queryByTestId('plan-of-record-lightbox')).toBeNull();
  });

  it('closes on clicking the backdrop', async () => {
    // ★★★ fix-440 (P-057): THIS STAYS. Bobby's narrowed ruling exempts a
    //     VIEWER — "this is just stale text". There is nothing here to lose:
    //     a file name, a thumbnail and a verdict already written down
    //     elsewhere. Only overlays holding UNSAVED INPUT went inert.
    state.row = row();
    renderCard();
    fireEvent.click(await screen.findByTestId('plan-of-record-preview'));
    fireEvent.click(screen.getByTestId('plan-of-record-lightbox'));
    expect(screen.queryByTestId('plan-of-record-lightbox')).toBeNull();
  });

  it('★★★ fix-440: Escape closes it WITHOUT clicking into it first', async () => {
    // ★★★ IT NEVER DID. The handler was an `onKeyDown` on a
    //     `role="presentation"` div with no `tabIndex` — a div that cannot take
    //     focus never receives a keydown, so it was dead from the day it was
    //     written. The only way to fire it was to Tab into a control INSIDE the
    //     panel first, and by then the event target is that control.
    //
    // ★ So this presses Escape on the DOCUMENT with nothing focused, which is
    //   exactly how somebody meets a lightbox they opened from a thumbnail.
    state.row = row();
    renderCard();
    fireEvent.click(await screen.findByTestId('plan-of-record-preview'));
    expect(screen.getByTestId('plan-of-record-lightbox')).toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByTestId('plan-of-record-lightbox')).toBeNull(),
    );
  });

  it('★ …and the listener is removed when it closes, so a second Escape is inert', async () => {
    state.row = row();
    renderCard();
    fireEvent.click(await screen.findByTestId('plan-of-record-preview'));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByTestId('plan-of-record-lightbox')).toBeNull(),
    );
    // Nothing to throw and nothing to reopen — the effect's cleanup ran.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('plan-of-record-lightbox')).toBeNull();
  });

  it('names the file and says which page is shown', async () => {
    state.row = row();
    renderCard();
    fireEvent.click(await screen.findByTestId('plan-of-record-preview'));
    const lb = screen.getByTestId('plan-of-record-lightbox');
    expect(lb).toHaveTextContent('10044 - Plan Set - Marketing Update 260618.pdf');
    expect(lb).toHaveTextContent('Page 1');
  });

  it('does not invent a page COUNT it does not have', async () => {
    // The mockup showed "page 1 of 12". The view carries no page count, so
    // claiming one would be fabricating data.
    state.row = row();
    renderCard();
    fireEvent.click(await screen.findByTestId('plan-of-record-preview'));
    const lb = screen.getByTestId('plan-of-record-lightbox');
    expect(lb.textContent).not.toMatch(/page\s*1\s*of\s*\d+/i);
  });

  it('is not reachable when there is no preview to enlarge', async () => {
    state.row = row({ thumb_status: 'failed', thumb_path: null });
    renderCard();
    await screen.findByTestId('plan-of-record-no-preview');
    expect(screen.queryByTestId('plan-of-record-preview')).toBeNull();
    expect(screen.queryByTestId('plan-of-record-lightbox')).toBeNull();
  });
});

// ------------------------------------------------------ ★ security posture --

describe('fix-285 thumbnails are SIGNED, never public', () => {
  it('mints a signed URL and renders it', async () => {
    state.row = row();
    renderCard();
    const img = await screen.findByTestId('plan-of-record-preview-img');
    expect(img.getAttribute('src')).toBe(state.signedUrl);
    expect(state.calls).toContain('createSignedUrl');
  });

  it('★ never calls getPublicUrl', async () => {
    state.row = row();
    renderCard();
    await screen.findByTestId('plan-of-record-preview-img');
    expect(state.publicUrlCalls).toBe(0);
    expect(state.calls).not.toContain('getPublicUrl');
  });

  it('★ no public storage URL is ever constructed in the markup', async () => {
    state.row = row();
    renderCard();
    await screen.findByTestId('plan-of-record-preview-img');
    expect(document.body.innerHTML).not.toContain('/object/public/');
  });

  it('signs against the private bucket, with a bounded lifetime', async () => {
    state.row = row();
    renderCard();
    await screen.findByTestId('plan-of-record-preview-img');
    expect(state.buckets).toContain('plan-thumbnails');
    const [path, ttl] = state.signArgs[0];
    expect(path).toBe(`${PROJECT_ID}/marketing.jpg`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60 * 60);
  });
});

describe('fix-285 the card is READ ONLY', () => {
  it('offers no upload, replace or delete control', async () => {
    state.row = row();
    renderCard();
    await screen.findByTestId('plan-of-record-set-internal');
    const card = screen.getByTestId('plan-of-record-card');
    expect(card.querySelector('input[type="file"]')).toBeNull();
    for (const word of [/upload/i, /replace/i, /delete/i, /remove/i, /edit/i]) {
      expect(card.textContent ?? '').not.toMatch(word);
    }
  });

  it('issues no write against project_file_index or the bucket', async () => {
    state.row = row();
    renderCard();
    await screen.findByTestId('plan-of-record-preview-img');
    fireEvent.click(screen.getByTestId('plan-of-record-preview'));
    fireEvent.click(screen.getByTestId('plan-of-record-lightbox-close'));
    for (const forbidden of ['insert', 'update', 'upsert', 'delete', 'upload', 'remove']) {
      expect(state.calls.some((c) => c.startsWith(forbidden))).toBe(false);
    }
  });

  it('reads from the view, not the underlying table', async () => {
    state.row = row();
    renderCard();
    await screen.findByTestId('plan-of-record-set-internal');
    expect(state.calls).toContain('from:project_plan_of_record');
    expect(state.calls).not.toContain('from:project_file_index');
  });
});

describe('fix-285 a failed row fetch stays calm', () => {
  it('shows a retry rather than an exception', async () => {
    state.rowError = { message: 'network' };
    renderCard();
    const err = await screen.findByTestId('plan-of-record-error');
    expect(err).toHaveTextContent(/could not be loaded/i);
    expect(screen.getByTestId('plan-of-record-retry')).toBeInTheDocument();
  });
});

// ------------------------------------------------------------- fix-295 -----

// The card works; it was too small to do its job and spent a third of its
// height on a string nobody reads. Three changes: drop the path from the face,
// enlarge the preview, and enlarge the lightbox WITHOUT upscaling the image.

describe('fix-295 the path moved off the card face', () => {
  it('★★★ SUPERSEDED: the FULL UNC path is in the viewer, selectable', async () => {
    // ★★★ fix-295's RULE IS THE ONE THAT SURVIVES: staff need the real path,
    //     because fix-289 established a browser will not navigate to it and
    //     copying is the only thing that works. fix-506 §E deletes the BUTTON
    //     and keeps the path — in the enlarged view, `select-all` and
    //     monospace, beside the rest of the file's facts.
    state.row = row();
    renderCard();
    fireEvent.click(await screen.findByTestId('plan-of-record-preview'));
    const path = screen.getByTestId('plan-of-record-lightbox-path');
    expect(path.textContent).toBe(UNC);
    expect(path.className).toContain('select-all');
  });

  it('still offers no Open or Show in folder (fix-289 stays fixed)', async () => {
    state.row = row();
    renderCard();
    await screen.findByTestId('plan-of-record-set-internal');
    expect(screen.queryByTestId('plan-of-record-open')).toBeNull();
    expect(screen.queryByTestId('plan-of-record-folder')).toBeNull();
  });
});

describe('fix-295 the enlarge is capped by the render, not by the viewport', () => {
  /** Fire a load event carrying a natural width, the way a real bitmap would. */
  function loadWith(img: HTMLElement, naturalWidth: number) {
    Object.defineProperty(img, 'naturalWidth', {
      value: naturalWidth,
      configurable: true,
    });
    fireEvent.load(img);
  }

  // ★ THE ASSERTION THE BRIEF ASKS FOR. The thumbnails come from the scraper
  // (file_indexer/thumbnails.py, MAX_WIDTH = 900). Displaying one wider than
  // its source upscales a JPEG, so the enlarge gets bigger and LESS readable --
  // the opposite of the request. This is what stops a future change quietly
  // reintroducing that.
  it('never renders the image wider than its natural width', async () => {
    state.row = row();
    renderCard();
    fireEvent.click(await screen.findByTestId('plan-of-record-preview'));
    const img = screen.getByTestId('plan-of-record-lightbox-img');
    loadWith(img, 900);
    expect(img.style.maxWidth).toBe('900px');
  });

  // Read from the loaded bitmap rather than hardcoded, so when the companion
  // scraper ticket raises MAX_WIDTH and re-renders, the lightbox widens on its
  // own with no change here.
  it('follows the source width rather than a hardcoded 900', async () => {
    state.row = row();
    renderCard();
    fireEvent.click(await screen.findByTestId('plan-of-record-preview'));
    const img = screen.getByTestId('plan-of-record-lightbox-img');
    loadWith(img, 1600);
    expect(img.style.maxWidth).toBe('1600px');
  });

  it('sets no cap before the image has loaded, rather than guessing one', async () => {
    state.row = row();
    renderCard();
    fireEvent.click(await screen.findByTestId('plan-of-record-preview'));
    expect(
      screen.getByTestId('plan-of-record-lightbox-img').style.maxWidth,
    ).toBe('');
  });

  it('applies no transform, filter or zoom to fake extra resolution', async () => {
    state.row = row();
    renderCard();
    fireEvent.click(await screen.findByTestId('plan-of-record-preview'));
    const img = screen.getByTestId('plan-of-record-lightbox-img');
    loadWith(img, 900);
    expect(img.style.transform).toBe('');
    expect(img.style.filter).toBe('');
    expect(img.style.imageRendering).toBe('');
  });
});

// ===========================================================================
// ★★ fix-335 §6 — the card's content is centred vertically
// ===========================================================================
//
// Bobby: "We're okay with that empty white space. The only thing we might ask
// is, can we center the design plan of record so it's vertically spaced in that
// area? So if there is some open white space, it moves down so it doesn't look
// like there's a ton of opening. And that way we don't really have to mess with
// the vertical height adjustment based on all the different monitors."
//
// ★★ THIS RETIRES THE CARD-HEIGHT WORK (#93, the old fix-334). He chose it as
// the simpler route and confirmed the column heights are already resolved. The
// row still stretches, the cards are still equal, and nothing measures a
// monitor — the slack simply stops pooling in one place.
describe('fix-335 §6: the Design Plan of Record centres its content', () => {
  it('★ the section splits its spare height above and below', () => {
    state.row = row();
    renderCard();
    const section = screen
      .getByTestId('plan-of-record-card')
      .querySelector('section section') as HTMLElement;
    expect(section.dataset.centerVertically).toBe('true');
    expect(section.style.display).toBe('flex');
    expect(section.style.flexDirection).toBe('column');
    expect(section.style.justifyContent).toBe('center');
  });

  // ★★ AND fix-331 §1 IS UNTOUCHED, which the brief was explicit about. Its
  // rule is that a section GROWS to take an equal share of the slack and stays
  // TOP-ALIGNED inside it, so a three-section card keeps its reading rhythm.
  // Centring is layered on top of that growth, not instead of it.
  it('★★ it still grows the fix-331 way — centring did not replace the split', () => {
    state.row = row();
    renderCard();
    const section = screen
      .getByTestId('plan-of-record-card')
      .querySelector('section section') as HTMLElement;
    expect(section.style.flexGrow).toBe('1');
    expect(section.style.flexShrink).toBe('0');
    expect(section.style.flexBasis).toBe('auto');
  });

  // ★ Every state of the card, not just the happy one — an empty card is the
  // one with the MOST slack to distribute, so it is the one that would look
  // worst if the centring were attached to the body rather than the section.
  it('★ holds for the empty state and the failed-thumbnail state too', () => {
    for (const setup of [
      () => { state.row = null; },
      () => { state.row = row({ thumb_path: null }); },
    ]) {
      setup();
      const view = renderCard();
      const section = screen
        .getByTestId('plan-of-record-card')
        .querySelector('section section') as HTMLElement;
      expect(section.dataset.centerVertically).toBe('true');
      view.unmount();
    }
  });
});

// ===========================================================================
// ★★★ fix-507 §F (P-178) — THE CARD NAMES THE STAGE THE PROJECT IS AT
// ===========================================================================
//
// fix-506 §E built the two Marketing buttons for the marketing case and gave
// them to EVERY project. Measured on prod 2026-09-09 there are **164** indexed
// plans — 128 `marketing`, 31 `schematic`, 5 `design_guidance` — so **36
// projects showed a SCHEMATIC chip above two buttons saying Marketing**.
// `233 31st Ave E`, the project in Bobby's screenshot, is one of them.
//
// ★★★ THE STAGE IS THE NEWEST SET THE INDEXER HAS, AND IT IS NOT RE-DERIVED
//     HERE. fix-284 applies the precedence in the VIEW (design_guidance <
//     schematic < marketing, furthest stage present); this card reads
//     `row.set_type`. Bobby's ruling 6: *"the card renders files, so the files
//     decide, and the label can never disagree with the picture."*
//
// ★★★ AND THE STAGE **REPLACES**. At marketing you see the two marketing
//     buttons and nothing else; earlier sets stay indexed and reachable in
//     Project Data's Plan of record tab (ruling 5).

describe('fix-507 §F: the buttons name the resolved set, at every stage', () => {
  it.each([
    // ★ fix-508 §H (P-186): the marketing pair is renamed to what each set IS
    //   — the internal one is the site plan — and `Design guidance` takes its
    //   title case. The RULE fix-507 §F established is untouched and is what
    //   this table still asserts: the stage decides which buttons exist, and
    //   the chip and caption name the same set as the picked one.
    ['marketing', ['Site Plan', 'Marketing'], 'Site plan'],
    ['schematic', ['Schematic'], 'Schematic set'],
    ['design_guidance', ['Design Guidance'], 'Design guidance set'],
  ] as const)(
    '★★★ %s — the chip, the buttons and the caption say the same thing',
    async (setType, labels, caption) => {
      state.row = row({ set_type: setType });
      renderCard();
      const internal = await screen.findByTestId('plan-of-record-set-internal');
      // ★ The BUTTONS, asserted as an ordered list rather than by presence: a
      //   presence check would pass on a schematic project that had grown a
      //   Marketing button back.
      const buttons = Array.from(
        document.querySelectorAll('[data-testid^="plan-of-record-set-"]'),
      ).filter((el) => el.tagName === 'BUTTON' && !el.getAttribute('data-testid')?.endsWith('-share'));
      expect(buttons.map((b) => b.textContent)).toEqual(labels);
      expect(internal.getAttribute('aria-pressed')).toBe('true');
      // ★ The CAPTION names the same set as the picked button…
      expect(
        screen.getByTestId('plan-of-record-set-caption').textContent ?? '',
      ).toContain(caption);
      // ★ …and so does the CHIP, which is the half P-178 was actually about:
      //   a SCHEMATIC chip above two Marketing buttons is a card arguing with
      //   itself.
      expect(
        await screen.findByTestId(`plan-of-record-stage-${setType}`),
      ).toBeInTheDocument();
    },
  );

  it('★★★ REPLACE, not accumulate — no Marketing button on a schematic project', async () => {
    // ★ Bobby's ruling 5, asserted as an ABSENCE because that is what it is:
    //   the earlier sets are still indexed and still reachable in Project
    //   Data; they are simply not on this card's face.
    state.row = row({ set_type: 'schematic' });
    renderCard();
    await screen.findByTestId('plan-of-record-set-internal');
    expect(screen.queryByTestId('plan-of-record-set-external')).toBeNull();
    expect(document.body.textContent).not.toContain('Marketing');
  });

  it('★★ only marketing has an external variant, so only it can be disabled', async () => {
    // ★ The disabled-External branch is fix-506 §E's and is untouched — it is
    //   simply unreachable on the 36 projects that are not at marketing, which
    //   is the point: a control that cannot apply is not rendered greyed out,
    //   it is not rendered.
    state.row = row({ set_type: 'design_guidance' });
    renderCard();
    await screen.findByTestId('plan-of-record-set-internal');
    expect(screen.queryByTestId('plan-of-record-set-external')).toBeNull();
    expect(
      screen.getByTestId('plan-of-record-set-caption').textContent ?? '',
    ).not.toContain('indexer run');
  });
});

// ===========================================================================
// ★★★ fix-507b §G — THE THUMBNAIL GETS A HEIGHT CAP
// ===========================================================================
//
// The image was `w-full h-auto`, so **the card's height was the aspect ratio of
// whatever sheet the indexer happened to grab**. Measured across all 164
// indexed plans: 162 landscape, 2 portrait, four distinct sizes. At the card's
// reference width the modal 1400 × 906 sheet renders 300px and the portrait
// 1400 × 2164 pair render **716** — a 416px card, on its own, on a row this
// ticket is trying to get above the fold.

describe('fix-507b §G: the plan preview is capped and contained', () => {
  it('★★★ the image is a fixed-height box with `object-fit: contain`', async () => {
    state.row = row();
    renderCard();
    const img = await screen.findByTestId('plan-of-record-preview-img');
    expect(img.style.height).toBe(`${POR_IMAGE_MAX_HEIGHT}px`);
    // ★★★ `contain`, NEVER `cover`. A crop is exactly what removes the title
    //     block and the north arrow, which are the two things a preview of a
    //     plan sheet exists to show.
    expect(img.style.objectFit).toBe('contain');
    // ★ …and the auto height is gone, which is the half that would silently
    //   come back if somebody re-added the Tailwind class.
    expect(img.className).not.toContain('h-auto');
  });

  it('★★ every stage gets the same treatment — one rule, three stages', async () => {
    for (const setType of ['marketing', 'schematic', 'design_guidance'] as const) {
      state.row = row({ set_type: setType, thumb_path: `${PROJECT_ID}/${setType}.jpg` });
      const view = renderCard();
      const img = await screen.findByTestId('plan-of-record-preview-img');
      expect(img.style.height, setType).toBe(`${POR_IMAGE_MAX_HEIGHT}px`);
      view.unmount();
    }
  });
});
