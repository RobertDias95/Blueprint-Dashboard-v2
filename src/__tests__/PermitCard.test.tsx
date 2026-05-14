import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PermitCard from '../components/PermitCard';
import type { Permit, Project } from '../lib/database.types';

// Q2: PermitCard render contract — confirms address, juris, lead, key date,
// and stage badge all surface in the card markup. Lock the visible
// contract before Q3 starts mutating it.

function makePermit(over: Partial<Permit> = {}): Permit {
  return {
    id: 42,
    project_id: 'pj-1',
    type: 'BP',
    stage: null,
    stage_override: null,
    status: null,
    num: 'BP-12345',
    da: 'Trevor',
    dm: 'Brittani',
    ent_lead: 'Bobby',
    dual_da: null,
    target_submit: '2026-01-15',
    dd_start: null,
    dd_end: null,
    expected_issue: null,
    actual_issue: null,
    approval_date: null,
    intake_date: null,
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
    ...over,
  };
}

const project: Project = {
  id: 'pj-1',
  address: '123 Main St',
  juris: 'Seattle',
  archived: false,
  notes: null,
};

describe('<PermitCard />', () => {
  it('renders address, juris, type, and permit number', () => {
    render(
      <MemoryRouter>
        <PermitCard
          permit={makePermit()}
          project={project}
          stage="de"
          keyDate="2026-01-15"
          keyDateLabel="Target Submit"
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('123 Main St')).toBeInTheDocument();
    expect(screen.getByText(/Seattle/)).toBeInTheDocument();
    expect(screen.getByText(/BP-12345/)).toBeInTheDocument();
    expect(screen.getByText('Target Submit')).toBeInTheDocument();
    expect(screen.getByText('2026-01-15')).toBeInTheDocument();
  });

  it('shows the stage badge label for the given stage', () => {
    render(
      <MemoryRouter>
        <PermitCard
          permit={makePermit()}
          project={project}
          stage="co"
          keyDate={null}
          keyDateLabel="Corrections Out"
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Corrections')).toBeInTheDocument();
  });

  it('navigates to /project/:id via the wrapping Link', () => {
    render(
      <MemoryRouter>
        <PermitCard
          permit={makePermit()}
          project={project}
          stage="de"
          keyDate={null}
          keyDateLabel=""
        />
      </MemoryRouter>,
    );
    const link = screen.getByTestId('permit-card');
    expect(link.getAttribute('href')).toBe('/project/pj-1');
  });
});
