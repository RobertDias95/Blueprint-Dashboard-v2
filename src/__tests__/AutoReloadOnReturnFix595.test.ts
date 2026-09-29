import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AUTO_RELOAD_AWAY_MS,
  activeElementIsInput,
  autoReloadBlocker,
  shouldAutoReload,
  type AutoReloadInput,
} from '../lib/autoReload';
import {
  __resetDirtyRegistry,
  dirtyKeys,
  isAnythingDirty,
  setDirty,
  clearDirty,
} from '../lib/dirtyRegistry';
import { __resetAppQueryClient, appIsMutating, setAppQueryClient } from '../lib/appQueryClient';

// ===========================================================================
// ★★★ fix-595 (P-292) — A STALE APP CATCHES UP WHEN YOU COME BACK
// ===========================================================================
//
// fix-589's heartbeat settled what was wrong, and killed every earlier theory:
//
//   · **14 of 14 people who pressed Reload moved build**, installed app
//     included. The reload path works.
//   · **Ainsley and Matt F were active 07:05–07:09 on 09-29 still on `f60eb6b`**
//     — four builds behind, `notice_shown_count = 1`, never dismissed.
//     **The ribbon was on their screen the whole time and was ignored.**
//
// ★ Re-measured for this ticket, 2026-09-29: 31 people, 15 behind, 2 behind AND
//   active in the last twelve hours, and **0 of 31 have ever pressed Dismiss.**
//   Nobody is fighting the ribbon; they are living with it.
//
// ⇒ **The installed app never restarts, and a quiet ribbon is easy to live
//   with.** Bobby ruled: reload automatically, at the one moment nothing can be
//   lost.

const base: AutoReloadInput = {
  newBuild: true,
  awayMs: AUTO_RELOAD_AWAY_MS,
  dirty: false,
  mutating: false,
  activeIsInput: false,
  triedThisBuild: false,
};

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-595 §2 — the rule, as a truth table', () => {
  it('★★★ all four conditions hold → reload', () => {
    expect(shouldAutoReload(base)).toBe(true);
    expect(autoReloadBlocker(base)).toBeNull();
  });

  // ★★★ EVERY ONE OF THE FOUR, ALONE, BLOCKS IT. The brief asks for exactly
  //     this, and it is the assertion that makes the feature safe to ship: there
  //     is no combination where three hold and the fourth is waived.
  const blockers: [string, Partial<AutoReloadInput>, string][] = [
    ['no newer bundle is being served', { newBuild: false }, 'no-new-build'],
    ['not away long enough', { awayMs: AUTO_RELOAD_AWAY_MS - 1 }, 'not-away-long-enough'],
    ['something is unsaved', { dirty: true }, 'dirty'],
    ['a write is in flight', { mutating: true }, 'mutating'],
    ['the caret is in a field', { activeIsInput: true }, 'active-is-input'],
    ['already tried for this build', { triedThisBuild: true }, 'already-tried'],
  ];

  for (const [name, patch, blocker] of blockers) {
    it(`★★★ blocked when ${name}`, () => {
      const input = { ...base, ...patch };
      expect(shouldAutoReload(input)).toBe(false);
      expect(autoReloadBlocker(input)).toBe(blocker);
    });
  }

  it('★★★ 29 minutes → no; 30 minutes → yes', () => {
    // The brief's own boundary. 30 minutes is not about how stale the bundle is
    // — the ribbon handles that and escalates — it is about how confident we can
    // be that nobody is mid-thought.
    expect(AUTO_RELOAD_AWAY_MS).toBe(30 * 60 * 1000);
    expect(shouldAutoReload({ ...base, awayMs: 29 * 60 * 1000 })).toBe(false);
    expect(shouldAutoReload({ ...base, awayMs: 30 * 60 * 1000 })).toBe(true);
    expect(shouldAutoReload({ ...base, awayMs: 30 * 60 * 1000 - 1 })).toBe(false);
  });

  it('★★★ a dirty form blocks it at TEN HOURS away', () => {
    // fix-371 §4's reason, kept whole: *"being a day behind is a smaller problem
    // than losing a paragraph."* No amount of time away buys the right to
    // discard typed text.
    expect(shouldAutoReload({ ...base, awayMs: 10 * 60 * 60 * 1000, dirty: true })).toBe(false);
    expect(
      shouldAutoReload({ ...base, awayMs: 10 * 60 * 60 * 1000, activeIsInput: true }),
    ).toBe(false);
    expect(shouldAutoReload({ ...base, awayMs: 10 * 60 * 60 * 1000, mutating: true })).toBe(false);
  });

  it('★★★ a second return after a failed attempt does NOT try again', () => {
    // Condition 4. If the server keeps serving the same bundle and something
    // about the reload does not take, a per-return rule would reload on every
    // return for ever — which looks exactly like the app being broken.
    const afterAttempt = { ...base, triedThisBuild: true };
    expect(shouldAutoReload(afterAttempt)).toBe(false);
    // …and a genuinely NEW build is eligible again, because the latch is keyed
    // to the build rather than to the document.
    expect(shouldAutoReload({ ...afterAttempt, triedThisBuild: false })).toBe(true);
  });

  it('★ away time is a NUMBER the caller measured, never a timer this module set', () => {
    // `appVersion.ts` records why: Chrome throttles `setInterval` in a hidden tab
    // and stops it entirely in a backgrounded installed app — the exact
    // population this ticket is for. The rule takes `awayMs` as data.
    // ★ Comments stripped first — the doc comment on `awayMs` NAMES
    //   `setTimeout` in order to rule it out, and a raw source match reads its
    //   own reasoning as a violation. (Seventh time in this repo.)
    const src = readFileSync(resolve(process.cwd(), 'src/lib/autoReload.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/setTimeout|setInterval/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-595 §2.3 — the caret test', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const mount = (html: string) => {
    document.body.innerHTML = html;
    return document.body.firstElementChild as HTMLElement;
  };

  it('★★★ an input, a textarea, a select and a contenteditable all count', () => {
    for (const html of [
      '<input />',
      '<textarea></textarea>',
      '<select><option>a</option></select>',
      '<div contenteditable="true"></div>',
      // ★★ A CHILD of an editable region counts too — that is where the caret
      //    actually sits in a rich-text composer.
      '<div contenteditable="true"><span tabindex="0">typed</span></div>',
    ]) {
      const root = mount(html);
      const el = (root.querySelector('[tabindex]') as HTMLElement | null) ?? root;
      el.focus();
      expect(activeElementIsInput(document), html).toBe(true);
      document.body.innerHTML = '';
    }
  });

  it('★★★ `contenteditable="false"` does NOT count', () => {
    // ⚠️ jsdom leaves `isContentEditable` UNDEFINED (measured), so the helper
    //    also asks `closest()`. That fallback must not swallow the one value
    //    that means "not editable" — otherwise a read-only rich-text island
    //    would block the reload for ever.
    const el = mount('<div contenteditable="false" tabindex="0"></div>');
    el.focus();
    expect(activeElementIsInput(document)).toBe(false);
  });

  it('★★ a BUTTON does not — nothing can be typed into it', () => {
    const el = mount('<button>Go</button>');
    el.focus();
    expect(activeElementIsInput(document)).toBe(false);
  });

  it('★★ a readOnly or disabled field does not count', () => {
    // Treating them as unsaved work would block the reload on a screen that is
    // purely being read.
    for (const html of ['<input readonly />', '<input disabled />']) {
      const el = mount(html);
      el.focus();
      expect(activeElementIsInput(document), html).toBe(false);
      document.body.innerHTML = '';
    }
  });

  it('★ nothing focused is not an input', () => {
    document.body.innerHTML = '<div></div>';
    (document.activeElement as HTMLElement | null)?.blur?.();
    expect(activeElementIsInput(document)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-595 §2.3 — the dirty registry', () => {
  beforeEach(() => __resetDirtyRegistry());

  it('★★ registers and clears by key', () => {
    expect(isAnythingDirty()).toBe(false);
    setDirty('a', true);
    expect(isAnythingDirty()).toBe(true);
    setDirty('a', false);
    expect(isAnythingDirty()).toBe(false);
  });

  it('★★★ a double-register cannot strand the app permanently dirty', () => {
    // A Set of keys, not a count. A remount racing its own cleanup would, with a
    // counter, leave the app "dirty" for the rest of the session — silently
    // disabling this feature with nothing on screen to say so.
    setDirty('a', true);
    setDirty('a', true);
    clearDirty('a');
    expect(isAnythingDirty()).toBe(false);
  });

  it('★ several surfaces at once, and it names them', () => {
    setDirty('project-chat', true);
    setDirty('add-note', true);
    expect(dirtyKeys()).toEqual(['add-note', 'project-chat']);
    setDirty('add-note', false);
    expect(dirtyKeys()).toEqual(['project-chat']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-595 §2.3 — isMutating without a provider', () => {
  beforeEach(() => __resetAppQueryClient());

  it('★★★ false when there is no app around it', () => {
    // A bare mount (four of fix-424's tests do exactly that) must not throw and
    // must not claim a mutation is in flight — there is nothing to mutate.
    expect(appIsMutating()).toBe(false);
  });

  it('★★ true when the app says so', () => {
    setAppQueryClient({ isMutating: () => 2 } as never);
    expect(appIsMutating()).toBe(true);
    setAppQueryClient({ isMutating: () => 0 } as never);
    expect(appIsMutating()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-595 — the wiring, asserted against the source', () => {
  const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  const code = (p: string) =>
    src(p)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');
  const notice = code('src/components/NewBuildNotice.tsx');

  it('★★★ it uses the EXISTING reload path, and only that one', () => {
    // §2: *"call the EXISTING `reloadOntoNewBuild()` — do not write a second
    // reload path."* Counted, so a third call site cannot appear unnoticed.
    expect(notice).not.toMatch(/window\.location\.reload/);
    expect(notice.match(/reloadOntoNewBuild/g) ?? []).toHaveLength(3); // import + button + auto
  });

  it('★★★ the auto path is gated by the rule and by nothing else', () => {
    expect(notice).toMatch(/if \(!shouldAutoReload\(decision\)\) \{/);
    // ★ …and every one of the four conditions is actually supplied, rather than
    //   hard-coded true by a caller that drifted from the rule's shape.
    for (const field of [
      'newBuild:',
      'awayMs',
      'dirty:',
      'mutating:',
      'activeIsInput:',
      'triedThisBuild:',
    ]) {
      expect(notice, field).toContain(field);
    }
  });

  it('★★★ `auto_reloaded` is recorded BEFORE the reload', () => {
    // fix-589's ordering reason exactly: the reload tears the document down, so
    // a fire-and-forget afterwards is a race that loses most of the time.
    const record = notice.indexOf("recordClientBuild('auto_reloaded')");
    const reload = notice.indexOf('void reloadOntoNewBuild();', record);
    expect(record).toBeGreaterThan(-1);
    expect(reload).toBeGreaterThan(record);
    // ★ AWAITED, so "before" means before rather than merely earlier in the file.
    //   ★★ …and `.catch`ed, so a REJECTED record cannot skip the reload. That is
    //      today's state — the migration is unapplied. Behaviour asserted in
    //      `AutoReloadOnReturnLiveFix595`; this pins the shape.
    expect(notice).toMatch(
      /await recordClientBuild\('auto_reloaded'\)\.catch\(\(\) => undefined\);/,
    );
  });

  it('★★★ the away clock is a TIMESTAMP, and only the first leave stamps it', () => {
    // `blur` and `hidden` both fire for one act of walking away; re-stamping on
    // the second would restart the clock and the feature would simply never
    // trigger, with nothing on screen to say so.
    expect(notice).toMatch(/if \(awaySince\.current === 0\) awaySince\.current = Date\.now\(\);/);
    expect(notice).toMatch(/Date\.now\(\) - leftAt/);
  });

  it('★★ it listens on the events that already existed, and adds only `blur`', () => {
    // §4: no new timer, no new poll. `visibilitychange` and `focus` were already
    // there for detection; `blur` is the leaving half of `focus`.
    expect(notice).toContain("window.addEventListener('blur', markAway)");
    expect(notice).toContain("window.removeEventListener('blur', markAway)");
    // No second interval.
    expect(notice.match(/setInterval/g) ?? []).toHaveLength(1);
  });

  it('★★★ §4 — it does not special-case the installed app', () => {
    // *"Browser tabs and installed app get the same rule."*
    expect(notice).not.toMatch(/standalone/);
    expect(notice).not.toMatch(/currentDisplayMode/);
  });

  it('★★★ fix-371 §4 is SUPERSEDED IN THE COMMENT, not deleted', () => {
    // §1: *"Record the supersession in the comment block at the top; do not
    // delete fix-371's reasoning."*
    // ★ Normalised first: the sentence is wrapped across two comment lines, and
    //   asserting the raw text would fail on a reflow that changed nothing.
    const raw = src('src/components/NewBuildNotice.tsx');
    const prose = raw.replace(/^\s*\/\/ ?/gm, '').replace(/\s+/g, ' ');
    expect(prose).toContain('being a day behind is a smaller problem than losing a paragraph');
    expect(raw).toMatch(/NARROWLY SUPERSEDED BY fix-595/);
  });

  it('★★★ the ribbon no longer promises something untrue', () => {
    // ⚠️ fix-589's copy said *"nothing reloads on its own"* on all four rungs.
    // That is FALSE after this ticket, so it is reworded to the promise the four
    // conditions actually enforce. A screen that says something untrue is the
    // defect this repo keeps removing.
    const cb = src('src/lib/clientBuild.ts');
    expect(cb).not.toMatch(/nothing reloads on its own/i);
    expect((cb.match(/never reloads while you are using it/gi) ?? []).length).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-595 §3 — the migration is staged, and the reload survives it being unapplied', () => {
  const FILE = resolve(process.cwd(), 'migrations/fix_595_auto_reload_event.sql');
  const SQL = readFileSync(FILE, 'utf8');
  const CODE = SQL.replace(/^\s*--.*$/gm, '');

  it('★★★ staged, not applied, and it says so first', () => {
    expect(SQL).toContain('NOT APPLIED');
    expect(SQL.indexOf('NOT APPLIED')).toBeLessThan(1200);
  });

  it('★★★ the RPC accepts the fourth event and the reader returns the column', () => {
    expect(CODE).toMatch(/'shown', 'dismissed', 'reloaded', 'auto_reloaded'/);
    expect(CODE).toContain('ADD COLUMN IF NOT EXISTS notice_auto_reloaded_at timestamptz');
    expect(CODE).toContain('out_notice_auto_reloaded_at timestamptz');
    expect(CODE).toContain('c.notice_auto_reloaded_at');
  });

  it('★★★ set on the FIRST auto-reload, never overwritten', () => {
    // §3: *"same shape as `notice_first_shown_at`"* — `COALESCE(c.…, EXCLUDED.…)`,
    // deliberately NOT `notice_reloaded_at`'s shape, which takes the newest.
    expect(CODE).toMatch(
      /notice_auto_reloaded_at\s*=\s*\n?\s*COALESCE\(c\.notice_auto_reloaded_at, EXCLUDED\.notice_auto_reloaded_at\)/,
    );
  });

  it('★★★ the reader is DROPPED before being recreated', () => {
    // `CREATE OR REPLACE FUNCTION` cannot change a RETURN TYPE, and adding a
    // column to `RETURNS TABLE(…)` is exactly that — Postgres refuses with
    // *"cannot change return type of existing function"*. Same family as
    // fix-438's overload lesson, but it errors loudly instead of silently.
    expect(CODE).toContain('DROP FUNCTION IF EXISTS public.bp_list_client_builds()');
    expect(CODE.indexOf('DROP FUNCTION')).toBeLessThan(
      CODE.indexOf('CREATE OR REPLACE FUNCTION public.bp_list_client_builds'),
    );
    // ★ And the grant is re-issued, because dropping a function drops its grants
    //   — a reader nobody can execute is a Settings panel that 500s.
    expect(CODE).toContain('GRANT EXECUTE ON FUNCTION public.bp_list_client_builds() TO authenticated');
  });

  it('★★ idempotent and transactional', () => {
    expect(CODE).toContain('ADD COLUMN IF NOT EXISTS');
    expect(CODE).toContain('DROP FUNCTION IF EXISTS');
    expect(CODE).toMatch(/BEGIN;[\s\S]*COMMIT;/);
  });

  it('★★★ the client tolerates the RPC REJECTING the new event', () => {
    // §3: *"the client must tolerate the RPC rejecting the new event (older
    // server) — record fails quietly, reload still happens."* `recordClientBuild`
    // swallows everything by design (fix-589), and the reload is the NEXT
    // statement rather than being conditional on the record.
    const cb = readFileSync(resolve(process.cwd(), 'src/lib/clientBuild.ts'), 'utf8');
    expect(cb).toMatch(/\.catch\(\(err: unknown\) => \{/);
    const notice = readFileSync(
      resolve(process.cwd(), 'src/components/NewBuildNotice.tsx'),
      'utf8',
    );
    // Not `if (await record(...)) reload()` — the reload does not depend on it.
    expect(notice).not.toMatch(/if \(await recordClientBuild/);
  });

  it('★★ the reader maps a MISSING column to null rather than throwing', () => {
    const hook = readFileSync(resolve(process.cwd(), 'src/hooks/useClientBuilds.ts'), 'utf8');
    expect(hook).toContain('out_notice_auto_reloaded_at?: string | null');
    expect(hook).toContain('row.out_notice_auto_reloaded_at ?? null');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('fix-595 §2.3 — which editors were wired', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

  // ★★★ THE NINE SURFACES THAT CAN HOLD TYPED TEXT ACROSS A BLUR. The criterion
  //     is objective rather than a judgement: these components have NO
  //     `onBlur={commit}`, so their draft survives the person walking away.
  //     Everything else in the app commits on blur — `EditableField`,
  //     `LibraryEditCell`, `BufferedDateInput`, `TaskDateField`, the Settings
  //     inline editors, the project data editors — and its draft cannot outlive
  //     the blur that walking away causes.
  // ⚠️ fix-570 DELETED `AddNoteBox.tsx`, so the nine are now EIGHT. It was the
  //    Weekly Updates report's add-note control and that report stopped taking
  //    notes (P-275) — a surface that cannot hold unsaved text because it no
  //    longer exists. The `dirtyRegistry` key `add-note` went with it.
  const wired: [string, string][] = [
    ['src/components/ProjectDetail/ProjectChatModal.tsx', 'project-chat'],
    ['src/components/ProjectDetail/ChatTaskComposer.tsx', 'chat-task-composer'],
    ['src/components/ProjectDetail/ChatMessageRow.tsx', 'chat-edit:'],
    ['src/components/ProjectDetail/ProjectDetailsModal.tsx', 'project-details:'],
    ['src/components/Settings/QuarterLayoutEditor.tsx', 'quarter-layout:'],
    ['src/components/Settings/AddPersonDialog.tsx', 'add-person'],
    ['src/components/Settings/PersonDetailsDialog.tsx', 'person-details'],
    ['src/pages/ReportBuilder.tsx', 'report-builder'],
  ];

  for (const [path, key] of wired) {
    it(`★★ ${path.split('/').pop()} registers as \`${key}\``, () => {
      const s = read(path);
      expect(s).toContain('useDirtySurface');
      expect(s).toContain(key);
    });
  }

  it('★★★ every registration is paired with an unmount clear', () => {
    // A key left registered would disable auto-reload for the rest of the
    // session, silently. `useDirtySurface` owns the cleanup so nine call sites
    // cannot each forget it.
    const hook = read('src/hooks/useDirtySurface.ts');
    expect(hook).toMatch(/useEffect\(\(\) => \(\) => clearDirty\(key\), \[key\]\)/);
  });
});
