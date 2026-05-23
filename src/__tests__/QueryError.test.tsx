import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import QueryError from '../components/QueryError';

// fix-50: QueryError is the error UI the /activity page renders when the
// bp_fetch_scraper_activity RPC throws. The RPC throws a PostgREST plain
// object, so the body must show its real .message — never "[object Object]".

describe('<QueryError />', () => {
  it('renders the real message from a PostgREST plain-object error', () => {
    const pgErr = {
      message: 'permission denied for function bp_fetch_scraper_activity',
      details: null,
      hint: null,
      code: '42501',
    };
    render(<QueryError title="Activity failed to load" error={pgErr} />);
    expect(
      screen.getByText(
        'permission denied for function bp_fetch_scraper_activity',
      ),
    ).toBeInTheDocument();
    // The literal "[object Object]" must NOT appear anywhere.
    expect(screen.queryByText('[object Object]')).toBeNull();
    expect(document.body.textContent).not.toContain('[object Object]');
  });

  it('renders an Error instance message', () => {
    render(<QueryError error={new Error('network down')} />);
    expect(screen.getByText('network down')).toBeInTheDocument();
  });

  it('fires onRetry when Retry is clicked', () => {
    const onRetry = vi.fn();
    render(<QueryError error={{ message: 'oops' }} onRetry={onRetry} />);
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
