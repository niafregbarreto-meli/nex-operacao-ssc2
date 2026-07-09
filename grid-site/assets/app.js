(function () {
  'use strict';

  var SCHEMA_VERSION = 6;

  // ---- Fonte automática do QR (base publicada, atualizada por query diária) ----
  // CSV publicado (Arquivo → Publicar na web) — NÃO precisa de OAuth Google,
  // é um GET público. É a forma mais simples e robusta de trazer o CONTAINER_QR
  // de cada saca sem o operador subir nada. Editável no ⚙ (Configurações) se
  // a aba/planilha mudar.
  var DEFAULT_QR_BASE_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ5DW6wEKmJICM9ijwUQR_06YYJNLiXFSjzDiPd04WcXcgoRRz2kW8h8LyCxeMEnxvvcOKnYGhwJa2f/pub?gid=1505849780&single=true&output=csv';
  // Fallback via SDK do Grid (precisa Google conectado no Grid) — usado só se o
  // fetch do CSV publicado for bloqueado por CSP no iframe do Grid.
  var GRID_SHEET_ID = '1w31lqax56lMcjbvoj5VhdDf9gwEYSh2ldjMuTb9WV8Y';
  var GRID_SHEET_TABS = ['SEPARACAO_NEX', 'EXTRACAO_NEX', 'EXTRACAO', 'Extração', 'EXTRAÇÃO', 'EXTRAÇÃO_NEX', 'BASE EXTRACAO', 'BASE EXTRAÇÃO'];

  // Diagnóstico da última tentativa de carga da base (mostrado no ⚙).
  var qrDiag = { attempts: [] };

  function defaultState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: null,
      site: 'SSC2',
      lang: 'pt',
      source: null,            // 'opt' | 'extr'
      optFileName: null,
      lastSave: null,
      lastSheetSync: null,
      qrBaseUrl: DEFAULT_QR_BASE_URL,
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
      attach_csv: 'Anexar CSV', load_extr: 'Extração (QR)', load_qr_extra: '+ QR adicional', load_saved: 'Recuperar salvo',
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
      base_missing: 'Sem QR na base — clique em "Atualizar QR" ou verifique a conexão com o Google no Grid.',
      base_partial: 'sacas ainda sem QR na planilha.',
      base_ok: 'Todas as sacas têm QR real.',
      extraction: 'Extração (QR)', sync_now: 'Atualizar QR', manual_csv: 'CSV manual (avançado)',
      sync_syncing: 'Buscando QR…', sync_ok: 'QR OK · ',
      sync_fail_all: 'Não consegui trazer o QR automaticamente. Veja Configurações ⚙ → Diagnóstico.',
      sync_no_qr_cols: 'Base lida, mas sem coluna de QR (CONTAINER_QR/CONTAINER_ID). Veja ⚙ → Diagnóstico.',
      settings: 'Configurações', advanced: 'Avançado', diag: 'Diagnóstico', qr_base_url: 'URL da base de QR (CSV publicado)',
      test_conn: 'Testar / atualizar agora', no_diag: 'Nenhuma tentativa ainda.', close: 'Fechar', upload_opt: 'Subir otimização',
      clear_all: 'Limpar tudo (recomeçar)', clear_all_confirm: 'Isso apaga a otimização, seleção e QR salvos. Continuar?', cleared_ok: 'Tudo limpo!',
      change_opt: 'Trocar'
    },
    es: {
      site: 'Sitio', avail_bags: 'Sacas disponibles ↗', optimization: 'Optimización',
      attach_csv: 'Adjuntar CSV', load_extr: 'Extração (QR)', load_qr_extra: '+ QR adicional', load_saved: 'Recuperar guardado',
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
      base_missing: 'Sin QR en la base — hacé clic en "Actualizar QR" o revisá la conexión con Google en Grid.',
      base_partial: 'sacas todavía sin QR en la planilla.',
      base_ok: 'Todas las sacas tienen QR real.',
      extraction: 'Extração (QR)', sync_now: 'Actualizar QR', manual_csv: 'CSV manual (avanzado)',
      sync_syncing: 'Buscando QR…', sync_ok: 'QR OK · ',
      sync_fail_all: 'No pude traer el QR automáticamente. Mirá Configuración ⚙ → Diagnóstico.',
      sync_no_qr_cols: 'Base leída, pero sin columna de QR (CONTAINER_QR/CONTAINER_ID). Mirá ⚙ → Diagnóstico.',
      settings: 'Configuración', advanced: 'Avanzado', diag: 'Diagnóstico', qr_base_url: 'URL de la base de QR (CSV publicado)',
      test_conn: 'Probar / actualizar ahora', no_diag: 'Ninguna tentativa aún.', close: 'Cerrar', upload_opt: 'Subir optimización',
      clear_all: 'Limpiar todo (reiniciar)', clear_all_confirm: 'Esto borra la optimización, selección y QR guardados. ¿Continuar?', cleared_ok: '¡Todo limpio!',
      change_opt: 'Cambiar'
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
    // Auto-sync desligado por ora (estava trazendo dados que não têm nada a
    // ver com a otimização do dia). QR só é buscado quando o operador clica
    // "Atualizar QR" ou "Testar/atualizar agora" em Configurações.
  }

  // ---------------------------------------------------------------- QR base auto-load
  //
  // O QR de cada saca vem sozinho de uma base publicada (query diária). Duas
  // vias, tentadas em ordem, primeiro sucesso ganha:
  //   1) fetch() do CSV publicado — GET público, SEM OAuth. É a que a URL do
  //      usuário aponta e a mais simples. Pode ser bloqueada por CSP no iframe.
  //   2) Grid.sheets.get() — SDK do Grid (precisa Google conectado). Sanctioned.
  // Se as duas falharem, resta o CSV manual (no ⚙). Cada tentativa fica em
  // qrDiag para o painel de diagnóstico mostrar exatamente o que voltou.
  var gridConfigured = false;

  function getGridDocId() {
    try {
      if (window.GRID && window.GRID.docId) return window.GRID.docId;
      var m = /\/d\/([^/]+)\/raw/.exec(document.location.pathname);
      if (m) return m[1];
    } catch (e) { /* ignore */ }
    return null;
  }
  function ensureGridSheetsReady() {
    if (gridConfigured) return true;
    if (!(window.Grid && typeof window.Grid.configure === 'function' && window.Grid.sheets)) return false;
    var docId = getGridDocId();
    if (!docId) return false;
    window.Grid.configure({ docId: docId });
    gridConfigured = true;
    return true;
  }

  function setSyncStatus(msg, kind) {
    var el = $('syncStatus'); if (!el) return;
    el.textContent = msg || '';
    el.style.color = kind === 'err' ? 'var(--error)' : kind === 'ok' ? 'var(--success)' : 'var(--text-2)';
    el.style.display = msg ? 'inline' : 'none';
  }

  function extractRows(result) {
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.values)) return result.values;
    if (result && Array.isArray(result.rows)) return result.rows;
    if (result && result.sheets) { for (var k in result.sheets) { if (Array.isArray(result.sheets[k])) return result.sheets[k]; } }
    return null;
  }
  function normalizeSheetRows(data) {
    var rows = extractRows(data);
    if (!rows || !rows.length) return null;
    if (Array.isArray(rows[0])) {
      var headers = rows[0].map(function (h) { return String(h == null ? '' : h).trim(); });
      var dataRows = rows.slice(1)
        .filter(function (r) { return r.some(function (v) { return String(v == null ? '' : v).trim() !== ''; }); })
        .map(function (r) { return r.map(function (v) { return v == null ? '' : String(v); }); });
      return { headers: headers, rows: dataRows };
    }
    if (rows[0] && typeof rows[0] === 'object') {
      var headers2 = Object.keys(rows[0]);
      var rows2 = rows.map(function (obj) { return headers2.map(function (h) { return obj[h] == null ? '' : String(obj[h]); }); });
      return { headers: headers2, rows: rows2 };
    }
    return null;
  }

  // Aplica a base ao estado. Preenche SÓ qrByNum/metaByNum das sacas que já
  // existem (numeração vem sempre da otimização, subida manual). A base
  // nunca cria rota nem saca — se ainda não há otimização subida, esta
  // função não tem nada para preencher e a tela vazia continua visível.
  // Nunca reseta seleção/exclusão do operador.
  function applyQrBase(parsed) {
    var h = parsed.headers;
    var iNum = col(h, ['ROTASACA', 'SACA', 'NUMERO_NEX']);
    var iOt = col(h, ['ROTAOT', 'ID OTIMIZADO', 'ROTA']);
    var iQr = col(h, ['CONTAINER_QR', 'CÓDIGO QR', 'CODIGO QR', 'CODIGO', 'QR']);
    var iCid = col(h, ['CONTAINER_ID']);
    var iCode = col(h, ['ROTASACAPL']);
    var iAg = col(h, ['AGENCIA', 'AGÊNCIA']);
    var iVe = col(h, ['VEICULO', 'VEÍCULO', 'MODAL']);

    // número da saca: ROTASACA se existir; senão a coluna de rota que for numérica.
    function sacaNumOf(r) {
      if (iNum !== -1 && /^\d+$/.test(String(r[iNum] || '').trim())) return parseInt(r[iNum], 10);
      if (iOt !== -1 && /^\d+$/.test(String(r[iOt] || '').trim())) return parseInt(r[iOt], 10);
      return null;
    }
    function qrOf(r, numRaw) {
      var q = iQr !== -1 ? String(r[iQr] || '').trim() : '';
      if (!q && iCid !== -1 && String(r[iCid] || '').trim()) {
        var cid = parseInt(r[iCid], 10);
        q = JSON.stringify({ container_id: isNaN(cid) ? String(r[iCid]).trim() : cid, facility_id: state.site, assignment: String(numRaw) });
      }
      return q;
    }

    var qrCount = 0;
    var knownNums = {};
    state.groups.forEach(function (g) { (g.realSacas || []).forEach(function (n) { knownNums[n] = true; }); });

    parsed.rows.forEach(function (r) {
      var num = sacaNumOf(r); if (num == null) return;
      if (!knownNums[num]) return; // base nunca cria saca — só completa as que a otimização já criou
      var q = qrOf(r, num); if (q) { state.qrByNum[num] = q; qrCount++; }
      var ag = iAg !== -1 ? String(r[iAg] || '').trim() : '';
      var ve = iVe !== -1 ? limparVeiculo(r[iVe]) : '';
      var code = iCode !== -1 ? String(r[iCode] || '').trim() : '';
      if (ag || ve || code) {
        var prev = state.metaByNum[num] || {};
        state.metaByNum[num] = { agencia: ag || prev.agencia || '', veiculo: ve || prev.veiculo || '', rotasacapl: code || prev.rotasacapl || '' };
      }
    });
    return { qrCount: qrCount, rowCount: parsed.rows.length, headers: h };
  }

  async function tryFetchPublishedCsv() {
    var url = state.qrBaseUrl || DEFAULT_QR_BASE_URL;
    var attempt = { via: 'CSV publicado (fetch)', url: url, ok: false };
    try {
      var res = await fetch(url, { credentials: 'omit' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var text = await res.text();
      var rows = parseDelimited(text);
      if (rows.length < 2) throw new Error('CSV vazio/sem linhas');
      var parsed = { headers: rows[0].map(function (x) { return x.trim(); }),
        rows: rows.slice(1).filter(function (r) { return r.some(function (v) { return v.trim() !== ''; }); }) };
      attempt.ok = true; attempt.columns = parsed.headers; attempt.rowCount = parsed.rows.length;
      attempt.sample = parsed.rows.slice(0, 2);
      qrDiag.attempts.push(attempt);
      return parsed;
    } catch (err) {
      attempt.error = (err && err.message) ? err.message : String(err);
      qrDiag.attempts.push(attempt);
      return null;
    }
  }

  // Testa TODAS as abas candidatas (não para na primeira que responder) —
  // uma aba pode existir e responder sem ter a coluna de QR (ex.:
  // SEPARACAO_NEX). Só aceita de vez uma aba que realmente tenha
  // CONTAINER_QR/CONTAINER_ID; senão guarda a primeira que respondeu como
  // último recurso e continua procurando.
  async function tryGridSheets() {
    if (!ensureGridSheetsReady()) {
      qrDiag.attempts.push({ via: 'Grid.sheets', ok: false, error: window.GridStore.isRunningInGrid() ? 'Grid.sheets indisponível' : 'fora do Grid' });
      return null;
    }
    var fallback = null;
    for (var i = 0; i < GRID_SHEET_TABS.length; i++) {
      var tab = GRID_SHEET_TABS[i];
      var attempt = { via: 'Grid.sheets', tab: tab, ok: false };
      try {
        var data;
        try { data = await window.Grid.sheets.get(GRID_SHEET_ID, tab); }
        catch (e1) { data = await window.Grid.sheets.get(GRID_SHEET_ID, tab + '!A:Z'); }
        var parsed = normalizeSheetRows(data);
        if (parsed && parsed.rows.length) {
          attempt.ok = true; attempt.columns = parsed.headers; attempt.rowCount = parsed.rows.length; attempt.sample = parsed.rows.slice(0, 2);
          qrDiag.attempts.push(attempt);
          var hasQrCol = col(parsed.headers, ['CONTAINER_QR', 'CÓDIGO QR', 'CODIGO QR', 'CODIGO', 'QR']) !== -1 ||
            col(parsed.headers, ['CONTAINER_ID']) !== -1;
          if (hasQrCol) return parsed;
          if (!fallback) fallback = parsed;
          continue;
        }
        attempt.error = 'vazio'; qrDiag.attempts.push(attempt);
      } catch (err) {
        attempt.error = (err && err.message) ? err.message : String(err);
        qrDiag.attempts.push(attempt);
      }
    }
    return fallback;
  }

  async function loadQrBase(silent) {
    qrDiag = { attempts: [], at: new Date().toLocaleString(state.lang === 'pt' ? 'pt-BR' : 'es-AR') };
    setSyncStatus(t('sync_syncing'));
    var parsed = await tryFetchPublishedCsv();
    if (!parsed) parsed = await tryGridSheets();
    if (!parsed) {
      setSyncStatus(t('sync_fail_all'), silent ? null : 'err');
      renderDiag();
      return false;
    }
    var info = applyQrBase(parsed);
    state.lastSheetSync = new Date().toLocaleTimeString(state.lang === 'pt' ? 'pt-BR' : 'es-AR');
    persist(); render(); renderDiag();
    if (info.qrCount === 0) { setSyncStatus(t('sync_no_qr_cols'), 'err'); return false; }
    setSyncStatus(t('sync_ok') + state.lastSheetSync + ' · ' + info.qrCount + ' QR', 'ok');
    return true;
  }
  // alias antigo
  function syncFromSheet(silent) { return loadQrBase(silent); }

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
        if (kind === 'opt') importOptimization();
        else if (kind === 'qrfb') importQrFallback();
        else importExtracao();
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
    // Nova otimização = numeração global do zero: exclusões/seleção da rodada
    // anterior não têm mais sentido (o mesmo número agora é outra saca).
    state.source = 'opt'; state.groups = groups; state.optFileName = pending.fileName;
    state.selection = []; state.excluded = [];
    pending = null; persist(); render();
    toast(groups.length + (state.lang === 'pt' ? ' rotas carregadas' : ' rutas cargadas'), true);
    // QR fica pendente até o operador clicar "Atualizar QR" (auto-sync desligado por ora).
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

    // Não reseta selection/excluded: isto agora corre automaticamente em todo
    // load (auto-sync da planilha), e o número da saca não muda — só chegam
    // dados reais (QR/agência/modal) para o que já existia.
    state.source = 'extr'; state.groups = groups; state.qrByNum = qr; state.metaByNum = meta;
    state.optFileName = pending.fileName;
    pending = null; persist(); render();
    var msg = groups.length + (state.lang === 'pt' ? ' rotas' : ' rutas') + ' · ' + Object.keys(qr).length + ' QR';
    if (skipped) msg += ' (' + skipped + (state.lang === 'pt' ? ' linhas de rota/CHP ignoradas' : ' filas de ruta/CHP ignoradas') + ')';
    toast(msg, true);
  }

  // "Salvados" sheet (NUMERO_NEX + CÓDIGO QR fixos, ROTAPL/ROTAOT mudam a diário
  // e por isso NÃO são confiáveis aqui) — só tapa buracos de QR em sacas que já
  // existem nas rotas carregadas. Nunca cria/edita rotas nem pisa um QR que já tem.
  function importQrFallback() {
    var h = pending.headers;
    var iNum = col(h, ['NUMERO_NEX', 'ROTASACA']);
    var iQr = col(h, ['CÓDIGO QR', 'CODIGO QR', 'CONTAINER_QR', 'CODIGO', 'QR']);
    var iCid = col(h, ['CONTAINER_ID']);
    if (iNum === -1) { toast('CSV inválido: falta a coluna NUMERO_NEX/ROTASACA.', false); return; }
    if (iQr === -1 && iCid === -1) { toast('CSV inválido: falta CÓDIGO QR/CONTAINER_QR ou CONTAINER_ID.', false); return; }

    var knownNums = {};
    state.groups.forEach(function (g) { (g.realSacas || []).forEach(function (n) { knownNums[n] = true; }); });

    var filled = 0, already = 0, notFound = 0;
    pending.rows.forEach(function (r) {
      var numRaw = String(r[iNum] || '').trim();
      if (!/^\d+$/.test(numRaw)) return;
      var num = parseInt(numRaw, 10);
      if (!knownNums[num]) { notFound++; return; }
      if (state.qrByNum[num]) { already++; return; }
      var qrStr = iQr !== -1 ? String(r[iQr] || '').trim() : '';
      if (!qrStr && iCid !== -1 && String(r[iCid] || '').trim()) {
        var cid = parseInt(r[iCid], 10);
        qrStr = JSON.stringify({ container_id: isNaN(cid) ? String(r[iCid]).trim() : cid, facility_id: state.site, assignment: numRaw });
      }
      if (!qrStr) return;
      state.qrByNum[num] = qrStr;
      filled++;
    });

    pending = null; persist(); render();
    var msg = filled + (state.lang === 'pt' ? ' QR completados' : ' QR completados');
    if (already) msg += ' · ' + already + (state.lang === 'pt' ? ' já tinham' : ' ya tenían');
    if (notFound) msg += ' · ' + notFound + (state.lang === 'pt' ? ' não pertencem a rotas atuais' : ' no pertenecen a rutas actuales');
    toast(msg, filled > 0);
  }

  function clearOptimization() {
    state.source = null; state.groups = []; state.selection = []; state.excluded = []; state.optFileName = null;
    persist(); render();
  }
  // Apaga tudo (otimização, seleção, QR, exclusões) — pra sair de um estado
  // salvo que ficou errado (ex.: rotas antigas construídas por engano pelo
  // auto-sync). Mantém idioma/site.
  function clearAll() {
    state.source = null; state.groups = []; state.selection = []; state.excluded = [];
    state.optFileName = null; state.qrByNum = {}; state.metaByNum = {}; state.lastSave = null; state.lastSheetSync = null;
    persist(); render();
    $('settingsOverlay').classList.remove('open');
    toast(t('cleared_ok'), true);
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
    $('headerTools').style.display = has ? 'flex' : 'none';
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

  // ---------------------------------------------------------------- settings + diagnostics
  function openSettings() {
    $('setQrUrl').value = state.qrBaseUrl || DEFAULT_QR_BASE_URL;
    renderDiag();
    $('settingsOverlay').classList.add('open');
  }
  function renderDiag() {
    var box = $('diagBox'); if (!box) return;
    if (!qrDiag.attempts || !qrDiag.attempts.length) { box.innerHTML = '<span class="hint">' + t('no_diag') + '</span>'; return; }
    box.innerHTML = (qrDiag.at ? '<div class="hint" style="margin-bottom:6px">' + esc(qrDiag.at) + '</div>' : '') +
      qrDiag.attempts.map(function (a) {
        var head = (a.ok ? '✅ ' : '❌ ') + esc(a.via) + (a.tab ? ' · ' + esc(a.tab) : '');
        var body = a.ok
          ? '<div class="hint">' + a.rowCount + ' linhas · colunas: ' + esc((a.columns || []).join(', ')) + '</div>' +
            (a.sample ? '<pre class="diag-sample">' + esc(JSON.stringify(a.sample, null, 1)) + '</pre>' : '')
          : '<div class="hint" style="color:var(--error)">' + esc(a.error || 'falhou') + (a.url ? ' · ' + esc(a.url) : '') + '</div>';
        return '<div class="diag-item"><b>' + head + '</b>' + body + '</div>';
      }).join('');
  }
  function saveSettings() {
    var url = $('setQrUrl').value.trim();
    state.qrBaseUrl = url || DEFAULT_QR_BASE_URL;
    persist();
    toast(t('saved_ok'), true);
  }

  // ---------------------------------------------------------------- wiring
  document.addEventListener('DOMContentLoaded', function () {
    // Fluxo principal
    ['btnAnexar2', 'btnTrocarOtim'].forEach(function (id) { $(id).addEventListener('click', function () { chooseFile('opt'); }); });
    $('btnRecuperar2').addEventListener('click', restoreSaved);

    $('searchInput').addEventListener('input', renderRoutes);
    $('btnSelAll').addEventListener('click', selectAllVisible);
    $('btnClearSel').addEventListener('click', function () { state.selection = []; persist(); renderRoutes(); updatePrintBar(); });
    $('btnRestore').addEventListener('click', function () {
      state.excluded = []; persist(); render();
      toast(state.lang === 'pt' ? 'Sacas restauradas!' : '¡Sacas restauradas!', true);
    });
    $('btnSalvar').addEventListener('click', saveChoice);
    $('btnPrint').addEventListener('click', printSelection);
    $('btnBannerExtr').addEventListener('click', function () { loadQrBase(false); });

    $('formatSelect').addEventListener('change', function () {
      $('btnCfgEtq').style.display = this.value === 'etiqueta' ? 'inline-flex' : 'none';
    });
    $('btnCfgEtq').addEventListener('click', openCfg);
    $('closeCfg').addEventListener('click', function () { $('cfgOverlay').classList.remove('open'); });
    $('cancelCfg').addEventListener('click', function () { $('cfgOverlay').classList.remove('open'); });
    $('saveCfg').addEventListener('click', saveCfg);

    // Configurações / avançado
    $('btnSettings').addEventListener('click', openSettings);
    $('closeSettings').addEventListener('click', function () { $('settingsOverlay').classList.remove('open'); });
    $('cancelSettings').addEventListener('click', function () { $('settingsOverlay').classList.remove('open'); });
    $('settingsOverlay').addEventListener('click', function (e) { if (e.target === this) this.classList.remove('open'); });
    $('saveSettings').addEventListener('click', saveSettings);
    $('btnTestConn').addEventListener('click', function () { saveSettings(); loadQrBase(false); });
    $('btnExtracao').addEventListener('click', function () { chooseFile('extr'); });
    $('btnQrFallback').addEventListener('click', function () { chooseFile('qrfb'); });
    $('btnVerExtracao').addEventListener('click', openExtracao);
    $('btnClearAll').addEventListener('click', clearAll);
    $('closeExtracao').addEventListener('click', function () { $('extracaoOverlay').classList.remove('open'); });
    $('extracaoOverlay').addEventListener('click', function (e) { if (e.target === this) this.classList.remove('open'); });

    $('siteSelect').addEventListener('change', function () { state.site = this.value; persist(); });
    $('langSelect').addEventListener('change', function () { state.lang = this.value; persist(); applyLang(); render(); });

    init();
  });
})();
