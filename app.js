// ===== Configuração =====
// Cole aqui o seu Client ID OAuth (tipo "Aplicativo da Web") do Google Cloud Console.
const CLIENT_ID = '92995866772-gakfs9r8kfiebllep3t2hsmav79cmksq.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'Quadrado Mágico';
const FILE_NAME = 'quadrado-magico.json';
const LS_KEY = 'quadrado-magico-backup';
const SAVE_DEBOUNCE_MS = 2000;

// ===== Estado =====
const canvas = document.getElementById('board');
let ctx = canvas.getContext('2d');
let elements = [];
let view = { x: 0, y: 0, zoom: 1 };
let tool = 'pen';
let style = { stroke: '#1e1e1e', fill: '#a5d8ff', fillOn: false, width: 3 };
let selectedId = null;
let undoStack = [], redoStack = [];
let lastTap = {};
let current = null;      // elemento em criação
let drag = null;         // estado da interação atual
let spaceDown = false;
const pointers = new Map();
let pinch = null;
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// ===== Coordenadas =====
const toWorld = (sx, sy) => ({ x: (sx - view.x) / view.zoom, y: (sy - view.y) / view.zoom });

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
  canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px';
  render();
}

// ===== Desenho =====
function bounds(el) {
  if (el.type === 'file') return { x1: el.x, y1: el.y, x2: el.x + el.w, y2: el.y + el.h };
  if (el.type === 'pen') {
    let xs = el.points.map(p => p[0]), ys = el.points.map(p => p[1]);
    return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
  }
  if (el.type === 'text') {
    ctx.font = `${el.fontSize}px sans-serif`;
    const lines = el.text.split('\n');
    const w = Math.max(...lines.map(l => ctx.measureText(l).width), 10);
    return { x1: el.x, y1: el.y, x2: el.x + w, y2: el.y + lines.length * el.fontSize * 1.25 };
  }
  return { x1: Math.min(el.x1, el.x2), y1: Math.min(el.y1, el.y2), x2: Math.max(el.x1, el.x2), y2: Math.max(el.y1, el.y2) };
}

function drawEl(el) {
  ctx.strokeStyle = el.stroke; ctx.lineWidth = el.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.fillStyle = el.fill;
  ctx.beginPath();
  switch (el.type) {
    case 'pen': {
      const p = el.points; if (!p.length) return;
      ctx.moveTo(p[0][0], p[0][1]);
      if (p.length === 1) ctx.lineTo(p[0][0] + 0.01, p[0][1]);
      for (let i = 1; i < p.length - 1; i++) {
        const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
        ctx.quadraticCurveTo(p[i][0], p[i][1], mx, my);
      }
      if (p.length > 1) ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
      ctx.stroke(); break;
    }
    case 'rect': {
      const b = bounds(el);
      ctx.rect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1);
      if (el.fillOn) ctx.fill(); ctx.stroke(); break;
    }
    case 'ellipse': {
      const b = bounds(el);
      ctx.ellipse((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, (b.x2 - b.x1) / 2, (b.y2 - b.y1) / 2, 0, 0, Math.PI * 2);
      if (el.fillOn) ctx.fill(); ctx.stroke(); break;
    }
    case 'line': case 'arrow': {
      ctx.moveTo(el.x1, el.y1); ctx.lineTo(el.x2, el.y2); ctx.stroke();
      if (el.type === 'arrow') {
        const a = Math.atan2(el.y2 - el.y1, el.x2 - el.x1), L = 10 + el.width * 2;
        ctx.beginPath();
        ctx.moveTo(el.x2 - L * Math.cos(a - 0.45), el.y2 - L * Math.sin(a - 0.45));
        ctx.lineTo(el.x2, el.y2);
        ctx.lineTo(el.x2 - L * Math.cos(a + 0.45), el.y2 - L * Math.sin(a + 0.45));
        ctx.stroke();
      }
      break;
    }
    case 'file': drawFileEl(el); break;
    case 'text': {
      ctx.font = `${el.fontSize}px sans-serif`; ctx.fillStyle = el.stroke; ctx.textBaseline = 'top';
      el.text.split('\n').forEach((l, i) => ctx.fillText(l, el.x, el.y + i * el.fontSize * 1.25));
      break;
    }
  }
}

function drawGrid() {
  const step = 40 * view.zoom; if (step < 8) return;
  ctx.fillStyle = '#d0d0d0';
  const ox = ((view.x % step) + step) % step, oy = ((view.y % step) + step) % step;
  for (let x = ox; x < innerWidth; x += step) for (let y = oy; y < innerHeight; y += step) ctx.fillRect(x - 1, y - 1, 2, 2);
}

let raf = 0;
function render() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    drawGrid();
    ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.x, dpr * view.y);
    for (const el of elements) drawEl(el);
    if (current) drawEl(current);
    const sel = elements.find(e => e.id === selectedId);
    if (sel) {
      const b = bounds(sel), m = 6 / view.zoom;
      ctx.save(); ctx.setLineDash([6 / view.zoom, 4 / view.zoom]); ctx.strokeStyle = '#4dabf7'; ctx.lineWidth = 1.5 / view.zoom;
      ctx.strokeRect(b.x1 - m, b.y1 - m, b.x2 - b.x1 + 2 * m, b.y2 - b.y1 + 2 * m);
      if (sel.type === 'file' && sel.isImage) { const h = 10 / view.zoom; ctx.setLineDash([]); ctx.fillStyle = '#fff'; ctx.fillRect(b.x2 - h / 2, b.y2 - h / 2, h, h); ctx.strokeRect(b.x2 - h / 2, b.y2 - h / 2, h, h); }
      ctx.restore();
    }
    document.getElementById('zoomLabel').textContent = Math.round(view.zoom * 100) + '%';
  });
}

// ===== Hit test =====
function distSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy;
  let t = l ? ((px - x1) * dx + (py - y1) * dy) / l : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
}
function hit(el, x, y, tol) {
  if (el.type === 'file') return x >= el.x - tol && x <= el.x + el.w + tol && y >= el.y - tol && y <= el.y + el.h + tol;
  tol += el.width / 2;
  if (el.type === 'pen') {
    const p = el.points; if (p.length === 1) return Math.hypot(x - p[0][0], y - p[0][1]) < tol;
    for (let i = 1; i < p.length; i++) if (distSeg(x, y, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]) < tol) return true;
    return false;
  }
  if (el.type === 'line' || el.type === 'arrow') return distSeg(x, y, el.x1, el.y1, el.x2, el.y2) < tol;
  const b = bounds(el);
  if (el.type === 'text') return x >= b.x1 - tol && x <= b.x2 + tol && y >= b.y1 - tol && y <= b.y2 + tol;
  if (el.type === 'rect') {
    const inside = x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2;
    if (el.fillOn && inside) return true;
    return distSeg(x, y, b.x1, b.y1, b.x2, b.y1) < tol || distSeg(x, y, b.x2, b.y1, b.x2, b.y2) < tol ||
      distSeg(x, y, b.x2, b.y2, b.x1, b.y2) < tol || distSeg(x, y, b.x1, b.y2, b.x1, b.y1) < tol;
  }
  if (el.type === 'ellipse') {
    const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2, rx = Math.max((b.x2 - b.x1) / 2, 1), ry = Math.max((b.y2 - b.y1) / 2, 1);
    const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
    if (el.fillOn && d <= 1) return true;
    return Math.abs(d - 1) * Math.min(rx, ry) < tol;
  }
  return false;
}
const topHit = (x, y) => { for (let i = elements.length - 1; i >= 0; i--) if (hit(elements[i], x, y, 6 / view.zoom)) return elements[i]; return null; };

// ===== Histórico =====
const snapshot = () => JSON.stringify(elements);
function pushHistory() { undoStack.push(snapshot()); if (undoStack.length > 200) undoStack.shift(); redoStack = []; }
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); elements = JSON.parse(undoStack.pop()); selectedId = null; changed(); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); elements = JSON.parse(redoStack.pop()); selectedId = null; changed(); }
function deleteSelected() {
  if (!selectedId) return; pushHistory();
  elements = elements.filter(e => e.id !== selectedId); selectedId = null; changed();
}
function moveEl(el, dx, dy) {
  if (el.type === 'pen') el.points = el.points.map(p => [p[0] + dx, p[1] + dy]);
  else if (el.type === 'text' || el.type === 'file') { el.x += dx; el.y += dy; }
  else { el.x1 += dx; el.x2 += dx; el.y1 += dy; el.y2 += dy; }
}

// ===== Ponteiros (mouse, caneta, toque) =====
function zoomAt(sx, sy, factor) {
  const nz = Math.min(20, Math.max(0.05, view.zoom * factor));
  const w = toWorld(sx, sy);
  view.zoom = nz; view.x = sx - w.x * nz; view.y = sy - w.y * nz;
  render(); scheduleSave(false);
}

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) { // pinça / pan com dois dedos: cancela desenho
    if (current) current = null;
    if (drag && drag.kind === 'move' && drag.moved) { undoStack.pop(); }
    drag = null;
    const [a, b] = [...pointers.values()];
    pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    render(); return;
  }
  if (pointers.size > 2) return;
  commitText();
  const w = toWorld(e.clientX, e.clientY);
  if (e.button === 1 || spaceDown || tool === 'hand') { drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; return; }
  if (e.button !== 0) return;
  const base = { id: uid(), stroke: style.stroke, fill: style.fill, fillOn: style.fillOn, width: style.width };
  switch (tool) {
    case 'pen': current = { ...base, type: 'pen', points: [[w.x, w.y]] }; break;
    case 'rect': case 'ellipse': case 'line': case 'arrow':
      current = { ...base, type: tool, x1: w.x, y1: w.y, x2: w.x, y2: w.y }; break;
    case 'text': {
      const t = topHit(w.x, w.y);
      openTextEditor(t && t.type === 'text' ? t : null, w); break;
    }
    case 'eraser': drag = { kind: 'erase', erased: false }; eraseAt(w); break;
    case 'select': {
      const cur = elements.find(x => x.id === selectedId), hs = 12 / view.zoom;
      if (cur && cur.type === 'file' && cur.isImage && Math.abs(w.x - (cur.x + cur.w)) < hs && Math.abs(w.y - (cur.y + cur.h)) < hs) {
        drag = { kind: 'resize', el: cur, moved: false, ratio: cur.h / cur.w }; break;
      }
      const t = topHit(w.x, w.y);
      selectedId = t ? t.id : null;
      if (t && t.type === 'file' && e.pointerType !== 'mouse') { // duplo toque (iPad) abre no Drive
        const now = Date.now();
        if (lastTap.id === t.id && now - lastTap.t < 400) { openFileEl(t); lastTap = {}; render(); break; }
        lastTap = { id: t.id, t: now };
      }
      if (t) drag = { kind: 'move', el: t, last: w, moved: false };
      render(); break;
    }
  }
  render();
});

function eraseAt(w) {
  const t = topHit(w.x, w.y);
  if (t) {
    if (!drag.erased) { pushHistory(); drag.erased = true; }
    elements = elements.filter(e => e !== t); if (selectedId === t.id) selectedId = null; render();
  }
}

canvas.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    view.x += cx - pinch.cx; view.y += cy - pinch.cy;
    zoomAt(cx, cy, dist / (pinch.dist || 1));
    pinch = { dist, cx, cy }; return;
  }
  const w = toWorld(e.clientX, e.clientY);
  if (drag && drag.kind === 'pan') { view.x = drag.vx + e.clientX - drag.sx; view.y = drag.vy + e.clientY - drag.sy; render(); return; }
  if (drag && drag.kind === 'erase') { eraseAt(w); return; }
  if (drag && drag.kind === 'resize') {
    if (!drag.moved) { pushHistory(); drag.moved = true; }
    drag.el.w = Math.max(20, w.x - drag.el.x); drag.el.h = drag.el.w * drag.ratio; render(); return;
  }
  if (drag && drag.kind === 'move') {
    if (!drag.moved) { pushHistory(); drag.moved = true; }
    moveEl(drag.el, w.x - drag.last.x, w.y - drag.last.y); drag.last = w; render(); return;
  }
  if (current) {
    if (current.type === 'pen') current.points.push([w.x, w.y]);
    else {
      current.x2 = w.x; current.y2 = w.y;
      if (e.shiftKey && (current.type === 'rect' || current.type === 'ellipse')) {
        const s = Math.max(Math.abs(w.x - current.x1), Math.abs(w.y - current.y1));
        current.x2 = current.x1 + Math.sign(w.x - current.x1 || 1) * s; current.y2 = current.y1 + Math.sign(w.y - current.y1 || 1) * s;
      }
    }
    render();
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pinch) { if (pointers.size < 2) pinch = null; if (pointers.size === 0) scheduleSave(false); return; }
  if (current) {
    const b = bounds(current);
    const tiny = current.type !== 'pen' && Math.hypot(b.x2 - b.x1, b.y2 - b.y1) < 2;
    if (!tiny) { pushHistory(); current.points && (current.points = current.points.map(p => [+p[0].toFixed(2), +p[1].toFixed(2)])); elements.push(current); }
    current = null; changed();
  }
  if (drag) {
    if ((drag.kind === 'move' || drag.kind === 'resize') && drag.moved) changed();
    if (drag.kind === 'erase' && drag.erased) changed();
    if (drag.kind === 'pan') scheduleSave(false);
    drag = null;
  }
}
canvas.addEventListener('mousedown', e => e.preventDefault()); // mantém o foco no editor de texto
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01)); // pinça do trackpad
  else if (e.shiftKey && !e.deltaX) { view.x -= e.deltaY; render(); scheduleSave(false); }
  else if (Math.abs(e.deltaX) > 0 || e.deltaMode === 0 && Math.abs(e.deltaY) < 50 && !Number.isInteger(e.deltaY)) { view.x -= e.deltaX; view.y -= e.deltaY; render(); scheduleSave(false); } // rolagem de trackpad = pan
  else zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });
// Safari (gestos de trackpad no Mac)
let gestureZoom = 1;
window.addEventListener('gesturestart', e => { e.preventDefault(); gestureZoom = 1; });
window.addEventListener('gesturechange', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.scale / gestureZoom); gestureZoom = e.scale; });

// ===== Texto =====
const editor = document.getElementById('textEditor');
let editing = null;
function openTextEditor(existing, w) {
  const fs = existing ? existing.fontSize : 12 + style.width * 3;
  editing = existing ? { el: existing } : { el: null, x: w.x, y: w.y, fs };
  const x = existing ? existing.x : w.x, y = existing ? existing.y : w.y;
  const s = { x: x * view.zoom + view.x, y: y * view.zoom + view.y };
  editor.value = existing ? existing.text : '';
  Object.assign(editor.style, { left: s.x + 'px', top: s.y + 'px', fontSize: fs * view.zoom + 'px', color: existing ? existing.stroke : style.stroke, width: '200px', height: fs * view.zoom * 1.4 + 'px' });
  if (existing) { existing._hidden = true; elements = elements.filter(e => e !== existing); editing.index = true; editing.backup = existing; }
  editor.classList.remove('hidden');
  autoSizeEditor();
  editor.focus(); setTimeout(() => editor.focus(), 0);
  render();
}
function autoSizeEditor() {
  editor.style.width = Math.max(200, editor.scrollWidth + 10) + 'px';
  editor.style.height = 'auto'; editor.style.height = editor.scrollHeight + 'px';
}
editor.addEventListener('input', autoSizeEditor);
editor.addEventListener('keydown', e => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); commitText(); } e.stopPropagation(); });
editor.addEventListener('blur', () => commitText());
function commitText() {
  if (!editing) return;
  const ed = editing; editing = null;
  const text = editor.value.replace(/\s+$/, '');
  editor.classList.add('hidden');
  if (ed.backup) {
    const old = ed.backup; delete old._hidden;
    if (text === old.text) { elements.push(old); render(); return; }
    elements.push(old); pushHistory(); elements = elements.filter(e => e !== old);
    if (text) elements.push({ ...old, text });
  } else if (text) {
    pushHistory();
    elements.push({ id: uid(), type: 'text', x: ed.x, y: ed.y, text, fontSize: ed.fs, stroke: style.stroke, fill: style.fill, fillOn: false, width: style.width });
  } else { render(); return; }
  changed();
}
canvas.addEventListener('dblclick', e => {
  const w = toWorld(e.clientX, e.clientY), t = topHit(w.x, w.y);
  if (t && t.type === 'text') openTextEditor(t, w);
  else if (t && t.type === 'file') openFileEl(t);
});

// ===== UI =====
function setTool(t) {
  tool = t; if (t !== 'select') selectedId = null;
  document.querySelectorAll('#toolbar button').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  canvas.style.cursor = { hand: 'grab', select: 'default', text: 'text', eraser: 'cell' }[t] || 'crosshair';
  render();
}
document.querySelectorAll('#toolbar button').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
const $ = id => document.getElementById(id);
function applyStyleToSelection(fn) {
  const el = elements.find(e => e.id === selectedId); if (!el) return;
  pushHistory(); fn(el); changed();
}
$('strokeColor').addEventListener('change', e => { style.stroke = e.target.value; applyStyleToSelection(el => el.stroke = style.stroke); });
$('fillColor').addEventListener('change', e => { style.fill = e.target.value; applyStyleToSelection(el => el.fill = style.fill); });
$('fillOn').addEventListener('change', e => { style.fillOn = e.target.checked; applyStyleToSelection(el => el.fillOn = style.fillOn); });
$('strokeWidth').addEventListener('change', e => { style.width = +e.target.value; applyStyleToSelection(el => el.width = style.width); });
document.querySelectorAll('#stylebar input').forEach(i => i.addEventListener('change', () => i.blur()));
$('undoBtn').onclick = undo; $('redoBtn').onclick = redo; $('deleteBtn').onclick = deleteSelected;
$('zoomIn').onclick = () => zoomAt(innerWidth / 2, innerHeight / 2, 1.2);
$('zoomOut').onclick = () => zoomAt(innerWidth / 2, innerHeight / 2, 1 / 1.2);
$('zoomReset').onclick = () => { view = { x: 0, y: 0, zoom: 1 }; render(); scheduleSave(false); };

window.addEventListener('keydown', e => {
  if (editing || e.target.tagName === 'INPUT') return;
  const mod = e.metaKey || e.ctrlKey;
  if (e.code === 'Space') { spaceDown = true; canvas.style.cursor = 'grab'; e.preventDefault(); return; }
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); return; }
  if (mod) return;
  const map = { v: 'select', p: 'pen', r: 'rect', o: 'ellipse', l: 'line', a: 'arrow', t: 'text', e: 'eraser', h: 'hand' };
  if (map[e.key.toLowerCase()]) setTool(map[e.key.toLowerCase()]);
});
window.addEventListener('keyup', e => { if (e.code === 'Space') { spaceDown = false; setTool(tool); } });

// ===== Persistência =====
function serialize() {
  return { app: 'quadrado-magico', version: 1, savedAt: new Date().toISOString(), viewport: { ...view }, elements };
}
function loadState(data) {
  if (!data || !Array.isArray(data.elements)) return false;
  elements = data.elements.filter(e => !e.uploading); if (data.viewport) view = { ...view, ...data.viewport };
  undoStack = []; redoStack = []; selectedId = null; render(); return true;
}
function saveLocal() { try { localStorage.setItem(LS_KEY, JSON.stringify(serialize())); } catch (e) { console.warn(e); } }
function changed() { render(); scheduleSave(true); }

let saveTimer = null, dirty = false, saving = false, saveAgain = false;
function scheduleSave(contentChanged) {
  saveLocal();
  dirty = true;
  if (!accessToken) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
}

function setStatus(kind, text) {
  const s = $('status'); s.className = 'st-' + kind; s.textContent = text;
}

// ===== Google Identity Services + Drive API v3 =====
let tokenClient = null, accessToken = null, tokenExpiry = 0, tokenWaiters = [];
let folderId = null, fileId = null;

function initGis() {
  if (!window.google || !google.accounts || !google.accounts.oauth2) { setTimeout(initGis, 300); return; }
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID, scope: SCOPE,
    callback: resp => {
      const waiters = tokenWaiters; tokenWaiters = [];
      if (resp.error) { setStatus('error', 'Erro no login'); waiters.forEach(w => w.reject(resp)); return; }
      accessToken = resp.access_token; tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
      localStorage.setItem('quadrado-magico-logged', '1');
      storeToken();
      waiters.forEach(w => w.resolve(accessToken));
    },
    error_callback: err => { const w = tokenWaiters; tokenWaiters = []; setStatus('error', 'Erro no login'); w.forEach(x => x.reject(err)); }
  });
}
const TOKEN_KEY = 'quadrado-magico-token';
let userEmail = '';
function storeToken() {
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ access_token: accessToken, expiry: tokenExpiry, email: userEmail })); } catch (e) {}
}
function readStoredToken() { try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); } catch (e) { return null; } }
function clearStoredToken(keepEmail) {
  const old = readStoredToken();
  if (keepEmail && old && old.email) localStorage.setItem(TOKEN_KEY, JSON.stringify({ email: old.email }));
  else localStorage.removeItem(TOKEN_KEY);
}
function requestToken(prompt, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!tokenClient) return reject(new Error('Google Identity Services não carregou'));
    let done = false, timer = null;
    const w = {
      resolve: t => { if (done) return; done = true; clearTimeout(timer); resolve(t); },
      reject: e => { if (done) return; done = true; clearTimeout(timer); reject(e); }
    };
    tokenWaiters.push(w);
    if (timeoutMs) timer = setTimeout(() => { tokenWaiters = tokenWaiters.filter(x => x !== w); w.reject(new Error('timeout')); }, timeoutMs);
    const opts = { prompt };
    if (userEmail) { opts.hint = userEmail; opts.login_hint = userEmail; }
    tokenClient.requestAccessToken(opts);
  });
}
async function getToken() {
  if (accessToken && Date.now() < tokenExpiry) return accessToken;
  return requestToken('', 15000);
}
async function driveFetch(url, opts = {}, retry = true) {
  const token = await getToken();
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token } });
  if (res.status === 401 && retry) { accessToken = null; tokenExpiry = 0; clearStoredToken(true); await requestToken('', 15000); return driveFetch(url, opts, false); }
  if (!res.ok) throw new Error('Drive ' + res.status + ': ' + await res.text());
  return res;
}
const q = s => encodeURIComponent(s);
async function findOrCreateFolder() {
  const query = `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const r = await (await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q(query)}&fields=files(id,name)&spaces=drive`)).json();
  if (r.files && r.files.length) return r.files[0].id;
  const c = await (await driveFetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
  })).json();
  return c.id;
}
async function findFile() {
  const query = `name='${FILE_NAME}' and '${folderId}' in parents and trashed=false`;
  const r = await (await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q(query)}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`)).json();
  return r.files && r.files.length ? r.files[0].id : null;
}
async function createFile(json) {
  const boundary = 'qm' + Date.now();
  const meta = { name: FILE_NAME, mimeType: 'application/json', parents: [folderId] };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
  const r = await (await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body
  })).json();
  return r.id;
}
async function saveNow() {
  clearTimeout(saveTimer);
  saveLocal();
  if (!accessToken && !tokenExpiry) { setStatus('off', 'Não conectado (backup local)'); return; }
  if (saving) { saveAgain = true; return; }
  saving = true; setStatus('saving', 'Salvando…');
  try {
    if (!folderId) folderId = await findOrCreateFolder();
    const json = JSON.stringify(serialize());
    if (!fileId) fileId = await findFile();
    if (!fileId) fileId = await createFile(json);
    else await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: json
    });
    dirty = false;
    try { await uploadBoardPng(); } catch (e) { console.error('PNG', e); }
    setStatus('saved', 'Salvo ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
  } catch (err) {
    console.error(err); setStatus('error', 'Erro ao salvar');
  } finally {
    saving = false;
    if (saveAgain) { saveAgain = false; saveNow(); }
  }
}
async function loadFromDrive() {
  setStatus('saving', 'Carregando…');
  try {
    folderId = await findOrCreateFolder();
    fileId = await findFile();
    if (fileId) {
      const data = await (await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`)).json();
      const local = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      // Se o backup local for mais recente que o Drive (ex.: editou offline), mantém o local e envia.
      if (local && local.savedAt && data.savedAt && local.savedAt > data.savedAt && local.elements.length) { loadState(local); await saveNow(); }
      else { loadState(data); saveLocal(); setStatus('saved', 'Salvo'); }
    } else { await saveNow(); }
  } catch (err) { console.error(err); setStatus('error', 'Erro ao carregar'); }
}
function showConnected(on) {
  $('loginBtn').classList.toggle('hidden', on); $('logoutBtn').classList.toggle('hidden', !on); $('saveBtn').disabled = !on;
}
async function fetchEmail() {
  if (userEmail) return;
  try {
    const r = await (await driveFetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)')).json();
    userEmail = (r.user && r.user.emailAddress) || ''; storeToken();
  } catch (e) { console.warn(e); }
}
async function afterConnect() {
  showConnected(true);
  await loadFromDrive();
  retryImages();
  fetchEmail();
}
async function login() {
  try {
    await requestToken(localStorage.getItem('quadrado-magico-logged') ? '' : 'consent');
    await afterConnect();
  } catch (e) { console.error(e); setStatus('error', 'Erro no login'); }
}
// Reconecta automaticamente ao recarregar a página.
async function autoLogin() {
  const st = readStoredToken();
  if (st && st.email) userEmail = st.email;
  if (st && st.access_token && st.expiry > Date.now()) {
    accessToken = st.access_token; tokenExpiry = st.expiry;
    try { await afterConnect(); return; } catch (e) { console.warn(e); }
  }
  if (!localStorage.getItem('quadrado-magico-logged')) return;
  // Token expirado: tenta renovar em silêncio; se falhar/bloquear, mostra o botão de login.
  const waitGis = () => new Promise(res => { const t0 = Date.now(); (function w() { if (tokenClient || Date.now() - t0 > 10000) res(); else setTimeout(w, 200); })(); });
  await waitGis();
  setStatus('saving', 'Reconectando…');
  try { await requestToken('', 10000); await afterConnect(); }
  catch (e) {
    console.warn('Renovação silenciosa falhou', e);
    accessToken = null; tokenExpiry = 0; showConnected(false);
    setStatus('off', 'Não conectado — clique em Entrar');
  }
}
function logout() {
  if (accessToken && window.google && google.accounts) google.accounts.oauth2.revoke(accessToken, () => {});
  accessToken = null; tokenExpiry = 0; folderId = fileId = null; filesFolderId = pngFileId = null; lastPngKey = ''; userEmail = '';
  localStorage.removeItem('quadrado-magico-logged'); localStorage.removeItem(TOKEN_KEY);
  $('loginBtn').classList.remove('hidden'); $('logoutBtn').classList.add('hidden'); $('saveBtn').disabled = true;
  setStatus('off', 'Não conectado');
}
$('loginBtn').onclick = login; $('logoutBtn').onclick = logout; $('saveBtn').onclick = saveNow;
window.addEventListener('beforeunload', e => { saveLocal(); if (dirty && accessToken) { e.preventDefault(); e.returnValue = ''; } });

// ===== Arquivos (qualquer tipo) e imagens no quadro =====
const PNG_NAME = 'quadrado-magico.png';
const FILES_FOLDER = 'Arquivos';
const imgCache = new Map(); // fileId -> { img, status }
let filesFolderId = null, pngFileId = null, lastPngKey = '';

function fmtSize(n) {
  n = +n || 0; if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}
function fileIcon(mime, name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (mime === 'application/pdf' || ext === 'pdf') return '📕';
  if (/word|document/.test(mime) || /^(docx?|odt|rtf)$/.test(ext)) return '📘';
  if (/sheet|excel|csv/.test(mime) || /^(xlsx?|ods|csv)$/.test(ext)) return '📗';
  if (/presentation|powerpoint/.test(mime) || /^(pptx?|odp|key)$/.test(ext)) return '📙';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.startsWith('audio/')) return '🎵';
  if (/zip|compressed|tar|rar/.test(mime)) return '🗜️';
  if (mime.startsWith('text/')) return '📄';
  return '📎';
}
function getImage(el) {
  if (!el.fileId) return { img: null, status: 'none' };
  let c = imgCache.get(el.fileId);
  if (c) return c;
  c = { img: null, status: 'none' }; imgCache.set(el.fileId, c);
  if (accessToken) loadDriveImage(el.fileId, c);
  return c;
}
async function loadDriveImage(id, c) {
  c.status = 'loading';
  try {
    const blob = await (await driveFetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).blob();
    await setCacheBlob(id, blob);
  } catch (e) { console.error(e); c.status = 'error'; render(); }
}
function setCacheBlob(id, blob) {
  return new Promise(res => {
    const img = new Image(), c = imgCache.get(id) || {};
    img.onload = () => { c.img = img; c.status = 'ok'; imgCache.set(id, c); render(); res(img); };
    img.onerror = () => { c.status = 'error'; imgCache.set(id, c); render(); res(null); };
    img.src = URL.createObjectURL(blob);
  });
}
function retryImages() { for (const [id, c] of imgCache) if (c.status === 'none') loadDriveImage(id, c); render(); }
function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function drawFileEl(el) {
  if (el.isImage) {
    const c = getImage(el);
    if (c.img) { ctx.drawImage(c.img, el.x, el.y, el.w, el.h); return; }
    ctx.fillStyle = '#f1f3f5'; ctx.fillRect(el.x, el.y, el.w, el.h);
    ctx.strokeStyle = '#ced4da'; ctx.lineWidth = 1; ctx.strokeRect(el.x, el.y, el.w, el.h);
    ctx.fillStyle = '#868e96'; ctx.font = '14px sans-serif'; ctx.textBaseline = 'middle';
    ctx.fillText(c.status === 'error' ? '⚠️ ' + el.name : (el.uploading ? 'Enviando… ' : '🖼️ ') + el.name, el.x + 8, el.y + el.h / 2, el.w - 16);
    return;
  }
  ctx.save();
  roundRect(el.x, el.y, el.w, el.h, 10); ctx.fillStyle = '#fff'; ctx.fill();
  ctx.strokeStyle = '#adb5bd'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.textBaseline = 'middle'; ctx.font = '30px sans-serif'; ctx.fillStyle = '#000';
  ctx.fillText(fileIcon(el.mimeType || '', el.name), el.x + 12, el.y + el.h / 2);
  ctx.font = '600 14px sans-serif'; ctx.fillStyle = '#212529';
  let name = el.name; const maxW = el.w - 70;
  while (ctx.measureText(name).width > maxW && name.length > 4) name = name.slice(0, -4) + '…';
  ctx.fillText(name, el.x + 58, el.y + el.h / 2 - 10);
  ctx.font = '12px sans-serif'; ctx.fillStyle = '#868e96';
  ctx.fillText(el.uploading ? 'Enviando…' : fmtSize(el.size) + ' · abrir no Drive', el.x + 58, el.y + el.h / 2 + 11);
  ctx.restore();
}
function openFileEl(el) {
  const url = el.webViewLink || (el.fileId ? `https://drive.google.com/file/d/${el.fileId}/view` : null);
  if (url) window.open(url, '_blank', 'noopener');
}

async function findOrCreate(name, parent, mime) {
  const query = `name='${name.replace(/'/g, "\\'")}' and '${parent}' in parents and trashed=false` + (mime ? ` and mimeType='${mime}'` : '');
  const r = await (await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q(query)}&fields=files(id)`)).json();
  return r.files && r.files.length ? r.files[0].id : null;
}
async function ensureFilesFolder() {
  if (!folderId) folderId = await findOrCreateFolder();
  if (filesFolderId) return filesFolderId;
  filesFolderId = await findOrCreate(FILES_FOLDER, folderId, 'application/vnd.google-apps.folder');
  if (!filesFolderId) {
    const c = await (await driveFetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FILES_FOLDER, mimeType: 'application/vnd.google-apps.folder', parents: [folderId] })
    })).json();
    filesFolderId = c.id;
  }
  return filesFolderId;
}
// Upload resumível (serve para arquivos grandes) com progresso via XHR.
async function resumableUpload(file, parent, onProgress, retry = true) {
  const token = await getToken();
  const mime = file.type || 'application/octet-stream';
  const init = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,webViewLink', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(file.size) },
    body: JSON.stringify({ name: file.name || 'arquivo', mimeType: mime, parents: [parent] })
  });
  if (init.status === 401 && retry) { accessToken = null; tokenExpiry = 0; clearStoredToken(true); await requestToken('', 15000); return resumableUpload(file, parent, onProgress, false); }
  if (!init.ok) throw new Error('Drive ' + init.status + ': ' + await init.text());
  const url = init.headers.get('Location');
  if (!url) throw new Error('Drive não retornou a URL de upload');
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.setRequestHeader('Content-Type', mime);
    x.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => { if (x.status >= 200 && x.status < 300) resolve(JSON.parse(x.responseText)); else reject(new Error('Upload ' + x.status + ': ' + x.responseText)); };
    x.onerror = () => reject(new Error('Falha de rede no upload'));
    x.send(file);
  });
}
function imageSize(file) {
  return new Promise(res => {
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight, blobUrl: u, img });
    img.onerror = () => res(null);
    img.src = u;
  });
}
let uploadsActive = 0;
async function uploadFiles(files, screenPt) {
  files = [...files]; if (!files.length) return;
  if (!accessToken && !tokenExpiry) { setStatus('error', 'Entre com Google para enviar arquivos'); return; }
  const center = screenPt ? toWorld(screenPt.x, screenPt.y) : toWorld(innerWidth / 2, innerHeight / 2);
  let offset = 0;
  for (const file of files) {
    const isImage = /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml|avif)$/.test(file.type);
    let w = 260, h = 72, info = null;
    if (isImage) {
      info = await imageSize(file);
      if (info) { const sc = Math.min(1, 400 / Math.max(info.w, info.h)); w = Math.max(20, info.w * sc); h = Math.max(20, info.h * sc); }
    }
    const el = {
      id: uid(), type: 'file', x: center.x - w / 2, y: center.y - h / 2 + offset, w, h,
      fileId: null, name: file.name || 'arquivo', mimeType: file.type || 'application/octet-stream', size: file.size,
      webViewLink: null, isImage: !!(isImage && info), uploading: true,
      stroke: style.stroke, fill: style.fill, fillOn: false, width: 1
    };
    offset += h + 20;
    pushHistory(); elements.push(el); render();
    uploadsActive++;
    try {
      const parent = await ensureFilesFolder();
      const res = await resumableUpload(file, parent, p => setStatus('saving', `Enviando ${el.name} ${Math.round(p * 100)}%`));
      el.fileId = res.id; el.webViewLink = res.webViewLink || null; el.mimeType = res.mimeType || el.mimeType; el.size = +res.size || el.size;
      if (el.isImage && info) imgCache.set(res.id, { img: info.img, status: 'ok' });
      delete el.uploading;
      // atualiza também os snapshots de desfazer que contêm este elemento
      undoStack = undoStack.map(sn => sn.includes(el.id) ? JSON.stringify(JSON.parse(sn).map(e => e.id === el.id ? { ...el } : e)) : sn);
      setStatus('saved', 'Enviado: ' + el.name);
      changed();
    } catch (e) {
      console.error(e);
      elements = elements.filter(x => x !== el); undoStack.pop();
      setStatus('error', 'Erro ao enviar ' + el.name);
      render();
    } finally { uploadsActive--; }
  }
}

// Exporta o quadro inteiro como PNG (fundo branco + margem)
async function renderBoardPng() {
  const list = elements.filter(e => !e.uploading);
  if (!list.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const el of list) {
    const b = bounds(el), m = (el.width || 1) / 2;
    x1 = Math.min(x1, b.x1 - m); y1 = Math.min(y1, b.y1 - m); x2 = Math.max(x2, b.x2 + m); y2 = Math.max(y2, b.y2 + m);
  }
  const pad = 40, W = x2 - x1 + 2 * pad, H = y2 - y1 + 2 * pad;
  const scale = Math.min(2, 4096 / Math.max(W, H));
  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.round(W * scale)); off.height = Math.max(1, Math.round(H * scale));
  const octx = off.getContext('2d');
  octx.fillStyle = '#fff'; octx.fillRect(0, 0, off.width, off.height);
  octx.setTransform(scale, 0, 0, scale, (pad - x1) * scale, (pad - y1) * scale);
  const saved = ctx; ctx = octx;
  try { for (const el of list) drawEl(el); } finally { ctx = saved; }
  return new Promise(res => off.toBlob(res, 'image/png'));
}
async function uploadBoardPng() {
  const pendingImgs = elements.some(e => e.type === 'file' && e.isImage && !(imgCache.get(e.fileId) || {}).img);
  const key = JSON.stringify(elements);
  if (key === lastPngKey && !pendingImgs) return;
  const blob = await renderBoardPng();
  if (!blob) return;
  if (!folderId) folderId = await findOrCreateFolder();
  if (!pngFileId) pngFileId = await findOrCreate(PNG_NAME, folderId);
  if (!pngFileId) {
    const boundary = 'qmpng' + Date.now();
    const meta = JSON.stringify({ name: PNG_NAME, mimeType: 'image/png', parents: [folderId] });
    const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: image/png\r\n\r\n`, blob, `\r\n--${boundary}--`]);
    const r = await (await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body
    })).json();
    pngFileId = r.id;
  } else {
    await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${pngFileId}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': 'image/png' }, body: blob
    });
  }
  if (!pendingImgs) lastPngKey = key;
}

// Botão "Arquivo", arrastar-e-soltar e colar
const fileInput = document.getElementById('fileInput');
document.getElementById('fileBtn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { uploadFiles(fileInput.files); fileInput.value = ''; });
window.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
window.addEventListener('drop', e => {
  e.preventDefault();
  if (e.dataTransfer && e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files, { x: e.clientX, y: e.clientY });
});
let lastPointer = null;
window.addEventListener('pointermove', e => { lastPointer = { x: e.clientX, y: e.clientY }; });
window.addEventListener('paste', e => {
  if (editing) return;
  const files = e.clipboardData ? [...e.clipboardData.files] : [];
  if (files.length) { e.preventDefault(); uploadFiles(files, lastPointer); }
});

// ===== Início =====
window.addEventListener('resize', resize);
try { loadState(JSON.parse(localStorage.getItem(LS_KEY) || 'null')); } catch (e) {}
setTool('pen'); resize(); initGis(); autoLogin();
if (location.protocol === 'file:') setStatus('error', 'Abra via http://localhost:8000');
// Exposto para testes automatizados
window.__quadrado = { get elements() { return elements; }, get view() { return view; }, undo, redo, saveNow, setTool, setToken: (t) => { accessToken = t; tokenExpiry = Date.now() + 3600e3; } };
