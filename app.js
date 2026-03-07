'use strict';
// ═══════════════════════════════════════════════════════════════════════
// PIRX Radar / SDR Console — app.js  v0.7.2
//
//  1. Aircraft symbols: white squares, 25% of previous diamond size
//  2. Top tag line: squawk display with V/code rules, no WARNINGS text
//  3. Frequency panel: STBY/TFR workflow, protected presets, 2s long-press reset
//  4. EDDN/NUE coordinates displayed in selected track panel
//  5. Live mode signal lifetime: 60s total, PLOC shown 30–60s (orange)
//  6. Collapsible selected track panel with auto-open/close on select
// ═══════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════
// ENDPOINT CONFIGURATION
// ════════════════════════════════════════════════════════════════════════
//
// The app detects at runtime whether it is served from a public production
// host or from a local LAN / localhost address, and picks the right
// WebSocket and REST URLs automatically.  No hardcoded IPs needed.
//
// ── PRODUCTION HOSTS (edit this list) ───────────────────────────────
//
//   Add every public hostname that serves this frontend.
//   Typical cases:
//
//   Cloudflare Tunnel + custom domain
//     → 'yourradar.yourdomain.com'
//       Tunnel terminates TLS; the app uses wss:// with no port number.
//       Setup: Cloudflare Zero Trust → Tunnels → add a public hostname
//              pointing to http://localhost:8080 on the Pi.
//
//   Cloudflare Pages (static frontend only, backend elsewhere)
//     → 'yourproject.pages.dev'  or  'yourradar.yourdomain.com'
//       Same rule: wss://, no port.
//
//   Any VPS / NGINX / Caddy reverse proxy over HTTPS
//     → 'radar.mydomain.org'
//       Proxy terminates TLS and forwards to the backend; wss://, no port.
//
//   Multiple domains simultaneously
//     → ['radar.site-a.com', 'backup.site-b.net']
//
//   Current project — replace with your own domain(s):
//
const PRODUCTION_HOSTS = [
  'pirx.dustyhut.org',   // ← Cloudflare Tunnel hostname — change to yours
];
//
// ── LOCAL / LAN (no changes needed) ─────────────────────────────────
//
//   Any hostname NOT in PRODUCTION_HOSTS is treated as local:
//     localhost, 127.0.0.1, 192.168.x.x, 10.x.x.x, hostname.local …
//   The app uses ws:// and appends :8080 automatically.
//   Backend port is 8080 — change the literal below if yours differs:
//
const LOCAL_PORT = 8080;
//
// ════════════════════════════════════════════════════════════════════════

const _HOST    = window.location.hostname;
const _IS_PROD = PRODUCTION_HOSTS.includes(_HOST);

const WS_URL   = _IS_PROD
  ? `wss://${_HOST}/ws/traffic`               // production: wss, no port
  : `ws://${_HOST}:${LOCAL_PORT}/ws/traffic`; // local LAN:  ws,  port 8080

const API_BASE = _IS_PROD
  ? `https://${_HOST}`
  : `http://${_HOST}:${LOCAL_PORT}`;

const HEALTH = `${API_BASE}/health`;
const STATUS = `${API_BASE}/status`;

// ── Reference: EDDN Nuremberg ─────────────────────────────────────────
const REF_LAT  = 49.498611;  // EDDN ARP 49°29'55"N
const REF_LON  = 11.078056;  // EDDN ARP 011°04'41"E
const REF_ICAO = 'EDDN';
const REF_IATA = 'NUE';
const NM_TO_M  = 1852;

// ── Waterfall band ────────────────────────────────────────────────────
const WF_MIN_KHZ  = 118000;
const WF_MAX_KHZ  = 128000;
const WF_SPAN_KHZ = WF_MAX_KHZ - WF_MIN_KHZ;

// EDDN ATC frequencies for mock peaks (kHz)
const EDDN_PEAKS = [
  { f: 119475, amp: 0.80 },
  { f: 118305, amp: 0.70 },
  { f: 121760, amp: 0.55 },
  { f: 129525, amp: 0.65 },
  { f: 123080, amp: 0.45 },
  { f: 121500, amp: 0.35 },
];

// ── Signal lifetime (live mode only) ─────────────────────────────────
const SIGNAL_PLOC_AGE = 30;   // seconds before PLOC appears
const SIGNAL_MAX_AGE  = 60;   // seconds before track removed

// ═══════════════════════════════════════════════════════════════════════
// iCAS2 LOOKUP TABLES
// ═══════════════════════════════════════════════════════════════════════

const WTC_MAP = {
  'DLH':'H','BAW':'H','UAE':'H','QFA':'H','SIA':'H',
  'AFR':'H','KLM':'H','THY':'H','DAL':'H','AAL':'H',
  'EZY':'M','RYR':'M','SAS':'M','IBE':'M','SWR':'M',
  'AUA':'M','TAP':'M','NAX':'M','VLG':'M','BEL':'M',
  'DLT':'M','CFG':'M','TUI':'M','EWG':'M','GEC':'H',
  'BER':'M','NLH':'M','AHO':'M',
};

const ATYP_MAP = {
  'DLH':'A320','BAW':'B744','UAE':'A388','EZY':'A319',
  'RYR':'B738','SAS':'A320','KLM':'B738','AFR':'A320',
  'THY':'A320','SWR':'A220','AUA':'A320','TUI':'B738',
};

const MOCK_SI  = ['NUE','MUC','FRA','STR','VIE','ZRH','HAM','BER','DUS','CGN'];
const MOCK_COP = ['NTH','STH','EST','WST','TOP','BOT'];

// ═══════════════════════════════════════════════════════════════════════
// 2. TAG COLOUR + SQUAWK DISPLAY RULES
// ═══════════════════════════════════════════════════════════════════════

/**
 * Returns full-brightness colour for a label.
 *   RED        #ff4444  — emergency 7500 / 7600 / 7700
 *   GREEN      #00ff88  — VFR 7000
 *   LIGHT BLUE #66ccff  — all others
 */
function getTagColor(squawk) {
  if (['7500','7600','7700'].includes(squawk)) return '#ff4444';
  if (squawk === '7000')                       return '#00ff88';
  return '#66ccff';
}

function getDimColor(squawk) {
  const map = {
    '#ff4444': 'rgba(255,68,68,0.35)',
    '#00ff88': 'rgba(0,255,136,0.35)',
    '#66ccff': 'rgba(102,204,255,0.35)',
  };
  return map[getTagColor(squawk)] || 'rgba(102,204,255,0.35)';
}

/**
 * Row 1 squawk token — the only content on the top tag line.
 *   7000           → text: 'V',       colour: green
 *   7500/7600/7700 → text: squawk,    colour: red
 *   all others     → text: squawk,    colour: blue
 * NO 'WARNINGS' text. NO hex ICAO.
 */
function getSquawkToken(squawk) {
  const sq = squawk || '';
  if (sq === '7000')                           return { text: 'V',  color: '#00ff88' };
  if (['7500','7600','7700'].includes(sq))     return { text: sq,   color: '#ff4444' };
  return                                              { text: sq,   color: '#66ccff' };
}

// ═══════════════════════════════════════════════════════════════════════
// FIELD HELPERS
// ═══════════════════════════════════════════════════════════════════════

function getWTC(cs)  { return cs ? (WTC_MAP[cs.substring(0,3).toUpperCase()] || '') : ''; }
function getATYP(cs) { return cs ? (ATYP_MAP[cs.substring(0,3).toUpperCase()] || '') : ''; }

function formatFL(alt) {
  if (alt == null || alt === '') return '';
  if (alt >= 1000) return 'FL' + Math.round(alt/100).toString().padStart(3,'0');
  return Math.round(alt) + 'ft';
}

function formatCRC(vr) {
  if (vr == null || Math.abs(vr) <= 50) return '';
  const h = Math.round(vr / 100);
  return (h >= 0 ? '+' : '') + Math.abs(h).toString().padStart(2,'0');
}

function trendChar(vr) { return (vr != null && vr < -500) ? '↓' : ''; }

function formatARC(vr) {
  if (vr == null || Math.abs(vr) <= 50) return '';
  return (vr >= 0 ? '+' : '') + Math.round(vr/100)*100;
}

function getMockExtras(t) {
  const h = parseInt(t.icao.slice(-3), 16);
  const delta  = (h % 2 === 0 ? 1 : -1) * 1000;
  const aflStr = formatFL(t.altitude);
  const cflStr = formatFL(t.altitude + delta);
  return {
    si:   MOCK_SI[h % MOCK_SI.length],
    cfl:  cflStr === aflStr ? '' : cflStr,
    cop:  MOCK_COP[h % MOCK_COP.length],
    arc:  formatARC(t._vr),
    xfl:  formatFL(t.altitude + delta + 1000),
    ahdg: Math.round(((t.heading||0) + 30) % 360).toString().padStart(3,'0'),
    asp:  t.groundspeed ? Math.round(t.groundspeed/10)*10+'' : '',
    ades: MOCK_SI[(h + 3) % MOCK_SI.length],
    pel:  formatFL(t.altitude - 2000),
  };
}

function assignState(icao) {
  const h = parseInt(icao.slice(-2), 16);
  if (h < 26)  return 'urgency';
  if (h < 77)  return 'coordinated';
  if (h < 179) return 'assumed';
  return 'normal';
}

// ═══════════════════════════════════════════════════════════════════════
// 2 + 5. FIELD BUILDERS — clean, squawk-only row 1, PLOC on aging
// ═══════════════════════════════════════════════════════════════════════

/**
 * TAGGED (unselected):
 *   Row 1:  squawk token [PLOC if aging]
 *   Row 2:  CALLSIGN [SI]
 *   Row 3:  AFL[↓][CRC] [CFL]
 *   Row 4:  GS (if present)
 */
function getTaggedLines(track) {
  const sq    = track.squawk || '';
  const cs    = (track.callsign || track.icao).trim();
  const afl   = formatFL(track.altitude);
  const crc   = formatCRC(track._vr);
  const trend = trendChar(track._vr);
  const gs    = track.groundspeed ? Math.round(track.groundspeed).toString() : '';
  const ex    = getMockExtras(track);
  const sqTok = getSquawkToken(sq);

  // Row 1 — squawk token + optional PLOC
  const r1 = [{ text: sqTok.text, color: sqTok.color }];
  if (track._ploc) r1.push({ text: 'PLOC', color: '#ff8c00' });

  // Row 2 — callsign + SI
  const r2 = [{ text: cs }];
  if (ex.si) r2.push({ text: ex.si });

  // Row 3 — AFL block + CFL
  const r3 = [];
  if (afl) r3.push({ text: afl + trend + crc });
  if (ex.cfl) r3.push({ text: ex.cfl, dim: true });

  // Row 4 — GS
  const r4 = [];
  if (gs) r4.push({ text: 'GS' + gs });

  return [r1, r2, r3, r4].filter(r => r.length > 0);
}

/**
 * DETAILED (selected):
 *   Row 1:  squawk token [PLOC if aging]
 *   Row 2:  CALLSIGN [SI] [ATYP] [WTC] [+]
 *   Row 3:  AFL[↓][CRC] [ARC] [CFL] [COP]
 *   Row 4:  GS [ASP] [AHDG] [XFL] [ADES] [PEL]
 *   Row 5:  DIAS DMACH DHDG TRACK (dim)
 */
function getDetailedLines(track) {
  const sq    = track.squawk || '';
  const cs    = (track.callsign || track.icao).trim();
  const wtc   = getWTC(track.callsign);
  const atyp  = getATYP(track.callsign);
  const afl   = formatFL(track.altitude);
  const crc   = formatCRC(track._vr);
  const trend = trendChar(track._vr);
  const gs    = track.groundspeed ? Math.round(track.groundspeed).toString() : '';
  const ex    = getMockExtras(track);
  const sqTok = getSquawkToken(sq);

  const r1 = [{ text: sqTok.text, color: sqTok.color }];
  if (track._ploc) r1.push({ text: 'PLOC', color: '#ff8c00' });

  const r2 = [{ text: cs }];
  if (ex.si) r2.push({ text: ex.si });
  if (atyp)  r2.push({ text: atyp });
  if (wtc)   r2.push({ text: wtc });
  r2.push({ text: '+' });

  const r3 = [];
  if (afl) r3.push({ text: afl + trend + crc });
  if (ex.arc) r3.push({ text: ex.arc });
  if (ex.cfl) r3.push({ text: ex.cfl });
  if (ex.cop) r3.push({ text: ex.cop, dim: true });

  const r4 = [];
  if (gs)        r4.push({ text: 'GS'+gs });
  if (ex.asp)    r4.push({ text: ex.asp,   dim: true });
  if (ex.ahdg)   r4.push({ text: ex.ahdg,  dim: true });
  if (ex.xfl)    r4.push({ text: ex.xfl,   dim: true });
  if (ex.ades)   r4.push({ text: ex.ades,  dim: true });
  if (ex.pel)    r4.push({ text: ex.pel,   dim: true });

  const r5 = [
    { text:'DIAS', dim:true }, { text:'DMACH', dim:true },
    { text:'DHDG', dim:true }, { text:'TRACK', dim:true },
  ];

  return [r1, r2, r3, r4, r5].filter(r => r.length > 0);
}

// ═══════════════════════════════════════════════════════════════════════
// TAG DRAWING — transparent, text-colour only
// Tokens now support { text, color?, dim? }:
//   color  — explicit hex override (row 1 squawk, PLOC)
//   dim    — 35% opacity of track colour
//   default — full track colour
// ═══════════════════════════════════════════════════════════════════════

function drawTag(ctx, track, x, y, isSelected) {
  const dpr    = window.devicePixelRatio || 1;
  const fPx    = isSelected ? 12 : 11;
  const fs     = Math.round(fPx * dpr);
  const lineH  = Math.round((fPx + 3) * dpr);
  const colGap = Math.round(5 * dpr);
  const full   = getTagColor(track.squawk);
  const dim    = getDimColor(track.squawk);
  const fontN  = `${fs}px 'Courier New',monospace`;
  const fontB  = `bold ${fs}px 'Courier New',monospace`;

  ctx.save();
  ctx.font = fontN; ctx.textBaseline = 'top'; ctx.textAlign = 'left';

  const lines = isSelected ? getDetailedLines(track) : getTaggedLines(track);
  const off = tagOffsets.get(track.icao) || { dx: Math.round(12 * dpr), dy: 0 };
  const TX  = x + off.dx;
  const TY  = y + off.dy - Math.round(lineH * lines.length * 0.5);

  // Connector line — always drawn from symbol to tag anchor
  ctx.strokeStyle = full; ctx.globalAlpha = 0.42;
  ctx.lineWidth = dpr * 0.8;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(TX, TY + lineH * 0.5); ctx.stroke();
  ctx.globalAlpha = 1;

  lines.forEach((tokens, ri) => {
    let cx = TX;
    const ry = TY + ri * lineH;
    tokens.forEach(tok => {
      if (tok.color) {
        // Explicit colour override (squawk token / PLOC)
        ctx.fillStyle = tok.color;
        ctx.font = ri === 0 ? fontB : fontN;   // row 1 always bold
      } else if (tok.dim) {
        ctx.fillStyle = dim; ctx.font = fontN;
      } else {
        ctx.fillStyle = full; ctx.font = isSelected ? fontB : fontN;
      }
      ctx.fillText(tok.text, cx, ry);
      cx += ctx.measureText(tok.text).width + colGap;
    });
  });

  // Selection ring
  if (isSelected) {
    ctx.strokeStyle = full; ctx.lineWidth = dpr * 1.5; ctx.globalAlpha = 0.65;
    ctx.beginPath(); ctx.arc(x, y, Math.round(10 * dpr), 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawICAS2Untagged(ctx, t, x, y) { drawTag(ctx, t, x, y, false); }
function drawICAS2Tagged(ctx, t, x, y)   { drawTag(ctx, t, x, y, true);  }

// ═══════════════════════════════════════════════════════════════════════
// ATC SCANNER STATE — reverted to v0.6 base + new STBY/TFR/destination flow
// ═══════════════════════════════════════════════════════════════════════

let freq = 119475;   // kHz — active frequency shown in main display

// EDDN factory defaults
const DEFAULT_MEMORY = {
  APP:  119475,
  TWR:  118305,
  GND:  121760,
  DEL:  121760,
  CTR:  129525,
  ATIS: 123080,
};
const memory   = { ...DEFAULT_MEMORY };
const MEM_KEYS = ['APP','TWR','GND','DEL','CTR','ATIS'];

// User slots 1–4: null = empty
const userSlots = { U1: null, U2: null, U3: null, U4: null };
const USER_KEYS = ['U1','U2','U3','U4'];

// STBY/TFR workflow state
// Phase 0: idle — normal operation
// Phase 1: STBY active — step buttons/waterfall dial stbyFreq
// Phase 2: TFR active — stbyFreq transferred to freq, waiting for destination press
let scanPhase = 0;   // 0 | 1 | 2
let stbyFreq  = 119475;
let pendingFreq = null;  // freq ready to be stored, set when TFR pressed

let activeMemKey = 'APP';  // currently highlighted preset/slot
let isMuted = false;

// ═══════════════════════════════════════════════════════════════════════
// GENERAL APP STATE
// ═══════════════════════════════════════════════════════════════════════
let tracks    = new Map();
let selected  = null;
let viewScale = 1;
let panX = 0, panY = 0;
let rangeNM   = 40;
let pulsePhase = 0;
let isDragging      = false;
let isDraggingTag   = false;
let dragSX=0, dragSY=0, panSX=0, panSY=0;
let dragTagIcao = null, dragTagDX = 0, dragTagDY = 0;
// Per-track tag offsets (canvas pixels from symbol position)
const tagOffsets = new Map();
let wfHistory = [];
let wfPhase   = 0;
let lastTs    = 0;
let wfLastTs  = 0;
let isMockMode = false;
let rpCollapsed = false;

// ═══════════════════════════════════════════════════════════════════════
// DOM REFS
// ═══════════════════════════════════════════════════════════════════════
const canvas       = document.getElementById('radar');
const ctx          = canvas.getContext('2d');
const wfCanvas     = document.getElementById('wf-canvas');
const wfCtx        = wfCanvas.getContext('2d');
const trackCountEl = document.getElementById('track-count');
const rangeNmEl    = document.getElementById('range-nm');
const clockEl      = document.getElementById('clock-time');
const freqEl       = document.getElementById('freq-display');
const selDetail    = document.getElementById('sel-detail');
const selEmpty     = document.getElementById('sel-empty');
const cursorLlEl   = document.getElementById('cursor-ll');
const logBody      = document.getElementById('log-body');
const wfTuneLine   = document.getElementById('wf-tune-line');
const wfTooltip    = document.getElementById('wf-tooltip');
const wfBody       = document.getElementById('wf-body');
const rightPanel   = document.getElementById('right-panel');
const rpToggle     = document.getElementById('rp-toggle');

// ═══════════════════════════════════════════════════════════════════════
// COLLAPSIBLE RIGHT PANEL
// ═══════════════════════════════════════════════════════════════════════

function setRightPanel(open) {
  rpCollapsed = !open;
  rightPanel.classList.toggle('collapsed', rpCollapsed);
  rpToggle.textContent = rpCollapsed ? '\u2039' : '\u203a';
  setTimeout(resize, 200);
}
rpToggle.addEventListener('click', () => setRightPanel(rpCollapsed));

// ═══════════════════════════════════════════════════════════════════════
// ATC SCANNER ENGINE
// ═══════════════════════════════════════════════════════════════════════

/** setFreq: dials stbyFreq when in phase 1, active freq otherwise */
function setFreq(khz) {
  const clamped = Math.max(118000, Math.min(137000, khz));
  if (scanPhase === 1) {
    stbyFreq = clamped;
    freqEl.textContent = (stbyFreq / 1000).toFixed(3);
    document.getElementById('stby-freq-display').textContent = (stbyFreq / 1000).toFixed(3);
  } else {
    freq = clamped;
    freqEl.textContent = (freq / 1000).toFixed(3);
  }
  updateTuneMarker();
  updateStatusPills();
}

function updateTuneMarker() {
  const f = scanPhase >= 1 ? stbyFreq : freq;
  const pct = Math.max(0, Math.min(100, ((f - WF_MIN_KHZ) / WF_SPAN_KHZ) * 100));
  wfTuneLine.style.left = pct + '%';
  wfTuneLine.style.transform = 'translateX(-50%)';
}

function updateStatusPills() {
  document.getElementById('pill-tuned').classList.add('on');
  document.getElementById('pill-active').classList.toggle('on', !isMuted);
  document.getElementById('pill-mute').classList.toggle('on', isMuted);
}

function updateScanPhaseUI() {
  const stbyBtn = document.getElementById('btn-stby');
  const tfrBtn  = document.getElementById('btn-tfr');
  stbyBtn.classList.toggle('active-mem', scanPhase >= 1);
  tfrBtn.classList.toggle('active-mem',  scanPhase === 2);
  wfBody.classList.toggle('stby-active', scanPhase === 1);
  document.getElementById('wf-mode-label').textContent =
    scanPhase === 1 ? '118 – 128 MHz · click to tune' : '118 – 128 MHz · STBY to tune';
  document.getElementById('stby-freq-display').textContent =
    scanPhase >= 1 ? (stbyFreq / 1000).toFixed(3) : '—';
}

/** Phase 0 → 1: engage STBY — step buttons & waterfall now dial stbyFreq */
function doStby() {
  if (scanPhase === 0) {
    scanPhase = 1;
    stbyFreq = freq;   // initialise standby from active
    freqEl.textContent = (stbyFreq / 1000).toFixed(3);
    log('STBY engaged — dial freq then press TFR', 'info');
  } else {
    // Cancel STBY/TFR, return to idle
    scanPhase = 0;
    pendingFreq = null;
    freq = stbyFreq;   // revert active to stby (abandon)
    freqEl.textContent = (freq / 1000).toFixed(3);
    log('STBY cancelled', 'info');
  }
  updateTuneMarker();
  updateScanPhaseUI();
  updateAllMemBtns();
}

/** Phase 1 → 2: TFR — commit stbyFreq as active, wait for destination */
function doTFR() {
  if (scanPhase !== 1) { log('TFR: engage STBY first', 'warn'); return; }
  freq = stbyFreq;
  pendingFreq = freq;
  freqEl.textContent = (freq / 1000).toFixed(3);
  scanPhase = 2;
  log('TFR → ' + (freq/1000).toFixed(3) + ' MHz — select destination (preset or 1–4)', 'ok');
  updateTuneMarker();
  updateScanPhaseUI();
}

/** Called when user presses a destination button while in phase 2 */
function commitToDestination(key, type) {
  if (scanPhase !== 2) return false;
  if (type === 'preset') {
    memory[key] = pendingFreq;
    activeMemKey = key;
    log(key + ' ← ' + (pendingFreq/1000).toFixed(3) + ' MHz', 'ok');
  } else {
    userSlots[key] = pendingFreq;
    activeMemKey = key;
    log(key + ' ← ' + (pendingFreq/1000).toFixed(3) + ' MHz', 'ok');
  }
  scanPhase = 0;
  pendingFreq = null;
  updateScanPhaseUI();
  updateAllMemBtns();
  updateUserBtns();
  flashMemBtn(key);
  return true;
}

/** Normal press of a preset (phase 0): tune to that frequency */
function tunePreset(key) {
  freq = memory[key];
  activeMemKey = key;
  freqEl.textContent = (freq / 1000).toFixed(3);
  updateTuneMarker();
  updateAllMemBtns();
  log(key + ' → ' + (freq/1000).toFixed(3) + ' MHz', 'info');
}

/** Normal press of a user slot (phase 0): tune if has freq */
function tuneUserSlot(key) {
  if (userSlots[key] === null) { log(key + ': empty — use STBY→TFR to store', 'info'); return; }
  freq = userSlots[key];
  activeMemKey = key;
  freqEl.textContent = (freq / 1000).toFixed(3);
  updateTuneMarker();
  updateAllMemBtns();
  updateUserBtns();
  log(key + ' → ' + (freq/1000).toFixed(3) + ' MHz', 'info');
}

function resetPresetDefault(key) {
  memory[key] = DEFAULT_MEMORY[key];
  if (activeMemKey === key) {
    freq = memory[key];
    freqEl.textContent = (freq / 1000).toFixed(3);
    updateTuneMarker();
  }
  updateAllMemBtns();
  flashMemBtn(key);
  log(key + ' reset → ' + (DEFAULT_MEMORY[key]/1000).toFixed(3) + ' MHz', 'info');
}

function eraseUserSlot(key) {
  userSlots[key] = null;
  if (activeMemKey === key) activeMemKey = null;
  updateUserBtns();
  const btn = document.getElementById('mem-' + key.toLowerCase());
  if (btn) {
    btn.classList.add('erase-flash');
    setTimeout(() => btn.classList.remove('erase-flash'), 700);
  }
  log(key + ' erased', 'warn');
}

function updateMemBtn(key) {
  const k   = key.toLowerCase();
  const btn = document.getElementById('mem-' + k);
  const fEl = document.getElementById('mf-' + k);
  if (!btn || !fEl) return;
  fEl.textContent = (memory[key] / 1000).toFixed(3);
  btn.classList.toggle('active-mem', key === activeMemKey && scanPhase === 0);
}

function updateAllMemBtns() { MEM_KEYS.forEach(k => updateMemBtn(k)); }

function updateUserBtns() {
  USER_KEYS.forEach(k => {
    const key = k.toLowerCase();
    const btn = document.getElementById('mem-' + key);
    const fEl = document.getElementById('mf-' + key);
    if (!btn || !fEl) return;
    const v = userSlots[k];
    fEl.textContent = v !== null ? (v / 1000).toFixed(3) : '—';
    btn.classList.toggle('has-freq', v !== null);
    btn.classList.toggle('active-mem', k === activeMemKey && scanPhase === 0);
  });
}

function flashMemBtn(key) {
  const id = 'mem-' + key.toLowerCase();
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.classList.add('store-flash');
  setTimeout(() => btn.classList.remove('store-flash'), 900);
}

function directStep(khz) {
  setFreq((scanPhase === 1 ? stbyFreq : freq) + khz);
  flashStepBtn(Math.abs(khz), khz > 0 ? '+' : '-');
}

function flashStepBtn(step, dir) {
  const map = { '5': dir==='+'?'b-p5':'b-m5', '8.33': dir==='+'?'b-p833':'b-m833', '25': dir==='+'?'b-p25':'b-m25' };
  const el = document.getElementById(map[String(step)]);
  if (!el) return;
  const cls = dir === '+' ? 'flash-pos' : 'flash-neg';
  el.classList.add(cls); setTimeout(() => el.classList.remove(cls), 180);
}

function toggleMute() {
  isMuted = !isMuted;
  const btn = document.getElementById('btn-mute');
  btn.classList.toggle('muted', isMuted);
  updateStatusPills();
  log(isMuted ? 'Audio muted' : 'Audio unmuted', isMuted ? 'warn' : 'info');
}

function initATCControls() {
  // Step buttons
  document.querySelectorAll('.step-btn').forEach(btn => {
    btn.addEventListener('click', () =>
      directStep(parseFloat(btn.dataset.step) * parseInt(btn.dataset.dir))
    );
  });

  document.getElementById('btn-mute').addEventListener('click', toggleMute);
  document.getElementById('btn-stby').addEventListener('click', doStby);
  document.getElementById('btn-tfr').addEventListener('click', doTFR);

  // Preset buttons (APP/TWR/GND/DEL/CTR/ATIS)
  document.querySelectorAll('.mem-btn[data-type="preset"]').forEach(btn => {
    const key = btn.dataset.key;
    let pt = null;
    btn.addEventListener('click', () => {
      if (commitToDestination(key, 'preset')) return;  // phase 2 → store
      tunePreset(key);                                  // phase 0 → tune
    });
    // 2s long-press = reset to default
    btn.addEventListener('mousedown', () => {
      pt = setTimeout(() => { pt = null; resetPresetDefault(key); }, 2000);
    });
    btn.addEventListener('mouseup',    () => { if (pt) { clearTimeout(pt); pt = null; } });
    btn.addEventListener('mouseleave', () => { if (pt) { clearTimeout(pt); pt = null; } });
  });

  // User slot buttons (1–4)
  document.querySelectorAll('.mem-btn[data-type="user"]').forEach(btn => {
    const key = btn.dataset.key;
    let pt = null;
    btn.addEventListener('click', () => {
      if (commitToDestination(key, 'user')) return;  // phase 2 → store
      tuneUserSlot(key);                              // phase 0 → tune
    });
    // 2s long-press = erase slot
    btn.addEventListener('mousedown', () => {
      pt = setTimeout(() => { pt = null; eraseUserSlot(key); }, 2000);
    });
    btn.addEventListener('mouseup',    () => { if (pt) { clearTimeout(pt); pt = null; } });
    btn.addEventListener('mouseleave', () => { if (pt) { clearTimeout(pt); pt = null; } });
  });

  // Sliders
  document.getElementById('vol-slider').addEventListener('input', function() {
    document.getElementById('vol-val').textContent = (+this.value >= 0 ? '+' : '') + this.value + ' dB';
  });
  document.getElementById('sql-slider').addEventListener('input', function() {
    document.getElementById('sql-val').textContent = (+this.value >= 0 ? '+' : '') + this.value + ' dB';
  });

  updateAllMemBtns();
  updateUserBtns();
  updateStatusPills();
  updateTuneMarker();
  updateScanPhaseUI();
  freqEl.textContent = (freq / 1000).toFixed(3);
  document.getElementById('pill-tuned').classList.add('on');
}

// ═══════════════════════════════════════════════════════════════════════
// WATERFALL — 10 MHz span, ≤40 fps, STBY-only click-to-tune
// ═══════════════════════════════════════════════════════════════════════

function wfXtoFreq(x, W) { return WF_MIN_KHZ + (x / W) * WF_SPAN_KHZ; }
function freqToWfX(khz, W) { return ((khz - WF_MIN_KHZ) / WF_SPAN_KHZ) * W; }

function renderWaterfall(ts) {
  requestAnimationFrame(renderWaterfall);
  if (ts - wfLastTs < 25) return;
  wfLastTs = ts;

  const W = wfCanvas.width, H = wfCanvas.height;
  if (W <= 0 || H <= 0) return;
  wfPhase += 0.025;

  const row = new Uint8ClampedArray(W * 4);
  for (let i = 0; i < W; i++) {
    const fKhz = wfXtoFreq(i, W);
    let p = 0.03 + 0.03 * Math.random();
    for (const pk of EDDN_PEAKS) {
      const df = (fKhz - pk.f) / 25;
      p += pk.amp * (0.65 + 0.35 * Math.sin(wfPhase * (1 + pk.amp) + pk.f * 0.0001))
           * Math.exp(-(df * df));
    }
    p = Math.min(1, p);
    let r, g, b;
    if      (p < 0.15) { r=0;              g=Math.round(p/0.15*55);    b=Math.round(p/0.15*85); }
    else if (p < 0.40) { const t=(p-0.15)/0.25; r=0;              g=Math.round(55+t*115);   b=Math.round(85+t*85); }
    else if (p < 0.70) { const t=(p-0.40)/0.30; r=Math.round(t*25);   g=Math.round(170+t*85); b=Math.round(170-t*50); }
    else               { const t=(p-0.70)/0.30; r=Math.round(25+t*230); g=255;                 b=Math.round(120-t*80); }
    const idx = i*4; row[idx]=r; row[idx+1]=g; row[idx+2]=b; row[idx+3]=255;
  }

  wfHistory.unshift(row);
  if (wfHistory.length > H) wfHistory.length = H;

  const specH = Math.floor(H * 0.38);
  const imgData = wfCtx.createImageData(W, H);
  for (let ri = 0; ri < wfHistory.length && ri < H; ri++) {
    if (ri < specH) continue;
    imgData.data.set(wfHistory[ri], ri * W * 4);
  }
  wfCtx.putImageData(imgData, 0, 0);

  wfCtx.fillStyle = 'rgba(10,10,10,0.92)'; wfCtx.fillRect(0, 0, W, specH);

  wfCtx.strokeStyle = 'rgba(0,130,100,0.12)'; wfCtx.lineWidth = 1;
  for (let db = 0; db <= 4; db++) {
    const y = specH * (1 - db/4);
    wfCtx.beginPath(); wfCtx.moveTo(0,y); wfCtx.lineTo(W,y); wfCtx.stroke();
  }
  wfCtx.strokeStyle = 'rgba(0,130,100,0.10)'; wfCtx.lineWidth = 0.5;
  for (let mhz = 118; mhz <= 128; mhz += 2) {
    const gx = freqToWfX(mhz * 1000, W);
    wfCtx.beginPath(); wfCtx.moveTo(gx, 0); wfCtx.lineTo(gx, specH); wfCtx.stroke();
  }

  wfCtx.beginPath(); wfCtx.moveTo(0, specH);
  for (let i = 0; i < W; i++) {
    const fKhz = wfXtoFreq(i, W);
    let p = 0.03 + 0.015 * Math.random();
    for (const pk of EDDN_PEAKS) {
      const df = (fKhz - pk.f) / 25;
      p += (pk.amp * 1.1) * (0.65 + 0.35 * Math.sin(wfPhase * (1 + pk.amp) + pk.f * 0.0001))
           * Math.exp(-(df * df));
    }
    p = Math.min(1, p);
    wfCtx.lineTo(i, specH * (1 - p * 0.92));
  }
  wfCtx.strokeStyle = 'rgba(0,220,200,0.90)'; wfCtx.lineWidth = 1.5; wfCtx.stroke();

  wfCtx.strokeStyle = 'rgba(0,170,170,0.22)'; wfCtx.lineWidth = 1;
  wfCtx.beginPath(); wfCtx.moveTo(0, specH); wfCtx.lineTo(W, specH); wfCtx.stroke();

  // Tune marker — solid white
  const tx = freqToWfX(scanPhase >= 1 ? stbyFreq : freq, W);
  wfCtx.strokeStyle = 'rgba(255,255,255,0.85)'; wfCtx.lineWidth = 2;
  wfCtx.beginPath(); wfCtx.moveTo(tx, 0); wfCtx.lineTo(tx, H); wfCtx.stroke();
  wfCtx.fillStyle = '#ffffff'; wfCtx.fillRect(tx - 4, 0, 8, 4);

  // When STBY is active, show active-freq marker as dimmer second line
  if (scanPhase >= 1) {
    const ax = freqToWfX(freq, W);
    wfCtx.strokeStyle = 'rgba(0,170,170,0.55)'; wfCtx.lineWidth = 1;
    wfCtx.setLineDash([3, 4]);
    wfCtx.beginPath(); wfCtx.moveTo(ax, 0); wfCtx.lineTo(ax, H); wfCtx.stroke();
    wfCtx.setLineDash([]);
  }
}

// Waterfall click — only in STBY mode
wfBody.addEventListener('click', e => {
  if (scanPhase !== 1) return;
  const rect = wfCanvas.getBoundingClientRect();
  const rx   = (e.clientX - rect.left) / rect.width;
  const khz  = WF_MIN_KHZ + rx * WF_SPAN_KHZ;
  const snapped = Math.round(khz / 8.33) * 8.33;
  setFreq(snapped);
  log('WF → ' + (snapped/1000).toFixed(3) + ' MHz (STBY)', 'info');
});

wfBody.addEventListener('mousemove', e => {
  const rect = wfCanvas.getBoundingClientRect();
  const rx   = (e.clientX - rect.left) / rect.width;
  if (rx < 0 || rx > 1) { wfTooltip.style.display = 'none'; return; }
  const khz  = WF_MIN_KHZ + rx * WF_SPAN_KHZ;
  wfTooltip.textContent = (khz / 1000).toFixed(3) + ' MHz' + (scanPhase === 1 ? '' : ' · engage STBY');
  wfTooltip.style.display = 'block';
  wfTooltip.style.left = Math.max(0, Math.min(100, rx * 100)) + '%';
});

wfBody.addEventListener('mouseleave', () => { wfTooltip.style.display = 'none'; });

// ═══════════════════════════════════════════════════════════════════════
// WEBSOCKET + MOCK DATA
// ═══════════════════════════════════════════════════════════════════════

function connectWebSocket() {
  setConnStatus('connecting');
  log('Connecting → ' + WS_URL, 'info');
  let ws;
  try { ws = new WebSocket(WS_URL); }
  catch(e) { log('WS unavailable — mock mode', 'warn'); startMock(); return; }

  const timeout = setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      log('Timeout — mock mode', 'warn'); ws.close(); startMock();
    }
  }, 5000);

  ws.onopen = () => {
    clearTimeout(timeout); setConnStatus('live');
    isMockMode = false;
    log('LIVE ← ' + WS_URL, 'ok');
    pollHealth();
  };
  ws.onmessage = e => {
    try { const m = JSON.parse(e.data); if (m.type === 'tracks') handleTracksMsg(m.tracks); }
    catch(err) { log('Parse error: ' + err.message, 'error'); }
  };
  ws.onerror = () => { clearTimeout(timeout); log('WS error — mock mode', 'warn'); startMock(); };
  ws.onclose = () => {
    if (document.getElementById('conn-badge').classList.contains('badge-live')) {
      log('WS closed — reconnect 5s', 'warn'); setConnStatus('connecting');
      setTimeout(connectWebSocket, 5000);
    }
  };
}

async function pollHealth() {
  try {
    const r = await fetch(HEALTH, { signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    log('Health: ' + JSON.stringify(j), 'ok');
  } catch(e) {
    log('Health endpoint n/a', 'info');
  }
}

// ── 5. Live mode track handling with signal lifetime ───────────────────
function handleTracksMsg(arr) {
  const now = Date.now() / 1000;
  const live = new Set();
  arr.forEach(t => {
    live.add(t.icao);
    const ex = tracks.get(t.icao) || {};
    if (!ex._state)    t._state    = assignState(t.icao);
    if (!ex._firstSeen) t._firstSeen = now;
    else t._firstSeen = ex._firstSeen;
    t._lastSeen = now;
    const age = now - t._firstSeen;
    t._ploc = age >= SIGNAL_PLOC_AGE;   // show PLOC badge if >30s
    tracks.set(t.icao, Object.assign(ex, t));
  });

  // Remove stale tracks (>60s without update)
  for (const [id, t] of tracks) {
    if (!live.has(id)) {
      const age = now - (t._lastSeen || now);
      if (age > SIGNAL_MAX_AGE) tracks.delete(id);
    }
  }
  trackCountEl.textContent = tracks.size;
}

function setConnStatus(s) {
  document.getElementById('conn-badge').className = 'badge badge-' + s;
  document.getElementById('conn-label').textContent =
    { connecting:'CONNECTING', live:'LIVE', mock:'MOCK' }[s] || s.toUpperCase();
}

// ── Mock data ─────────────────────────────────────────────────────────
const MOCK_CALLS   = ['DLH123','BAW456','EZY789','RYR321','AFR654','KLM987','UAE112','THY334','SAS556','IBE778','SWR990','AUA112'];
const MOCK_SQUAWKS = ['7000','7000','7000','7000','2000','1200','7500','7600','7700','7000','2000','7000'];
let mockAc = [], mockTimer = null;

function startMock() {
  if (mockTimer) return;
  setConnStatus('mock'); isMockMode = true;
  log('Mock mode — 11 aircraft (EDDN area)', 'warn');
  for (let i = 0; i < 11; i++) mockAc.push(spawnAc(i));
  pushMock();
  mockTimer = setInterval(tickMock, 1000);
}

function spawnAc(i) {
  const r = 8 + Math.random() * 30, ang = Math.random() * 360;
  const lo = r * Math.cos(ang * Math.PI/180) / 60;
  const la = r * Math.sin(ang * Math.PI/180) / (60 * Math.cos(REF_LAT * Math.PI/180));
  const icao = (0x3C1000 + i*0x1A3F + (Math.random()*0xFF|0)).toString(16).toUpperCase().padStart(6,'0');
  return {
    icao, callsign: MOCK_CALLS[i % MOCK_CALLS.length],
    lat: REF_LAT + lo, lon: REF_LON + la,
    altitude: (80 + Math.floor(Math.random() * 350)) * 100,
    groundspeed: 180 + Math.floor(Math.random() * 380),
    heading: (Math.random() * 360) | 0,
    squawk: MOCK_SQUAWKS[i % MOCK_SQUAWKS.length],
    _vr: (Math.random() > 0.5 ? 1 : -1) * Math.floor(Math.random() * 1200),
    _state: assignState(icao),
    _ploc: false,
  };
}

function tickMock() {
  mockAc.forEach(ac => {
    const nps = ac.groundspeed / 3600, rad = ac.heading * Math.PI/180;
    ac.lat += nps * Math.cos(rad) / 60;
    ac.lon += nps * Math.sin(rad) / (60 * Math.cos(ac.lat * Math.PI/180));
    ac.altitude = Math.max(500, Math.min(45000, ac.altitude + ac._vr / 60));
    ac.heading  = (ac.heading + (Math.random() - 0.5) * 2.5 + 360) % 360;
    if (gcdist(ac.lat, ac.lon, REF_LAT, REF_LON) > 52)
      Object.assign(ac, spawnAc(Math.random() * 100 | 0));
  });
  pushMock();
}

function pushMock() {
  tracks.clear(); mockAc.forEach(ac => tracks.set(ac.icao, { ...ac }));
  trackCountEl.textContent = tracks.size;
}

// ═══════════════════════════════════════════════════════════════════════
// GEO HELPERS
// ═══════════════════════════════════════════════════════════════════════

function gcdist(la1, lo1, la2, lo2) {
  const dlat = (la2-la1)*Math.PI/180, dlon = (lo2-lo1)*Math.PI/180;
  return 2*Math.asin(Math.sqrt(
    Math.sin(dlat/2)**2 + Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dlon/2)**2
  ))*6371000/NM_TO_M;
}

function ll2c(lat, lon) {
  const R=6371000, mLat=REF_LAT*Math.PI/180;
  const dx=R*(lon-REF_LON)*Math.PI/180*Math.cos(mLat), dy=-R*(lat-REF_LAT)*Math.PI/180;
  const mpp=(rangeNM*NM_TO_M)/(Math.min(canvas.width,canvas.height)/2);
  return [canvas.width/2+panX+dx/mpp*viewScale, canvas.height/2+panY+dy/mpp*viewScale];
}

function c2ll(x, y) {
  const R=6371000, mLat=REF_LAT*Math.PI/180;
  const mpp=(rangeNM*NM_TO_M)/(Math.min(canvas.width,canvas.height)/2);
  const dx=(x-canvas.width/2-panX)*mpp/viewScale, dy=(y-canvas.height/2-panY)*mpp/viewScale;
  return [REF_LAT+(-dy/R)*180/Math.PI, REF_LON+(dx/(R*Math.cos(mLat)))*180/Math.PI];
}

// ═══════════════════════════════════════════════════════════════════════
// CANVAS RESIZE
// ═══════════════════════════════════════════════════════════════════════

function resize() {
  const rw = document.getElementById('radar-wrap'), dpr = window.devicePixelRatio || 1;
  canvas.width  = rw.clientWidth  * dpr; canvas.height = rw.clientHeight * dpr;
  canvas.style.width  = rw.clientWidth  + 'px'; canvas.style.height = rw.clientHeight + 'px';
  const wb = document.getElementById('wf-body');
  const wh = Math.max(1, wb.clientHeight - 14);
  wfCanvas.width  = wb.clientWidth  * dpr; wfCanvas.height = wh * dpr;
  wfCanvas.style.width  = wb.clientWidth  + 'px'; wfCanvas.style.height = wh + 'px';
  wfHistory = [];
}
window.addEventListener('resize', resize);
resize();

// ═══════════════════════════════════════════════════════════════════════
// RADAR RENDER LOOP
// ═══════════════════════════════════════════════════════════════════════

const RINGS = [5, 10, 20, 40, 80, 120];

function render(ts) {
  requestAnimationFrame(render);
  if (ts - lastTs < 33) return;
  lastTs = ts; pulsePhase = (pulsePhase + 0.055) % (Math.PI * 2);

  const W = canvas.width, H = canvas.height, dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H);
  const vg = ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,Math.max(W,H)*0.65);
  vg.addColorStop(0,'rgba(0,0,0,0)'); vg.addColorStop(1,'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

  const cx = W/2 + panX, cy = H/2 + panY;
  const mpp = (rangeNM * NM_TO_M) / (Math.min(W,H) / 2);

  // Sector lines
  const len = Math.sqrt(W*W + H*H);
  ctx.strokeStyle = 'rgba(0,170,170,0.07)'; ctx.lineWidth = 0.7;
  for (let a = 0; a < 360; a += 30) {
    const r = (a-90)*Math.PI/180;
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+Math.cos(r)*len, cy+Math.sin(r)*len); ctx.stroke();
  }

  // Range rings
  RINGS.forEach(nm => {
    const r = (nm * NM_TO_M / mpp) * viewScale;
    if (r < 8 || r > Math.max(W,H)) return;
    const hi = nm === 10 || nm === 40 || nm === 80;
    ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
    ctx.strokeStyle = hi ? 'rgba(0,170,170,0.40)' : 'rgba(0,170,170,0.18)';
    ctx.lineWidth = hi ? 1.2 : 0.7; ctx.stroke();
    if (r > 22) {
      ctx.font = `bold ${Math.round(9*dpr)}px 'Courier New',monospace`;
      ctx.fillStyle = 'rgba(0,200,200,0.55)';
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(`${nm}NM`, cx+3, cy-r+1);
    }
  });
  ctx.textBaseline = 'alphabetic';

  // Centre cross
  const s = 8*dpr;
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.globalAlpha = 0.55;
  ctx.beginPath(); ctx.moveTo(cx-s,cy); ctx.lineTo(cx+s,cy);
  ctx.moveTo(cx,cy-s); ctx.lineTo(cx,cy+s); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy,2*dpr,0,Math.PI*2);
  ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.globalAlpha = 1;

  // Tracks
  const margin = 80*dpr;
  for (const [icao, t] of tracks) {
    if (t.lat == null) continue;
    const [sx,sy] = ll2c(t.lat, t.lon);
    if (sx < -margin || sy < -margin || sx > W+margin || sy > H+margin) continue;
    const isSel = icao === selected;
    drawAircraftSymbol(sx, sy, t, isSel, dpr, mpp);
    if (isSel) drawICAS2Tagged(ctx, t, sx, sy);
    else       drawICAS2Untagged(ctx, t, sx, sy);
  }

  rangeNmEl.textContent = (rangeNM / viewScale).toFixed(0);
}

// ── 1. Aircraft symbol: white square, 25% of previous diamond size ────
function drawAircraftSymbol(sx, sy, t, isSel, dpr, mpp) {
  const col = getTagColor(t.squawk);

  // Velocity vector
  if (t.groundspeed != null && t.heading != null) {
    const pxnm = NM_TO_M/mpp*viewScale, lead = (t.groundspeed/60)*2*pxnm;
    const ang = (t.heading-90)*Math.PI/180;
    ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(sx+Math.cos(ang)*lead, sy+Math.sin(ang)*lead);
    ctx.strokeStyle = col; ctx.globalAlpha = isSel ? 0.60 : 0.28;
    ctx.lineWidth = dpr; ctx.setLineDash([3*dpr,4*dpr]); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  // Selection glow (unchanged)
  if (isSel) {
    const gw = 16*dpr + Math.sin(pulsePhase)*5*dpr;
    const g = ctx.createRadialGradient(sx,sy,0,sx,sy,gw);
    g.addColorStop(0,'rgba(102,204,255,0.18)'); g.addColorStop(1,'rgba(102,204,255,0)');
    ctx.beginPath(); ctx.arc(sx,sy,gw,0,Math.PI*2); ctx.fillStyle=g; ctx.fill();
  }

  // White square — 25% of old diamond size:
  //   old normal sz = 6*dpr, old selected sz = 9*dpr (diameter ~18px / 27px)
  //   new: half-side = 1.5*dpr (normal), 2.25*dpr (selected) → ~6px / 9px square
  const half = (isSel ? 2.5 : 1.5) * dpr;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(sx - half, sy - half, half * 2, half * 2);
}

// ═══════════════════════════════════════════════════════════════════════
// MOUSE / ZOOM — radar pan, aircraft select, tag drag
// ═══════════════════════════════════════════════════════════════════════

const radarWrap = document.getElementById('radar-wrap');

radarWrap.addEventListener('mousedown', e => {
  const rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio||1;
  const ex = (e.clientX-rect.left)*dpr, ey = (e.clientY-rect.top)*dpr;

  // 1. Check for tag-label drag hit first
  const tagHit = hitTestTag(ex, ey);
  if (tagHit) {
    isDraggingTag = true;
    dragTagIcao = tagHit;
    const off = tagOffsets.get(tagHit) || { dx: Math.round(12*dpr), dy: 0 };
    const [sx,sy] = ll2c(tracks.get(tagHit).lat, tracks.get(tagHit).lon);
    // Store cursor offset relative to current tag position
    dragTagDX = ex - (sx + off.dx);
    dragTagDY = ey - (sy + off.dy);
    radarWrap.style.cursor = 'move';
    return;
  }

  // 2. Aircraft symbol click
  const hit = hitTest(ex, ey);
  if (hit) { selectTrack(hit); return; }

  // 3. Radar pan
  isDragging = true; dragSX=e.clientX; dragSY=e.clientY; panSX=panX; panSY=panY;
  radarWrap.style.cursor = 'grabbing';
});

window.addEventListener('mousemove', e => {
  const dpr = window.devicePixelRatio||1;

  if (isDraggingTag && dragTagIcao) {
    const t = tracks.get(dragTagIcao);
    if (t) {
      const rect = canvas.getBoundingClientRect();
      const ex = (e.clientX-rect.left)*dpr, ey = (e.clientY-rect.top)*dpr;
      const [sx,sy] = ll2c(t.lat, t.lon);
      tagOffsets.set(dragTagIcao, {
        dx: Math.round(ex - dragTagDX - sx),
        dy: Math.round(ey - dragTagDY - sy),
      });
    }
    return;
  }

  if (!isDragging) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0) {
      const [lat,lon] = c2ll((e.clientX-rect.left)*dpr, (e.clientY-rect.top)*dpr);
      cursorLlEl.textContent = `${Math.abs(lat).toFixed(2)}°${lat>=0?'N':'S'} ${Math.abs(lon).toFixed(2)}°${lon>=0?'E':'W'}`;
    }
    return;
  }
  panX = panSX + (e.clientX-dragSX)*dpr; panY = panSY + (e.clientY-dragSY)*dpr;
});

window.addEventListener('mouseup', () => {
  isDragging = false;
  isDraggingTag = false;
  dragTagIcao = null;
  radarWrap.style.cursor = 'crosshair';
});

radarWrap.addEventListener('wheel', e => {
  e.preventDefault();
  viewScale = Math.max(0.5, Math.min(8, viewScale * (e.deltaY > 0 ? 1.15 : 1/1.15)));
}, { passive: false });

/** Hit-test aircraft symbols */
function hitTest(ex, ey) {
  const HIT = 16 * (window.devicePixelRatio||1); let best=null, bestD=Infinity;
  for (const [icao,t] of tracks) {
    if (t.lat == null) continue;
    const [sx,sy] = ll2c(t.lat,t.lon), d = (ex-sx)**2 + (ey-sy)**2;
    if (d < HIT*HIT && d < bestD) { bestD=d; best=icao; }
  }
  return best;
}

/** Hit-test tag label areas (approximate bounding box) */
function hitTestTag(ex, ey) {
  const dpr = window.devicePixelRatio||1;
  const fPx = 11, lineH = (fPx + 3) * dpr;
  const approxW = 70 * dpr, approxH = 4 * lineH;
  for (const [icao, t] of tracks) {
    if (t.lat == null) continue;
    const [sx, sy] = ll2c(t.lat, t.lon);
    const off = tagOffsets.get(icao) || { dx: Math.round(12*dpr), dy: 0 };
    const TX = sx + off.dx, TY = sy + off.dy - lineH * 2;
    if (ex >= TX && ex <= TX + approxW && ey >= TY && ey <= TY + approxH) return icao;
  }
  return null;
}

// ── 6. Select / deselect with auto open/close panel ───────────────────
function selectTrack(icao) {
  if (selected === icao) {
    selected = null;
    selEmpty.style.display = ''; selDetail.style.display = 'none';
    setRightPanel(false);   // auto-collapse on deselect
    return;
  }
  selected = icao;
  setRightPanel(true);      // auto-open on select
  updateSelPanel();
  const t = tracks.get(icao);
  log('Selected: ' + (t?.callsign||icao), 'info');
}

// ── 4. Selected track panel with EDDN/NUE coordinates ─────────────────
function updateSelPanel() {
  if (!selected) return;
  const t = tracks.get(selected);
  if (!t) { selEmpty.style.display=''; selDetail.style.display='none'; selected=null; return; }
  selEmpty.style.display='none'; selDetail.style.display='grid';
  const ex = getMockExtras(t);
  const sqTok = getSquawkToken(t.squawk);

  // Distance and bearing from EDDN/NUE reference
  const distNm = gcdist(t.lat, t.lon, REF_LAT, REF_LON).toFixed(1);
  const bearRad = Math.atan2(
    (t.lon - REF_LON) * Math.cos(REF_LAT * Math.PI/180),
    t.lat - REF_LAT
  );
  const bearDeg = ((bearRad * 180/Math.PI) + 360) % 360;

  const rows = [
    ['ICAO',  t.icao],
    ['CALL',  t.callsign || '—'],
    ['SQK',   sqTok.text],
    ['WTC',   getWTC(t.callsign) || '—'],
    ['ATYP',  getATYP(t.callsign) || '—'],
    ['AFL',   formatFL(t.altitude)],
    ['CFL',   ex.cfl || '—'],
    ['V/R',   (t._vr > 0 ? '+' : '') + (t._vr||0) + 'fpm'],
    ['GS',    Math.round(t.groundspeed||0) + 'kt'],
    ['HDG',   (t.heading|0) + '°'],
    ['SI',    ex.si],
    ['COP',   ex.cop],
    // 4. EDDN/NUE relative coordinates
    ['REF',   REF_ICAO + '/' + REF_IATA],
    ['DIST',  distNm + ' NM'],
    ['BRG',   bearDeg.toFixed(0) + '°'],
    ['LAT',   (t.lat||0).toFixed(4) + '°' + (t.lat>=0?'N':'S')],
    ['LON',   (t.lon||0).toFixed(4) + '°' + (t.lon>=0?'E':'W')],
    ['PLOC',  t._ploc ? 'YES' : 'NO'],
  ];
  selDetail.innerHTML = rows.map(([k,v]) =>
    `<span class="sel-key">${k}</span><span class="sel-val ${k==='CALL'?'hi':''}">${v}</span>`
  ).join('');
}
setInterval(() => { if (selected) updateSelPanel(); }, 1000);

// ═══════════════════════════════════════════════════════════════════════
// CLOCK
// ═══════════════════════════════════════════════════════════════════════

function updateClock() {
  const d = new Date();
  clockEl.textContent =
    d.getUTCHours().toString().padStart(2,'0') + ':' +
    d.getUTCMinutes().toString().padStart(2,'0');
}
setInterval(updateClock, 1000); updateClock();

// ═══════════════════════════════════════════════════════════════════════
// SYSTEM LOG
// ═══════════════════════════════════════════════════════════════════════

function log(msg, type='info') {
  const d = new Date();
  const ts = d.getUTCHours().toString().padStart(2,'0') + ':' +
             d.getUTCMinutes().toString().padStart(2,'0') + ':' +
             d.getUTCSeconds().toString().padStart(2,'0');
  const el = document.createElement('div');
  el.className = 'log-entry ' + type;
  el.innerHTML = `<span class="log-ts">${ts}Z</span>${msg}`;
  logBody.prepend(el);
  while (logBody.children.length > 60) logBody.removeChild(logBody.lastChild);
}

// ═══════════════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════════════

log('PIRX v0.7.2 — EDDN/NUE Nuremberg', 'ok');
log('WS → ' + WS_URL, 'info');
log('Tags: V=VFR(green) code=IFR(blue) code=EMRG(red) PLOC=aging(orange)', 'info');
log('STBY to unlock presets + waterfall tuning', 'info');

initATCControls();
connectWebSocket();
requestAnimationFrame(render);
requestAnimationFrame(renderWaterfall);
