import { useEffect, useMemo, useState } from 'react';
import { useProjectAddressIndex } from './useProjectAddressIndex';
import {
  findAddressMatches,
  verdictFor,
  type AddressMatch,
  type MatchVerdict,
} from '../lib/addressMatch';

// fix-333 — the debounced duplicate check the wizard runs as somebody types.
//
// ★ IT RUNS EARLY, ON PURPOSE. The brief: "the warning appears BEFORE they reach
// the end of the wizard, not on submit. Someone who has filled four steps will
// push through a warning on principle." Shire spent three minutes backfilling
// the Othello copy AFTER creating it; a submit-time warning would have arrived
// with the sunk cost already paid.
//
// ★ AND IT RUNS AGAIN AT SUBMIT, as the backstop — the address can be edited
// after the check settled. Same hook, same inputs; the wizard reads `verdict`
// at submit rather than firing a second, differently-shaped check.

/** 250ms. Long enough that a fast typist gets one evaluation instead of thirty,
 *  short enough that the warning is on screen before they leave the field. The
 *  data is already in memory, so this debounces RENDER, not network. */
const DEBOUNCE_MS = 250;

export interface DuplicateAddressCheck {
  verdict: MatchVerdict;
  matches: AddressMatch[];
  /** The index could not see every project — the banner must not imply clear. */
  truncated: boolean;
  /** True while the debounce is still settling on a newly typed value. Used to
   *  hold the banner back rather than flashing a stale verdict. */
  pending: boolean;
  /** ★ The address this verdict actually describes — the debounced value, not
   *  the one being typed. Exposed so a caller can tell "settled on the new
   *  address" from "still showing the old one", which is the difference between
   *  a correct wait and a race. */
  checkedAddress: string;
}

export function useDuplicateAddressCheck(
  address: string,
  redesignOfProjectId?: string | null,
  enabled = true,
): DuplicateAddressCheck {
  const indexQ = useProjectAddressIndex(enabled);
  const [debounced, setDebounced] = useState(address);

  useEffect(() => {
    if (address === debounced) return;
    const t = window.setTimeout(() => setDebounced(address), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [address, debounced]);

  const candidates = useMemo(
    () => indexQ.data?.candidates ?? [],
    [indexQ.data],
  );

  const matches = useMemo(() => {
    // ★ No candidates yet means NO VERDICT, not "clear". Reporting an address
    // as clean because the index is still loading is the same failure as the
    // 1000-row cap, arriving a different way.
    if (candidates.length === 0) return [];
    return findAddressMatches({
      address: debounced,
      candidates,
      redesignOfProjectId,
    });
  }, [debounced, candidates, redesignOfProjectId]);

  const loading = indexQ.isLoading || candidates.length === 0;

  return {
    verdict: loading ? 'clear' : verdictFor(matches),
    matches,
    truncated: indexQ.data?.truncated ?? false,
    checkedAddress: debounced,
    // ★ "Typing an address matching nothing produces no warning and NO FLICKER"
    // — so the banner is suppressed while the debounce is catching up to a value
    // the person is still editing.
    pending: loading || address !== debounced,
  };
}
