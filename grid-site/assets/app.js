(function () {
  'use strict';

  var SCHEMA_VERSION = 1;

  function defaultState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: null,
      batch: {
        fileName: null,
        loteId: '',
        importedAt: null,
        mode: null, // 'grouped' | 'expanded'
      },
      routes: [] // { id, expectedSacas, isHybrid, sacas: [{seq, label, printedAt}] }
    };
  }

  var state = defaultState();
  var parsedRows = null; // last parsed CSV: { headers: [...], rows: [[...], ...] }

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
    el.className = 'card ' + (kind === 'danger' ? 'danger' : 'muted');
    el.style.display = message ? 'block' : 'none';
    if (kind === 'danger') {
      el.style.background = 'var(--danger-bg)';
      el.style.color = 'var(--danger)';
      el.style.borderColor = 'var(--danger)';
    }
  }

  function isTruthyHybrid(value) {
    var v = String(value || '').trim().toUpperCase();
    return ['SIM', 'S', 'Y', 'YES', 'HIBRIDA', 'HÍBRIDA', 'HIBRIDO', 'HÍBRIDO', '1', 'TRUE', 'X'].indexOf(v) !== -1;
  }

  // ---------- import mapping screen ----------

  function renderMapping() {
    var wrap = document.getElementById('mappingWrap');
    if (!parsedRows) { wrap.innerHTML = ''; return; }

    var opts = ['<option value="">— no usar —</option>'].concat(
      parsedRows.headers.map(function (h, idx) {
        return '<option value="' + idx + '">' + escapeHtml(h) + '</option>';
      })
    ).join('');

    wrap.innerHTML =
      '<div class="card">' +
      '<h2>2. Mapear columnas — ' + escapeHtml(parsedRows.fileName) + ' (' + parsedRows.rows.length + ' filas)</h2>' +
      '<div class="field-row">' +
      '<label>Lote / turno<input type="text" id="loteInput" placeholder="ej. 2026-07-08-T1" value="' + escapeHtml(state.batch.loteId || defaultLoteId()) + '"></label>' +
      '<label>Columna de ruta (obligatoria)<select id="mapRoute">' + opts + '</select></label>' +
      '<label>Columna de cantidad de sacas (opcional)<select id="mapQty">' + opts + '</select></label>' +
      '<label>Columna de híbrida (opcional)<select id="mapHybrid">' + opts + '</select></label>' +
      '</div>' +
      '<p class="muted">Si no elegís columna de cantidad, cada fila del archivo se cuenta como una saca de esa ruta.</p>' +
      '<table class="data-table"><thead><tr>' +
      parsedRows.headers.map(function (h) { return '<th>' + escapeHtml(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      parsedRows.rows.slice(0, 5).map(function (r) {
        return '<tr>' + parsedRows.headers.map(function (_, i) { return '<td>' + escapeHtml(r[i] || '') + '</td>'; }).join('') + '</tr>';
      }).join('') +
      '</tbody></table>' +
      '<p class="muted">Mostrando las primeras 5 filas de ' + parsedRows.rows.length + '.</p>' +
      '<button class="btn" id="confirmImportBtn">Importar rutas</button>' +
      '</div>';

    document.getElementById('confirmImportBtn').addEventListener('click', confirmImport);
  }

  function defaultLoteId() {
    var d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function confirmImport() {
    var routeIdx = document.getElementById('mapRoute').value;
    var qtyIdx = document.getElementById('mapQty').value;
    var hybridIdx = document.getElementById('mapHybrid').value;
    var loteId = document.getElementById('loteInput').value.trim() || defaultLoteId();

    if (routeIdx === '') {
      alertBox('importAlert', 'Elegí qué columna identifica la ruta.', 'danger');
      return;
    }

    if (state.routes.length > 0) {
      var ok = window.confirm ?
        confirm('Ya hay rutas cargadas con asignaciones de sacas. Importar de nuevo va a reemplazar todo. ¿Continuar?') :
        true;
      if (!ok) return;
    }

    var byRoute = {};
    var order = [];
    parsedRows.rows.forEach(function (r) {
      var id = (r[routeIdx] || '').trim();
      if (!id) return;
      if (!byRoute[id]) { byRoute[id] = { count: 0, hybrid: false }; order.push(id); }
      if (qtyIdx !== '') {
        var q = parseInt(r[qtyIdx], 10);
        byRoute[id].count = isNaN(q) ? byRoute[id].count : Math.max(byRoute[id].count, q);
      } else {
        byRoute[id].count += 1;
      }
      if (hybridIdx !== '' && isTruthyHybrid(r[hybridIdx])) {
        byRoute[id].hybrid = true;
      }
    });

    state.routes = order.map(function (id) {
      var info = byRoute[id];
      return {
        id: id,
        expectedSacas: info.count || 1,
        isHybrid: info.hybrid,
        sacas: []
      };
    });
    state.batch = {
      fileName: parsedRows.fileName,
      loteId: loteId,
      importedAt: new Date().toISOString(),
      mode: qtyIdx !== '' ? 'grouped' : 'expanded'
    };

    alertBox('importAlert', order.length + ' rutas importadas correctamente.', 'success');
    persist();
    renderAll();
    switchTab('assign');
  }

  // ---------- assignment screen ----------

  function renderAssign() {
    var wrap = document.getElementById('routesWrap');
    if (!state.routes.length) {
      wrap.innerHTML = '<div class="placeholder">Todavía no importaste ningún archivo de separación.<br>Andá a la pestaña "Importar" para empezar.</div>';
      return;
    }

    wrap.innerHTML = state.routes.map(function (route, rIdx) {
      var chips = route.sacas.map(function (s, sIdx) {
        return '<span class="saca-chip' + (s.printedAt ? ' printed' : '') + '">' +
          'Saca ' + escapeHtml(s.label) +
          '<button data-route="' + rIdx + '" data-saca="' + sIdx + '" class="removeSacaBtn" title="Quitar">&times;</button>' +
          '</span>';
      }).join('');

      return '<div class="route-card">' +
        '<div class="route-head">' +
        '<strong>' + escapeHtml(route.id) + '</strong>' +
        '<span class="badge route-count">' + route.sacas.length + ' / ' + route.expectedSacas + ' sacas asignadas</span>' +
        (route.isHybrid ? '<span class="badge">Ruta híbrida</span>' : '') +
        '</div>' +
        '<div class="saca-list">' + chips + '</div>' +
        '<div style="margin-top:10px; display:flex; gap:8px; align-items:center;">' +
        '<input type="text" placeholder="Nro/etiqueta de saca" class="newSacaLabel" data-route="' + rIdx + '" style="width:160px">' +
        '<button class="btn secondary addSacaBtn" data-route="' + rIdx + '">+ Agregar saca</button>' +
        '<button class="btn secondary autoFillBtn" data-route="' + rIdx + '">Autocompletar 1..' + route.expectedSacas + '</button>' +
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
          route.sacas.push({ seq: i, label: String(i), printedAt: null });
        }
        persist();
        renderAssign();
      });
    });
  }

  function addSaca(routeIdx, label) {
    var route = state.routes[routeIdx];
    route.sacas.push({ seq: route.sacas.length + 1, label: label, printedAt: null });
    persist();
    renderAssign();
  }

  // ---------- QR / print screen ----------

  function qrPayloadFor(route, saca) {
    return ['NEX-SSC2', 'ROTA:' + route.id, 'SACA:' + saca.label, 'LOTE:' + (state.batch.loteId || ''), 'HIB:' + (route.isHybrid ? 1 : 0)].join('|');
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
        '<div class="route-id">' + escapeHtml(item.route.id) + (item.route.isHybrid ? ' <span class="badge">HÍB</span>' : '') + '</div>' +
        '<div class="saca-seq">SACA ' + escapeHtml(item.saca.label) + '</div>' +
        '<div class="qr-holder"></div>' +
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
