# fix-555 §A — lots where the stored size is not width × depth

**Read on prod (`eibnmwthkcuumyclyxoe`) 2026-09-30. This is a READ. No rows were
changed, no dimension was blanked, no size was recomputed, no flag was
backfilled.**

> §A: *"Bobby has to look at that list and say which number is the real one,
> project by project. A display ticket that quietly rewrites lot sizes is an
> incident, and this Brain has that scar twice (fix-541 §C, P-230)."*

---

## The count moved, and the reason is fix-562

| | brief (2026-09-14) | measured (2026-09-30) |
|---|---|---|
| projects | 220 | **271** |
| width **and** depth both filled | 214 | **253** |
| width only | 0 | **8** |
| depth only | 0 | **1** |
| neither | 6 | **9** |
| `lot_size_sf` filled | 38 | **237** |
| `is_regular_shape = false` | 0 | **4** |
| **both dimensions + a size, where size ≠ w × d** | **35** | **181** |

**fix-562 wired `lot_size_sf` for editing and people filled it in — 38 → 237 in
sixteen days.** So "size ≠ w × d" stopped meaning *contradiction* and started
meaning *somebody typed a real surveyed area beside a rounded rectangle*, which
is the ordinary condition of a real lot. The population grew 5×; the problem
did not.

## The shape of the 181 says the same thing

| gap | projects | reading |
|---|---|---|
| **≥ 30 %** | **6** | a dimension and a size describing different things |
| 10 – 30 % | 5 | worth a look |
| 5 – 10 % | 8 | worth a look |
| 2 – 5 % | 5 | borderline |
| 0.5 – 2 % | 38 | rounding |
| **< 0.5 %** | **119** | rounding — 86 are within **ten square feet**, and 23 are off by **exactly 1 sq ft** |

★ **The brief's "six are off by more than 30 %" is still exactly six**, unchanged
while everything around it multiplied — including all three lots it named by
address. The real disagreements were always six; the other 175 are arithmetic.

## Recommended threshold — **2 %**

A **recommendation only. Nothing in the code was changed to match it.** The
shipped tolerance is still fix-488's **5 %**, which was Cowork's number and has
never been ruled on either. Choosing between them is Bobby's call.

- Under 2 %: 157 projects. Every one is a rounded dimension against a surveyed
  area. A 6,000 sf rectangle against a 5,990 sf survey is two hidden decimals,
  not an irregular parcel.
- At or above 2 %: **24 projects** — the table immediately below. That is a
  reviewable list.
- At or above 5 % (today's shipped tolerance): 19 projects. The five in the
  2–5 % band are the only ones the two thresholds disagree about.

---

## Group 1 — gap ≥ 2 % · **24 projects** · these are the ones to rule on

| address | width | depth | w × d | stored size | delta | gap |
|---|---|---|---|---|---|---|
| 12836 N 60th St | 368 | 320 | 117760 | 29247 | -88513 | 75.16% |
| 1301 6th Ave N | 90 | 120 | 10800 | 5399 | -5401 | 50.01% |
| 10719 Phinney Ave N | 120 | 134 | 16080 | 8046 | -8034 | 49.96% |
| 5831 104th Ave NE | 125 | 132 | 16500 | 9854 | -6646 | 40.28% |
| 7708 131st Ave NE | 139 | 120 | 16680 | 10329 | -6351 | 38.08% |
| 11231 NE 67th St | 214 | 134 | 28676 | 18669 | -10007 | 34.90% |
| 7102 E Kalil Dr | 133 | 213 | 28329 | 35779 | +7450 | 26.30% |
| 2610 NW 62nd St | 80 | 89 | 7120 | 5552 | -1568 | 22.02% |
| 8236 120th Ave NE | 150 | 74 | 11100 | 13534 | +2434 | 21.93% |
| 4000 SW 104th ST | 100 | 113 | 11300 | 13304 | +2004 | 17.73% |
| 8217 22nd PL NE | 72 | 84 | 6048 | 7039 | +991 | 16.39% |
| 8330 24th Ave NW | 104 | 45 | 4680 | 4326 | -354 | 7.56% |
| 7341 California Ave SW | 108 | 40 | 4320 | 4003 | -317 | 7.34% |
| 1400 8th Ave W | 60 | 110 | 6600 | 6133 | -467 | 7.08% |
| 2611 NW 87th ST | 60 | 104 | 6240 | 5827 | -413 | 6.62% |
| 5028 35TH AVE NE | 40 | 107 | 4280 | 4010 | -270 | 6.31% |
| 2043 N 78th St | 61 | 128 | 7808 | 7406 | -402 | 5.15% |
| 2724 Walnut Ave SW | 50 | 144 | 7200 | 6838 | -362 | 5.03% |
| 3522 Ashworth Ave N | 40 | 110 | 4400 | 4179 | -221 | 5.02% |
| 8039 Wallingford Ave N | 35 | 136 | 4760 | 4529 | -231 | 4.85% |
| 1710 E Alder St | 103 | 100 | 10300 | 10007 | -293 | 2.84% |
| 120 7th Ave | 49 | 101 | 4949 | 5089 | +140 | 2.83% |
| 13515 27th Ave NE | 57 | 120 | 6840 | 7008 | +168 | 2.46% |
| 8037 Wallingford Ave N | 34 | 136 | 4624 | 4529 | -95 | 2.05% |

### What the top six look like

- **12836 N 60th St — 75 %.** 368 × 320 is 117,760 sf; the stored size is 29,247.
  A 368-foot frontage is not a city lot. The dimensions look like a **parcel**
  and the size like **one lot within it**.
- **1301 6th Ave N — 50.01 %** and **10719 Phinney Ave N — 49.96 %.** Both are
  almost exactly **half** the rectangle. That is the shape of a dimension pair
  describing a combined parcel against a size describing one of two lots — the
  reading the brief reached on the same two addresses sixteen days ago, on the
  same numbers.
- **5831 104th Ave NE (40 %)**, **7708 131st Ave NE (38 %)**, **11231 NE 67th St
  (35 %)** are the same family: large suburban dimensions, a much smaller size.

★ **Two of the 24 run the other way** — `7102 E Kalil Dr` (+7,450) and
`8236 120th Ave NE` (+2,434) hold a size *larger* than their rectangle, which a
combined-parcel reading does not explain. Worth asking about separately.

---

## Group 2 — gap 0.5 – 2 % · 38 projects · almost certainly rounding

| address | width | depth | w × d | stored size | delta | gap |
|---|---|---|---|---|---|---|
| 2503 E Newton ST | 50 | 105 | 5250 | 5151 | -99 | 1.89% |
| 510 N 92nd ST | 47 | 120 | 5640 | 5537 | -103 | 1.83% |
| 6744 Jones Ave NW | 52 | 102 | 5304 | 5207 | -97 | 1.83% |
| 10044 37th Ave SW | 61 | 192 | 11712 | 11504 | -208 | 1.78% |
| 2527 NE 92nd ST | 78 | 135 | 10530 | 10714 | +184 | 1.75% |
| 813 NE 90th ST | 44 | 146 | 6424 | 6536 | +112 | 1.74% |
| 1427 Woodrow PL E | 61 | 66 | 4026 | 3957 | -69 | 1.71% |
| 3020 E Yesler Way | 59 | 100 | 5900 | 5998 | +98 | 1.66% |
| 3305 S Hanford ST | 60 | 102 | 6120 | 6020 | -100 | 1.63% |
| 12238 4th Ave NW | 60 | 128 | 7680 | 7801 | +121 | 1.58% |
| 6511 19th Ave NW | 38 | 102 | 3876 | 3824 | -52 | 1.34% |
| 6515 19th Ave NW | 38 | 102 | 3876 | 3824 | -52 | 1.34% |
| 2626 58th Ave SW | 40 | 89 | 3560 | 3598 | +38 | 1.07% |
| 6050 36th Ave SW | 50 | 130 | 6500 | 6433 | -67 | 1.03% |
| 5620 6th Ave NW | 33 | 100 | 3300 | 3333 | +33 | 1.00% |
| 6743 Earl Ave NW | 50 | 101 | 5050 | 5100 | +50 | 0.99% |
| 7338 27th Ave NW | 40 | 110 | 4400 | 4360 | -40 | 0.91% |
| 4351 SW Willow ST | 40 | 103 | 4120 | 4157 | +37 | 0.90% |
| 524 NE 89th ST | 34 | 146 | 4964 | 5008 | +44 | 0.89% |
| 526 NE 89th ST | 34 | 146 | 4964 | 5008 | +44 | 0.89% |
| 436 7th Ave | 50 | 110 | 5500 | 5548 | +48 | 0.87% |
| 1919 2nd Ave W | 45 | 120 | 5400 | 5442 | +42 | 0.78% |
| 2822 NW 92nd St | 58 | 104 | 6032 | 5986 | -46 | 0.76% |
| 7318 39th Ave SW | 63 | 160 | 10080 | 10154 | +74 | 0.73% |
| 6702 52nd Ave S | 40 | 123 | 4920 | 4955 | +35 | 0.71% |
| 123 N 48th St | 50 | 105 | 5250 | 5214 | -36 | 0.69% |
| 123 N 48th St | 50 | 105 | 5250 | 5214 | -36 | 0.69% |
| 215 31st Ave | 40 | 100 | 4000 | 3973 | -27 | 0.68% |
| 5811 Greenwood Ave N | 60 | 100 | 6000 | 5959 | -41 | 0.68% |
| 7060 Cleopatra Pl NW | 62 | 100 | 6200 | 6159 | -41 | 0.66% |
| 4201 SW Thistle St | 54 | 80 | 4320 | 4292 | -28 | 0.65% |
| 4115 SW Elmgrove St | 80 | 105 | 8400 | 8453 | +53 | 0.63% |
| 1327 44th Ave SW | 63 | 110 | 6930 | 6887 | -43 | 0.62% |
| 7332 25th Ave NW | 88 | 59 | 5192 | 5160 | -32 | 0.62% |
| 5642 49TH AVE SW | 54 | 135 | 7290 | 7332 | +42 | 0.58% |
| 5951 32nd Ave SW | 40 | 122 | 4880 | 4853 | -27 | 0.55% |
| 5739 25th Ave NE | 84 | 50 | 4200 | 4178 | -22 | 0.52% |
| 8542 Interlake Ave N | 50 | 103 | 5150 | 5124 | -26 | 0.50% |

---

## Group 3 — gap < 0.5 % · 119 projects · rounding

86 of these are within **ten square feet** and 23 are off by **exactly 1 sq ft**.
Listed in full because §A asked for the whole list, not a summary of it.

| address | width | depth | w × d | stored size | delta | gap |
|---|---|---|---|---|---|---|
| 3225 27th Ave W | 42 | 125 | 5250 | 5225 | -25 | 0.48% |
| 4563 34th Ave W | 40 | 85 | 3400 | 3416 | +16 | 0.47% |
| 10004 116th Ave NE | 108 | 105 | 11340 | 11392 | +52 | 0.46% |
| 12526 NE 80th St | 75 | 117 | 8775 | 8814 | +39 | 0.44% |
| 3211 Franklin Ave E | 50 | 110 | 5500 | 5476 | -24 | 0.44% |
| 11738 23RD AVE NE | 60 | 162 | 9720 | 9678 | -42 | 0.43% |
| 4215 S Findlay ST | 60 | 103 | 6180 | 6154 | -26 | 0.42% |
| 8844 10th Ave SW | 60 | 120 | 7200 | 7171 | -29 | 0.40% |
| 910 29th Ave | 40 | 102 | 4080 | 4065 | -15 | 0.37% |
| 4118 Burke Ave N | 35 | 136 | 4760 | 4743 | -17 | 0.36% |
| 4120 Burke Ave N | 35 | 136 | 4760 | 4743 | -17 | 0.36% |
| 4142 44th Ave SW | 50 | 116 | 5800 | 5821 | +21 | 0.36% |
| 7736 30th Ave NW | 38 | 125 | 4750 | 4767 | +17 | 0.36% |
| 9711 12th Ave NW | 66 | 150 | 9900 | 9864 | -36 | 0.36% |
| 220 N 58th St | 90 | 50 | 4500 | 4485 | -15 | 0.33% |
| 220 N 58th St | 50 | 90 | 4500 | 4485 | -15 | 0.33% |
| 3757 SW Austin St | 42 | 102 | 4284 | 4298 | +14 | 0.33% |
| 8816 38th Ave SW | 50 | 129 | 6450 | 6429 | -21 | 0.33% |
| 4137 54th Ave SW | 43 | 116 | 4988 | 5004 | +16 | 0.32% |
| 4051 42nd Ave SW | 50 | 115 | 5750 | 5768 | +18 | 0.31% |
| 6516 37th Ave SW | 50 | 128 | 6400 | 6419 | +19 | 0.30% |
| 25 W Dravus St | 60 | 120 | 7200 | 7221 | +21 | 0.29% |
| 4147 44th Ave SW | 50 | 116 | 5800 | 5817 | +17 | 0.29% |
| 5947 32nd Ave SW | 40 | 121 | 4840 | 4853 | +13 | 0.27% |
| 3046 NW 64th St | 50 | 100 | 5000 | 4987 | -13 | 0.26% |
| 537 N 70th St | 30 | 149 | 4470 | 4459 | -11 | 0.25% |
| 539 N 70th St | 30 | 149 | 4470 | 4459 | -11 | 0.25% |
| 4055 42nd Ave SW | 50 | 115 | 5750 | 5764 | +14 | 0.24% |
| 4222 Latona Ave NE | 50 | 102 | 5100 | 5090 | -10 | 0.20% |
| 1917 3rd Ave W | 30 | 120 | 3600 | 3607 | +7 | 0.19% |
| 2443 5th Ave W | 45 | 120 | 5400 | 5390 | -10 | 0.19% |
| 4136 44th Ave SW | 50 | 116 | 5800 | 5811 | +11 | 0.19% |
| 4228 Latona Ave NE | 51 | 102 | 5202 | 5192 | -10 | 0.19% |
| 6539 44th Ave SW | 125 | 50 | 6250 | 6262 | +12 | 0.19% |
| 3821 36th Ave SW | 40 | 123 | 4920 | 4929 | +9 | 0.18% |
| 5102 SW Pritchard St | 70 | 80 | 5600 | 5590 | -10 | 0.18% |
| 518 N 102nd ST | 40 | 96 | 3840 | 3847 | +7 | 0.18% |
| 6334 51st Ave S | 43 | 128 | 5504 | 5494 | -10 | 0.18% |
| 6027 4th Ave NE | 60 | 100 | 6000 | 5990 | -10 | 0.17% |
| 3241 44th Ave SW | 50 | 117 | 5850 | 5841 | -9 | 0.15% |
| 2619 35th Ave W | 52 | 120 | 6240 | 6249 | +9 | 0.14% |
| 6217 45th Ave NE | 50 | 136 | 6800 | 6791 | -9 | 0.13% |
| 1907 5th Ave W | 30 | 120 | 3600 | 3604 | +4 | 0.11% |
| 1954 5th Ave W | 30 | 120 | 3600 | 3604 | +4 | 0.11% |
| 3670 Interlake Ave N | 41 | 110 | 4510 | 4505 | -5 | 0.11% |
| 1524 Martin Luther King Jr Way | 40 | 120 | 4800 | 4805 | +5 | 0.10% |
| 4048 32nd Ave W | 40 | 120 | 4800 | 4805 | +5 | 0.10% |
| 4428 Dayton Ave N | 100 | 50 | 5000 | 4995 | -5 | 0.10% |
| 5623 44th Ave SW | 50 | 125 | 6250 | 6256 | +6 | 0.10% |
| 3626 164th Pl SE | 90 | 179 | 16110 | 16095 | -15 | 0.09% |
| 4425 41st Ave SW | 100 | 115 | 11500 | 11490 | -10 | 0.09% |
| 6340 4th Ave NE | 45 | 50 | 2250 | 2248 | -2 | 0.09% |
| 1515 Martin Luther King Jr Way | 40 | 120 | 4800 | 4796 | -4 | 0.08% |
| 3423 61st Ave SW | 40 | 120 | 4800 | 4804 | +4 | 0.08% |
| 3502 Meridian Ave N | 60 | 120 | 7200 | 7194 | -6 | 0.08% |
| 6723 25th Ave NW | 50 | 102 | 5100 | 5104 | +4 | 0.08% |
| 10430 66th Ave S | 113 | 50 | 5650 | 5654 | +4 | 0.07% |
| 233 31st Ave E | 40 | 110 | 4400 | 4397 | -3 | 0.07% |
| 25 W Cremona St | 75 | 120 | 9000 | 8994 | -6 | 0.07% |
| 4523 48th Ave NE | 50 | 147 | 7350 | 7345 | -5 | 0.07% |
| 5435 California Ave SW | 60 | 150 | 9000 | 8994 | -6 | 0.07% |
| 6026 41st Ave NE | 50 | 135 | 6750 | 6745 | -5 | 0.07% |
| 12843 NE 112th St | 75 | 138 | 10350 | 10356 | +6 | 0.06% |
| 1602 41st Ave E | 30 | 120 | 3600 | 3598 | -2 | 0.06% |
| 2029 42ND Ave E | 110 | 30 | 3300 | 3298 | -2 | 0.06% |
| 4060 E Via Estrella | 165 | 305 | 50325 | 50293 | -32 | 0.06% |
| 5053 35th Ave SW | 40 | 118 | 4720 | 4723 | +3 | 0.06% |
| 5627 44th Ave SW | 50 | 125 | 6250 | 6254 | +4 | 0.06% |
| 7017 20th Ave NW | 50 | 102 | 5100 | 5097 | -3 | 0.06% |
| 10729 Sand Point Way NE | 60 | 200 | 12000 | 11994 | -6 | 0.05% |
| 2903 3RD AVE N | 40 | 100 | 4000 | 4002 | +2 | 0.05% |
| 3419 48th Ave SW | 53 | 123 | 6519 | 6516 | -3 | 0.05% |
| 3931 SW Southern St | 80 | 105 | 8400 | 8404 | +4 | 0.05% |
| 4040 E Via Estrella | 201 | 305 | 61305 | 61275 | -30 | 0.05% |
| 4326 Woodlawn Ave N | 40 | 106 | 4240 | 4238 | -2 | 0.05% |
| 6832 47th Ave NE | 66 | 99 | 6534 | 6537 | +3 | 0.05% |
| 7938 34th Ave SW | 60 | 128 | 7680 | 7684 | +4 | 0.05% |
| 8016 24th Ave NW | 46 | 96 | 4416 | 4418 | +2 | 0.05% |
| 4017 Corliss Ave N | 50 | 114 | 5700 | 5702 | +2 | 0.04% |
| 6826 25th Ave NE | 55 | 102 | 5610 | 5608 | -2 | 0.04% |
| 7320 11th Ave NE | 50 | 100 | 5000 | 4998 | -2 | 0.04% |
| 733 N 78th St | 45 | 100 | 4500 | 4502 | +2 | 0.04% |
| 7336 132nd Ave NE | 80 | 269 | 21520 | 21511 | -9 | 0.04% |
| 7603 8th Ave NW | 50 | 111 | 5550 | 5548 | -2 | 0.04% |
| 8627 31st Ave SW | 60 | 126 | 7560 | 7563 | +3 | 0.04% |
| 1004 N 48th St | 42 | 92 | 3864 | 3865 | +1 | 0.03% |
| 137 13th Ave | 75 | 120 | 9000 | 8997 | -3 | 0.03% |
| 1528 25th Ave | 30 | 120 | 3600 | 3599 | -1 | 0.03% |
| 224 2nd Ave N | 60 | 120 | 7200 | 7202 | +2 | 0.03% |
| 2558 30th Ave W | 51 | 140 | 7140 | 7138 | -2 | 0.03% |
| 2627 25th Ave W | 60 | 128 | 7680 | 7678 | -2 | 0.03% |
| 3921 43rd Ave S | 60 | 120 | 7200 | 7198 | -2 | 0.03% |
| 4120 49th Ave S | 60 | 120 | 7200 | 7202 | +2 | 0.03% |
| 4723 50th Ave SW | 50 | 125 | 6250 | 6248 | -2 | 0.03% |
| 6336 51st Ave S | 54 | 128 | 6912 | 6914 | +2 | 0.03% |
| 6338 51st Ave S | 54 | 128 | 6912 | 6914 | +2 | 0.03% |
| 6527 Jones Ave NW | 58 | 102 | 5916 | 5918 | +2 | 0.03% |
| 8307 27th Ave NW | 60 | 99 | 5940 | 5938 | -2 | 0.03% |
| 10708 Linden Ave N | 45 | 124 | 5580 | 5579 | -1 | 0.02% |
| 2725 Belvidere Ave SW | 50 | 100 | 5000 | 4999 | -1 | 0.02% |
| 2812 32nd Ave W | 50 | 126 | 6300 | 6299 | -1 | 0.02% |
| 3222 W Bertona St | 60 | 80 | 4800 | 4801 | +1 | 0.02% |
| 3261 NE 98th ST | 68 | 94 | 6392 | 6393 | +1 | 0.02% |
| 370 Lynn St | 50 | 120 | 6000 | 6001 | +1 | 0.02% |
| 4412 Evanston Ave N | 90 | 50 | 4500 | 4499 | -1 | 0.02% |
| 4903 Erskine Way SW | 50 | 120 | 6000 | 6001 | +1 | 0.02% |
| 5603 45th Ave SW | 50 | 120 | 6000 | 6001 | +1 | 0.02% |
| 5606 46th Ave SW | 50 | 120 | 6000 | 6001 | +1 | 0.02% |
| 5917 41st Ave SW | 50 | 120 | 6000 | 6001 | +1 | 0.02% |
| 6712 14th Ave NW | 50 | 100 | 5000 | 5001 | +1 | 0.02% |
| 727 N 48th St | 50 | 100 | 5000 | 5001 | +1 | 0.02% |
| 7324 27th Ave NW | 40 | 109 | 4360 | 4361 | +1 | 0.02% |
| 902 N 107TH ST | 45 | 124 | 5580 | 5579 | -1 | 0.02% |
| 9208 Dayton Ave N | 60 | 90 | 5400 | 5399 | -1 | 0.02% |
| 12827 NE 80th St | 75 | 128 | 9600 | 9601 | +1 | 0.01% |
| 2844 35th AVE W | 53 | 128 | 6784 | 6783 | -1 | 0.01% |
| 3250 29th AVE W | 70 | 120 | 8400 | 8399 | -1 | 0.01% |
| 5907 105th Ave NE | 70 | 122 | 8540 | 8539 | -1 | 0.01% |
| 6533 52nd Ave S | 75 | 128 | 9600 | 9601 | +1 | 0.01% |

---

## Two things noticed while reading, neither acted on

- **Three addresses appear twice** — `123 N 48th St`, `220 N 58th St` and
  `1515` / `1524 Martin Luther King Jr Way` are separate project rows at the
  same or adjacent addresses. `220 N 58th St` holds **90 × 50 on one row and
  50 × 90 on the other** — the same lot with the dimensions entered in opposite
  order. Not this ticket's to merge; fix-333's duplicate-address warning is the
  surface that owns it.
- **`5616 E Argyle DR`** is not in this table because it has **no dimensions at
  all** — 14,136 sf and two blanks. It is the first project ever to reach §B.4's
  state, and after fix-555 it renders `varies × varies`.

## What this file is not

It is a read. **No rows were changed.** No dimension was blanked, no size
recomputed, no flag backfilled, and fix-555 ships no migration. The threshold
above is a recommendation for Bobby to accept or replace; the code still uses
fix-488's 5 %.
