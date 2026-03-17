# Changelog — pirx-radar-ui (Frontend)

---

## [0.9.0] — 2026-03-17

### Fixed
- **Audio silent on all presets except APP** — `audioConnect()` guard checked
  `audioConnectedFreq === khz && !audioEl.paused` which was true even when
  switching to a different frequency because the old stream was still "playing".
  Fixed: guard now requires `audioEl.readyState >= 2` and matching `audioEl.src`.
- **Buttons 1–4 staying highlighted after pressing preset** — `updateAllMemBtns()`
  and `updateUserBtns()` managed highlights independently. Added `clearAllActive()`
  which strips `active-mem` from every `.mem-btn` before setting new active key.
  Called in `tunePreset()`, `tuneUserSlot()`, and `commitToDestination()`.

### Added
- **GAIN slider** (row 3) — range 0–50 dB, default 40. State variable `rtlGain`.
  Changing gain resets `audioConnectedFreq = null` and calls `audioOnFreqChange()`
  to reconnect stream with new value. VOL width reduced to `flex:0.9`, SQL to
  `flex:0.4` to free space.
- **Live FFT waterfall** — `wfPollFFT()` polls `GET /audio/fft` every 3500ms.
  `wfPollPending` guard prevents overlapping `rtl_power` spawns.
  Live trace: **green** + `● LIVE FFT` badge. Mock trace: **teal** + `● MOCK FFT`.
- **`clearAllActive()`** — strips `active-mem` from all buttons; called before
  any new highlight is set to ensure presets and slots are mutually exclusive.

### Changed
- FFT poll interval `150ms → 3500ms` — `rtl_power` needs ~2–3s per sweep.
- `AUDIO_STREAM_URL()` now appends `&gain=${rtlGain}` to stream URL.
- `wfPollFFT` timeout `500ms → 4000ms` to allow full sweep to complete.

---

## [0.8.0] — 2026-03-17

### Added
- Always-on audio receiver — `audioConnect(khz)`, `audioDisconnect()`,
  `audioOnFreqChange()`, `setAudioStatus(state)`.
- Hidden `<audio id="atc-audio">` element, created at runtime.
- Retry logic: `AUDIO_MAX_RETRIES = 3` × `AUDIO_RETRY_MS = 3000ms`.
- `#audio-status` dot+label inline in pills row: LIVE / BUFFERING / OFFLINE.
- `#btn-mute` moved from slider row to pills row; shows UNMUTE while muted.
- Default `isMuted = true` — stream connects muted on boot.

### Fixed
- **Autoplay policy** — `audioEl.play()` moved into `toggleMute()` click handler
  (user gesture context). Previously called from `oncanplay` (async, blocked).
- **Audio stream URL** — changed from `?freq=119.475` to `?freq=119475`
  (integer kHz matching backend expectation).
- **`vertical_rate` field name** — backend sends `vertical_rate`, frontend
  expected `_vr`. Added normalisation in `handleTracksMsg()`.

---

## [0.7.2] — 2026-03-17

### Fixed
- Pills align right (`justify-content:space-between` on `.atc-freq-row`).
- Step row centred (`justify-content:center` on `.atc-step-row`).

### Changed
- `REF_LAT = 49.498611`, `REF_LON = 11.078056` — exact EDDN ARP coordinates
  (was rounded 49.49 / 11.08).
- Topbar REF label split to two lines: `EDDN/NUE` / `49°29'55"N 011°04'41"E`.
- Version badge `v0.7.2` added to topbar title.

---

## [0.7.1] — 2026-03-09

### Fixed
- All remaining `isStby` references replaced with `scanPhase` equivalents
  in waterfall section (4 occurrences): `isStby ? stbyFreq : freq` →
  `scanPhase >= 1 ? stbyFreq : freq`, etc.

---

## [0.7.0] — 2026-03-09

### Added
- **White square aircraft symbols** — replaced chevron/diamond with `fillRect`.
- **Squawk colour rules** — `7000`→green V, `7500/7600/7700`→red, others→blue.
- **STBY/TFR workflow** — phase 0/1/2 state machine; STBY dials standby freq,
  TFR commits to active, destination press stores and turns off STBY+TFR.
- **User slots 1–4** — store frequencies via STBY→TFR, long-press to erase.
- **EDDN/NUE coordinates** — distance and bearing in selected track panel.
- **Signal lifetime** — PLOC badge after 30s, track removed after 60s.
- **Collapsible right panel** — auto-opens on select, auto-closes on deselect.
- **Draggable tags** — click and drag tag label; connector line follows symbol.
- **GAIN slider** removed INV button, MUTE made toggle button.
