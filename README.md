# PIRX — Radar / SDR Console

A browser-based ATC radar display and VHF communications scanner. Zero dependencies, zero build step — drop three files on any static host and open `index.html`.

Current version: **0.6.0** · Reference station: **EDDN Nuremberg** · See [CHANGELOG.md](CHANGELOG.md) for full history.

---

## Layout Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│ ⬡ PIRX  Radar / SDR Console            ● MOCK   11 TRACKS   40NM   │
├─────────────────────────────────────┬────────────────────────────────┤
│                                     │  ⊕ Selected Track             │
│                                     │  ICAO   3C1A3F               │
│   Canvas radar                      │  CALL   DLH123               │
│   equirectangular projection        │  AFL    FL340                │
│   range rings · sector lines        │  GS     452kt                │
│   velocity leaders                  │  …                           │
│                                     │                              │
│   iCAS2 transparent labels:         │                              │
│   V   DLH123  NUE                   │                              │
│   FL340↓-08   FL360                 │                              │
│   GS452                             │                              │
│                                     │                              │
├───────────┬─────────────────────────┴──────────┬───────────────────┤
│ ATC       │  118 ─── 120 ─── 122 ─── 124 ─ 128│  System Log       │
│ Scanner   │  [FFT spectrum line]               │  12:34:01Z …      │
│           │  [waterfall scrolling down]        │  12:34:00Z Tuned… │
└───────────┴────────────────────────────────────┴───────────────────┘
```

The screen is divided into **75% radar canvas** (top) and **25% bottom strip** (ATC scanner · 10 MHz waterfall · log). A 220 px right panel shows the selected track detail.

---

## Features

### Radar Display

- Equirectangular canvas projection centred on a configurable reference coordinate (default EDDN — 49°29'N 011°05'E)
- Range rings at 5 / 10 / 20 / 40 / 80 / 120 NM; highlighted at 10 / 40 / 80 NM (40 % cyan opacity)
- Sector lines every 30°, radial vignette
- Aircraft rendered as heading-oriented chevrons — `#00ff88` green fill, colour-coded stroke
- 2-minute velocity look-ahead leader lines
- Mouse-wheel **zoom** 0.5× – 8×, click-drag **pan**, click aircraft to select/deselect
- Selection ring with pulse glow animation

### iCAS2 Transparent Label System

Labels are rendered with **no background boxes** — colour is encoded entirely in the text. Fields are only rendered when they contain actual data; there are no empty placeholders.

**Tag colour by squawk:**

| Squawk | Colour | Meaning |
|---|---|---|
| 7500 / 7600 / 7700 | `#ff4444` red | Hijack / radio failure / emergency |
| 7000 | `#00ff88` green | VFR standard |
| all others | `#66ccff` light blue | IFR / unknown |

Secondary fields render at ~35 % opacity of the track colour.

**Tagged format** (unselected — compact, data-only):

```
V   DLH123  NUE
FL340↓-08   FL360
GS452
```

**Detailed format** (selected — all available fields):

```
V   WARNINGS
DLH123  NUE  A320  H  +
FL340↓-08  +800  FL360  WST
GS452  480  270  FL380  FRA  FL320
DIAS  DMACH  DHDG  TRACK
```

Field glossary: SQI · CALLSIGN · SI (sector) · ATYP (aircraft type) · WTC (wake turbulence) · AFL+trend+CRC · ARC (assigned climb rate) · CFL · COP · GS · ASP · AHDG · XFL · ADES · PEL.

### ATC Frequency Scanner

- Frequency display: `XXX.XXX MHz`, bold Courier New
- Step buttons: `−25 | −8.33 | −5  kHz  +5 | +8.33 | +25`
- **INV toggle** — reverses step-cycle sequence (NORM: 5→8.33→25 / INV: 25→8.33→5)
- VOL and SQL sliders with dB readout
- MUTE toggle (🔊 / 🔇)
- Status pills: `TUNED` · `ACTIVE` · `MUTE` · `NORM`/`INV`

**6 memory channels — single compact row:**

| Channel | Default | Use |
|---|---|---|
| APP | 119.475 MHz | EDDN Approach |
| TWR | 118.305 MHz | EDDN Tower |
| GND | 121.760 MHz | EDDN Ground |
| DEL | 121.760 MHz | EDDN Delivery |
| CTR | 129.525 MHz | Langen Radar |
| ATIS | 123.080 MHz | EDDN ATIS |

Single click → tune. Long-press (600 ms) or right-click → store current frequency into that slot.

### FFT / Waterfall — 10 MHz fixed band

- Fixed display band: **118.000 – 128.000 MHz** (full VHF ATC approach band)
- ~25 kHz/pixel resolution — resolves individual 8.33 kHz ATC channels
- ≤40 fps using `requestAnimationFrame` with 25 ms throttle
- Top 38 % of panel: FFT spectrum line with dB grid and 2 MHz vertical markers
- Thermal colour gradient: black → deep teal → cyan → white
- Mock signal peaks placed at all EDDN ATC frequencies (APP, TWR, GND/DEL, CTR, ATIS, 121.5 guard)
- Fixed axis labels: `118 | 120 | 122 | 124 | 126 | 128 MHz`
- **Click to tune** — click anywhere on the waterfall to instantly retune (snaps to nearest 8.33 kHz channel)
- **Hover** shows a floating `XXX.XXX MHz` tooltip
- White solid tune-marker line repositions instantly on every frequency change

### System Log

- Prepend-on-top, max 60 entries, UTC timestamps `HH:MM:SSZ`
- Colour codes: white (info) · amber (warn) · green (ok) · red (error)

---

## File Structure

```
pirx-radar-ui/
├── index.html      Layout: top bar · radar · right panel · bottom strip
├── style.css       Dark theme · ATC scanner · waterfall tooltip · no icas2 bg classes
├── app.js          All logic: radar · iCAS2 labels · ATC scanner · waterfall · mock/WebSocket
├── README.md       This file
└── CHANGELOG.md    Version history
```

No `node_modules`, no bundler, no framework.

---

## Deployment

### Static hosting (Cloudflare Pages / Netlify / GitHub Pages)

Commit the three source files to a repository, point your host at the root directory. No build command required.

### Local development

```bash
python3 -m http.server 8080
# or
npx serve .
# open http://localhost:8080
```

### Connecting a real backend

Edit the constant at the top of `app.js`:

```js
const BACKEND_WS_URL = 'wss://your-backend-host/ws';
```

On load the app opens a WebSocket. If it fails or times out (5 s), it falls back automatically to mock data.

**Expected WebSocket push format (`type: "tracks"`):**

```json
{
  "type": "tracks",
  "tracks": [
    {
      "icao":        "3C1A3F",
      "callsign":    "DLH123",
      "lat":         49.41,
      "lon":         11.12,
      "altitude":    34000,
      "groundspeed": 452,
      "heading":     270,
      "squawk":      "7000"
    }
  ]
}
```

All fields except `icao`, `lat`, `lon` are optional — the renderer degrades gracefully.

---

## Configuration

All tuneable constants are at the top of `app.js`:

```js
// Backend WebSocket
const BACKEND_WS_URL = 'wss://…';

// Radar centre (EDDN default)
const REF_LAT = 49.49;
const REF_LON = 11.08;

// Waterfall band — fixed 10 MHz span
const WF_MIN_KHZ = 118000;   // 118.000 MHz
const WF_MAX_KHZ = 128000;   // 128.000 MHz

// Memory channel presets (kHz)
const memory = {
  APP:  119475,
  TWR:  118305,
  GND:  121760,
  DEL:  121760,
  CTR:  129525,
  ATIS: 123080,
};
```

---

## Browser Compatibility

Requires Canvas 2D API and WebSocket — available in all evergreen browsers since 2016.

| Browser | Minimum |
|---|---|
| Chrome / Edge | 80+ |
| Firefox | 75+ |
| Safari | 14+ |

High-DPI / Retina rendering is automatic via `window.devicePixelRatio`.

---

## Roadmap

| Milestone | Status | Description |
|---|---|---|
| M1 | ✅ | Static frontend, mock data, iCAS2 labels, ATC scanner |
| M2 | ✅ | 10 MHz waterfall, click-to-tune, EDDN frequencies, clean tags |
| M3 | — | Real FFT — RTL-SDR or WebSDR WebSocket feed |
| M4 | — | Sector geometry overlay (TMA / CTR / airways as GeoJSON) |
| M5 | — | Live ADSB adapter (OpenSky / ADSB-Exchange) |
| M6 | — | Conflict detection — STCA with urgency label promotion |

---

## Licence

MIT — see [LICENCE](LICENCE) for details.
