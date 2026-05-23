import { describe, it, expect } from 'vitest';
import { getErrorMessage } from '../lib/getErrorMessage';

// fix-50: getErrorMessage must surface a real string for every shape we can
// catch — and never the useless "[object Object]".

describe('getErrorMessage', () => {
  it('reads Error.message', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns a plain string as-is', () => {
    expect(getErrorMessage('plain failure')).toBe('plain failure');
  });

  it('reads .message from a PostgREST-style plain object (the /activity bug)', () => {
    // This is the exact shape supabase.rpc() throws — a plain object, NOT an
    // Error instance. The old `String(error)` fallback produced "[object Object]".
    const pgErr = {
      message: 'permission denied for function bp_fetch_scraper_activity',
      details: null,
      hint: null,
      code: '42501',
    };
    expect(getErrorMessage(pgErr)).toBe(
      'permission denied for function bp_fetch_scraper_activity',
    );
  });

  it('falls back to details/hint when message is absent', () => {
    expect(getErrorMessage({ details: 'the details' })).toBe('the details');
    expect(getErrorMessage({ hint: 'try X' })).toBe('try X');
  });

  it('reads error_description (OAuth-style errors)', () => {
    expect(getErrorMessage({ error_description: 'token expired' })).toBe(
      'token expired',
    );
  });

  it('NEVER returns "[object Object]" for a message-less plain object', () => {
    expect(getErrorMessage({ code: 500, foo: 'bar' })).not.toBe('[object Object]');
    expect(getErrorMessage({})).not.toBe('[object Object]');
  });

  it('handles null / undefined without throwing', () => {
    expect(getErrorMessage(null)).toBe('Unknown error');
    expect(getErrorMessage(undefined)).toBe('Unknown error');
  });

  it('skips empty-string message fields', () => {
    expect(getErrorMessage({ message: '   ', details: 'real detail' })).toBe(
      'real detail',
    );
  });
});
