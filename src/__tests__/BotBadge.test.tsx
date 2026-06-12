import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BotBadge from '../components/shared/BotBadge';

// fix-155: the BOT badge marks lifecycle auto-tasks. It renders the same
// wherever auto-tasks surface (My Tasks cards, Permit Detail rows). The
// tooltip is event-specific, with a generic fallback when the event is absent
// (older wire shapes).

describe('BotBadge (fix-155)', () => {
  it('renders a stable testid and the BOT label', () => {
    render(<BotBadge taskId="abc" />);
    const badge = screen.getByTestId('bot-badge-abc');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('BOT');
  });

  it('uses an event-specific tooltip when the event is known', () => {
    render(<BotBadge taskId="t1" event="corr_issued" />);
    const badge = screen.getByTestId('bot-badge-t1');
    expect(badge.getAttribute('title')).toContain('corrections');
  });

  it('uses the number_entry tooltip', () => {
    render(<BotBadge taskId="t2" event="number_entry" />);
    expect(screen.getByTestId('bot-badge-t2').getAttribute('title')).toContain(
      'permit number',
    );
  });

  it('falls back to a generic tooltip when no event is given', () => {
    render(<BotBadge taskId="t3" />);
    const title = screen.getByTestId('bot-badge-t3').getAttribute('title') ?? '';
    expect(title).toMatch(/verify it and close it manually/i);
  });
});
