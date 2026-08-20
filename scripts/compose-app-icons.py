#!/usr/bin/env python3
"""fix-369 — compose the installed-app icon set from the SHIPPED bridge mark.

    python scripts/compose-app-icons.py

★★★ THIS SCRIPT COMPOSES. IT DOES NOT DRAW.
fix-322's standing contract is that Bobby's artwork is REFERENCED, never
re-vectored, and a test greps the tree for `<path` / `viewBox` to keep it that
way. Every pixel of the mark below comes from public/bridge-icon-2026-256.png —
the square crop fix-351 shipped. All this script does is put an opaque ground
underneath it and resize.

★★★ WHY THERE WAS A BUG AT ALL — measured on the shipped file:
  · ink colour            #3C4B88 (dark navy)
  · MAXIMUM alpha         213/255 — not one pixel of the mark is fully opaque
  · fully transparent     88.3% of the canvas
Windows scales that against whatever is behind it. Bobby has a dark taskbar, so
dark navy at 84% opacity lands on near-black; Miles has a light one, which is
why it "works for Miles's computer". It was never dark mode — it was the
absence of a ground.

★★ WHY WHITE (#FFFFFF) IS THE GROUND.
The mark cannot be recoloured (that would be redrawing it), so the ground has to
be light or the navy disappears. White is also the exact condition under which
the mark is known to render correctly: it is what the header lockup sits on
inside the app, and it is what Miles's light taskbar was accidentally supplying.
Making the tile carry its own white ground gives every machine the appearance
that already worked on one of them — which is the actual requirement.

★★ WHY THE FILES CARRY NO ALPHA CHANNEL AT ALL.
Saved as PNG colour type 2 (truecolour, no alpha, no tRNS chunk). "Opaque" then
is not a property of the pixel values that a later edit could quietly undo — the
format has nowhere to put transparency. The test asserts the colour type, so the
bug cannot come back.

★★ THE MASKABLE SAFE ZONE.
A maskable icon may be cropped by the OS to any shape, with only the centre
circle of diameter 80% guaranteed. The mark's ink bounding box is 226x93 inside
the 256 canvas; its half-diagonal is 122.2px = 47.7% of the canvas, which does
NOT fit. Scaled to 83% it becomes 39.6% and does. So the maskable renderings
draw the source at 83% of the tile, centred; the `any` renderings use it
full-bleed, because nothing crops those.
"""
from __future__ import annotations
import os
from PIL import Image

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(HERE, 'public', 'bridge-icon-2026-256.png')
OUT = os.path.join(HERE, 'public')

GROUND = (255, 255, 255)
MASKABLE_SAFE_SCALE = 0.83

# ★ The sizes Chrome and Windows actually ask for. 192 and 512 are Chrome's
# installability floor; 256 is what Chrome hands Windows for the desktop
# shortcut .ico; 64 keeps a hand-checked small rendering rather than letting the
# OS downsample 512 to taskbar size.
ANY_SIZES = (64, 192, 256, 512)
MASKABLE_SIZES = (192, 512)


def _flatten(mark: Image.Image, size: int, inset: float) -> Image.Image:
    """The shipped mark, composited onto an opaque ground. No drawing."""
    tile = Image.new('RGB', (size, size), GROUND)
    drawn = max(1, round(size * inset))
    scaled = mark.resize((drawn, drawn), Image.LANCZOS)
    offset = (size - drawn) // 2
    tile.paste(scaled, (offset, offset), scaled)   # alpha of the mark is the stencil
    return tile


def main() -> None:
    mark = Image.open(SOURCE).convert('RGBA')
    written = []
    for size in ANY_SIZES:
        path = os.path.join(OUT, f'bridge-app-{size}.png')
        _flatten(mark, size, 1.0).save(path, 'PNG', optimize=True)
        written.append(path)
    for size in MASKABLE_SIZES:
        path = os.path.join(OUT, f'bridge-maskable-{size}.png')
        _flatten(mark, size, MASKABLE_SAFE_SCALE).save(path, 'PNG', optimize=True)
        written.append(path)
    for path in written:
        with Image.open(path) as check:
            assert check.mode == 'RGB', f'{path} kept an alpha channel'
        print(f'{os.path.relpath(path, HERE)}  {os.path.getsize(path)} bytes')


if __name__ == '__main__':
    main()
