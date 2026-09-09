import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ===========================================================================
// fix-511 §A (P-197) — ERROR TRIAGE STOPS REPORTING DEVELOPMENT SESSIONS
// ===========================================================================
//
// MEASURED ON PROD 2026-09-09, the seven days to that date:
//
//   32 rows in `error_reports` · 24 of them raised by a browser
//   19 `frontend_exception` rows — and ALL NINETEEN carry a stack at
//   `http://localhost:5178/src/…` with Vite's HMR cache-bust parameter.
//   ZERO came from the deployed app. 17 were dismissed by hand that day with
//   `backlog_ref` naming P-197.
//
// ★ The brief counted 14 of 14; prod says 19 of 19 by the time this shipped,
//   because five more arrived while fix-508 was being built — three of them
//   mine, at 19:50–19:56, from editing ProjectOverviewBoxes and ConsultantBand
//   with the dev server open. Reported rather than smoothed: the number moved
//   in the direction that makes the case, and the case is the ratio, not the
//   count. It is still 100%.
//
// ★★★ AND THE PROXY THIS COUNT USES IS WHY THE STAMP MATTERS AS WELL AS THE
//     GATE. "Names localhost" can only be asked of rows that carry a stack.
//     `backend_rpc` rows carry a relative pathname and nothing else (see
//     §C — that is the same gap from the other side), so a dev session's RPC
//     failures could not be classified retroactively at all. From here every
//     row that IS sent says which environment sent it.

import { logError, reportingEnvironment } from '../lib/errorLogger';

const rpc = vi.hoisted(() => vi.fn(() => Promise.resolve({ data: null, error: null })));
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));

beforeEach(() => {
  rpc.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// The predicate, as a pure function
// ---------------------------------------------------------------------------

describe('fix-511 §A — what counts as a development session', () => {
  it('★★★ `development` is a development session whatever the origin', () => {
    expect(reportingEnvironment('development', 'http://localhost:5178').isDevelopment)
      .toBe(true);
    // Vite dev served over the network to a phone is still a dev session.
    expect(reportingEnvironment('development', 'http://192.168.1.20:5178').isDevelopment)
      .toBe(true);
  });

  it('★★★ a real build on a real origin is NOT — this is the case that must still send', () => {
    expect(reportingEnvironment('production', 'https://bridge.blueprintcap.com').isDevelopment)
      .toBe(false);
    expect(reportingEnvironment('production', null).isDevelopment).toBe(false);
  });

  it('★★★ …but a production BUILD on a local origin is: that is `npm run preview`', () => {
    // ★ The case `MODE` alone cannot see, and the reason the brief offered the
    //   page origin as an alternative signal rather than only the mode.
    for (const origin of [
      'http://localhost:4173',
      'http://localhost',
      'http://127.0.0.1:5178',
      'http://[::1]:5178',
      'https://bobby-mbp.local:5178',
    ]) {
      expect(reportingEnvironment('production', origin).isDevelopment, origin).toBe(true);
    }
  });

  it('★★ a host that merely CONTAINS a local name is not local', () => {
    for (const origin of [
      'https://localhost.evil.com',
      'https://my.local.evil.com',
      'https://notlocalhost',
      'https://app.example.com/localhost',
    ]) {
      expect(reportingEnvironment('production', origin).isDevelopment, origin).toBe(false);
    }
  });

  it('★★ `test` is not a development session, and that is deliberate', () => {
    // vitest sets MODE=test and DEV=true. Gating on DEV would have silenced the
    // dozen existing suites that assert this reporter's call shape — `supabase`
    // is mocked in every one of them, so nothing leaves the process anyway.
    expect(reportingEnvironment('test', 'http://localhost:3000').isDevelopment).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The gate, through the single choke point every caller funnels into
// ---------------------------------------------------------------------------

describe('fix-511 §A — a report raised in development is not sent', () => {
  it('★★★ development: NOTHING reaches bp_log_error', async () => {
    vi.stubEnv('MODE', 'development');
    await logError({
      source: 'frontend_exception',
      level: 'error',
      message: 'DATES_COLUMN_GAP is not defined',
      context: { url: '/project/86d28d67', kind: 'react_router_error_element' },
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('★★ …and it says so in the console the developer is already looking at', async () => {
    vi.stubEnv('MODE', 'development');
    await logError({ source: 'frontend_toast', level: 'error', message: 'boom' });
    // ★ A SILENT drop is the failure mode to avoid: the next person to find no
    //   rows would conclude the reporter is broken, which is exactly the wrong
    //   turn fix-314 took when it found no auth rows and assumed a filter.
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[errorLogger] not sent (development'),
      expect.anything(),
    );
  });

  it('★★ the suppressed call still RESOLVES — callers fire-and-forget and must not reject', async () => {
    vi.stubEnv('MODE', 'development');
    await expect(
      logError({ source: 'backend_rpc', level: 'error', message: 'x' }),
    ).resolves.toBeUndefined();
  });

  it('★★★ a production build on a local origin is suppressed too (npm run preview)', async () => {
    // jsdom serves this suite from http://localhost:3000, so stamping the mode
    // as `production` reproduces `npm run preview` exactly.
    vi.stubEnv('MODE', 'production');
    await logError({ source: 'frontend_exception', level: 'error', message: 'preview' });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('fix-511 §A — a report raised outside development still is', () => {
  it('★★★ it reaches bp_log_error, unchanged in every other respect', async () => {
    // MODE is `test` here — not a development session, per the ruling above.
    await logError({
      source: 'backend_rpc',
      level: 'error',
      message: 'Time block changed since you loaded it',
      context: { url: '/draw-schedule', kind: 'mutation' },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, payload] = rpc.mock.calls[0] as unknown as [
      string,
      { p_source: string; p_level: string; p_message: string; p_context: Record<string, unknown> },
    ];
    expect(name).toBe('bp_log_error');
    expect(payload.p_source).toBe('backend_rpc');
    expect(payload.p_level).toBe('error');
    expect(payload.p_message).toBe('Time block changed since you loaded it');
    // The caller's own context survives intact…
    expect(payload.p_context.url).toBe('/draw-schedule');
    expect(payload.p_context.kind).toBe('mutation');
  });

  it('★★★ …and it now carries the environment that sent it', async () => {
    await logError({
      source: 'backend_rpc',
      level: 'error',
      message: 'invalid input syntax for type integer',
      context: { url: '/project/bdeedc93', kind: 'mutation' },
    });
    const [, payload] = rpc.mock.calls[0] as unknown as [
      string,
      { p_context: Record<string, unknown> },
    ];
    expect(payload.p_context.environment).toBe('test');
    expect(payload.p_context.origin).toBe('http://localhost:3000');
  });
});
