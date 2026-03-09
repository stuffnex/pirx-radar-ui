# PIRX — Radar / SDR Console

A browser-based ATC radar display and VHF communications scanner.
Zero dependencies, zero build step — three static files, any host.

**Version:** 0.8.0 · **Reference:** EDDN/NUE Nuremberg · See [CHANGELOG.md](CHANGELOG.md)

---

## Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ ⬡ PIRX  Radar / SDR Console    ● MOCK   11 TRACKS  EDDN/NUE  40NM  │
├─────────────────────────────────────┬─┬──────────────────────────────┤
│                                     │›│  ⊕ Selected Track           │
│   Canvas radar                      │ │  ICAO  3C1A3F               │
│   equirectangular projection        │ │  CALL  DLH123               │
│   range rings · sector lines        │ │  REF   EDDN/NUE             │
│   velocity leaders                  │ │  DIST  12.4 NM              │
│                                     │ │  BRG   247°                 │
│   iCAS2 transparent labels:         │ │  LAT   49.4100°N            │
│   V   DLH123  NUE                   │ │  LON   011.1200°E           │
│   FL340↓-08   FL360                 │ │  PLOC  NO                   │
│   GS452                             │ │                             │
│   [■ white square symbols]          │ │  [‹ collapses panel]        │
├──────────────────┬──────────────────┴─┴──────────┬──────────────────┤
│ ATC Scanner      │ 118──120──122──124──126──128   │ System Log       │
│ 119.475 STBY TFR │ [FFT spectrum][waterfall]      │ 12:34:01Z …      │
│ APP TWR GND DEL  │ STBY mode → click to tune      │                  │
│ CTR ATIS         │                                │                  │
└──────────────────┴────────────────────────────────┴──────────────────┘
```

The `›` / `‹` pad on the border toggles the right panel. Aircraft auto-open it on selection and auto-close it on deselect.

---

## Features

### 1. Aircraft Symbols

- **White squares** — pure `#ffffff` fill, no stroke, no heading rotation
- Normal: 3×3 px device-pixel square; Selected: 5×5 px
- Selection glow and velocity leader unchanged

### 2. iCAS2 Tag System — top line squawk rules

Labels are rendered with no background. Top line (row 1) shows **only** the squawk token:

| Squawk | Display | Colour |
|---|---|---|
| 7000 | `V` | `#00ff88` green |
| 7500 / 7600 / 7700 | code e.g. `7500` | `#ff4444` red |
| all others | code e.g. `2000` | `#66ccff` light blue |

No `WARNINGS` text. No hex ICAO on the tag. Secondary fields (CFL, COP, ASP…) render at 35% opacity of track colour.

**PLOC indicator** (live mode, signal age 30–60 s): orange `PLOC` token appended to row 1.

**Tagged format:**
```
V   DLH123  NUE
FL340↓-08   FL360
GS452
```

**Detailed format (selected):**
```
V   PLOC
DLH123  NUE  A320  H  +
FL340↓-08  +800  FL360  WST
GS452  480  270  FL380  FRA  FL320
DIAS  DMACH  DHDG  TRACK
```

### 3. ATC Frequency Scanner — STBY/TFR workflow

```
STBY  TFR
[119.475 MHz]   TUNED ACTIVE MUTE NORM
```

**Workflow:**
1. Click **STBY** → button highlights yellow, presets unlock, waterfall click-to-tune activates
2. Dial frequency using step buttons or click waterfall
3. Click **TFR** → STBY frequency transfers to active display; TFR highlights yellow; STBY stays lit
4. Click a **preset** (while in STBY) → memorises current STBY frequency into that slot

**Preset protection:**
- Presets are **read-only** unless STBY is active
- **2-second long-press** on any preset → resets it to the factory EDDN default
- Waterfall click-to-tune is **disabled** unless STBY is active (cursor shows `not-allowed`)

**Factory EDDN/NUE defaults:**

| Preset | MHz | Service |
|---|---|---|
| APP | 119.475 | EDDN Approach |
| TWR | 118.305 | EDDN Tower |
| GND | 121.760 | EDDN Ground |
| DEL | 121.760 | EDDN Delivery |
| CTR | 129.525 | Langen Radar |
| ATIS | 123.080 | EDDN ATIS |

### 4. EDDN/NUE Coordinates in Selected Track Panel

The selected track panel now shows position relative to the EDDN/NUE reference point:

| Field | Description |
|---|---|
| REF | Reference airport: `EDDN/NUE` |
| DIST | Great-circle distance in NM |
| BRG | Magnetic bearing from EDDN/NUE |
| LAT / LON | Absolute coordinates with N/S/E/W suffix |

### 5. Live Mode Signal Lifetime

Applies only when connected to a live backend (not mock):

| Age | Display |
|---|---|
| 0 – 30 s | Normal squawk colour |
| 30 – 60 s | Orange `PLOC` appended to row 1; squawk keeps its colour |
| > 60 s | Track removed from display |

### 6. Collapsible Selected Track Panel

- `›` / `‹` toggle pad sits on the vertical border between radar and right panel
- **Auto-opens** when an aircraft is selected
- **Auto-collapses** when aircraft is deselected
- CSS `width` transition (180 ms) — smooth, no layout jump
- Canvas resizes automatically after collapse/expand

---

## File Structure

```
pirx-radar-ui/
├── index.html      Layout + HTML structure
├── style.css       Dark theme, ATC scanner, collapsible panel, STBY states
├── app.js          All logic — radar, iCAS2, ATC scanner, waterfall, WS/mock
├── README.md       This file
└── CHANGELOG.md    Version history
```

---


---

## Real-time Audio Receiver (auto-streaming)

PIRX v0.8.0 adds an always-on VHF audio receiver that behaves like a real ATC scanner — no play buttons, no user action required.

### How it works

When the active frequency changes (preset click, TFR commit, user slot tune) the frontend **immediately connects** to the backend audio stream for that frequency. The stream stays open 24/7 until the frequency changes or the tab is closed.

```
Frequency change → audioConnect(freq)
  └─ GET /audio/stream?freq=119.475  (chunked audio/mpeg)
       ├── ● LIVE       — streaming normally
       ├── ⚠ BUFFERING  — connecting / stalled
       └── ✗ OFFLINE    — backend unavailable (3 retries × 3 s)
```

### Status indicator

The status dot sits inline in the frequency row, right of TUNED / ACTIVE:

| State | Dot colour | Label |
|---|---|---|
| Streaming | Green glow | `LIVE` |
| Connecting / stalled | Amber | `BUFFERING` |
| Unavailable | Dim | `OFFLINE` |

### Mute toggle

The **MUTE** button in the frequency row toggles audio silence without disconnecting the stream. While muted the button shows **UNMUTE**. The underlying stream stays connected — unmuting resumes instantly with no reconnect delay.

### STBY/TFR behaviour

- **STBY mode** (dialling a new frequency): audio **stays on the current active** frequency — no interruption while browsing.
- **TFR** (commit standby to active): audio **switches immediately** to the new frequency.

### Backend API this frontend expects

```
GET /audio/stream?freq=<MHz>
  Response: Content-Type: audio/mpeg
            Transfer-Encoding: chunked
            Connection: keep-alive
  Body: continuous MP3 / AAC stream of demodulated VHF-AM audio
```

Alternatively a WebSocket endpoint can be used — replace `AUDIO_STREAM_URL()` in `app.js`:

```js
// HTTP stream (default)
function AUDIO_STREAM_URL(khz) {
  return `${API_BASE}/audio/stream?freq=${(khz/1000).toFixed(3)}`;
}

// WebSocket alternative — swap <audio>.src for a WebSocket + AudioContext
// (requires additional Web Audio API plumbing)
```

### Retry logic

On stream error the frontend retries up to `AUDIO_MAX_RETRIES` (3) times with `AUDIO_RETRY_MS` (3 000 ms) between attempts. After three failures the status shows `OFFLINE` and retrying stops. A subsequent frequency change resets the retry counter and reconnects.

### Pi performance notes

- Uses a single `<audio>` element — zero Web Audio API overhead
- Stream is paused (not disconnected) on mute — no reconnect cost
- Old stream torn down before new one opens — no concurrent connections
- Graceful on backend restart — next frequency change reconnects automatically

## Deployment

### Static file serving (any host)

No build step. Serve the three files from any static host.

```bash
# Local development
python3 -m http.server 8080
# or
npx serve .
```

### Cloudflare Tunnel (Pi → public HTTPS)

See [CLOUDFLARE-TUNNEL.md](CLOUDFLARE-TUNNEL.md) for full setup guide.

Short version:
1. Install `cloudflared` on the Pi
2. `cloudflared tunnel login`
3. `cloudflared tunnel create pirx`
4. Configure public hostname → `http://localhost:8080`
5. `cloudflared tunnel run pirx`

The frontend auto-detects it is on a production host and switches to `wss://` with no port.

### Backend endpoint configuration

Edit the two constants at the top of `app.js`:

```js
const PRODUCTION_HOSTS = [
  'pirx.dustyhut.org',   // ← your Cloudflare Tunnel / custom domain
];
const LOCAL_PORT = 8080;  // ← backend port for LAN / localhost
```

All other URL logic is automatic. See the full comment block in `app.js` for multi-domain and reverse-proxy setups.

---

## Backend WebSocket format

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

All fields except `icao`, `lat`, `lon` optional. Backend also optionally exposes `GET /health` and `GET /status`.

---

## Browser Compatibility

| Browser | Minimum |
|---|---|
| Chrome / Edge | 80+ |
| Firefox | 75+ |
| Safari | 14+ |

High-DPI rendering automatic via `window.devicePixelRatio`.
Tested on Raspberry Pi 4 Chromium (1024×600).

---

## Roadmap

| Milestone | Status | Description |
|---|---|---|
| M1 | ✅ | Static frontend, mock data, iCAS2 labels, ATC scanner |
| M2 | ✅ | 10 MHz waterfall, click-to-tune, EDDN frequencies, clean tags |
| M3 | ✅ | STBY/TFR workflow, collapsible panel, white squares, signal lifetime |
| M4-audio | ✅ | Always-on audio receiver, auto-stream on freq change, mute toggle |
| M4 | — | Real FFT — RTL-SDR or WebSDR WebSocket feed |
| M5 | — | Sector geometry overlay (TMA / CTR / airways GeoJSON) |
| M6 | — | Live ADSB adapter (OpenSky / ADSB-Exchange) |
| M7 | — | Conflict detection — STCA with urgency label promotion |

---

## Licence

MIT — see [LICENCE](LICENCE).
