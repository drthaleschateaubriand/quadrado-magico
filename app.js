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
let multiSel = []; // ids extras selecionados (Shift+arrastar)
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
    raf = 0; updateOpenBtn();
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    drawGrid();
    ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.x, dpr * view.y);
    for (const el of elements) drawEl(el);
    if (current) drawEl(current);
    for (const sel of selectedEls()) {
      const b = bounds(sel), m = 6 / view.zoom, h = 9 / view.zoom;
      ctx.save(); ctx.setLineDash([6 / view.zoom, 4 / view.zoom]); ctx.strokeStyle = '#4dabf7'; ctx.lineWidth = 1.5 / view.zoom;
      const X1 = b.x1 - m, Y1 = b.y1 - m, X2 = b.x2 + m, Y2 = b.y2 + m;
      ctx.strokeRect(X1, Y1, X2 - X1, Y2 - Y1);
      ctx.setLineDash([]); ctx.fillStyle = '#fff';
      const corners = sel.type === 'file' ? [[b.x2, b.y2]] : [[X1, Y1], [X2, Y1], [X1, Y2], [X2, Y2]];
      for (const [cx, cy] of corners) { ctx.fillRect(cx - h / 2, cy - h / 2, h, h); ctx.strokeRect(cx - h / 2, cy - h / 2, h, h); }
      ctx.restore();
    }
    if (drag && drag.kind === 'band') {
      const x = Math.min(drag.a.x, drag.b.x), y = Math.min(drag.a.y, drag.b.y);
      ctx.save(); ctx.fillStyle = 'rgba(77,171,247,.1)'; ctx.strokeStyle = '#4dabf7'; ctx.lineWidth = 1 / view.zoom;
      ctx.fillRect(x, y, Math.abs(drag.b.x - drag.a.x), Math.abs(drag.b.y - drag.a.y)); ctx.strokeRect(x, y, Math.abs(drag.b.x - drag.a.x), Math.abs(drag.b.y - drag.a.y)); ctx.restore();
    }
    if (window.QMInline) QMInline.sync(elements, view, { interactive: tool === 'select' && !spaceDown && !drag, selected: new Set(selectedEls().map(e => e.id)) });
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
const topHit = (x, y, px = 6) => { for (let i = elements.length - 1; i >= 0; i--) if (hit(elements[i], x, y, px / view.zoom)) return elements[i]; return null; };
function selectedEls() { const ids = new Set([selectedId, ...multiSel]); return elements.filter(e => ids.has(e.id)); }
// Ferramenta de seleção: elemento sob o dedo/mouse (tolerância maior no toque; a caixa de um já selecionado também conta)
function pickAt(w, pointerType) {
  const px = pointerType === 'mouse' ? 6 : 14;
  for (const el of selectedEls()) { const b = bounds(el), m = px / view.zoom; if (w.x >= b.x1 - m && w.x <= b.x2 + m && w.y >= b.y1 - m && w.y <= b.y2 + m) return el; }
  return topHit(w.x, w.y, px);
}

// ===== Histórico =====
const snapshot = () => JSON.stringify(elements);
function pushHistory() { undoStack.push(snapshot()); if (undoStack.length > 200) undoStack.shift(); redoStack = []; }
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); elements = JSON.parse(undoStack.pop()); selectedId = null; multiSel = []; reconcileTrash(); changed(); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); elements = JSON.parse(redoStack.pop()); selectedId = null; multiSel = []; changed(); }
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
    if (drag && (drag.kind === 'move' || drag.kind === 'resize') && drag.moved) { elements = JSON.parse(undoStack.pop()); } // desfaz o arrasto parcial
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
      const cur = elements.find(x => x.id === selectedId), hs = (e.pointerType === 'mouse' ? 12 : 20) / view.zoom;
      if (cur && cur.type === 'file' && Math.abs(w.x - (cur.x + cur.w)) < hs && Math.abs(w.y - (cur.y + cur.h)) < hs) {
        drag = { kind: 'resize', el: cur, moved: false, ratio: cur.isImage ? cur.h / cur.w : 0 }; break;
      }
      const t = pickAt(w, e.pointerType);
      if (!t) {
        if (e.shiftKey) { drag = { kind: 'band', a: w, b: w }; break; } // Shift+arrastar no vazio: seleção múltipla
        selectedId = null; multiSel = [];
        drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; // arrastar no vazio: move a tela
        canvas.style.cursor = 'grabbing'; break;
      }
      const inGroup = selectedEls().length > 1 && selectedEls().includes(t);
      if (e.shiftKey && !inGroup) { if (selectedId && selectedId !== t.id) multiSel.push(selectedId); selectedId = t.id; }
      else if (!inGroup) { selectedId = t.id; multiSel = []; }
      if (t.type === 'file' && e.pointerType !== 'mouse') { // duplo toque (iPad) abre o visualizador
        const now = Date.now();
        if (lastTap.id === t.id && now - lastTap.t < 400) { openFileEl(t); lastTap = {}; render(); break; }
        lastTap = { id: t.id, t: now };
      }
      drag = { kind: 'move', els: inGroup || (e.shiftKey && multiSel.length) ? selectedEls() : [t], last: w, moved: false };
      render(); break;
    }
  }
  render();
});

function eraseAt(w) {
  const t = topHit(w.x, w.y);
  if (t && t.type === 'file') { setStatus('off', 'Para excluir arquivos use 🗑️ (vão para a Lixeira)'); return; }
  if (t) {
    if (!drag.erased) { pushHistory(); drag.erased = true; }
    elements = elements.filter(e => e !== t); if (selectedId === t.id) selectedId = null; render();
  }
}

canvas.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) {
    if (tool === 'select' && e.pointerType === 'mouse' && !spaceDown) canvas.style.cursor = pickAt(toWorld(e.clientX, e.clientY), 'mouse') ? 'move' : 'grab';
    return;
  }
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
    if (drag.ratio) { drag.el.w = Math.max(20, w.x - drag.el.x); drag.el.h = drag.el.w * drag.ratio; }
    else { drag.el.w = Math.max(200, w.x - drag.el.x); drag.el.h = Math.max(120, w.y - drag.el.y); }
    render(); return;
  }
  if (drag && drag.kind === 'move') {
    if (!drag.moved) { pushHistory(); drag.moved = true; }
    for (const el of drag.els) moveEl(el, w.x - drag.last.x, w.y - drag.last.y);
    drag.last = w; render(); return;
  }
  if (drag && drag.kind === 'band') { drag.b = w; render(); return; }
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
    if (drag.kind === 'pan') { scheduleSave(false); if (tool === 'select') canvas.style.cursor = 'default'; }
    if (drag.kind === 'band') {
      const x1 = Math.min(drag.a.x, drag.b.x), x2 = Math.max(drag.a.x, drag.b.x), y1 = Math.min(drag.a.y, drag.b.y), y2 = Math.max(drag.a.y, drag.b.y);
      const ids = elements.filter(el => { const b = bounds(el); return b.x1 <= x2 && b.x2 >= x1 && b.y1 <= y2 && b.y2 >= y1; }).map(el => el.id);
      selectedId = ids.pop() || null; multiSel = ids; render();
    }
    drag = null;
  }
}
canvas.addEventListener('mousedown', e => e.preventDefault()); // mantém o foco no editor de texto
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('wheel', onWheel, { passive: false });
function onWheel(e) {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01)); // pinça do trackpad
  else if (e.shiftKey && !e.deltaX) { view.x -= e.deltaY; render(); scheduleSave(false); }
  else if (Math.abs(e.deltaX) > 0 || e.deltaMode === 0 && Math.abs(e.deltaY) < 50 && !Number.isInteger(e.deltaY)) { view.x -= e.deltaX; view.y -= e.deltaY; render(); scheduleSave(false); } // rolagem de trackpad = pan
  else zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
}
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
  if (QMViewer.isDataUrl(text)) {
    if (ed.backup) { delete ed.backup._hidden; elements.push(ed.backup); }
    addDataUrl(text, null);
    render(); return;
  }
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
  tool = t; if (t !== 'select') { selectedId = null; multiSel = []; }
  document.querySelectorAll('#toolbar button[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  canvas.style.cursor = { hand: 'grab', select: 'default', text: 'text', eraser: 'cell' }[t] || 'crosshair';
  render();
}
document.querySelectorAll('#toolbar button[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
const $ = id => document.getElementById(id);
// ===== Painel de opções (rebatível) =====
(function () {
  const btn = $('optsBtn'), pnl = $('stylebar');
  function setOpen(o) {
    pnl.classList.toggle('hidden', !o); btn.classList.toggle('open', o); btn.setAttribute('aria-expanded', o);
    try { localStorage.setItem('qm-opts-open', o ? '1' : '0'); } catch (e) {}
  }
  let init = false; try { init = localStorage.getItem('qm-opts-open') === '1'; } catch (e) {}
  setOpen(init);
  btn.addEventListener('click', e => { e.stopPropagation(); setOpen(pnl.classList.contains('hidden')); });
  document.addEventListener('pointerdown', e => { if (!pnl.classList.contains('hidden') && !pnl.contains(e.target) && e.target !== btn) setOpen(false); }, true);
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && !pnl.classList.contains('hidden')) setOpen(false); });
  window.QMOpts = { setOpen };
})();
function applyStyleToSelection(fn) {
  const el = elements.find(e => e.id === selectedId); if (!el) return;
  pushHistory(); fn(el); changed();
}
$('strokeColor').addEventListener('change', e => { style.stroke = e.target.value; applyStyleToSelection(el => el.stroke = style.stroke); });
$('fillColor').addEventListener('change', e => { style.fill = e.target.value; applyStyleToSelection(el => el.fill = style.fill); });
$('fillOn').addEventListener('change', e => { style.fillOn = e.target.checked; applyStyleToSelection(el => el.fillOn = style.fillOn); });
$('strokeWidth').addEventListener('change', e => { style.width = +e.target.value; applyStyleToSelection(el => el.width = style.width); });
document.querySelectorAll('#stylebar input').forEach(i => i.addEventListener('change', () => i.blur()));
$('openBtn').onclick = () => openFileEl(selectedFile()); $('undoBtn').onclick = undo; $('redoBtn').onclick = redo; $('deleteBtn').onclick = () => selectedEls().length ? deleteSelected() : clearBoard();
$('zoomIn').onclick = () => zoomAt(innerWidth / 2, innerHeight / 2, 1.2);
$('zoomOut').onclick = () => zoomAt(innerWidth / 2, innerHeight / 2, 1 / 1.2);
$('zoomReset').onclick = () => { view = { x: 0, y: 0, zoom: 1 }; render(); scheduleSave(false); };

window.addEventListener('keydown', e => {
  if (editing || e.target.tagName === 'INPUT' || dialogOpen() || trashOpen() || QMViewer.isOpen && QMViewer.isOpen() || e.target.closest && e.target.closest('.qm-card,#viewer')) return;
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

// ===== Persistência (abas: cada aba é um quadro separado) =====
const TABS_KEY = 'qm-tabs', BOARD_PREFIX = 'qm-board-';
const INDEX_NAME = 'quadrado-magico-indice.json', TRASH_FOLDER = 'Lixeira', FOLDER_MIME = 'application/vnd.google-apps.folder';
let tabsState = { tabs: [], activeId: null, trash: [], indexUpdatedAt: '' };
let boardSavedAt = null; // momento da última edição do quadro ativo (usado no "última gravação vence")
const activeTab = () => tabsState.tabs.find(t => t.id === tabsState.activeId) || tabsState.tabs[0];
const tabById = id => tabsState.tabs.find(t => t.id === id);
function saveTabsLocal() { try { localStorage.setItem(TABS_KEY, JSON.stringify(tabsState)); } catch (e) { console.warn(e); } }
function readBoardLocal(id) { try { const d = JSON.parse(localStorage.getItem(BOARD_PREFIX + id) || 'null'); return d && Array.isArray(d.elements) ? d : null; } catch (e) { return null; } }
function writeBoardLocal(id, data) { try { localStorage.setItem(BOARD_PREFIX + id, JSON.stringify(data)); } catch (e) { console.warn(e); } }
function loadTabsLocal() {
  let st = null; try { st = JSON.parse(localStorage.getItem(TABS_KEY) || 'null'); } catch (e) {}
  if (st && Array.isArray(st.tabs) && st.tabs.length) { tabsState = { trash: [], indexUpdatedAt: '', ...st }; if (!tabById(tabsState.activeId)) tabsState.activeId = tabsState.tabs[0].id; return; }
  // Migração: o quadro único antigo vira a aba "Quadro 1"
  const id = uid(); let legacy = null; try { legacy = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) {}
  tabsState = { tabs: [{ id, name: 'Quadro 1', legacy: true }], activeId: id, trash: (st && st.trash) || [], indexUpdatedAt: '' };
  if (legacy && Array.isArray(legacy.elements)) writeBoardLocal(id, legacy);
  saveTabsLocal();
}
function serialize() {
  const t = activeTab();
  return { app: 'quadrado-magico', version: 2, tabId: t && t.id, name: t && t.name, savedAt: boardSavedAt || new Date().toISOString(), viewport: { ...view }, elements };
}
function loadState(data) {
  if (!data || !Array.isArray(data.elements)) return false;
  elements = data.elements.filter(e => !e.uploading); view = data.viewport ? { x: 0, y: 0, zoom: 1, ...data.viewport } : { x: 0, y: 0, zoom: 1 };
  boardSavedAt = data.savedAt || null;
  undoStack = []; redoStack = []; selectedId = null; multiSel = [];
  if (migrateDataUrlTexts()) { saveLocal(); setTimeout(uploadInlineFiles, 0); }
  upgradeCards();
  render(); return true;
}
function saveLocal() { const t = activeTab(); if (t) writeBoardLocal(t.id, serialize()); saveTabsLocal(); }
function changed() { render(); scheduleSave(true); }

let saveTimer = null, dirty = false;
function scheduleSave(contentChanged) {
  boardSavedAt = new Date().toISOString();
  saveLocal();
  dirty = true;
  if (!accessToken) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
}
function setStatus(kind, text) { const s = $('status'); s.className = 'st-' + kind; s.textContent = text; }
const hhmm = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

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
const API = 'https://www.googleapis.com/drive/v3/files';
const connected = () => !!(accessToken || tokenExpiry);
let driveQ = Promise.resolve();
// Todas as operações no Drive passam por esta fila (uma de cada vez, na ordem).
function enqueue(fn) {
  const p = driveQ.then(() => connected() ? fn() : null).catch(e => { console.error(e); setStatus('error', 'Erro ao sincronizar'); });
  driveQ = p; return p;
}
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
async function driveJson(url, opts) { const r = await driveFetch(url, opts); const t = await r.text(); try { return t ? JSON.parse(t) : {}; } catch (e) { return {}; } }
async function findOrCreateFolder() {
  const query = `name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`;
  const r = await driveJson(`${API}?q=${q(query)}&fields=files(id,name,appProperties)&spaces=drive`);
  if (r.files) r.files = r.files.filter(f => !(f.appProperties && (f.appProperties.qmTab || f.appProperties.qmTrash)));
  // a pasta principal é a que fica fora das outras pastas do app
  if (r.files && r.files.length) return r.files[0].id;
  return createFolder(FOLDER_NAME, null);
}
async function createFolder(name, parent, appProperties) {
  const meta = { name, mimeType: FOLDER_MIME }; if (parent) meta.parents = [parent]; if (appProperties) meta.appProperties = appProperties;
  const c = await driveJson(`${API}?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) });
  if (!c.id) throw new Error('Drive não criou a pasta ' + name);
  return c.id;
}
async function listChildren(parent) {
  const query = `'${parent}' in parents and trashed=false`;
  const r = await driveJson(`${API}?q=${q(query)}&fields=files(id,name,mimeType,modifiedTime,appProperties)&pageSize=1000`);
  return (r.files || []).filter(f => f && f.id);
}
async function findOrCreate(name, parent, mime) {
  const query = `name='${esc(name)}' and '${parent}' in parents and trashed=false` + (mime ? ` and mimeType='${mime}'` : '');
  const r = await driveJson(`${API}?q=${q(query)}&fields=files(id,modifiedTime)`);
  return r.files && r.files.length ? r.files[0].id : null;
}
async function getMeta(id, fields) { return driveJson(`${API}/${id}?fields=${fields}`); }
// Move com files.update addParents/removeParents
async function moveFile(id, toParent, fromParents) {
  if (!fromParents) { const m = await getMeta(id, 'parents'); fromParents = (m.parents || []).join(','); }
  return driveJson(`${API}/${id}?addParents=${q(toParent)}${fromParents ? '&removeParents=' + q(fromParents) : ''}&fields=id,parents`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
}
async function trashDrive(id) {
  return driveJson(`${API}/${id}?fields=id,trashed`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
}
async function renameDrive(id, name) {
  return driveJson(`${API}/${id}?fields=id,name`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
}
async function createJsonFile(name, parent, json) {
  const boundary = 'qm' + Date.now();
  const meta = { name, mimeType: 'application/json', parents: [parent] };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
  return driveJson('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime', {
    method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body });
}
async function updateJsonFile(id, json) {
  return driveJson(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media&fields=id,modifiedTime`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: json });
}
async function readJson(id) { const d = await driveJson(`${API}/${id}?alt=media`); return d; }
let trashFolderId = null, indexFileId = null;
async function ensureRoot() { if (!folderId) folderId = await findOrCreateFolder(); return folderId; }
async function ensureTrashFolder() {
  await ensureRoot();
  if (!trashFolderId) trashFolderId = await findOrCreate(TRASH_FOLDER, folderId, FOLDER_MIME) || await createFolder(TRASH_FOLDER, folderId, { qmTrash: '1' });
  return trashFolderId;
}
async function ensureTabFolder(tab) {
  await ensureRoot();
  if (!tab.folderId) { tab.folderId = await createFolder(tab.name, folderId, { qmTab: tab.id }); delete tab.legacy; saveTabsLocal(); }
  return tab.folderId;
}
// Salva o quadro de uma aba no Drive, na pasta da aba. Conflito: vence a edição mais recente (savedAt), conferindo o modifiedTime.
async function saveBoardDrive(tabId, data) {
  const tab = tabById(tabId) || (tabsState.trash.find(x => x.kind === 'tab' && x.tab.id === tabId) || {}).tab;
  if (!tab) return;
  await ensureTabFolder(tab);
  if (!tab.fileId) tab.fileId = await findOrCreate(FILE_NAME, tab.folderId);
  const json = JSON.stringify(data);
  if (tab.fileId) {
    const meta = await getMeta(tab.fileId, 'modifiedTime');
    if (tab.modifiedTime && meta.modifiedTime && meta.modifiedTime !== tab.modifiedTime) {
      const remote = await readJson(tab.fileId);
      if (remote && Array.isArray(remote.elements) && remote.savedAt && data.savedAt && remote.savedAt > data.savedAt) {
        // outro aparelho salvou depois: fica a versão dele
        writeBoardLocal(tab.id, remote); tab.modifiedTime = meta.modifiedTime; saveTabsLocal();
        if (tab.id === tabsState.activeId) loadState(remote);
        setStatus('saved', 'Atualizado de outro aparelho'); return;
      }
    }
    const r = await updateJsonFile(tab.fileId, json); tab.modifiedTime = r.modifiedTime || meta.modifiedTime || tab.modifiedTime;
  } else {
    const r = await createJsonFile(FILE_NAME, tab.folderId, json); tab.fileId = r.id || null; tab.modifiedTime = r.modifiedTime;
  }
  saveTabsLocal();
  if (tab.id === tabsState.activeId) { try { await uploadBoardPng(tab); } catch (e) { console.error('PNG', e); } }
}
// Carrega do Drive o quadro de uma aba (se for mais novo que o local)
async function loadTabFromDrive(tab) {
  if (!tab.folderId) return saveBoardDrive(tab.id, tab.id === tabsState.activeId ? serialize() : (readBoardLocal(tab.id) || emptyBoard()));
  if (!tab.fileId) tab.fileId = await findOrCreate(FILE_NAME, tab.folderId);
  const isActive = () => tab.id === tabsState.activeId;
  const local = isActive() ? serialize() : readBoardLocal(tab.id);
  if (!tab.fileId) return saveBoardDrive(tab.id, local || emptyBoard());
  const meta = await getMeta(tab.fileId, 'modifiedTime');
  const data = await readJson(tab.fileId);
  if (!data || !Array.isArray(data.elements)) return saveBoardDrive(tab.id, local || emptyBoard());
  if (local && local.savedAt && data.savedAt && local.savedAt > data.savedAt) { tab.modifiedTime = meta.modifiedTime; return saveBoardDrive(tab.id, local); }
  tab.modifiedTime = meta.modifiedTime; writeBoardLocal(tab.id, data); saveTabsLocal();
  if (isActive()) { loadState(data); retryImages(); }
}
const emptyBoard = () => ({ app: 'quadrado-magico', version: 2, savedAt: new Date(0).toISOString(), viewport: { x: 0, y: 0, zoom: 1 }, elements: [] });
async function saveIndex() {
  await ensureRoot();
  const data = { app: 'quadrado-magico', kind: 'indice', version: 2, updatedAt: tabsState.indexUpdatedAt || new Date().toISOString(),
    tabs: tabsState.tabs.map(t => ({ id: t.id, name: t.name, folderId: t.folderId || null })), trash: tabsState.trash };
  if (!indexFileId) indexFileId = await findOrCreate(INDEX_NAME, folderId);
  if (indexFileId) await updateJsonFile(indexFileId, JSON.stringify(data));
  else indexFileId = (await createJsonFile(INDEX_NAME, folderId, JSON.stringify(data))).id || null;
}
function touchIndex() { tabsState.indexUpdatedAt = new Date().toISOString(); saveTabsLocal(); renderTabs(); updateTrashBadge(); enqueue(saveIndex); }
// Ao abrir: lê do Drive a lista de pastas das abas (funciona entre iPad e Mac)
async function syncFromDrive() {
  setStatus('saving', 'Carregando…');
  await ensureRoot(); await ensureTrashFolder();
  const kids = await listChildren(folderId);
  const remoteTabs = kids.filter(f => f.mimeType === FOLDER_MIME && f.appProperties && f.appProperties.qmTab);
  const idxFile = kids.find(f => f.name === INDEX_NAME && f.mimeType !== FOLDER_MIME);
  let index = null;
  if (idxFile) { indexFileId = idxFile.id; try { const d = await readJson(idxFile.id); if (d && Array.isArray(d.tabs)) index = d; } catch (e) { console.warn(e); } }
  if (!remoteTabs.length) {
    // Primeira vez com abas: migra o quadro antigo (quadrado-magico.json na pasta principal) para a aba "Quadro 1"
    const legacy = kids.find(f => f.name === FILE_NAME && f.mimeType !== FOLDER_MIME);
    for (const t of tabsState.tabs) { t.folderId = null; t.fileId = null; t.modifiedTime = null; }
    const target = tabsState.tabs.find(t => t.legacy) || tabsState.tabs[0];
    if (legacy) {
      let data = null; try { data = await readJson(legacy.id); } catch (e) { console.warn(e); }
      const isAct = target.id === tabsState.activeId, local = isAct ? serialize() : readBoardLocal(target.id);
      if (data && Array.isArray(data.elements) && (!local || !local.elements.length || !local.savedAt || (data.savedAt || '') >= local.savedAt)) {
        writeBoardLocal(target.id, data); if (isAct) loadState(data);
      }
      await ensureTabFolder(target);
      try { await moveFile(legacy.id, target.folderId, folderId); target.fileId = legacy.id; } catch (e) { console.warn('não moveu o JSON antigo', e); }
      const png = kids.find(f => f.name === PNG_NAME && f.mimeType !== FOLDER_MIME);
      if (png) { try { await moveFile(png.id, target.folderId, folderId); target.pngFileId = png.id; } catch (e) { console.warn(e); } }
      const board = target.id === tabsState.activeId ? serialize() : readBoardLocal(target.id);
      for (const el of (board ? board.elements : []).filter(e => e.type === 'file' && e.fileId)) {
        try { await moveFile(el.fileId, target.folderId); } catch (e) { console.warn('arquivo não movido (sem permissão do app?)', el.name, e); }
      }
    }
    for (const t of tabsState.tabs) await ensureTabFolder(t);
  } else {
    const order = index ? index.tabs.map(t => t.id) : [];
    remoteTabs.sort((a, b) => { const ia = order.indexOf(a.appProperties.qmTab), ib = order.indexOf(b.appProperties.qmTab); return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || a.name.localeCompare(b.name); });
    const merged = [];
    for (const f of remoteTabs) {
      const id = f.appProperties.qmTab, loc = tabById(id);
      merged.push(loc ? Object.assign(loc, { name: f.name, folderId: f.id }) : { id, name: f.name, folderId: f.id });
    }
    for (const t of tabsState.tabs) if (!merged.includes(t) && !t.folderId && !t.legacy) { await ensureTabFolder(t); merged.push(t); } // criadas sem internet
    const oldActive = tabsState.activeId;
    tabsState.tabs = merged;
    if (index && (index.updatedAt || '') > (tabsState.indexUpdatedAt || '')) { tabsState.trash = Array.isArray(index.trash) ? index.trash : []; tabsState.indexUpdatedAt = index.updatedAt; }
    if (!tabById(tabsState.activeId)) tabsState.activeId = merged[0].id;
    if (tabsState.activeId !== oldActive) loadState(readBoardLocal(tabsState.activeId) || emptyBoard());
  }
  saveTabsLocal(); renderTabs(); updateTrashBadge();
  await loadTabFromDrive(activeTab());
  await saveIndex();
  dirty = false;
  setStatus('saved', 'Salvo ' + hhmm());
}
async function saveNow() {
  clearTimeout(saveTimer);
  saveLocal();
  if (!connected()) { setStatus('off', 'Salvo neste aparelho (sem Google)'); return; }
  const tab = activeTab(), data = serialize();
  setStatus('saving', 'Salvando…');
  return enqueue(async () => { await saveBoardDrive(tab.id, data); if (tab.id === tabsState.activeId) dirty = false; setStatus('saved', 'Salvo ' + hhmm()); });
}
function showConnected(on) {
  $('loginBtn').classList.toggle('hidden', on); $('logoutBtn').classList.toggle('hidden', !on);
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
  try { await enqueue(syncFromDrive); } catch (e) { console.error(e); setStatus('error', 'Erro ao carregar'); }
  retryImages(); render();
  uploadInlineFiles();
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
  accessToken = null; tokenExpiry = 0; folderId = fileId = null; trashFolderId = indexFileId = null; lastPngKey = ''; userEmail = '';
  localStorage.removeItem('quadrado-magico-logged'); localStorage.removeItem(TOKEN_KEY);
  $('loginBtn').classList.remove('hidden'); $('logoutBtn').classList.add('hidden');
  setStatus('off', 'Não conectado');
}
$('loginBtn').onclick = login; $('logoutBtn').onclick = logout; $('saveBtn').onclick = saveNow;
window.addEventListener('beforeunload', e => { saveLocal(); if (dirty && accessToken) { e.preventDefault(); e.returnValue = ''; } });

// ===== Arquivos (qualquer tipo) e imagens no quadro =====
const PNG_NAME = 'quadrado-magico.png';
const imgCache = new Map(); // fileId -> { img, status }
let lastPngKey = '';

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
  ctx.textBaseline = 'middle'; ctx.font = '600 14px sans-serif'; ctx.fillStyle = '#212529';
  let name = fileIcon(el.mimeType || '', el.name) + ' ' + el.name; const maxW = el.w - 20;
  while (ctx.measureText(name).width > maxW && name.length > 4) name = name.slice(0, -4) + '…';
  ctx.fillText(name, el.x + 10, el.y + 16);
  ctx.font = '12px sans-serif'; ctx.fillStyle = '#868e96';
  ctx.fillText(el.uploading ? 'Enviando…' : fmtSize(el.size), el.x + 10, el.y + el.h / 2);
  ctx.restore();
}
// Abre o arquivo DENTRO do app (visualizador), nunca no Google Drive.
const hasToken = () => !!(accessToken && Date.now() < tokenExpiry);
const refreshToken = async () => { accessToken = null; tokenExpiry = 0; clearStoredToken(true); await requestToken('', 15000); };
async function getTokenNoPopup() { if (hasToken()) return accessToken; const e = new Error('Conecte o Google para ver este arquivo (botão "Entrar com Google").'); e.needLogin = true; throw e; }
function openFileEl(el) {
  if (!el || el.type !== 'file') return;
  const needDrive = el.fileId && !QMViewer.cache.has(el.fileId);
  const opts = { getToken: getTokenNoPopup, refresh: refreshToken, login: async () => { await login(); } };
  if (needDrive && !hasToken() && tokenClient) { // ainda no gesto do usuário: pede o login antes de abrir
    const p = login().then(() => QMViewer.open(el, opts)); return p;
  }
  return QMViewer.open(el, opts);
}
// Tamanho padrão dos cartões de arquivo com pré-visualização
function defaultCardSize(mime, name) {
  const k = QMViewer.detectKind(mime, name);
  if (k === 'audio') return { w: 380, h: 170 };
  if (k === 'other') return { w: 300, h: 150 };
  return { w: 480, h: 360 };
}
function upgradeCards() {
  for (const e of elements) if (e.type === 'file' && !e.isImage && e.w === 260 && e.h === 72) Object.assign(e, defaultCardSize(e.mimeType, e.name));
}
function selectedFile() { const t = selectedId && elements.find(e => e.id === selectedId); return t && t.type === 'file' && !multiSel.length ? t : null; }
function updateOpenBtn() { const b = document.getElementById('openBtn'); if (b) b.classList.toggle('hidden', !selectedFile()); }
// Textos "data:...;base64" viram arquivos (cartões) — corrige o bug do texto gigante no quadro.
function dataUrlToFile(text) { const d = QMViewer.dataUrlToBlob(text); return new File([d.blob], d.name, { type: d.mime }); }
function migrateDataUrlTexts() {
  let n = 0;
  elements = elements.map(e => {
    if (e.type !== 'text' || !QMViewer.isDataUrl(e.text)) return e;
    n++;
    let d; try { d = QMViewer.dataUrlToBlob(e.text); } catch (err) { return e; }
    return { id: e.id, type: 'file', x: e.x, y: e.y, ...defaultCardSize(d.mime, d.name), fileId: null, name: d.name, mimeType: d.mime, size: d.blob.size,
      webViewLink: null, isImage: false, dataUrl: e.text.trim(), stroke: e.stroke, fill: e.fill, fillOn: false, width: 1 };
  });
  return n;
}
function addDataUrl(text, screenPt) {
  let f; try { f = dataUrlToFile(text); } catch (e) { setStatus('error', 'Conteúdo inválido'); return; }
  if (accessToken || tokenExpiry) return uploadFiles([f], screenPt);
  const c = screenPt ? toWorld(screenPt.x, screenPt.y) : toWorld(innerWidth / 2, innerHeight / 2);
  pushHistory(); const sz = defaultCardSize(f.type, f.name);
  elements.push({ id: uid(), type: 'file', x: c.x - sz.w / 2, y: c.y - sz.h / 2, ...sz, fileId: null, name: f.name, mimeType: f.type, size: f.size,
    webViewLink: null, isImage: false, dataUrl: text.trim(), stroke: style.stroke, fill: style.fill, fillOn: false, width: 1 });
  changed();
}
// Envia ao Drive os cartões que ainda guardam o conteúdo embutido (dataUrl).
let inlineUploading = false;
async function uploadInlineFiles() {
  if (inlineUploading || !accessToken) return; inlineUploading = true;
  try {
    for (const el of elements.filter(e => e.type === 'file' && e.dataUrl && !e.fileId)) {
      try {
        const parent = await enqueue(() => ensureTabFolder(activeTab())); if (!parent) continue;
        const blob = dataUrlToFile(el.dataUrl), res = await resumableUpload(blob, parent, () => {});
        QMViewer.cache.set(res.id, blob); el.fileId = res.id; el.webViewLink = res.webViewLink || null; el.mimeType = res.mimeType || el.mimeType; delete el.dataUrl;
        changed();
      } catch (e) { console.error(e); }
    }
  } finally { inlineUploading = false; }
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
  let offset = 0; const upTab = activeTab();
  for (const file of files) {
    const isImage = /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml|avif)$/.test(file.type);
    let { w, h } = defaultCardSize(file.type, file.name), info = null;
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
      const parent = await enqueue(() => ensureTabFolder(upTab));
      if (!parent) throw new Error('Pasta da aba indisponível');
      const res = await resumableUpload(file, parent, p => setStatus('saving', `Enviando ${el.name} ${Math.round(p * 100)}%`));
      QMViewer.cache.set(res.id, file); el.fileId = res.id; el.webViewLink = res.webViewLink || null; el.mimeType = res.mimeType || el.mimeType; el.size = +res.size || el.size;
      if (el.isImage && info) imgCache.set(res.id, { img: info.img, status: 'ok' });
      delete el.uploading;
      // atualiza também os snapshots de desfazer que contêm este elemento
      undoStack = undoStack.map(sn => sn.includes(el.id) ? JSON.stringify(JSON.parse(sn).map(e => e.id === el.id ? { ...el } : e)) : sn);
      setStatus('saved', 'Enviado: ' + el.name);
      setTool('select'); selectedId = el.id; multiSel = [];
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
async function uploadBoardPng(tab) {
  const pendingImgs = elements.some(e => e.type === 'file' && e.isImage && !(imgCache.get(e.fileId) || {}).img);
  const key = tab.id + JSON.stringify(elements);
  if (key === lastPngKey && !pendingImgs) return;
  const blob = await renderBoardPng();
  if (!blob) return;
  await ensureTabFolder(tab);
  if (!tab.pngFileId) tab.pngFileId = await findOrCreate(PNG_NAME, tab.folderId);
  if (!tab.pngFileId) {
    const boundary = 'qmpng' + Date.now();
    const meta = JSON.stringify({ name: PNG_NAME, mimeType: 'image/png', parents: [tab.folderId] });
    const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: image/png\r\n\r\n`, blob, `\r\n--${boundary}--`]);
    const r = await driveJson('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body
    });
    tab.pngFileId = r.id || null; saveTabsLocal();
  } else {
    await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${tab.pngFileId}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': 'image/png' }, body: blob
    });
  }
  if (!pendingImgs) lastPngKey = key;
}

// Botão "Arquivo", arrastar-e-soltar e colar
const fileInput = document.getElementById('fileInput');
fileInput.addEventListener('change', () => { uploadFiles(fileInput.files); fileInput.value = ''; });
window.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
window.addEventListener('drop', e => {
  e.preventDefault();
  if (e.dataTransfer && e.dataTransfer.files.length) { uploadFiles(e.dataTransfer.files, { x: e.clientX, y: e.clientY }); return; }
  const txt = e.dataTransfer && (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain'));
  if (QMViewer.isDataUrl(txt)) { addDataUrl(txt, { x: e.clientX, y: e.clientY }); }
});
let lastPointer = null;
window.addEventListener('pointermove', e => { lastPointer = { x: e.clientX, y: e.clientY }; });
window.addEventListener('paste', e => {
  if (editing) return;
  const files = e.clipboardData ? [...e.clipboardData.files] : [];
  if (files.length) { e.preventDefault(); uploadFiles(files, lastPointer); return; }
  const txt = e.clipboardData && e.clipboardData.getData('text/plain');
  if (QMViewer.isDataUrl(txt)) { e.preventDefault(); addDataUrl(txt, lastPointer); }
});

// ===== Início =====
window.addEventListener('resize', resize);
// ===== Diálogos (confirmação / nome) =====
const dlg = $('qmDialog');
let dlgResolve = null;
function qmDialog({ title = '', message = '', input = false, value = '', okText = 'OK', danger = false }) {
  if (dlgResolve) dlgResolve(null);
  dlg.querySelector('.dlg-title').textContent = title;
  dlg.querySelector('.dlg-msg').textContent = message; dlg.querySelector('.dlg-msg').classList.toggle('hidden', !message);
  const inp = dlg.querySelector('.dlg-input'); inp.classList.toggle('hidden', !input); inp.value = value;
  const ok = dlg.querySelector('.dlg-ok'); ok.textContent = okText; ok.classList.toggle('danger', danger);
  dlg.classList.remove('hidden');
  setTimeout(() => { if (input) { inp.focus(); inp.select(); } else ok.focus(); }, 30);
  return new Promise(res => { dlgResolve = v => { dlgResolve = null; dlg.classList.add('hidden'); res(v); }; });
}
const dialogOpen = () => !dlg.classList.contains('hidden');
function dlgOk() { if (!dlgResolve) return; const inp = dlg.querySelector('.dlg-input'); dlgResolve(inp.classList.contains('hidden') ? true : inp.value.trim() || null); }
dlg.querySelector('.dlg-ok').onclick = dlgOk;
dlg.querySelector('.dlg-cancel').onclick = () => dlgResolve && dlgResolve(null);
dlg.addEventListener('pointerdown', e => { if (e.target === dlg && dlgResolve) dlgResolve(null); });
window.addEventListener('keydown', e => { if (!dialogOpen()) return; e.stopPropagation(); if (e.key === 'Escape') dlgResolve && dlgResolve(null); if (e.key === 'Enter') { e.preventDefault(); dlgOk(); } }, true);
const confirmDelete = (name, extra) => qmDialog({ title: `Deseja excluir "${name}"?`, message: extra || 'Ele irá para a Lixeira, de onde pode ser restaurado.', okText: 'Excluir', danger: true });

// ===== Abas =====
function renderTabs() {
  const list = $('tabList'); list.innerHTML = '';
  for (const t of tabsState.tabs) {
    const d = document.createElement('div'); d.className = 'tab' + (t.id === tabsState.activeId ? ' active' : ''); d.dataset.id = t.id; d.title = t.name + ' — duplo clique para renomear';
    d.innerHTML = '<span class="tab-name"></span><button class="tab-menu" title="Opções da aba">⋮</button>';
    d.querySelector('.tab-name').textContent = t.name;
    d.addEventListener('click', e => { if (!e.target.closest('.tab-menu')) switchTab(t.id); });
    d.addEventListener('dblclick', e => { e.preventDefault(); renameTab(t.id); });
    d.addEventListener('contextmenu', e => { e.preventDefault(); openTabMenu(t.id, d); });
    d.querySelector('.tab-menu').addEventListener('click', e => { e.stopPropagation(); openTabMenu(t.id, d); });
    let lp = null; // toque longo (iPad) abre o menu
    d.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') lp = setTimeout(() => { lp = 'done'; openTabMenu(t.id, d); }, 550); });
    const cancel = () => { if (lp && lp !== 'done') clearTimeout(lp); lp = null; };
    d.addEventListener('pointerup', cancel); d.addEventListener('pointercancel', cancel); d.addEventListener('pointerleave', cancel);
    list.appendChild(d);
  }
  layoutTabbar();
  const a = list.querySelector('.tab.active'); if (a && a.scrollIntoView) a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
// Barra de abas no canto superior esquerdo, sem sobrepor a barra central
function layoutTabbar() {
  const tb = $('toolbar'), bar = $('tabbar'); if (!tb || !bar) return;
  const space = tb.getBoundingClientRect().left - 10 - 10;
  const below = space < 150; bar.classList.toggle('below', below);
  bar.style.setProperty('--tabmax', (below ? Math.min(innerWidth - 20, 420) : space) + 'px');
}
addEventListener('resize', layoutTabbar); setTimeout(layoutTabbar, 0);
let menuTab = null;
function openTabMenu(id, anchor) {
  menuTab = id; const m = $('tabMenu'), r = anchor.getBoundingClientRect();
  m.classList.remove('hidden'); m.style.left = Math.min(r.left, innerWidth - 180) + 'px'; m.style.top = (r.bottom + 4) + 'px';
}
const closeTabMenu = () => $('tabMenu').classList.add('hidden');
document.addEventListener('pointerdown', e => { if (!$('tabMenu').contains(e.target) && !e.target.closest('.tab-menu')) closeTabMenu(); }, true);
$('tabMenu').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; closeTabMenu();
  const id = menuTab;
  if (b.dataset.act === 'rename') renameTab(id);
  if (b.dataset.act === 'save') { if (id !== tabsState.activeId) switchTab(id); saveNow(); }
  if (b.dataset.act === 'delete') deleteTab(id);
});
function switchTab(id) {
  if (id === tabsState.activeId || !tabById(id)) return;
  if (uploadsActive) { setStatus('saving', 'Aguarde o envio do arquivo terminar'); return; }
  commitText();
  const prev = tabById(tabsState.activeId);
  if (prev) { saveLocal(); if (dirty && connected()) { const data = serialize(); enqueue(() => saveBoardDrive(prev.id, data)); } }
  clearTimeout(saveTimer); dirty = false;
  tabsState.activeId = id; saveTabsLocal();
  loadState(readBoardLocal(id) || emptyBoard());
  renderTabs();
  if (connected()) enqueue(() => loadTabFromDrive(tabById(id) || activeTab()));
}
function uniqueName(base) { let n = base, i = 2; const names = tabsState.tabs.map(t => t.name.toLowerCase()); while (names.includes(n.toLowerCase())) n = base + ' (' + i++ + ')'; return n; }
async function newTab() {
  let n = tabsState.tabs.length + 1; while (tabsState.tabs.some(t => t.name === 'Quadro ' + n)) n++;
  const name = await qmDialog({ title: 'Nova aba', message: 'Nome do documento:', input: true, value: 'Quadro ' + n, okText: 'Criar' });
  if (!name) return null;
  const t = { id: uid(), name: uniqueName(name.slice(0, 80)) };
  tabsState.tabs.push(t); writeBoardLocal(t.id, { ...emptyBoard(), savedAt: new Date().toISOString() });
  switchTab(t.id);
  if (connected()) enqueue(async () => { await ensureTabFolder(t); });
  touchIndex(); return t;
}
async function renameTab(id) {
  const t = tabById(id); if (!t) return;
  const name = await qmDialog({ title: 'Renomear aba', message: 'Novo nome:', input: true, value: t.name, okText: 'Renomear' });
  if (!name || name === t.name) return;
  t.name = name.slice(0, 80); saveTabsLocal(); renderTabs();
  if (connected()) enqueue(async () => { if (t.folderId) await renameDrive(t.folderId, t.name); else await ensureTabFolder(t); });
  touchIndex();
}
async function deleteTab(id) {
  const t = tabById(id); if (!t) return;
  if (!await confirmDelete(t.name, 'A aba e todos os arquivos dela irão para a Lixeira.')) return;
  if (id === tabsState.activeId) { commitText(); saveLocal(); if (dirty && connected()) { const data = serialize(); enqueue(() => saveBoardDrive(t.id, data)); } dirty = false; }
  const idx = tabsState.tabs.indexOf(t);
  tabsState.tabs.splice(idx, 1);
  tabsState.trash.unshift({ id: uid(), kind: 'tab', name: t.name, deletedAt: new Date().toISOString(), tab: t });
  if (!tabsState.tabs.length) { const n = { id: uid(), name: uniqueName('Quadro 1') }; tabsState.tabs.push(n); writeBoardLocal(n.id, emptyBoard()); if (connected()) enqueue(() => ensureTabFolder(n)); }
  if (id === tabsState.activeId) { tabsState.activeId = null; switchTab(tabsState.tabs[Math.min(idx, tabsState.tabs.length - 1)].id); }
  if (connected() && t.folderId) enqueue(async () => { await moveFile(t.folderId, await ensureTrashFolder(), folderId); });
  touchIndex(); setStatus('saved', `"${t.name}" foi para a Lixeira`);
}
$('addTab').onclick = () => newTab();

// ===== Excluir elementos / cartões (com confirmação) =====
const TYPE_NAMES = { pen: 'desenho', rect: 'retângulo', ellipse: 'elipse', line: 'linha', arrow: 'seta', text: 'texto', file: 'arquivo' };
function elName(e) { if (e.type === 'file') return e.name; if (e.type === 'text') return e.text.length > 30 ? e.text.slice(0, 30) + '…' : e.text; return TYPE_NAMES[e.type] || 'elemento'; }
function trashFileEls(els) {
  const tab = activeTab();
  for (const el of els.filter(e => e.type === 'file' && !e.uploading)) {
    const copy = { ...el }; delete copy._hidden;
    tabsState.trash.unshift({ id: uid(), kind: 'file', name: el.name, deletedAt: new Date().toISOString(), fromTabId: tab.id, fromTabName: tab.name, el: copy });
    if (el.fileId && connected()) enqueue(async () => { await moveFile(el.fileId, await ensureTrashFolder()); });
  }
}
async function deleteSelected() {
  const sel = selectedEls(); if (!sel.length) return;
  const files = sel.filter(e => e.type === 'file');
  const name = sel.length === 1 ? elName(sel[0]) : sel.length + ' itens';
  if (!await confirmDelete(name, files.length ? 'Arquivos vão para a Lixeira (podem ser restaurados).' : 'Você pode desfazer com ↶.')) return;
  pushHistory();
  const ids = new Set(sel.map(e => e.id));
  elements = elements.filter(e => !ids.has(e.id)); selectedId = null; multiSel = [];
  if (files.length) { trashFileEls(files); touchIndex(); }
  changed(); if (files.length) saveNow().catch(console.error);
}
async function clearBoard() {
  if (!elements.length) { setStatus('off', 'O quadro já está vazio'); return; }
  const t = activeTab();
  if (!await confirmDelete('tudo do quadro ' + t.name, 'Todos os desenhos serão apagados (pode desfazer com ↶) e os arquivos irão para a Lixeira.')) return;
  pushHistory(); const files = elements.filter(e => e.type === 'file');
  elements = []; selectedId = null; multiSel = [];
  if (files.length) { trashFileEls(files); touchIndex(); }
  changed(); if (files.length) saveNow().catch(console.error);
}
// Ao desfazer uma exclusão de cartão, ele sai da Lixeira e volta para a pasta da aba
function reconcileTrash() {
  const ids = new Set(elements.filter(e => e.type === 'file').map(e => e.id)); const tab = activeTab();
  const back = tabsState.trash.filter(x => x.kind === 'file' && ids.has(x.el.id));
  if (!back.length) return;
  tabsState.trash = tabsState.trash.filter(x => !back.includes(x));
  for (const x of back) if (x.el.fileId && connected()) enqueue(async () => { await moveFile(x.el.fileId, await ensureTabFolder(tab)); });
  touchIndex();
}

// ===== Lixeira =====
function updateTrashBadge() { const n = tabsState.trash.length, b = $('trashBadge'); b.textContent = n; b.classList.toggle('hidden', !n); }
const fmtDate = s => { try { return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return s; } };
function renderTrash() {
  const list = $('trashList'); list.innerHTML = '';
  $('emptyTrash').disabled = !tabsState.trash.length;
  if (!tabsState.trash.length) { list.innerHTML = '<div class="tv-empty">A lixeira está vazia.</div>'; return; }
  for (const x of tabsState.trash) {
    const r = document.createElement('div'); r.className = 'tv-item'; r.dataset.id = x.id;
    r.innerHTML = '<span class="tv-ico"></span><div class="tv-info"><div class="tv-name"></div><div class="tv-sub"></div></div><button class="tv-restore">Restaurar</button><button class="tv-del">Excluir definitivamente</button>';
    r.querySelector('.tv-ico').textContent = x.kind === 'tab' ? '🗂️' : fileIcon(x.el.mimeType || '', x.el.name || '');
    r.querySelector('.tv-name').textContent = x.name;
    r.querySelector('.tv-sub').textContent = (x.kind === 'tab' ? 'Aba' : 'Arquivo da aba "' + (x.fromTabName || '?') + '"') + ' · excluído em ' + fmtDate(x.deletedAt);
    r.querySelector('.tv-restore').onclick = () => restoreItem(x.id);
    r.querySelector('.tv-del').onclick = () => purgeItem(x.id);
    list.appendChild(r);
  }
}
function openTrash() { renderTrash(); $('trashView').classList.remove('hidden'); }
const closeTrash = () => $('trashView').classList.add('hidden');
const trashOpen = () => !$('trashView').classList.contains('hidden');
function restoreItem(id) {
  const x = tabsState.trash.find(i => i.id === id); if (!x) return;
  tabsState.trash = tabsState.trash.filter(i => i !== x);
  if (x.kind === 'tab') {
    const t = x.tab; t.name = uniqueName(t.name); tabsState.tabs.push(t);
    if (connected()) enqueue(async () => {
      if (t.folderId) { await moveFile(t.folderId, await ensureRoot(), await ensureTrashFolder()); if (t.name !== x.name) await renameDrive(t.folderId, t.name); }
      else await ensureTabFolder(t);
    });
  } else {
    const tab = tabById(x.fromTabId) || activeTab(), el = { ...x.el };
    if (tab.id === tabsState.activeId) { pushHistory(); elements.push(el); changed(); }
    else { const b = readBoardLocal(tab.id) || emptyBoard(); b.elements.push(el); b.savedAt = new Date().toISOString(); writeBoardLocal(tab.id, b); if (connected()) enqueue(() => saveBoardDrive(tab.id, b)); }
    if (el.fileId && connected()) enqueue(async () => { await moveFile(el.fileId, await ensureTabFolder(tab)); });
    setStatus('saved', `"${x.name}" restaurado em "${tab.name}"`);
  }
  touchIndex(); renderTrash();
}
function purgeEntry(x) {
  tabsState.trash = tabsState.trash.filter(i => i !== x);
  if (x.kind === 'tab') { try { localStorage.removeItem(BOARD_PREFIX + x.tab.id); } catch (e) {} }
  const did = x.kind === 'tab' ? x.tab.folderId : x.el.fileId;
  if (did && connected()) enqueue(async () => { try { await trashDrive(did); } catch (e) { console.warn('não excluiu no Drive', e); } });
}
async function purgeItem(id) {
  const x = tabsState.trash.find(i => i.id === id); if (!x) return;
  if (!await qmDialog({ title: `Deseja excluir "${x.name}"?`, message: 'Excluir definitivamente. Não será possível restaurar.', okText: 'Excluir', danger: true })) return;
  purgeEntry(x); touchIndex(); renderTrash();
}
async function emptyTrash() {
  const n = tabsState.trash.length; if (!n) return;
  if (!await qmDialog({ title: 'Esvaziar lixeira?', message: `${n} ${n === 1 ? 'item será excluído' : 'itens serão excluídos'} definitivamente. Não será possível restaurar.`, okText: 'Esvaziar', danger: true })) return;
  for (const x of [...tabsState.trash]) purgeEntry(x);
  touchIndex(); renderTrash();
}
$('trashBtn').onclick = openTrash; $('trashClose').onclick = closeTrash; $('emptyTrash').onclick = emptyTrash;
$('trashView').addEventListener('pointerdown', e => { if (e.target.id === 'trashView') closeTrash(); });
window.addEventListener('keydown', e => { if (e.key === 'Escape' && trashOpen() && !dialogOpen()) closeTrash(); });

loadTabsLocal(); renderTabs(); updateTrashBadge();
try { loadState(readBoardLocal(tabsState.activeId) || emptyBoard()); } catch (e) { console.error(e); }
QMInline.init({ open: openFileEl, select: el => { if (tool !== 'select') return; commitText(); selectedId = el.id; multiSel = []; render(); }, wheel: onWheel,
  hasToken, getToken: getTokenNoPopup, refresh: refreshToken, login, rerender: render, zoom: () => view.zoom });
setTool('select'); resize(); initGis(); autoLogin();
if (location.protocol === 'file:') setStatus('error', 'Abra via http://localhost:8000');
// Exposto para testes automatizados
window.__quadrado = { get tabsState() { return tabsState; }, switchTab, newTab, deleteTab, syncFromDrive, get driveQ() { return driveQ; }, openFileEl, migrateDataUrlTexts, loadState, get elements() { return elements; }, get view() { return view; }, undo, redo, saveNow, setTool, render, QMInline, setToken: (t) => { accessToken = t; tokenExpiry = Date.now() + 3600e3; render(); } };
