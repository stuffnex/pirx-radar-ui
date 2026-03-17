# PIRX Frontend — pirx-radar-ui

**Version:** 0.9.0  
**Files:** `app.js` · `index.html` · `style.css`  
**Served by:** the backend as static files from `~/PIRX/pirx-radar-ui/`

---

## What it does

- iCAS2-style ATC radar canvas — live ADS-B aircraft as white squares with draggable tags
- ATC Scanner — frequency presets, STBY/TFR workflow, user slots 1–4, gain slider
- Always-on VHF-AM audio receiver — auto-connects on frequency change, mute toggle
- FFT/Waterfall — live spectrum from backend `/audio/fft`, fallback to mock
- Selected track panel — ICAO, callsign, FL, GS, bearing/distance from EDDN
- System Log — all events timestamped in UTC

---

## Deploy

```bash
# Copy files to the directory the backend serves
cp app.js index.html style.css ~/PIRX/pirx-radar-ui/
pm2 restart pirx-backend

# Hard-refresh browser to bypass cache
# Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac)
```

---

## Configure production hostname

Edit `app.js` — find `PRODUCTION_HOSTS` near the top:

```js
const PRODUCTION_HOSTS = [
  'pirx.dustyhut.org',   // ← replace with your Cloudflare Tunnel hostname
];
```

This controls whether the frontend uses `wss://` (production) or `ws://:8080` (LAN).

---

## Key constants in `app.js`

```js
const PRODUCTION_HOSTS  = ['pirx.dustyhut.org']; // your hostname(s)
const LOCAL_PORT        = 8080;                   // backend port for LAN
const REF_LAT           = 49.498611;              // EDDN ARP 49°29'55"N
const REF_LON           = 11.078056;              // EDDN ARP 011°04'41"E
const SIGNAL_PLOC_AGE   = 30;                     // s before PLOC badge
const SIGNAL_MAX_AGE    = 60;                     // s before track removed
const WF_POLL_MS        = 3500;                   // FFT poll interval ms
const AUDIO_MAX_RETRIES = 3;                      // audio retry attempts
const AUDIO_RETRY_MS    = 3000;                   // ms between retries
```

---

## ATC Scanner usage

### Presets (APP / TWR / GND / DEL / CTR / ATIS)
- **Click** → tune to that frequency (audio switches immediately)
- **Long press 2s** → reset to EDDN factory default

### User slots (1 / 2 / 3 / 4)
- **Click** → tune if stored (empty slots do nothing)
- **Long press 2s** → erase slot

### STBY / TFR workflow

```
1. STBY     → highlights cyan — step buttons + waterfall dial standby freq
               audio stays on active frequency
2. TFR      → commits standby to active — audio switches
               scanner waits for destination
3. Preset/slot → frequency stored — STBY+TFR both turn off
Press STBY again to cancel at any time.
```

### Sliders
| Slider | Range | Effect |
|---|---|---|
| VOL | −60–0 dB | Software output volume |
| SQL | −80–0 dB | Squelch threshold |
| GAIN | 0–50 dB | RTL-SDR tuner gain — reconnects audio stream on change |

---

## Audio receiver

- Connects automatically on every frequency change — no play button
- Default state: **MUTED** — click UNMUTE to hear audio
- Status dot: `● LIVE` (green) / `● BUFFERING` (amber) / `● OFFLINE` (dim)
- Backend URL: `GET /audio/stream?freq=<kHz>&gain=<dB>`

---

## FFT / Waterfall

- Polls `GET /audio/fft?bins=<N>&gain=<dB>` every 3.5s
- Live data: trace turns **green**, badge shows `● LIVE FFT`
- Mock mode: trace is **teal**, badge shows `● MOCK FFT`
- Click waterfall in STBY mode to tune standby frequency (snaps to 8.33 kHz)

---

## Radar controls

| Action | Effect |
|---|---|
| Click aircraft | Select / deselect (opens right panel) |
| Drag aircraft tag | Reposition tag — connector line follows |
| Drag empty space | Pan radar |
| Scroll wheel | Zoom in/out |
| `›` toggle | Collapse/expand right panel |

---

## Changelog

See `FRONTEND-CHANGELOG.md`
