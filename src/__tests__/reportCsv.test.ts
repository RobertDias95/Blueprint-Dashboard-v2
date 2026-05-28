import { describe, it, expect } from 'vitest';
import { rowsToCsv, reportCsvFilename } from '../lib/reportCsv';

// fix-69: CSV builder + filename slug unit tests.

describe('rowsToCsv', () => {
  it('builds header + rows keyed by column key, CRLF lines', () => {
    const csv = rowsToCsv(
      [
        { key: 'num', label: 'Permit #' },
        { key: 'project.address', label: 'Address' },
      ],
      [
        { num: 'BP-1', 'project.address': '123 Pine St' },
        { num: 'BP-2', 'project.address': '456 Oak Ave' },
      ],
    );
    expect(csv).toBe(
      'Permit #,Address\r\nBP-1,123 Pine St\r\nBP-2,456 Oak Ave',
    );
  });

  it('quotes cells containing commas / quotes / newlines and doubles inner quotes', () => {
    const csv = rowsToCsv(
      [{ key: 'note', label: 'Note' }],
      [{ note: 'a, b "c"\nd' }],
    );
    expect(csv).toBe('Note\r\n"a, b ""c""\nd"');
  });

  it('renders null/undefined cells as empty', () => {
    const csv = rowsToCsv(
      [{ key: 'x', label: 'X' }],
      [{ x: null }, { x: undefined }, {}],
    );
    expect(csv).toBe('X\r\n\r\n\r\n');
  });
});

describe('reportCsvFilename', () => {
  it('slugifies the name and appends the date', () => {
    const f = reportCsvFilename('Weekly DA Update!', new Date(2026, 4, 28));
    expect(f).toBe('weekly-da-update-2026-05-28.csv');
  });

  it('falls back to "report" for an all-symbol name', () => {
    const f = reportCsvFilename('@@@', new Date(2026, 0, 5));
    expect(f).toBe('report-2026-01-05.csv');
  });
});
