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
  var GRID_SHEET_TABS = ['EX_ROTAS_QR', 'SEPARACAO_NEX', 'EXTRACAO_NEX', 'EXTRACAO', 'Extração', 'EXTRAÇÃO', 'EXTRAÇÃO_NEX', 'BASE EXTRACAO', 'BASE EXTRAÇÃO'];

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
      renum: {},               // "GRUPO#idx" -> número forçado manualmente pelo operador
      fisicas: {},             // número da saca -> [seriais únicos das sacas físicas] (default: sem entrada = 1 saca física, sem sufixo)
      serialCounter: 1,        // contador global de seriais físicos — nunca reseta, nem trocando de otimização
      logWebhookUrl: '',       // Verdi Flow que grava o registro de impressão na planilha (opcional)
      cfgEtq: { w: 12, h: 5, p: 0.4 }
    };
  }

  var state = defaultState();
  var pending = null;
  // Sessão salva no Grid (otimização/seleção/QR de uma vez anterior) — só é
  // aplicada ao `state` de verdade quando o operador clica "Recuperar salvo".
  // Abrir o app nunca deve carregar uma otimização sozinho.
  var savedSession = null;
  // Número de saca reservado pelo sistema oficial (bugava se reusado) — nunca
  // é atribuído automaticamente, igual a uma exclusão permanente.
  var RESERVED_NUMS = [150];

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
      change_opt: 'Trocar',
      renum_title: 'Editar saca', renum_label: 'Número',
      renum_hint: 'Use só se o número físico da saca estiver diferente do que o sistema atribuiu.',
      renum_invalid: 'Número inválido.', renum_reserved: 'Esse número é reservado pelo sistema — não pode ser usado.',
      renum_taken: 'Esse número já está em uso por outra saca.', renum_ok: 'Saca atualizada!',
      fisicas_label: 'Quantidade de sacas físicas',
      fisicas_hint: 'Se essa saca do sistema corresponde a mais de uma saca física, cada uma recebe um serial único (nunca se repete, nem em outro dia) e a impressão gera uma etiqueta por saca física — todas com o mesmo QR.',
      log_title: 'Registro de impressão (opcional)', log_url: 'URL do Verdi Flow que grava a planilha',
      test_log: 'Testar registro', log_ok: 'Registro funcionando!', log_fail: 'Registro falhou:'
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
      change_opt: 'Cambiar',
      renum_title: 'Editar saca', renum_label: 'Número',
      renum_hint: 'Usá esto solo si el número físico de la saca es distinto del que el sistema asignó.',
      renum_invalid: 'Número inválido.', renum_reserved: 'Ese número está reservado por el sistema — no se puede usar.',
      renum_taken: 'Ese número ya está en uso por otra saca.', renum_ok: '¡Saca actualizada!',
      fisicas_label: 'Cantidad de sacas físicas',
      fisicas_hint: 'Si esta saca del sistema corresponde a más de una saca física, cada una recibe un serial único (nunca se repite, ni en otro día) y la impresión genera una etiqueta por saca física — todas con el mismo QR.',
      log_title: 'Registro de impresión (opcional)', log_url: 'URL del Verdi Flow que graba la planilla',
      test_log: 'Probar registro', log_ok: '¡Registro funcionando!', log_fail: 'Registro falló:'
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
  // Enquanto o operador não subiu nem recuperou nada (state.groups vazio),
  // não pisa a sessão salva no Grid — só atualiza preferências (idioma,
  // site, URL da base, config de etiqueta). Assim, abrir o app e mudar o
  // idioma antes de decidir não apaga o "Recuperar salvo" de ontem.
  function persist() {
    state.updatedAt = new Date().toISOString();
    var toSave = state;
    if (!state.groups.length && savedSession && savedSession.groups && savedSession.groups.length) {
      toSave = Object.assign({}, savedSession, {
        lang: state.lang, site: state.site, qrBaseUrl: state.qrBaseUrl, cfgEtq: state.cfgEtq,
        logWebhookUrl: state.logWebhookUrl, serialCounter: state.serialCounter, updatedAt: state.updatedAt
      });
    }
    window.GridStore.saveDebounced(toSave, 400);
  }

  async function init() {
    var loaded = await window.GridStore.load();
    if (loaded && loaded.schemaVersion === SCHEMA_VERSION) {
      savedSession = loaded;
      // Só preferências entram automaticamente — a otimização em si exige
      // "Recuperar salvo" (ou um novo upload). Abrir o app nunca carrega
      // sozinho a otimização de outro dia. serialCounter é o contador global
      // de seriais físicos — NUNCA reseta, nem trocando de otimização.
      state.lang = loaded.lang || state.lang;
      state.site = loaded.site || state.site;
      state.qrBaseUrl = loaded.qrBaseUrl || state.qrBaseUrl;
      state.cfgEtq = loaded.cfgEtq || state.cfgEtq;
      state.logWebhookUrl = loaded.logWebhookUrl || state.logWebhookUrl;
      state.serialCounter = loaded.serialCounter || state.serialCounter;
    }
    var badge = $('storageBadge');
    if (window.GridStore.isRunningInGrid()) { badge.textContent = 'Grid'; badge.classList.remove('local'); }
    else { badge.textContent = 'Local (preview)'; badge.classList.add('local'); }
    $('langSelect').value = state.lang;
    $('siteSelect').value = state.site;
    applyLang();
    render();
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

  // Extrai uma mensagem legível de qualquer coisa que dê erro — Error de
  // verdade, objeto de resposta da API do Grid, string, etc. String(err) em
  // objeto simples vira "[object Object]", que não diz nada no Diagnóstico.
  function describeError(err) {
    if (!err) return 'erro desconhecido';
    if (typeof err === 'string') return err;
    if (err.message) return err.message;
    if (err.error) return typeof err.error === 'string' ? err.error : describeError(err.error);
    if (err.status || err.statusText) return 'HTTP ' + (err.status || '') + ' ' + (err.statusText || '');
    try { var s = JSON.stringify(err); if (s && s !== '{}') return s; } catch (e) { /* ignore */ }
    try { return String(err); } catch (e) { return 'erro desconhecido'; }
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
      attempt.error = describeError(err);
      qrDiag.attempts.push(attempt);
      return null;
    }
  }

  // Testa TODAS as abas candidatas e devolve TODAS as que responderam com
  // linhas — não fica só com a primeira. QR e agência/modal costumam morar
  // em abas diferentes (EX_ROTAS_QR só tem QR; SEPARACAO_NEX só tem
  // agência/veículo), então precisa juntar as duas, não escolher uma.
  async function tryGridSheetsAll() {
    if (!ensureGridSheetsReady()) {
      qrDiag.attempts.push({ via: 'Grid.sheets', ok: false, error: window.GridStore.isRunningInGrid() ? 'Grid.sheets indisponível' : 'fora do Grid' });
      return [];
    }
    var results = [];
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
          results.push(parsed);
          continue;
        }
        attempt.error = 'vazio'; qrDiag.attempts.push(attempt);
      } catch (err) {
        attempt.error = describeError(err);
        qrDiag.attempts.push(attempt);
      }
    }
    return results;
  }

  async function loadQrBase(silent) {
    qrDiag = { attempts: [], at: new Date().toLocaleString(state.lang === 'pt' ? 'pt-BR' : 'es-AR') };
    setSyncStatus(t('sync_syncing'));
    var totalQr = 0, gotAny = false;
    var parsedFetch = await tryFetchPublishedCsv();
    if (parsedFetch) { totalQr += applyQrBase(parsedFetch).qrCount; gotAny = true; }
    var allTabs = await tryGridSheetsAll();
    allTabs.forEach(function (parsed) { totalQr += applyQrBase(parsed).qrCount; gotAny = true; });
    if (!gotAny) {
      setSyncStatus(t('sync_fail_all'), silent ? null : 'err');
      renderDiag();
      return false;
    }
    state.lastSheetSync = new Date().toLocaleTimeString(state.lang === 'pt' ? 'pt-BR' : 'es-AR');
    persist(); render(); renderDiag();
    if (totalQr === 0) { setSyncStatus(t('sync_no_qr_cols'), 'err'); return false; }
    setSyncStatus(t('sync_ok') + state.lastSheetSync + ' · ' + totalQr + ' QR', 'ok');
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
    state.selection = []; state.excluded = []; state.renum = {}; state.fisicas = {};
    savedSession = null; // essa otimização nova substitui qualquer "salvo" antigo
    pending = null; persist(); render();
    toast(groups.length + (state.lang === 'pt' ? ' rotas carregadas' : ' rutas cargadas'), true);
    loadQrBase(true);
  }

  // Numeração global sequencial, com "buracos" nas sacas excluídas/reservadas.
  // Roda de novo em todo render (fonte = otimização), então uma renumeração
  // manual não pode só mudar o array — tem que ficar em state.renum
  // ("GRUPO#posição" -> número forçado) pra sobreviver ao recálculo.
  function assignRunningNumbers(groups) {
    var skip = excludedSet(), n = 1;
    RESERVED_NUMS.forEach(function (r) { skip.add(r); });
    // Não reserva o número de destino de uma renumeração globalmente: duas
    // rotas podem mostrar o mesmo número temporariamente durante a edição
    // (pedido explícito) — só não pode repetir DENTRO da mesma rota, e isso
    // já é validado no momento de salvar a renumeração.
    groups.forEach(function (g) {
      var arr = [], got = 0, idx = 0;
      while (got < g.count) {
        if (!skip.has(n)) {
          var key = g.name + '#' + idx;
          var override = state.renum && state.renum[key] != null ? parseInt(state.renum[key], 10) : null;
          arr.push(override != null ? override : n);
          got++; idx++;
        }
        n++;
      }
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

  // × no chip do arquivo ativo — descarta a otimização carregada e volta
  // pra tela vazia, sem precisar passar por Configurações.
  function clearOptimization() {
    state.source = null; state.groups = []; state.selection = []; state.excluded = []; state.renum = {}; state.fisicas = {};
    state.optFileName = null; state.qrByNum = {}; state.metaByNum = {}; state.lastSave = null; state.lastSheetSync = null;
    savedSession = null;
    persist(); render();
  }
  // Apaga tudo (otimização, seleção, QR, exclusões) — pra sair de um estado
  // salvo que ficou errado (ex.: rotas antigas construídas por engano pelo
  // auto-sync). Mantém idioma/site.
  function clearAll() {
    state.source = null; state.groups = []; state.selection = []; state.excluded = []; state.renum = {}; state.fisicas = {};
    state.optFileName = null; state.qrByNum = {}; state.metaByNum = {}; state.lastSave = null; state.lastSheetSync = null;
    savedSession = null;
    persist(); render();
    $('settingsOverlay').classList.remove('open');
    toast(t('cleared_ok'), true);
  }
  // Aplica de verdade a sessão salva no Grid (otimização + seleção + QR de
  // uma vez anterior) — é a ÚNICA forma de trazer de volta uma otimização
  // já subida; abrir o app nunca faz isso sozinho.
  function restoreSaved() {
    if (!savedSession || !savedSession.groups || !savedSession.groups.length) { toast(t('no_saved'), false); return; }
    state = savedSession;
    savedSession = null;
    persist(); render();
    toast(t('restored'), true);
    loadQrBase(true);
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
      nums.forEach(function (num, idx) {
        var isSel = sel.has(num);
        var fis = ((state.fisicas && state.fisicas[num]) || []).length;
        grid += '<button class="saca' + (isSel ? ' selected' : '') + '" data-num="' + num + '" data-idx="' + idx + '" title="' +
          (state.lang === 'pt' ? 'Duplo clique pra renumerar' : 'Doble clic para renumerar') + '">' + num +
          (fis > 1 ? '<span class="fis-badge" title="' + fis + (state.lang === 'pt' ? ' sacas físicas' : ' sacas físicas') + '">×' + fis + '</span>' : '') +
          '<span class="dot' + (hasQr(num) ? ' has' : '') + '" title="' + (hasQr(num) ? 'QR' : 'sem QR') + '"></span>' +
          '<span class="rm" data-rm="' + num + '">&times;</span></button>';
      });
      grid += '</div>';
      card.innerHTML = head + grid; wrap.appendChild(card);
    });

    wrap.querySelectorAll('.saca').forEach(function (btn) {
      var num = parseInt(btn.getAttribute('data-num'), 10);
      var idx = parseInt(btn.getAttribute('data-idx'), 10);
      var groupName = btn.closest('.route-card').querySelector('.name').textContent;
      btn.addEventListener('click', function (e) {
        if (e.target.getAttribute('data-rm')) return;
        var s = selectionSet(); if (s.has(num)) s.delete(num); else s.add(num);
        state.selection = Array.from(s); persist(); renderRoutes(); updatePrintBar();
      });
      btn.addEventListener('dblclick', function (e) {
        // só abre se o duplo clique foi no número em si — nunca no × (excluir)
        // nem no pontinho de status, senão excluir vira renumerar por engano.
        if (e.target.classList.contains('rm') || e.target.classList.contains('dot')) return;
        // excluir uma saca redesenha a grade na hora; se o operador está
        // excluindo várias rápido, o próximo clique pode cair (por reflow)
        // onde estava o × anterior e o navegador lê como duplo clique.
        if (Date.now() - lastExcludeAt < 500) return;
        e.preventDefault(); e.stopPropagation();
        openRenum(groupName, idx, num);
      });
    });
    wrap.querySelectorAll('.rm').forEach(function (x) {
      x.addEventListener('click', function (e) {
        e.stopPropagation();
        lastExcludeAt = Date.now();
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
  function updatePrintBar() {
    var n = state.selection.length;
    var totalLabels = 0;
    state.selection.forEach(function (num) { totalLabels += ((state.fisicas && state.fisicas[num]) || []).length || 1; });
    $('printCount').textContent = totalLabels;
    $('btnPrint').disabled = (n === 0);
  }

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
  // Rotas do ciclo CHP (ex.: "X1_CHP") nunca levam carro/agência impressos —
  // fica em branco de propósito. Isso só aparece dentro do ciclo AM.
  function isChpRoute(g) { return /CHP/i.test(g.fullName || g.name || ''); }
  // Se uma saca do sistema tem mais de uma saca física (state.fisicas[num] =
  // lista de seriais únicos, do contador global que nunca reseta), gera uma
  // etiqueta por saca física (serial "NUM-SERIAL", ex. "1-7"), todas com o
  // mesmo QR oficial — o serial é só pra controle interno impresso.
  function selectedItems() {
    var numToGroup = {}; state.groups.forEach(function (g) { (g.realSacas || []).forEach(function (n) { numToGroup[n] = g; }); });
    var out = [];
    state.selection.slice().sort(function (a, b) { return a - b; }).forEach(function (num) {
      var g = numToGroup[num]; if (!g) return;
      var m = state.metaByNum[num] || {};
      var chp = isChpRoute(g);
      var serials = (state.fisicas && state.fisicas[num]) || [];
      var list = serials.length ? serials.map(function (sn) { return num + '-' + sn; }) : [String(num)];
      list.forEach(function (serial) {
        out.push({ num: num, serial: serial, route: g.name, agencia: chp ? '' : (m.agencia || ''), modal: chp ? '' : (m.veiculo || ''), qr: state.qrByNum[num] || '', chp: chp });
      });
    });
    return out;
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
          html += '<div class="card-et"><div class="c-num"><h1>' + esc(it.serial) + '</h1></div>' +
            '<div class="c-route"><h2>' + esc(it.route) + '</h2></div>' +
            '<div class="c-field"><span>' + esc(it.chp ? '' : (it.agencia || '—')) + '</span></div>' +
            '<div class="c-field"><span>' + esc(it.chp ? '' : (it.modal || '—')) + '</span></div>' +
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
            '<div class="fcell num"><span class="rot f-num">' + esc(it.serial) + '</span></div>' +
            '<div class="fcell qS">' + qr + '</div>' +
            '<div class="fcell ag"><span class="rot f-info">' + esc(it.chp ? '' : (it.agencia || '—')) + '</span></div>' +
            '<div class="fcell rt f-gray"><span class="rot f-route">' + esc(it.route) + '</span></div>' +
            '<div class="fcell md"><span class="rot f-info">' + esc(it.chp ? '' : (it.modal || '—')) + '</span></div>' +
            '</div></div>';
        }
        html += '<div class="folha-page">' + half('oeste') + half('leste') + '</div>';
      });
    } else { // etiqueta — SACA / ROTA / AGÊNCIA (sem MODAL)
      var c = state.cfgEtq, inner = (c.h - c.p * 2);
      var fs = (inner / 3 * 0.82).toFixed(2) + 'cm';
      dynStyle('@media print{@page{size:' + c.w + 'cm ' + c.h + 'cm;margin:0}' +
        '.etq{width:' + c.w + 'cm;height:' + c.h + 'cm;padding:' + c.p + 'cm;--etq-fs:' + fs + '}' +
        '.etq .qr{width:' + inner + 'cm;height:' + inner + 'cm}}');
      items.forEach(function (it) {
        html += '<div class="etq"><div class="qr">' + makeQrSvg(it.qr) + '</div><div class="lines">' +
          '<div class="ln"><span class="k">SACA:</span>' + esc(it.serial) + '</div>' +
          '<div class="ln"><span class="k">ROTA:</span>' + esc(it.route) + '</div>' +
          '<div class="ln"><span class="k">AGÊNCIA:</span>' + esc(it.chp ? '' : (it.agencia || '—')) + '</div>' +
          '</div></div>';
      });
    }

    area.innerHTML = html;
    setTimeout(function () { window.print(); setTimeout(function () { area.innerHTML = ''; dynStyle(''); }, 800); }, 350);
    logPrint(items);
  }

  // Manda um registro do que foi impresso pro Verdi Flow (opcional, configurado
  // em ⚙). Nunca trava nem avisa erro pro operador — é só um log em segundo
  // plano; se falhar (ex.: CSP bloqueando o domínio), fica só no console.
  var lastLogError = '';
  function logPrint(items) {
    var url = state.logWebhookUrl && state.logWebhookUrl.trim();
    if (!url) return;
    var now = new Date().toISOString();
    var payload = { items: items.map(function (it) {
      return { timestamp: now, saca: it.num, serial: it.serial, rota: it.route,
        agencia: it.chp ? '' : it.agencia, qtd_fisicas: ((state.fisicas && state.fisicas[it.num]) || []).length || 1 };
    }) };
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); lastLogError = ''; })
      .catch(function (err) { lastLogError = describeError(err); });
  }
  async function testLogWebhook() {
    var url = $('setLogUrl').value.trim();
    state.logWebhookUrl = url; persist();
    if (!url) { toast(t('saved_ok'), true); return; }
    try {
      var res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ timestamp: new Date().toISOString(), saca: 0, serial: 'TESTE', rota: 'TESTE', agencia: '', qtd_fisicas: 1 }] }) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      toast(t('log_ok'), true);
    } catch (err) {
      toast(t('log_fail') + ' ' + describeError(err), false);
    }
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

  // ---------------------------------------------------------------- renumerar saca
  // Guarda o override em state.renum ("GRUPO#idx" -> número), porque
  // assignRunningNumbers recalcula os números do zero em todo render (fonte
  // = otimização) — só mudar o array direto seria apagado no próximo render.
  var renumTarget = null; // { groupName, idx, oldNum }
  var lastExcludeAt = 0; // guarda contra dblclick fantasma logo depois de excluir uma saca
  function openRenum(groupName, idx, oldNum) {
    renumTarget = { groupName: groupName, idx: idx, oldNum: oldNum };
    $('renumInput').value = oldNum;
    $('renumFisicas').value = ((state.fisicas && state.fisicas[oldNum]) || []).length || 1;
    var serials = (state.fisicas && state.fisicas[oldNum]) || [];
    $('renumFisicasHint').textContent = serials.length
      ? (state.lang === 'pt' ? 'Seriais atribuídos: ' : 'Seriales asignados: ') + serials.map(function (sn) { return oldNum + '-' + sn; }).join(', ')
      : '';
    $('renumOverlay').classList.add('open');
    $('renumInput').focus();
  }
  function saveRenum() {
    if (!renumTarget) return;
    var oldNum = renumTarget.oldNum;
    var newNum = parseInt($('renumInput').value, 10);
    var wantCount = parseInt($('renumFisicas').value, 10);
    if (isNaN(wantCount) || wantCount < 1) wantCount = 1;
    if (isNaN(newNum) || newNum <= 0) { toast(t('renum_invalid'), false); return; }

    var g = state.groups.filter(function (x) { return x.name === renumTarget.groupName; })[0];
    if (!g) return;
    if (!state.fisicas) state.fisicas = {};
    if (!state.serialCounter) state.serialCounter = 1;
    var serials = (state.fisicas[oldNum] || []).slice(); // captura antes de qualquer delete abaixo

    if (newNum !== oldNum) {
      if (RESERVED_NUMS.indexOf(newNum) !== -1) { toast(t('renum_reserved'), false); return; }
      // Rejeita se o número já existir em QUALQUER rota — seleção, QR e
      // agência/modal são amarrados só ao número (não à rota), então duas
      // sacas com o mesmo número ficam emaranhadas (selecionar uma seleciona
      // as duas, etc.). Duplicidade nunca é segura aqui, nem temporariamente.
      var taken = false;
      state.groups.forEach(function (x) { if ((x.realSacas || []).indexOf(newNum) !== -1) taken = true; });
      if (taken) { toast(t('renum_taken'), false); return; }
      var idx = g.realSacas.indexOf(oldNum);
      if (idx === -1) return;
      g.realSacas[idx] = newNum;
      g.realSacas.sort(function (a, b) { return a - b; });
      if (!state.renum) state.renum = {};
      state.renum[renumTarget.groupName + '#' + renumTarget.idx] = newNum;

      var s = selectionSet();
      if (s.has(oldNum)) { s.delete(oldNum); s.add(newNum); state.selection = Array.from(s); }
      var ex = excludedSet();
      if (ex.has(oldNum)) { ex.delete(oldNum); ex.add(newNum); state.excluded = Array.from(ex); }
      // QR/agência/modal são amarrados ao NÚMERO na base — ao renumerar, o
      // dado antigo não vale mais pra essa saca; busca de novo pro número novo.
      delete state.qrByNum[oldNum];
      delete state.metaByNum[oldNum];
      delete state.fisicas[oldNum];
    }

    // Ajusta a quantidade de seriais físicos pro número final. Seriais já
    // atribuídos NUNCA mudam nem são reaproveitados — cada saca física
    // recebe um número do contador global, que só cresce, nunca reseta.
    if (wantCount <= 1) {
      delete state.fisicas[newNum];
    } else {
      while (serials.length < wantCount) serials.push(state.serialCounter++);
      if (serials.length > wantCount) serials = serials.slice(0, wantCount);
      state.fisicas[newNum] = serials;
    }

    renumTarget = null;
    persist(); render();
    $('renumOverlay').classList.remove('open');
    toast(t('renum_ok'), true);
    if (newNum !== oldNum) loadQrBase(true);
  }

  // ---------------------------------------------------------------- settings + diagnostics
  function openSettings() {
    $('setQrUrl').value = state.qrBaseUrl || DEFAULT_QR_BASE_URL;
    $('setLogUrl').value = state.logWebhookUrl || '';
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
    state.logWebhookUrl = $('setLogUrl').value.trim();
    persist();
    toast(t('saved_ok'), true);
  }

  // ---------------------------------------------------------------- wiring
  document.addEventListener('DOMContentLoaded', function () {
    // Fluxo principal
    ['btnAnexar2', 'btnTrocarOtim'].forEach(function (id) { $(id).addEventListener('click', function () { chooseFile('opt'); }); });
    $('btnClearOtim').addEventListener('click', clearOptimization);
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

    $('closeRenum').addEventListener('click', function () { $('renumOverlay').classList.remove('open'); });
    $('cancelRenum').addEventListener('click', function () { $('renumOverlay').classList.remove('open'); });
    $('saveRenum').addEventListener('click', saveRenum);
    $('renumOverlay').addEventListener('click', function (e) { if (e.target === this) this.classList.remove('open'); });

    // Configurações / avançado
    $('btnSettings').addEventListener('click', openSettings);
    $('closeSettings').addEventListener('click', function () { $('settingsOverlay').classList.remove('open'); });
    $('cancelSettings').addEventListener('click', function () { $('settingsOverlay').classList.remove('open'); });
    $('settingsOverlay').addEventListener('click', function (e) { if (e.target === this) this.classList.remove('open'); });
    $('saveSettings').addEventListener('click', saveSettings);
    $('btnTestConn').addEventListener('click', function () { saveSettings(); loadQrBase(false); });
    $('btnTestLog').addEventListener('click', testLogWebhook);
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
