(function () {
  'use strict';

  var SCHEMA_VERSION = 2;

  function defaultState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: null,
      batch: {
        fileName: null,
        loteId: '',
        importedAt: null
      },
      // route: { key, rotapl, rotaot, rota, expectedSacas, hybridGuess, hybridManual,
      //          sacas: [{seq, physicalCode, label, veiculo, empresa, agencia, printedAt}] }
      routes: []
    };
  }

  var state = defaultState();
  var parsedRows = null; // last parsed file: { headers: [...], rows: [[...], ...], fileName }

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
      badge.textContent = 'Modo local (fuera de Grid)';
      badge.classList.add('local');
    }
    renderAll();
  }

  // ---------- CSV parsing ----------

  function parseDelimited(text) {
    var firstLine = (text.split(/\r\n|\n/, 1)[0] || '');
    var delimiter = (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ',';
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

  // Column auto-detection: matches real export headers (ROTAPL, ROTASACA, ROTASACAPL, SERVICO, ...)
  // seen in the SSC2 BigQuery-backed sheet, with sensible fallbacks for other layouts.
  var COLUMN_CANDIDATES = {
    route: ['ROTACOMPLETA', 'ROTAOT', 'ROTA'],
    rotapl: ['ROTAPL'],
    rotaot: ['ROTAOT'],
    rota: ['ROTA'],
    sacaSeq: ['ROTASACA'],
    sacaCode: ['ROTASACAPL'],
    veiculo: ['VEICULO', 'VEÍCULO'],
    empresa: ['EMPRESA'],
    agencia: ['AGENCIA', 'AGÊNCIA'],
    servico: ['SERVICO', 'SERVIÇO'],
    qty: ['QTD_SACAS', 'QUANTIDADE_SACAS', 'QTDSACAS', 'QUANTIDADE'],
    hybrid: ['HIBRIDA', 'HÍBRIDA', 'HIBRIDO', 'HÍBRIDO']
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

  function isTruthyHybrid(value) {
    var v = String(value || '').trim().toUpperCase();
    return ['SIM', 'S', 'Y', 'YES', 'HIBRIDA', 'HÍBRIDA', 'HIBRIDO', 'HÍBRIDO', '1', 'TRUE', 'X'].indexOf(v) !== -1;
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

  function renderMapping() {
    var wrap = document.getElementById('mappingWrap');
    if (!parsedRows) { wrap.innerHTML = ''; return; }
    var h = parsedRows.headers;

    var g = {
      route: guessColumn(h, COLUMN_CANDIDATES.route),
      rotapl: guessColumn(h, COLUMN_CANDIDATES.rotapl),
      sacaSeq: guessColumn(h, COLUMN_CANDIDATES.sacaSeq),
      sacaCode: guessColumn(h, COLUMN_CANDIDATES.sacaCode),
      veiculo: guessColumn(h, COLUMN_CANDIDATES.veiculo),
      empresa: guessColumn(h, COLUMN_CANDIDATES.empresa),
      agencia: guessColumn(h, COLUMN_CANDIDATES.agencia),
      servico: guessColumn(h, COLUMN_CANDIDATES.servico),
      qty: guessColumn(h, COLUMN_CANDIDATES.qty),
      hybrid: guessColumn(h, COLUMN_CANDIDATES.hybrid)
    };

    wrap.innerHTML =
      '<div class="card">' +
      '<h2>2. Mapear columnas — ' + escapeHtml(parsedRows.fileName) + ' (' + parsedRows.rows.length + ' filas)</h2>' +
      '<p class="muted">Detectamos las columnas automáticamente por nombre. Revisá y ajustá si hace falta.</p>' +
      '<div class="field-row">' +
      '<label>Lote / turno<input type="text" id="loteInput" placeholder="ej. 2026-07-08-T1" value="' + escapeHtml(state.batch.loteId || defaultLoteId()) + '"></label>' +
      '<label>Clave de ruta (obligatoria)' + selectHtml('mapRoute', h, g.route) + '</label>' +
      '<label>Ruta madre / pool (ROTAPL)' + selectHtml('mapRotapl', h, g.rotapl) + '</label>' +
      '<label>Nro. de saca (ROTASACA)' + selectHtml('mapSacaSeq', h, g.sacaSeq) + '</label>' +
      '<label>Código físico de saca (ROTASACAPL)' + selectHtml('mapSacaCode', h, g.sacaCode) + '</label>' +
      '</div>' +
      '<div class="field-row">' +
      '<label>Vehículo' + selectHtml('mapVeiculo', h, g.veiculo) + '</label>' +
      '<label>Empresa' + selectHtml('mapEmpresa', h, g.empresa) + '</label>' +
      '<label>Agência' + selectHtml('mapAgencia', h, g.agencia) + '</label>' +
      '<label>Serviço (para filtrar filas Nex)' + selectHtml('mapServico', h, g.servico) + '</label>' +
      '</div>' +
      '<div class="field-row">' +
      '<label>Cantidad de sacas esperada (si no hay ROTASACA todavía)' + selectHtml('mapQty', h, g.qty) + '</label>' +
      '<label>Híbrida explícita (si el archivo ya la trae)' + selectHtml('mapHybrid', h, g.hybrid) + '</label>' +
      '</div>' +
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

    document.getElementById('mapServico').addEventListener('change', renderServicoFilters);
    document.getElementById('confirmImportBtn').addEventListener('click', confirmImport);
    renderServicoFilters();
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

  function defaultLoteId() {
    var d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function val(id) {
    var el = document.getElementById(id);
    var v = el.value;
    return v === '' ? -1 : parseInt(v, 10);
  }

  function confirmImport() {
    var idxRoute = val('mapRoute');
    var idxRotapl = val('mapRotapl');
    var idxSacaSeq = val('mapSacaSeq');
    var idxSacaCode = val('mapSacaCode');
    var idxVeiculo = val('mapVeiculo');
    var idxEmpresa = val('mapEmpresa');
    var idxAgencia = val('mapAgencia');
    var idxServico = val('mapServico');
    var idxQty = val('mapQty');
    var idxHybrid = val('mapHybrid');
    var loteId = document.getElementById('loteInput').value.trim() || defaultLoteId();

    if (idxRoute === -1) {
      alertBox('importAlert', 'Elegí qué columna identifica la ruta.', 'danger');
      return;
    }

    var allowedServicos = null;
    if (idxServico !== -1) {
      var checks = document.querySelectorAll('.servicoCheck:checked');
      allowedServicos = {};
      checks.forEach(function (c) { allowedServicos[c.value] = true; });
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
      if (!byRoute[key]) {
        byRoute[key] = {
          rotapl: idxRotapl !== -1 ? r[idxRotapl] : '',
          veiculos: {},
          empresas: {},
          qty: null,
          hybridExplicit: false,
          realSacas: []
        };
        order.push(key);
      }
      var info = byRoute[key];

      if (idxQty !== -1) {
        var q = parseInt(r[idxQty], 10);
        if (!isNaN(q)) info.qty = Math.max(info.qty || 0, q);
      }
      if (idxHybrid !== -1 && isTruthyHybrid(r[idxHybrid])) info.hybridExplicit = true;

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
          printedAt: null
        });
      }
    });

    order.forEach(function (key) {
      byRoute[key].realSacas.sort(function (a, b) { return a.seq - b.seq; });
    });

    var existingByKey = {};
    state.routes.forEach(function (r) { existingByKey[r.key] = r; });

    var newCount = 0, updatedCount = 0, unchangedCount = 0;
    var mergedRoutes = order.map(function (key) {
      var info = byRoute[key];
      var existing = existingByKey[key];
      var hasRealSacas = info.realSacas.length > 0;
      var distinctVehicles = Object.keys(info.veiculos).length;
      var distinctEmpresas = Object.keys(info.empresas).length;
      var hybridGuess = info.hybridExplicit || distinctVehicles > 1 || distinctEmpresas > 1;

      if (existing && !hasRealSacas) {
        existing.expectedSacas = info.qty || existing.expectedSacas;
        existing.hybridGuess = hybridGuess || existing.hybridGuess;
        existing.rotapl = info.rotapl || existing.rotapl;
        unchangedCount++;
        return existing;
      }

      if (existing) updatedCount++; else newCount++;
      return {
        key: key,
        rotapl: info.rotapl,
        expectedSacas: hasRealSacas ? info.realSacas.length : (info.qty || null),
        hybridGuess: hybridGuess,
        hybridManual: existing ? (existing.hybridManual != null ? existing.hybridManual : null) : null,
        sacas: hasRealSacas ? info.realSacas : (existing ? existing.sacas : [])
      };
    });

    // keep routes from other imports/batches that this file doesn't mention
    state.routes.forEach(function (r) { if (!byRoute[r.key]) mergedRoutes.push(r); });

    state.routes = mergedRoutes;
    state.batch = {
      fileName: parsedRows.fileName,
      loteId: loteId,
      importedAt: new Date().toISOString()
    };

    var msg = order.length + ' rutas en el archivo — ' + newCount + ' nuevas, ' + updatedCount + ' actualizadas con datos reales, ' + unchangedCount + ' sin cambios.';
    if (skippedByServico) msg += ' (' + skippedByServico + ' filas ignoradas por Serviço)';
    alertBox('importAlert', msg, 'success');
    persist();
    renderAll();
    switchTab('assign');
  }

  // ---------- assignment screen ----------

  function isHybridEffective(route) {
    return route.hybridManual != null ? route.hybridManual : !!route.hybridGuess;
  }

  function renderAssign() {
    var wrap = document.getElementById('routesWrap');
    if (!state.routes.length) {
      wrap.innerHTML = '<div class="placeholder">Todavía no importaste ningún archivo de separação.<br>Andá a la pestaña "Importar" para empezar.</div>';
      return;
    }

    wrap.innerHTML = state.routes.map(function (route, rIdx) {
      var chips = route.sacas.map(function (s, sIdx) {
        return '<span class="saca-chip' + (s.printedAt ? ' printed' : '') + '">' +
          'Saca ' + escapeHtml(s.label) + (s.veiculo ? ' · ' + escapeHtml(s.veiculo) : '') +
          '<button data-route="' + rIdx + '" data-saca="' + sIdx + '" class="removeSacaBtn" title="Quitar">&times;</button>' +
          '</span>';
      }).join('');

      var expected = route.expectedSacas;
      var countLabel = expected ? (route.sacas.length + ' / ' + expected + ' sacas') : (route.sacas.length + ' sacas');
      var hybrid = isHybridEffective(route);

      return '<div class="route-card">' +
        '<div class="route-head">' +
        '<strong>' + escapeHtml(route.key) + '</strong>' +
        (route.rotapl ? '<span class="muted">pool: ' + escapeHtml(route.rotapl) + '</span>' : '') +
        '<span class="badge route-count">' + countLabel + '</span>' +
        '<label style="flex-direction:row; align-items:center; gap:4px; font-size:12px">' +
        '<input type="checkbox" class="hybridToggle" data-route="' + rIdx + '"' + (hybrid ? ' checked' : '') + '> Híbrida' +
        (route.hybridManual == null ? ' <span class="muted">(sugerida)</span>' : '') +
        '</label>' +
        '</div>' +
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
          route.sacas.push({ seq: i, physicalCode: null, label: String(i), veiculo: '', empresa: '', agencia: '', printedAt: null });
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
    route.sacas.push({ seq: route.sacas.length + 1, physicalCode: null, label: label, veiculo: '', empresa: '', agencia: '', printedAt: null });
    persist();
    renderAssign();
  }

  // ---------- QR / print screen ----------

  function qrPayloadFor(route, saca) {
    return [
      'NEX-SSC2',
      'ROTA:' + route.key,
      'SACA:' + saca.label,
      'LOTE:' + (state.batch.loteId || ''),
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
        '<div class="route-id">' + escapeHtml(item.route.key) + (isHybridEffective(item.route) ? ' <span class="badge">HÍB</span>' : '') + '</div>' +
        '<div class="saca-seq">SACA ' + escapeHtml(item.saca.label) + '</div>' +
        '<div class="qr-holder"></div>' +
        (item.saca.veiculo ? '<div class="lote">' + escapeHtml(item.saca.veiculo) + '</div>' : '') +
        '<div class="lote">Lote ' + escapeHtml(state.batch.loteId || '') + '</div>';
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
