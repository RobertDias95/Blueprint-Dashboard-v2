import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useAuthStore } from '../stores/authStore';
import { useAppConfig, readAppConfigStringArray } from './useAppConfig';
import { useBoardItemRead, useMarkBoardItemsRead } from './useBoardReads';
import { useSelfScope } from './useSelfScope';
import {
  INTAKE_WARNING_RECIPIENTS_KEY,
  intakeWarningReadKey,
  isBusinessDay,
  isIntakeWarningRecipient,
  pacificToday,
  type IntakeWarningRow,
} from '../lib/intakeWarning';

// ===========================================================================
// ★★★ fix-637 §B (P-180) — THE DAILY POP-UP, ON THE WEEKLY UPDATE'S PATTERN
// ===========================================================================
//
// Bobby, 10-11: *"a pop up on the screen, like the weekly agenda."* So this is
// `useWeeklyEdition` with a DAY where that has an edition:
//
//   · THE TRIGGER IS A CLOCK. The same four check points (mount,
//     visibilitychange, focus, a slow timer) under the same floor — a Bridge tab
//     left open overnight notices the new day without a reload. See
//     useWeeklyEdition for why each one is needed.
//   · ★★★ fix-627: THE DAY IS MARKED READ BY ONE EXACT KEY
//     (`intake-warning:YYYY-MM-DD`), asked for by key — never by searching a
//     list that a row cap can silently truncate into a modal nobody can close.
//   · `readQ.isSuccess` gates it, so it cannot flash for 200 ms on every load.
//
// WHO: the people Settings names ("Seattle intake warning goes to"), matched
//   by roster name through `useSelfScope` — the resolution the agenda uses.
// WHEN: business days only (Pacific), while `bp_intake_warning_due` returns
//   anything. Close dismisses it for that day; tomorrow it asks again.
// WHAT: the database's due list — the same function the 7 AM email reads.

const CHECK_MIN_GAP_MS = 5_000;
const CHECK_INTERVAL_MS = 60_000;

export interface IntakeWarningState {
  day: string;
  rows: IntakeWarningRow[];
  shouldShow: boolean;
  acknowledge: () => void;
  isRecipient: boolean;
}

export function useIntakeWarning(): IntakeWarningState {
  const tenantId = useAuthStore((s) => s.activeTenantId) ?? '';
  const { identity } = useSelfScope();
  const config = useAppConfig();
  const markRead = useMarkBoardItemsRead();

  const recipients = useMemo(
    () => readAppConfigStringArray(config.map, INTAKE_WARNING_RECIPIENTS_KEY),
    [config.map],
  );
  const isRecipient = isIntakeWarningRecipient(recipients, identity.name);

  const [day, setDay] = useState<string>(() => pacificToday());
  const lastCheckAt = useRef(0);

  const check = useCallback(() => {
    const now = Date.now();
    if (now - lastCheckAt.current < CHECK_MIN_GAP_MS) return;
    lastCheckAt.current = now;
    const next = pacificToday();
    setDay((prev) => (prev === next ? prev : next));
  }, []);

  useEffect(() => {
    // ★ Deferred, not called in the effect body — the React Compiler rejects a
    //   synchronous setState there (fix-350, and useWeeklyEdition's note).
    const first = window.setTimeout(check, 0);
    const id = window.setInterval(check, CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
    };
  }, [check]);

  const active = isRecipient && isBusinessDay(day);
  const key = intakeWarningReadKey(day);
  const readQ = useBoardItemRead(active ? key : null);
  const acknowledged = readQ.data === true;

  // ★ Only asked for when it could actually be shown.
  const dueQ = useQuery<IntakeWarningRow[]>({
    queryKey: queryKeys.intakeWarningDue(tenantId, day),
    enabled: active && !!tenantId && readQ.isSuccess && !acknowledged,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_intake_warning_due', { p_today: day });
      if (error) throw error;
      return (data ?? []) as IntakeWarningRow[];
    },
  });
  const rows = useMemo(() => dueQ.data ?? [], [dueQ.data]);

  const acknowledge = useCallback(() => {
    markRead.mutate([key]);
  }, [markRead, key]);

  return {
    day,
    rows,
    shouldShow:
      active && readQ.isSuccess && !acknowledged && dueQ.isSuccess && rows.length > 0,
    acknowledge,
    isRecipient,
  };
}
