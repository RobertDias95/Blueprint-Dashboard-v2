import { useRef, useState } from 'react';
import { Avatar } from '../ProjectDetail/ChatMessageBody';
import { useAvatarPathFor, useSetAvatar } from '../../hooks/useAvatars';
import { AVATAR_LIMIT_HINT, ALLOWED_AVATAR_TYPES } from '../../lib/avatars';

// ===========================================================================
// ★★★ fix-505 §B (P-162) — ONE PICTURE CONTROL, TWO PLACES
// ===========================================================================
//
// Bobby, 2026-09-04: *"in settings, if we can have the option to upload our
// headshot or profile picture."*
//
// ★★ IT IS ONE COMPONENT BECAUSE THE TWO PLACES ARE THE SAME CONTROL WITH A
//    DIFFERENT SUBJECT: Settings → Account sets your own, Settings → Team →
//    person sets somebody else's. Writing it twice would be two upload paths,
//    two refusal messages, and two chances to disagree about the limits.
//
// ★★★ THE PREVIEW IS `<Avatar>`, NOT A SECOND RENDERER. What you see before
//     you upload has to be what everyone else will see afterwards — the same
//     circle, the same crop, the same initials fallback. A bespoke preview is
//     how "it looked fine in Settings" becomes a support question.
//
// ★ WHAT IT DOES NOT DO: crop, rotate or adjust. The resize is centre-cropped
//   and automatic (lib/avatarImage). A cropping UI is a real feature and a
//   different ticket; shipping a bad one is worse than shipping none.

export default function AvatarControl({
  /** Whose picture. Null when the roster row has no login — see `noLoginNote`. */
  profileId,
  /** The name the circle draws from, so the preview matches every other circle. */
  name,
  /** False for a non-admin looking at somebody else: the picture shows, the
   *  buttons do not. */
  canEdit,
  /** Shown INSTEAD of the buttons when a roster row has no login at all. */
  noLoginNote,
  testId = 'avatar-control',
}: {
  profileId: string | null;
  name: string | null | undefined;
  canEdit: boolean;
  noLoginNote?: string;
  testId?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pathFor = useAvatarPathFor();
  const setAvatar = useSetAvatar();
  const [error, setError] = useState<string | null>(null);

  const currentPath = pathFor(name);
  const busy = setAvatar.isPending;

  function pick() {
    setError(null);
    inputRef.current?.click();
  }

  async function onFile(file: File | null) {
    if (!file || !profileId) return;
    setError(null);
    try {
      await setAvatar.mutateAsync({ profileId, file, currentPath });
    } catch (e) {
      // ★★ SHOWN BY NAME, HERE, as well as in the toast the mutation raises.
      //    A toast is gone in four seconds and this is a form somebody is
      //    working in — the reason has to stay next to the control that
      //    refused.
      setError(e instanceof Error ? e.message : 'Could not save the picture.');
    } finally {
      // ★ Clear the input so picking the SAME file again still fires `change`.
      //   Without this, a person who fixed a too-large photo and re-picked the
      //   same filename would get no response at all.
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove() {
    if (!profileId) return;
    setError(null);
    try {
      await setAvatar.mutateAsync({ profileId, file: null, currentPath });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the picture.');
    }
  }

  return (
    <div className="flex items-start gap-3" data-testid={testId}>
      {/* ★ 48px here — big enough to judge a headshot by, and the same
          component that draws it at 22 and 28 elsewhere. */}
      <Avatar name={name} size={48} titled />

      <div className="min-w-0 space-y-1.5">
        {noLoginNote ? (
          <p className="text-[11px] text-dim italic" data-testid={`${testId}-no-login`}>
            {noLoginNote}
          </p>
        ) : canEdit ? (
          <>
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="file"
                // ★ The picker offers exactly what the bucket accepts, so the
                //   common refusal never happens — the check behind it is for
                //   a drag-and-drop or a renamed file, not for the usual path.
                accept={ALLOWED_AVATAR_TYPES.join(',')}
                className="hidden"
                onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
                data-testid={`${testId}-input`}
              />
              <button
                type="button"
                onClick={pick}
                disabled={busy || !profileId}
                className="text-[11px] font-bold px-2 py-1 rounded border border-border bg-surface text-muted disabled:opacity-40"
                data-testid={`${testId}-upload`}
              >
                {busy ? 'Saving…' : currentPath ? 'Replace' : 'Upload'}
              </button>
              {currentPath && (
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={busy}
                  className="text-[11px] text-muted hover:text-er disabled:opacity-40"
                  data-testid={`${testId}-remove`}
                >
                  Remove
                </button>
              )}
            </div>
            <p className="text-[10.5px] text-dim">{AVATAR_LIMIT_HINT}</p>
          </>
        ) : (
          <p className="text-[11px] text-dim italic" data-testid={`${testId}-readonly`}>
            Only {name ?? 'this person'} or an admin can change this picture.
          </p>
        )}

        {error && (
          <p className="text-[11px] text-er" data-testid={`${testId}-error`}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
