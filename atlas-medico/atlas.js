// Atlas Médico — camada visual sobre a lógica do Quadrado Mágico
(function () {
  const $ = id => document.getElementById(id);
  const fire = el => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const mark = (box, btn) => box.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));
  // Cor
  const sc = $('strokeColor'), hex = $('ppHex');
  function syncColor() { hex.textContent = sc.value; document.querySelectorAll('#ppColors .sw[data-color]').forEach(b => b.classList.toggle('on', b.dataset.color.toLowerCase() === sc.value.toLowerCase())); $('ppColors').querySelector('.sw-custom').style.setProperty('--c', sc.value); }
  document.querySelectorAll('#ppColors button[data-color]').forEach(b => b.addEventListener('click', () => { sc.value = b.dataset.color; fire(sc); syncColor(); }));
  sc.addEventListener('change', syncColor); sc.addEventListener('input', syncColor);
  // Espessura
  const sw = $('strokeWidth'), wb = $('ppWidths');
  function syncW() { wb.querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.width === +sw.value)); }
  wb.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { sw.value = b.dataset.width; fire(sw); syncW(); }));
  sw.addEventListener('change', syncW); sw.addEventListener('input', syncW);
  // Preenchimento
  const fo = $('fillOn'), fc = $('fillColor'), fb = $('ppFills');
  function syncF() { fb.querySelectorAll('button').forEach(b => b.classList.toggle('on', fo.checked ? b.dataset.fill === fc.value : b.dataset.fill === 'none')); }
  fb.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.fill === 'none') { fo.checked = false; fire(fo); }
    else { fc.value = b.dataset.fill; fire(fc); if (!fo.checked) { fo.checked = true; fire(fo); } }
    syncF();
  }));
  fo.addEventListener('change', syncF);
  // Tracejado
  const dn = $('dashOn'), db = document.querySelector('.pp-dash');
  function syncD() { db.querySelectorAll('button').forEach(b => b.classList.toggle('on', (b.dataset.dash === '1') === dn.checked)); }
  db.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { dn.checked = b.dataset.dash === '1'; fire(dn); syncD(); }));
  // Padrões do design
  sc.value = '#0b1c30'; fire(sc); sw.value = 2; fire(sw); syncColor(); syncW(); syncF(); syncD();
  // Grade
  let grid = true; try { grid = localStorage.getItem('am-grid') !== '0'; } catch (e) {}
  function setGrid(g) { grid = g; window.QM_GRID = g; $('gridBtn').classList.toggle('on', g); try { localStorage.setItem('am-grid', g ? '1' : '0'); } catch (e) {} window.QMRender && QMRender(); }
  setGrid(grid); $('gridBtn').onclick = () => setGrid(!grid);
  // Menu "mais opções"
  const mm = $('moreMenu');
  $('moreBtn').onclick = e => { e.stopPropagation(); mm.classList.toggle('hidden'); };
  document.addEventListener('pointerdown', e => { if (!mm.contains(e.target) && !e.target.closest('#moreBtn')) mm.classList.add('hidden'); }, true);
  mm.addEventListener('click', () => mm.classList.add('hidden'));
  // Atalhos
  const keys = $('amKeys');
  $('keysBtn').onclick = () => keys.classList.remove('hidden');
  $('amKeysClose').onclick = () => keys.classList.add('hidden');
  keys.addEventListener('pointerdown', e => { if (e.target === keys) keys.classList.add('hidden'); });
  addEventListener('keydown', e => { if (e.key === 'Escape') { keys.classList.add('hidden'); mm.classList.add('hidden'); } });
})();
