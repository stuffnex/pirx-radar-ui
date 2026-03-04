'use strict';
// ═══════════════════════════════════════════════════════════════════════
// PIRX Radar / SDR Console — app.js  v0.6.0
//
//  1. Clean iCAS2 tags — only populated fields rendered
//  2. Simplified squawk colours (no OAT class)
//  3. EDDN (Nuremberg) default frequencies
//  4. 10 MHz span waterfall (118–128 MHz), capped 40 fps, EDDN mock peaks
//  5. Click-to-tune waterfall + crosshair hover tooltip
//  6. 6-button memory row: APP / TWR / GND / DEL / CTR / ATIS
// ═══════════════════════════════════════════════════════════════════════

const BACKEND_WS_URL = 'wss://CHANGE-ME-BACKEND-URL/ws';

// ── Reference: EDDN Nuremberg ─────────────────────────────────────────
const REF_LAT = 49.49;
const REF_LON = 11.08;
const NM_TO_M = 1852;

// ─────────────────────────────────────────────────────────────────────
// WATERFALL BAND CONSTANTS  (improvement 4)
// ─────────────────────────────────────────────────────────────────────
const WF_MIN_KHZ = 118000;   // 118.000 MHz
const WF_MAX_KHZ = 128000;   // 128.000 MHz
const WF_SPAN_KHZ = WF_MAX_KHZ - WF_MIN_KHZ;   // 10 000 kHz

// EDDN ATC frequencies for mock peaks (kHz)
const EDDN_PEAKS = [
  { f: 119475, amp: 0.80 },   // APP
  { f: 118305, amp: 0.70 },   // TWR
  { f: 121760, amp: 0.55 },   // GND / DEL
  { f: 129525, amp: 0.65 },   // CTR  — above 128 → clamped to edge
  { f: 123080, amp: 0.45 },   // ATIS
  { f: 121500, amp: 0.35 },   // EMRG guard
];

// ═══════════════════════════════════════════════════════════════════════
// iCAS2 LOOKUP TABLES
// ═══════════════════════════════════════════════════════════════════════

const SQI_MAP = {
  '7000':'V', '2000':'I', '1200':'L',
  '7500':'S', '7600':'R', '7700':'E',
};

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
// 2. TAG COLOUR — simplified, three states only
// ═══════════════════════════════════════════════════════════════════════

function getTagColor(squawk) {
  if (['7500','7600','7700'].includes(squawk)) return '#ff4444';  // red — emergency
  if (squawk === '7000')                       return '#00ff88';  // green — VFR
  return '#66ccff';                                               // light blue — IFR/other
}

function getDimColor(squawk) {
  const map = {
    '#ff4444': 'rgba(255,68,68,0.35)',
    '#00ff88': 'rgba(0,255,136,0.35)',
    '#66ccff': 'rgba(102,204,255,0.35)',
  };
  return map[getTagColor(squawk)] || 'rgba(102,204,255,0.35)';
}

// ═══════════════════════════════════════════════════════════════════════
// FIELD HELPERS
// ═══════════════════════════════════════════════════════════════════════

function getSQI(sq)  { return SQI_MAP[sq] || ''; }
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
// 1. CLEAN FIELD BUILDERS — only push fields with actual values
// ═══════════════════════════════════════════════════════════════════════

/**
 * TAGGED (unselected): minimal rows, no empty slots.
 *
 * Row 1:  SQI [WARNINGS]
 * Row 2:  CALLSIGN [SI]
 * Row 3:  AFL[↓][CRC] [CFL]          — CFL only if cleared ≠ actual
 * Row 4:  GS                          — only if GS has data
 */
function getTaggedLines(track) {
  const sq    = track.squawk || '';
  const sqi   = getSQI(sq);
  const cs    = (track.callsign || track.icao).trim();
  const afl   = formatFL(track.altitude);
  const crc   = formatCRC(track._vr);
  const trend = trendChar(track._vr);
  const gs    = track.groundspeed ? Math.round(track.groundspeed).toString() : '';
  const isUrg = ['7500','7600','7700'].includes(sq);
  const ex    = getMockExtras(track);

  // Row 1 — always shown; WARNINGS only on emergency squawk
  const r1 = [];
  if (sqi)   r1.push({ text: sqi,        dim: false });
  if (isUrg) r1.push({ text: 'WARNINGS', dim: false, warn: true });

  // Row 2 — callsign (always) + SI (only if present)
  const r2 = [];
  r2.push({ text: cs, dim: false });
  if (ex.si) r2.push({ text: ex.si, dim: false });

  // Row 3 — AFL+trend+CRC combined as one token, then CFL if different
  const r3 = [];
  if (afl) {
    const aflToken = afl + trend + crc;   // e.g. "FL340↓-08" or "FL340"
    r3.push({ text: aflToken, dim: false });
  }
  if (ex.cfl) r3.push({ text: ex.cfl, dim: true });

  // Row 4 — GS (only if present)
  const r4 = [];
  if (gs) r4.push({ text: 'GS' + gs, dim: false });

  return [r1, r2, r3, r4].filter(r => r.length > 0);
}

/**
 * DETAILED (selected): expands to show all available fields.
 *
 * Row 1:  SQI [WARNINGS]
 * Row 2:  CALLSIGN [SI] [ATYP] [WTC] [+]
 * Row 3:  AFL[↓][CRC] [ARC] [CFL] [COP]
 * Row 4:  GS [ASP] [AHDG] [XFL] [ADES] [PEL]
 * Row 5:  DIAS DMACH DHDG TRACK       (always dim)
 */
function getDetailedLines(track) {
  const sq    = track.squawk || '';
  const sqi   = getSQI(sq);
  const cs    = (track.callsign || track.icao).trim();
  const wtc   = getWTC(track.callsign);
  const atyp  = getATYP(track.callsign);
  const afl   = formatFL(track.altitude);
  const crc   = formatCRC(track._vr);
  const trend = trendChar(track._vr);
  const gs    = track.groundspeed ? Math.round(track.groundspeed).toString() : '';
  const isUrg = ['7500','7600','7700'].includes(sq);
  const ex    = getMockExtras(track);

  const r1 = [];
  if (sqi)   r1.push({ text: sqi,        dim: false });
  if (isUrg) r1.push({ text: 'WARNINGS', dim: false, warn: true });

  const r2 = [];
  r2.push({ text: cs, dim: false });
  if (ex.si) r2.push({ text: ex.si,  dim: false });
  if (atyp)  r2.push({ text: atyp,   dim: false });
  if (wtc)   r2.push({ text: wtc,    dim: false });
  r2.push({ text: '+', dim: false });   // transfer indicator

  const r3 = [];
  if (afl) {
    const aflToken = afl + trend + crc;
    r3.push({ text: aflToken, dim: false });
  }
  if (ex.arc) r3.push({ text: ex.arc, dim: false });
  if (ex.cfl) r3.push({ text: ex.cfl, dim: false });
  if (ex.cop) r3.push({ text: ex.cop, dim: true  });

  const r4 = [];
  if (gs)        r4.push({ text: 'GS'+gs,    dim: false });
  if (ex.asp)    r4.push({ text: ex.asp,      dim: true  });
  if (ex.ahdg)   r4.push({ text: ex.ahdg,    dim: true  });
  if (ex.xfl)    r4.push({ text: ex.xfl,     dim: true  });
  if (ex.ades)   r4.push({ text: ex.ades,    dim: true  });
  if (ex.pel)    r4.push({ text: ex.pel,     dim: true  });

  const r5 = [
    { text:'DIAS',  dim:true },
    { text:'DMACH', dim:true },
    { text:'DHDG',  dim:true },
    { text:'TRACK', dim:true },
  ];

  return [r1, r2, r3, r4, r5].filter(r => r.length > 0);
}

// ═══════════════════════════════════════════════════════════════════════
// TAG DRAWING — transparent, text-colour only
// ═══════════════════════════════════════════════════════════════════════

function drawTag(ctx, track, x, y, isSelected) {
  const dpr      = window.devicePixelRatio || 1;
  const fPx      = isSelected ? 12 : 11;
  const fs       = Math.round(fPx * dpr);
  const lineH    = Math.round((fPx + 3) * dpr);
  const colGap   = Math.round(5 * dpr);
  const full     = getTagColor(track.squawk);
  const dim      = getDimColor(track.squawk);
  const fontN    = `${fs}px 'Courier New',monospace`;
  const fontB    = `bold ${fs}px 'Courier New',monospace`;

  ctx.save();
  ctx.font = fontN;
  ctx.textBaseline = 'top';
  ctx.textAlign    = 'left';

  const lines = isSelected ? getDetailedLines(track) : getTaggedLines(track);
  const TX    = x + Math.round(12 * dpr);
  const TY    = y - Math.round(lineH * lines.length * 0.5);

  // Connector
  ctx.strokeStyle = full; ctx.globalAlpha = 0.30;
  ctx.lineWidth   = dpr * 0.8;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(TX, TY + lineH); ctx.stroke();
  ctx.globalAlpha = 1;

  lines.forEach((tokens, ri) => {
    let cx = TX;
    const ry = TY + ri * lineH;
    tokens.forEach(tok => {
      if (tok.warn) {
        ctx.fillStyle = '#ff4444'; ctx.font = fontB;
      } else if (tok.dim) {
        ctx.fillStyle = dim;       ctx.font = fontN;
      } else {
        ctx.fillStyle = full;      ctx.font = isSelected ? fontB : fontN;
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
// 3 + 6. ATC SCANNER STATE — EDDN defaults, 6 memory channels
// ═══════════════════════════════════════════════════════════════════════

let freq = 119475;   // kHz — EDDN APP

const STEP_NORMAL = [5, 8.33, 25];
const STEP_INVERT = [25, 8.33, 5];
let stepSequence = 'NORMAL';
let stepPosIndex = 0;
let stepNegIndex = 0;

// 3. EDDN (Nuremberg) frequencies
const memory = {
  APP:  119475,   // 119.475 MHz  EDDN Approach
  TWR:  118305,   // 118.305 MHz  EDDN Tower
  GND:  121760,   // 121.760 MHz  EDDN Ground
  DEL:  121760,   // 121.760 MHz  EDDN Delivery (same as GND)
  CTR:  129525,   // 129.525 MHz  Langen Radar
  ATIS: 123080,   // 123.080 MHz  EDDN ATIS
};
const MEM_KEYS = ['APP','TWR','GND','DEL','CTR','ATIS'];

let activeMemKey = 'APP';
let isMuted      = false;

// ═══════════════════════════════════════════════════════════════════════
// GENERAL APP STATE
// ═══════════════════════════════════════════════════════════════════════
let tracks    = new Map();
let selected  = null;
let viewScale = 1;
let panX = 0, panY = 0;
let rangeNM   = 40;
let pulsePhase = 0;
let isDragging = false;
let dragSX=0, dragSY=0, panSX=0, panSY=0;
let wfHistory = [];
let wfPhase   = 0;
let lastTs    = 0;
let wfLastTs  = 0;   // separate throttle for waterfall

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

// ═══════════════════════════════════════════════════════════════════════
// ATC SCANNER ENGINE
// ═══════════════════════════════════════════════════════════════════════

function setFreq(khz) {
  // Clamp to VHF aeronautical band 118–137 MHz
  freq = Math.max(118000, Math.min(137000, khz));
  freqEl.textContent = (freq / 1000).toFixed(3);
  updateTuneMarker();
  updateStatusPills();
  // Don't clear wfHistory — 10 MHz span keeps showing everything
}

/** Position the white tune-marker line on the waterfall */
function updateTuneMarker() {
  const pct = ((freq - WF_MIN_KHZ) / WF_SPAN_KHZ) * 100;
  const clamped = Math.max(0, Math.min(100, pct));
  wfTuneLine.style.left  = clamped + '%';
  wfTuneLine.style.transform = 'translateX(-50%)';
}

function updateStatusPills() {
  document.getElementById('pill-tuned').classList.add('on');
  document.getElementById('pill-active').classList.toggle('on', !isMuted);
}

function directStep(khz) {
  setFreq(freq + khz);
  flashStepBtn(Math.abs(khz), khz > 0 ? '+' : '-');
  log((khz > 0 ? 'Step +' : 'Step ') + Math.abs(khz) + ' kHz → ' + (freq/1000).toFixed(3) + ' MHz', 'info');
}

function toggleINV() {
  stepSequence = stepSequence === 'NORMAL' ? 'INVERT' : 'NORMAL';
  stepPosIndex = 0; stepNegIndex = 0;
  const isInv = stepSequence === 'INVERT';
  document.getElementById('btn-inv').classList.toggle('active', isInv);
  const pill = document.getElementById('pill-inv');
  pill.classList.toggle('on', isInv);
  pill.textContent = isInv ? 'INV' : 'NORM';
  log('Step ' + stepSequence + ' (' + (isInv ? '25→8.33→5' : '5→8.33→25') + ')', 'info');
}

function tuneMemory(key) {
  if (activeMemKey && activeMemKey !== key) {
    memory[activeMemKey] = freq;
    updateMemBtn(activeMemKey);
  }
  activeMemKey = key;
  setFreq(memory[key]);
  updateMemBtn(key);
  log(key + ': → ' + (memory[key]/1000).toFixed(3) + ' MHz', 'info');
}

function storeMemory(key) {
  memory[key] = freq;
  updateMemBtn(key);
  flashMemBtn(key);
  log(key + ' ← ' + (freq/1000).toFixed(3) + ' MHz (stored)', 'ok');
}

function updateMemBtn(key) {
  const k   = key.toLowerCase();
  const btn = document.getElementById('mem-' + k);
  const fEl = document.getElementById('mf-' + k);
  if (!btn || !fEl) return;
  fEl.textContent = (memory[key]/1000).toFixed(3);
  document.querySelectorAll('.mem-btn').forEach(b => b.classList.remove('active-mem'));
  if (key === activeMemKey) btn.classList.add('active-mem');
}

function updateAllMemBtns() { MEM_KEYS.forEach(k => updateMemBtn(k)); }

function flashStepBtn(step, dir) {
  const id = { '5': dir==='+'?'b-p5':'b-m5', '8.33': dir==='+'?'b-p833':'b-m833', '25': dir==='+'?'b-p25':'b-m25' }[String(step)];
  const el = id && document.getElementById(id);
  if (!el) return;
  const cls = dir === '+' ? 'flash-pos' : 'flash-neg';
  el.classList.add(cls); setTimeout(() => el.classList.remove(cls), 180);
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
    btn.addEventListener('click', () =>
      directStep(parseFloat(btn.dataset.step) * parseInt(btn.dataset.dir))
    );
  });

  document.getElementById('btn-inv').addEventListener('click', toggleINV);
  document.getElementById('btn-mute').addEventListener('click', toggleMute);

  document.querySelectorAll('.mem-btn').forEach(btn => {
    const key = btn.dataset.key;
    let pt = null;
    btn.addEventListener('click', () => tuneMemory(key));
    btn.addEventListener('mousedown', () => { pt = setTimeout(() => { pt = null; storeMemory(key); }, 600); });
    btn.addEventListener('mouseup',    () => { if (pt) { clearTimeout(pt); pt = null; } });
    btn.addEventListener('mouseleave', () => { if (pt) { clearTimeout(pt); pt = null; } });
    btn.addEventListener('contextmenu', e => { e.preventDefault(); storeMemory(key); });
  });

  document.getElementById('vol-slider').addEventListener('input', function() {
    document.getElementById('vol-val').textContent = (+this.value >= 0 ? '+' : '') + this.value + ' dB';
  });
  document.getElementById('sql-slider').addEventListener('input', function() {
    document.getElementById('sql-val').textContent = (+this.value >= 0 ? '+' : '') + this.value + ' dB';
  });

  updateAllMemBtns();
  updateStatusPills();
  updateTuneMarker();
  freqEl.textContent = (freq/1000).toFixed(3);
  document.getElementById('pill-tuned').classList.add('on');
}

// ═══════════════════════════════════════════════════════════════════════
// 4 + 5. WATERFALL — 10 MHz span, ≤40 fps, click-to-tune, hover tooltip
// ═══════════════════════════════════════════════════════════════════════

/** Convert canvas X pixel (0..W) → frequency in kHz */
function wfXtoFreq(x, W) {
  return WF_MIN_KHZ + (x / W) * WF_SPAN_KHZ;
}

/** Convert frequency kHz → canvas X pixel */
function freqToWfX(khz, W) {
  return ((khz - WF_MIN_KHZ) / WF_SPAN_KHZ) * W;
}

function renderWaterfall(ts) {
  requestAnimationFrame(renderWaterfall);

  // Throttle to 40 fps (25 ms)
  if (ts - wfLastTs < 25) return;
  wfLastTs = ts;

  const W = wfCanvas.width, H = wfCanvas.height;
  if (W <= 0 || H <= 0) return;
  wfPhase += 0.025;

  // Build one scanline row (W pixels = 118–128 MHz)
  const row = new Uint8ClampedArray(W * 4);
  for (let i = 0; i < W; i++) {
    const fKhz = wfXtoFreq(i, W);
    let p = 0.03 + 0.03 * Math.random();  // noise floor

    for (const pk of EDDN_PEAKS) {
      // Gaussian peak width ≈ 25 kHz at base
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

  // Scroll waterfall history downward
  wfHistory.unshift(row);
  if (wfHistory.length > H) wfHistory.length = H;

  const specH = Math.floor(H * 0.38);

  // Render waterfall rows
  const imgData = wfCtx.createImageData(W, H);
  for (let ri = 0; ri < wfHistory.length && ri < H; ri++) {
    if (ri < specH) continue;
    imgData.data.set(wfHistory[ri], ri * W * 4);
  }
  wfCtx.putImageData(imgData, 0, 0);

  // Spectrum zone background
  wfCtx.fillStyle = 'rgba(10,10,10,0.92)';
  wfCtx.fillRect(0, 0, W, specH);

  // dB grid lines
  wfCtx.strokeStyle = 'rgba(0,130,100,0.12)'; wfCtx.lineWidth = 1;
  for (let db = 0; db <= 4; db++) {
    const y = specH * (1 - db/4);
    wfCtx.beginPath(); wfCtx.moveTo(0,y); wfCtx.lineTo(W,y); wfCtx.stroke();
  }

  // Vertical frequency grid at each 2 MHz mark
  wfCtx.strokeStyle = 'rgba(0,130,100,0.10)'; wfCtx.lineWidth = 0.5;
  for (let mhz = 118; mhz <= 128; mhz += 2) {
    const gx = freqToWfX(mhz * 1000, W);
    wfCtx.beginPath(); wfCtx.moveTo(gx, 0); wfCtx.lineTo(gx, specH); wfCtx.stroke();
  }

  // Spectrum FFT line
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

  // Spectrum/waterfall divider
  wfCtx.strokeStyle = 'rgba(0,170,170,0.22)'; wfCtx.lineWidth = 1;
  wfCtx.beginPath(); wfCtx.moveTo(0, specH); wfCtx.lineTo(W, specH); wfCtx.stroke();

  // Tuned-frequency marker — solid white line + notch
  const tx = freqToWfX(freq, W);
  wfCtx.strokeStyle = 'rgba(255,255,255,0.85)'; wfCtx.lineWidth = 2;
  wfCtx.beginPath(); wfCtx.moveTo(tx, 0); wfCtx.lineTo(tx, H); wfCtx.stroke();
  wfCtx.fillStyle = '#ffffff';
  wfCtx.fillRect(tx - 4, 0, 8, 4);
}

// ── 5. Waterfall click-to-tune + hover tooltip ─────────────────────────
const wfBody = document.getElementById('wf-body');

wfBody.addEventListener('click', e => {
  const rect = wfCanvas.getBoundingClientRect();
  const dpr  = window.devicePixelRatio || 1;
  const rx   = (e.clientX - rect.left) / rect.width;   // 0..1
  const khz  = WF_MIN_KHZ + rx * WF_SPAN_KHZ;
  const snapped = Math.round(khz / 8.33) * 8.33;       // snap to nearest 8.33 kHz channel
  setFreq(snapped);
  log('WF click → ' + (snapped/1000).toFixed(3) + ' MHz', 'info');
});

wfBody.addEventListener('mousemove', e => {
  const rect = wfCanvas.getBoundingClientRect();
  const rx   = (e.clientX - rect.left) / rect.width;
  if (rx < 0 || rx > 1) { wfTooltip.style.display = 'none'; return; }
  const khz  = WF_MIN_KHZ + rx * WF_SPAN_KHZ;
  const mhz  = (khz / 1000).toFixed(3);
  wfTooltip.textContent = mhz + ' MHz';
  wfTooltip.style.display = 'block';
  // Position tooltip above cursor, horizontally centred
  const pct  = Math.max(0, Math.min(100, rx * 100));
  wfTooltip.style.left = pct + '%';
});

wfBody.addEventListener('mouseleave', () => {
  wfTooltip.style.display = 'none';
});

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
      log('Timeout — falling back to mock', 'warn');
      ws.close(); startMock();
    }
  }, 5000);

  ws.onopen    = () => { clearTimeout(timeout); setConnStatus('live'); log('LIVE data connected', 'ok'); };
  ws.onmessage = e => {
    try { const m = JSON.parse(e.data); if (m.type === 'tracks') handleTracksMsg(m.tracks); }
    catch(err) { log('Parse error: ' + err.message, 'error'); }
  };
  ws.onerror   = () => { clearTimeout(timeout); log('WS error — mock mode', 'warn'); startMock(); };
  ws.onclose   = () => {
    if (document.getElementById('conn-badge').classList.contains('badge-live')) {
      log('WS closed — reconnect in 5s', 'warn'); setConnStatus('connecting');
      setTimeout(connectWebSocket, 5000);
    }
  };
}

function handleTracksMsg(arr) {
  const live = new Set();
  arr.forEach(t => {
    live.add(t.icao);
    const ex = tracks.get(t.icao) || {};
    if (!ex._state) t._state = assignState(t.icao);
    tracks.set(t.icao, Object.assign(ex, t));
  });
  for (const id of tracks.keys()) if (!live.has(id)) tracks.delete(id);
  trackCountEl.textContent = tracks.size;
}

function setConnStatus(s) {
  document.getElementById('conn-badge').className = 'badge badge-' + s;
  document.getElementById('conn-label').textContent =
    { connecting:'CONNECTING', live:'LIVE', mock:'MOCK' }[s] || s.toUpperCase();
}

const MOCK_CALLS   = ['DLH123','BAW456','EZY789','RYR321','AFR654','KLM987','UAE112','THY334','SAS556','IBE778','SWR990','AUA112'];
const MOCK_SQUAWKS = ['7000','7000','7000','7000','2000','1200','7500','7600','7700','7000','2000','7000'];
let mockAc = [], mockTimer = null;

function startMock() {
  if (mockTimer) return;
  setConnStatus('mock');
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
// RADAR RENDER LOOP  (≤30 fps — unchanged)
// ═══════════════════════════════════════════════════════════════════════

const RINGS = [5, 10, 20, 40, 80, 120];

function render(ts) {
  requestAnimationFrame(render);
  if (ts - lastTs < 33) return;
  lastTs = ts; pulsePhase = (pulsePhase + 0.055) % (Math.PI * 2);

  const W = canvas.width, H = canvas.height, dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, W, H);

  // Background + vignette
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

  // Selection glow
  if (isSel) {
    const gw = 16*dpr + Math.sin(pulsePhase)*5*dpr;
    const g = ctx.createRadialGradient(sx,sy,0,sx,sy,gw);
    g.addColorStop(0,'rgba(102,204,255,0.18)'); g.addColorStop(1,'rgba(102,204,255,0)');
    ctx.beginPath(); ctx.arc(sx,sy,gw,0,Math.PI*2); ctx.fillStyle=g; ctx.fill();
  }

  // Chevron — green fill, colour-coded stroke
  const sz = (isSel ? 9 : 6)*dpr;
  ctx.save(); ctx.translate(sx,sy); ctx.rotate(t.heading*Math.PI/180);
  ctx.beginPath(); ctx.moveTo(0,-sz*1.8); ctx.lineTo(sz,0); ctx.lineTo(0,sz*0.85); ctx.lineTo(-sz,0); ctx.closePath();
  ctx.fillStyle   = '#00ff88';
  ctx.strokeStyle = isSel ? col : '#ffffff';
  ctx.lineWidth   = dpr * (isSel ? 2 : 1.2);
  ctx.fill(); ctx.stroke(); ctx.restore();
}

// ═══════════════════════════════════════════════════════════════════════
// MOUSE / ZOOM (radar only)
// ═══════════════════════════════════════════════════════════════════════

const radarWrap = document.getElementById('radar-wrap');

radarWrap.addEventListener('mousedown', e => {
  const rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio||1;
  const ex = (e.clientX-rect.left)*dpr, ey = (e.clientY-rect.top)*dpr;
  const hit = hitTest(ex, ey);
  if (hit) { selectTrack(hit); return; }
  isDragging = true; dragSX=e.clientX; dragSY=e.clientY; panSX=panX; panSY=panY;
  radarWrap.style.cursor = 'grabbing';
});

window.addEventListener('mousemove', e => {
  if (!isDragging) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0) {
      const dpr = window.devicePixelRatio||1;
      const [lat,lon] = c2ll((e.clientX-rect.left)*dpr, (e.clientY-rect.top)*dpr);
      cursorLlEl.textContent = `${Math.abs(lat).toFixed(2)}°${lat>=0?'N':'S'} ${Math.abs(lon).toFixed(2)}°${lon>=0?'E':'W'}`;
    }
    return;
  }
  const dpr = window.devicePixelRatio||1;
  panX = panSX + (e.clientX-dragSX)*dpr; panY = panSY + (e.clientY-dragSY)*dpr;
});

window.addEventListener('mouseup', () => { isDragging=false; radarWrap.style.cursor='crosshair'; });

radarWrap.addEventListener('wheel', e => {
  e.preventDefault();
  viewScale = Math.max(0.5, Math.min(8, viewScale * (e.deltaY > 0 ? 1.15 : 1/1.15)));
}, { passive: false });

function hitTest(ex, ey) {
  const HIT = 16 * (window.devicePixelRatio||1); let best=null, bestD=Infinity;
  for (const [icao,t] of tracks) {
    if (t.lat == null) continue;
    const [sx,sy] = ll2c(t.lat,t.lon), d = (ex-sx)**2 + (ey-sy)**2;
    if (d < HIT*HIT && d < bestD) { bestD=d; best=icao; }
  }
  return best;
}

function selectTrack(icao) {
  if (selected === icao) {
    selected = null; selEmpty.style.display=''; selDetail.style.display='none'; return;
  }
  selected = icao; updateSelPanel();
  const t = tracks.get(icao);
  log('Selected: ' + (t?.callsign||icao), 'info');
}

function updateSelPanel() {
  if (!selected) return;
  const t = tracks.get(selected);
  if (!t) { selEmpty.style.display=''; selDetail.style.display='none'; selected=null; return; }
  selEmpty.style.display='none'; selDetail.style.display='grid';
  const ex = getMockExtras(t);
  const rows = [
    ['ICAO',t.icao],['CALL',t.callsign||'—'],
    ['SQI',getSQI(t.squawk)||'—'],['SQK',t.squawk||'—'],
    ['WTC',getWTC(t.callsign)||'—'],['ATYP',getATYP(t.callsign)||'—'],
    ['AFL',formatFL(t.altitude)],['CFL',ex.cfl||'—'],
    ['V/R',(t._vr>0?'+':'')+t._vr+'fpm'],['CRC',formatCRC(t._vr)||'—'],
    ['ARC',ex.arc||'—'],['SI',ex.si],['COP',ex.cop],
    ['GS',Math.round(t.groundspeed||0)+'kt'],['HDG',(t.heading|0)+'°'],
    ['COL',getTagColor(t.squawk)],
    ['LAT',t.lat?.toFixed(4)+'°'],['LON',t.lon?.toFixed(4)+'°'],
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

log('PIRX v0.6.0 — EDDN Nuremberg mode', 'ok');
log('WF: 118–128 MHz · click to tune · hover for freq', 'info');
log('Tags: GREEN=VFR · BLUE=IFR · RED=EMRG', 'info');

initATCControls();
connectWebSocket();
requestAnimationFrame(render);
requestAnimationFrame(renderWaterfall);
