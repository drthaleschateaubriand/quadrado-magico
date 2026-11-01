// Pré-visualização do conteúdo dos arquivos DIRETO no quadro (camada DOM sincronizada com pan/zoom do <canvas>).
(function (root) {
  const V = root.QMViewer;
  let layer, hooks = {};
  const cards = new Map(); // el.id -> { div, body, key, state }
  const BIG_MEDIA = 40 * 1048576;
  function init(h) {
    hooks = h;
    layer = document.createElement('div'); layer.id = 'qmLayer';
    document.getElementById('board').after(layer);
  }
  const previewKind = el => V.detectKind(el.mimeType, el.name);
  function makeCard(el) {
    const div = document.createElement('div'); div.className = 'qm-card'; div.dataset.id = el.id;
    div.innerHTML = '<div class="qm-head"><span class="qm-name"></span><button class="qm-open" title="Abrir em tela cheia">⤢ Abrir</button></div><div class="qm-body"><div class="qm-msg">…</div></div><div class="qm-foot"></div>';
    const c = { div, body: div.querySelector('.qm-body'), key: null, state: 'idle', el };
    div.querySelector('.qm-open').addEventListener('click', ev => { ev.stopPropagation(); hooks.open(c.el); });
    div.querySelector('.qm-open').addEventListener('pointerdown', ev => ev.stopPropagation());
    c.body.addEventListener('pointerdown', () => hooks.select(c.el));
    c.body.addEventListener('dblclick', ev => { if (ev.target.closest('button,video,audio,input,a')) return; hooks.open(c.el); });
    c.body.addEventListener('wheel', ev => { // Ctrl/pinça do trackpad = zoom do quadro; rolagem normal rola o conteúdo
      const sc = ev.target.closest('.qm-scroll');
      if (ev.ctrlKey || ev.metaKey || !sc || sc.scrollHeight <= sc.clientHeight + 1 && sc.scrollWidth <= sc.clientWidth + 1) { ev.preventDefault(); hooks.wheel(ev); }
      else ev.stopPropagation();
    }, { passive: false });
    layer.appendChild(div); return c;
  }
  function msg(c, html) { c.body.innerHTML = '<div class="qm-msg">' + html + '</div>'; }
  async function load(c) {
    const el = c.el, my = c.key; c.state = 'loading';
    const kind = previewKind(el);
    if (kind === 'other') { msg(c, '<div class="qm-ico">📦</div>' + V.esc(el.name) + '<br><small>Sem pré-visualização para este tipo. Use ⤢ Abrir para baixar.</small>'); c.state = 'done'; return; }
    if ((kind === 'video' || kind === 'audio') && el.size > BIG_MEDIA && !c.force) {
      msg(c, `<div class="qm-ico">${kind === 'video' ? '🎬' : '🎵'}</div><button class="qm-btn">▶ Carregar (${Math.round(el.size / 1048576)} MB)</button>`);
      c.body.querySelector('.qm-btn').onclick = () => { c.force = true; load(c); }; c.state = 'done'; return;
    }
    if (el.fileId && !V.cache.has(el.fileId) && !hooks.hasToken()) {
      msg(c, '<div class="qm-ico">🔗</div>Conecte o Google para ver este arquivo aqui<br><button class="qm-btn">Entrar com Google</button>');
      c.body.querySelector('.qm-btn').onclick = () => hooks.login(); c.state = 'needlogin'; return;
    }
    msg(c, '<div class="qm-spin"></div><span class="qm-prog">Carregando…</span>');
    try {
      const blob = await V.fetchBlob(el, hooks.getToken, hooks.refresh, (g, t) => { const p = c.body.querySelector('.qm-prog'); if (p && t) p.textContent = 'Carregando… ' + Math.min(100, Math.round(g / t * 100)) + '%'; });
      if (my !== c.key) return;
      await show(c, blob, kind);
      c.state = 'done';
    } catch (e) {
      console.warn('pré-visualização', el.name, e); if (my !== c.key) return;
      c.state = 'error';
      msg(c, '<div class="qm-ico">⚠️</div><span class="qm-err"></span>' + (e.needLogin ? '<br><button class="qm-btn">Entrar com Google</button>' : '<br><button class="qm-btn">Tentar de novo</button>'));
      c.body.querySelector('.qm-err').textContent = e.message;
      c.body.querySelector('.qm-btn').onclick = () => e.needLogin ? hooks.login() : (c.key = null, hooks.rerender());
    }
  }
  async function show(c, blob, kind) {
    const b = c.body, url = c.url || (c.url = URL.createObjectURL(blob));
    switch (kind) {
      case 'image': b.innerHTML = '<img class="qm-img" alt="" draggable="false">'; b.firstChild.src = url; break;
      case 'video': b.innerHTML = '<video class="qm-media" controls playsinline preload="metadata"></video>'; b.firstChild.src = url; break;
      case 'audio': b.innerHTML = '<div class="qm-msg"><div class="qm-ico">🎵</div><audio controls preload="metadata"></audio></div>'; b.querySelector('audio').src = url; break;
      case 'pdf': {
        const doc = await V.openPdf(blob);
        b.innerHTML = '<div class="qm-scroll qm-pdfwrap"><canvas class="qm-page"></canvas></div><div class="qm-nav"><button class="qm-prev">◀</button><span class="qm-pn"></span><button class="qm-next">▶</button></div>';
        const cv = b.querySelector('canvas'), pn = b.querySelector('.qm-pn');
        c.pdf = { doc, n: 1, w: 0 };
        const go = async n => { c.pdf.n = Math.max(1, Math.min(doc.numPages, n)); pn.textContent = c.pdf.n + ' / ' + doc.numPages; await drawPdf(c, true); b.querySelector('.qm-scroll').scrollTop = 0; };
        b.querySelector('.qm-prev').onclick = () => go(c.pdf.n - 1); b.querySelector('.qm-next').onclick = () => go(c.pdf.n + 1);
        if (doc.numPages < 2) b.querySelector('.qm-nav').classList.add('qm-one');
        c.pdf.cv = cv; await go(1); break;
      }
      case 'text': {
        let t = await blob.text(); if (t.length > 200000) t = t.slice(0, 200000) + '\n…';
        if (/json$/i.test(c.el.name) || blob.type.includes('json')) { try { t = JSON.stringify(JSON.parse(t), null, 2); } catch (e) {} }
        b.innerHTML = '<pre class="qm-scroll qm-pre"></pre>'; b.firstChild.textContent = t; break;
      }
      case 'docx': case 'sheet': {
        const tmp = document.createElement('div'); await V.renderInto(tmp, blob, kind, url, c.el.name);
        b.innerHTML = ''; tmp.className = 'qm-scroll qm-' + kind; b.appendChild(tmp); break;
      }
    }
  }
  async function drawPdf(c, force) {
    const p = c.pdf; if (!p) return;
    const w = c.el.w - 2, z = hooks.zoom();
    if (!force && Math.abs(w - p.w) < 24 && Math.abs(z - (p.z || z)) / z < 0.6) return;
    p.w = w; p.z = z;
    await V.renderPdfPage(p.doc, p.n, p.cv, w - 12, Math.max(1, Math.min(2.5, z)));
  }
  let pdfTimer = 0;
  // Chamado a cada render(): posiciona/escala as caixas, carrega só as visíveis.
  function sync(elements, view, opts) {
    if (!layer) return;
    layer.classList.toggle('qm-passive', !opts.interactive);
    const seen = new Set(), W = innerWidth, H = innerHeight, z = view.zoom;
    for (const el of elements) {
      if (el.type !== 'file' || el.isImage) continue; // imagens já são desenhadas no canvas
      seen.add(el.id);
      let c = cards.get(el.id); if (!c) { c = makeCard(el); cards.set(el.id, c); }
      c.el = el;
      const sx = view.x + el.x * z, sy = view.y + el.y * z, vis = sx < W && sy < H && sx + el.w * z > 0 && sy + el.h * z > 0;
      c.div.style.display = vis ? '' : 'none';
      if (!vis) continue;
      c.div.style.width = el.w + 'px'; c.div.style.height = el.h + 'px';
      c.div.style.transform = `translate(${sx}px,${sy}px) scale(${z})`;
      c.div.classList.toggle('qm-sel', opts.selected.has(el.id));
      const nm = c.div.querySelector('.qm-name'); const label = (el.uploading ? '⏳ ' : '') + el.name; if (nm.textContent !== label) nm.textContent = label;
      const key = (el.fileId || '') + '|' + (el.dataUrl ? el.dataUrl.length : '') + '|' + (el.uploading ? 'u' : '') + '|' + (hooks.hasToken() ? 't' : '');
      if (key !== c.key && !(c.state === 'done' && c.key && c.key.split('|')[0] === el.fileId && el.fileId)) {
        c.key = key; c.pdf = null; if (c.url) { URL.revokeObjectURL(c.url); c.url = null; }
        if (el.uploading && !el.fileId && !el.dataUrl) msg(c, '<div class="qm-spin"></div>Enviando para o Drive…');
        else load(c);
      }
    }
    for (const [id, c] of cards) if (!seen.has(id)) { if (c.url) URL.revokeObjectURL(c.url); c.div.remove(); cards.delete(id); }
    clearTimeout(pdfTimer); pdfTimer = setTimeout(() => { for (const c of cards.values()) if (c.pdf && c.div.style.display !== 'none') drawPdf(c).catch(() => {}); }, 250);
  }
  function stats() { return [...cards.values()].map(c => ({ id: c.el.id, state: c.state, shown: c.div.style.display !== 'none', html: c.body.innerHTML.slice(0, 80), tag: (c.body.querySelector('img,video,audio,canvas,pre,table,.vw-doc') || {}).tagName })); }
  root.QMInline = { init, sync, stats, cards };
})(window);
