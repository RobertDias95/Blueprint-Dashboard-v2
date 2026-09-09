# fix-507 — the Project Overview, measured on BOTH axes

**Measured 2026-09-09 in Chrome, against the live app** (`npm run dev`, signed
in, ribbon expanded), on the two projects the brief names. Not a harness and not
a transcription: the real components, the real data, the real shell.

> ★★★ **The standing lesson this ticket exists to obey.** fix-506 was a WIDTH
> ticket and won on width — row minimum 1,172 → 904, unwrap point 1,742 → 1,474,
> 1600 on one line for the first time since fix-417. It paid for that in HEIGHT,
> deliberately, and said so in its own PR: *"the two cards that absorbed them
> paid in height, not width."* **Nobody measured the height.** Bobby's first look
> at the shipped screen found Schedule Health below the fold, the Site/Dates pair
> stacked, the units matrix in a narrow strip with ellipsised headers, and the
> Team card stacked. A ticket that optimises one axis must state what it did to
> the other, in the same measurement, or the regression ships.

Everything below is reproducible: the derived half is computed by
`src/__tests__/Fix507Numbers.test.ts` from the same modules the app renders
from, so this document and the code cannot drift.

---

## 0 — the two projects, as prod actually holds them

| | `403 W Dravus St` | `233 31st Ave E` |
|---|---|---|
| unit types | **6** (all `Detached`) | **2** (both `Detached`) |
| consultants | **3** | **6** |
| permits | 2 | 6 |
| plan of record | `schematic`, 1400 × 906 | `schematic`, 1400 × 906 |

★ **One correction to the brief:** it describes `403 W Dravus St` as having *"6
consultants, 6 units"*. It has 6 units and **3** consultants; `233 31st Ave E`
is the six-consultant project. That matters, because the consultant band is what
carries the height deficit in §D below.

---

## 1 — the row, before and after, at both viewports

Widths are the rendered card widths; heights are **natural** heights (measured
with `align-items: start` and the cells' `height:100%` released, so each card's
own content height is what is read — fix-423's method). The row's height is the
MAX of the three.

### 1920 viewport, ribbon expanded — row 1335 → **1385**

| | before | after |
|---|---|---|
| Plan of Record | 460 w · 411 h | **485 w · 428 h** |
| Project | 408 w · 603 / 605 h | **478 w · 605 / 533 h** |
| Team | 447 w · 773 / 721 h | **403 w · 763 / 611 h** |
| **row height** | **773 / 721** | **763 / 611** |
| Site data beside Dates | ✗ stacked, both | **✓ side by side, both** |
| top of Schedule Health | 791 / 739 | **781 / 629** |

*(two figures = `233 31st Ave E` · `403 W Dravus St`)*

### 1600 viewport, ribbon expanded — row 1015 → **1065**

| | before | after |
|---|---|---|
| Plan of Record | 368 w · 351 h | **371 w · 428 h** |
| Project | 354 w · 603 / 605 h | **366 w · 780 / 723 h** |
| Team | 273 w · 1077 / 869 h | **308 w · 801 / 649 h** |
| **row height** | **1077 / 869** | **801 / 723** |
| Site data beside Dates | ✗ stacked, both | ✗ stacked, both — **STOP, see §3** |
| top of Schedule Health | 1095 / 887 | **819 / 741** |

★★★ **The 1600 column is where §C pays most.** On `233 31st Ave E` the
consultant band was **489px** at a 273px Team card — six pills one per line —
and the card was **1077px** tall. The row comes down **276px** there, and 233 is
the six-consultant project. `403 W Dravus St` comes down 146.

---

## 2 — is Schedule Health above the fold?

The pane is `pd-right-pillbox`, which scrolls its own content. Its visible
height is **`viewport − 238`** (shell header 80 · `<main> p-6` 48 ·
ProjectDetail's own title block 96 · `pb-3` 12 · border 2), measured.

| viewport | pane height | `403 W Dravus St` | `233 31st Ave E` |
|---|---:|---|---|
| **1920 × 1080** (the ruled floor) | 842 | SH top **629** → ✓ **whole table visible** (629 + 162 = 791) | SH top **781** → ✓ top visible, 61px of a 370px table |
| 1920 × 855 (maximised Chrome on a 1080 screen, this machine) | 617 | SH top 629 → ✗ by **12px** | SH top 781 → ✗ by 164px |

★★★ **The 1080 in Bobby's ruling is a SCREEN, and the browser takes 225px of
it.** On this machine a maximised Chrome window on a 1920 × 1080 screen gives
the page **855px** of viewport: 48 to the taskbar and 177 to Chrome's own tab
strip, address bar and bookmarks bar. At a genuine 1080-tall viewport the ruling
is met on both projects and comfortably on `403 W Dravus St`; at 855 the top of
Schedule Health lands 12px under the fold on the six-unit project and 164 under
on the six-consultant one. **Hiding the bookmarks bar (≈34px) clears the 12.**
Reported rather than absorbed — which of those two numbers "1920 × 1080" means
is Bobby's to say.

---

## 3 — the STOP conditions, with numbers

### (a) §B at 1600 — **STOP, hit.** Short by 77px.

The pair needs **475** of card body (Site 169 + gap 10 + Dates 296, each
confirmed row by row in Chrome — see §5). So:

```
Project card         475 + 2 of border      = 477
Plan of Record       must exceed it         = 483     (fix-417's unrevoked ruling)
Team                 its floor, one pill    = 162
two 10px gaps                               =  20
                                              ----
                                              1142
the row at 1600 has                           1065
                                              ----
deficit                                         77
```

The pair therefore **stacks at 1600** — the one permitted fallback, and now a
declared container query rather than an accident of wrapping. It appears from a
**1917px viewport** and up.

★ Bobby's ruling 3 asked for side by side *"at 1600 and up"*. What the shell can
pay for is **1917 and up**. The remaining levers are his and are sized in §4.

### (b) §D at 1920 — **STOP, hit.** Short by 38px, and Team is carrying it.

§C's regrid is the largest single lever and it works: at 1920 the Team card
falls **721 → 611** on `403 W Dravus St`, and at 1600 it falls **1077 → 801** on
`233 31st Ave E`. But at 1920 on `233 31st Ave E` it falls only 773 → 763,
because §B's width came out of the card that needed it:

```
Project card         side by side           = 477
Plan of Record       above it               = 483
Team                 3 pills across, 6 consultants:
                     3 × 140 + card chrome  = 442
two 10px gaps                               =  20
                                              ----
                                              1422
the row at 1920 has                           1385
                                              ----
deficit                                         37   (38 measured)
```

Measured in Chrome: the six-consultant band is **185px at a 444px Team card and
337px at 437** — it drops from 3+3 to four pill-lines, costing **152px** of row
height on `233 31st Ave E`.

★★★ **Side by side was taken anyway, because it is better on BOTH axes.** This
is measured, not preferred: with the pair stacked, the PROJECT card is **780px**
tall on `233 31st Ave E` — 17px MORE than the 763 the wrapped-band Team costs.
Refusing §B would have made that project's row taller, not shorter.

### (c) fix-417's ruling — **not broken.** PoR 485 against Project 478 at 1920,
and its floor still sits 14px above Project's, so it stays the widest card at
every width where the floors bind.

---

## 4 — the levers that would close the 38px, sized

None of these were taken: the brief rules them Bobby's call.

| lever | size | what it costs |
|---|---|---|
| rail 190 → 152 | +38 of row | the rail already truncates the stage word at 190; 152 truncates more |
| consultant pill floor 140 → 127 | Team holds 3 across at 403 | a pill 13px under its measured minimum |
| the Site/Dates pair 475 → 437 | Project 439 · PoR 445 · Team 443 all fit | tighter label columns, or a type step down |

---

## 5 — where the pair's 475 comes from (STEP 0-2, confirmed)

Measured per ROW, in Chrome, on the live app:

| | needs | + section `px-2.5` | declared |
|---|---:|---:|---:|
| Site data — widest row is `Lot size  4,400 sf derived` | 147 | 167 | **169** |
| Dates — left 56+8+60 · gap 14 · right 70+8+60 | 276 | 296 | **296** |

★ **`DATES_CARD_MIN_WIDTH` is exact; `SITE_DATA_MIN_WIDTH` is 2px
conservative — and it is conservative about the WRONG ROW.** `SITE_VALUE_MIN` is
sized for `60 × varies`, which measures **135**; the row that actually binds is
`Lot size`, at 147, because fix-488's ` derived` suffix is a second span. The
constant is right and its stated reason was not, which matters because a prose
reason is what stops the next person shrinking it.

★ **One wrong method, recorded so it is not repeated.** Binary-searching each
box's width until a row reflows returned 156 and 291 — both artefacts. The
widest Site row is two spans that WRAP, so a search that stops when a row's
height grows stops one step after the row it is measuring has already given up.
Measure each row's required width instead.

---

## 6 — the plan thumbnails, all 164 of them (fix-507b STEP 0)

Every row of `project_plan_of_record` with `thumb_status = 'ok'` was signed out
of the `plan-thumbnails` bucket and its natural size read in the browser. **164
measured, 0 errors.** There are only four distinct sizes:

| pixels | aspect | count | |
|---|---:|---:|---|
| 1400 × 906 | 1.545 | **159** | the modal sheet |
| 1400 × 907 | 1.544 | 1 | |
| 1400 × 1082 | 1.294 | 2 | letter landscape |
| 1400 × 2164 | 0.647 | **2** | **PORTRAIT** — 1 schematic, 1 marketing |

**162 landscape · 2 portrait · 0 square.** Extremes 0.647 and 1.545.

★ So the cap is insurance for two projects — and those two render the image at
**716px** against the modal 300, which is a 416px card on its own, on a row this
ticket is trying to get above the fold. `POR_IMAGE_MAX_HEIGHT` is **derived**
from the modal aspect at the card's reference width, so 159 of 164 plans are
pixel-identical to what they render today and only the outliers move.

★ **The mock is silent on this**, and that is the third instance of the same
trap in one feature: `overview_book_v14.html` draws the plan as a landscape
420 × 300 SVG with no height cap, so signing it off proved nothing about a
portrait sheet.

---

## 7 — the eighth chrome box

fix-422 found the shell chrome was 278px larger than fix-417 believed, by
walking the DOM from `<main>` down. fix-507 found one more, and it is the one a
rect does not show you:

> `pd-right-pillbox` is `overflow-y-auto` and its content is taller than the
> pane on every project, so a **15px vertical scrollbar is always there.**
> Measured at 1920: the pillbox is 1384 wide, its **content** box 1367, and the
> overview row renders **1335** — not the 1350 `overviewCardLayout` computed.

A scrollbar lives between the border box and the content box, so
`getBoundingClientRect()` on the pillbox reports 1384 and tells you nothing. Now
`SHELL_CHROME_PX.pillboxScrollbar`.

Net with §A's rail: chrome 570 → **535**, every row width +35, and
`overviewMinViewport('expanded')` 1474 → **1439** — so **1440 fits on one line,
by a single pixel.** Worth knowing before anybody spends it.
