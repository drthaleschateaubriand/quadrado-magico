// Visualização em gráfico (estilo Obsidian): cada pasta/aba é uma estrela, itens ao redor.
(function () {
  const HUB_COLORS = ['#f2c14e', '#9bd36a', '#4fc3b8', '#f59e5b', '#c3e86b', '#62d0e0'];
  let root, cv, ctx, search, info, opts, nodes = [], links = [], byId = {}, view = { x: 0, y: 0, k: 1 };
  let raf = 0, alpha = 0, hover = null, dragN = null, pan = null, pointers = new Map(), pinch = null, moved = false, query = '';
  const isOpen = () => root && !root.classList.contains('hidden');
  function build() {
    root = document.createElement('div'); root.id = 'graphView'; root.className = 'hidden';
    root.innerHTML = '<canvas></canvas><div class="gv-top"><span class="gv-title">🕸️ Visualização em gráfico</span>' +
      '<input type="search" placeholder="Buscar…" aria-label="Buscar no gráfico"><button class="gv-fit" title="Centralizar">⟲</button>' +
      '<button class="gv-close" title="Fechar (Esc)">✕</button></div><div class="gv-info"></div>';
    document.body.appendChild(root);
    cv = root.querySelector('canvas'); ctx = cv.getContext('2d'); search = root.querySelector('input'); info = root.querySelector('.gv-info');
    root.querySelector('.gv-close').onclick = close; root.querySelector('.gv-fit').onclick = fit;
    search.oninput = () => { query = search.value.trim().toLowerCase(); draw(); };
    cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('pointerleave', e => { if (!pointers.size) { hover = null; draw(); } });
    cv.addEventListener('wheel', wheel, { passive: false });
    ['gesturestart', 'gesturechange'].forEach(t => root.addEventListener(t, e => { e.preventDefault(); e.stopPropagation(); }));
    window.addEventListener('keydown', e => { if (isOpen() && e.key === 'Escape' && document.activeElement !== search) { e.stopPropagation(); close(); } }, true);
    window.addEventListener('resize', () => { if (isOpen()) { size(); draw(); } });
  }
  function size() { const d = window.devicePixelRatio || 1; cv.width = innerWidth * d; cv.height = innerHeight * d; cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px'; }
  function setData(data) {
    const old = byId; nodes = []; links = []; byId = {};
    data.folders.forEach((f, i) => {
      const a = i / Math.max(1, data.folders.length) * Math.PI * 2, R = 120 + 40 * Math.sqrt(data.folders.length);
      const n = { id: 'tab:' + f.id, kind: 'folder', tabId: f.id, label: f.name, color: HUB_COLORS[i % HUB_COLORS.length], deg: f.items.length,
        x: Math.cos(a) * R, y: Math.sin(a) * R, vx: 0, vy: 0 };
      if (old[n.id]) Object.assign(n, { x: old[n.id].x, y: old[n.id].y });
      n.r = 9 + 3.2 * Math.sqrt(n.deg); nodes.push(n); byId[n.id] = n;
      f.items.forEach((it, j) => {
        const b = j / Math.max(1, f.items.length) * Math.PI * 2;
        const m = { id: 'el:' + f.id + ':' + it.id, kind: it.kind, tabId: f.id, elId: it.id, label: it.label, color: it.kind === 'file' ? n.color : '#9aa4ad',
          x: n.x + Math.cos(b) * 60, y: n.y + Math.sin(b) * 60, vx: 0, vy: 0, r: it.kind === 'file' ? 4.5 : 3.5, hub: n };
        if (old[m.id]) Object.assign(m, { x: old[m.id].x, y: old[m.id].y });
        nodes.push(m); byId[m.id] = m; links.push({ s: n, t: m, len: 45 + n.r });
      });
    });
    (data.folderLinks || []).forEach(([a, b]) => { const s = byId['tab:' + a], t = byId['tab:' + b]; if (s && t) links.push({ s, t, len: 220, cross: true }); });
    info.textContent = data.folders.length + ' pastas · ' + (nodes.length - data.folders.length) + ' itens';
  }
  function tick() {
    const N = nodes.length;
    for (let i = 0; i < N; i++) { // repulsão (O(n²), ok para centenas)
      const a = nodes[i];
      for (let j = i + 1; j < N; j++) {
        const b = nodes[j]; let dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
        if (d2 > 250000) continue; if (d2 < 1) { dx = Math.random() - .5; dy = Math.random() - .5; d2 = 1; }
        const s = (a.kind === 'folder' && b.kind === 'folder' ? 2600 : 520) / d2 * alpha, d = Math.sqrt(d2), fx = dx / d * s, fy = dy / d * s;
        a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
      }
    }
    for (const l of links) {
      const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - l.len) / d * (l.cross ? .02 : .08) * alpha;
      const ws = l.s.kind === 'folder' && !l.cross ? .15 : .5;
      l.s.vx += dx * f * ws; l.s.vy += dy * f * ws; l.t.vx -= dx * f * (1 - ws); l.t.vy -= dy * f * (1 - ws);
    }
    for (const n of nodes) {
      n.vx -= n.x * .004 * alpha; n.vy -= n.y * .004 * alpha;
      if (n === dragN) { n.vx = n.vy = 0; continue; }
      n.vx *= .6; n.vy *= .6; n.x += n.vx; n.y += n.vy;
    }
  }
  function loop() { raf = 0; if (!isOpen()) return; if (alpha > .02) { tick(); alpha *= .985; } draw(); if (alpha > .02 || dragN) raf = requestAnimationFrame(loop); }
  function heat(a) { alpha = Math.max(alpha, a); if (!raf) raf = requestAnimationFrame(loop); }
  const toS = n => [n.x * view.k + view.x, n.y * view.k + view.y];
  const toW = (sx, sy) => [(sx - view.x) / view.k, (sy - view.y) / view.k];
  const matches = n => query && n.label.toLowerCase().includes(query);
  function draw() {
    const d = window.devicePixelRatio || 1; ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = '#0d0d0f'; ctx.fillRect(0, 0, innerWidth, innerHeight);
    ctx.setTransform(d * view.k, 0, 0, d * view.k, d * view.x, d * view.y);
    const focus = hover ? new Set([hover, ...links.filter(l => l.s === hover || l.t === hover).flatMap(l => [l.s, l.t])]) : null;
    ctx.lineWidth = 1 / Math.max(view.k, .3);
    for (const l of links) {
      const on = focus && focus.has(l.s) && focus.has(l.t);
      ctx.strokeStyle = on ? 'rgba(240,220,150,.8)' : l.cross ? 'rgba(160,160,170,.35)' : focus || query ? 'rgba(130,130,140,.15)' : 'rgba(150,150,160,.38)';
      if (l.cross) ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(l.s.x, l.s.y); ctx.lineTo(l.t.x, l.t.y); ctx.stroke(); ctx.setLineDash([]);
    }
    for (const n of nodes) {
      const dim = (focus && !focus.has(n)) || (query && !matches(n));
      ctx.globalAlpha = dim ? .22 : 1;
      if (n.kind === 'folder' || matches(n) || n === hover) { ctx.shadowColor = matches(n) ? '#fff' : n.color; ctx.shadowBlur = (n.kind === 'folder' ? 22 : 12) * view.k; }
      ctx.fillStyle = matches(n) ? '#fff6c8' : n.color; ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
      if (n.kind === 'folder') { ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(n.x - n.r * .3, n.y - n.r * .3, n.r * .35, 0, 7); ctx.fill(); }
    }
    ctx.globalAlpha = 1; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const n of nodes) {
      const show = n === hover || matches(n) || (focus && focus.has(n) && n.kind === 'folder') || (n.kind === 'folder' && view.k > .55) || (n.kind !== 'folder' && view.k > 2.2 && !focus);
      if (!show) continue;
      const fs = (n.kind === 'folder' ? 14 : 11) / Math.min(view.k, 1.6);
      ctx.font = (n.kind === 'folder' ? '600 ' : '') + fs + 'px system-ui,sans-serif';
      const t = n.label.length > 40 ? n.label.slice(0, 38) + '…' : n.label;
      ctx.lineWidth = 3 / view.k; ctx.strokeStyle = '#0d0d0f'; ctx.strokeText(t, n.x, n.y + n.r + 4 / view.k);
      ctx.fillStyle = n === hover ? '#fff' : n.kind === 'folder' ? '#eee' : '#bbb'; ctx.fillText(t, n.x, n.y + n.r + 4 / view.k);
    }
  }
  function nodeAt(sx, sy) {
    const [wx, wy] = toW(sx, sy); let best = null, bd = Infinity;
    for (const n of nodes) { const d = Math.hypot(n.x - wx, n.y - wy), r = n.r + 6 / view.k; if (d < r && d < bd) { bd = d; best = n; } }
    return best;
  }
  function fit() {
    if (!nodes.length) { view = { x: innerWidth / 2, y: innerHeight / 2, k: 1 }; draw(); return; }
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const n of nodes) { x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y); x2 = Math.max(x2, n.x); y2 = Math.max(y2, n.y); }
    const k = Math.min(2, (innerWidth - 80) / Math.max(1, x2 - x1), (innerHeight - 140) / Math.max(1, y2 - y1));
    view = { k, x: innerWidth / 2 - (x1 + x2) / 2 * k, y: innerHeight / 2 + 20 - (y1 + y2) / 2 * k }; draw();
  }
  function zoomAt(sx, sy, f) { const k = Math.min(8, Math.max(.08, view.k * f)); f = k / view.k; view.x = sx - (sx - view.x) * f; view.y = sy - (sy - view.y) * f; view.k = k; draw(); }
  function wheel(e) { e.preventDefault(); if (e.ctrlKey || e.deltaMode || Math.abs(e.deltaY) > 50 && !e.deltaX) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? .01 : .002))); else { view.x -= e.deltaX; view.y -= e.deltaY; draw(); } }
  function down(e) {
    cv.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); moved = false;
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2 }; dragN = null; pan = null; return; }
    const n = nodeAt(e.clientX, e.clientY);
    if (n) { dragN = n; hover = n; heat(.3); } else pan = { x: e.clientX - view.x, y: e.clientY - view.y };
    downAt = [e.clientX, e.clientY];
  }
  let downAt = [0, 0];
  function move(e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) moved = true;
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
      view.x += cx - pinch.cx; view.y += cy - pinch.cy; zoomAt(cx, cy, d / pinch.d); pinch = { d, cx, cy }; return;
    }
    if (dragN && pointers.size) { if (moved) { [dragN.x, dragN.y] = toW(e.clientX, e.clientY); heat(.25); } return; }
    if (pan && pointers.size) { view.x = e.clientX - pan.x; view.y = e.clientY - pan.y; draw(); return; }
    const n = nodeAt(e.clientX, e.clientY); if (n !== hover) { hover = n; cv.style.cursor = n ? 'pointer' : 'grab'; draw(); }
  }
  function up(e) {
    pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null;
    const n = dragN; dragN = null; pan = null;
    if (n && !moved && !pointers.size) activate(n);
    if (e.pointerType !== 'mouse') { hover = null; draw(); }
  }
  function activate(n) {
    close();
    if (n.kind === 'folder') opts.openTab(n.tabId); else opts.openItem(n.tabId, n.elId, n.kind);
  }
  function open() {
    if (!root) build();
    root.classList.remove('hidden'); size(); hover = null;
    setData(opts.getData()); fit(); heat(1);
    for (let i = 0; i < 120; i++) { tick(); alpha *= .985; } fit();
    if (opts.refresh) opts.refresh().then(d => { if (d && isOpen()) { setData(d); heat(.5); } }).catch(e => console.warn(e));
  }
  function close() { if (root) root.classList.add('hidden'); cancelAnimationFrame(raf); raf = 0; }
  window.QMGraph = { init: o => { opts = o; }, open, close, isOpen, get nodes() { return nodes; }, get links() { return links; }, get view() { return view; }, toScreen: toS, draw };
})();
