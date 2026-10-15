import type { TeamRole } from './database.types';
import { ROLE_TITLE, rosterRoleTitle } from './roleLabels';

// ===========================================================================
// ★★★ fix-436 (P-086) — the client half of "add a person"
// ===========================================================================
//
// The decisions all live in the Edge Function (supabase/functions/
// admin-create-user/handler.ts) because they must hold whatever the browser
// sends. What lives here is what the SCREEN needs: the field list, a password
// generator, and the name-plate preview.
//
// ★★★ THE PREVIEW IS THE POINT OF THE ROSTER FIELDS. `resolveRosterIdentity`
// (lib/selfScope) matches the auth email to `team_members.email` — trimmed and
// lowercased — and Chrome's user chip then prints the row's `name` above
// `rosterRoleTitle(roles, notes)`. So the roster row is not paperwork: without
// it a new person signs in and the Bridge shows them "Signed in / Blueprint
// Services" and no work. Showing Bobby the plate BEFORE he submits is how he
// catches "I picked the wrong role" while it still costs nothing.
//
// ★ The preview is built from the SAME functions Chrome uses, not a copy of
// them, so a change to the title rules moves both.

/** ★ fix-343's rule, reproduced exactly: `notes` becomes the printed title
 *  only for `viewer`, and any real role prints ROLE_TITLE instead. */
export function namePlatePreview(
  name: string,
  role: TeamRole,
  notes: string | null,
): { name: string; title: string } {
  const plate = rosterRoleTitle([role], notes);
  return {
    name: name.trim() || '—',
    // ★ The same fallback the chip renders when a person has no printable
    //   title — a `viewer` with an empty note is the one case that reaches it.
    title: plate ?? 'Blueprint Services',
  };
}

/** Roster roles offered by the screen, most-used first, with their job titles.
 *  ★ `viewer` is last and carries its own hint: it is not a job, it is the
 *  absence of one, and the person's real function goes in the title field. */
export const ADD_PERSON_ROLE_OPTIONS: ReadonlyArray<{
  value: TeamRole;
  label: string;
}> = (
  [
    'da',
    'dm',
    'ent',
    'ent_lead',
    'schematic',
    'acq',
    'acq_lead',
    // ★★★ fix-487: WITHOUT THIS LINE BOBBY CANNOT CREATE A CONSTRUCTION ADMIN
    //     AT ALL, and nothing would have failed to compile — this array is
    //     hand-written, not derived from `TeamRole`. The suite asserts it
    //     covers the union exactly, which is the only thing that catches it.
    'ca',
    'director',
    'viewer',
  ] as const
).map((value) => ({ value, label: ROLE_TITLE[value] }));

/** ★ Deliberately unambiguous: no I/l/1, no O/0. Bobby reads this aloud or
 *  types it into a chat, because there is no mail to send it in (P-092). */
const PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export const GENERATED_PASSWORD_LENGTH = 16;

export function generatePassword(
  random: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32,
): string {
  let out = '';
  for (let i = 0; i < GENERATED_PASSWORD_LENGTH; i++) {
    out += PASSWORD_ALPHABET[Math.floor(random() * PASSWORD_ALPHABET.length)];
  }
  return out;
}

/**
 * ★★ C3 — READABLE ERRORS, AND THE FUNCTION ALREADY WROTE THEM.
 *
 * The Edge Function returns `{ code, message }` with the message already in
 * plain language, so this exists for the case the response never arrived (the
 * function is not deployed yet, the network died) — the one situation where the
 * browser has to invent the sentence itself.
 */
export function addPersonNetworkMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  if (/not\s*found|404/i.test(raw)) {
    return 'The add-person service is not deployed yet. Nothing was created.';
  }
  return `Could not reach the add-person service — ${raw || 'no response'}. Nothing was created.`;
}

// ===========================================================================
// ★★★ fix-670 §B (P-351) — THE DEPARTMENT, DEFAULTED FROM THE ROLE
// ===========================================================================
//
// Blake was created on 2026-10-13 with department = NULL because the dialog had
// no picker. Now it has one, defaulted from the role — except `viewer`, which
// has NO default and must be picked: for somebody from another department who
// views the Bridge, the department IS their label (fix-652: it wins on the name
// plate). That is the whole point of the picker.

export const DEFAULT_DEPARTMENT_FOR_ROLE: Readonly<Record<TeamRole, string | null>> = {
  da: 'design_entitlements',
  dm: 'design_entitlements',
  ent: 'design_entitlements',
  ent_lead: 'design_entitlements',
  schematic: 'design_entitlements',
  director: 'design_entitlements',
  acq: 'acquisitions',
  acq_lead: 'acquisitions',
  ca: 'construction_admin',
  viewer: null,
};

/**
 * ★★ "How you'll appear" — the line the dialog previews and the welcome email
 *    prints, built once so the two cannot disagree.
 *
 *    - viewer: their department (fix-652: it wins over the Title), else the
 *      Title, else "Blueprint Services" — "Greg · Underwriting".
 *    - everyone else: role title · department — "Sam · Design Associate ·
 *      Design & Permitting" (the approved email's wording).
 */
export function welcomePlate(
  name: string,
  role: TeamRole,
  notes: string | null,
  departmentWords: string | null,
): { name: string; title: string; line: string } {
  const shown = name.trim() || '—';
  let title: string;
  if (role === 'viewer') {
    title =
      (departmentWords ?? '').trim() || (notes ?? '').trim() || 'Blueprint Services';
  } else {
    title = [ROLE_TITLE[role], (departmentWords ?? '').trim()].filter(Boolean).join(' · ');
  }
  return { name: shown, title, line: `${shown} · ${title}` };
}
