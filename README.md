# PIRX — Radar / SDR Console

A browser-based ATC radar display and VHF communications scanner. Zero dependencies, zero build step — drop three files on any static host and open `index.html`.

Originally prototyped as an iCAS2-style interface, the project was renamed **PIRX** and progressively evolved through several design iterations documented in [CHANGELOG.md](CHANGELOG.md).

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
│   velocity leaders                  │  STATE  ASSUMED              │
│                                     │  …                           │
│   iCAS2 transparent labels:         │                              │
│   V DLH123  FL340▶+15  FL360  452   │                              │
│                                     │                              │
├───────────┬─────────────────────────┴──────────┬───────────────────┤
│ ATC       │  FFT / Waterfall                   │  System Log       │
│ Scanner   │  [animated spectrum + waterfall]   │  12:34:01Z …      │
└───────────┴────────────────────────────────────┴───────────────────┘
```

The screen is divided into **75% radar canvas** (top) and **25% bottom strip** (SDR scanner · waterfall · log). A 220 px right panel shows the selected track detail.

---

## Features

### Radar Display

- Equirectangular canvas projection centred on a configurable reference coordinate (default EDDW/EDDH — 52°31'N 008°32'E)
- Range rings at 5 / 10 / 20 / 40 / 80 / 120 NM; highlighted rings at 10 / 40 / 80 NM at 40 % cyan opacity
- Sector lines every 30°, radial vignette
- Aircraft rendered as heading-oriented chevrons — `#00ff88` green fill, white/colour stroke
- 2-minute velocity look-ahead leader lines
- Mouse-wheel **zoom** 0.5× – 8×, click-drag **pan**
- Click aircraft to select; selection ring pulses with glow animation

### iCAS2 Transparent Label System

Labels are rendered with **no background boxes** — colour is encoded in the text only, matching authentic ATC display convention. Dim fields (secondary data) render at ~38 % opacity of the track colour.

**Tag colour determined by squawk code:**

| Squawk | Colour | Meaning |
|---|---|---|
| 7500 / 7600 / 7700 | `#ff4444` red | Hijack / radio failure / emergency |
| 0000 – 0777 | `#ffaa00` amber | OAT / military |
| 7000 | `#00ff88` green | VFR standard |
| all others | `#66ccff` light blue | IFR general |

**Tagged format** (unselected — 5 rows, secondary fields dim):

```
V   DLH123  LGW  H
FL340▶  +15  +400  FL360  TOP
452  480  270  FL380  HAM  FL320
DIAS  DMACH
```

**Detailed format** (selected — same rows, more fields promoted to full brightness):

```
V   WARNINGS
DLH123  LGW  A320  H  +
FL340↓  +15  +800  FL360  TOP
452  480  270  FL380  HAM  FL320
DIAS  DMACH  DHDG  TRACK
```

Field glossary: SQI · CALLSIGN · SI (sector indicator) · ATYP (aircraft type) · WTC (wake turbulence category) · AFL (actual flight level) · CRC (climb-rate code) · ARC (assigned rate of climb) · CFL (cleared flight level) · COP (coordination point) · GS (ground speed) · ASP (assigned speed) · AHDG (assigned heading) · XFL (extended CFL) · ADES (destination) · PEL (pending entry level).

### ATC Frequency Scanner

- Frequency display: `XXX.XXX MHz`, bold 22 px Courier New
- Step buttons: `−25 | −8.33 | −5  kHz  +5 | +8.33 | +25`
- **INV toggle** — reverses step-cycle order:
  - NORM: 5 → 8.33 → 25 → 5 …
  - INV:  25 → 8.33 → 5 → 25 …
  - Index cycles on repeated press of the same direction
- **5 memory channels** with stored-frequency sub-labels:
  - Single click → tune to stored frequency
  - Long-press 600 ms or right-click → write current frequency into that slot
- VOL and SQL sliders with dB readout
- MUTE toggle (🔊 / 🔇)
- Status pills: `TUNED` · `ACTIVE` · `MUTE` · `NORM`/`INV`

**Default EDDW / EDDH memory presets:**

| Channel | Frequency | Use |
|---|---|---|
| APP | 118.425 MHz | Bremen Approach (RWY 09/27) |
| TWR | 118.750 MHz | Bremen Tower |
| GND | 121.875 MHz | Bremen Ground |
| DEL | 121.300 MHz | Bremen Delivery |
| CTR | 128.425 MHz | Bremen Radar / CTR |

### FFT / Waterfall

- Animated live waterfall scrolls downward at ~12.5 rows/s (80 ms tick)
- Colour gradient: black → deep teal → cyan → white for signal intensity
- Top 38 % of the panel: FFT spectrum line graph with dB grid overlay
- Signal peaks anchored to absolute frequencies — they scroll left/right as you retune
- White solid centre-frequency marker line with notch at top
- Frequency axis: `fc − 0.5 MHz  |  fc  |  fc + 0.5 MHz`, updates on every retune
- History resets cleanly when frequency changes

### System Log

- Prepend-on-top display, max 60 entries, auto-purges oldest
- Colour codes: white (info) · amber (warn) · green (ok) · red (error)
- UTC timestamps `HH:MM:SSZ`

---

## File Structure

```
pirx-radar-ui/
├── index.html      Layout: top bar · radar canvas · right panel · bottom strip
├── style.css       Dark theme · ATC scanner controls · transparent label colour refs
├── app.js          All logic: radar · iCAS2 labels · ATC scanner · waterfall · mock/WebSocket
├── README.md       This file
└── CHANGELOG.md    Version history
```

No `node_modules`, no bundler, no framework. The three source files are all you need to ship.

---

## Deployment

### Static hosting (Cloudflare Pages / Netlify / GitHub Pages)

Commit `index.html`, `style.css`, `app.js` to any public repository and point your host at the root (or subdirectory). No build command is required.

### Local development

```bash
# Python (any machine with Python 3)
python3 -m http.server 8080

# Node (if installed)
npx serve .

# Then open:
open http://localhost:8080
```

### Connecting a real backend

Edit the constant at the top of `app.js`:

```js
const BACKEND_WS_URL = 'wss://your-backend-host/ws';
```

On load the app opens a WebSocket. If the connection fails or does not open within 5 seconds, it falls back automatically to the built-in mock data generator and logs a warning.

**Expected WebSocket push format (`type: "tracks"`):**

```json
{
  "type": "tracks",
  "tracks": [
    {
      "icao":        "3C1A3F",
      "callsign":    "DLH123",
      "lat":         52.41,
      "lon":         8.72,
      "altitude":    34000,
      "groundspeed": 452,
      "heading":     270,
      "squawk":      "7000",
      "track_age":   0
    }
  ]
}
```

All fields except `icao`, `lat`, `lon` are optional — the renderer degrades gracefully with placeholder values.

---

## Configuration

All tuneable constants live at the top of `app.js`:

```js
// ── Backend
const BACKEND_WS_URL = 'wss://…';

// ── Radar centre (EDDW/EDDH default)
const REF_LAT = 52.52;
const REF_LON =  8.53;

// ── ATC scanner memory presets (kHz)
let memory = {
  APP: 118425,   // 118.425 MHz
  TWR: 118750,   // 118.750 MHz
  GND: 121875,   // 121.875 MHz
  DEL: 121300,   // 121.300 MHz
  CTR: 128425,   // 128.425 MHz
};
```

---

## Browser Compatibility

Requires Canvas 2D API and WebSocket — both available in every evergreen browser since 2016.

| Browser | Minimum version |
|---|---|
| Chrome / Edge | 80+ |
| Firefox | 75+ |
| Safari | 14+ |

High-DPI / Retina rendering is automatic via `window.devicePixelRatio`.

---

## Roadmap

| Milestone | Description |
|---|---|
| ✅ M1 | Static frontend, mock data, iCAS2 labels, ATC scanner |
| M2 | Real FFT — RTL-SDR WebSocket feed replaces animated placeholder |
| M3 | Sector geometry overlay (TMA / CTR / airways as GeoJSON) |
| M4 | Live ADSB adapter (OpenSky / ADSB-Exchange REST or WebSocket) |
| M5 | Conflict detection — STCA with urgency label promotion |

---

## Licence

MIT — see [LICENCE](LICENCE) for details.
