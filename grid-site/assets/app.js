(function () {
  'use strict';

  var SCHEMA_VERSION = 5;

  function defaultState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: null,
      site: 'SSC2',
      lang: 'pt',
      source: null,            // 'opt' | 'extr'
      optFileName: null,
      lastSave: null,
      groups: [],              // { name, fullName, planned, hybrid, count, realSacas:[num] }
      excluded: [],
      selection: [],
      qrByNum: {},             // num -> QR string to encode
      metaByNum: {},           // num -> { agencia, veiculo(limpo), rotasacapl }
      cfgEtq: { w: 12, h: 5, p: 0.4 }
    };
  }

  var state = defaultState();
  var pending = null;

  // ---------------------------------------------------------------- i18n
  var I18N = {
    pt: {
      site: 'Site', avail_bags: 'Sacas disponíveis ↗', optimization: 'Otimização',
      attach_csv: 'Anexar CSV', load_extr: 'Extração (QR)', load_saved: 'Recuperar salvo',
      import_kicker: 'Importe o arquivo de', optimization_up: 'OTIMIZAÇÃO',
      opt_desc: 'A otimização define quais sacas pertencem a cada rota. A extração traz o QR real, a agência e o modal de cada saca.',
      sel_all: 'Sel. todos', clear_sel: 'Limpar seleção', restore: 'Restaurar excluídas',
      view_extr: 'Dados extração', save_choice: 'Salvar escolha de sacas', copies: 'cópias',
      print: 'Imprimir', extr_title: 'Dados da Extração NEX', cancel: 'Cancelar',
      bags: 'sacas', sel_group: 'Sel. grupo',
      last_save: 'Último salvamento: ', saved_ok: 'Escolha salva!', restored: 'Configuração recuperada!',
      no_saved: 'Nenhuma configuração salva encontrada.', hyb: 'HÍBRIDA',
      etq_cfg: 'Configurar etiqueta', width_cm: 'Largura (cm)', height_cm: 'Altura (cm)',
      pad_cm: 'Margem (cm)', etq_hint: 'O QR ocupa a lateral e o texto se ajusta à altura.', save: 'Salvar',
      base_missing: 'Sem QR na base — importe a extração para imprimir os códigos.',
      base_partial: 'sacas ainda sem QR. Importe/atualize a extração.',
      base_ok: 'Base de QR carregada.'
    },
    es: {
      site: 'Sitio', avail_bags: 'Sacas disponibles ↗', optimization: 'Optimización',
      attach_csv: 'Adjuntar CSV', load_extr: 'Extração (QR)', load_saved: 'Recuperar guardado',
      import_kicker: 'Importá el archivo de', optimization_up: 'OPTIMIZACIÓN',
      opt_desc: 'La optimización define qué sacas pertenecen a cada ruta. La extração trae el QR real, la agencia y el modal de cada saca.',
      sel_all: 'Sel. todos', clear_sel: 'Limpiar selección', restore: 'Restaurar excluidas',
      view_extr: 'Datos extración', save_choice: 'Guardar elección de sacas', copies: 'copias',
      print: 'Imprimir', extr_title: 'Datos de la Extración NEX', cancel: 'Cancelar',
      bags: 'sacas', sel_group: 'Sel. grupo',
      last_save: 'Último guardado: ', saved_ok: '¡Elección guardada!', restored: '¡Configuración recuperada!',
      no_saved: 'Ninguna configuración guardada encontrada.', hyb: 'HÍBRIDA',
      etq_cfg: 'Configurar etiqueta', width_cm: 'Ancho (cm)', height_cm: 'Alto (cm)',
      pad_cm: 'Margen (cm)', etq_hint: 'El QR ocupa el lateral y el texto se ajusta al alto.', save: 'Guardar',
      base_missing: 'Sin QR en la base — importá la extração para imprimir los códigos.',
      base_partial: 'sacas todavía sin QR. Importá/actualizá la extração.',
      base_ok: 'Base de QR cargada.'
    }
  };
  function t(k) { return (I18N[state.lang] && I18N[state.lang][k]) || I18N.pt[k] || k; }
  function applyLang() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var k = el.getAttribute('data-i18n'); if (I18N[state.lang][k]) el.textContent = I18N[state.lang][k];
    });
    var s = $('searchInput'); if (s) s.placeholder = state.lang === 'pt' ? 'Buscar rota (ex: G1)…' : 'Buscar ruta (ej: G1)…';
  }

  // ---------------------------------------------------------------- helpers
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var toastTimer = null;
  function toast(msg, ok) {
    var el = $('toast'); el.textContent = msg;
    el.className = 'toast show ' + (ok === false ? 'err' : 'ok');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 2400);
  }
  function excludedSet() { return new Set(state.excluded); }
  function selectionSet() { return new Set(state.selection); }
  function prefixOf(id) { return String(id || '').split(/[_-]/)[0].toUpperCase(); }

  // Limpa o nome do veículo -> MODAL curto (ex.: "Veiculo de Passeio Extra 6h" -> "PASSEIO 6H")
  function limparVeiculo(txt) {
    if (!txt) return '';
    return String(txt)
      .replace(/Ve[ií]culos? de Passeio Extra 4h/ig, 'PASSEIO 4H')
      .replace(/Ve[ií]culos? de Passeio Extra 6h/ig, 'PASSEIO 6H')
      .replace(/Ve[ií]culos? de Passeio 4h/ig, 'PASSEIO 4H')
      .replace(/Ve[ií]culos? de Passeio 6h/ig, 'PASSEIO 6H')
      .replace(/Ve[ií]culos? de Passeio/ig, 'PASSEIO')
      .trim().toUpperCase();
  }

  // ---------------------------------------------------------------- persistence
  function persist() { state.updatedAt = new Date().toISOString(); window.GridStore.saveDebounced(state, 400); }

  async function init() {
    var loaded = await window.GridStore.load();
    if (loaded && loaded.schemaVersion === SCHEMA_VERSION) state = loaded;
    if (!state.cfgEtq) state.cfgEtq = { w: 12, h: 5, p: 0.4 };
    var badge = $('storageBadge');
    if (window.GridStore.isRunningInGrid()) { badge.textContent = 'Grid'; badge.classList.remove('local'); }
    else { badge.textContent = 'Local (preview)'; badge.classList.add('local'); }
    $('langSelect').value = state.lang;
    $('siteSelect').value = state.site;
    applyLang();
    render();
  }

  // ---------------------------------------------------------------- CSV
  function parseDelimited(text) {
    var first = (text.split(/\r\n|\n/, 1)[0] || '');
    var cand = [',', ';', '\t'];
    var delim = cand.reduce(function (b, d) { return first.split(d).length > first.split(b).length ? d : b; }, ',');
    var rows = [], row = [], f = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
      else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows;
  }
  function col(headers, cands) {
    var up = headers.map(function (h) { return h.trim().toUpperCase(); });
    for (var i = 0; i < cands.length; i++) { var x = up.indexOf(cands[i]); if (x !== -1) return x; }
    for (var j = 0; j < cands.length; j++) for (var k = 0; k < up.length; k++) if (up[k].indexOf(cands[j]) !== -1) return k;
    return -1;
  }

  function chooseFile(kind) {
    var input = $('fileInput'); input.value = '';
    input.onchange = function (e) {
      var file = e.target.files && e.target.files[0]; if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        var rows = parseDelimited(String(ev.target.result || ''));
        if (rows.length < 2) { toast('Arquivo vazio ou inválido.', false); return; }
        pending = { kind: kind, headers: rows[0].map(function (h) { return h.trim(); }),
          rows: rows.slice(1).filter(function (r) { return r.some(function (v) { return v.trim() !== ''; }); }),
          fileName: file.name };
        if (kind === 'opt') importOptimization(); else importExtracao();
      };
      reader.readAsText(file, 'UTF-8');
    };
    input.click();
  }

  // ---------------------------------------------------------------- imports
  function importOptimization() {
    var h = pending.headers;
    var iPl = col(h, ['ID PLANEJADO', 'ROTAPL', 'PLANEJADO']);
    var iOt = col(h, ['ID OTIMIZADO', 'ROTAOT', 'OTIMIZADO', 'ROTA']);
    var iSac = col(h, ['QUANTIDADE DE SACAS', 'QTD_SACAS', 'SACAS', 'QUANTIDADE']);
    var iSrv = col(h, ['TIPOS DE SERVIÇOS', 'TIPOS DE SERVICOS', 'SERVICO', 'SERVIÇO']);
    if (iOt === -1 || iSac === -1) { toast('CSV de otimização inválido: faltam colunas de rota/sacas.', false); return; }

    var groups = [], seen = {};
    pending.rows.forEach(function (r) {
      var srv = iSrv !== -1 ? String(r[iSrv] || '').toLowerCase() : 'hybrid';
      if (iSrv !== -1 && srv.indexOf('hybrid') === -1 && srv.indexOf('hibrid') === -1 && srv.indexOf('nex') === -1) return;
      var cnt = parseInt(r[iSac], 10); if (isNaN(cnt) || cnt <= 0) return;
      var full = String(r[iOt] || '').trim().toUpperCase(); if (!full) return;
      var name = prefixOf(full);
      if (seen[name] != null) { groups[seen[name]].count += cnt; return; }
      seen[name] = groups.length;
      groups.push({ name: name, fullName: full, planned: iPl !== -1 ? String(r[iPl] || '').trim().toUpperCase() : '',
        hybrid: true, count: cnt, realSacas: null });
    });
    if (!groups.length) { toast('Nenhuma rota híbrida (NEX) encontrada no arquivo.', false); return; }

    assignRunningNumbers(groups);
    state.source = 'opt'; state.groups = groups; state.optFileName = pending.fileName; state.selection = [];
    pending = null; persist(); render();
    toast(groups.length + (state.lang === 'pt' ? ' rotas carregadas' : ' rutas cargadas'), true);
  }

  function assignRunningNumbers(groups) {
    var skip = excludedSet(), n = 1;
    groups.forEach(function (g) {
      var arr = [], got = 0;
      while (got < g.count) { if (!skip.has(n)) { arr.push(n); got++; } n++; }
      g.realSacas = arr;
    });
  }

  function importExtracao() {
    var h = pending.headers;
    var iRota = col(h, ['ROTASACA']);
    var iOt = col(h, ['ROTAOT', 'ID OTIMIZADO']);
    var iPl = col(h, ['ROTAPL', 'ID PLANEJADO']);
    var iQr = col(h, ['CONTAINER_QR', 'CÓDIGO QR', 'CODIGO QR', 'CODIGO', 'QR']);
    var iCid = col(h, ['CONTAINER_ID']);
    var iCode = col(h, ['ROTASACAPL']);
    var iAg = col(h, ['AGENCIA', 'AGÊNCIA']);
    var iVe = col(h, ['VEICULO', 'VEÍCULO', 'MODAL']);
    if (iRota === -1 || iOt === -1) { toast('CSV de extração inválido: faltam ROTASACA/ROTAOT.', false); return; }

    var byGroup = {}, order = [], qr = {}, meta = {}, skipped = 0;
    pending.rows.forEach(function (r) {
      var numRaw = String(r[iRota] || '').trim();
      if (!/^\d+$/.test(numRaw)) { skipped++; return; }   // só sacas NEX (ROTASACA numérica)
      var num = parseInt(numRaw, 10);
      var full = String(r[iOt] || '').trim().toUpperCase(); if (!full) return;
      var name = prefixOf(full);
      if (!byGroup[name]) { byGroup[name] = { name: name, fullName: full,
        planned: iPl !== -1 ? String(r[iPl] || '').trim().toUpperCase() : '', nums: [] }; order.push(name); }
      byGroup[name].nums.push(num);

      var qrStr = iQr !== -1 ? String(r[iQr] || '').trim() : '';
      if (!qrStr && iCid !== -1 && String(r[iCid] || '').trim()) {
        var cid = parseInt(r[iCid], 10);
        qrStr = JSON.stringify({ container_id: isNaN(cid) ? String(r[iCid]).trim() : cid, facility_id: state.site, assignment: numRaw });
      }
      if (qrStr) qr[num] = qrStr;
      meta[num] = { agencia: iAg !== -1 ? String(r[iAg] || '').trim() : '',
        veiculo: iVe !== -1 ? limparVeiculo(r[iVe]) : '',
        rotasacapl: iCode !== -1 ? String(r[iCode] || '').trim() : '' };
    });
    if (!order.length) { toast('Nenhuma saca NEX (ROTASACA numérica) encontrada.', false); return; }

    var groups = order.map(function (name) {
      var g = byGroup[name]; g.nums.sort(function (a, b) { return a - b; });
      return { name: g.name, fullName: g.fullName, planned: g.planned, hybrid: true, count: g.nums.length, realSacas: g.nums };
    });

    state.source = 'extr'; state.groups = groups; state.qrByNum = qr; state.metaByNum = meta;
    state.optFileName = pending.fileName; state.excluded = []; state.selection = [];
    pending = null; persist(); render();
    var msg = groups.length + (state.lang === 'pt' ? ' rotas' : ' rutas') + ' · ' + Object.keys(qr).length + ' QR';
    if (skipped) msg += ' (' + skipped + (state.lang === 'pt' ? ' linhas de rota/CHP ignoradas' : ' filas de ruta/CHP ignoradas') + ')';
    toast(msg, true);
  }

  function clearOptimization() {
    state.source = null; state.groups = []; state.selection = []; state.excluded = []; state.optFileName = null;
    persist(); render();
  }
  function restoreSaved() {
    if (!state.groups.length) { toast(t('no_saved'), false); return; }
    render(); toast(t('restored'), true);
  }

  // ---------------------------------------------------------------- rendering
  function renderableNums(group) {
    if (state.source === 'opt') assignRunningNumbers(state.groups);
    var skip = excludedSet();
    return group.realSacas.filter(function (n) { return !skip.has(n); });
  }
  function hasQr(num) { return !!state.qrByNum[num]; }

  function render() {
    var has = state.groups.length > 0;
    $('emptyState').style.display = has ? 'none' : 'flex';
    $('gridWrapper').style.display = has ? 'block' : 'none';
    $('activeFile').style.display = state.optFileName ? 'inline-flex' : 'none';
    if (state.optFileName) $('activeFileName').textContent = state.optFileName;
    $('lastSave').textContent = state.lastSave ? (t('last_save') + state.lastSave) : '';
    $('btnCfgEtq').style.display = $('formatSelect').value === 'etiqueta' ? 'inline-flex' : 'none';
    if (has) { renderBanner(); renderRoutes(); }
    updatePrintBar();
  }

  function renderBanner() {
    var b = $('baseBanner'), msg = $('baseBannerMsg');
    var totalNums = 0, withQr = 0;
    state.groups.forEach(function (g) { renderableNums(g).forEach(function (n) { totalNums++; if (hasQr(n)) withQr++; }); });
    if (totalNums === 0) { b.style.display = 'none'; return; }
    if (withQr === 0) { b.className = 'banner'; msg.textContent = t('base_missing'); b.style.display = 'flex'; }
    else if (withQr < totalNums) { b.className = 'banner'; msg.textContent = (totalNums - withQr) + ' ' + t('base_partial'); b.style.display = 'flex'; }
    else { b.className = 'banner ok'; msg.textContent = t('base_ok'); b.style.display = 'flex'; }
  }

  function renderRoutes() {
    var wrap = $('routesWrap');
    var term = ($('searchInput').value || '').trim().toUpperCase();
    var sel = selectionSet();
    wrap.innerHTML = '';

    state.groups.forEach(function (group) {
      if (term && group.name.indexOf(term) === -1) return;
      var nums = renderableNums(group);
      var card = document.createElement('div'); card.className = 'route-card';
      var head = '<div class="route-head">' +
        '<span class="name">' + esc(group.name) + '</span>' +
        '<span class="badge">' + nums.length + ' ' + t('bags') + '</span>' +
        (group.hybrid ? '<span class="badge hyb">' + t('hyb') + '</span>' : '') +
        (group.fullName && group.fullName !== group.name ? '<span class="full-route">' + esc(group.fullName) + (group.planned ? ' · ' + esc(group.planned) : '') + '</span>' : '') +
        '<span style="flex:1"></span>' +
        '<button class="btn ghost sm selGroup" data-g="' + esc(group.name) + '">' + t('sel_group') + '</button>' +
        '</div>';
      var grid = '<div class="saca-grid">';
      nums.forEach(function (num) {
        var isSel = sel.has(num);
        grid += '<button class="saca' + (isSel ? ' selected' : '') + '" data-num="' + num + '">' + num +
          '<span class="dot' + (hasQr(num) ? ' has' : '') + '" title="' + (hasQr(num) ? 'QR' : 'sem QR') + '"></span>' +
          '<span class="rm" data-rm="' + num + '">&times;</span></button>';
      });
      grid += '</div>';
      card.innerHTML = head + grid; wrap.appendChild(card);
    });

    wrap.querySelectorAll('.saca').forEach(function (btn) {
      var num = parseInt(btn.getAttribute('data-num'), 10);
      btn.addEventListener('click', function (e) {
        if (e.target.getAttribute('data-rm')) return;
        var s = selectionSet(); if (s.has(num)) s.delete(num); else s.add(num);
        state.selection = Array.from(s); persist(); renderRoutes(); updatePrintBar();
      });
    });
    wrap.querySelectorAll('.rm').forEach(function (x) {
      x.addEventListener('click', function (e) {
        e.stopPropagation();
        var num = parseInt(x.getAttribute('data-rm'), 10);
        var ex = excludedSet(); ex.add(num); state.excluded = Array.from(ex);
        var s = selectionSet(); s.delete(num); state.selection = Array.from(s);
        persist(); render();
      });
    });
    wrap.querySelectorAll('.selGroup').forEach(function (b) {
      b.addEventListener('click', function () { selectGroup(b.getAttribute('data-g')); });
    });
  }

  function selectGroup(name) {
    var group = state.groups.filter(function (g) { return g.name === name; })[0]; if (!group) return;
    var nums = renderableNums(group);
    var s = selectionSet();
    var allSel = nums.length > 0 && nums.every(function (n) { return s.has(n); });
    nums.forEach(function (n) { if (allSel) s.delete(n); else s.add(n); });
    state.selection = Array.from(s); persist(); renderRoutes(); updatePrintBar();
  }
  function selectAllVisible() {
    var term = ($('searchInput').value || '').trim().toUpperCase();
    var s = selectionSet(), all = [];
    state.groups.forEach(function (g) { if (term && g.name.indexOf(term) === -1) return; renderableNums(g).forEach(function (n) { all.push(n); }); });
    var allSel = all.length > 0 && all.every(function (n) { return s.has(n); });
    all.forEach(function (n) { if (allSel) s.delete(n); else s.add(n); });
    state.selection = Array.from(s); persist(); renderRoutes(); updatePrintBar();
  }
  function updatePrintBar() { var n = state.selection.length; $('printCount').textContent = n; $('btnPrint').disabled = (n === 0); }

  function saveChoice() {
    state.lastSave = new Date().toLocaleString(state.lang === 'pt' ? 'pt-BR' : 'es-AR');
    window.GridStore.saveNow(state);
    $('lastSave').textContent = t('last_save') + state.lastSave;
    toast(t('saved_ok'), true);
  }

  // ---------------------------------------------------------------- extraction viewer
  function openExtracao() {
    var nums = Object.keys(state.metaByNum).map(Number).sort(function (a, b) { return a - b; });
    var numToGroup = {};
    state.groups.forEach(function (g) { (g.realSacas || []).forEach(function (n) { numToGroup[n] = g.name; }); });
    $('extracaoHead').innerHTML = '<tr><th>ROTASACA</th><th>ROTA</th><th>ROTASACAPL</th><th>AGÊNCIA</th><th>MODAL</th><th>QR</th></tr>';
    $('extracaoBody').innerHTML = nums.map(function (n) {
      var m = state.metaByNum[n] || {};
      return '<tr><td>' + n + '</td><td>' + esc(numToGroup[n] || '') + '</td><td>' + esc(m.rotasacapl || '') +
        '</td><td>' + esc(m.agencia || '') + '</td><td>' + esc(m.veiculo || '') + '</td><td>' + (hasQr(n) ? '✓' : '—') + '</td></tr>';
    }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text-2);padding:24px">Sem dados. Importe a extração (QR).</td></tr>';
    $('extracaoFoot').textContent = nums.length + (state.lang === 'pt' ? ' sacas na extração.' : ' sacas en la extración.');
    $('extracaoOverlay').classList.add('open');
  }

  // ---------------------------------------------------------------- print
  function makeQrSvg(txt) {
    if (!txt) return '<div style="font:900 11pt Arial;color:#999">QR PENDENTE</div>';
    var qr = window.qrcode(0, 'M'); qr.addData(txt); qr.make();
    return qr.createSvgTag({ cellSize: 3, margin: 1, scalable: true });
  }
  function selectedItems() {
    var numToGroup = {}; state.groups.forEach(function (g) { (g.realSacas || []).forEach(function (n) { numToGroup[n] = g; }); });
    return state.selection.slice().sort(function (a, b) { return a - b; }).map(function (num) {
      var g = numToGroup[num]; if (!g) return null;
      var m = state.metaByNum[num] || {};
      return { num: num, route: g.name, agencia: m.agencia || '', modal: m.veiculo || '', qr: state.qrByNum[num] || '' };
    }).filter(Boolean);
  }

  function dynStyle(css) {
    var el = $('dyn-print'); if (!el) { el = document.createElement('style'); el.id = 'dyn-print'; document.head.appendChild(el); }
    el.textContent = css || '';
  }

  function printSelection() {
    var fmt = $('formatSelect').value;
    var items = selectedItems(); if (!items.length) return;
    var area = $('print-area'); var html = '';
    dynStyle('');

    if (fmt === 'cartao') {
      for (var i = 0; i < items.length; i += 4) {
        var ch = items.slice(i, i + 4);
        html += '<div class="print-page"><div class="print-grid">';
        ch.forEach(function (it) {
          html += '<div class="card-et"><div class="c-num"><h1>' + esc(it.num) + '</h1></div>' +
            '<div class="c-route"><h2>' + esc(it.route) + '</h2></div>' +
            '<div class="c-field"><span>' + esc(it.agencia || '—') + '</span></div>' +
            '<div class="c-field"><span>' + esc(it.modal || '—') + '</span></div>' +
            '<div class="c-qr">' + makeQrSvg(it.qr) + '</div></div>';
        });
        for (var j = ch.length; j < 4; j++) html += '<div class="card-et empty"></div>';
        html += '</div></div>';
      }
    } else if (fmt === 'folha') {
      items.forEach(function (it) {
        var qr = makeQrSvg(it.qr);
        function half(side) {
          return '<div class="quad ' + side + '"><div class="fbox">' +
            '<div class="fcell qN">' + qr + '</div>' +
            '<div class="fcell num"><span class="rot f-num">' + esc(it.num) + '</span></div>' +
            '<div class="fcell qS">' + qr + '</div>' +
            '<div class="fcell ag"><span class="rot f-info">' + esc(it.agencia || '—') + '</span></div>' +
            '<div class="fcell rt f-gray"><span class="rot f-route">' + esc(it.route) + '</span></div>' +
            '<div class="fcell md"><span class="rot f-info">' + esc(it.modal || '—') + '</span></div>' +
            '</div></div>';
        }
        html += '<div class="folha-page">' + half('oeste') + half('leste') + '</div>';
      });
    } else { // etiqueta
      var c = state.cfgEtq, inner = (c.h - c.p * 2);
      var fs = (inner / 4 * 0.82).toFixed(2) + 'cm';
      dynStyle('@media print{@page{size:' + c.w + 'cm ' + c.h + 'cm;margin:0}' +
        '.etq{width:' + c.w + 'cm;height:' + c.h + 'cm;padding:' + c.p + 'cm;--etq-fs:' + fs + '}' +
        '.etq .qr{width:' + inner + 'cm;height:' + inner + 'cm}}');
      items.forEach(function (it) {
        html += '<div class="etq"><div class="qr">' + makeQrSvg(it.qr) + '</div><div class="lines">' +
          '<div class="ln"><span class="k">SACA:</span>' + esc(it.num) + '</div>' +
          '<div class="ln"><span class="k">ROTA:</span>' + esc(it.route) + '</div>' +
          '<div class="ln"><span class="k">AGÊNCIA:</span>' + esc(it.agencia || '—') + '</div>' +
          '<div class="ln"><span class="k">MODAL:</span>' + esc(it.modal || '—') + '</div>' +
          '</div></div>';
      });
    }

    area.innerHTML = html;
    setTimeout(function () { window.print(); setTimeout(function () { area.innerHTML = ''; dynStyle(''); }, 800); }, 350);
  }

  // ---------------------------------------------------------------- config etiqueta
  function openCfg() {
    $('cfgW').value = state.cfgEtq.w; $('cfgH').value = state.cfgEtq.h; $('cfgP').value = state.cfgEtq.p;
    $('cfgOverlay').classList.add('open');
  }
  function saveCfg() {
    state.cfgEtq = { w: parseFloat($('cfgW').value) || 12, h: parseFloat($('cfgH').value) || 5, p: parseFloat($('cfgP').value) || 0.4 };
    persist(); $('cfgOverlay').classList.remove('open'); toast(t('saved_ok'), true);
  }

  // ---------------------------------------------------------------- wiring
  document.addEventListener('DOMContentLoaded', function () {
    ['btnAnexar', 'btnAnexar2'].forEach(function (id) { $(id).addEventListener('click', function () { chooseFile('opt'); }); });
    ['btnExtracao', 'btnExtracao2', 'btnBannerExtr'].forEach(function (id) { $(id).addEventListener('click', function () { chooseFile('extr'); }); });
    ['btnRecuperar', 'btnRecuperar2'].forEach(function (id) { $(id).addEventListener('click', restoreSaved); });
    $('btnLimparOtim').addEventListener('click', clearOptimization);

    $('searchInput').addEventListener('input', renderRoutes);
    $('btnSelAll').addEventListener('click', selectAllVisible);
    $('btnClearSel').addEventListener('click', function () { state.selection = []; persist(); renderRoutes(); updatePrintBar(); });
    $('btnRestore').addEventListener('click', function () {
      state.excluded = []; persist(); render();
      toast(state.lang === 'pt' ? 'Sacas restauradas!' : '¡Sacas restauradas!', true);
    });
    $('btnVerExtracao').addEventListener('click', openExtracao);
    $('closeExtracao').addEventListener('click', function () { $('extracaoOverlay').classList.remove('open'); });
    $('extracaoOverlay').addEventListener('click', function (e) { if (e.target === this) this.classList.remove('open'); });

    $('btnSalvar').addEventListener('click', saveChoice);
    $('btnPrint').addEventListener('click', printSelection);
    $('formatSelect').addEventListener('change', function () {
      $('btnCfgEtq').style.display = this.value === 'etiqueta' ? 'inline-flex' : 'none';
    });
    $('btnCfgEtq').addEventListener('click', openCfg);
    $('closeCfg').addEventListener('click', function () { $('cfgOverlay').classList.remove('open'); });
    $('cancelCfg').addEventListener('click', function () { $('cfgOverlay').classList.remove('open'); });
    $('saveCfg').addEventListener('click', saveCfg);

    $('siteSelect').addEventListener('change', function () { state.site = this.value; persist(); });
    $('langSelect').addEventListener('change', function () { state.lang = this.value; persist(); applyLang(); render(); });

    init();
  });
})();
