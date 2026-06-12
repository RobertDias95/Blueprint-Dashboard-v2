import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PendingScrapeChip from '../components/shared/PendingScrapeChip';
import { readPendingScrapeChange } from '../lib/pendingScrapeChange';

// fix-159: the chip renders from extras.pending_scrape_change (written by the
// scraper, part 2) and disappears when the key is cleared. Read-only.

// Verbatim sample of the contract part 2 writes:
const SAMPLE = {
  pending_scrape_change: {
    observed_status: 'In Process',
    db_status: 'Pre-Submittal — GO',
    first_seen: '2026-06-10',
    runs_skipped: 3,
    last_run_at: '2026-06-12T08:00:00Z',
  },
};

describe('readPendingScrapeChange (fix-159)', () => {
  it('parses the full extras shape', () => {
    const p = readPendingScrapeChange(SAMPLE);
    expect(p).toEqual({
      observed_status: 'In Process',
      db_status: 'Pre-Submittal — GO',
      first_seen: '2026-06-10',
      runs_skipped: 3,
      last_run_at: '2026-06-12T08:00:00Z',
    });
  });

  it('returns null when the key is absent (cleared by the scraper)', () => {
    expect(readPendingScrapeChange({})).toBeNull();
    expect(readPendingScrapeChange(null)).toBeNull();
    expect(readPendingScrapeChange({ redmond_hold: true })).toBeNull();
  });

  it('returns null when observed_status is missing/blank', () => {
    expect(
      readPendingScrapeChange({ pending_scrape_change: { db_status: 'X' } }),
    ).toBeNull();
    expect(
      readPendingScrapeChange({
        pending_scrape_change: { observed_status: '   ', db_status: 'X' },
      }),
    ).toBeNull();
  });
});

describe('PendingScrapeChip (fix-159)', () => {
  it('renders "Portal: <observed>" with a tooltip when the key is present', () => {
    render(<PendingScrapeChip extras={SAMPLE} permitId={10222} />);
    const chip = screen.getByTestId('pending-scrape-chip-10222');
    expect(chip.textContent).toContain('In Process');
    const title = chip.getAttribute('title') ?? '';
    expect(title).toContain('In Process'); // observed
    expect(title).toContain('Pre-Submittal — GO'); // db
    expect(title).toContain('3 runs'); // run count pluralized
  });

  it('renders nothing when the extras key is absent', () => {
    const { container } = render(
      <PendingScrapeChip extras={{}} permitId={10222} />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('pending-scrape-chip-10222')).toBeNull();
  });

  it('singularizes the run count', () => {
    render(
      <PendingScrapeChip
        extras={{
          pending_scrape_change: {
            observed_status: 'Issued',
            db_status: 'In Review',
            runs_skipped: 1,
          },
        }}
        permitId={5}
      />,
    );
    expect(
      screen.getByTestId('pending-scrape-chip-5').getAttribute('title'),
    ).toContain('1 run.');
  });
});
