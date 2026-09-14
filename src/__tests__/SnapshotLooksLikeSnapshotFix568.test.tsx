import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import SnapshotFrame from '../components/ProjectDetail/SnapshotFrame';
// ★ The RULE lives in lib/ — the measured opacity, the contrast numbers, the
//   interactive selector and the navigate-or-not predicate are testable without
//   mounting anything (and `only-export-components` is an error in this repo).
import {
  SNAPSHOT_MUTE_OPACITY,
  SNAPSHOT_CONTRAST,
  SNAPSHOT_INTERACTIVE_SELECTOR,
  snapshotClickNavigates,
} from '../lib/snapshotFrame';
import { preferLiveSnapWeek } from '../lib/drawScheduleHelpers';

// ===========================================================================
// ★★★ fix-568 (P-272) — THE SNAPSHOT LOOKS LIKE A SNAPSHOT
// ===========================================================================
//
// ★★★ MEASURED ON PROD 2026-09-14: **18 superseded originals, and ALL 18 have
//     chat (68 messages), permits (60) AND plan-of-record sets (35).** So every
//     exemption below is load-bearing on **every single one** — there is no
//     original where the chat or the permits are empty and a swallowed click
//     would go unnoticed. (An 18th redesign was created at 22:05 today; fix-556
//     measured 17 this afternoon and both numbers were right when taken.)
//
// ★★★ THE CONTRAST ARITHMETIC, which decided the one number in this ticket:
//     `--color-text` #1a2540 on `--color-surface` #ffffff is **15.19:1**.
//     Composited at the SetButton's **0.5** it becomes #8c92a0 — **3.12:1**,
//     BELOW 4.5, the exact failure fix-564 measured on `--color-co` (2.86:1).
//     At **0.65** it is #6a7183 — **4.88:1 on surface, 4.69:1 on --color-bg**.
//     Bobby: *"you could still read the information."*

const REDESIGN = 'p-redesign';
const ORIGINAL = 'p-original';

function Probe() {
  return <span data-testid="probe-path">{useLocation().pathname}</span>;
}

function renderFrame(successor: { id: string; address: string } | null, children: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[`/project/${ORIGINAL}`]}>
      <Routes>
        <Route
          path="/project/:id"
          element={
            <>
              <SnapshotFrame successor={successor}>{children}</SnapshotFrame>
              <Probe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** The four cards, as a superseded original renders them — every control the
 *  brief names, in the element each really uses on the page. */
function FourCards() {
  return (
    <div data-testid="cards">
      <p data-testid="card-text">Lot size 5,000 sf</p>
      {/* Plan of Record — fix-522/523's viewers and share control */}
      <button type="button" data-testid="por-site-plan">Site Plan</button>
      <button type="button" data-testid="por-marketing">Marketing</button>
      <button type="button" data-testid="por-share">⇗</button>
      {/* Team — chat */}
      <button type="button" data-testid="pd-chat-btn">Chat</button>
      {/* Project — Connect is a real anchor (OverviewAction href branch) */}
      <a href="https://blueprint.datapage.com/home" data-testid="pd-connect-button">Connect</a>
      {/* Project — Draw schedule is a Link, which renders an anchor */}
      <a href="/draw-schedule" data-testid="pd-draw-schedule">Draw schedule</a>
      {/* Permits — a row */}
      <button type="button" data-testid="permit-row-1">ULS · 3043241-LU</button>
    </div>
  );
}

beforeEach(() => {
  // ★ jsdom has no selection by default; each test sets what it needs.
  vi.spyOn(window, 'getSelection').mockReturnValue({
    toString: () => '',
  } as unknown as Selection);
});

describe('fix-568 §A — the four cards grey out, readably', () => {
  it('★★★ a superseded original renders the muted frame', () => {
    renderFrame({ id: REDESIGN, address: '2443 5th Ave W [Redesign 1]' }, <FourCards />);
    const frame = screen.getByTestId('snapshot-frame');
    expect(frame.style.opacity).toBe(String(SNAPSHOT_MUTE_OPACITY));
  });

  it('★★★ a normal project is PIXEL-UNCHANGED — no frame, no wrapper, nothing', () => {
    // ★★ Asserted on the normal case deliberately: this ticket touches a page
    //    203 projects render, and a regression there would be invisible on the
    //    18 it is actually about.
    renderFrame(null, <FourCards />);
    expect(screen.queryByTestId('snapshot-frame')).toBeNull();
    expect(screen.queryByTestId('snapshot-marker')).toBeNull();
    expect(screen.getByTestId('cards')).toBeTruthy();
  });

  it('★★★ the muting is READABLE — 4.88:1, not the 3.12:1 that 0.5 would give', () => {
    // ★★★ The number this file claims is the number the test asserts (fix-450:
    //     never let a comment be the only place a measurement lives).
    expect(SNAPSHOT_MUTE_OPACITY).toBe(0.65);
    expect(SNAPSHOT_CONTRAST.onSurface).toBeGreaterThanOrEqual(4.5);
    expect(SNAPSHOT_CONTRAST.onBackground).toBeGreaterThanOrEqual(4.5);
    expect(SNAPSHOT_CONTRAST.rejectedAtHalfOpacity).toBeLessThan(4.5);
  });

  it('★★★ caption ink is remapped, or it would fail while the body text passed', () => {
    // ★★★ `--color-muted` is 5.48:1 at full strength and only 2.70:1 at 0.65.
    //     Remapping it to --color-text inside the frame is what stops the
    //     WORST outcome: secondary text failing invisibly beside passing text.
    renderFrame({ id: REDESIGN, address: '2443 5th Ave W' }, <FourCards />);
    const frame = screen.getByTestId('snapshot-frame');
    expect(frame.style.getPropertyValue('--color-muted')).toBe('var(--color-text)');
    expect(frame.style.getPropertyValue('--color-dim')).toBe('var(--color-text)');
  });
});

describe('fix-568 §B — both chips are gone, the corner-to-corner marker replaces them', () => {
  const page = readFileSync(resolve(__dirname, '../pages/ProjectDetail.tsx'), 'utf8');
  /** Source with `//` and `*` comment lines stripped — the gravestone trap,
   *  recorded seventeen times in this Brain: an assertion about removed CODE
   *  must not be satisfied by the prose explaining the removal. */
  const code = page
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');

  it('★★★ the `Snapshot — read only` chip no longer renders', () => {
    expect(code).not.toContain('Snapshot — read only');
    expect(code).not.toContain('project-frozen-note');
  });

  it('★★★ the `Superseded by …` pill no longer renders', () => {
    expect(code).not.toContain('pd-superseded-badge');
    expect(code).not.toContain('<SupersededBadge');
  });

  it('★★ …and the ⚙ button is still ABSENT on a superseded original', () => {
    // ★ That half of fix-524 §D was load-bearing and is NOT what this removed:
    //   what went is the label, not the refusal to offer an editor.
    expect(code).toContain('frozen ?');
  });

  it('★★★ the marker names the current project, and is not the only signal', () => {
    renderFrame({ id: REDESIGN, address: '2443 5th Ave W [Redesign 1]' }, <FourCards />);
    const marker = screen.getByTestId('snapshot-marker');
    expect(marker.textContent).toContain('Earlier version');
    // ★ and it prints the STRIPPED address — one helper, never a second.
    expect(marker.textContent).toContain('2443 5th Ave W');
    expect(marker.textContent).not.toContain('[Redesign 1]');
    // ★★ it cannot swallow a click: the grey is the primary signal and this
    //    only confirms it.
    expect(marker.closest('[aria-hidden]')).toBeTruthy();
  });
});

describe('fix-568 §C — clicking the greyed area goes to the current project', () => {
  it('★★★ a click on the background navigates to the redesign', () => {
    renderFrame({ id: REDESIGN, address: '2443 5th Ave W' }, <FourCards />);
    fireEvent.click(screen.getByTestId('card-text'));
    expect(screen.getByTestId('probe-path').textContent).toBe(`/project/${REDESIGN}`);
  });

  it('★★ …and on a normal project nothing navigates, because there is no handler', () => {
    renderFrame(null, <FourCards />);
    fireEvent.click(screen.getByTestId('cards'));
    expect(screen.getByTestId('probe-path').textContent).toBe(`/project/${ORIGINAL}`);
  });

  // ★★★ ONE ASSERTION PER CONTROL, BY NAME — the brief's requirement, and the
  //     reason is §0: all 18 originals have chat, permits AND plan sets, so
  //     every one of these is reachable on every one of them.
  const EXEMPT: readonly [string, string][] = [
    ['Chat', 'pd-chat-btn'],
    ['Draw schedule', 'pd-draw-schedule'],
    ['Connect', 'pd-connect-button'],
    ['a permit row', 'permit-row-1'],
    ['Site Plan', 'por-site-plan'],
    ['Marketing', 'por-marketing'],
    ['the share icon', 'por-share'],
  ];

  for (const [label, testid] of EXEMPT) {
    it(`★★★ clicking ${label} does NOT navigate`, () => {
      renderFrame({ id: REDESIGN, address: '2443 5th Ave W' }, <FourCards />);
      fireEvent.click(screen.getByTestId(testid));
      expect(screen.getByTestId('probe-path').textContent).toBe(
        `/project/${ORIGINAL}`,
      );
    });
  }

  it('★★★ text selection inside a greyed card does not navigate', () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'Lot size 5,000 sf',
    } as unknown as Selection);
    renderFrame({ id: REDESIGN, address: '2443 5th Ave W' }, <FourCards />);
    fireEvent.click(screen.getByTestId('card-text'));
    expect(screen.getByTestId('probe-path').textContent).toBe(`/project/${ORIGINAL}`);
  });

  it('★★★ the rule is OPT-IN — a control added tomorrow is exempt automatically', () => {
    // ★★★ THE WHOLE POINT OF §C. The Overview has been rebuilt four times in a
    //     month (fix-506, 507, 556, this). A handler that captured by default
    //     and relied on `stopPropagation` sprinkled on today's children would
    //     silently swallow the fifth rebuild's controls. Because the rule is
    //     "navigate only if the click came from nothing interactive", a button
    //     nobody has written yet is already exempt.
    const doc = document.createElement('div');
    doc.innerHTML =
      '<div id="wrap"><button id="future">A control invented later</button></div>';
    const future = doc.querySelector('#future')!;
    expect(snapshotClickNavigates(future, '')).toBe(false);
    const plain = doc.querySelector('#wrap')!;
    expect(snapshotClickNavigates(plain, '')).toBe(true);
  });

  it('★★ the selector names every interactive ROLE, not every component', () => {
    for (const needed of ['a', 'button', 'input', 'select', 'textarea', 'label']) {
      expect(SNAPSHOT_INTERACTIVE_SELECTOR.split(',')).toContain(needed);
    }
    // ★ and an escape hatch for anything genuinely interactive that is none of
    //   those — greppable by name.
    expect(SNAPSHOT_INTERACTIVE_SELECTOR).toContain('[data-snapshot-live]');
  });

  it('★★ a click with no target navigates nowhere', () => {
    expect(snapshotClickNavigates(null, '')).toBe(false);
  });
});

describe('fix-568 §D — the back button was a MISSED call site, and is stripped', () => {
  const page = readFileSync(resolve(__dirname, '../pages/ProjectDetail.tsx'), 'utf8');

  it('★★★ `labelForProject` runs the address through displayAddress', () => {
    // ★★★ fix-556 §C applied the helper at 17 places by walking the JSX; this
    //     address never appears in JSX — it is RETURNED FROM A CALLBACK that
    //     `previousTarget` renders — so it was missed, and the back button read
    //     `← 2443 5th Ave W [Redesign 1]` while every other surface was plain.
    expect(page).toContain(
      'displayAddress(projects.find((p) => p.id === id)?.address)',
    );
  });
});

describe('fix-568 §E — the search snaps to the current project, the block stays', () => {
  it('★★★ a live match beats a retired one, whichever started first', () => {
    // ★★★ The real 2443 shape, prod 2026-09-14: the ORIGINAL starts 2026-01-05
    //     and the REDESIGN starts 2026-04-13. `earliest` sent the board to Q1
    //     and showed the retired one — every reuse-redesign has this shape,
    //     because a redesign is by definition the later block.
    expect(
      preferLiveSnapWeek([
        { startWeek: '2026-01-05', retired: true },
        { startWeek: '2026-04-13', retired: false },
      ]),
    ).toBe('2026-04-13');
  });

  it('★★★ …and a retired match still snaps when nothing live matched', () => {
    // ★★ Load-bearing: an original with no redesign, or a cancelled project
    //    somebody is deliberately looking for, must still be findable.
    expect(
      preferLiveSnapWeek([{ startWeek: '2026-01-05', retired: true }]),
    ).toBe('2026-01-05');
  });

  it('★★ the earliest LIVE one wins among several', () => {
    expect(
      preferLiveSnapWeek([
        { startWeek: '2026-06-01', retired: false },
        { startWeek: '2026-02-02', retired: false },
        { startWeek: '2026-01-05', retired: true },
      ]),
    ).toBe('2026-02-02');
  });

  it('★★ nothing matched → null, which the caller reads as “stay put”', () => {
    expect(preferLiveSnapWeek([])).toBeNull();
  });

  it('★★★ the ORIGINAL’S BLOCK IS NOT REMOVED — only the snap target changed', () => {
    // ★★★ Removing it would reverse the 2026-09-10 ruling on P-023: *Pipeline
    //     hidden · Library hidden · Draw Schedule STAYS, purple-hatched — the
    //     board is a record of time.* Bobby's sentence is about what a search
    //     SHOWS him, not about deleting blocks, and the code does one without
    //     the other: this helper returns a WEEK, and the caller's block
    //     rendering never consults it.
    const grid = readFileSync(
      resolve(__dirname, '../components/DrawScheduleGrid.tsx'),
      'utf8',
    );
    const code = grid
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    // the helper's only consumer is the quarter snap
    expect(code).toContain('setQuarterOffset(weekKeyToQuarterOffset(earliestStart))');
    // …and the retired set is still only used to PAINT, never to drop a row
    expect(code).not.toContain('if (isRetiredProject(project.id, retiredSets)) continue;');
  });
});

describe('fix-568 — fix-524 §D’s read-level freeze is untouched', () => {
  it('★★★ `?data=` on a superseded original still opens nothing', () => {
    const page = readFileSync(resolve(__dirname, '../pages/ProjectDetail.tsx'), 'utf8');
    const code = page
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    // ★ The freeze is ON THE READ — `dataOpen = supersededBy ? null : …` — which
    //   is why the permits ✎ and every `?data=` link already cannot open an
    //   editor. This ticket is presentation and navigation; it must not relax it.
    expect(code).toMatch(/supersededBy\s*\?\s*null\s*:/);
  });
});
