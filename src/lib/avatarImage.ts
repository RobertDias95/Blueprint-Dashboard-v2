import { AVATAR_MAX_DIMENSION } from './avatars';

// ===========================================================================
// ★★★ fix-505 §B — THE CLIENT-SIDE RESIZE
// ===========================================================================
//
// ★★★ NO NEW DEPENDENCY. Checked package.json first: there is no image library
//     here and this needs about twenty lines of canvas. `createImageBitmap` +
//     `<canvas>` + `toBlob` is in every browser this app supports, and adding a
//     package to do it would be a supply-chain decision taken to save those
//     twenty lines.
//
// ★★ WHY RESIZE AT ALL, given the bucket enforces 2 MB. Because a phone
//    headshot is 4–8 MB and would be refused every time — the person's picture
//    is a photo they took, not a file they prepared. Resizing is what makes the
//    limit reachable rather than a wall.
//
// ★ SQUARE, CENTRE-CROPPED, because every consumer draws a circle. Letterboxing
//   a portrait into a square would put bars inside the circle; scaling it
//   without cropping would squash the face. Cropping to the centre of the
//   shorter edge is what a headshot wants and is what every other product does.

/** The largest centred square of a WxH image, as source-rect args. */
export function centreSquare(
  width: number,
  height: number,
): { sx: number; sy: number; size: number } {
  const size = Math.min(width, height);
  return {
    sx: Math.round((width - size) / 2),
    sy: Math.round((height - size) / 2),
    size,
  };
}

/** The edge length to draw at: the source square, capped. ★ NEVER UPSCALED — a
 *  200px picture stays 200px rather than being blown up to 512 and looking
 *  worse than the original at every size the app draws it. */
export function targetEdge(sourceSquare: number): number {
  return Math.min(sourceSquare, AVATAR_MAX_DIMENSION);
}

/**
 * Decode, centre-crop to a square, cap at 512, re-encode.
 *
 * ★ OUTPUT IS ALWAYS `image/jpeg`, whatever went in, and that is deliberate:
 *   it is the smallest of the three for a photograph, it is on the bucket's
 *   allow-list, and one output type means the object's extension is decided by
 *   this function rather than by whatever the person happened to pick.
 *   (A PNG screenshot of a face is not the case this feature is for.)
 *
 * ★★ IT THROWS RATHER THAN RETURNING THE ORIGINAL on a decode failure. Silently
 *    uploading a 6 MB file the bucket will refuse would turn a clear "this
 *    picture cannot be read" into a confusing storage error two seconds later.
 */
export async function resizeToSquareJpeg(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const { sx, sy, size } = centreSquare(bitmap.width, bitmap.height);
    const edge = targetEdge(size);
    const canvas = document.createElement('canvas');
    canvas.width = edge;
    canvas.height = edge;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, edge, edge);
    const blob = await new Promise<Blob | null>((resolve) =>
      // ★ 0.85 — the usual quality/size knee for photographs. At 512px it puts
      //   a headshot around 60–120 KB, comfortably inside 2 MB.
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    if (!blob) throw new Error('could not encode the picture');
    return blob;
  } finally {
    // ★ Release the decoded frame explicitly: a 4000×3000 bitmap is ~48 MB of
    //   memory and Settings is a screen people leave open.
    bitmap.close?.();
  }
}
