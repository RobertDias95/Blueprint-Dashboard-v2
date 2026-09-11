import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import {
  planSharePagePaths,
  planShareUrl,
  type PlanShareRow,
} from '../lib/planShare';
import {
  SHARE_TOAST,
  UNSHARE_TOAST,
  planShareBody,
  planShareMailto,
  planShareSubject,
} from '../lib/planOfRecordShare';
import { pushToast } from '../stores/toastStore';

// ===========================================================================
// ★★★ fix-523 §A (P-187) — MINT, RESOLVE, REVOKE
// ===========================================================================
//
// Three RPCs, applied to prod from Cowork on 2026-09-11, and the grants are the
// interesting part. Measured with `has_function_privilege`, not read off the
// SQL — see §0 and the note below:
//
//     bp_create_plan_share    anon false   authenticated true
//     bp_resolve_plan_share   anon TRUE    authenticated true
//     bp_revoke_plan_share    anon false   authenticated true
//
// ★★★ §0's LESSON, AND IT COST AN APPLY: `revoke execute … from anon` reports
//     success and does nothing. Postgres grants EXECUTE on every new function
//     to `PUBLIC`, `anon` inherits from `PUBLIC`, and revoking from the role
//     does not touch the inherited grant. The fix is `from public, anon`, and
//     the proof is `has_function_privilege` — **a statement that succeeds is
//     not a statement that did something.** Same family as the explicit-select
//     trap fix-522 hit for the sixth time.

/** ★ `p_ttl_days` is not passed: the RPC defaults to 30 and caps at 90
 *  server-side, and `SHARE_TTL_DAYS` already says 30 in the copy. A client
 *  that sent its own number would be a second place for the two to disagree. */
interface CreatedShare {
  token: string;
  expires_at: string;
}

/** One live link, as the card needs to know about it. */
export interface PlanShareLinkRow {
  token: string;
  set_type: string;
  variant: string | null;
  expires_at: string;
}

const LINKS_KEY = 'planShareLinks';

/**
 * ★★★ §A2 — WHICH SETS ON THIS PROJECT HAVE A LIVE LINK.
 *
 * `Unshare` renders only when there is one. A control that would always be
 * offered and would silently do nothing four times out of five is a control
 * that teaches its reader to distrust it.
 *
 * ★ `plan_share_links` has one tenant-scoped SELECT policy for `authenticated`
 *   and **no table grant to `anon` at all**, so this is a staff-only read and
 *   the shared page never touches the table — it goes through the RPC.
 *
 * ★★ Every member of the tenant sees every live link, not only their own. The
 *    creator scoping is in `bp_create_plan_share` (one live link per project /
 *    set / variant / creator) and it is about not minting duplicates. Whether a
 *    set is *currently shared* is a fact about the project, and the person who
 *    needs to stop a link reaching the wrong builder is not always the person
 *    who sent it.
 */
export function usePlanShareLinks(projectId: string | undefined) {
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useQuery<PlanShareLinkRow[]>({
    queryKey: [LINKS_KEY, tenantId ?? '', projectId ?? ''],
    enabled: Boolean(projectId) && !!tenantId,
    staleTime: 30 * 1000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plan_share_links')
        .select('token,set_type,variant,expires_at')
        .eq('project_id', projectId!)
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString());
      if (error) throw error;
      return (data ?? []) as unknown as PlanShareLinkRow[];
    },
  });
}

/** The live link for one set, or null. ★ The variant compare is the same
 *  `coalesce(…, '')` the RPC applies, so a stage with no variant (schematic,
 *  design guidance) matches its own null row rather than nothing. */
export function findShareLink(
  links: PlanShareLinkRow[] | undefined,
  setType: string,
  variant: string | null,
): PlanShareLinkRow | null {
  if (!links?.length) return null;
  const want = (variant ?? '').toLowerCase();
  return (
    links.find(
      (l) => l.set_type === setType && (l.variant ?? '').toLowerCase() === want,
    ) ?? null
  );
}

/**
 * ★★★ §A4 — MINTED WHEN THE USER PICKS AN ITEM, NEVER WHEN THE MENU OPENS.
 *
 * The RPC re-returns an existing live link for the same `(project, set_type,
 * variant, creator)` rather than minting a second one, so re-sharing a set
 * hands over the SAME URL — which is what makes a link people have already been
 * sent keep working. Calling it on render would defeat none of that, but it
 * would write a row every time a card is looked at, and the row is what
 * `Unshare` keys off: the menu would start reporting that everything is shared
 * the moment anybody opened it.
 */
export function useCreatePlanShare() {
  const qc = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useMutation<
    CreatedShare,
    Error,
    { projectId: string; setType: string; variant: string | null }
  >({
    mutationFn: async ({ projectId, setType, variant }) => {
      const { data, error } = await supabase.rpc('bp_create_plan_share', {
        p_project_id: projectId,
        p_set_type: setType,
        p_variant: variant,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as CreatedShare | undefined;
      if (!row?.token) throw new Error('No token returned');
      return row;
    },
    onSuccess: (_r, vars) => {
      void qc.invalidateQueries({
        queryKey: [LINKS_KEY, tenantId ?? '', vars.projectId],
      });
    },
  });
}

/** ★★★ §A2 — the token is a bearer credential, so revocation is the mitigation
 *  that ships WITH it rather than after somebody forwards one. */
export function useRevokePlanShare() {
  const qc = useQueryClient();
  const tenantId = useAuthStore((s) => s.activeTenantId);
  return useMutation<boolean, Error, { projectId: string; token: string }>({
    mutationFn: async ({ token }) => {
      const { data, error } = await supabase.rpc('bp_revoke_plan_share', {
        p_token: token,
      });
      if (error) throw error;
      return data === true;
    },
    onSuccess: (_r, vars) => {
      void qc.invalidateQueries({
        queryKey: [LINKS_KEY, tenantId ?? '', vars.projectId],
      });
    },
  });
}

// ---------------------------------------------------------------------------
// The logged-out reader
// ---------------------------------------------------------------------------

export interface ResolvedPlanShare {
  row: PlanShareRow;
  /** Signed, ordered, ready to put in an `<img src>`. Empty when the set has no
   *  page objects — the page falls back to the thumbnail, exactly as the card
   *  does. */
  pageUrls: string[];
  /** The set's front page, signed. Null when nothing could be signed. */
  thumbUrl: string | null;
  /** ★★★ fix-528 §C: a SIGNED url for the source PDF, or null. Never the object
   *  path — see `SharedPlan` for the bug that rule exists to stop. */
  pdfUrl: string | null;
  pdfBytes: number | null;
}

/** ★ The Edge Function's name. It is the ONLY thing in this app that can turn
 *  a token into pixels — see the note in `usePlanShareResolve`. */
export const PLAN_SHARE_FUNCTION = 'plan-share';

/**
 * ★★★ §A5 — WHERE THE PAGE IMAGES ARE SIGNED, AND WITH WHICH KEY.
 *
 * **They are signed inside the `plan-share` Edge Function, with the
 * SERVICE-ROLE key, which never leaves it.** That is not a preference, it is
 * the only door: `plan-thumbnails` is private, and its only read policy is
 *
 *     plan_thumbnails_tenant_read … to authenticated …
 *       exists (select 1 from projects p
 *                where p.id::text = split_part(name,'/',1)
 *                  and p.tenant_id = any (auth_tenant_ids()))
 *
 * — measured on prod 2026-09-11. **`anon` has no policy on that bucket at all**,
 * so an anonymous browser cannot sign or fetch a single page, and Postgres
 * cannot sign a Storage URL either, so the RPC could never have handed one
 * over. The two alternatives were both worse:
 *
 *   · a service-role key in the page → a full database bypass handed to anyone
 *     who opens devtools. §A5 says stop and report if it would come to that,
 *     and it does not have to;
 *   · an `anon` read policy on the bucket scoped to live tokens → a migration
 *     (which this ticket is told not to write), and it would grant a token
 *     holder every object under that project's folder, not that set's pages.
 *
 * ★★★ THE FUNCTION TAKES A **TOKEN AND NOTHING ELSE.** It re-resolves the token
 *     itself and derives the object paths from the row it gets back. It never
 *     accepts a path from the caller — a signing endpoint that signs what it is
 *     handed is an open proxy onto the bucket, whatever it checks first.
 *
 * ★★ AND IT IS NOT DEPLOYED YET. `supabase functions deploy plan-share
 *    --no-verify-jwt` is the whole step; until it runs, this page renders the
 *    set's name, its page count and its expiry, and says the pages could not be
 *    loaded. See `supabase/functions/plan-share/README.md`.
 */
export function usePlanShareResolve(token: string | undefined) {
  return useQuery<ResolvedPlanShare | null>({
    queryKey: ['planShare', token ?? ''],
    enabled: Boolean(token),
    // ★ A live link resolves to the CURRENT set (§A1), so this must not be
    //   cached for the session — but a builder scrolling a 13-page set should
    //   not re-sign on every render either.
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bp_resolve_plan_share', {
        p_token: token,
      });
      if (error) throw error;
      const rows = (Array.isArray(data) ? data : data ? [data] : []) as PlanShareRow[];
      // ★★★ ZERO ROWS IS THE ONLY ANSWER FOR ALL FOUR CAUSES — expired,
      //     revoked, set gone, never existed. Returning `null` here and one
      //     state above is what keeps them indistinguishable.
      const row = rows[0];
      if (!row) return null;

      const paths = planSharePagePaths(row.pages_prefix, row.page_count);
      let pageUrls: string[] = [];
      let thumbUrl: string | null = null;
      let pdfUrl: string | null = null;
      let pdfBytes: number | null = null;
      try {
        const { data: signed, error: fnErr } = await supabase.functions.invoke<{
          pages?: string[];
          thumb?: string | null;
          pdf?: string | null;
          pdfBytes?: number | null;
        }>(PLAN_SHARE_FUNCTION, { body: { token } });
        if (!fnErr && signed) {
          pageUrls = Array.isArray(signed.pages) ? signed.pages : [];
          thumbUrl = signed.thumb ?? null;
          pdfUrl = signed.pdf ?? null;
          pdfBytes = typeof signed.pdfBytes === 'number' ? signed.pdfBytes : null;
        }
      } catch {
        // ★ A signing failure is not a dead link. The page still names the set,
        //   its page count and its expiry — the same discipline fix-358 applied
        //   to this card: a missing picture must never look like a missing
        //   document.
        pageUrls = [];
      }
      // ★ Never more URLs than the set has pages, whatever the function says.
      if (pageUrls.length > paths.length) pageUrls = pageUrls.slice(0, paths.length);
      return { row, pageUrls, thumbUrl, pdfUrl, pdfBytes };
    },
  });
}

// ---------------------------------------------------------------------------
// ★★★ ONE PLACE THAT MINTS, SO THE THREE CONTROLS CANNOT SEND THREE THINGS
// ---------------------------------------------------------------------------
//
// Copy link, Email it… and the enlarged view's Share button all hand over the
// SAME URL for the same set. fix-522 already collapsed the first two onto one
// `sharePath()` for exactly this reason — *"two controls resolving it
// separately is how they end up sending different things"* — and the viewer's
// button was the third, still signing a Storage object on its own.
//
// ★ It lives in a hook rather than in `lib/` because minting is a mutation, and
//   the alternative (a lib function taking a client) would put the RPC name in
//   two places.

export interface PlanShareActions {
  /** Mint (or re-fetch) this set's link and copy it. */
  copy(setType: string, variant: string | null): Promise<void>;
  /** Mint (or re-fetch) this set's link and open a mail client on it. */
  email(
    setType: string,
    variant: string | null,
    buttonLabel: string,
    fileName: string | null,
    pageCount: number,
  ): Promise<void>;
  /** ★★★ §A2 — stop sharing. */
  unshare(token: string): Promise<void>;
  /** The live links on this project, for deciding whether Unshare is offered. */
  links: PlanShareLinkRow[] | undefined;
}

export function usePlanShareActions(projectId: string): PlanShareActions {
  const create = useCreatePlanShare();
  const revoke = useRevokePlanShare();
  const linksQ = usePlanShareLinks(projectId);

  async function mint(setType: string, variant: string | null): Promise<string> {
    const { token } = await create.mutateAsync({ projectId, setType, variant });
    // ★ The origin is read HERE and nowhere else. The URL a person is handed
    //   has to be the host they are already on — a constant would be wrong in
    //   preview builds and on localhost, and a builder pasting a link from a
    //   preview host into a real conversation is the failure that follows.
    return planShareUrl(window.location.origin, token);
  }

  return {
    links: linksQ.data,

    async copy(setType, variant) {
      try {
        const url = await mint(setType, variant);
        await navigator.clipboard.writeText(url);
        pushToast(SHARE_TOAST, 'success');
      } catch {
        // ★ ONE message for both failures — minting and copying. A person who
        //   cannot share does not need to know which half refused, and naming
        //   the error would leak a project id or a storage path.
        pushToast('Could not create the share link', 'error');
      }
    },

    async email(setType, variant, buttonLabel, fileName, pageCount) {
      try {
        const url = await mint(setType, variant);
        const subject = planShareSubject(fileName, buttonLabel);
        const body = planShareBody(fileName, buttonLabel, url, pageCount);
        // ★★ `assign()` rather than `location.href = …` — the React Compiler
        //    rejects assigning to a value it did not create ("This value cannot
        //    be modified"), and only LINT catches it.
        window.location.assign(planShareMailto(subject, body));
      } catch {
        pushToast('Could not create the share link', 'error');
      }
    },

    async unshare(token) {
      try {
        const ok = await revoke.mutateAsync({ projectId, token });
        pushToast(
          ok ? UNSHARE_TOAST : 'That link had already stopped working',
          ok ? 'success' : 'info',
        );
      } catch {
        pushToast('Could not stop sharing that link', 'error');
      }
    },
  };
}
