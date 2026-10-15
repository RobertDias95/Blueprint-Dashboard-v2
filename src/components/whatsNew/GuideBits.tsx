import { useContext, useEffect, useRef, useState } from "react";
import { boldRuns, highlightRuns, isGuideMediaPath } from "../../lib/guide";
import { mediaKind } from "../../lib/whatsNew";
import { useSignedGuideMediaUrl } from "../../hooks/useGuide";
import { GuideHighlight, drawFirstFrame } from "./guideView";

// fix-670 — the small pieces the guide's reader AND its editor both render.

/** Plain text with the search's words in <mark> — React elements, never HTML. */
function Marked({ text }: { text: string }) {
  const words = useContext(GuideHighlight);
  if (words.length === 0) return <>{text}</>;
  return (
    <>
      {highlightRuns(text, words).map((r, i) =>
        r.mark ? (
          <mark key={i} className="bg-wa-bg text-text rounded-sm px-px">
            {r.text}
          </mark>
        ) : (
          <span key={i}>{r.text}</span>
        ),
      )}
    </>
  );
}

/** ★ `**bold**` → <strong>; everything else is plain text React escapes.
 *  ★ fix-673: inside a Guide search, the matched words are <mark>ed too. */
export function GuideText({ text }: { text: string }) {
  return (
    <>
      {boldRuns(text).map((r, i) =>
        r.bold ? (
          <strong key={i} className="font-semibold text-text">
            <Marked text={r.text} />
          </strong>
        ) : (
          <span key={i}>
            <Marked text={r.text} />
          </span>
        ),
      )}
    </>
  );
}

/** The step tag, in WORDS. `--color-ok` family = the Bridge, `--color-wa`
 *  family = a person. Both AA on their own background (index.css). */
export function WhoTag({ who }: { who: "tool" | "you" }) {
  return who === "tool" ? (
    <span
      className="inline-block self-start flex-none text-[10.5px] font-bold tracking-[0.06em] px-[7px] py-px rounded-md bg-ok-bg text-ok"
      data-testid="guide-who-tool"
    >
      THE BRIDGE
    </span>
  ) : (
    <span
      className="inline-block self-start flex-none text-[10.5px] font-bold tracking-[0.06em] px-[7px] py-px rounded-md bg-wa-bg text-wa"
      data-testid="guide-who-you"
    >
      YOU
    </span>
  );
}

/** Signed URL for a bucket path; an https or app path is used as it is. */
function useMediaSrc(media: string): string | null {
  const isPath = isGuideMediaPath(media);
  const signed = useSignedGuideMediaUrl(isPath ? media : null);
  return isPath ? (signed.data ?? null) : media;
}

/** A step's GIF / screenshot / clip, as the EDITOR previews it. A bucket path
 *  is signed (useAvatars' pattern); an https or app path is used as it is. */
export function GuideMedia({ media, alt }: { media: string; alt: string }) {
  const src = useMediaSrc(media);
  if (!src) return null;
  return mediaKind(media) === "video" ? (
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

/** ▶ — inline SVG, no icon font (§C). */
export function PlayGlyph({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

/**
 * ★★ A GIF's first frame on a canvas. If the image will not load or the
 * canvas will not draw, the <img> itself is shown instead, under the same
 * Watch pill (the brief's fallback) — a still that may move beats a hole.
 */
function FirstFrame({ src }: { src: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (live && !drawFirstFrame(canvasRef.current, img)) setFailed(true);
    };
    img.onerror = () => {
      if (live) setFailed(true);
    };
    img.src = src;
    return () => {
      live = false;
      img.onload = null;
      img.onerror = null;
    };
  }, [src]);
  if (failed) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        className="block w-full h-full object-cover"
        data-testid="guide-clip-fallback"
      />
    );
  }
  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="block w-full h-full object-cover"
      data-testid="guide-clip-canvas"
    />
  );
}

/**
 * ★★★ fix-673 §D — THE STILL. A step's clip in its card: the first frame, a
 * dark "▶ Watch" pill, and the whole thing one button. Nothing here plays.
 *
 * ★★★ NO `autoPlay`, ever. A video asks only for its metadata, so Chrome
 *     paints a frame; `#t=0.1` nudges it past a black first frame. A GIF is
 *     drawn once to a canvas (FirstFrame) — never an animating <img>.
 */
export function ClipStill({
  media,
  title,
  onPlay,
  testid,
}: {
  media: string;
  title: string;
  onPlay: (el: HTMLButtonElement) => void;
  testid?: string;
}) {
  const src = useMediaSrc(media);
  const kind = mediaKind(media);
  return (
    <button
      type="button"
      onClick={(e) => onPlay(e.currentTarget)}
      aria-label={`Play: ${title}`}
      className="relative block w-full aspect-[2/1] bg-s2 border-0 p-0 cursor-zoom-in overflow-hidden group focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-de focus-visible:outline-offset-2"
      data-testid={testid ?? "guide-clip-still"}
      data-kind={kind}
    >
      {src &&
        (kind === "video" ? (
          <video
            src={`${src}#t=0.1`}
            preload="metadata"
            muted
            playsInline
            tabIndex={-1}
            aria-hidden="true"
            className="block w-full h-full object-cover pointer-events-none"
            data-testid="guide-clip-video"
          />
        ) : (
          <FirstFrame key={src} src={src} />
        ))}
      <span
        className="absolute left-3.5 bottom-3.5 flex items-center gap-2 rounded-full pl-2.5 pr-3.5 py-[7px] text-[13px] font-semibold text-white bg-[rgba(29,29,31,0.78)] group-hover:bg-[rgba(29,29,31,0.92)] backdrop-blur-[6px]"
        data-testid="guide-clip-watch"
      >
        <PlayGlyph />
        Watch
      </span>
    </button>
  );
}
