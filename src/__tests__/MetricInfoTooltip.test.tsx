import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, act } from '@testing-library/react';
import MetricInfoTooltip from '../components/shared/MetricInfoTooltip';

// fix-129-a: standalone tests for the MetricInfoTooltip primitive.
// Pin the hover / focus / Escape contract + the optional formula +
// cohort rendering so consumers across Reports + Trends share a
// consistent disclosure shape.

describe('<MetricInfoTooltip /> (fix-129-a)', () => {
  it('renders the label + a "?" icon as the trigger', () => {
    render(
      <MetricInfoTooltip
        label="Avg City Review"
        description="How long the city takes to approve a permit."
      />,
    );
    const trigger = screen.getByTestId('metric-tooltip-trigger-avg-city-review');
    expect(trigger).toBeInTheDocument();
    expect(trigger.textContent).toContain('Avg City Review');
    expect(trigger.textContent).toContain('?');
    // The panel is mounted lazily; nothing on first render.
    expect(
      screen.queryByTestId('metric-tooltip-content-avg-city-review'),
    ).toBeNull();
  });

  it('opens the panel on mouseenter and renders description + formula + cohort', () => {
    render(
      <MetricInfoTooltip
        label="Avg City Review"
        description="Average days from intake to approval."
        formula="approval_date − c0.intake_accepted"
        cohort="Only counts permits with both dates set."
      />,
    );
    fireEvent.mouseEnter(
      screen.getByTestId('metric-tooltip-trigger-avg-city-review'),
    );
    const panel = screen.getByTestId('metric-tooltip-content-avg-city-review');
    expect(panel).toBeInTheDocument();
    expect(panel.getAttribute('role')).toBe('tooltip');
    expect(
      screen.getByTestId('metric-tooltip-content-avg-city-review-title').textContent,
    ).toBe('Avg City Review');
    expect(
      screen.getByTestId('metric-tooltip-content-avg-city-review-description')
        .textContent,
    ).toMatch(/Average days from intake to approval\./);
    expect(
      screen.getByTestId('metric-tooltip-content-avg-city-review-formula').textContent,
    ).toContain('approval_date − c0.intake_accepted');
    expect(
      screen.getByTestId('metric-tooltip-content-avg-city-review-cohort').textContent,
    ).toContain('Only counts permits with both dates set.');
  });

  it('omits the formula + cohort lines when not supplied', () => {
    render(
      <MetricInfoTooltip
        label="Total Permits"
        description="Permit count in the current filter."
      />,
    );
    fireEvent.mouseEnter(
      screen.getByTestId('metric-tooltip-trigger-total-permits'),
    );
    expect(
      screen.queryByTestId('metric-tooltip-content-total-permits-formula'),
    ).toBeNull();
    expect(
      screen.queryByTestId('metric-tooltip-content-total-permits-cohort'),
    ).toBeNull();
  });

  it('opens on focus + closes on Escape (keyboard a11y)', () => {
    render(
      <MetricInfoTooltip
        label="Total Permits"
        description="Permit count in the current filter."
      />,
    );
    const trigger = screen.getByTestId('metric-tooltip-trigger-total-permits');
    expect(trigger.getAttribute('tabIndex')).toBe('0');
    fireEvent.focus(trigger);
    expect(
      screen.getByTestId('metric-tooltip-content-total-permits'),
    ).toBeInTheDocument();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(
      screen.queryByTestId('metric-tooltip-content-total-permits'),
    ).toBeNull();
  });

  it('aria-describedby points at the panel id only while open', () => {
    render(
      <MetricInfoTooltip
        label="Total Permits"
        description="Permit count."
      />,
    );
    const trigger = screen.getByTestId('metric-tooltip-trigger-total-permits');
    expect(trigger.getAttribute('aria-describedby')).toBeNull();
    fireEvent.mouseEnter(trigger);
    const describedBy = trigger.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const panel = screen.getByTestId('metric-tooltip-content-total-permits');
    expect(panel.id).toBe(describedBy);
  });

  it('mouseleave dismisses after the grace period (~120ms)', () => {
    vi.useFakeTimers();
    render(
      <MetricInfoTooltip
        label="Total Permits"
        description="Permit count."
      />,
    );
    const trigger = screen.getByTestId('metric-tooltip-trigger-total-permits');
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseLeave(trigger);
    // Still open mid-grace.
    expect(
      screen.getByTestId('metric-tooltip-content-total-permits'),
    ).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(
      screen.queryByTestId('metric-tooltip-content-total-permits'),
    ).toBeNull();
    vi.useRealTimers();
  });

  it('mouseenter on the panel cancels the close timer (cursor traversal grace)', () => {
    vi.useFakeTimers();
    render(
      <MetricInfoTooltip
        label="Total Permits"
        description="Permit count."
      />,
    );
    const trigger = screen.getByTestId('metric-tooltip-trigger-total-permits');
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseLeave(trigger);
    // Cursor reaches the panel mid-grace.
    const panel = screen.getByTestId('metric-tooltip-content-total-permits');
    fireEvent.mouseEnter(panel);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(
      screen.getByTestId('metric-tooltip-content-total-permits'),
    ).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('honors a custom slug override', () => {
    render(
      <MetricInfoTooltip
        label="Some Label"
        description="..."
        slug="custom-slug"
      />,
    );
    expect(
      screen.getByTestId('metric-tooltip-trigger-custom-slug'),
    ).toBeInTheDocument();
  });

  it('renders children in place of the plain label when supplied', () => {
    render(
      <MetricInfoTooltip label="Hidden Label" description="...">
        <strong data-testid="custom-label">CUSTOM</strong>
      </MetricInfoTooltip>,
    );
    expect(screen.getByTestId('custom-label')).toBeInTheDocument();
  });
});
