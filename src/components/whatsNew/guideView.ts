import { createContext } from "react";

// fix-673 — the non-component half of the Guide's view (kept out of the .tsx
// files so they export components only — the React Refresh lint rule).

/** ★ The words the Guide's own search lit up. GuideText reads it, so every
 *  title, summary, step and table cell highlights without a prop through
 *  every block. Empty = no search. */
export const GuideHighlight = createContext<readonly string[]>([]);

/**
 * ★★ fix-673 §D — draw a GIF's FIRST FRAME onto a canvas, once. A canvas never
 * animates, which is the whole point: the card shows a still, and the clip
 * plays only in the viewer, because somebody asked.
 *
 * ★ A cross-origin image TAINTS the canvas, and that is fine — nothing reads
 *   the pixels back. Returns false (the caller falls back to the <img> under
 *   the Watch pill) when there is no canvas, no 2-D context, no size, or the
 *   draw throws.
 */
export function drawFirstFrame(
  canvas: HTMLCanvasElement | null,
  img: { naturalWidth: number; naturalHeight: number } & CanvasImageSource,
): boolean {
  if (!canvas) return false;
  try {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return false;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, w, h);
    return true;
  } catch {
    return false;
  }
}
