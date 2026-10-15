import { boldRuns, isGuideMediaPath } from '../../lib/guide';
import { mediaKind } from '../../lib/whatsNew';
import { useSignedGuideMediaUrl } from '../../hooks/useGuide';

// fix-670 — the small pieces the guide's reader AND its editor both render.

/** ★ `**bold**` → <strong>; everything else is plain text React escapes. */
export function GuideText({ text }: { text: string }) {
  return (
    <>
      {boldRuns(text).map((r, i) =>
        r.bold ? (
          <strong key={i} className="font-bold">
            {r.text}
          </strong>
        ) : (
          <span key={i}>{r.text}</span>
        ),
      )}
    </>
  );
}

/** The step tag, in WORDS. `--color-ok` family = the Bridge, `--color-wa`
 *  family = a person. Both AA on their own background (index.css). */
export function WhoTag({ who }: { who: 'tool' | 'you' }) {
  return who === 'tool' ? (
    <span
      className="inline-block flex-none text-[9px] font-extrabold tracking-[0.06em] px-1.5 py-px rounded border border-ok-border bg-ok-bg text-ok"
      data-testid="guide-who-tool"
    >
      THE BRIDGE
    </span>
  ) : (
    <span
      className="inline-block flex-none text-[9px] font-extrabold tracking-[0.06em] px-1.5 py-px rounded border border-wa-border bg-wa-bg text-wa"
      data-testid="guide-who-you"
    >
      YOU
    </span>
  );
}

/** A step's GIF / screenshot / clip. A bucket path is signed (useAvatars'
 *  pattern); an https or app path is used as it is. Lazy either way. */
export function GuideMedia({ media, alt }: { media: string; alt: string }) {
  const isPath = isGuideMediaPath(media);
  const signed = useSignedGuideMediaUrl(isPath ? media : null);
  const src = isPath ? signed.data ?? null : media;
  if (!src) return null;
  return mediaKind(media) === 'video' ? (
    <video
      src={src}
      controls
      muted
      preload="none"
      aria-label={alt}
      className="w-full max-w-[640px] rounded border border-border mt-1.5"
      data-testid="guide-media-video"
    />
  ) : (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className="w-full max-w-[640px] rounded border border-border mt-1.5"
      data-testid="guide-media-img"
    />
  );
}

