import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_PREFERENCES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_COPY,
  OPT_IN_CATEGORIES,
  emailEnabled,
  preferencesFromRows,
} from '../lib/notificationPreferences';

// ===========================================================================
// fix-648 (P-339) — mention and task-assignment emails are OFF unless a person
// turns them on; the Weekly Update and Resubmit-by warnings stay on by default.
// ===========================================================================

const repo = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const SQL = repo('migrations/fix_648_email_opt_in.sql');
const PANEL = repo('src/components/Settings/EmailNotificationsPanel.tsx');

type Row = { category: string; enabled: boolean };
const none: Row[] = [];

describe('fix-648 §1: who gets an email (TS twin of bp_notify_enabled)', () => {
  it('★★★ no row → NO email for a mention or an assignment (RED on fix-634)', () => {
    expect(emailEnabled(none, 'mention')).toBe(false);
    expect(emailEnabled(none, 'assignment')).toBe(false);
    expect(preferencesFromRows(none).mention).toBe(false);
    expect(preferencesFromRows(none).assignment).toBe(false);
  });

  it('★★★ enabled = true → email (the 4 people who ticked it stay on)', () => {
    const on: Row[] = [
      { category: 'mention', enabled: true },
      { category: 'assignment', enabled: true },
    ];
    expect(emailEnabled(on, 'mention')).toBe(true);
    expect(emailEnabled(on, 'assignment')).toBe(true);
  });

  it('★★ enabled = false → still no email', () => {
    const off: Row[] = [{ category: 'mention', enabled: false }];
    expect(emailEnabled(off, 'mention')).toBe(false);
  });

  it('★★★ Weekly Update and Resubmit-by with no row → STILL send (opt-out unchanged)', () => {
    expect(emailEnabled(none, 'weekly')).toBe(true);
    expect(emailEnabled(none, 'resubmit')).toBe(true);
    expect(emailEnabled([{ category: 'weekly', enabled: false }], 'weekly')).toBe(false);
    expect(emailEnabled([{ category: 'resubmit', enabled: false }], 'resubmit')).toBe(false);
  });

  it('★ one category\'s row never decides another', () => {
    expect(emailEnabled([{ category: 'mention', enabled: true }], 'assignment')).toBe(false);
    expect(emailEnabled([{ category: 'weekly', enabled: false }], 'resubmit')).toBe(true);
  });

  it('★ the defaults a person with no rows sees', () => {
    expect(DEFAULT_PREFERENCES).toEqual({
      mention: false,
      assignment: false,
      weekly: true,
      resubmit: true,
    });
    expect(preferencesFromRows(none)).toEqual(DEFAULT_PREFERENCES);
  });
});

describe('fix-648 §2: the database function agrees with the twin', () => {
  it('★★★ mention + assignment need an enabled = true row; the rest need no false row', () => {
    expect(SQL).toContain('CREATE OR REPLACE FUNCTION public.bp_notify_enabled(p_user uuid, p_category text)');
    expect(SQL).toMatch(
      /WHEN p_category IN \('mention', 'assignment'\) THEN EXISTS \(\s*SELECT 1 FROM public\.notification_preferences\s+WHERE user_id = p_user AND category = p_category AND enabled = true\s*\)/,
    );
    expect(SQL).toMatch(
      /ELSE NOT EXISTS \(\s*SELECT 1 FROM public\.notification_preferences\s+WHERE user_id = p_user AND category = p_category AND enabled = false\s*\)/,
    );
  });

  it('★★ the opt-in list is the same on both sides', () => {
    const m = /p_category IN \(([^)]*)\)/.exec(SQL);
    expect(m).not.toBeNull();
    const sqlList = m![1].split(',').map((s) => s.trim().replace(/'/g, ''));
    expect(sqlList).toEqual([...OPT_IN_CATEGORIES]);
  });

  it('★ no data change: the migration writes no rows', () => {
    const code = SQL.replace(/--.*$/gm, '');
    expect(code).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });
});

describe('fix-648 §3: Settings → My account → Email notifications', () => {
  it('★★ the two opt-in toggles say "Off unless you turn it on"', () => {
    for (const c of OPT_IN_CATEGORIES) {
      expect(NOTIFICATION_CATEGORY_COPY[c].help).toContain('Off unless you turn it on.');
    }
    for (const c of NOTIFICATION_CATEGORIES.filter((c) => !OPT_IN_CATEGORIES.includes(c))) {
      expect(NOTIFICATION_CATEGORY_COPY[c].help).not.toContain('Off unless');
    }
  });

  it('★ the panel falls back to the opt-in defaults, never all-on', () => {
    expect(PANEL).toContain('prefs.data ?? DEFAULT_PREFERENCES');
    expect(PANEL).not.toMatch(/mention: true, assignment: true/);
  });
});
