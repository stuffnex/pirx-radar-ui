'use strict';
// ═══════════════════════════════════════════════════════════════════════
// PIRX Radar / SDR Console — app.js
// Transparent iCAS2 tags · ATC scanner · WebSocket/mock · waterfall
// ═══════════════════════════════════════════════════════════════════════

// ── Backend endpoint ─────────────────────────────────────────────────
const BACKEND_WS_URL = 'wss://CHANGE-ME-BACKEND-URL/ws';

// ── Reference position (EDDW / EDDH area, Bremen) ────────────────────
const REF_LAT = 52.52;
const REF_LON =  8.53;
const NM_TO_M = 1852;

// ═══════════════════════════════════════════════════════════════════════
// iCAS2 LOOKUP TABLES
// ═══════════════════════════════════════════════════════════════════════

const SQI_MAP = {
  '7000': 'V',  // VFR
  '2000': 'I',  // IFR entering
  '1200': 'L',  // VFR US
  '7500': 'S',  // Hijack
  '7600': 'R',  // Radio failure
  '7700': 'E',  // Emergency
};

const WTC_MAP = {
  'DLH':'H','BAW':'H','UAE':'H','QFA':'H','SIA':'H',
  'AFR':'H','KLM':'H','THY':'H','DAL':'H','AAL':'H',
  'EZY':'M','RYR':'M','SAS':'M','IBE':'M','SWR':'M',
  'AUA':'M','TAP':'M','NAX':'M','VLG':'M','BEL':'M',
  'DLT':'M','CFG':'M','TUI':'M','EWG':'M','GEC':'H',
};

// ATYP (aircraft type) — derived from callsign prefix for mock
const ATYP_MAP = {
  'DLH':'A320','BAW':'B744','UAE':'A388','EZY':'A319',
  'RYR':'B738','SAS':'A320','KLM':'B738','AFR':'A320',
  'THY':'A320','SWR':'A220','AUA':'A320','TUI':'B738',
};

const MOCK_SI  = ['LGW','HAM','AMS','FRA','MUC','ZRH','CDG','BRU','CPH','DUS'];
const MOCK_COP = ['TOP','BOT','LFT','RGT','NTH','STH','EST','WST'];

// ═══════════════════════════════════════════════════════════════════════
// TAG COLOUR — squawk-based, applied to ENTIRE label (no backgrounds)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Returns the colour for the entire track label based on squawk code.
 *
 * RED       #ff4444  — emergency squawks 7500 / 7600 / 7700
 * AMBER     #ffaa00  — OAT / military codes 0000–0777
 * GREEN     #00ff88  — VFR standard 7000
 * LIGHT BLUE #66ccff — all other IFR / general codes
 */
function getTagColor(squawk) {
  if (!squawk) return '#66ccff';
  if (/^(7500|7600|7700)$/.test(squawk)) return '#ff4444';   // emergency
  if (/^0[0-7]{3}$/.test(squawk))        return '#ffaa00';   // OAT / mil
  if (squawk === '7000')                  return '#00ff88';   // VFR
  return '#66ccff';                                           // IFR default
}

// Dim colour for secondary/grey fields (dimmer version of the tag colour)
function getDimColor(squawk) {
  const c = getTagColor(squawk);
  // Map full-brightness accent → 40% opacity equivalent as hex
  const dimMap = {
    '#ff4444': 'rgba(255,68,68,0.38)',
    '#ffaa00': 'rgba(255,170,0,0.38)',
    '#00ff88': 'rgba(0,255,136,0.38)',
    '#66ccff': 'rgba(102,204,255,0.38)',
  };
  return dimMap[c] || 'rgba(180,220,255,0.35)';
}

// ═══════════════════════════════════════════════════════════════════════
// FIELD DERIVATION HELPERS
// ═══════════════════════════════════════════════════════════════════════

function getSQI(squawk)  { return SQI_MAP[squawk] || ''; }

function getWTC(callsign) {
  if (!callsign) return '';
  return WTC_MAP[callsign.substring(0,3).toUpperCase()] || 'M';
}

function getATYP(callsign) {
  if (!callsign) return '';
  return ATYP_MAP[callsign.substring(0,3).toUpperCase()] || '';
}

/** Format altitude: 34000 → FL340, 800 → 800ft */
function formatFL(alt) {
  if (alt == null) return '';
  if (alt >= 1000) return 'FL' + Math.round(alt/100).toString().padStart(3,'0');
  return Math.round(alt) + 'ft';
}

/**
 * Format CRC (climb-rate code): 1500fpm → +15, -800fpm → -08
 * Returns '' if rate < 50fpm (level — no display needed)
 */
function formatCRC(vr) {
  if (vr == null || Math.abs(vr) < 50) return '';
  const h = Math.round(vr / 100);
  return (h >= 0 ? '+' : '') + Math.abs(h).toString().padStart(2, '0');
}

/**
 * Trend arrow: ↓ for descent >500fpm, nothing for climb/level.
 * In the images the arrow is ↓ inline with AFL for descent only.
 */
function trendChar(vr) {
  if (vr != null && vr < -500) return '↓';
  return '';
}

/** Format ARC (assigned rate of climb): +800 or -500 */
function formatARC(vr) {
  if (vr == null || Math.abs(vr) < 50) return '';
  const h = Math.round(vr / 100) * 100;
  return (h >= 0 ? '+' : '') + h;
}

function getMockExtras(t) {
  const h = parseInt(t.icao.slice(-3), 16);
  const altDelta = (h % 2 === 0 ? 1 : -1) * 1000;
  const cfl = formatFL(t.altitude + altDelta);
  const afl = formatFL(t.altitude);
  return {
    si:   MOCK_SI[h % MOCK_SI.length],
    // CFL: hide if equals AFL (same altitude assigned)
    cfl:  cfl === afl ? '' : cfl,
    cop:  MOCK_COP[h % MOCK_COP.length],
    arc:  formatARC(t._vr),
    // XFL: extended cleared flight level (mock: CFL + 1000)
    xfl:  formatFL(t.altitude + altDelta + 1000),
    // AHDG: assigned heading
    ahdg: Math.round(((t.heading || 0) + 30) % 360).toString().padStart(3, '0'),
    // ASP: assigned speed
    asp:  t.groundspeed ? Math.round(t.groundspeed / 10) * 10 + '' : '',
    // ADES: destination (mock)
    ades: MOCK_SI[(h + 3) % MOCK_SI.length],
    // PEL: pending entry level
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
// FIELD BUILDERS — returns arrays of {text, dim?} tokens per line
// Matching the exact layout from the provided screenshots
// ═══════════════════════════════════════════════════════════════════════

/**
 * TAGGED FORMAT (default — unselected aircraft)
 * From tagged.png:
 *   Line 1: SQI  WARNINGS                       ← row 1
 *   Line 2: CALLSIGN  SI  WTC                   ← row 2
 *   Line 3: AFL↓  CRC  ARC  CFL  COP            ← row 3
 *   Line 4: GS  ASP  AHDG  XFL  ADES  PEL      ← row 4 (mostly dim)
 *   Line 5: DIAS  DMACH                          ← row 5 (dim)
 *
 * Tagged format shows 5 rows but fewer populated fields than detailed.
 * Gray = dim opacity, active = full colour.
 */
function getTaggedLines(track) {
  const sq     = track.squawk || '';
  const sqi    = getSQI(sq);
  const cs     = (track.callsign || track.icao).trim();
  const wtc    = getWTC(track.callsign);
  const afl    = formatFL(track.altitude);
  const trend  = trendChar(track._vr);
  const crc    = formatCRC(track._vr);
  const gs     = track.groundspeed ? Math.round(track.groundspeed).toString() : '';
  const isUrg  = /^(7500|7600|7700)$/.test(sq);
  const extras = getMockExtras(track);

  // Line 1: SQI  [WARNINGS]
  const row1 = [];
  if (sqi) row1.push({ text: sqi, dim: false });
  if (isUrg) row1.push({ text: 'WARNINGS', dim: false, warn: true });
  // Always show row 1 even if just SQI

  // Line 2: CALLSIGN  SI  WTC  (SI and WTC dim if no data)
  const row2 = [];
  row2.push({ text: cs, dim: false });
  if (extras.si) row2.push({ text: extras.si, dim: false });   // SI active in tagged
  if (wtc)       row2.push({ text: wtc, dim: true });           // WTC dim in tagged

  // Line 3: AFL[↓]  CRC  ARC  CFL  COP
  const row3 = [];
  if (afl)        row3.push({ text: afl + trend, dim: false });
  if (crc)        row3.push({ text: crc,          dim: false });
  if (extras.arc) row3.push({ text: extras.arc,   dim: true  });  // ARC dim in tagged
  if (extras.cfl) row3.push({ text: extras.cfl,   dim: true  });  // CFL dim
  if (extras.cop) row3.push({ text: extras.cop,   dim: true  });  // COP dim

  // Line 4: GS  ASP  AHDG  XFL  ADES  PEL
  const row4 = [];
  if (gs)           row4.push({ text: gs,           dim: false });
  if (extras.asp)   row4.push({ text: extras.asp,   dim: true });
  if (extras.ahdg)  row4.push({ text: extras.ahdg,  dim: true });
  if (extras.xfl)   row4.push({ text: extras.xfl,   dim: true });
  if (extras.ades)  row4.push({ text: extras.ades,  dim: true });
  if (extras.pel)   row4.push({ text: extras.pel,   dim: true });

  // Line 5: DIAS  DMACH (placeholder — dim in tagged, omit if no urgency)
  const row5 = [];
  // Only show row5 fields for non-trivial tracks (state-based)
  if (track._state === 'urgency' || track._state === 'assumed') {
    row5.push({ text: 'DIAS',  dim: true });
    row5.push({ text: 'DMACH', dim: true });
  }

  return [row1, row2, row3, row4, row5].filter(r => r.length > 0);
}

/**
 * DETAILED FORMAT (selected aircraft)
 * From detailed.png:
 *   Line 1: SQI  WARNINGS
 *   Line 2: CALLSIGN  SI  ATYP  WTC  +        ← ATYP and + visible
 *   Line 3: AFL↓  CRC  ARC  CFL  COP          ← ARC and COP active
 *   Line 4: GS  ASP  AHDG  XFL  ADES  PEL
 *   Line 5: DIAS  DMACH  DHDG  TRACK
 *
 * Detailed shows same 5 rows but MORE fields are active (non-dim).
 */
function getDetailedLines(track) {
  const sq     = track.squawk || '';
  const sqi    = getSQI(sq);
  const cs     = (track.callsign || track.icao).trim();
  const wtc    = getWTC(track.callsign);
  const atyp   = getATYP(track.callsign);
  const afl    = formatFL(track.altitude);
  const trend  = trendChar(track._vr);
  const crc    = formatCRC(track._vr);
  const gs     = track.groundspeed ? Math.round(track.groundspeed).toString() : '';
  const isUrg  = /^(7500|7600|7700)$/.test(sq);
  const extras = getMockExtras(track);

  // Line 1: SQI  [WARNINGS]
  const row1 = [];
  if (sqi) row1.push({ text: sqi, dim: false });
  if (isUrg) row1.push({ text: 'WARNINGS', dim: false, warn: true });

  // Line 2: CALLSIGN  SI  ATYP  WTC  +
  // In detailed: SI, ATYP, WTC, + are all ACTIVE (not dim)
  const row2 = [];
  row2.push({ text: cs, dim: false });
  if (extras.si) row2.push({ text: extras.si, dim: false });
  if (atyp)      row2.push({ text: atyp,      dim: false });
  if (wtc)       row2.push({ text: wtc,        dim: false });
  row2.push({ text: '+', dim: false });   // transfer indicator — always shown in detailed

  // Line 3: AFL[↓]  CRC  ARC  CFL  COP — all ACTIVE in detailed
  const row3 = [];
  if (afl)        row3.push({ text: afl + trend, dim: false });
  if (crc)        row3.push({ text: crc,          dim: false });
  if (extras.arc) row3.push({ text: extras.arc,   dim: false });  // active
  if (extras.cfl) row3.push({ text: extras.cfl,   dim: false });  // active
  if (extras.cop) row3.push({ text: extras.cop,   dim: true  });  // still dim

  // Line 4: GS  ASP  AHDG  XFL  ADES  PEL — GS active, rest dim
  const row4 = [];
  if (gs)           row4.push({ text: gs,           dim: false });
  if (extras.asp)   row4.push({ text: extras.asp,   dim: true });
  if (extras.ahdg)  row4.push({ text: extras.ahdg,  dim: true });
  if (extras.xfl)   row4.push({ text: extras.xfl,   dim: true });
  if (extras.ades)  row4.push({ text: extras.ades,  dim: true });
  if (extras.pel)   row4.push({ text: extras.pel,   dim: true });

  // Line 5: DIAS  DMACH  DHDG  TRACK — all dim in detailed
  const row5 = [];
  row5.push({ text: 'DIAS',  dim: true });
  row5.push({ text: 'DMACH', dim: true });
  row5.push({ text: 'DHDG',  dim: true });
  row5.push({ text: 'TRACK', dim: true });

  return [row1, row2, row3, row4, row5].filter(r => r.length > 0);
}

// ═══════════════════════════════════════════════════════════════════════
// CORE TAG DRAWING — TRANSPARENT, TEXT-COLOUR ONLY
// ═══════════════════════════════════════════════════════════════════════

/**
 * drawTag(ctx, track, x, y, isSelected)
 *
 * Renders a transparent multi-line iCAS2 tag next to the aircraft symbol.
 * No background boxes — colour is encoded in text only.
 *
 * isSelected=false → tagged format   (5 rows, some fields dim)
 * isSelected=true  → detailed format (5 rows, more fields active)
 */
function drawTag(ctx, track, x, y, isSelected) {
  const dpr       = window.devicePixelRatio || 1;
  const baseFontPx = isSelected ? 12 : 11;
  const fs        = Math.round(baseFontPx * dpr);
  const lineH     = Math.round((baseFontPx + 3) * dpr);  // row pitch
  const colGap    = Math.round(5 * dpr);                  // gap between tokens

  const fullColor = getTagColor(track.squawk);
  const dimColor  = getDimColor(track.squawk);
  const warnColor = '#ff4444';   // WARNINGS always red regardless of squawk

  const font     = `${isSelected ? 'bold ' : ''}${fs}px 'Courier New',monospace`;
  const fontBold = `bold ${fs}px 'Courier New',monospace`;

  ctx.save();
  ctx.font         = font;
  ctx.textBaseline = 'top';
  ctx.textAlign    = 'left';

  const lines = isSelected ? getDetailedLines(track) : getTaggedLines(track);

  // Offset: tag appears upper-right of the aircraft symbol
  const TX = x + Math.round(12 * dpr);
  const TY = y - Math.round(lineH * (lines.length * 0.5));

  // Thin connector line from symbol to tag anchor
  ctx.strokeStyle = fullColor;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth   = dpr * 0.8;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(TX, TY + lineH);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Draw each row
  lines.forEach((tokens, rowIdx) => {
    let curX = TX;
    const rowY = TY + rowIdx * lineH;

    tokens.forEach((tok) => {
      // Choose colour per token
      if (tok.warn) {
        ctx.fillStyle = warnColor;
        ctx.font      = fontBold;
      } else if (tok.dim) {
        ctx.fillStyle = dimColor;
        ctx.font      = font;
      } else {
        ctx.fillStyle = fullColor;
        ctx.font      = isSelected ? fontBold : font;
      }

      ctx.fillText(tok.text, curX, rowY);
      curX += ctx.measureText(tok.text).width + colGap;
    });
  });

  // Selected: draw a small selection marker on the symbol
  if (isSelected) {
    ctx.strokeStyle = fullColor;
    ctx.lineWidth   = dpr * 1.5;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(x, y, Math.round(10 * dpr), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

// Legacy wrappers (called from render loop)
function drawICAS2Untagged(ctx, track, x, y) { drawTag(ctx, track, x, y, false); }
function drawICAS2Tagged(ctx, track, x, y)   { drawTag(ctx, track, x, y, true);  }

// ═══════════════════════════════════════════════════════════════════════
// ATC SCANNER STATE
// ═══════════════════════════════════════════════════════════════════════

let freq = 118425;   // kHz

const STEP_NORMAL = [5, 8.33, 25];
const STEP_INVERT = [25, 8.33, 5];

let stepSequence = 'NORMAL';
let stepPosIndex = 0;
let stepNegIndex = 0;

let memory = {
  APP: 118425,
  TWR: 118750,
  GND: 121875,
  DEL: 121300,
  CTR: 128425,
};
let activeMemKey = 'APP';
let isMuted = false;
let wfCentreFreq = freq;

// ═══════════════════════════════════════════════════════════════════════
// GENERAL APPLICATION STATE
// ═══════════════════════════════════════════════════════════════════════
let tracks     = new Map();
let selected   = null;
let viewScale  = 1;
let panX       = 0;
let panY       = 0;
let rangeNM    = 40;
let pulsePhase = 0;

let isDragging = false;
let dragSX=0, dragSY=0, panSX=0, panSY=0;
let wfHistory  = [];
let wfPhase    = 0;
let lastTs     = 0;

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

// ═══════════════════════════════════════════════════════════════════════
// ATC SCANNER ENGINE
// ═══════════════════════════════════════════════════════════════════════

function setFreq(khz) {
  freq = Math.max(118000, Math.min(137000, khz));
  updateFreqDisplay();
  wfCentreFreq = freq;
  wfHistory = [];
  updateWfAxis();
  updateStatusPills();
}

function updateFreqDisplay() {
  freqEl.textContent = (freq / 1000).toFixed(3);
}

function updateWfAxis() {
  const fMhz = freq / 1000, bw = 0.5;
  document.getElementById('wf-f0').textContent = (fMhz - bw).toFixed(3);
  document.getElementById('wf-fc').textContent = fMhz.toFixed(3);
  document.getElementById('wf-f2').textContent = (fMhz + bw).toFixed(3);
}

function stepUp() {
  const seq = stepSequence === 'NORMAL' ? STEP_NORMAL : STEP_INVERT;
  stepPosIndex = (stepPosIndex + 1) % seq.length;
  const step = seq[stepPosIndex];
  flashStepBtn(step, '+');
  setFreq(freq + step);
  log('Step +' + step + ' kHz → ' + (freq/1000).toFixed(3) + ' MHz', 'info');
}

function stepDown() {
  const seq = stepSequence === 'NORMAL' ? STEP_NORMAL : STEP_INVERT;
  stepNegIndex = (stepNegIndex + 1) % seq.length;
  const step = seq[stepNegIndex];
  flashStepBtn(step, '-');
  setFreq(freq - step);
  log('Step −' + step + ' kHz → ' + (freq/1000).toFixed(3) + ' MHz', 'info');
}

function directStep(khz) {
  setFreq(freq + khz);
  flashStepBtn(Math.abs(khz), khz > 0 ? '+' : '-');
  log((khz > 0 ? 'Step +' : 'Step ') + khz + ' kHz → ' + (freq/1000).toFixed(3) + ' MHz', 'info');
}

function toggleINV() {
  stepSequence = stepSequence === 'NORMAL' ? 'INVERT' : 'NORMAL';
  stepPosIndex = 0;
  stepNegIndex = 0;
  const btn  = document.getElementById('btn-inv');
  const pill = document.getElementById('pill-inv');
  const isInv = stepSequence === 'INVERT';
  btn.classList.toggle('active', isInv);
  pill.classList.toggle('on', isInv);
  pill.textContent = isInv ? 'INV' : 'NORM';
  log('Step sequence: ' + stepSequence + ' (' + (isInv ? '25→8.33→5' : '5→8.33→25') + ')', 'info');
}

function tuneMemory(key) {
  if (activeMemKey && activeMemKey !== key) {
    memory[activeMemKey] = freq;
    updateMemButton(activeMemKey);
  }
  activeMemKey = key;
  setFreq(memory[key]);
  updateMemButton(key);
  log('Memory ' + key + ': → ' + (memory[key]/1000).toFixed(3) + ' MHz', 'info');
}

function storeMemory(key) {
  memory[key] = freq;
  updateMemButton(key);
  flashMemBtn(key, 'store');
  log('Memory ' + key + ' ← ' + (freq/1000).toFixed(3) + ' MHz (stored)', 'ok');
}

function updateMemButton(key) {
  const k   = key.toLowerCase();
  const btn = document.getElementById('mem-' + k);
  const fEl = document.getElementById('mf-' + k);
  if (!btn || !fEl) return;
  fEl.textContent = (memory[key]/1000).toFixed(3);
  document.querySelectorAll('.mem-btn').forEach(b => b.classList.remove('active-mem'));
  if (key === activeMemKey) btn.classList.add('active-mem');
}

function updateAllMemButtons() {
  ['APP','TWR','GND','DEL','CTR'].forEach(k => updateMemButton(k));
}

function updateStatusPills() {
  document.getElementById('pill-tuned').classList.add('on');
  document.getElementById('pill-active').classList.toggle('on', !isMuted);
}

function flashStepBtn(step, dir) {
  const map = { '5': dir==='+'?'b-p5':'b-m5', '8.33': dir==='+'?'b-p833':'b-m833', '25': dir==='+'?'b-p25':'b-m25' };
  const el  = map[String(step)] && document.getElementById(map[String(step)]);
  if (!el) return;
  const cls = dir === '+' ? 'flash-pos' : 'flash-neg';
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 180);
}

function flashMemBtn(key) {
  const btn = document.getElementById('mem-' + key.toLowerCase());
  if (!btn) return;
  btn.classList.add('store-flash');
  setTimeout(() => btn.classList.remove('store-flash'), 900);
}

function toggleMute() {
  isMuted = !isMuted;
  const btn = document.getElementById('btn-mute');
  btn.textContent = isMuted ? '🔇' : '🔊';
  btn.classList.toggle('muted', isMuted);
  document.getElementById('pill-mute').classList.toggle('on', isMuted);
  log(isMuted ? 'Audio muted' : 'Audio unmuted', 'warn');
}

function initATCControls() {
  document.querySelectorAll('.step-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      directStep(parseFloat(btn.dataset.step) * parseInt(btn.dataset.dir));
    });
  });

  document.getElementById('btn-inv').addEventListener('click', toggleINV);
  document.getElementById('btn-mute').addEventListener('click', toggleMute);

  document.querySelectorAll('.mem-btn').forEach(btn => {
    const key = btn.dataset.key;
    let pressTimer = null;
    btn.addEventListener('click', () => tuneMemory(key));
    btn.addEventListener('mousedown', () => {
      pressTimer = setTimeout(() => { pressTimer = null; storeMemory(key); }, 600);
    });
    btn.addEventListener('mouseup',   () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
    btn.addEventListener('mouseleave',() => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
    btn.addEventListener('contextmenu', e => { e.preventDefault(); storeMemory(key); });
  });

  document.getElementById('vol-slider').addEventListener('input', function() {
    document.getElementById('vol-val').textContent = (+this.value >= 0 ? '+' : '') + this.value + ' dB';
  });
  document.getElementById('sql-slider').addEventListener('input', function() {
    document.getElementById('sql-val').textContent = (+this.value >= 0 ? '+' : '') + this.value + ' dB';
  });

  updateAllMemButtons();
  updateStatusPills();
  updateFreqDisplay();
  updateWfAxis();
  document.getElementById('pill-tuned').classList.add('on');
}

// ═══════════════════════════════════════════════════════════════════════
// WEBSOCKET + MOCK DATA
// ═══════════════════════════════════════════════════════════════════════

function connectWebSocket() {
  setConnStatus('connecting');
  log('Connecting to ' + BACKEND_WS_URL + '…', 'info');
  let ws;
  try { ws = new WebSocket(BACKEND_WS_URL); }
  catch(e) { log('WebSocket unavailable — mock mode', 'warn'); startMock(); return; }

  const timeout = setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      log('Connection timeout — falling back to mock', 'warn');
      ws.close(); startMock();
    }
  }, 5000);

  ws.onopen    = () => { clearTimeout(timeout); setConnStatus('live'); log('LIVE data connected', 'ok'); };
  ws.onmessage = e => {
    try { const m=JSON.parse(e.data); if(m.type==='tracks') handleTracksMessage(m.tracks); }
    catch(err) { log('Parse error: '+err.message,'error'); }
  };
  ws.onerror   = () => { clearTimeout(timeout); log('WS error — mock mode','warn'); startMock(); };
  ws.onclose   = () => {
    if (document.getElementById('conn-badge').classList.contains('badge-live')) {
      log('WS closed — reconnect in 5s','warn'); setConnStatus('connecting');
      setTimeout(connectWebSocket, 5000);
    }
  };
}

function handleTracksMessage(arr) {
  const incoming = new Set();
  arr.forEach(t => {
    incoming.add(t.icao);
    const ex = tracks.get(t.icao) || {};
    if (!ex._state) t._state = assignState(t.icao);
    tracks.set(t.icao, Object.assign(ex, t));
  });
  for (const icao of tracks.keys()) if (!incoming.has(icao)) tracks.delete(icao);
  trackCountEl.textContent = tracks.size;
}

function setConnStatus(state) {
  const badge = document.getElementById('conn-badge');
  badge.className = 'badge badge-' + state;
  document.getElementById('conn-label').textContent =
    { connecting:'CONNECTING', live:'LIVE', mock:'MOCK' }[state] || state.toUpperCase();
}

const MOCK_CALLS   = ['DLH123','BAW456','EZY789','RYR321','AFR654','KLM987','UAE112','THY334','SAS556','IBE778','SWR990','AUA112'];
const MOCK_SQUAWKS = ['7000','7000','7000','7000','2000','1200','7500','7600','7700','7000','2000','7000'];
let mockAc = [], mockTimer = null;

function startMock() {
  if (mockTimer) return;
  setConnStatus('mock');
  log('Mock mode — 11 aircraft simulated','warn');
  for (let i=0; i<11; i++) mockAc.push(spawnAc(i));
  pushMockToTracks();
  mockTimer = setInterval(tickMock, 1000);
}

function spawnAc(i) {
  const r=8+Math.random()*30, ang=Math.random()*360;
  const lo=r*Math.cos(ang*Math.PI/180)/60;
  const la=r*Math.sin(ang*Math.PI/180)/(60*Math.cos(REF_LAT*Math.PI/180));
  const icao=(0x3C1000+i*0x1A3F+(Math.random()*0xFF|0)).toString(16).toUpperCase().padStart(6,'0');
  return {
    icao, callsign:MOCK_CALLS[i%MOCK_CALLS.length],
    lat:REF_LAT+lo, lon:REF_LON+la,
    altitude:(80+Math.floor(Math.random()*350))*100,
    groundspeed:180+Math.floor(Math.random()*380),
    heading:(Math.random()*360)|0, squawk:MOCK_SQUAWKS[i%MOCK_SQUAWKS.length],
    track_age:0,
    _vr:(Math.random()>.5?1:-1)*Math.floor(Math.random()*1200),
    _state:assignState(icao),
  };
}

function tickMock() {
  mockAc.forEach(ac => {
    const nps=ac.groundspeed/3600, rad=ac.heading*Math.PI/180;
    ac.lat+=nps*Math.cos(rad)/60; ac.lon+=nps*Math.sin(rad)/(60*Math.cos(ac.lat*Math.PI/180));
    ac.altitude=Math.max(500,Math.min(45000,ac.altitude+ac._vr/60));
    ac.heading=(ac.heading+(Math.random()-.5)*2.5+360)%360;
    if (gcdist(ac.lat,ac.lon,REF_LAT,REF_LON)>52) Object.assign(ac,spawnAc(Math.random()*100|0));
  });
  pushMockToTracks();
}

function pushMockToTracks() {
  tracks.clear(); mockAc.forEach(ac=>tracks.set(ac.icao,{...ac}));
  trackCountEl.textContent=tracks.size;
}

// ═══════════════════════════════════════════════════════════════════════
// GEO HELPERS
// ═══════════════════════════════════════════════════════════════════════

function gcdist(la1,lo1,la2,lo2) {
  const dlat=(la2-la1)*Math.PI/180, dlon=(lo2-lo1)*Math.PI/180;
  return 2*Math.asin(Math.sqrt(
    Math.sin(dlat/2)**2+Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dlon/2)**2
  ))*6371000/NM_TO_M;
}

function ll2c(lat,lon) {
  const R=6371000, mLat=REF_LAT*Math.PI/180;
  const dx=R*(lon-REF_LON)*Math.PI/180*Math.cos(mLat), dy=-R*(lat-REF_LAT)*Math.PI/180;
  const mpp=(rangeNM*NM_TO_M)/(Math.min(canvas.width,canvas.height)/2);
  return [canvas.width/2+panX+dx/mpp*viewScale, canvas.height/2+panY+dy/mpp*viewScale];
}

function c2ll(x,y) {
  const R=6371000, mLat=REF_LAT*Math.PI/180;
  const mpp=(rangeNM*NM_TO_M)/(Math.min(canvas.width,canvas.height)/2);
  const dx=(x-canvas.width/2-panX)*mpp/viewScale, dy=(y-canvas.height/2-panY)*mpp/viewScale;
  return [REF_LAT+(-dy/R)*180/Math.PI, REF_LON+(dx/(R*Math.cos(mLat)))*180/Math.PI];
}

// ═══════════════════════════════════════════════════════════════════════
// CANVAS RESIZE
// ═══════════════════════════════════════════════════════════════════════

function resize() {
  const rw=document.getElementById('radar-wrap'), dpr=window.devicePixelRatio||1;
  canvas.width=rw.clientWidth*dpr; canvas.height=rw.clientHeight*dpr;
  canvas.style.width=rw.clientWidth+'px'; canvas.style.height=rw.clientHeight+'px';
  const wb=document.getElementById('wf-body');
  const wh=Math.max(1,wb.clientHeight-14);
  wfCanvas.width=wb.clientWidth*dpr; wfCanvas.height=wh*dpr;
  wfCanvas.style.width=wb.clientWidth+'px'; wfCanvas.style.height=wh+'px';
  wfHistory=[];
}
window.addEventListener('resize', resize);
resize();

// ═══════════════════════════════════════════════════════════════════════
// RADAR RENDER LOOP
// ═══════════════════════════════════════════════════════════════════════

const RINGS=[5,10,20,40,80,120];

function render(ts) {
  requestAnimationFrame(render);
  if (ts-lastTs<33) return;
  lastTs=ts; pulsePhase=(pulsePhase+0.055)%(Math.PI*2);

  const W=canvas.width, H=canvas.height, dpr=window.devicePixelRatio||1;
  ctx.clearRect(0,0,W,H);

  // Background + vignette
  ctx.fillStyle='#0a0a0a'; ctx.fillRect(0,0,W,H);
  const vg=ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,Math.max(W,H)*0.65);
  vg.addColorStop(0,'rgba(0,0,0,0)'); vg.addColorStop(1,'rgba(0,0,0,0.55)');
  ctx.fillStyle=vg; ctx.fillRect(0,0,W,H);

  const cx=W/2+panX, cy=H/2+panY;
  const mpp=(rangeNM*NM_TO_M)/(Math.min(W,H)/2);

  // Sector lines
  const len=Math.sqrt(W*W+H*H);
  ctx.strokeStyle='rgba(0,170,170,0.07)'; ctx.lineWidth=0.7;
  for (let a=0;a<360;a+=30) {
    const r=(a-90)*Math.PI/180;
    ctx.beginPath(); ctx.moveTo(cx,cy);
    ctx.lineTo(cx+Math.cos(r)*len,cy+Math.sin(r)*len); ctx.stroke();
  }

  // Range rings — #00aaaa @ 40% opacity
  RINGS.forEach(nm => {
    const r=(nm*NM_TO_M/mpp)*viewScale;
    if (r<8||r>Math.max(W,H)) return;
    const hi=nm===10||nm===40||nm===80;
    ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
    ctx.strokeStyle=hi?'rgba(0,170,170,0.40)':'rgba(0,170,170,0.18)';
    ctx.lineWidth=hi?1.2:0.7; ctx.stroke();
    if (r>22) {
      ctx.font=`bold ${Math.round(9*dpr)}px 'Courier New',monospace`;
      ctx.fillStyle='rgba(0,200,200,0.55)';
      ctx.textAlign='left'; ctx.textBaseline='bottom';
      ctx.fillText(`${nm}NM`,cx+3,cy-r+1);
    }
  });
  ctx.textBaseline='alphabetic';

  // Centre cross
  const s=8*dpr;
  ctx.strokeStyle='#ffffff'; ctx.lineWidth=1; ctx.globalAlpha=0.55;
  ctx.beginPath(); ctx.moveTo(cx-s,cy); ctx.lineTo(cx+s,cy);
  ctx.moveTo(cx,cy-s); ctx.lineTo(cx,cy+s); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy,2*dpr,0,Math.PI*2);
  ctx.fillStyle='#ffffff'; ctx.fill();
  ctx.globalAlpha=1;

  // Aircraft symbols + tags
  const margin=80*dpr;
  for (const [icao,t] of tracks) {
    if (t.lat==null) continue;
    const [sx,sy]=ll2c(t.lat,t.lon);
    if (sx<-margin||sy<-margin||sx>W+margin||sy>H+margin) continue;
    const isSel=icao===selected;
    drawAircraftSymbol(sx,sy,t,isSel,dpr,mpp);
    if (isSel) drawICAS2Tagged(ctx,t,sx,sy);
    else       drawICAS2Untagged(ctx,t,sx,sy);
  }

  rangeNmEl.textContent=(rangeNM/viewScale).toFixed(0);
}

function drawAircraftSymbol(sx,sy,t,isSel,dpr,mpp) {
  const tagCol = getTagColor(t.squawk);

  // Velocity vector
  if (t.groundspeed!=null&&t.heading!=null) {
    const pxnm=NM_TO_M/mpp*viewScale, lead=(t.groundspeed/60)*2*pxnm;
    const ang=(t.heading-90)*Math.PI/180;
    ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(sx+Math.cos(ang)*lead,sy+Math.sin(ang)*lead);
    ctx.strokeStyle=tagCol; ctx.globalAlpha=isSel?0.60:0.30;
    ctx.lineWidth=dpr; ctx.setLineDash([3*dpr,4*dpr]); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha=1;
  }

  // Glow for selected
  if (isSel) {
    const gw=16*dpr+Math.sin(pulsePhase)*5*dpr;
    const g=ctx.createRadialGradient(sx,sy,0,sx,sy,gw);
    g.addColorStop(0,'rgba(102,204,255,0.20)'); g.addColorStop(1,'rgba(102,204,255,0)');
    ctx.beginPath(); ctx.arc(sx,sy,gw,0,Math.PI*2); ctx.fillStyle=g; ctx.fill();
  }

  // Chevron — fill: #00ff88, stroke: tag colour
  const sz=(isSel?9:6)*dpr;
  ctx.save(); ctx.translate(sx,sy); ctx.rotate(t.heading*Math.PI/180);
  ctx.beginPath(); ctx.moveTo(0,-sz*1.8); ctx.lineTo(sz,0); ctx.lineTo(0,sz*0.85); ctx.lineTo(-sz,0); ctx.closePath();
  ctx.fillStyle='#00ff88';
  ctx.strokeStyle=isSel?tagCol:'#ffffff'; ctx.lineWidth=dpr*(isSel?2:1.2);
  ctx.fill(); ctx.stroke(); ctx.restore();
}

// ═══════════════════════════════════════════════════════════════════════
// WATERFALL / FFT (animated, freq-tracked)
// ═══════════════════════════════════════════════════════════════════════

function renderWaterfall() {
  const W=wfCanvas.width, H=wfCanvas.height;
  if (W<=0||H<=0) return;
  wfPhase+=0.03;

  const bwMhz=1.0, fc=wfCentreFreq/1000;

  function peakAt(fMhz, amp) {
    return (x) => { const dx=((fMhz-fc)/bwMhz)*2; return amp*Math.exp(-Math.pow((x-dx)/0.04,2)); };
  }

  const peaks=[
    peakAt(fc,       0.70*(0.65+0.35*Math.sin(wfPhase))),
    peakAt(fc+0.10,  0.28*(0.35+0.25*Math.sin(wfPhase*1.4+1))),
    peakAt(fc-0.20,  0.15*(0.20+0.15*Math.sin(wfPhase*0.8+2))),
    peakAt(fc+0.35,  0.10*(0.15+0.10*Math.sin(wfPhase*1.1+3))),
  ];

  const row=new Uint8ClampedArray(W*4);
  for (let i=0;i<W;i++) {
    const x=(i/W-0.5)*2;
    let p=0.04+0.05*Math.random();
    peaks.forEach(fn => p+=fn(x));
    p=Math.min(1,p);
    let r,g,b;
    if      (p<0.15) { r=0;              g=Math.round(p/0.15*60);     b=Math.round(p/0.15*90); }
    else if (p<0.40) { const t=(p-0.15)/0.25; r=0;              g=Math.round(60+t*110);   b=Math.round(90+t*80); }
    else if (p<0.70) { const t=(p-0.40)/0.30; r=Math.round(t*30);    g=Math.round(170+t*85); b=Math.round(170-t*50); }
    else             { const t=(p-0.70)/0.30; r=Math.round(30+t*225); g=255;                  b=Math.round(120-t*80); }
    const idx=i*4; row[idx]=r; row[idx+1]=g; row[idx+2]=b; row[idx+3]=255;
  }
  wfHistory.unshift(row);
  if (wfHistory.length>H) wfHistory.length=H;

  const specH=Math.floor(H*0.38);
  const imgData=wfCtx.createImageData(W,H);
  for (let r=0;r<wfHistory.length&&r<H;r++) {
    if (r<specH) continue;
    imgData.data.set(wfHistory[r],r*W*4);
  }
  wfCtx.putImageData(imgData,0,0);

  wfCtx.fillStyle='rgba(10,10,10,0.93)'; wfCtx.fillRect(0,0,W,specH);

  wfCtx.strokeStyle='rgba(0,130,100,0.12)'; wfCtx.lineWidth=1;
  for (let db=0;db<=4;db++) { const y=specH*(1-db/4); wfCtx.beginPath(); wfCtx.moveTo(0,y); wfCtx.lineTo(W,y); wfCtx.stroke(); }
  wfCtx.strokeStyle='rgba(0,130,100,0.08)'; wfCtx.lineWidth=0.5;
  for (let f=0;f<=8;f++) { const x=W*f/8; wfCtx.beginPath(); wfCtx.moveTo(x,0); wfCtx.lineTo(x,specH); wfCtx.stroke(); }

  const specPeaks=[
    peakAt(fc,       0.85*(0.65+0.35*Math.sin(wfPhase))),
    peakAt(fc+0.10,  0.32*(0.35+0.25*Math.sin(wfPhase*1.4+1))),
    peakAt(fc-0.20,  0.18*(0.20+0.15*Math.sin(wfPhase*0.8+2))),
    peakAt(fc+0.35,  0.10*(0.15+0.10*Math.sin(wfPhase*1.1+3))),
  ];
  wfCtx.beginPath(); wfCtx.moveTo(0,specH);
  for (let i=0;i<W;i++) {
    const x=(i/W-0.5)*2;
    let p=0.04+0.02*Math.random();
    specPeaks.forEach(fn => p+=fn(x));
    p=Math.min(1,p);
    wfCtx.lineTo(i,specH*(1-p*0.92));
  }
  wfCtx.strokeStyle='rgba(0,220,200,0.90)'; wfCtx.lineWidth=1.5; wfCtx.stroke();

  wfCtx.strokeStyle='rgba(0,170,170,0.25)'; wfCtx.lineWidth=1;
  wfCtx.beginPath(); wfCtx.moveTo(0,specH); wfCtx.lineTo(W,specH); wfCtx.stroke();

  // White centre tune marker
  wfCtx.strokeStyle='rgba(255,255,255,0.80)'; wfCtx.lineWidth=1.5;
  wfCtx.beginPath(); wfCtx.moveTo(W/2,0); wfCtx.lineTo(W/2,H); wfCtx.stroke();
  wfCtx.fillStyle='#ffffff'; wfCtx.fillRect(W/2-4,0,8,4);

  updateWfAxis();
}
setInterval(renderWaterfall, 80);

// ═══════════════════════════════════════════════════════════════════════
// MOUSE / ZOOM
// ═══════════════════════════════════════════════════════════════════════

const radarWrap=document.getElementById('radar-wrap');

radarWrap.addEventListener('mousedown', e => {
  const rect=canvas.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
  const ex=(e.clientX-rect.left)*dpr, ey=(e.clientY-rect.top)*dpr;
  const hit=hitTest(ex,ey);
  if (hit) { selectTrack(hit); return; }
  isDragging=true; dragSX=e.clientX; dragSY=e.clientY; panSX=panX; panSY=panY;
  radarWrap.style.cursor='grabbing';
});

window.addEventListener('mousemove', e => {
  if (!isDragging) {
    const rect=canvas.getBoundingClientRect();
    if (rect.width>0) {
      const dpr=window.devicePixelRatio||1;
      const [lat,lon]=c2ll((e.clientX-rect.left)*dpr,(e.clientY-rect.top)*dpr);
      cursorLlEl.textContent=`${Math.abs(lat).toFixed(2)}°${lat>=0?'N':'S'} ${Math.abs(lon).toFixed(2)}°${lon>=0?'E':'W'}`;
    }
    return;
  }
  const dpr=window.devicePixelRatio||1;
  panX=panSX+(e.clientX-dragSX)*dpr; panY=panSY+(e.clientY-dragSY)*dpr;
});

window.addEventListener('mouseup', () => { isDragging=false; radarWrap.style.cursor='crosshair'; });

radarWrap.addEventListener('wheel', e => {
  e.preventDefault();
  viewScale=Math.max(0.5,Math.min(8,viewScale*(e.deltaY>0?1.15:1/1.15)));
}, {passive:false});

function hitTest(ex,ey) {
  const HIT=16*(window.devicePixelRatio||1); let best=null, bestD=Infinity;
  for (const [icao,t] of tracks) {
    if (t.lat==null) continue;
    const [sx,sy]=ll2c(t.lat,t.lon), d=(ex-sx)**2+(ey-sy)**2;
    if (d<HIT*HIT&&d<bestD) { bestD=d; best=icao; }
  }
  return best;
}

function selectTrack(icao) {
  if (selected===icao) {
    selected=null; selEmpty.style.display=''; selDetail.style.display='none'; return;
  }
  selected=icao; updateSelPanel();
  const t=tracks.get(icao);
  log('Selected: '+(t?.callsign||icao)+' ['+getTagColor(t?.squawk)+']','info');
}

function updateSelPanel() {
  if (!selected) return;
  const t=tracks.get(selected);
  if (!t) { selEmpty.style.display=''; selDetail.style.display='none'; selected=null; return; }
  selEmpty.style.display='none'; selDetail.style.display='grid';
  const extras=getMockExtras(t);
  const rows=[
    ['ICAO',t.icao],['CALL',t.callsign||'—'],
    ['SQI',getSQI(t.squawk)||'—'],['SQK',t.squawk||'—'],
    ['WTC',getWTC(t.callsign)],['ATYP',getATYP(t.callsign)||'—'],
    ['AFL',formatFL(t.altitude)],['CFL',extras.cfl||'—'],
    ['V/R',(t._vr>0?'+':'')+t._vr+'fpm'],['CRC',formatCRC(t._vr)||'—'],
    ['ARC',extras.arc||'—'],['SI',extras.si],['COP',extras.cop],
    ['GS',Math.round(t.groundspeed||0)+'kt'],['HDG',(t.heading|0)+'°'],
    ['COL',getTagColor(t.squawk)],
    ['LAT',t.lat?.toFixed(4)+'°'],['LON',t.lon?.toFixed(4)+'°'],
  ];
  selDetail.innerHTML=rows.map(([k,v])=>
    `<span class="sel-key">${k}</span><span class="sel-val ${k==='CALL'?'hi':''}">${v}</span>`
  ).join('');
}
setInterval(()=>{ if(selected) updateSelPanel(); },1000);

// ═══════════════════════════════════════════════════════════════════════
// CLOCK
// ═══════════════════════════════════════════════════════════════════════

function updateClock() {
  const d=new Date();
  clockEl.textContent=d.getUTCHours().toString().padStart(2,'0')+':'+d.getUTCMinutes().toString().padStart(2,'0');
}
setInterval(updateClock,1000); updateClock();

// ═══════════════════════════════════════════════════════════════════════
// SYSTEM LOG
// ═══════════════════════════════════════════════════════════════════════

function log(msg, type='info') {
  const d=new Date();
  const ts=d.getUTCHours().toString().padStart(2,'0')+':'+d.getUTCMinutes().toString().padStart(2,'0')+':'+d.getUTCSeconds().toString().padStart(2,'0');
  const el=document.createElement('div');
  el.className='log-entry '+type;
  el.innerHTML=`<span class="log-ts">${ts}Z</span>${msg}`;
  logBody.prepend(el);
  while (logBody.children.length>60) logBody.removeChild(logBody.lastChild);
}

// ═══════════════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════════════

log('PIRX Console initialised','ok');
log('iCAS2 transparent tags: GREEN=VFR · BLUE=IFR · RED=EMRG · AMBER=MIL','info');
log('Click aircraft to toggle tagged ↔ detailed format','info');

initATCControls();
connectWebSocket();
requestAnimationFrame(render);
