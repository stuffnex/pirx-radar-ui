# CHANGELOG

All notable changes to **PIRX Radar / SDR Console** are recorded here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Dates are UTC. Entries are newest-first within each session.

---

## [Unreleased]

_Changes staged but not yet tagged._

---

## [0.6.0] — 2026-03-04

### Changed — 6 production improvements across all three files

#### 1. Clean iCAS2 tags — populated fields only

- **Changed** `getTaggedLines(track)` — rebuilt from scratch; only pushes tokens that have actual ADS-B values. Empty fields are never rendered.
- **Changed** `getDetailedLines(track)` — same principle; secondary row fields (ASP, AHDG, XFL, ADES, PEL) only appear when non-empty.
- **Changed** AFL + trend + CRC are now merged into a single token (`FL340↓-08` / `FL340`) so the trend arrow is never orphaned.
- **Changed** tagged row 4 simplified to `GS{value}` prefix, only rendered when groundspeed is present.
- **Removed** placeholder row 5 (DIAS / DMACH) from the tagged (unselected) format — now only shown in detailed view.

#### 2. Simplified squawk colours

- **Changed** `getTagColor(squawk)` — reduced to three states:
  - `#ff4444` red — emergency squawks `7500` / `7600` / `7700`
  - `#00ff88` green — VFR standard `7000`
  - `#66ccff` light blue — all other codes
- **Removed** OAT / military amber class (`#ffaa00`) and the `0xxx` regex match.
- **Changed** `getDimColor()` — updated to match the three-state map.

#### 3. EDDN (Nuremberg) default frequencies

- **Changed** default `freq` from `118425` → `119475` kHz (EDDN Approach).
- **Changed** `memory` object — all five slots replaced with EDDN frequencies:
  - `APP 119.475` · `TWR 118.305` · `GND 121.760` · `DEL 121.760` · `CTR 129.525`
- **Added** `ATIS: 123080` (123.080 MHz — EDDN ATIS) as sixth memory channel.
- **Changed** `REF_LAT / REF_LON` from EDDW/EDDH (52.52 / 8.53) → EDDN (49.49 / 11.08).
- **Changed** topbar REF display and `index.html` initial freq display to match.

#### 4. 10 MHz span waterfall, ≤40 fps, EDDN mock peaks

- **Added** `WF_MIN_KHZ = 118000`, `WF_MAX_KHZ = 128000`, `WF_SPAN_KHZ = 10000` — fixed 118–128 MHz display band.
- **Added** `EDDN_PEAKS[]` — 6 mock signal sources pinned to real EDDN frequencies (APP, TWR, GND/DEL, CTR, ATIS, EMRG guard) with individual amplitudes and phase offsets.
- **Added** `wfXtoFreq(x, W)` — pixel → kHz linear mapping across the 10 MHz band.
- **Added** `freqToWfX(khz, W)` — kHz → pixel for tune-marker positioning.
- **Changed** `renderWaterfall` converted from `setInterval(80ms)` → `requestAnimationFrame` with `wfLastTs` throttle at 25 ms (≤40 fps). Eliminates timer drift.
- **Changed** waterfall peaks are now anchored to absolute EDDN frequencies rather than relative to the tuned centre frequency — the whole 10 MHz band is always visible.
- **Changed** tune marker repositioned via `left%` on `#wf-tune-line` div (not canvas draw) for zero-cost updates on frequency change.
- **Changed** waterfall history no longer cleared on retune — band is fixed, so history remains valid.
- **Added** vertical grid lines in spectrum zone at every 2 MHz (118 / 120 / 122 … 128).
- **Changed** `index.html` waterfall axis — replaced 3 dynamic ticks with 6 fixed MHz labels: `118 | 120 | 122 | 124 | 126 | 128`.
- **Changed** CSS `#wf-freq-axis` — uses `justify-content:space-between` with `flex:1; text-align:center` ticks; old `padding:0 6px` removed.
- **Changed** bot-title subtitle from `→ Milestone 2` to `118 – 128 MHz · click to tune`.

#### 5. Click-to-tune waterfall + crosshair hover tooltip

- **Added** `click` listener on `#wf-body` — converts click X position to frequency via `wfXtoFreq`, snaps to nearest 8.33 kHz ATC channel, calls `setFreq()`.
- **Added** `mousemove` listener on `#wf-body` — computes hovered frequency and shows `#wf-tooltip` div floating above the cursor.
- **Added** `mouseleave` listener — hides tooltip.
- **Added** `#wf-tooltip` div in `index.html` — positioned absolutely inside `#wf-body`, `transform:translateX(-50%)` keeps it centred on cursor.
- **Added** CSS `#wf-tooltip` — dark semi-transparent background, cyan border, 9px Courier New, `pointer-events:none`.
- **Changed** `#wf-body` cursor to `crosshair` in CSS.

#### 6. 6-button memory row, no label

- **Added** `ATIS` as sixth memory channel (`mem-atis` / `mf-atis` / `data-key="ATIS"`) in `index.html`.
- **Added** `MEM_KEYS = ['APP','TWR','GND','DEL','CTR','ATIS']` array used by `updateAllMemBtns()`.
- **Removed** `<span class="mem-label">MEM</span>` from `index.html` — label consumed usable button width with no benefit.
- **Removed** `.mem-label` CSS rule.
- **Changed** `.mem-btn` — `padding` reduced from `3px 2px` → `2px 1px`; `gap` reduced from `3px` → `2px`.
- **Changed** `.mem-name` — `font-size` reduced from `9px` → `8px`; `letter-spacing` from `.12em` → `.10em`.
- **Changed** `.mem-freq` — `font-size` reduced from `8px` → `7px`.
- **Changed** `.atc-mem-row` gap reduced from `3px` → `2px`.
- **Changed** active memory button highlight changed from cyan (`var(--cyan)`) → yellow (`var(--yellow)`) border and background for higher contrast across 6 options.

---

## [0.5.0] — 2026-03-04

### Changed — iCAS2 label system overhauled (transparent, text-colour only)

- **Removed** all background boxes from aircraft labels — labels are now fully transparent, matching authentic ATC display convention
- **Added** `getTagColor(squawk)` — single source of truth for label colour:
  - `#ff4444` red — emergency squawks 7500 / 7600 / 7700
  - `#ffaa00` amber — OAT / military codes 0000–0777
  - `#00ff88` green — VFR standard 7000
  - `#66ccff` light blue — all other IFR codes
- **Added** `getDimColor(squawk)` — 38 % opacity variant of the tag colour, used for secondary/grey fields
- **Replaced** `drawICAS2Untagged` / `drawICAS2Tagged` with unified `drawTag(ctx, track, x, y, isSelected)` dispatcher
- **Added** `getTaggedLines(track)` — 5-row token array for unselected aircraft (secondary fields dim)
- **Added** `getDetailedLines(track)` — 5-row token array for selected aircraft (more fields at full brightness), includes `ATYP`, `+` transfer indicator, `DHDG`, `TRACK`
- **Added** `ATYP_MAP` — callsign-prefix → aircraft type code lookup (A320, B744, B738, etc.)
- **Added** `getATYP(callsign)` helper
- **Added** `trendChar(vr)` — returns `↓` for descent >500 fpm, empty for climb/level (replaces the previous three-way arrow)
- **Added** `formatARC(vr)` — formats assigned rate of climb as `+800` / `-500`
- **Changed** `getMockExtras` — now additionally derives `xfl`, `ahdg`, `asp`, `ades`, `pel` for rows 4–5
- **Changed** velocity vector colour now follows `getTagColor` per track instead of a fixed white/yellow
- **Removed** `STATE_COLORS` map (no longer used — state was used only for background fill)
- **Removed** `.icas2-normal` / `.icas2-assumed` / `.icas2-coordinated` / `.icas2-urgency` CSS classes
- **Removed** `--icas2-*-bg` CSS custom properties

---

## [0.4.0] — 2026-03-04

### Added — Professional ATC frequency scanner

- **Replaced** simple SDR preset buttons with a full ATC scanner panel (4 rows)
- **Added** `STEP_NORMAL = [5, 8.33, 25]` and `STEP_INVERT = [25, 8.33, 5]` step-cycle arrays
- **Added** `stepUp()` / `stepDown()` — cycle through active step sequence on repeated press
- **Added** `directStep(khz)` — explicit `±5` / `±8.33` / `±25` buttons that bypass cycling
- **Added** `toggleINV()` — swaps step-sequence mode NORM ↔ INV, resets both indices, updates status pill and button state
- **Added** 5 memory channels `APP / TWR / GND / DEL / CTR` with per-channel stored-frequency sub-label
- **Added** `tuneMemory(key)` — tunes to stored freq; auto-saves previous active channel before switching
- **Added** `storeMemory(key)` — right-click or long-press (600 ms) saves current freq into channel
- **Added** `toggleMute()` — MUTE button toggles audio; updates emoji and status pill
- **Added** `flashStepBtn(step, dir)` — 180 ms CSS flash class on activated step button
- **Added** `flashMemBtn(key)` — 900 ms green pulse on store action
- **Added** status pills: `TUNED` · `ACTIVE` · `MUTE` · `NORM`/`INV`
- **Changed** `setFreq(khz)` — now also resets waterfall history and updates axis labels on every call
- **Changed** waterfall peaks now anchored to absolute frequencies; tuning causes peaks to scroll left/right in display
- **Changed** waterfall centre-frequency marker changed from dashed cyan to solid white 1.5 px line with top notch
- **Added** default EDDW/EDDH memory presets: APP 118.425 · TWR 118.750 · GND 121.875 · DEL 121.300 · CTR 128.425
- **Added** CSS: `.step-btn.neg` / `.step-btn.pos` / `.flash-neg` / `.flash-pos` / `.inv-btn.active` / `.mem-btn` / `.mem-btn.active-mem` / `.mem-btn.store-flash` / `.mute-btn`

---

## [0.3.0] — 2026-03-04

### Changed — iCAS2 label format with coloured state backgrounds

- **Added** `drawICAS2Untagged(ctx, track, x, y)` — single-row label: `SQI CALLSIGN [WTC] AFL trend CRC CFL GS`
- **Added** `drawICAS2Tagged(ctx, track, x, y)` — two-row label with yellow border stroke; row 1: callsign header, row 2: data
- **Added** `STATE_COLORS` map — `normal` (dark grey) · `assumed` (orange) · `coordinated` (teal-green) · `urgency` (red)
- **Added** `assignState(icao)` — deterministic squawk-independent state derived from ICAO hash (no flicker): 40 % assumed · 30 % normal · 20 % coordinated · 10 % urgency
- **Added** `.icas2-normal` / `.icas2-assumed` / `.icas2-coordinated` / `.icas2-urgency` CSS classes
- **Added** `SQI_MAP` / `WTC_MAP` / `getMockExtras` helpers
- **Added** mock extras: `si` (sector indicator) · `cfl` · `cop` · `arc`
- **Added** STCA warning text in urgency tagged labels
- **Changed** dark theme hardened: `--bg: #0a0a0a`, `--txt-hi: #ffffff`, `--txt-mid: #ffffff` — zero grey primary text
- **Changed** aircraft chevron fill changed from `rgba(0,220,100,0.82)` to `#00ff88`
- **Changed** range rings changed to `#00aaaa` at 40 % opacity
- **Changed** selected aircraft stroke changed from cyan to yellow `#ffee00`

---

## [0.2.0] — 2026-03-04

### Changed — Layout redesign: vertical sidebar → horizontal bottom strip

- **Changed** layout from `75% radar + 300px right sidebar` to `75% radar + 25% bottom strip`
- **Added** bottom strip sections: SDR/Audio (350 px) · FFT/Waterfall (flex) · System Log (260 px)
- **Moved** selected track panel to a 210 px right panel beside the radar (retained from sidebar)
- **Added** live animated FFT / waterfall canvas (`wf-canvas`):
  - Scrolling waterfall using `Uint8ClampedArray` pixel rendering via `createImageData` / `putImageData`
  - Top 38 % spectrum line graph with dB grid
  - Centre tune marker dashed line
  - Frequency axis labels (± 0.5 MHz span)
  - Simulated signal peaks with phase-driven sine modulation
- **Added** `±5 MHz` coarse-tuning buttons (`b-m5` / `b-p5`) styled as accents
- **Added** 6 ATC presets: APP · TWR · EMRG · GND · ATIS · DEP
- **Changed** `--bottom-h: 26vh` CSS variable controls strip height
- **Added** Project renamed from **iCAS2** to **PIRX**; logo mark changed from `◈` to `⬡`

---

## [0.1.0] — 2026-03-04

### Added — Initial release (iCAS2 vertical sidebar layout)

- `index.html` / `style.css` / `app.js` — three-file static web application
- Canvas radar with equirectangular projection, reference point EDDW/EDDH
- Range rings: 5 / 10 / 20 / 40 / 80 / 120 NM
- Sector lines every 30°, radial vignette, centre cross
- 11 mock aircraft with realistic movement (heading ±2.5°/s wander, altitude climb/descent, respawn at 52 NM boundary)
- ATC-style two-line label: `CALLSIGN FL340 ▶ / 450kt 270°`
- Mouse-wheel zoom 0.5× – 8×, click-drag pan, click aircraft to select
- Pulsing cyan glow on selected aircraft; 2-minute velocity leader lines
- Right sidebar (300 px): SDR frequency controls, VOL/SQL sliders, 4 presets (APP/TWR/EMRG/GND), status badges, decorative FFT bars, selected track grid, system log
- WebSocket client (`connectWebSocket`) with 5-second timeout and automatic mock fallback
- Mock data generator: `startMock()` → `spawnAc()` → `tickMock()` loop at 1 s
- UTC clock (`HH:MM`), cursor lat/lon overlay
- Dark iCAS2 theme: `#080a09` background, `#00aaaa` cyan accents, Share Tech Mono + Rajdhani fonts
