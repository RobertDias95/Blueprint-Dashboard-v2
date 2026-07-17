import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PermitWaitingOn from '../components/Dashboard/PermitWaitingOn';

// fix-notes-2: presentational "waiting on" body — labeled slots or the muted
// "Nothing pending" done-signal. Pure props, no hooks.

describe('PermitWaitingOn', () => {
  it('renders both task slots with owner-group labels', () => {
    render(
      <PermitWaitingOn
        summary={{ entTask: 'Order survey', archTask: 'Redline plans', note: null }}
      />,
    );
    const ent = screen.getByTestId('permit-waiting-on-slot-ent');
    const arch = screen.getByTestId('permit-waiting-on-slot-arch');
    expect(ent.textContent).toContain('ENT');
    expect(ent.textContent).toContain('Order survey');
    expect(arch.textContent).toContain('ARCH');
    expect(arch.textContent).toContain('Redline plans');
    expect(screen.queryByTestId('permit-waiting-on-empty')).toBeNull();
  });

  it('renders one task + a note slot', () => {
    render(
      <PermitWaitingOn
        summary={{ entTask: 'Order survey', archTask: null, note: 'Waiting on builder' }}
      />,
    );
    expect(
      screen.getByTestId('permit-waiting-on-slot-ent').textContent,
    ).toContain('Order survey');
    const note = screen.getByTestId('permit-waiting-on-slot-note');
    expect(note.textContent).toContain('NOTE');
    expect(note.textContent).toContain('Waiting on builder');
  });

  it('renders only a note when there is no task', () => {
    render(
      <PermitWaitingOn summary={{ entTask: null, archTask: null, note: 'Holding for ECA' }} />,
    );
    expect(screen.getByTestId('permit-waiting-on-slot-note').textContent).toContain(
      'Holding for ECA',
    );
    expect(screen.queryByTestId('permit-waiting-on-slot-ent')).toBeNull();
  });

  it('shows "Nothing pending" when there is nothing', () => {
    render(<PermitWaitingOn summary={{ entTask: null, archTask: null, note: null }} />);
    expect(screen.getByTestId('permit-waiting-on-empty').textContent).toBe(
      'Nothing pending',
    );
  });

  it('shows "Nothing pending" when the permit is absent from the summary map', () => {
    render(<PermitWaitingOn summary={undefined} />);
    expect(screen.getByTestId('permit-waiting-on-empty')).toBeTruthy();
  });
});
