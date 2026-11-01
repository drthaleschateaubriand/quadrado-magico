// Visualizador de arquivos dentro do app (não abre o Google Drive).
(function (root) {
  const EXT = {
    pdf: ['pdf'], image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico'],
    audio: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'], video: ['mp4', 'webm', 'mov', 'm4v', 'ogv'],
    docx: ['docx'], sheet: ['xlsx', 'xls', 'csv', 'ods'], text: ['txt', 'json', 'md', 'log', 'xml', 'html', 'htm', 'js', 'css', 'tsv']
  };
  function extOf(name) { const m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
  // Decide como exibir: pdf | image | audio | video | docx | sheet | text | other
  function detectKind(mime, name) {
    mime = (mime || '').toLowerCase(); const ext = extOf(name);
    if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
    if (mime === 'text/csv' || /spreadsheetml|ms-excel|opendocument\.spreadsheet/.test(mime) || EXT.sheet.includes(ext)) return 'sheet';
    if (/wordprocessingml/.test(mime) || ext === 'docx') return 'docx';
    if (mime.startsWith('image/') || EXT.image.includes(ext)) return 'image';
    if (mime.startsWith('audio/') || EXT.audio.includes(ext)) return 'audio';
    if (mime.startsWith('video/') || EXT.video.includes(ext)) return 'video';
    if (mime.startsWith('text/') || /(^application\/(json|xml|javascript)|\+(json|xml))$/.test(mime) || EXT.text.includes(ext)) return 'text';
    return 'other';
  }
  function isDataUrl(s) { return typeof s === 'string' && /^data:[^,]*;base64,/i.test(s.trim()); }
  const MIME_EXT = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'text/plain': 'txt', 'text/csv': 'csv', 'application/json': 'json', 'audio/mpeg': 'mp3', 'video/mp4': 'mp4',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx' };
  function dataUrlToBlob(s) {
    s = s.trim(); const i = s.indexOf(',');
    const head = s.slice(5, i), mime = (head.split(';')[0] || 'application/octet-stream').toLowerCase();
    const bin = atob(s.slice(i + 1).replace(/\s/g, '')); const u8 = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
    const nm = /;name=([^;]+)/.exec(head);
    const name = nm ? decodeURIComponent(nm[1]) : 'arquivo-colado.' + (MIME_EXT[mime] || mime.split('/')[1] || 'bin').replace(/[^a-z0-9]/g, '');
    return { blob: new Blob([u8], { type: mime }), mime, name };
  }
  const QMViewer = { detectKind, extOf, isDataUrl, dataUrlToBlob };
  if (typeof module !== 'undefined' && module.exports) { module.exports = QMViewer; return; }
  root.QMViewer = QMViewer;

  // ===== Interface (somente navegador) =====
  const cache = new Map(); // fileId -> Blob (cache da sessão)
  const libs = {};
  function loadScript(src) {
    if (!libs[src]) libs[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Falha ao carregar ' + src)); document.head.appendChild(s); });
    return libs[src];
  }
  let modal, body, title, dlBtn, curUrl = null, curName = '', token = 0;
  function build() {
    modal = document.createElement('div'); modal.id = 'viewer'; modal.className = 'hidden';
    modal.innerHTML = '<div class="vw-box"><div class="vw-head"><span class="vw-title"></span><button class="vw-dl" title="Baixar">⬇️ Baixar</button><button class="vw-x" title="Fechar (Esc)">✕</button></div><div class="vw-body"></div></div>';
    document.body.appendChild(modal);
    body = modal.querySelector('.vw-body'); title = modal.querySelector('.vw-title'); dlBtn = modal.querySelector('.vw-dl');
    modal.querySelector('.vw-x').onclick = close; dlBtn.onclick = download;
    modal.addEventListener('pointerdown', e => { if (e.target === modal) close(); });
    modal.addEventListener('wheel', e => e.stopPropagation());
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) { e.preventDefault(); e.stopImmediatePropagation(); close(); } }, true);
  }
  function isOpen() { return modal && !modal.classList.contains('hidden'); }
  function close() { if (!modal) return; token++; modal.classList.add('hidden'); body.innerHTML = ''; curUrl = null; }
  function download() { if (!curUrl) return; const a = document.createElement('a'); a.href = curUrl; a.download = curName || 'arquivo'; document.body.appendChild(a); a.click(); a.remove(); }
  function fmt(n) { return n < 1024 * 1024 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
  // Baixa o conteúdo com progresso; getToken/refresh vêm do app (fluxo OAuth existente).
  async function fetchBlob(el, getToken, refresh, onProg) {
    if (el.fileId && cache.has(el.fileId)) return cache.get(el.fileId);
    if (!el.fileId && el.dataUrl) return dataUrlToBlob(el.dataUrl).blob;
    const url = `https://www.googleapis.com/drive/v3/files/${el.fileId}?alt=media`;
    let res = await fetch(url, { headers: { Authorization: 'Bearer ' + await getToken() } });
    if (res.status === 401 && refresh) { await refresh(); res = await fetch(url, { headers: { Authorization: 'Bearer ' + await getToken() } }); }
    if (!res.ok) throw new Error('Drive ' + res.status);
    const total = +res.headers.get('Content-Length') || el.size || 0;
    let blob;
    if (res.body && res.body.getReader) {
      const rd = res.body.getReader(), parts = []; let got = 0;
      for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; onProg(got, total); }
      blob = new Blob(parts, { type: el.mimeType || res.headers.get('Content-Type') || '' });
    } else blob = await res.blob();
    if (el.mimeType && blob.type !== el.mimeType) blob = new Blob([blob], { type: el.mimeType });
    cache.set(el.fileId, blob); return blob;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  // Retorna a tag usada (para testes) e preenche o corpo do modal.
  async function renderInto(container, blob, kind, url, name) {
    switch (kind) {
      case 'pdf': container.innerHTML = `<iframe class="vw-frame" title="${esc(name)}"></iframe>`; container.firstChild.src = url; return 'iframe';
      case 'image': container.innerHTML = '<img class="vw-img" alt="">'; container.firstChild.src = url; return 'img';
      case 'audio': container.innerHTML = '<audio controls autoplay class="vw-media"></audio>'; container.firstChild.src = url; return 'audio';
      case 'video': container.innerHTML = '<video controls autoplay playsinline class="vw-media"></video>'; container.firstChild.src = url; return 'video';
      case 'text': { const t = await blob.text(); container.innerHTML = '<pre class="vw-pre"></pre>'; let s = t; if (/json$/i.test(name) || blob.type.includes('json')) { try { s = JSON.stringify(JSON.parse(t), null, 2); } catch (e) {} } container.firstChild.textContent = s; return 'pre'; }
      case 'docx': {
        await loadScript('https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js');
        const r = await root.mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
        container.innerHTML = '<div class="vw-doc"></div>'; container.firstChild.innerHTML = r.value; return 'docx';
      }
      case 'sheet': {
        await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
        const X = root.XLSX, wb = /\.csv$/i.test(name) || blob.type === 'text/csv' ? X.read(await blob.text(), { type: 'string' }) : X.read(await blob.arrayBuffer(), { type: 'array' });
        container.innerHTML = '<div class="vw-sheet"></div>'; const d = container.firstChild;
        if (wb.SheetNames.length > 1) { const tabs = document.createElement('div'); tabs.className = 'vw-tabs'; wb.SheetNames.forEach((n, i) => { const b = document.createElement('button'); b.textContent = n; b.onclick = () => show(i); tabs.appendChild(b); }); d.before(tabs); }
        const show = i => { d.innerHTML = X.utils.sheet_to_html(wb.Sheets[wb.SheetNames[i]]); };
        show(0); return 'table';
      }
      default:
        container.innerHTML = `<div class="vw-other"><div class="vw-icon">📦</div><p>${esc(name)}</p><p>Este tipo de arquivo não pode ser exibido aqui.</p><button class="vw-dl2">⬇️ Baixar</button></div>`;
        container.querySelector('.vw-dl2').onclick = download; return 'other';
    }
  }
  async function open(el, opts) {
    if (!modal) build();
    const my = ++token; curName = el.name || 'arquivo'; curUrl = null;
    title.textContent = curName; modal.classList.remove('hidden'); dlBtn.disabled = true;
    body.innerHTML = '<div class="vw-load"><div class="vw-spin"></div><div class="vw-prog">Carregando…</div></div>';
    const prog = body.querySelector('.vw-prog');
    try {
      if (!el.fileId && !el.dataUrl) throw new Error(el.uploading ? 'O arquivo ainda está sendo enviado' : 'Arquivo sem conteúdo');
      const blob = await fetchBlob(el, opts.getToken, opts.refresh, (g, t) => { if (my === token) prog.textContent = t ? `Carregando… ${Math.min(100, Math.round(g / t * 100))}% (${fmt(g)} de ${fmt(t)})` : `Carregando… ${fmt(g)}`; });
      if (my !== token) return;
      curUrl = URL.createObjectURL(blob); dlBtn.disabled = false;
      prog.textContent = 'Abrindo…';
      const holder = document.createElement('div'); holder.className = 'vw-holder';
      const kind = detectKind(el.mimeType || blob.type, curName);
      const tag = await renderInto(holder, blob, kind, curUrl, curName);
      if (my !== token) return;
      body.innerHTML = ''; body.appendChild(holder); return tag;
    } catch (e) {
      console.error(e); if (my !== token) return;
      body.innerHTML = `<div class="vw-other"><div class="vw-icon">⚠️</div><p>Não foi possível abrir o arquivo.</p><p class="vw-err"></p></div>`;
      body.querySelector('.vw-err').textContent = e.message;
    }
  }
  Object.assign(QMViewer, { open, close, isOpen, renderInto, fetchBlob, cache });
})(typeof window !== 'undefined' ? window : globalThis);
