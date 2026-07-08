(function () {
  'use strict';

  var SCHEMA_VERSION = 3;

  function defaultState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: null,
      loteId: '',
      lastOptimizationImport: null, // { fileName, importedAt }
      lastSeparacaoImport: null,    // { fileName, importedAt }
      lastExtracaoImport: null,     // { fileName, importedAt }
      // route: { key (= ID Planejado / ROTAPL), stationLabel (= ID Otimizado),
      //          detalheRoteiro, veiculoPlanejado, pacotesEstimados, expectedSacas,
      //          hybridExplicit, hybridGuess, hybridManual,
      //          sacas: [{seq, physicalCode, label, veiculo, empresa, agencia,
      //                   realQrPayload, containerId, printedAt}] }
      routes: []
    };
  }

  var state = defaultState();
  var parsedRows = null; // last parsed file: { headers: [...], rows: [[...], ...], fileName }
  var fileKind = null;   // 'optimization' | 'separacao'

  // ---------- persistence ----------

  function persist() {
    state.updatedAt = new Date().toISOString();
    window.GridStore.saveDebounced(state, 500);
  }

  async function init() {
    var loaded = await window.GridStore.load();
    if (loaded && loaded.schemaVersion === SCHEMA_VERSION) {
      state = loaded;
    }
    var badge = document.getElementById('storageBadge');
    if (window.GridStore.isRunningInGrid()) {
      badge.textContent = 'Guardado en Grid';
      badge.classList.remove('local');
    } else {
      badge.textContent = 'Modo local (sin persistencia)';
      badge.classList.add('local');
    }
    renderAll();
  }

  // ---------- CSV parsing ----------

  function parseDelimited(text) {
    var firstLine = (text.split(/\r\n|\n/, 1)[0] || '');
    var candidates = [',', ';', '\t'];
    var delimiter = candidates.reduce(function (best, d) {
      return firstLine.split(d).length > firstLine.split(best).length ? d : best;
    }, ',');
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === delimiter) {
        row.push(field); field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else {
        field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function detectFileKind(headers) {
    var upper = headers.map(function (h) { return h.trim().toUpperCase(); });
    var hasOpt = upper.some(function (h) { return h.indexOf('OTIMIZADO') !== -1 || h.indexOf('QUANTIDADE DE SACAS') !== -1 || h.indexOf('TIPOS DE SERVI') !== -1; });
    var hasSep = upper.indexOf('ROTAPL') !== -1 || upper.indexOf('ROTASACA') !== -1;
    var hasExtracao = upper.indexOf('CONTAINER_QR') !== -1 || upper.indexOf('CONTAINER_ID') !== -1;
    if (hasExtracao) return 'extracao';
    if (hasSep) return 'separacao';
    if (hasOpt) return 'optimization';
    return 'optimization';
  }

  function handleFileSelect(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var rows = parseDelimited(String(e.target.result || ''));
      if (!rows.length) {
        alertBox('importAlert', 'El archivo está vacío o no se pudo leer.', 'danger');
        return;
      }
      var headers = rows[0].map(function (h) { return h.trim(); });
      var dataRows = rows.slice(1).filter(function (r) { return r.some(function (v) { return v.trim() !== ''; }); });
      parsedRows = { headers: headers, rows: dataRows, fileName: file.name };
      fileKind = detectFileKind(headers);
      renderMapping();
    };
    reader.onerror = function () {
      alertBox('importAlert', 'No se pudo leer el archivo.', 'danger');
    };
    reader.readAsText(file, 'UTF-8');
  }

  function alertBox(id, message, kind) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = message;
    el.style.display = message ? 'block' : 'none';
    el.style.background = '';
    el.style.color = '';
    el.style.borderColor = '';
    if (kind === 'danger') {
      el.style.background = 'var(--danger-bg)';
      el.style.color = 'var(--danger)';
      el.style.borderColor = 'var(--danger)';
    } else if (kind === 'success') {
      el.style.background = 'var(--success-bg)';
      el.style.color = 'var(--success)';
      el.style.borderColor = 'var(--success)';
    }
  }

  var COLUMN_CANDIDATES = {
    idPlanejado: ['ID PLANEJADO'],
    idOtimizado: ['ID OTIMIZADO'],
    detalhe: ['DETALHE DO ROTEIRO'],
    tipoServico: ['TIPOS DE SERVIÇOS', 'TIPOS DE SERVICOS'],
    qtdSacas: ['QUANTIDADE DE SACAS'],
    tipoVeiculo: ['TIPO DE VEÍCULO', 'TIPO DE VEICULO'],
    pacotesEstimados: ['PACOTES ESTIMADOS'],

    rotapl: ['ROTAPL'],
    sacaSeq: ['ROTASACA'],
    sacaCode: ['ROTASACAPL'],
    veiculo: ['VEICULO', 'VEÍCULO'],
    empresa: ['EMPRESA'],
    agencia: ['AGENCIA', 'AGÊNCIA'],
    servico: ['SERVICO', 'SERVIÇO'],

    site: ['SITE'],
    extracaoRota: ['ROTA'],
    containerId: ['CONTAINER_ID'],
    containerQr: ['CONTAINER_QR']
  };

  function guessColumn(headers, candidates) {
    var upper = headers.map(function (h) { return h.trim().toUpperCase(); });
    for (var c = 0; c < candidates.length; c++) {
      var idx = upper.indexOf(candidates[c]);
      if (idx !== -1) return idx;
    }
    for (var c2 = 0; c2 < candidates.length; c2++) {
      for (var i = 0; i < upper.length; i++) {
        if (upper[i].indexOf(candidates[c2]) !== -1) return i;
      }
    }
    return -1;
  }

  function isHybridToken(value) {
    var v = String(value || '').trim().toUpperCase();
    return ['HYBRID', 'HIBRIDA', 'HÍBRIDA', 'HIBRIDO', 'HÍBRIDO', 'SIM', 'S', 'Y', 'YES', '1', 'TRUE', 'X'].indexOf(v) !== -1;
  }

  // ---------- import mapping screen ----------

  function selectHtml(id, headers, selectedIdx) {
    var opts = ['<option value="">— no usar —</option>'].concat(
      headers.map(function (h, idx) {
        return '<option value="' + idx + '"' + (idx === selectedIdx ? ' selected' : '') + '>' + escapeHtml(h) + '</option>';
      })
    ).join('');
    return '<select id="' + id + '">' + opts + '</select>';
  }

  function defaultLoteId() {
    var d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function renderMapping() {
    var wrap = document.getElementById('mappingWrap');
    if (!parsedRows) { wrap.innerHTML = ''; return; }
    var h = parsedRows.headers;

    var kindPicker =
      '<div class="field-row">' +
      '<label>Lote / turno<input type="text" id="loteInput" value="' + escapeHtml(state.loteId || defaultLoteId()) + '"></label>' +
      '<label>Tipo de archivo' +
      '<select id="fileKindSelect">' +
      '<option value="optimization"' + (fileKind === 'optimization' ? ' selected' : '') + '>Optimización (pre-triagem: cantidad de sacas + híbrida)</option>' +
      '<option value="separacao"' + (fileKind === 'separacao' ? ' selected' : '') + '>Separação / Q_SEPARACAO (sorting: sacas reales)</option>' +
      '<option value="extracao"' + (fileKind === 'extracao' ? ' selected' : '') + '>Extração (QR real de la saca física)</option>' +
      '</select></label>' +
      '</div>';

    var fieldsHtml = fileKind === 'optimization' ? optimizationFieldsHtml(h)
      : fileKind === 'extracao' ? extracaoFieldsHtml(h)
      : separacaoFieldsHtml(h);

    wrap.innerHTML =
      '<div class="card">' +
      '<h2>2. Mapear columnas — ' + escapeHtml(parsedRows.fileName) + ' (' + parsedRows.rows.length + ' filas)</h2>' +
      '<p class="muted">Detectamos el tipo de archivo y las columnas automáticamente. Revisá y ajustá si hace falta.</p>' +
      kindPicker +
      '<div id="kindFieldsWrap">' + fieldsHtml + '</div>' +
      '<div id="servicoFilterWrap"></div>' +
      '<table class="data-table"><thead><tr>' +
      h.map(function (hh) { return '<th>' + escapeHtml(hh) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      parsedRows.rows.slice(0, 5).map(function (r) {
        return '<tr>' + h.map(function (_, i) { return '<td>' + escapeHtml(r[i] || '') + '</td>'; }).join('') + '</tr>';
      }).join('') +
      '</tbody></table>' +
      '<p class="muted">Mostrando las primeras 5 filas de ' + parsedRows.rows.length + '.</p>' +
      '<button class="btn" id="confirmImportBtn">Importar rutas</button>' +
      '</div>';

    document.getElementById('fileKindSelect').addEventListener('change', function () {
      fileKind = this.value;
      renderMapping();
    });
    document.getElementById('confirmImportBtn').addEventListener('click', confirmImport);

    if (fileKind === 'separacao') {
      document.getElementById('mapServico').addEventListener('change', renderServicoFilters);
      renderServicoFilters();
    }
  }

  function optimizationFieldsHtml(h) {
    var g = {
      idPlanejado: guessColumn(h, COLUMN_CANDIDATES.idPlanejado),
      idOtimizado: guessColumn(h, COLUMN_CANDIDATES.idOtimizado),
      detalhe: guessColumn(h, COLUMN_CANDIDATES.detalhe),
      tipoServico: guessColumn(h, COLUMN_CANDIDATES.tipoServico),
      qtdSacas: guessColumn(h, COLUMN_CANDIDATES.qtdSacas),
      tipoVeiculo: guessColumn(h, COLUMN_CANDIDATES.tipoVeiculo),
      pacotesEstimados: guessColumn(h, COLUMN_CANDIDATES.pacotesEstimados)
    };
    return '<div class="field-row">' +
      '<label>ID Planejado — clave de ruta (obligatoria)' + selectHtml('mapIdPlanejado', h, g.idPlanejado) + '</label>' +
      '<label>ID Otimizado — etiqueta de estación' + selectHtml('mapIdOtimizado', h, g.idOtimizado) + '</label>' +
      '<label>Detalhe do roteiro' + selectHtml('mapDetalhe', h, g.detalhe) + '</label>' +
      '</div>' +
      '<div class="field-row">' +
      '<label>Tipos de serviços (híbrida)' + selectHtml('mapTipoServico', h, g.tipoServico) + '</label>' +
      '<label>Quantidade de sacas' + selectHtml('mapQtdSacas', h, g.qtdSacas) + '</label>' +
      '<label>Tipo de veículo' + selectHtml('mapTipoVeiculo', h, g.tipoVeiculo) + '</label>' +
      '<label>Pacotes estimados' + selectHtml('mapPacotesEstimados', h, g.pacotesEstimados) + '</label>' +
      '</div>';
  }

  function separacaoFieldsHtml(h) {
    var g = {
      rotapl: guessColumn(h, COLUMN_CANDIDATES.rotapl),
      sacaSeq: guessColumn(h, COLUMN_CANDIDATES.sacaSeq),
      sacaCode: guessColumn(h, COLUMN_CANDIDATES.sacaCode),
      veiculo: guessColumn(h, COLUMN_CANDIDATES.veiculo),
      empresa: guessColumn(h, COLUMN_CANDIDATES.empresa),
      agencia: guessColumn(h, COLUMN_CANDIDATES.agencia),
      servico: guessColumn(h, COLUMN_CANDIDATES.servico)
    };
    return '<div class="field-row">' +
      '<label>ROTAPL — clave de ruta (obligatoria)' + selectHtml('mapRotapl', h, g.rotapl) + '</label>' +
      '<label>ROTASACA — nro. de saca' + selectHtml('mapSacaSeq', h, g.sacaSeq) + '</label>' +
      '<label>ROTASACAPL — código físico' + selectHtml('mapSacaCode', h, g.sacaCode) + '</label>' +
      '</div>' +
      '<div class="field-row">' +
      '<label>Vehículo' + selectHtml('mapVeiculo', h, g.veiculo) + '</label>' +
      '<label>Empresa' + selectHtml('mapEmpresa', h, g.empresa) + '</label>' +
      '<label>Agência' + selectHtml('mapAgencia', h, g.agencia) + '</label>' +
      '<label>Serviço (para filtrar filas Nex)' + selectHtml('mapServico', h, g.servico) + '</label>' +
      '</div>';
  }

  function extracaoFieldsHtml(h) {
    var g = {
      site: guessColumn(h, COLUMN_CANDIDATES.site),
      rota: guessColumn(h, COLUMN_CANDIDATES.extracaoRota),
      containerId: guessColumn(h, COLUMN_CANDIDATES.containerId),
      containerQr: guessColumn(h, COLUMN_CANDIDATES.containerQr)
    };
    return '<p class="muted">Cruza por número de saca: sólo se usan las filas donde ROTA es puramente numérica (sacas NEX) — las filas con letras (rutas/CHP) se ignoran acá.</p>' +
      '<div class="field-row">' +
      '<label>Site' + selectHtml('mapSite', h, g.site) + '</label>' +
      '<label>ROTA — número de saca (obligatoria)' + selectHtml('mapExtracaoRota', h, g.rota) + '</label>' +
      '<label>CONTAINER_ID' + selectHtml('mapContainerId', h, g.containerId) + '</label>' +
      '<label>CONTAINER_QR — QR real (obligatoria)' + selectHtml('mapContainerQr', h, g.containerQr) + '</label>' +
      '</div>';
  }

  function renderServicoFilters() {
    var idx = document.getElementById('mapServico').value;
    var wrap = document.getElementById('servicoFilterWrap');
    if (idx === '') { wrap.innerHTML = ''; return; }
    idx = parseInt(idx, 10);
    var uniq = {};
    parsedRows.rows.forEach(function (r) {
      var v = (r[idx] || '').trim();
      if (v) uniq[v] = true;
    });
    var values = Object.keys(uniq).sort();
    if (!values.length) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = '<p class="muted" style="margin-bottom:4px">¿Qué valores de "Serviço" pertenecen al flujo Nex? (se van a importar solo esas filas)</p>' +
      '<div class="field-row" style="gap:10px">' +
      values.map(function (v) {
        var checked = /NEX/i.test(v) ? ' checked' : '';
        return '<label style="flex-direction:row; align-items:center; gap:6px"><input type="checkbox" class="servicoCheck" value="' + escapeHtml(v) + '"' + checked + '>' + escapeHtml(v) + '</label>';
      }).join('') +
      '</div>';
  }

  function val(id) {
    var el = document.getElementById(id);
    if (!el) return -1;
    var v = el.value;
    return v === '' ? -1 : parseInt(v, 10);
  }

  function getOrCreateRoute(key) {
    for (var i = 0; i < state.routes.length; i++) {
      if (state.routes[i].key === key) return state.routes[i];
    }
    var fresh = {
      key: key,
      stationLabel: null,
      detalheRoteiro: null,
      veiculoPlanejado: null,
      pacotesEstimados: null,
      expectedSacas: null,
      hybridExplicit: null,
      hybridGuess: false,
      hybridManual: null,
      sacas: []
    };
    state.routes.push(fresh);
    return fresh;
  }

  function confirmImport() {
    var loteId = document.getElementById('loteInput').value.trim() || defaultLoteId();
    state.loteId = loteId;

    if (fileKind === 'optimization') confirmImportOptimization();
    else if (fileKind === 'extracao') confirmImportExtracao();
    else confirmImportSeparacao();

    persist();
    renderAll();
    switchTab('assign');
  }

  function confirmImportOptimization() {
    var idxKey = val('mapIdPlanejado');
    var idxLabel = val('mapIdOtimizado');
    var idxDetalhe = val('mapDetalhe');
    var idxTipoServico = val('mapTipoServico');
    var idxQtd = val('mapQtdSacas');
    var idxVeiculo = val('mapTipoVeiculo');
    var idxPacotes = val('mapPacotesEstimados');

    if (idxKey === -1) {
      alertBox('importAlert', 'Elegí la columna "ID Planejado" — es la clave de ruta.', 'danger');
      return;
    }

    var count = 0;
    parsedRows.rows.forEach(function (r) {
      var key = (r[idxKey] || '').trim();
      if (!key) return;
      var route = getOrCreateRoute(key);
      if (idxLabel !== -1) route.stationLabel = (r[idxLabel] || '').trim() || route.stationLabel;
      if (idxDetalhe !== -1) route.detalheRoteiro = (r[idxDetalhe] || '').trim() || route.detalheRoteiro;
      if (idxVeiculo !== -1) route.veiculoPlanejado = (r[idxVeiculo] || '').trim() || route.veiculoPlanejado;
      if (idxPacotes !== -1) {
        var pe = parseInt(r[idxPacotes], 10);
        if (!isNaN(pe)) route.pacotesEstimados = pe;
      }
      if (idxTipoServico !== -1) route.hybridExplicit = isHybridToken(r[idxTipoServico]);
      if (idxQtd !== -1 && route.sacas.length === 0) {
        var q = parseInt(r[idxQtd], 10);
        if (!isNaN(q)) route.expectedSacas = q;
      }
      count++;
    });

    state.lastOptimizationImport = { fileName: parsedRows.fileName, importedAt: new Date().toISOString() };
    alertBox('importAlert', count + ' rutas actualizadas desde el archivo de optimización.', 'success');
  }

  function confirmImportSeparacao() {
    var idxRoute = val('mapRotapl');
    var idxSacaSeq = val('mapSacaSeq');
    var idxSacaCode = val('mapSacaCode');
    var idxVeiculo = val('mapVeiculo');
    var idxEmpresa = val('mapEmpresa');
    var idxAgencia = val('mapAgencia');
    var idxServico = val('mapServico');

    if (idxRoute === -1) {
      alertBox('importAlert', 'Elegí la columna ROTAPL — es la clave de ruta.', 'danger');
      return;
    }

    var allowedServicos = null;
    if (idxServico !== -1) {
      allowedServicos = {};
      document.querySelectorAll('.servicoCheck:checked').forEach(function (c) { allowedServicos[c.value] = true; });
    }

    var byRoute = {};
    var order = [];
    var skippedByServico = 0;

    parsedRows.rows.forEach(function (r) {
      var key = (r[idxRoute] || '').trim();
      if (!key) return;
      if (allowedServicos && idxServico !== -1) {
        var sv = (r[idxServico] || '').trim();
        if (sv && !allowedServicos[sv]) { skippedByServico++; return; }
      }
      if (!byRoute[key]) { byRoute[key] = { veiculos: {}, empresas: {}, realSacas: [] }; order.push(key); }
      var info = byRoute[key];

      var seqRaw = idxSacaSeq !== -1 ? (r[idxSacaSeq] || '').trim() : '';
      if (seqRaw !== '') {
        var veiculo = idxVeiculo !== -1 ? (r[idxVeiculo] || '').trim() : '';
        var empresa = idxEmpresa !== -1 ? (r[idxEmpresa] || '').trim() : '';
        var agencia = idxAgencia !== -1 ? (r[idxAgencia] || '').trim() : '';
        var code = idxSacaCode !== -1 ? (r[idxSacaCode] || '').trim() : '';
        if (veiculo) info.veiculos[veiculo] = true;
        if (empresa) info.empresas[empresa] = true;
        info.realSacas.push({
          seq: parseInt(seqRaw, 10) || (info.realSacas.length + 1),
          physicalCode: code || null,
          label: code || seqRaw,
          veiculo: veiculo,
          empresa: empresa,
          agencia: agencia,
          realQrPayload: null,
          containerId: null,
          printedAt: null
        });
      }
    });

    var newCount = 0, updatedCount = 0, unchangedCount = 0;
    order.forEach(function (key) {
      var info = byRoute[key];
      info.realSacas.sort(function (a, b) { return a.seq - b.seq; });
      var isNew = !state.routes.some(function (r) { return r.key === key; });
      var route = getOrCreateRoute(key);
      var distinctVehicles = Object.keys(info.veiculos).length;
      var distinctEmpresas = Object.keys(info.empresas).length;
      route.hybridGuess = distinctVehicles > 1 || distinctEmpresas > 1 || route.hybridGuess;

      if (info.realSacas.length > 0) {
        // Carry forward any real QR already attached (from an "extração" import) to
        // the same saca number, so re-importing separação doesn't wipe it out.
        var previousBySeq = {};
        route.sacas.forEach(function (s) { if (s.realQrPayload) previousBySeq[s.seq] = s; });
        info.realSacas.forEach(function (s) {
          var prev = previousBySeq[s.seq];
          if (prev) { s.realQrPayload = prev.realQrPayload; s.containerId = prev.containerId; }
        });

        route.sacas = info.realSacas;
        route.expectedSacas = info.realSacas.length;
        if (isNew) newCount++; else updatedCount++;
      } else {
        if (isNew) newCount++; else unchangedCount++;
      }
    });

    state.lastSeparacaoImport = { fileName: parsedRows.fileName, importedAt: new Date().toISOString() };
    var msg = order.length + ' rutas en el archivo — ' + newCount + ' nuevas, ' + updatedCount + ' actualizadas con sacas reales, ' + unchangedCount + ' sin cambios.';
    if (skippedByServico) msg += ' (' + skippedByServico + ' filas ignoradas por Serviço)';
    alertBox('importAlert', msg, 'success');
  }

  function confirmImportExtracao() {
    var idxRota = val('mapExtracaoRota');
    var idxContainerId = val('mapContainerId');
    var idxContainerQr = val('mapContainerQr');

    if (idxRota === -1 || idxContainerQr === -1) {
      alertBox('importAlert', 'Elegí las columnas ROTA y CONTAINER_QR.', 'danger');
      return;
    }

    // Index every known saca by its sequence number across all routes — NUMERO_NEX
    // is a global pool for the whole site/cycle, not per-route.
    var sacaBySeq = {};
    state.routes.forEach(function (route) {
      route.sacas.forEach(function (s) { sacaBySeq[s.seq] = s; });
    });

    var matched = 0, skippedNonNumeric = 0, unmatched = 0;
    parsedRows.rows.forEach(function (r) {
      var rota = (r[idxRota] || '').trim();
      if (!/^\d+$/.test(rota)) { skippedNonNumeric++; return; }
      var seq = parseInt(rota, 10);
      var qr = (r[idxContainerQr] || '').trim();
      if (!qr) return;
      var saca = sacaBySeq[seq];
      if (!saca) { unmatched++; return; }
      saca.realQrPayload = qr;
      saca.containerId = idxContainerId !== -1 ? (r[idxContainerId] || '').trim() : saca.containerId;
      matched++;
    });

    state.lastExtracaoImport = { fileName: parsedRows.fileName, importedAt: new Date().toISOString() };
    var msg = matched + ' sacas con QR real cargado.';
    if (unmatched) msg += ' ' + unmatched + ' números de saca no encontrados en las rutas ya importadas (¿faltó importar la separação primero?).';
    if (skippedNonNumeric) msg += ' (' + skippedNonNumeric + ' filas de rutas/CHP ignoradas)';
    alertBox('importAlert', msg, matched > 0 ? 'success' : 'danger');
  }

  // ---------- assignment screen ----------

  function isHybridEffective(route) {
    if (route.hybridManual != null) return route.hybridManual;
    if (route.hybridExplicit != null) return route.hybridExplicit;
    return !!route.hybridGuess;
  }

  function hybridSourceLabel(route) {
    if (route.hybridManual != null) return '';
    if (route.hybridExplicit != null) return ' <span class="muted">(del archivo)</span>';
    if (route.hybridGuess) return ' <span class="muted">(sugerida)</span>';
    return '';
  }

  function routeDisplayName(route) {
    return route.stationLabel || route.key;
  }

  function renderAssign() {
    var wrap = document.getElementById('routesWrap');
    if (!state.routes.length) {
      wrap.innerHTML = '<div class="placeholder">Todavía no importaste ningún archivo.<br>Andá a la pestaña "Importar" para empezar.</div>';
      return;
    }

    wrap.innerHTML = state.routes.map(function (route, rIdx) {
      var chips = route.sacas.map(function (s, sIdx) {
        var qrBadge = s.realQrPayload
          ? ' <span class="badge" style="background:var(--success-bg);color:var(--success)" title="QR real de la extração">QR real</span>'
          : ' <span class="badge" title="Todavía no llegó el QR real de la extração">provisório</span>';
        return '<span class="saca-chip' + (s.printedAt ? ' printed' : '') + '">' +
          'Saca ' + escapeHtml(s.label) + (s.veiculo ? ' · ' + escapeHtml(s.veiculo) : '') + qrBadge +
          '<button data-route="' + rIdx + '" data-saca="' + sIdx + '" class="removeSacaBtn" title="Quitar">&times;</button>' +
          '</span>';
      }).join('');

      var expected = route.expectedSacas;
      var countLabel = expected ? (route.sacas.length + ' / ' + expected + ' sacas') : (route.sacas.length + ' sacas');
      var hybrid = isHybridEffective(route);
      var infoBits = [route.detalheRoteiro, route.veiculoPlanejado, route.pacotesEstimados ? (route.pacotesEstimados + ' pacotes est.') : null].filter(Boolean);

      return '<div class="route-card">' +
        '<div class="route-head">' +
        '<strong>' + escapeHtml(routeDisplayName(route)) + '</strong>' +
        '<span class="muted">pool: ' + escapeHtml(route.key) + '</span>' +
        '<span class="badge route-count">' + countLabel + '</span>' +
        '<label style="flex-direction:row; align-items:center; gap:4px; font-size:12px">' +
        '<input type="checkbox" class="hybridToggle" data-route="' + rIdx + '"' + (hybrid ? ' checked' : '') + '> Híbrida' +
        hybridSourceLabel(route) +
        '</label>' +
        '</div>' +
        (infoBits.length ? '<div class="muted" style="margin-bottom:8px">' + infoBits.map(escapeHtml).join(' · ') + '</div>' : '') +
        '<div class="saca-list">' + chips + '</div>' +
        '<div style="margin-top:10px; display:flex; gap:8px; align-items:center; flex-wrap:wrap">' +
        '<input type="text" placeholder="Nro/etiqueta de saca" class="newSacaLabel" data-route="' + rIdx + '" style="width:160px">' +
        '<button class="btn secondary addSacaBtn" data-route="' + rIdx + '">+ Agregar saca</button>' +
        (expected ? '<button class="btn secondary autoFillBtn" data-route="' + rIdx + '">Autocompletar 1..' + expected + '</button>' : '') +
        '</div>' +
        '</div>';
    }).join('');

    wrap.querySelectorAll('.removeSacaBtn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var rIdx = parseInt(btn.getAttribute('data-route'), 10);
        var sIdx = parseInt(btn.getAttribute('data-saca'), 10);
        state.routes[rIdx].sacas.splice(sIdx, 1);
        persist();
        renderAssign();
      });
    });

    wrap.querySelectorAll('.addSacaBtn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var rIdx = parseInt(btn.getAttribute('data-route'), 10);
        var input = wrap.querySelector('.newSacaLabel[data-route="' + rIdx + '"]');
        var label = (input.value || '').trim() || String(state.routes[rIdx].sacas.length + 1);
        addSaca(rIdx, label);
        input.value = '';
      });
    });

    wrap.querySelectorAll('.autoFillBtn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var rIdx = parseInt(btn.getAttribute('data-route'), 10);
        var route = state.routes[rIdx];
        route.sacas = [];
        for (var i = 1; i <= route.expectedSacas; i++) {
          route.sacas.push({ seq: i, physicalCode: null, label: String(i), veiculo: '', empresa: '', agencia: '', realQrPayload: null, containerId: null, printedAt: null });
        }
        persist();
        renderAssign();
      });
    });

    wrap.querySelectorAll('.hybridToggle').forEach(function (chk) {
      chk.addEventListener('change', function () {
        var rIdx = parseInt(chk.getAttribute('data-route'), 10);
        state.routes[rIdx].hybridManual = chk.checked;
        persist();
        renderAssign();
      });
    });
  }

  function addSaca(routeIdx, label) {
    var route = state.routes[routeIdx];
    route.sacas.push({ seq: route.sacas.length + 1, physicalCode: null, label: label, veiculo: '', empresa: '', agencia: '', realQrPayload: null, containerId: null, printedAt: null });
    persist();
    renderAssign();
  }

  // ---------- QR / print screen ----------

  function qrPayloadFor(route, saca) {
    // Real payload wins: it's the exact JSON the official MELI system already
    // printed on the physical bag (from the "extração" import). Only fall back
    // to a placeholder when that hasn't arrived yet for this saca.
    if (saca.realQrPayload) return saca.realQrPayload;
    return [
      'NEX-SSC2-PROVISORIO',
      'ROTA:' + routeDisplayName(route),
      'POOL:' + route.key,
      'SACA:' + saca.label,
      'LOTE:' + (state.loteId || ''),
      'HIB:' + (isHybridEffective(route) ? 1 : 0)
    ].join('|');
  }

  function renderLabels() {
    var wrap = document.getElementById('labelsWrap');
    var all = [];
    state.routes.forEach(function (route) {
      route.sacas.forEach(function (saca) { all.push({ route: route, saca: saca }); });
    });

    if (!all.length) {
      wrap.innerHTML = '<div class="placeholder">Todavía no hay sacas asignadas.<br>Andá a "Asignar sacas" primero.</div>';
      return;
    }

    var grid = document.createElement('div');
    grid.className = 'label-grid';
    grid.style.setProperty('--cols', document.getElementById('colsSelect').value || 3);

    all.forEach(function (item) {
      var card = document.createElement('div');
      card.className = 'label-card';
      var payload = qrPayloadFor(item.route, item.saca);
      card.innerHTML =
        '<div class="route-id">' + escapeHtml(routeDisplayName(item.route)) + (isHybridEffective(item.route) ? ' <span class="badge">HÍB</span>' : '') + '</div>' +
        '<div class="saca-seq">SACA ' + escapeHtml(item.saca.label) + '</div>' +
        '<div class="qr-holder"></div>' +
        (item.saca.veiculo ? '<div class="lote">' + escapeHtml(item.saca.veiculo) + '</div>' : '') +
        '<div class="lote">Lote ' + escapeHtml(state.loteId || '') + '</div>' +
        (item.saca.realQrPayload
          ? '<div class="lote" style="color:var(--success)">QR real</div>'
          : '<div class="lote" style="color:var(--warning)">QR provisório — no usar en producción</div>');
      grid.appendChild(card);

      var qr = window.qrcode(0, 'M');
      qr.addData(payload);
      qr.make();
      card.querySelector('.qr-holder').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2 });
    });

    wrap.innerHTML = '';
    wrap.appendChild(grid);
  }

  function markAllPrinted() {
    var now = new Date().toISOString();
    state.routes.forEach(function (route) {
      route.sacas.forEach(function (saca) { saca.printedAt = now; });
    });
    persist();
    renderAssign();
  }

  // ---------- tabs ----------

  function switchTab(name) {
    document.querySelectorAll('nav.tabs button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === name);
    });
    document.querySelectorAll('.screen').forEach(function (s) {
      s.classList.toggle('active', s.id === 'screen-' + name);
    });
    if (name === 'qr') renderLabels();
  }

  function renderAll() {
    renderAssign();
    if (document.getElementById('screen-qr').classList.contains('active')) renderLabels();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- wiring ----------

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('nav.tabs button[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () { switchTab(btn.getAttribute('data-tab')); });
    });

    document.getElementById('fileInput').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) handleFileSelect(e.target.files[0]);
    });

    document.getElementById('colsSelect').addEventListener('change', renderLabels);
    document.getElementById('printBtn').addEventListener('click', function () { window.print(); });
    document.getElementById('markPrintedBtn').addEventListener('click', markAllPrinted);

    init();
  });
})();
