import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import {
  ALLOWED_AVATAR_TYPES,
  AVATAR_BUCKET,
  MAX_AVATAR_BYTES,
  avatarExtFor,
  avatarObjectPath,
  avatarPathFor,
  buildAvatarIndex,
  refuseAvatarSize,
  refuseAvatarType,
} from '../lib/avatars';
import { centreSquare, targetEdge } from '../lib/avatarImage';
import type { TeamMember } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-505 (P-162) — PROFILE PICTURES
// ===========================================================================
//
// Bobby, 2026-09-04: *"in settings, if we can have the option to upload our
// headshot or profile picture, and then that would display at the top right,
// and then in our teams… where it says our name or letters for our first and
// last name, it would show our picture there."*

const T = 'tenant-uuid';
const ME = 'me-uuid';

const rpc = vi.hoisted(() => vi.fn());
const signedUrl = vi.hoisted(() => vi.fn());
const upload = vi.hoisted(() => vi.fn());
const removeObj = vi.hoisted(() => vi.fn());
const teamRef = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc,
    storage: {
      from: () => ({
        createSignedUrl: signedUrl,
        upload,
        remove: removeObj,
      }),
    },
  },
}));
vi.mock('../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({ all: teamRef.current, activeDas: [], isLoading: false }),
  activeMemberNamesOf: () => [],
}));

import { Avatar } from '../components/ProjectDetail/ChatMessageBody';
import { useAvatarIndex } from '../hooks/useAvatars';

const ROSTER = [
  { name: 'Bobby', first_name: 'Bobby', last_name: 'Dias', role: 'ent' },
  { name: 'Cam', first_name: 'Cam', last_name: 'Cooper', role: 'da' },
] as unknown as TeamMember[];

beforeEach(() => {
  rpc.mockReset();
  signedUrl.mockReset();
  upload.mockReset();
  removeObj.mockReset();
  teamRef.current = ROSTER;
  useAuthStore.setState({
    activeTenantId: T,
    user: { id: ME, email: 'bobby@test', role: 'admin' },
    memberships: [{ tenant_id: T, role: 'admin' }],
  } as never);
  rpc.mockImplementation((fn: string) => {
    if (fn === 'bp_avatar_paths') {
      return Promise.resolve({
        data: [{ name: 'Bobby', avatar_path: `${T}/${ME}.jpg`, avatar_updated_at: null }],
        error: null,
      });
    }
    if (fn === 'bp_profile_id_for_roster_name') {
      return Promise.resolve({ data: ME, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
  signedUrl.mockResolvedValue({
    data: { signedUrl: 'https://signed.example/pic.jpg' },
    error: null,
  });
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// ---------------------------------------------------------------------------
// ★★★ THE MISMATCH THIS FEATURE TURNS ON
// ---------------------------------------------------------------------------

describe('fix-505: the avatar index carries the key AND the full name', () => {
  it('★★★ a lookup on EITHER string finds the same path', () => {
    // ★★★ THE BUG THIS PREVENTS, AND IT WOULD HAVE BEEN SILENT. `<Avatar>` is
    //     handed `fullNameOf(rosterKey)` — "Bobby Dias" (register #127:
    //     initialsOf('Bobby') drew BO, so fix-343 made every circle resolve the
    //     full name first). `bp_avatar_paths()` returns the roster KEY,
    //     "Bobby". An index on either alone matches NOTHING in the running app.
    const index = buildAvatarIndex(
      [{ name: 'Bobby', avatar_path: 'p/bobby.jpg' }],
      ROSTER,
    );
    expect(avatarPathFor(index, 'Bobby')).toBe('p/bobby.jpg');
    expect(avatarPathFor(index, 'Bobby Dias')).toBe('p/bobby.jpg');
    // ★ Case-insensitive: two tables, two people typing.
    expect(avatarPathFor(index, 'bobby dias')).toBe('p/bobby.jpg');
    expect(avatarPathFor(index, 'Cam')).toBeNull();
    expect(avatarPathFor(index, null)).toBeNull();
  });

  it('★★ a login with no roster row still indexes, under the name it has', () => {
    // 37 logins, 36 with a roster row. The 37th resolves to its email's local
    // part — which is exactly what its chat messages carry as author_name.
    const index = buildAvatarIndex([{ name: 'keenan', avatar_path: 'p/k.jpg' }], ROSTER);
    expect(avatarPathFor(index, 'keenan')).toBe('p/k.jpg');
  });

  it('★★ rows with no path are omitted, so "not found" has one meaning', () => {
    const index = buildAvatarIndex(
      [{ name: 'Bobby', avatar_path: '' }, { name: '', avatar_path: 'x' }],
      ROSTER,
    );
    expect(index.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §C — the Avatar itself
// ---------------------------------------------------------------------------

describe('fix-505 §C: Avatar renders the picture, or the letters', () => {
  it('★★★ with a resolved path it renders an <img> at the signed URL, no initials', async () => {
    wrap(<Avatar name="Bobby Dias" />);
    const img = await screen.findByTestId('chat-avatar-img');
    expect(img.getAttribute('src')).toBe('https://signed.example/pic.jpg');
    expect(screen.getByTestId('chat-avatar').textContent).toBe('');
    expect(screen.getByTestId('chat-avatar').getAttribute('data-has-picture')).toBe('true');
  });

  it('★★★ without a path it renders initials exactly as before', async () => {
    wrap(<Avatar name="Cam Cooper" />);
    await waitFor(() =>
      expect(screen.getByTestId('chat-avatar').textContent).toBe('CC'),
    );
    expect(screen.queryByTestId('chat-avatar-img')).toBeNull();
    // ★ And no signing call at all — `enabled` is the path.
    expect(signedUrl).not.toHaveBeenCalled();
  });

  it('★★★ a BROKEN image falls back to initials, not a broken-image glyph', async () => {
    wrap(<Avatar name="Bobby Dias" />);
    const img = await screen.findByTestId('chat-avatar-img');
    fireEvent.error(img);
    await waitFor(() =>
      expect(screen.getByTestId('chat-avatar').textContent).toBe('BD'),
    );
    expect(screen.queryByTestId('chat-avatar-img')).toBeNull();
  });

  it('★★★ ONE signing call for N circles of the same person', async () => {
    // ★★★ THE BRIEF MADE THIS A STOP CONDITION: "a 6-person Team card + a
    //     40-message chat would be ~50 requests". The signed-URL query is keyed
    //     on the PATH, so forty messages from one author sign once.
    wrap(
      <>
        {Array.from({ length: 12 }, (_, i) => (
          <Avatar key={i} name="Bobby Dias" />
        ))}
      </>,
    );
    await screen.findAllByTestId('chat-avatar-img');
    expect(signedUrl).toHaveBeenCalledTimes(1);
    // ★ …and ONE paths query behind every circle on the screen.
    expect(rpc.mock.calls.filter((c) => c[0] === 'bp_avatar_paths')).toHaveLength(1);
  });

  it('★★ `titled` semantics are unchanged — fix-467/468 pinned', async () => {
    // ★★★ THE CIRCLE IS THE ONLY IDENTITY IN THE CHAT HEADER (fix-467 §1), and
    //     a decoration beside a printed name in a message row (aria-hidden).
    //     fix-468: `title` overrides the tooltip while `name` still decides the
    //     letters. None of that moved.
    const { unmount } = wrap(
      <Avatar name="Cam Cooper" titled title="Design Associate · Cam Cooper" />,
    );
    await waitFor(() => {
      const el = screen.getByTestId('chat-avatar');
      expect(el.getAttribute('title')).toBe('Design Associate · Cam Cooper');
      expect(el.getAttribute('aria-label')).toBe('Design Associate · Cam Cooper');
      expect(el.getAttribute('aria-hidden')).toBeNull();
      expect(el.textContent).toBe('CC');
    });
    unmount();

    wrap(<Avatar name="Cam Cooper" />);
    await waitFor(() =>
      expect(screen.getByTestId('chat-avatar').getAttribute('aria-hidden')).toBe('true'),
    );
  });

  it('★★ the image alt follows `titled`, not the picture', async () => {
    // ★ An <img> whose alt repeats the name printed beside it is noise to a
    //   screen reader; the header circle has no such name and needs one.
    const { unmount } = wrap(<Avatar name="Bobby Dias" titled />);
    expect((await screen.findByTestId('chat-avatar-img')).getAttribute('alt')).toBe(
      'Bobby Dias',
    );
    unmount();
    wrap(<Avatar name="Bobby Dias" />);
    expect((await screen.findByTestId('chat-avatar-img')).getAttribute('alt')).toBe('');
  });

  it('★★ a missing RPC (pre-migration) leaves every circle on initials', async () => {
    // ★★★ THE STATE PROD IS IN UNTIL COWORK APPLIES THE MIGRATION. An undefined
    //     function must not throw a query error onto six surfaces at once.
    rpc.mockImplementation(() =>
      Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'function does not exist' } }),
    );
    wrap(<Avatar name="Bobby Dias" />);
    await waitFor(() =>
      expect(screen.getByTestId('chat-avatar').textContent).toBe('BD'),
    );
    expect(signedUrl).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// §A — the rules, mirrored against the migration
// ---------------------------------------------------------------------------

const MIGRATION = readFileSync(
  resolve(process.cwd(), 'migrations/fix_505_profile_pictures.sql'),
  'utf8',
);

describe('fix-505 §A: the limits the browser enforces are the bucket\'s', () => {
  it('★★★ the size limit and the type list MATCH the migration exactly', () => {
    // ★★ The fix-330 rule: a limit the browser enforces and the bucket does not
    //    (or the reverse) is a limit nobody can trust.
    expect(MIGRATION).toContain(String(MAX_AVATAR_BYTES));
    for (const t of ALLOWED_AVATAR_TYPES) {
      expect(MIGRATION, `bucket must allow ${t}`).toContain(`'${t}'`);
    }
    // ★★★ HEIC is on the CHAT bucket's list and must NOT be here: no browser
    //     canvas can decode it, so the resize would silently produce nothing.
    expect(ALLOWED_AVATAR_TYPES).not.toContain('image/heic' as never);
    const bucketBlock = MIGRATION.slice(
      MIGRATION.indexOf("'avatars',"),
      MIGRATION.indexOf('ON CONFLICT (id) DO UPDATE'),
    );
    expect(bucketBlock).not.toContain('heic');
  });

  it('★★★ the bucket is PRIVATE, and re-asserted on conflict', () => {
    expect(MIGRATION).toContain('false,');
    expect(MIGRATION).toContain('SET public = EXCLUDED.public');
  });

  it('★★★ bp_avatar_paths is SECURITY DEFINER — a view would return one row', () => {
    // ★★★ `profiles_read_own` is `USING ((auth.uid() = id) OR is_admin())`, so
    //     a security_invoker view returns the VIEWER'S OWN ROW and nothing
    //     else — every avatar but your own silently on initials, and an admin
    //     testing it would see everything work.
    const fn = MIGRATION.slice(MIGRATION.indexOf('CREATE FUNCTION public.bp_avatar_paths'));
    expect(fn).toContain('SECURITY DEFINER');
    expect(fn).toContain("SET search_path TO 'public'");
    expect(MIGRATION).toContain('GRANT EXECUTE ON FUNCTION public.bp_avatar_paths() TO authenticated');
    expect(MIGRATION).not.toMatch(/CREATE\s+(OR REPLACE\s+)?VIEW/i);
  });

  it('★★★ it resolves names through bp_profile_display_name, NOT profiles.name', () => {
    // ★★★ THE BRIEF'S JOIN RETURNS ZERO ROWS ON PROD: profiles.name and
    //     profiles.full_name are NULL on all 37 rows (measured 2026-09-08), so
    //     `profiles.name = team_members.name` matches nothing, forever.
    expect(MIGRATION).toContain('bp_profile_display_name(pr.id)');
    expect(MIGRATION).not.toMatch(/pr\.name\s*=\s*tm\.name/);
  });

  it('★★ the column write is an RPC that can express a path and nothing else', () => {
    expect(MIGRATION).toContain('bp_set_avatar_path(p_profile_id uuid, p_path text)');
    // ★★ SECURITY DEFINER bypasses RLS by construction, so the ownership rule
    //    the storage policy makes is asserted AGAIN here — the object and the
    //    column go through different doors.
    expect(MIGRATION).toContain('IF p_profile_id <> auth.uid() AND NOT public.is_admin()');
  });

  it('★★ INSERT and UPDATE are separate policies — an upsert is both', () => {
    // ★★★ A bucket that accepts the first upload and silently refuses every
    //     replacement is the failure this split prevents.
    expect(MIGRATION).toContain('avatars_own_or_admin_insert');
    expect(MIGRATION).toContain('avatars_own_or_admin_update');
    expect(MIGRATION).toContain('avatars_own_or_admin_delete');
  });

  it('★★ the path is {tenant}/{profile}.{ext} — both segments are policy tests', () => {
    expect(avatarObjectPath(T, ME, 'jpg')).toBe(`${T}/${ME}.jpg`);
    expect(MIGRATION).toContain("split_part(objects.name, '/', 1)::uuid = ANY (public.auth_tenant_ids())");
    expect(MIGRATION).toContain("split_part(split_part(objects.name, '/', 2), '.', 1) = auth.uid()::text");
  });
});

describe('fix-505 §B: refusals name the file and the reason', () => {
  it('★★★ a wrong type is refused by name, before any decoding', () => {
    expect(refuseAvatarType({ name: 'scan.pdf', type: 'application/pdf' })).toContain('scan.pdf');
    expect(refuseAvatarType({ name: 'me.heic', type: 'image/heic' })).toContain('JPEG, PNG or WebP');
    expect(refuseAvatarType({ name: 'me.jpg', type: 'image/jpeg' })).toBeNull();
  });

  it('★★★ the size is checked on the RESIZED blob, and says "after shrinking"', () => {
    // ★★ Refusing the ORIGINAL would reject the 6 MB phone photo the resize
    //    exists to accept — which is the whole point of resizing at all.
    expect(refuseAvatarSize('me.jpg', MAX_AVATAR_BYTES + 1)).toContain('after shrinking');
    expect(refuseAvatarSize('me.jpg', 120_000)).toBeNull();
  });

  it('★★ the extension comes from the MIME, never the filename', () => {
    expect(avatarExtFor('image/jpeg')).toBe('jpg');
    expect(avatarExtFor('image/png')).toBe('png');
    expect(avatarExtFor('image/webp')).toBe('webp');
    expect(avatarExtFor('image/heic')).toBeNull();
  });

  it('★★★ the resize centre-crops and NEVER upscales', () => {
    // ★ Square because every consumer draws a circle; centred because that is
    //   where a face is; never upscaled because a 200px picture blown up to 512
    //   looks worse at every size the app draws it.
    expect(centreSquare(1000, 600)).toEqual({ sx: 200, sy: 0, size: 600 });
    expect(centreSquare(600, 1000)).toEqual({ sx: 0, sy: 200, size: 600 });
    expect(targetEdge(4000)).toBe(512);
    expect(targetEdge(200)).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// §B — the upload path
// ---------------------------------------------------------------------------

describe('fix-505 §B: upload and remove', () => {
  it('★★★ Remove deletes the OBJECT first, then nulls the column', async () => {
    // ★★★ ORDER MATTERS. Column-first would leave a picture that is unreachable
    //     but still stored — invisible litter nobody can find to remove.
    const order: string[] = [];
    removeObj.mockImplementation(() => {
      order.push('object');
      return Promise.resolve({ data: null, error: null });
    });
    rpc.mockImplementation((fn: string) => {
      if (fn === 'bp_avatar_paths') return Promise.resolve({ data: [], error: null });
      if (fn === 'bp_set_avatar_path') {
        order.push('column');
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const { useSetAvatar } = await import('../hooks/useAvatars');
    function Harness() {
      const m = useSetAvatar();
      return (
        <button
          onClick={() => m.mutate({ profileId: ME, file: null, currentPath: 'p/x.jpg' })}
          data-testid="go"
        />
      );
    }
    wrap(<Harness />);
    fireEvent.click(screen.getByTestId('go'));
    await waitFor(() => expect(order).toEqual(['object', 'column']));
    expect(removeObj).toHaveBeenCalledWith(['p/x.jpg']);
  });

  it('★★ the upsert is what keeps one object per person', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/hooks/useAvatars.ts'),
      'utf8',
    );
    expect(src).toContain('upsert: true');
    // ★★ The path is derived from the profile id, so a re-upload overwrites and
    //    the bucket can never accumulate a person's old headshots.
    expect(src).toContain('avatarObjectPath(tenantId, profileId, ext)');
  });

  it('★★★ a re-upload clears the cached SIGNATURE, or the old image sticks', () => {
    // ★★★ The path does NOT change on a re-upload (that is the upsert rule), so
    //     the signed-URL cache — keyed on the path — would keep serving the OLD
    //     picture until the signature expired an hour later.
    const src = readFileSync(resolve(process.cwd(), 'src/hooks/useAvatars.ts'), 'utf8');
    expect(src).toContain("removeQueries({ queryKey: ['avatar_url'] })");
  });

  it('★ the bucket name is the one the migration creates', () => {
    expect(AVATAR_BUCKET).toBe('avatars');
    expect(MIGRATION).toContain("'avatars',\n  'avatars',");
  });
});

// ---------------------------------------------------------------------------
// The two Settings surfaces + the chip, asserted over the shipped source
// ---------------------------------------------------------------------------

describe('fix-505 §B/§C: where the control and the picture appear', () => {
  const account = readFileSync(
    resolve(process.cwd(), 'src/components/Settings/AdminAccountTab.tsx'),
    'utf8',
  );
  const dialog = readFileSync(
    resolve(process.cwd(), 'src/components/Settings/PersonDetailsDialog.tsx'),
    'utf8',
  );
  const chrome = readFileSync(
    resolve(process.cwd(), 'src/components/Chrome.tsx'),
    'utf8',
  );

  it('★★★ Account gets "Your picture", keyed on the viewer\'s own login id', () => {
    expect(account).toContain('Your picture');
    expect(account).toContain('profileId={user?.id ?? null}');
    // ★ The NAME is the roster name — the key bp_avatar_paths returns, not the
    //   email or the login id.
    expect(account).toContain('name={identity.name}');
    expect(account).toContain('canEdit');
  });

  it('★★★ the person dialog gates on the LOGIN first, then on admin', () => {
    // ★★★ "No login" is a fact about the PERSON and beats "you are not an
    //     admin", which is a fact about the viewer. Telling an editor they lack
    //     permission to do something nobody can do would send them to ask an
    //     admin who would also fail.
    expect(dialog).toContain('useProfileIdForRosterName');
    expect(dialog).toContain('canEdit={isAdmin && !!profileIdQ.data}');
    expect(dialog).toContain('No login — a picture can be set once they can sign in.');
  });

  it('★★★ the top-right chip shows the viewer\'s picture at 28px', () => {
    expect(chrome).toContain('<Avatar name={identity.name} size={28} />');
    // ★★ …and the comment says why a circle fix-331 §7 deliberately removed is
    //    back: that one was a control that did nothing; this is identity.
    expect(chrome).toContain('this is not a control');
  });

  it('★★ MentionTextarea keeps its own circle, and says why', () => {
    // ★ The one other hand-rolled `initialsOf` in src/. It is a 20px circle
    //   that also renders '@' for a TAG and switches colour for it — routing it
    //   through <Avatar> would mean teaching Avatar about tags and a second
    //   size for no gain. Left, with the reason recorded.
    const mention = readFileSync(
      resolve(process.cwd(), 'src/components/ProjectDetail/MentionTextarea.tsx'),
      'utf8',
    );
    expect(mention).toContain('fix-505');
    expect(mention).toContain('initialsOf(p.name)');
  });
});

// ---------------------------------------------------------------------------
// The index hook, end to end
// ---------------------------------------------------------------------------

describe('fix-505: useAvatarIndex', () => {
  it('★★ reads bp_avatar_paths once and indexes both names', async () => {
    let seen: Map<string, string> | null = null;
    function Probe() {
      seen = useAvatarIndex();
      return null;
    }
    wrap(<Probe />);
    await waitFor(() => expect(seen?.size).toBe(2));
    expect(seen!.get('bobby')).toBe(`${T}/${ME}.jpg`);
    expect(seen!.get('bobby dias')).toBe(`${T}/${ME}.jpg`);
  });
});
