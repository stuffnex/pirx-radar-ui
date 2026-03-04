'use strict';
// ═══════════════════════════════════════════════════════════════════════
// PIRX Radar / SDR Console — app.js
// iCAS2 labels · ATC frequency scanner · WebSocket/mock · waterfall
// ═══════════════════════════════════════════════════════════════════════

// ── Backend endpoint ─────────────────────────────────────────────────
const BACKEND_WS_URL = 'wss://CHANGE-ME-BACKEND-URL/ws';

// ── Reference position (EDDW / EDDH area, Bremen) ────────────────────
const REF_LAT = 52.52;
const REF_LON =  8.53;
const NM_TO_M = 1852;

// ═══════════════════════════════════════════════════════════════════════
// iCAS2 DATA LOOKUP TABLES
// ═══════════════════════════════════════════════════════════════════════

const SQI_MAP = {
  '7000': 'V',  // VFR
  '2000': 'I',  // IFR entering
  '1200': 'L',  // VFR (US standard)
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

const STATE_COLORS = {
  normal:       'rgba(60,60,60,0.93)',
  assumed:      'rgba(255,130,0,0.93)',
  coordinated:  'rgba(0,195,135,0.93)',
  urgency:      'rgba(255,60,60,0.97)',
};

const MOCK_SI  = ['LGW','HAM','AMS','FRA','MUC','ZRH','CDG','BRU','CPH','DUS'];
const MOCK_COP = ['TOP','BOT','LFT','RGT','NTH','STH','EST','WST'];

// ═══════════════════════════════════════════════════════════════════════
// ATC SCANNER STATE
// ═══════════════════════════════════════════════════════════════════════

// Internal frequency in kHz (allows fractional kHz like 8.33)
let freq = 118425;   // 118.425 MHz

// Step-cycle state
// NORMAL sequence:  5 → 8.33 → 25 → 5 ...
// INVERT sequence: 25 → 8.33 →  5 → 25 ...
const STEP_NORMAL = [5, 8.33, 25];
const STEP_INVERT = [25, 8.33, 5];

let stepSequence = 'NORMAL';   // 'NORMAL' | 'INVERT'
let stepPosIndex = 0;          // index into current positive-step sequence
let stepNegIndex = 0;          // index into current negative-step sequence

// Memory channels (kHz) — EDDW / EDDH defaults
let memory = {
  APP: 118425,   // 118.425 MHz  Bremen App / Approach
  TWR: 118750,   // 118.750 MHz  Bremen Tower
  GND: 121875,   // 121.875 MHz  Bremen Ground
  DEL: 121300,   // 121.300 MHz  Bremen Delivery
  CTR: 128425,   // 128.425 MHz  Bremen CTR / Radar
};
let activeMemKey = 'APP';   // which memory slot is currently active

// Mute state
let isMuted = false;

// ── Waterfall freq tracking
let wfCentreFreq = freq;   // kHz, updated on each retune

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
// iCAS2 FIELD DERIVATION
// ═══════════════════════════════════════════════════════════════════════

function getSQI(squawk) { return SQI_MAP[squawk] || ''; }

function getWTC(callsign) {
  if (!callsign) return 'M';
  return WTC_MAP[callsign.substring(0,3).toUpperCase()] || 'M';
}

function formatFL(alt) {
  if (alt == null) return '---';
  if (alt >= 1000) return 'FL' + Math.round(alt/100).toString().padStart(3,'0');
  return Math.round(alt) + 'ft';
}

function formatCRC(vr) {
  if (vr == null || Math.abs(vr) < 50) return '  ';
  const h = Math.round(vr/100);
  return (h >= 0 ? '+' : '') + h.toString().padStart(2,'0');
}

function trendArrow(vr) {
  if (vr == null) return '▶';
  if (vr >  500)  return '▲';
  if (vr < -500)  return '▼';
  return '▶';
}

function assignState(icao) {
  const h = parseInt(icao.slice(-2), 16);
  if (h < 26)  return 'urgency';
  if (h < 77)  return 'coordinated';
  if (h < 179) return 'assumed';
  return 'normal';
}

function getMockExtras(t) {
  const h = parseInt(t.icao.slice(-3), 16);
  return {
    si:  MOCK_SI[h  % MOCK_SI.length],
    cfl: formatFL(t.altitude + (h % 2 === 0 ? 1000 : -1000)),
    cop: MOCK_COP[h % MOCK_COP.length],
    arc: (t._vr > 0 ? '+' : '') + Math.round((t._vr||0)/100).toString().padStart(3,'0'),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// iCAS2 LABEL DRAWING — UNTAGGED (default)
// Format: SQI  CALLSIGN  [WTC]  AFL  trend  CRC  CFL  GS
// ═══════════════════════════════════════════════════════════════════════
function drawICAS2Untagged(ctx, track, x, y) {
  const dpr   = window.devicePixelRatio || 1;
  const fs    = Math.round(11 * dpr);
  const state = track._state || 'normal';
  const bgCol = STATE_COLORS[state];
  const isUrg = state === 'urgency';

  const sqi    = getSQI(track.squawk);
  const cs     = (track.callsign || track.icao).padEnd(6).substring(0,6);
  const wtc    = getWTC(track.callsign);
  const afl    = formatFL(track.altitude);
  const arr    = trendArrow(track._vr);
  const crc    = formatCRC(track._vr);
  const extras = getMockExtras(track);
  const gs     = track.groundspeed != null ? Math.round(track.groundspeed).toString() : '---';

  const parts = [sqi, cs, '['+wtc+']', afl, arr, crc, extras.cfl, gs].filter(Boolean);

  ctx.save();
  ctx.font = `bold ${fs}px 'Courier New',monospace`;

  const SEP=Math.round(4*dpr), PH=Math.round(5*dpr), PV=Math.round(4*dpr);
  const lh = fs + PV*2;
  const ws = parts.map(p => ctx.measureText(p).width);
  const totalW = ws.reduce((a,b)=>a+b,0) + SEP*(parts.length-1) + PH*2;

  const LX = x + Math.round(14*dpr);
  const LY = y - Math.round(lh * 0.6);

  ctx.fillStyle = bgCol;
  roundRect(ctx, LX, LY, totalW, lh, Math.round(2*dpr));
  ctx.fill();

  if (isUrg) {
    ctx.strokeStyle='#ffffff'; ctx.lineWidth=dpr*1.5;
    roundRect(ctx, LX, LY, totalW, lh, Math.round(2*dpr));
    ctx.stroke();
  }

  ctx.textBaseline = 'top';
  let curX = LX + PH;
  const TY = LY + PV;
  parts.forEach((p, i) => {
    ctx.fillStyle = (p === crc && crc.trim()) ?
      (track._vr > 500 ? '#00ffaa' : '#ff9999') : '#ffffff';
    ctx.fillText(p, curX, TY);
    curX += ws[i] + SEP;
  });

  // Connector
  ctx.strokeStyle='rgba(255,255,255,0.35)'; ctx.lineWidth=dpr*0.6; ctx.globalAlpha=1;
  ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(LX, LY+lh*0.5); ctx.stroke();

  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════════════
// iCAS2 LABEL DRAWING — TAGGED (selected)
// Line 1: SQI  [WARN]  CALLSIGN  SI  [WTC]
// Line 2: AFL  trend   CRC  ARC  CFL  COP  GS
// ═══════════════════════════════════════════════════════════════════════
function drawICAS2Tagged(ctx, track, x, y) {
  const dpr   = window.devicePixelRatio || 1;
  const fs    = Math.round(13 * dpr);
  const state = track._state || 'normal';
  const bgCol = STATE_COLORS[state];
  const isUrg = state === 'urgency';

  const sqi    = getSQI(track.squawk);
  const cs     = (track.callsign || track.icao).padEnd(6).substring(0,6);
  const wtc    = getWTC(track.callsign);
  const afl    = formatFL(track.altitude);
  const arr    = trendArrow(track._vr);
  const crc    = formatCRC(track._vr);
  const gs     = track.groundspeed != null ? Math.round(track.groundspeed).toString() : '---';
  const extras = getMockExtras(track);
  const warn   = isUrg ? 'STCA!' : '';

  ctx.save();
  ctx.font = `bold ${fs}px 'Courier New',monospace`;

  const SEP=Math.round(6*dpr), PH=Math.round(7*dpr), PV=Math.round(5*dpr);
  const lh   = fs + PV*2;
  const boxH = lh*2 + Math.round(2*dpr);

  const l1 = [sqi, warn, cs, extras.si, '['+wtc+']'].filter(Boolean);
  const l2 = [afl, arr, crc, extras.arc, extras.cfl, extras.cop, gs].filter(Boolean);
  const w1 = l1.map(p=>ctx.measureText(p).width);
  const w2 = l2.map(p=>ctx.measureText(p).width);
  const totalW = Math.max(
    w1.reduce((a,b)=>a+b,0)+SEP*(l1.length-1),
    w2.reduce((a,b)=>a+b,0)+SEP*(l2.length-1)
  ) + PH*2;

  const LX = x + Math.round(16*dpr);
  const LY = y - Math.round(boxH*0.7);

  ctx.fillStyle = bgCol;
  roundRect(ctx, LX, LY, totalW, boxH, Math.round(3*dpr));
  ctx.fill();

  ctx.strokeStyle='#ffee00'; ctx.lineWidth=dpr*2;
  roundRect(ctx, LX, LY, totalW, boxH, Math.round(3*dpr));
  ctx.stroke();

  const divY = LY + lh;
  ctx.strokeStyle='rgba(255,255,255,0.22)'; ctx.lineWidth=dpr;
  ctx.beginPath(); ctx.moveTo(LX+PH*0.5,divY); ctx.lineTo(LX+totalW-PH*0.5,divY); ctx.stroke();

  ctx.textBaseline='top';
  // Line 1
  let cx = LX+PH;
  l1.forEach((p,i) => {
    ctx.fillStyle = (p===warn&&warn) ? '#ffee00' : (p==='['+wtc+']') ? '#aaffcc' : '#ffffff';
    ctx.fillText(p, cx, LY+PV);
    cx += w1[i]+SEP;
  });
  // Line 2
  cx = LX+PH;
  l2.forEach((p,i) => {
    ctx.fillStyle = (p===crc&&crc.trim()) ?
      (track._vr>500?'#00ffaa':'#ff9999') : '#ffffff';
    ctx.fillText(p, cx, divY+PV);
    cx += w2[i]+SEP;
  });

  ctx.strokeStyle='rgba(255,238,0,0.55)'; ctx.lineWidth=dpr*0.8;
  ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(LX, LY+boxH*0.5); ctx.stroke();

  ctx.restore();
}

function roundRect(c,x,y,w,h,r) {
  c.beginPath();
  c.moveTo(x+r,y); c.lineTo(x+w-r,y); c.quadraticCurveTo(x+w,y,x+w,y+r);
  c.lineTo(x+w,y+h-r); c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  c.lineTo(x+r,y+h); c.quadraticCurveTo(x,y+h,x,y+h-r);
  c.lineTo(x,y+r); c.quadraticCurveTo(x,y,x+r,y);
  c.closePath();
}

// ═══════════════════════════════════════════════════════════════════════
// ATC SCANNER ENGINE
// ═══════════════════════════════════════════════════════════════════════

/**
 * Core tune function — all frequency changes go through here.
 * @param {number} khz  New frequency in kHz (fractional OK, e.g. 118008.33)
 */
function setFreq(khz) {
  // Clamp to VHF aeronautical band 118.000–137.000 MHz
  freq = Math.max(118000, Math.min(137000, khz));
  updateFreqDisplay();
  wfCentreFreq = freq;
  wfHistory = [];   // clear waterfall so it redraws centred on new freq
  updateWfAxis();
  updateStatusPills();
}

function updateFreqDisplay() {
  freqEl.textContent = (freq / 1000).toFixed(3);
}

function updateWfAxis() {
  const fMhz = freq / 1000;
  const bw = 0.5;  // ±0.5 MHz shown
  document.getElementById('wf-f0').textContent = (fMhz - bw).toFixed(3);
  document.getElementById('wf-fc').textContent = fMhz.toFixed(3);
  document.getElementById('wf-f2').textContent = (fMhz + bw).toFixed(3);
}

/** Step UP: cycles through the active sequence on repeated presses */
function stepUp() {
  const seq = stepSequence === 'NORMAL' ? STEP_NORMAL : STEP_INVERT;
  stepPosIndex = (stepPosIndex + 1) % seq.length;
  const step = seq[stepPosIndex];
  flashStepBtn(step, '+');
  setFreq(freq + step);
  log('Step +' + step + ' kHz → ' + (freq/1000).toFixed(3) + ' MHz', 'info');
}

/** Step DOWN: cycles through the active sequence on repeated presses */
function stepDown() {
  const seq = stepSequence === 'NORMAL' ? STEP_NORMAL : STEP_INVERT;
  stepNegIndex = (stepNegIndex + 1) % seq.length;
  const step = seq[stepNegIndex];
  flashStepBtn(step, '-');
  setFreq(freq - step);
  log('Step −' + step + ' kHz → ' + (freq/1000).toFixed(3) + ' MHz', 'info');
}

/** Direct step (from explicit −25 / −8.33 / −5 / +5 / +8.33 / +25 buttons) */
function directStep(khz) {
  setFreq(freq + khz);
  flashStepBtn(Math.abs(khz), khz > 0 ? '+' : '-');
  log((khz>0?'Step +':'Step ') + khz + ' kHz → ' + (freq/1000).toFixed(3) + ' MHz', 'info');
}

/** Toggle step-sequence mode NORMAL ↔ INVERT */
function toggleINV() {
  stepSequence = stepSequence === 'NORMAL' ? 'INVERT' : 'NORMAL';
  stepPosIndex = 0;
  stepNegIndex = 0;
  const btn = document.getElementById('btn-inv');
  const pill = document.getElementById('pill-inv');
  if (stepSequence === 'INVERT') {
    btn.classList.add('active');
    pill.classList.add('on');
    pill.textContent = 'INV';
  } else {
    btn.classList.remove('active');
    pill.classList.remove('on');
    pill.textContent = 'NORM';
  }
  log('Step sequence: ' + stepSequence + ' (' + (stepSequence==='NORMAL'?'5→8.33→25':'25→8.33→5') + ')', 'info');
}

/**
 * Tune a memory channel.
 * Single-click → tune to stored freq.
 * Long-press (>500 ms) → store current freq into that channel.
 */
function tuneMemory(key) {
  const prevFreq = memory[key];
  // Store current freq into the OLD active channel before switching
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
  const k = key.toLowerCase();
  const btn = document.getElementById('mem-' + k);
  const fEl = document.getElementById('mf-' + k);
  if (!btn || !fEl) return;
  fEl.textContent = (memory[key]/1000).toFixed(3);
  // Active highlight
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

// Visual feedback helpers
function flashStepBtn(step, dir) {
  // Map step value → button id
  const map = { '5': dir==='+'?'b-p5':'b-m5', '8.33': dir==='+'?'b-p833':'b-m833', '25': dir==='+'?'b-p25':'b-m25' };
  const id  = map[String(step)];
  const el  = id && document.getElementById(id);
  if (!el) return;
  const cls = dir === '+' ? 'flash-pos' : 'flash-neg';
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 180);
}

function flashMemBtn(key, type) {
  const btn = document.getElementById('mem-' + key.toLowerCase());
  if (!btn) return;
  btn.classList.add('store-flash');
  setTimeout(() => btn.classList.remove('store-flash'), 900);
}

// Mute toggle
function toggleMute() {
  isMuted = !isMuted;
  const btn = document.getElementById('btn-mute');
  btn.textContent = isMuted ? '🔇' : '🔊';
  btn.classList.toggle('muted', isMuted);
  document.getElementById('pill-mute').classList.toggle('on', isMuted);
  log(isMuted ? 'Audio muted' : 'Audio unmuted', 'warn');
}

// ── Wire up ATC scanner buttons ──────────────────────────────────────
function initATCControls() {
  // Direct step buttons — each has data-step and data-dir
  document.querySelectorAll('.step-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const step = parseFloat(btn.dataset.step);
      const dir  = parseInt(btn.dataset.dir);
      directStep(step * dir);
    });
  });

  // INV button
  document.getElementById('btn-inv').addEventListener('click', toggleINV);

  // Mute button
  document.getElementById('btn-mute').addEventListener('click', toggleMute);

  // Memory buttons — click = tune, contextmenu / long-press = store
  document.querySelectorAll('.mem-btn').forEach(btn => {
    const key = btn.dataset.key;
    let pressTimer = null;

    // Short click → tune
    btn.addEventListener('click', () => tuneMemory(key));

    // Long press (500ms) → store current freq
    btn.addEventListener('mousedown', () => {
      pressTimer = setTimeout(() => {
        pressTimer = null;
        storeMemory(key);
      }, 600);
    });
    btn.addEventListener('mouseup', () => {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    });
    btn.addEventListener('mouseleave', () => {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    });

    // Right-click → store (alternative to long-press)
    btn.addEventListener('contextmenu', e => {
      e.preventDefault();
      storeMemory(key);
    });
  });

  // Volume + Squelch sliders
  document.getElementById('vol-slider').addEventListener('input', function() {
    document.getElementById('vol-val').textContent = (+this.value >= 0 ? '+' : '') + this.value + ' dB';
  });
  document.getElementById('sql-slider').addEventListener('input', function() {
    document.getElementById('sql-val').textContent = (+this.value >= 0 ? '+' : '') + this.value + ' dB';
  });

  // Initial state
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
  catch (e) { log('WebSocket unavailable — mock mode', 'warn'); startMock(); return; }

  const timeout = setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      log('Connection timeout — falling back to mock', 'warn');
      ws.close(); startMock();
    }
  }, 5000);

  ws.onopen    = () => { clearTimeout(timeout); setConnStatus('live'); log('LIVE data connected', 'ok'); };
  ws.onmessage = e => {
    try { const m=JSON.parse(e.data); if (m.type==='tracks') handleTracksMessage(m.tracks); }
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
    {connecting:'CONNECTING', live:'LIVE', mock:'MOCK'}[state] || state.toUpperCase();
}

// Mock aircraft
const MOCK_CALLS   = ['DLH123','BAW456','EZY789','RYR321','AFR654','KLM987','UAE112','THY334','SAS556','IBE778','SWR990','AUA112'];
const MOCK_SQUAWKS = ['7000','7000','7000','7000','2000','1200','7500','7600','7700','7000','2000','7000'];
let mockAc    = [];
let mockTimer = null;

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
  lastTs=ts;
  pulsePhase=(pulsePhase+0.055)%(Math.PI*2);

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
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+Math.cos(r)*len, cy+Math.sin(r)*len); ctx.stroke();
  }

  // Range rings (#00aaaa @ 40%)
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
  ctx.strokeStyle='#ffffff'; ctx.lineWidth=1; ctx.globalAlpha=0.6;
  ctx.beginPath(); ctx.moveTo(cx-s,cy); ctx.lineTo(cx+s,cy); ctx.moveTo(cx,cy-s); ctx.lineTo(cx,cy+s); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy,2*dpr,0,Math.PI*2); ctx.fillStyle='#ffffff'; ctx.fill();
  ctx.globalAlpha=1;

  // Tracks
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
  // Velocity vector
  if (t.groundspeed!=null&&t.heading!=null) {
    const pxnm=NM_TO_M/mpp*viewScale, lead=(t.groundspeed/60)*2*pxnm, ang=(t.heading-90)*Math.PI/180;
    ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(sx+Math.cos(ang)*lead,sy+Math.sin(ang)*lead);
    ctx.strokeStyle=isSel?'rgba(255,238,0,0.55)':'rgba(255,255,255,0.28)';
    ctx.lineWidth=dpr; ctx.setLineDash([3*dpr,4*dpr]); ctx.stroke(); ctx.setLineDash([]);
  }
  // Glow
  if (isSel) {
    const gw=16*dpr+Math.sin(pulsePhase)*5*dpr;
    const g=ctx.createRadialGradient(sx,sy,0,sx,sy,gw);
    g.addColorStop(0,'rgba(255,238,0,0.28)'); g.addColorStop(1,'rgba(255,238,0,0)');
    ctx.beginPath(); ctx.arc(sx,sy,gw,0,Math.PI*2); ctx.fillStyle=g; ctx.fill();
  }
  // Chevron: green fill (#00ff88), white/yellow stroke
  const sz=(isSel?9:6)*dpr;
  ctx.save(); ctx.translate(sx,sy); ctx.rotate(t.heading*Math.PI/180);
  ctx.beginPath(); ctx.moveTo(0,-sz*1.8); ctx.lineTo(sz,0); ctx.lineTo(0,sz*0.85); ctx.lineTo(-sz,0); ctx.closePath();
  ctx.fillStyle='#00ff88';
  ctx.strokeStyle=isSel?'#ffee00':'#ffffff'; ctx.lineWidth=dpr*(isSel?2:1.2);
  ctx.fill(); ctx.stroke(); ctx.restore();
}

// ═══════════════════════════════════════════════════════════════════════
// WATERFALL / FFT (animated — freq-tracked)
// ═══════════════════════════════════════════════════════════════════════

function renderWaterfall() {
  const W=wfCanvas.width, H=wfCanvas.height;
  if (W<=0||H<=0) return;
  wfPhase+=0.03;

  // Centre of spectrum display follows wfCentreFreq
  // Peaks are placed relative to it so they shift when you retune

  const row=new Uint8ClampedArray(W*4);
  for (let i=0;i<W;i++) {
    const x=(i/W-0.5)*2;  // -1..+1 across ±0.5 MHz BW

    // Signal peaks anchored to fixed absolute frequencies (move in x when we tune)
    const bwMhz=1.0;
    const fc=wfCentreFreq/1000;

    function peakAt(fMhz, amp) {
      const dx=((fMhz-fc)/bwMhz)*2;  // normalised offset
      return amp*Math.exp(-Math.pow((x-dx)/0.04,2));
    }

    let p=0.04+0.05*Math.random();
    // Main carrier at centre freq
    p+=peakAt(fc, 0.70*(0.65+0.35*Math.sin(wfPhase)));
    // Adjacent channels
    p+=peakAt(fc+0.1, 0.28*(0.35+0.25*Math.sin(wfPhase*1.4+1)));
    p+=peakAt(fc-0.2, 0.15*(0.20+0.15*Math.sin(wfPhase*0.8+2)));
    p+=peakAt(fc+0.35, 0.10*(0.15+0.10*Math.sin(wfPhase*1.1+3)));
    p=Math.min(1,p);

    let r,g,b;
    if      (p<0.15) { r=0;              g=Math.round(p/0.15*60);      b=Math.round(p/0.15*90); }
    else if (p<0.40) { const t=(p-0.15)/0.25; r=0;              g=Math.round(60+t*110);    b=Math.round(90+t*80); }
    else if (p<0.70) { const t=(p-0.40)/0.30; r=Math.round(t*30);     g=Math.round(170+t*85);  b=Math.round(170-t*50); }
    else             { const t=(p-0.70)/0.30; r=Math.round(30+t*225);  g=255;                   b=Math.round(120-t*80); }
    const idx=i*4; row[idx]=r; row[idx+1]=g; row[idx+2]=b; row[idx+3]=255;
  }
  wfHistory.unshift(row);
  if (wfHistory.length>H) wfHistory.length=H;

  const specH=Math.floor(H*0.38);
  const imgData=wfCtx.createImageData(W,H);
  for (let rr=0;rr<wfHistory.length&&rr<H;rr++) {
    if (rr<specH) continue;
    imgData.data.set(wfHistory[rr],rr*W*4);
  }
  wfCtx.putImageData(imgData,0,0);

  // Spectrum zone bg
  wfCtx.fillStyle='rgba(10,10,10,0.93)'; wfCtx.fillRect(0,0,W,specH);

  // Grid
  wfCtx.strokeStyle='rgba(0,130,100,0.12)'; wfCtx.lineWidth=1;
  for (let db=0;db<=4;db++) { const y=specH*(1-db/4); wfCtx.beginPath(); wfCtx.moveTo(0,y); wfCtx.lineTo(W,y); wfCtx.stroke(); }
  wfCtx.strokeStyle='rgba(0,130,100,0.08)'; wfCtx.lineWidth=0.5;
  for (let f=0;f<=8;f++) { const x=W*f/8; wfCtx.beginPath(); wfCtx.moveTo(x,0); wfCtx.lineTo(x,specH); wfCtx.stroke(); }

  // Spectrum FFT line (same peak positions as waterfall row)
  const bwMhz=1.0, fc=wfCentreFreq/1000;
  function specPeakAt(fMhz, amp) {
    return function(x) { const dx=((fMhz-fc)/bwMhz)*2; return amp*Math.exp(-Math.pow((x-dx)/0.04,2)); };
  }
  const specFns=[
    specPeakAt(fc,       0.85*(0.65+0.35*Math.sin(wfPhase))),
    specPeakAt(fc+0.10,  0.32*(0.35+0.25*Math.sin(wfPhase*1.4+1))),
    specPeakAt(fc-0.20,  0.18*(0.20+0.15*Math.sin(wfPhase*0.8+2))),
    specPeakAt(fc+0.35,  0.10*(0.15+0.10*Math.sin(wfPhase*1.1+3))),
  ];
  wfCtx.beginPath(); wfCtx.moveTo(0,specH);
  for (let i=0;i<W;i++) {
    const x=(i/W-0.5)*2;
    let p=0.04+0.02*Math.random();
    specFns.forEach(fn => p+=fn(x));
    p=Math.min(1,p);
    wfCtx.lineTo(i,specH*(1-p*0.92));
  }
  wfCtx.strokeStyle='rgba(0,220,200,0.90)'; wfCtx.lineWidth=1.5; wfCtx.stroke();

  // Separator
  wfCtx.strokeStyle='rgba(0,170,170,0.25)'; wfCtx.lineWidth=1;
  wfCtx.beginPath(); wfCtx.moveTo(0,specH); wfCtx.lineTo(W,specH); wfCtx.stroke();

  // Centre tune marker — WHITE solid line
  wfCtx.strokeStyle='rgba(255,255,255,0.80)'; wfCtx.lineWidth=1.5;
  wfCtx.beginPath(); wfCtx.moveTo(W/2,0); wfCtx.lineTo(W/2,H); wfCtx.stroke();
  // Small notch at top
  wfCtx.fillStyle='#ffffff';
  wfCtx.fillRect(W/2-4,0,8,4);

  updateWfAxis();
}
setInterval(renderWaterfall, 80);

// ═══════════════════════════════════════════════════════════════════════
// MOUSE / ZOOM INTERACTIONS
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
  if (selected===icao) { selected=null; selEmpty.style.display=''; selDetail.style.display='none'; return; }
  selected=icao; updateSelPanel();
  const t=tracks.get(icao);
  log('Tagged: '+(t?.callsign||icao)+' ['+(t?._state||'?').toUpperCase()+']','info');
}

function updateSelPanel() {
  if (!selected) return;
  const t=tracks.get(selected);
  if (!t) { selEmpty.style.display=''; selDetail.style.display='none'; selected=null; return; }
  selEmpty.style.display='none'; selDetail.style.display='grid';
  const fl=formatFL(t.altitude);
  const extras=getMockExtras(t);
  const rows=[
    ['ICAO',t.icao],['CALL',t.callsign||'—'],
    ['SQI',getSQI(t.squawk)||'—'],['SQK',t.squawk||'—'],
    ['WTC',getWTC(t.callsign)],['AFL',fl],['CFL',extras.cfl],
    ['V/R',(t._vr>0?'+':'')+t._vr+'fpm'],['CRC',formatCRC(t._vr)],
    ['ARC',extras.arc],['SI',extras.si],['COP',extras.cop],
    ['GS',Math.round(t.groundspeed||0)+'kt'],['HDG',(t.heading|0)+'°'],
    ['STATE',(t._state||'?').toUpperCase()],
    ['LAT',t.lat?.toFixed(4)+'°'],['LON',t.lon?.toFixed(4)+'°'],
  ];
  selDetail.innerHTML=rows.map(([k,v])=>
    `<span class="sel-key">${k}</span><span class="sel-val ${k==='CALL'?'hi':''}">${v}</span>`
  ).join('');
}
setInterval(()=>{ if(selected) updateSelPanel(); }, 1000);

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
log('ATC Scanner ready — EDDW/EDDH freqs loaded','ok');
log('Memory: long-press or right-click to store current freq','info');

initATCControls();
connectWebSocket();
requestAnimationFrame(render);
