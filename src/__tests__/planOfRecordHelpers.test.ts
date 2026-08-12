import { describe, it, expect } from 'vitest';
import {
  STAGE_CHIP,
  STAGE_LABEL,
  formatFileSize,
  formatModified,
  hasThumbnail,
  missingThumbnailReason,
  stageLabel,
} from '../lib/planOfRecord';

// fix-285: the pure helpers behind the Design Plan of Record card.

const UNC =
  '\\\\bpc-file\\SoleilData\\--- Blueprint Services ---\\Building Permits\\'
  + '10044 37th Ave SW - Haushund - MA\\10044 - Marketing Plans\\set.pdf';

describe('stage labels', () => {
  it('names all three stages', () => {
    expect(stageLabel('design_guidance')).toBe('Design Guidance');
    expect(stageLabel('schematic')).toBe('Schematic');
    expect(stageLabel('marketing')).toBe('Marketing');
  });

  it('covers every stage in both maps, so a chip can never be undefined', () => {
    for (const key of Object.keys(STAGE_LABEL)) {
      expect(STAGE_CHIP[key as keyof typeof STAGE_CHIP]).toBeTruthy();
    }
  });

  it('gives each stage a distinct colour', () => {
    const fg = Object.values(STAGE_CHIP).map((c) => c.fg);
    expect(new Set(fg).size).toBe(fg.length);
  });

  it('falls back to the raw value rather than blanking', () => {
    expect(stageLabel('something_new')).toBe('something_new');
    expect(stageLabel(null)).toBe('—');
  });
});

describe('formatFileSize — input is KILOBYTES', () => {
  it('keeps small sets in KB', () => {
    expect(formatFileSize(727)).toBe('727 KB');   // a real design-guidance PDF
    expect(formatFileSize(22)).toBe('22 KB');
  });

  it('switches to MB above 1024 KB', () => {
    expect(formatFileSize(9402)).toBe('9.2 MB');  // a real marketing set
    expect(formatFileSize(1536)).toBe('1.5 MB');
  });

  it('drops the decimal once it stops carrying information', () => {
    expect(formatFileSize(17398)).toBe('17 MB');  // the largest production set
  });

  it('renders nothing rather than "0 KB" for missing data', () => {
    expect(formatFileSize(null)).toBe('');
    expect(formatFileSize(undefined)).toBe('');
    expect(formatFileSize(-1)).toBe('');
  });
});

describe('formatModified', () => {
  it('formats a date', () => {
    expect(formatModified('2026-06-18T00:00:00Z')).toBe('Jun 18, 2026');
  });

  it('★ does not drift a day west of Greenwich', () => {
    // The indexer stores midnight UTC. Rendered in the viewer's local zone,
    // that is the PREVIOUS day for everyone in the US — so the same file would
    // show a different date depending on who was looking at it. This is the
    // regression that turned "Jun 18" into "Jun 17" during fix-285.
    expect(formatModified('2026-06-18T00:00:00Z')).toContain('18');
    expect(formatModified('2026-01-01T00:00:00Z')).toBe('Jan 01, 2026');
    expect(formatModified('2026-12-31T00:00:00Z')).toBe('Dec 31, 2026');
  });

  it('is blank rather than "Invalid Date" for junk', () => {
    expect(formatModified(null)).toBe('');
    expect(formatModified('')).toBe('');
    expect(formatModified('not a date')).toBe('');
  });
});

// ★ fix-289: `uncToFileUrl` and `parentFolder` were DELETED from
// src/lib/planOfRecord.ts along with the Open and "Show in folder" buttons they
// fed, so the suites that exercised them are gone with them. This test asserts
// the module no longer exports either one — a re-added helper is the first step
// back toward a button that silently does nothing when clicked.
describe('fix-289 no file:/UNC navigation helper survives', () => {
  it('exports neither uncToFileUrl nor parentFolder', async () => {
    const mod = await import('../lib/planOfRecord');
    expect('uncToFileUrl' in mod).toBe(false);
    expect('parentFolder' in mod).toBe(false);
  });

  it('no exported helper returns a file: URL for a UNC path', async () => {
    const mod = await import('../lib/planOfRecord');
    for (const value of Object.values(mod)) {
      if (typeof value !== 'function') continue;
      let out: unknown;
      try {
        out = (value as (s: string) => unknown)(UNC);
      } catch {
        continue; // helpers that take a row, not a string
      }
      if (typeof out === 'string') {
        expect(out.toLowerCase().startsWith('file:')).toBe(false);
      }
    }
  });
});

describe('hasThumbnail — both halves must hold', () => {
  it('true only for ok + a path', () => {
    expect(hasThumbnail({ thumb_status: 'ok', thumb_path: 'p/marketing.jpg' })).toBe(true);
  });

  it('false for ok with no path', () => {
    expect(hasThumbnail({ thumb_status: 'ok', thumb_path: null })).toBe(false);
  });

  it('false for a path left behind by a failed render', () => {
    expect(hasThumbnail({ thumb_status: 'failed', thumb_path: 'p/marketing.jpg' })).toBe(false);
  });

  it('false when nothing has been attempted', () => {
    expect(hasThumbnail({ thumb_status: null, thumb_path: null })).toBe(false);
    expect(hasThumbnail(null)).toBe(false);
  });
});

describe('missingThumbnailReason', () => {
  it('distinguishes "failed" from "not yet generated"', () => {
    const failed = missingThumbnailReason({ thumb_status: 'failed', thumb_path: null });
    const pending = missingThumbnailReason({ thumb_status: null, thumb_path: null });
    expect(failed).not.toBe(pending);
    expect(failed).toMatch(/could not be generated/i);
    expect(pending).toMatch(/next file-server index/i);
  });

  it('says the FILE is fine when only the preview failed', () => {
    // The distinction matters: a failed thumbnail must not read as a corrupt
    // drawing set, or somebody goes looking for a problem that isn't there.
    expect(missingThumbnailReason({ thumb_status: 'failed', thumb_path: null }))
      .toMatch(/file itself is fine/i);
  });

  it('never uses the word "error"', () => {
    for (const s of ['failed', null] as const) {
      expect(missingThumbnailReason({ thumb_status: s, thumb_path: null }).toLowerCase())
        .not.toContain('error');
    }
  });
});
