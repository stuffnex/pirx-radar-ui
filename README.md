# PIRX — Radar / SDR Console

**Version:** 0.9.0  
**Platform:** Raspberry Pi 4 (tested) · Any Linux with Node.js 18+  
**Stack:** Vanilla JS + Canvas · Node.js + Express + ws (no build step)

```
⬡ PIRX  Radar / SDR Console  v0.9.0
┌──────────────────────────────────────────────────────────────┐
│  Canvas radar (iCAS2-style)    │  Selected track panel       │
│  White square aircraft symbols │  ICAO / callsign / FL / GS  │
│  Drag tags · zoom · pan        │  REF dist/bearing to EDDN   │
├──────────────────────────────────────────────────────────────┤
│  ATC Scanner  │  FFT/Waterfall (live or mock)  │  System Log │
└──────────────────────────────────────────────────────────────┘
```

---

## Table of Contents

1. [Hardware requirements](#1-hardware-requirements)
2. [Raspberry Pi initial setup](#2-raspberry-pi-initial-setup)
3. [RTL-SDR dongle configuration](#3-rtl-sdr-dongle-configuration)
4. [Backend installation](#4-backend-installation)
5. [Frontend deployment](#5-frontend-deployment)
6. [Cloudflare Tunnel](#6-cloudflare-tunnel-remote-access)
7. [ATC Scanner usage](#7-atc-scanner-usage)
8. [Real-time audio receiver](#8-real-time-audio-receiver)
9. [FFT / Waterfall](#9-fft--waterfall)
10. [Configuration reference](#10-configuration-reference)
11. [Troubleshooting](#11-troubleshooting)
12. [Milestone roadmap](#12-milestone-roadmap)

---

## 1. Hardware requirements

| Item | Notes |
|---|---|
| Raspberry Pi 4 (2 GB+) | Pi 3B+ also works, slightly more CPU load |
| MicroSD 16 GB+ (class 10) | Raspberry Pi OS Lite 64-bit recommended |
| RTL-SDR dongle #1 | ADS-B reception at 1090 MHz |
| RTL-SDR dongle #2 | VHF audio reception 118–137 MHz |
| 1090 MHz antenna | Dedicated ADS-B antenna |
| VHF antenna | Quarter-wave whip or discone 118–137 MHz |
| Powered USB hub (optional) | Recommended for two dongles on Pi USB |

> **One dongle cannot do two things simultaneously.**
> The RTL2832U has a single tuner — one frequency at a time.
> You need two separate dongles: one locked to 1090 MHz for ADS-B,
> one free to tune VHF airband for audio.

---

## 2. Raspberry Pi initial setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install required packages
sudo apt install -y nodejs npm rtl-sdr ffmpeg git curl

# Verify Node.js version (need 18+)
node --version

# Blacklist DVB kernel module — prevents kernel from claiming RTL dongles
echo 'blacklist dvb_usb_rtl28xxu' | sudo tee /etc/modprobe.d/rtl-sdr.conf
sudo rmmod dvb_usb_rtl28xxu 2>/dev/null || true

# Verify both dongles are visible
rtl_test -t 2>&1 | grep -E 'Found|SN:'
# Expected:
#   Found 2 device(s):
#     0:  Nooelec, NESDR Nano 3, SN: stx:978:0   ← audio dongle
#     1:  Nooelec, NESDR Nano 3, SN: AIS          ← ADS-B dongle
```

---

## 3. RTL-SDR dongle configuration

### Identify which dongle is which

```bash
# Stop any services that hold dongles
sudo systemctl stop fr24feed 2>/dev/null

# List all dongles with serial numbers
rtl_test -t 2>&1 | grep -E 'Found|SN:|device'

# Test each dongle — note which opens for ADS-B vs audio
rtl_fm -d 0 -f 1090000000 -s 2000000 - 2>&1 | head -3
rtl_fm -d 1 -f 1090000000 -s 2000000 - 2>&1 | head -3
```

### Set permanent serial numbers (recommended)

```bash
# Assign SN to ADS-B dongle
rtl_eeprom -d 0 -s ADS-B
# Assign SN to audio dongle
rtl_eeprom -d 1 -s AUDIO
# Reboot to apply
sudo reboot
```

After reboot you can address dongles by serial:
- `rtl_fm -d AUDIO ...` — audio dongle
- Beast/fr24feed configured with the ADS-B dongle index

---

## 4. Backend installation

```bash
# Clone repository
git clone https://github.com/youruser/pirx.git ~/PIRX
cd ~/PIRX

# Install Node.js dependencies
npm install

# Configure environment
cp .env.example .env
nano .env
```

### Environment variables (`.env`)

```bash
# ── Network ──────────────────────────────────────────────────
HTTP_PORT=8080          # Port the backend listens on
BEAST_HOST=127.0.0.1   # Beast TCP host
BEAST_PORT=30005        # Beast output port (binary Beast format)

# ── RTL-SDR ──────────────────────────────────────────────────
AUDIO_SOURCE=rtl_fm     # 'rtl_fm' | 'alsa' | 'mock'
RTL_DEVICE=1            # Device index for audio dongle
                        # Check with: rtl_test -t 2>&1 | grep SN
RTL_GAIN=40             # Tuner gain 0-50 dB

# ── Behaviour ────────────────────────────────────────────────
BROADCAST_HZ=2          # WebSocket track broadcast rate (Hz)
TRACK_TIMEOUT=60000     # Remove track after N ms without update
AUDIO_IDLE_TTL=5000     # Stop audio process after N ms idle
MOCK_ON_FAILURE=true    # Serve mock tracks if Beast disconnects
```

### Start with PM2

```bash
sudo npm install -g pm2
pm2 start server.js --name pirx-backend
pm2 save
pm2 startup   # follow printed instructions for auto-start on reboot
```

### Verify backend

```bash
pm2 logs pirx-backend --lines 20
curl http://localhost:8080/health
curl http://localhost:8080/status
curl http://localhost:8080/audio/freqs

# Test audio stream (Ctrl+C after 3s — should print ID3 header)
curl -s --max-time 5 "http://localhost:8080/audio/stream?freq=119475" | \
  od -A x -t x1z | head -3
```

---

## 5. Frontend deployment

```bash
# Copy frontend files to the static directory the backend serves
cp app.js index.html style.css ~/PIRX/pirx-radar-ui/
pm2 restart pirx-backend

# Local access:      http://<pi-ip>:8080
# Cloudflare access: https://your-tunnel-hostname
```

### Configure production hostname in `app.js`

```js
// Near the top of app.js — find PRODUCTION_HOSTS:
const PRODUCTION_HOSTS = [
  'pirx.dustyhut.org',   // ← replace with your hostname
];
```

---

## 6. Cloudflare Tunnel (remote access)

```bash
# Install cloudflared (ARM64 for Pi 4)
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64
sudo mv cloudflared-linux-arm64 /usr/local/bin/cloudflared
sudo chmod +x /usr/local/bin/cloudflared

# Authenticate (do this on a desktop, copy cert.pem to Pi)
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create pirx

# ~/.cloudflared/config.yml
cat > ~/.cloudflared/config.yml << 'YAML'
tunnel: <your-tunnel-uuid>
credentials-file: /home/pi/.cloudflared/<uuid>.json
ingress:
  - hostname: pirx.yourdomain.com
    service: http://localhost:8080
  - service: http_status:404
YAML

# Add DNS record
cloudflared tunnel route dns pirx pirx.yourdomain.com

# Run as PM2 service
pm2 start "cloudflared tunnel run pirx" --name pirx-tunnel
pm2 save
```

Cloudflare passes `audio/mpeg` chunked streams through as `DYNAMIC` — no
special configuration needed for audio streaming.

---

## 7. ATC Scanner usage

### Frequency presets (APP / TWR / GND / DEL / CTR / ATIS)

- **Click** — tune active frequency to this preset
- **Long press (2s)** — reset to EDDN/NUE factory default

| Preset | MHz | Service |
|---|---|---|
| APP | 119.475 | Nuremberg Approach |
| TWR | 118.305 | Nuremberg Tower |
| GND | 121.760 | Nuremberg Ground |
| DEL | 121.760 | Delivery |
| CTR | 129.525 | Munich Radar |
| ATIS | 123.080 | Nuremberg ATIS |

### User slots 1–4

- **Click** — tune to stored frequency (if not empty)
- **Long press (2s)** — erase slot (flashes red)

### STBY / TFR workflow

```
1. Press STBY      → STBY highlights cyan
                     Step buttons + waterfall dial STANDBY frequency
                     Active audio stays on current frequency

2. Dial frequency  → use ±25 / ±8.33 / ±5 kHz buttons
                     or click on the FFT/Waterfall

3. Press TFR       → Standby frequency becomes active
                     Audio switches to new frequency
                     Scanner waits for destination

4. Press preset or slot 1–4
                   → Frequency stored in that button
                     STBY and TFR both turn off
                     Destination button highlights as active

Press STBY again at any time to cancel.
```

### Sliders

| Slider | Range | Effect |
|---|---|---|
| VOL | −60 to 0 dB | Software output volume |
| SQL | −80 to 0 dB | Squelch threshold |
| GAIN | 0 to 50 dB | RTL-SDR tuner gain — reconnects stream on change |

---

## 8. Real-time audio receiver (auto-streaming)

```
Frequency change
  └─ audioConnect(freqKHz)
       └─ GET /audio/stream?freq=<kHz>&gain=<dB>
            └─ rtl_fm -f <Hz> -M am -s 200k -r 48000 -d <device>
                 └─ ffmpeg → MP3 → browser <audio> element
```

- Audio connects **automatically** on frequency change — no play button
- Default state: **MUTED** — click UNMUTE to hear audio
- STBY dialling: audio stays on active frequency
- TFR commit: audio switches immediately

### Status indicator (inline, right of TUNED/ACTIVE)

| State | Colour | Label |
|---|---|---|
| Streaming | Green glow | `LIVE` |
| Connecting | Amber | `BUFFERING` |
| Failed | Dim | `OFFLINE` |

### Backend API

```
GET /audio/stream?freq=<kHz>&gain=<0-50>
Response: Content-Type: audio/mpeg
          Transfer-Encoding: chunked
```

---

## 9. FFT / Waterfall

### Live mode (requires `/audio/fft` backend route)

See `server-fft-patch.js` for the implementation using `rtl_power`.

```
GET /audio/fft?bins=<N>&gain=<0-50>
Response: { bins: [0.0..1.0, ...], min_khz: 118000, max_khz: 128000 }
```

- Spectrum trace turns **green**, badge shows `● LIVE FFT`
- Polls at 150 ms intervals (~6 fps waterfall scroll)

> **Device conflict:** `rtl_power` and `rtl_fm` cannot run simultaneously on
> the same dongle. Live FFT only works when no audio stream is active.

### Mock mode

Default when backend FFT route is unavailable. Trace is **teal**, badge shows
`● MOCK FFT`. Animated peaks at known EDDN frequencies.

### Waterfall interaction

- **STBY mode**: click waterfall to tune standby frequency (snaps to 8.33 kHz)
- White line = tuned frequency
- Dashed teal line = active frequency when STBY engaged

---

## 10. Configuration reference

### app.js frontend constants

```js
const PRODUCTION_HOSTS  = ['pirx.dustyhut.org']; // your hostname(s)
const LOCAL_PORT        = 8080;
const REF_LAT           = 49.498611;  // EDDN ARP 49°29'55"N
const REF_LON           = 11.078056;  // EDDN ARP 011°04'41"E
const SIGNAL_PLOC_AGE   = 30;         // s before PLOC badge
const SIGNAL_MAX_AGE    = 60;         // s before track removed
const WF_POLL_MS        = 150;        // FFT poll interval ms
const AUDIO_MAX_RETRIES = 3;          // stream retry attempts
const AUDIO_RETRY_MS    = 3000;       // ms between retries
```

---

## 11. Troubleshooting

### Radar shows MOCK instead of LIVE

```bash
wscat -c ws://localhost:8080/ws/traffic   # should print JSON immediately
curl -s http://localhost:8080/status | python3 -m json.tool
ps aux | grep rtl_fm    # kill any stale process holding the dongle
pm2 restart pirx-backend
```

### Audio OFFLINE / BUFFERING permanently

```bash
# Test pipeline directly
rtl_fm -d 1 -f 119475000 -M am -s 200k -r 48000 -g 40 - 2>/dev/null | \
  ffmpeg -f s16le -ar 48000 -ac 1 -i pipe:0 -codec:a libmp3lame -b:a 32k -f mp3 pipe:1 | \
  od -A x -t x1z | head -3
# Adjust -d index if needed
```

### Only APP works, other presets silent

Fixed in v0.9.0. Update `app.js` — the audio reconnect guard was preventing
frequency switches when the old stream was still "playing".

### Buttons 1–4 stay highlighted

Fixed in v0.9.0. `clearAllActive()` now runs before any preset or slot
is highlighted.

---

## 12. Milestone roadmap

| Milestone | Status | Description |
|---|---|---|
| M1 | ✅ | iCAS2 radar canvas, mock tracks, tag system |
| M2 | ✅ | STBY/TFR workflow, collapsible panel, white squares |
| M3 | ✅ | Always-on audio receiver, auto-stream, mute toggle |
| M4 | ✅ | Live ADS-B via Beast TCP, EDDN ARP coordinates |
| M5 | ✅ | AM fix, ffmpeg pipeline, autoplay fix, gain slider |
| M6 | 🔲 | Live FFT via rtl_power (server-fft-patch.js ready) |
| M7 | 🔲 | Approach plate overlay |
| M8 | 🔲 | Multi-sector / multi-position |
