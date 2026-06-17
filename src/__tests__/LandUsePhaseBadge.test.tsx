import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LandUsePhaseBadge } from '../components/ProjectDetail/LandUsePhaseBadge';
import type { PermitWithCycles } from '../lib/database.types';

// fix-169: the LU phase badge renders the derived phase for land-use permits and
// nothing for everything else.

function permit(over: Partial<PermitWithCycles> = {}): PermitWithCycles {
  return {
    id: 42,
    project_id: 'p1',
    type: 'ULS',
    stage: null,
    stage_override: null,
    status: null,
    num: 'LUP-1001',
    da: null,
    dm: null,
    ent_lead: null,
    dual_da: null,
    target_submit: null,
    dd_start: null,
    dd_end: null,
    expected_issue: null,
    actual_issue: null,
    approval_date: null,
    intake_date: null,
    design_review_date: null,
    decision_published_date: null,
    publication_end_date: null,
    notes: null,
    cycle_model: null,
    view_cycle: null,
    kickoff_date: null,
    corr_rounds: null,
    permit_owner: null,
    architect: null,
    nickname: null,
    struct_address: null,
    portal_url: null,
    updated_at: '2026-01-01T00:00:00Z',
    permit_cycles: [],
    ...over,
  };
}

const TODAY = new Date(2026, 5, 20);

describe('LandUsePhaseBadge', () => {
  it('renders nothing for a non-land-use permit', () => {
    render(
      <LandUsePhaseBadge permit={permit({ type: 'Building Permit', num: '7-CN' })} />,
    );
    expect(screen.queryByTestId('landuse-phase-badge-42')).not.toBeInTheDocument();
  });

  it('renders "Design Review" for a ULS with design_review_date', () => {
    render(
      <LandUsePhaseBadge
        permit={permit({ design_review_date: '2026-04-10' })}
        today={TODAY}
      />,
    );
    const badge = screen.getByTestId('landuse-phase-badge-42');
    expect(badge.getAttribute('data-phase')).toBe('design_review');
    expect(badge.textContent).toContain('Design Review');
  });

  it('renders "In Publication until <date>" during the publication window', () => {
    render(
      <LandUsePhaseBadge
        permit={permit({
          decision_published_date: '2026-06-16',
          publication_end_date: '2026-06-30',
        })}
        today={TODAY}
      />,
    );
    const badge = screen.getByTestId('landuse-phase-badge-42');
    expect(badge.getAttribute('data-phase')).toBe('in_publication');
    expect(badge.textContent).toContain('In Publication until 2026-06-30');
  });

  // fix-178: the badge is now limbo-only. Recorded is terminal → suppressed.
  it('renders NOTHING when Recorded (terminal — covered elsewhere)', () => {
    render(<LandUsePhaseBadge permit={permit({ actual_issue: '2026-06-18' })} today={TODAY} />);
    expect(screen.queryByTestId('landuse-phase-badge-42')).not.toBeInTheDocument();
  });

  // fix-178: In Review is already shown by the cycle/stage layer → suppressed.
  it('renders NOTHING for a cycle-derived In Review phase (no limbo milestone)', () => {
    render(
      <LandUsePhaseBadge
        permit={permit({
          permit_cycles: [
            {
              id: 'c0',
              permit_id: 42,
              cycle_index: 0,
              submitted: '2026-02-01',
              city_target: null,
              corr_issued: null,
              resubmitted: null,
              intake_accepted: null,
              created_at: '',
              updated_at: '',
            },
          ],
        })}
        today={TODAY}
      />,
    );
    expect(screen.queryByTestId('landuse-phase-badge-42')).not.toBeInTheDocument();
  });
});

// fix-178 Part C: the badge surfaces ONLY the limbo phases the cycle/stage
// tracker doesn't already cover. Design Review / In Publication / Decision
// Published → badge; In Review / Corrections / Final Review / Recorded → none.
describe('LandUsePhaseBadge — limbo-only gate (fix-178)', () => {
  function luCycle(over: Record<string, unknown> = {}) {
    return {
      id: 'c',
      permit_id: 42,
      cycle_index: 0,
      submitted: null,
      city_target: null,
      corr_issued: null,
      resubmitted: null,
      intake_accepted: null,
      created_at: '',
      updated_at: '',
      ...over,
    };
  }

  it('SHOWS the badge for Decision Published (publication window closed)', () => {
    render(
      <LandUsePhaseBadge
        permit={permit({
          decision_published_date: '2026-05-20',
          publication_end_date: '2026-06-03', // before TODAY → window closed
        })}
        today={TODAY}
      />,
    );
    const badge = screen.getByTestId('landuse-phase-badge-42');
    expect(badge.getAttribute('data-phase')).toBe('decision_published');
  });

  it('SUPPRESSES the badge for Corrections (cycle layer already shows it)', () => {
    render(
      <LandUsePhaseBadge
        permit={permit({
          permit_cycles: [
            luCycle({ submitted: '2026-02-01', corr_issued: '2026-03-01', resubmitted: null }),
          ],
        })}
        today={TODAY}
      />,
    );
    expect(screen.queryByTestId('landuse-phase-badge-42')).not.toBeInTheDocument();
  });

  it('SUPPRESSES the badge for Final Review (cycle resumed after publication)', () => {
    render(
      <LandUsePhaseBadge
        permit={permit({
          decision_published_date: '2026-04-01',
          publication_end_date: '2026-04-15',
          permit_cycles: [luCycle({ cycle_index: 1, submitted: '2026-05-01' })],
        })}
        today={TODAY}
      />,
    );
    expect(screen.queryByTestId('landuse-phase-badge-42')).not.toBeInTheDocument();
  });
});
