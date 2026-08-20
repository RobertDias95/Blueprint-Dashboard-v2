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
circle of diameter 80% guaranteed. fix-371 applies that to the TRIMMED mark
rather than to the mark plus its transparent margin - see the note further down
for why the margin was the bug, and why the mark's 2.37:1 aspect is the ceiling
that remains once the margin is gone.
"""
from __future__ import annotations
import math
import os
from PIL import Image

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(HERE, 'public', 'bridge-icon-2026-256.png')
OUT = os.path.join(HERE, 'public')

GROUND = (255, 255, 255)

# ---------------------------------------------------------------------------
# fix-371: TRIM FIRST. The mark was scaled twice and drawn once.
# ---------------------------------------------------------------------------
#
# Bobby, on the taskbar icon fix-369 shipped: "can we make this more noticeable
# on the screen?"
#
# The source PNG is a 256x256 canvas whose ink occupies an alpha bounding box of
# 230 x 97 at (13, 79). Everything outside that is transparent margin, and this
# script used to paste the WHOLE canvas - margin included - onto the tile. The
# maskable pair then shrank that by a further 0.83. So a mark 97px tall inside a
# 256px canvas became 12.6px on a 40px taskbar tile.
#
# The mark is now cropped to its own bounding box before anything is scaled, and
# the scaling applies to the mark instead of to the mark plus its margin.
#
# *** AND THE HONEST PART: THE ASPECT RATIO IS THE REAL CEILING.
# The mark is 2.37:1. Inside a SQUARE tile, its height can never exceed
# width / 2.37 - about 42% of the tile - however perfectly it is trimmed. The
# trim recovers the margin and nothing more; it cannot make a wide, thin bridge
# tall. Measured gains are in the report, and if Bobby wants it larger again the
# next step is a squarer artwork variant, not a change to this script.
#
# *** Cropping transparent margin is not redrawing. Not one pixel of the mark is
# altered: PIL's getbbox() returns the tightest box containing any non-zero
# alpha, and crop() returns those same pixels. fix-322's contract is intact and
# its grep still passes.

# How much of the tile's WIDTH the trimmed mark spans on an `any` icon. Nothing
# crops these, so the only reason not to use the whole width is that a mark
# touching the edge reads as clipped rather than as full-bleed.
ANY_WIDTH_FILL = 0.96

# The maskable guarantee: only the centred circle of diameter 0.8 x tile is
# certain to survive an OS mask. A w x h mark centred in a tile of side S fits
# inside that circle when sqrt(w^2 + h^2) / 2 <= 0.4 x S, so the width is
# capped at 0.8 x S / sqrt(1 + (h/w)^2). Computed from the TRIMMED mark now,
# which is what the safe zone was always supposed to be about.
MASKABLE_SAFE_DIAMETER = 0.8

# ★ The sizes Chrome and Windows actually ask for. 192 and 512 are Chrome's
# installability floor; 256 is what Chrome hands Windows for the desktop
# shortcut .ico; 64 keeps a hand-checked small rendering rather than letting the
# OS downsample 512 to taskbar size.
ANY_SIZES = (64, 192, 256, 512)
MASKABLE_SIZES = (192, 512)


def _trim(mark: Image.Image) -> Image.Image:
    """The mark, cropped to its own alpha bounding box. Nothing is altered."""
    box = mark.getbbox()
    return mark.crop(box) if box else mark


def _width_fill(mark: Image.Image, purpose: str) -> float:
    """What fraction of the tile's width the trimmed mark may span."""
    if purpose == 'any':
        return ANY_WIDTH_FILL
    w, h = mark.size
    # Fit the mark's DIAGONAL inside the safe circle.
    return MASKABLE_SAFE_DIAMETER / math.sqrt(1.0 + (h / w) ** 2)


def _flatten(mark: Image.Image, size: int, purpose: str) -> Image.Image:
    """The shipped mark, trimmed, scaled and composited onto an opaque ground.

    No drawing, and no change to any pixel of the artwork - only a crop of fully
    transparent margin and a resize.
    """
    tile = Image.new('RGB', (size, size), GROUND)
    src_w, src_h = mark.size
    drawn_w = max(1, round(size * _width_fill(mark, purpose)))
    drawn_h = max(1, round(drawn_w * src_h / src_w))
    scaled = mark.resize((drawn_w, drawn_h), Image.LANCZOS)
    tile.paste(scaled, ((size - drawn_w) // 2, (size - drawn_h) // 2), scaled)
    return tile


def main() -> None:
    raw = Image.open(SOURCE).convert('RGBA')
    mark = _trim(raw)
    print(f'source   {raw.size[0]}x{raw.size[1]}')
    print(f'alpha bbox {raw.getbbox()}  ->  trimmed {mark.size[0]}x{mark.size[1]}'
          f'  (aspect {mark.size[0] / mark.size[1]:.2f}:1)')
    written = []
    for size in ANY_SIZES:
        path = os.path.join(OUT, f'bridge-app-{size}.png')
        _flatten(mark, size, 'any').save(path, 'PNG', optimize=True)
        written.append(path)
    for size in MASKABLE_SIZES:
        path = os.path.join(OUT, f'bridge-maskable-{size}.png')
        _flatten(mark, size, 'maskable').save(path, 'PNG', optimize=True)
        written.append(path)
    for path in written:
        with Image.open(path) as check:
            assert check.mode == 'RGB', f'{path} kept an alpha channel'
        print(f'{os.path.relpath(path, HERE)}  {os.path.getsize(path)} bytes')


if __name__ == '__main__':
    main()
