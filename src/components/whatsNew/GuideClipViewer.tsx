import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { isGuideMediaPath, type GuideClip } from "../../lib/guide";
import { mediaKind } from "../../lib/whatsNew";
import { useSignedGuideMediaUrl } from "../../hooks/useGuide";
import { GuideText } from "./GuideBits";

// ===========================================================================
// ★★★ fix-673 §D — THE CLIP VIEWER
// ===========================================================================
//
// Bobby: "It'd be nice if they were all paused and then you clicked on one and
// it expanded it and played it, because right now it's kind of hard to see in
// the size that it's at."
//
// ★★ It plays because somebody clicked — the one place in the Guide anything
//    moves, which is also why prefers-reduced-motion needs nothing extra here.
// ★★ Previous / Next walk the clips IN THE CURRENT FILTER (and search), and
//    wrap. ← → step, Esc closes, a click on the dark backdrop closes.
// ★ Escape is heard on the DOCUMENT — a keydown on a div that has no focus
//   never fires (fix-440).

function ViewerMedia({ clip }: { clip: GuideClip }) {
  const isPath = isGuideMediaPath(clip.media);
  const signed = useSignedGuideMediaUrl(isPath ? clip.media : null);
  const src = isPath ? (signed.data ?? null) : clip.media;
  const videoRef = useRef<HTMLVideoElement>(null);
  const isVideo = mediaKind(clip.media) === "video";

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src) return;
    try {
      const p = v.play();
      if (p && typeof p.catch === "function") p.catch(() => undefined);
    } catch {
      /* the controls are there; a refused play is the person's to retry */
    }
    // ★★ On close (or on Next): pause and UNLOAD, so a closed viewer is not
    //    still streaming a clip nobody can see.
    return () => {
      try {
        v.pause();
        v.removeAttribute("src");
        v.load();
      } catch {
        /* best-effort */
      }
    };
  }, [src]);

  if (!src)
    return <div className="w-full aspect-video rounded-[14px] bg-black" />;
  return isVideo ? (
    <video
      ref={videoRef}
      src={src}
      controls
      loop
      muted
      playsInline
      aria-label={clip.title}
      className="block w-full max-h-[72vh] rounded-[14px] bg-black object-contain"
      data-testid="guide-viewer-video"
    />
  ) : (
    <img
      src={src}
      alt={clip.title}
      className="block w-full max-h-[72vh] rounded-[14px] bg-black object-contain"
      data-testid="guide-viewer-img"
    />
  );
}

export default function GuideClipViewer({
  clips,
  index,
  onIndex,
  onClose,
}: {
  clips: GuideClip[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const n = clips.length;
  const clip = clips[index];
  const step = (d: -1 | 1) => onIndex((index + d + n) % n);

  // Focus moves INTO the viewer; the caller puts it back on the still.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight" && n > 1) {
        e.preventDefault();
        onIndex((index + 1) % n);
      } else if (e.key === "ArrowLeft" && n > 1) {
        e.preventDefault();
        onIndex((index - 1 + n) % n);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, n, onIndex, onClose]);

  // Body scroll is locked while it is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!clip) return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Clip viewer"
      className="fixed inset-0 z-[9400] flex items-center justify-center bg-black/90 px-4 py-5"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="guide-viewer"
    >
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        className="fixed top-4 right-4 text-[14px] font-semibold text-white bg-white/15 hover:bg-white/25 border-0 rounded-full px-3.5 py-2 cursor-pointer"
        data-testid="guide-viewer-close"
      >
        Close ✕
      </button>
      <div className="w-full max-w-[1180px] flex flex-col gap-3.5">
        <ViewerMedia key={clip.key} clip={clip} />
        <div className="flex flex-col min-[861px]:flex-row gap-4 items-start text-[#f5f5f7]">
          <div className="min-w-0">
            <h2
              className="text-[19px] font-semibold m-0 mb-1"
              data-testid="guide-viewer-title"
            >
              {clip.title}
            </h2>
            {clip.text && (
              <p className="m-0 text-[15px] text-[#c7c7cc] max-w-[72ch]">
                <GuideText text={clip.text} />
              </p>
            )}
            <div
              className="text-[12.5px] text-[#a1a1a6] mt-1.5"
              data-testid="guide-viewer-count"
            >
              {clip.chapter} · clip {index + 1} of {n}
            </div>
          </div>
          {n > 1 && (
            <div className="min-[861px]:ml-auto flex gap-2 flex-none">
              <button
                type="button"
                onClick={() => step(-1)}
                className="text-[14px] font-semibold text-white bg-white/15 hover:bg-white/25 border-0 rounded-full px-3.5 py-2 cursor-pointer"
                data-testid="guide-viewer-prev"
              >
                ‹ Previous
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                className="text-[14px] font-semibold text-white bg-white/15 hover:bg-white/25 border-0 rounded-full px-3.5 py-2 cursor-pointer"
                data-testid="guide-viewer-next"
              >
                Next ›
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
