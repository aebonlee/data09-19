/* 엔진 인터페이스 옵션 관리 — 화면 (옵션 내역 · 옵션 카탈로그 · 가져오기 · 사용 빈도 · 기준별 비교 · 백업·복원) */
(function () {
  'use strict';
  var L = window.OPLogic;
  var S = window.OPStore;
  var Sample = window.OPSample;
  var XLSX = window.XLSX;
  var PAGE = 50;

  var db = S.loadDb();
  var imp = null;          // 가져오기 진행 상태
  var view = { q: '', filters: {}, page: 0, onlyBad: false };
  var anal = { filters: {}, axis: 'f_region', option: 'f_cel' };

  // 차트 색 — 선택지 순서(카탈로그 순서)에 고정해 거르기를 바꿔도 색이 바뀌지 않습니다. 미입력은 회색
  var SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
  var EMPTY_COLOR = '#a3a8b0';
  var NA_COLOR = '#dcdfe4';   // 적용 조건상 쓰지 않음 — 미입력보다 옅게
  var OVER_COLOR = '#6b7280';

  // ── 작은 도구 ─────────────────────────────────────────────
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  function fmt(n) { return n == null || n === '' ? '' : Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 1 }); }
  function toast(msg, isError) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast' + (isError ? ' error' : '');
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 3500);
  }
  function save() { if (!S.saveDb(db)) document.getElementById('storeBanner').hidden = false; }
  function field(label, input, hint) {
    return h('label', { class: 'field' }, h('span', null, label), input, hint ? h('small', { class: 'hint' }, hint) : null);
  }
  function select(name, options, value, attrs) {
    var s = h('select', Object.assign({ name: name }, attrs || {}));
    options.forEach(function (o) {
      var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o;
      s.appendChild(h('option', { value: v, selected: String(v) === String(value) }, t));
    });
    return s;
  }
  function openDialog(title, content, actions) {
    var d = document.getElementById('dialog');
    document.getElementById('dialogTitle').textContent = title;
    var c = document.getElementById('dialogContent'); c.textContent = ''; add(c, content);
    var a = document.getElementById('dialogActions'); a.textContent = ''; add(a, actions);
    if (!d.open) d.showModal();
  }
  function closeDialog() { var d = document.getElementById('dialog'); if (d.open) d.close(); }
  function confirmDialog(title, text, okLabel, onOk) {
    openDialog(title, h('p', null, text), [
      h('button', { type: 'button', class: 'btn', onclick: closeDialog }, '취소'),
      h('button', { type: 'button', class: 'btn btn-danger', onclick: function () { closeDialog(); onOk(); } }, okLabel)]);
  }
  function download(name, blob) {
    var a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function writeXlsx(name, sheets) {
    var wb = XLSX.utils.book_new();
    Object.keys(sheets).forEach(function (n) {
      var ws = XLSX.utils.aoa_to_sheet(sheets[n]);
      ws['!cols'] = (sheets[n][0] || []).map(function () { return { wch: 18 }; });
      XLSX.utils.book_append_sheet(wb, ws, n.replace(/[\\\/?*\[\]:]/g, '-').slice(0, 31));
    });
    var out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    download(name, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function tag() { return db._sample ? '_예시데이터' : ''; }
  function F(id) { return L.getField(db.catalog, id); }
  function errText(e) {
    return { name_required: '이름을 적어 주세요', name_duplicate: '같은 이름의 항목이 이미 있습니다', label_required: '선택지 이름을 적어 주세요', label_duplicate: '같은 이름의 선택지가 이미 있습니다',
      rule_field: '옵션 항목과 조건 항목을 골라 주세요', rule_self: '옵션 항목과 조건 항목이 같습니다', rule_target: '규칙은 옵션 항목에만 걸 수 있습니다',
      rule_when: '조건 항목은 선택 목록 항목이어야 합니다', rule_choices: '조건이 되는 선택지를 하나 이상 골라 주세요', rule_duplicate: '같은 옵션·조건 항목의 규칙이 이미 있습니다 — 지우고 다시 만드세요' }[e.message] || e.message;
  }
  function colorOf(field, choiceId) {
    if (!choiceId) return EMPTY_COLOR;
    if (choiceId === L.NA_ID) return NA_COLOR;
    var i = field.choices.map(function (c) { return c.id; }).indexOf(choiceId);
    return i >= 0 && i < SERIES.length ? SERIES[i] : OVER_COLOR;
  }
  function swatch(color) { return h('span', { class: 'swatch', style: 'background:' + color, 'aria-hidden': 'true' }); }
  function addRecords(list, replace) {
    if (replace) { db.records = []; db.seq = 0; }
    list.forEach(function (r) { db.seq = (db.seq || 0) + 1; db.records.push({ id: 'r' + db.seq, v: r.v }); });
  }

  function loadSample() {
    var s = Sample.sampleDb();
    db.catalog = s.catalog; db.records = s.records; db.seq = s.seq; db._sample = true;
    save(); view = { q: '', filters: {}, page: 0, onlyBad: false }; anal.filters = {};
    location.hash = '#/records';
    render();
    toast('예시 데이터 ' + s.records.length + '건을 불러왔습니다');
  }
  function sampleButton(primary) {
    return h('button', { type: 'button', class: 'btn' + (primary ? ' btn-primary' : ''), onclick: function () {
      if (!db.records.length) { loadSample(); return; }
      confirmDialog('예시 데이터 불러오기', '지금 있는 옵션 내역 ' + db.records.length + '건과 카탈로그를 지우고 예시 데이터(가상)로 바꿉니다. 필요하면 먼저 「백업·복원」에서 백업하세요.', '바꾸기', loadSample);
    } }, '예시 데이터 불러오기');
  }
  function importButton(label) {
    var inp = h('input', { type: 'file', accept: '.xlsx,.xls,.csv', 'aria-label': 'Excel·CSV 파일 고르기', onchange: function () { if (inp.files.length) startImport(inp.files); inp.value = ''; } });
    return h('label', { class: 'btn file-btn' }, label || 'Excel 가져오기', inp);
  }
  function emptyNotice(main, title) {
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, title)));
    main.appendChild(h('section', { class: 'card' },
      h('p', null, '아직 옵션 내역이 없습니다. 「옵션 내역」에서 입력하거나, Excel을 가져오거나, 예시 데이터를 불러오세요.'),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn btn-primary', href: '#/records' }, '옵션 내역으로'), sampleButton(false))));
  }

  // ── 라우팅 ────────────────────────────────────────────────
  var ROUTES = { records: renderRecords, catalog: renderCatalog, 'import': renderImport, stats: renderStats, pivot: renderPivot, data: renderData };
  function route() { var r = (location.hash.replace(/^#\/?/, '').split('/')[0]) || 'records'; return ROUTES[r] ? r : 'records'; }
  function render() {
    var r = route();
    if (r === 'import' && !imp) { location.hash = '#/records'; return; }
    var main = document.getElementById('main');
    main.textContent = '';
    document.querySelectorAll('#nav a').forEach(function (a) {
      var dr = a.getAttribute('data-route');
      if (dr === r || (r === 'import' && dr === 'records')) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    document.getElementById('sampleBanner').hidden = !db._sample;
    document.getElementById('storeBanner').hidden = S.available();
    ROUTES[r](main);
    main.setAttribute('data-route', r);
  }
  window.addEventListener('hashchange', function () { closeDialog(); render(); window.scrollTo(0, 0); });

  // ── 옵션 내역 ─────────────────────────────────────────────
  // 거르기 칸: 선택형 기본 정보 항목 + 고객사(글자)
  function filterControls(state, onChange) {
    var box = h('div', { class: 'filters' });
    L.fieldsOf(db.catalog, 'base').forEach(function (f) {
      if (f.type === 'number') return;
      var opts = [['', '전체']];
      if (f.type === 'select') f.choices.forEach(function (c) { opts.push([c.id, c.label + (c.active ? '' : ' (숨김)')]); });
      else L.distinctValues(db.records, f.id).forEach(function (d) { opts.push([d.value, d.value + ' (' + d.count + ')']); });
      if (f.type === 'text' && opts.length > 200) return; // 값이 너무 많은 글자 항목은 검색어로
      opts.push([L.EMPTY_LABEL, L.EMPTY_LABEL]);
      var s = select('flt_' + f.id, opts, state.filters[f.id] || '');
      s.addEventListener('change', function () { if (s.value) state.filters[f.id] = s.value; else delete state.filters[f.id]; onChange(); });
      box.appendChild(field(f.name, s));
    });
    return box;
  }
  function renderRecords(main) {
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, '옵션 내역'),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { editRecord(null); } }, '새 레코드 입력'),
        importButton(),
        db.records.length ? h('button', { type: 'button', class: 'btn', onclick: exportAll }, 'Excel 내보내기') : null,
        sampleButton(false))));

    if (!db.records.length) {
      main.appendChild(h('section', { class: 'card' },
        h('h2', null, '시작하기'),
        h('ol', { class: 'prompt-steps' },
          h('li', null, '「옵션 카탈로그」에서 옵션 항목과 선택지를 확인하고 필요한 것을 추가합니다. 2026-09-29에 구체화한 옵션 13개(ATS type, CAN1(J1939) baudrate, Accelerator type … Electric feed pump)와 적용 조건이 들어 있습니다.'),
          h('li', null, '「새 레코드 입력」으로 고객사×장비 한 건씩 입력하거나, 「Excel 가져오기」로 기존 파일을 불러와 열을 항목에 연결합니다.'),
          h('li', null, '「사용 빈도」「기준별 비교」에서 고객사·Emission regulation·Machine type별로 많이 쓰는 옵션을 봅니다.')),
        h('p', { class: 'note' }, '먼저 둘러보려면 예시 데이터(가상 고객사 8곳, 96건)를 불러오세요. 가져오기 연습용 파일은 samples 폴더의 「예시데이터_옵션내역.xlsx」입니다.'),
        h('div', { class: 'btn-row' }, sampleButton(true))));
      return;
    }

    var card = h('section', { class: 'card' });
    var q = h('input', { type: 'search', name: 'q', value: view.q, placeholder: '고객사·suffix·선택지 이름 등' });
    q.addEventListener('change', function () { view.q = q.value; view.page = 0; render(); });
    var filters = filterControls(view, function () { view.page = 0; render(); });
    filters.insertBefore(field('검색어', q), filters.firstChild);
    card.appendChild(filters);

    var bad = L.ruleViolations(db.catalog, db.records);
    var badIds = {};
    bad.forEach(function (b) { badIds[b.recordId] = true; });
    var badCount = Object.keys(badIds).length;
    if (!badCount) view.onlyBad = false;
    if (badCount) card.appendChild(h('div', { class: 'alert warn', 'data-violations': String(badCount) },
      '적용 조건에 맞지 않는 값이 든 레코드가 ' + badCount + '건 있습니다(예: DPF 가 없는 ATS 인데 Regeneration 스위치 값이 있음). 행을 눌러 고치거나, 「옵션 카탈로그」의 적용 조건을 확인하세요. ',
      h('button', { type: 'button', class: 'btn btn-sm', onclick: function () { view.onlyBad = !view.onlyBad; view.page = 0; render(); } }, view.onlyBad ? '모두 보기' : '해당 레코드만 보기')));

    var list = L.filterRecords(db.catalog, db.records, view.q, view.filters);
    if (view.onlyBad) list = list.filter(function (r) { return badIds[r.id]; });
    var active = Object.keys(view.filters).length || view.q || view.onlyBad;
    card.appendChild(h('div', { class: 'list-meta' },
      h('span', null, '전체 ' + db.records.length + '건' + (active ? ' 중 ' + list.length + '건' : '')),
      active ? h('button', { type: 'button', class: 'btn', onclick: function () { view = { q: '', filters: {}, page: 0, onlyBad: false }; render(); } }, '거르기 풀기') : null,
      h('span', { class: 'note' }, '행을 누르면 고치기·복제 입력·지우기를 할 수 있습니다.')));

    var cols = L.fieldsOf(db.catalog);
    var pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (view.page >= pages) view.page = pages - 1;
    var tb = h('tbody');
    list.slice(view.page * PAGE, view.page * PAGE + PAGE).forEach(function (r) {
      var tr = h('tr', { class: 'clickable', tabindex: '0', onclick: function () { editRecord(r); },
        onkeydown: function (e) { if (e.key === 'Enter') editRecord(r); } },
        cols.map(function (f) {
          var t = L.displayValue(f, r.v[f.id]);
          var ok = L.isApplicable(db.catalog, r.v, f.id);
          if (!t) return h('td', null, h('span', { class: 'muted', title: ok ? '미입력' : '적용 조건상 쓰지 않음' }, ok ? '—' : '해당 없음'));
          return h('td', { class: (f.type === 'number' ? 'num' : '') + (ok ? '' : ' cell-bad'), title: ok ? null : '적용 조건에 맞지 않는 값' }, t);
        }));
      tb.appendChild(tr);
    });
    card.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, cols.map(function (f) { return h('th', { class: f.kind === 'option' ? 'th-option' : '' }, f.name); }))), tb)));
    if (pages > 1) card.appendChild(h('div', { class: 'pager' },
      h('button', { type: 'button', class: 'btn', disabled: view.page === 0, onclick: function () { view.page--; render(); } }, '이전'),
      h('span', null, (view.page + 1) + ' / ' + pages + ' 쪽'),
      h('button', { type: 'button', class: 'btn', disabled: view.page >= pages - 1, onclick: function () { view.page++; render(); } }, '다음')));
    main.appendChild(card);
  }

  // 레코드 입력·고치기 대화상자. copyFrom 이 있으면 그 값으로 채운 새 레코드(복제 입력)
  function editRecord(rec, copyFrom) {
    var src = rec ? rec.v : (copyFrom ? copyFrom.v : {});
    var inputs = {};
    function control(f) {
      var x = src[f.id];
      if (f.type === 'select') {
        var opts = [['', '(선택 안 함)']];
        f.choices.forEach(function (c) { if (c.active || c.id === x) opts.push([c.id, c.label + (c.active ? '' : ' (숨김)')]); });
        return select(f.id, opts, x || '');
      }
      if (f.type === 'number') return h('input', { type: 'text', inputmode: 'decimal', name: f.id, value: x == null ? '' : String(x) });
      var inp = h('input', { type: 'text', name: f.id, value: x == null ? '' : String(x), list: 'dl_' + f.id, autocomplete: 'off' });
      return [inp, h('datalist', { id: 'dl_' + f.id }, L.distinctValues(db.records, f.id).slice(0, 200).map(function (d) { return h('option', { value: d.value }); }))];
    }
    function group(kind, title) {
      var fs = L.fieldsOf(db.catalog, kind);
      return [h('h3', { class: 'form-sec' }, title), h('div', { class: 'form-grid' }, fs.map(function (f) {
        var c = control(f);
        inputs[f.id] = Array.isArray(c) ? c[0] : c;
        var hint = f.type === 'select' && !f.choices.some(function (x) { return x.active; }) ? '선택지가 아직 없습니다 — 「옵션 카탈로그」에서 추가' : null;
        return field(f.name + (f.required ? ' (필수)' : ''), c, hint);
      }))];
    }
    var errBox = h('div');
    var content = [errBox, group('base', '기본 정보'), group('option', '옵션 선택')];
    function collect() { var v = {}; Object.keys(inputs).forEach(function (k) { v[k] = inputs[k].value; }); return v; }
    // 적용 조건: 조건 항목을 바꾸면 해당 없는 옵션은 비우고 잠급니다(규칙이 이어질 수 있어 두 번 돌립니다)
    var ruleNotes = {};
    L.rulesOf(db.catalog).forEach(function (r) {
      var inp = inputs[r.target];
      if (!inp || ruleNotes[r.target]) return;
      ruleNotes[r.target] = h('small', { class: 'hint rule-note' });
      inp.parentNode.appendChild(ruleNotes[r.target]);
    });
    function applyRules() {
      for (var pass = 0; pass < 2; pass++) {
        var v = collect();
        Object.keys(ruleNotes).forEach(function (fid) {
          var a = L.applicability(db.catalog, v, fid);
          var inp = inputs[fid];
          inp.disabled = !a.ok;
          if (!a.ok) inp.value = '';
          ruleNotes[fid].textContent = a.ok ? '' : '해당 없음 — ' + L.ruleText(db.catalog, a.rule);
        });
      }
    }
    Object.keys(inputs).forEach(function (k) { inputs[k].addEventListener('change', applyRules); });
    function doSave() {
      var v = collect();
      var errs = L.validateRecord(db.catalog, v);
      errBox.textContent = '';
      if (errs.length) {
        errBox.appendChild(h('div', { class: 'alert error' }, errs.map(function (e) {
          return h('div', null, F(e.fieldId).name + ' — ' + ({ required: '꼭 적어야 합니다', not_number: '숫자로 적어 주세요(예: 75 또는 75 kW)', unknown_choice: '카탈로그에 없는 선택지입니다', not_applicable: '적용 조건상 쓰지 않는 항목입니다. 값을 비우세요' }[e.code]));
        })));
        return;
      }
      // 숨긴 항목 값은 그대로 두고, 보이는 항목 값만 바꿉니다
      var clean = L.cleanRecord(db.catalog, v);
      var base = rec ? Object.assign({}, rec.v) : {};
      Object.keys(inputs).forEach(function (k) { delete base[k]; });
      var nv = Object.assign(base, clean);
      if (rec) rec.v = nv; else addRecords([{ v: nv }]);
      save(); closeDialog(); render();
      toast(rec ? '고쳤습니다' : '새 레코드를 입력했습니다');
    }
    var actions = [h('button', { type: 'button', class: 'btn', onclick: closeDialog }, '취소')];
    if (rec) {
      actions.push(h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
        confirmDialog('레코드 지우기', '이 레코드를 지웁니다. 되돌릴 수 없습니다.', '지우기', function () {
          db.records = db.records.filter(function (x) { return x !== rec; }); save(); render(); toast('지웠습니다');
        });
      } }, '지우기'));
      actions.push(h('button', { type: 'button', class: 'btn', onclick: function () { editRecord(null, { v: L.cleanRecord(db.catalog, collect()) }); } }, '복제 입력'));
    }
    actions.push(h('button', { type: 'button', class: 'btn btn-primary', onclick: doSave }, rec ? '저장' : '입력'));
    openDialog(rec ? '레코드 고치기' : (copyFrom ? '복제 입력 — 바뀐 곳만 고치세요' : '새 레코드 입력'), content, actions);
    // 고치기로 연 레코드가 이미 규칙에 어긋나 있으면 값을 몰래 지우지 않고 알려 줍니다
    var pre = rec ? L.validateRecord(db.catalog, L.cleanRecord(db.catalog, collect())).filter(function (e) { return e.code === 'not_applicable'; }) : [];
    if (pre.length) {
      errBox.appendChild(h('div', { class: 'alert warn' }, pre.map(function (e) { return h('div', null, F(e.fieldId).name + ' — ' + L.ruleText(db.catalog, L.applicability(db.catalog, rec.v, e.fieldId).rule) + '. 값을 비우거나 조건 항목을 고치세요.'); })));
      Object.keys(ruleNotes).forEach(function (fid) { if (inputs[fid].value) ruleNotes[fid].textContent = '적용 조건에 맞지 않는 값'; });
    } else applyRules();
  }

  function exportAll() {
    var sheets = { '옵션 내역': L.recordsSheet(db.catalog, db.records), '카탈로그': L.catalogSheet(db.catalog), '적용 조건': L.rulesSheet(db.catalog) };
    var opts = L.fieldsOf(db.catalog, 'option').map(function (f) { return f.id; });
    ['f_customer', 'f_region', 'f_equip'].forEach(function (a) {
      var f = F(a);
      if (f && f.active) sheets[f.name + '별 최다 옵션'] = L.topSheet(db.catalog, L.topByAxis(db.catalog, db.records, a, opts), f.name, opts);
    });
    writeXlsx('인터페이스옵션' + tag() + '_' + today() + '.xlsx', sheets);
  }

  // ── 옵션 카탈로그 ─────────────────────────────────────────
  function tryDo(fn) { try { fn(); save(); render(); return true; } catch (e) { toast(errText(e), true); return false; } }
  function renderCatalog(main) {
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, '옵션 카탈로그'),
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn', onclick: function () {
        writeXlsx('옵션카탈로그' + tag() + '_' + today() + '.xlsx', { '카탈로그': L.catalogSheet(db.catalog), '적용 조건': L.rulesSheet(db.catalog) });
      } }, '카탈로그 Excel 내보내기'))));
    main.appendChild(h('section', { class: 'card' },
      h('p', null, '옵션 항목과 항목별 선택지를 여기서 직접 늘리고 고칩니다. 코드를 고치지 않아도 됩니다.'),
      h('p', { class: 'note' }, '지우기 대신 「숨기기」를 씁니다. 숨긴 항목·선택지는 새 입력 화면에서 빠지지만, 이미 입력한 기록과 집계에는 남습니다. 선택지 이름을 고치면 이미 입력한 레코드에도 새 이름이 보입니다.'),
      Array.isArray(db.catalog.rules) ? null : h('div', { class: 'alert info', 'data-old-catalog': '1' },
        '지금 카탈로그는 2026-09-29 이전 판입니다. 처음 카탈로그가 구체화한 옵션 13개와 적용 조건으로 바뀌었습니다. 예시 데이터라면 「예시 데이터 불러오기」로, 실제 데이터라면 백업한 뒤 「백업·복원 → 모두 지우기」로 새 카탈로그를 볼 수 있습니다. 적용 조건은 아래에서 직접 추가할 수도 있습니다.')));

    var fs = h('section', { class: 'card' }, h('h2', null, '항목 추가'));
    var nm = h('input', { type: 'text', name: 'new_field', placeholder: '예: 새 옵션 항목 이름' });
    var kind = select('new_kind', [['option', '옵션(선택지 중에서 고름)'], ['base', '기본 정보']], 'option');
    var type = select('new_type', [['select', '선택 목록'], ['text', '글자'], ['number', '숫자']], 'select');
    function syncType() { type.disabled = kind.value === 'option'; if (type.disabled) type.value = 'select'; }
    kind.addEventListener('change', syncType); syncType();
    fs.appendChild(h('div', { class: 'filters' }, field('항목 이름', nm), field('구분', kind), field('입력 형식', type, '옵션은 항상 선택 목록'),
      h('div', { class: 'field' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
        tryDo(function () { var f = L.addField(db.catalog, { name: nm.value, kind: kind.value, type: type.value }); toast('「' + f.name + '」 항목을 추가했습니다'); });
      } }, '항목 추가'))));
    main.appendChild(fs);

    [['base', '기본 정보 항목', '레코드를 구분하는 정보입니다. 장비 유형·지역처럼 목록에서 고르는 항목은 선택지를 관리합니다.'],
     ['option', '옵션 항목', '고객사가 장비별로 고르는 인터페이스 옵션입니다. 처음 카탈로그는 2026-09-29에 구체화한 13개 항목과 선택지입니다. Oil pressure lamp 는 선택지가 정해지지 않아 비워 두었습니다.']].forEach(function (g) {
      var sec = h('section', { class: 'card' }, h('h2', null, g[1]), h('p', { class: 'note' }, g[2]));
      var list = L.fieldsOf(db.catalog, g[0], true);
      list.forEach(function (f, i) { sec.appendChild(fieldCard(f, i, list.length)); });
      main.appendChild(sec);
    });
    main.appendChild(rulesCard());
  }

  // 적용 조건(규칙): 「이 옵션은 저 항목이 이 선택지일 때만 씁니다」
  function rulesCard() {
    var sec = h('section', { class: 'card', id: 'rules' }, h('h2', null, '적용 조건'),
      h('p', { class: 'note' }, '특정 장비 유형이나 후처리 방식에서만 쓰는 옵션을 적어 둡니다. 조건에 맞지 않는 레코드에서는 입력 칸이 잠기고, 집계에는 「(해당 없음)」으로 따로 셉니다(미입력과 구분). 처음 들어 있는 3개는 가정이니 실제와 다르면 지우고 다시 만드세요.'));
    var rs = L.rulesOf(db.catalog);
    var ul = h('ul', { class: 'rule-list' });
    if (!rs.length) ul.appendChild(h('li', { class: 'note' }, '규칙이 없습니다. 모든 옵션을 모든 레코드에서 씁니다.'));
    rs.forEach(function (r) {
      var n = L.ruleViolations({ fields: db.catalog.fields, rules: [r] }, db.records).length;
      ul.appendChild(h('li', { class: 'rule-row', 'data-rule': r.id }, h('span', null, L.ruleText(db.catalog, r)),
        n ? h('span', { class: 'note warn-text' }, ' 어긋난 레코드 ' + n + '건') : null,
        h('button', { type: 'button', class: 'btn btn-sm', onclick: function () { tryDo(function () { L.removeRule(db.catalog, r.id); }); toast('규칙을 지웠습니다'); } }, '지우기')));
    });
    sec.appendChild(ul);

    var opts = L.fieldsOf(db.catalog, 'option').map(function (f) { return [f.id, f.name]; });
    var whens = L.fieldsOf(db.catalog).filter(function (f) { return f.type === 'select'; }).map(function (f) { return [f.id, (f.kind === 'base' ? '기본 정보 · ' : '옵션 · ') + f.name]; });
    var tSel = select('rule_target', [['', '(옵션 항목)']].concat(opts), '', { 'aria-label': '규칙을 걸 옵션 항목' });
    var wSel = select('rule_when', [['', '(조건 항목)']].concat(whens), '', { 'aria-label': '조건 항목' });
    var box = h('div', { class: 'rule-choices', role: 'group', 'aria-label': '이 선택지일 때만 씀' });
    function drawChoices() {
      box.textContent = '';
      var w = F(wSel.value);
      if (!w) { box.appendChild(h('span', { class: 'note' }, '조건 항목을 고르면 선택지가 나옵니다.')); return; }
      if (!w.choices.length) { box.appendChild(h('span', { class: 'note' }, '이 항목은 선택지가 없습니다.')); return; }
      w.choices.forEach(function (c) {
        box.appendChild(h('label', { class: 'check' }, h('input', { type: 'checkbox', value: c.id }), c.label + (c.active ? '' : ' (숨김)')));
      });
    }
    wSel.addEventListener('change', drawChoices); drawChoices();
    sec.appendChild(h('h3', { class: 'form-sec' }, '규칙 추가'));
    sec.appendChild(h('div', { class: 'filters' }, field('옵션 항목', tSel), field('조건 항목', wSel)));
    sec.appendChild(h('div', { class: 'field' }, h('span', null, '이 선택지일 때만 씀'), box));
    sec.appendChild(h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
      var ins = Array.prototype.map.call(box.querySelectorAll('input:checked'), function (x) { return x.value; });
      tryDo(function () { var r = L.addRule(db.catalog, { target: tSel.value, when: wSel.value, 'in': ins }); toast(L.ruleText(db.catalog, r)); });
    } }, '규칙 추가')));
    return sec;
  }
  function fieldCard(f, i, n) {
    var used = db.records.filter(function (r) { return r.v[f.id] != null && r.v[f.id] !== ''; }).length;
    var name = h('input', { type: 'text', value: f.name, 'aria-label': '항목 이름', class: 'name-input' });
    name.addEventListener('change', function () { if (!tryDo(function () { L.renameField(db.catalog, f.id, name.value); })) name.value = f.name; });
    var typeLabel = { text: '글자', select: '선택 목록', number: '숫자' }[f.type];
    var box = h('div', { class: 'fcard' + (f.active ? '' : ' hidden-item'), 'data-field': f.id },
      h('div', { class: 'fcard-head' }, name,
        h('span', { class: 'note' }, typeLabel + ' · 입력 ' + used + '건' + (f.required ? ' · 필수' : '') + (f.active ? '' : ' · 숨김')
          + (L.rulesOf(db.catalog).some(function (r) { return r.target === f.id; }) ? ' · 적용 조건 있음' : '')),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-sm', disabled: i === 0, 'aria-label': f.name + ' 위로', onclick: function () { tryDo(function () { L.moveField(db.catalog, f.id, -1); }); } }, '위로'),
          h('button', { type: 'button', class: 'btn btn-sm', disabled: i === n - 1, 'aria-label': f.name + ' 아래로', onclick: function () { tryDo(function () { L.moveField(db.catalog, f.id, 1); }); } }, '아래로'),
          h('button', { type: 'button', class: 'btn btn-sm', onclick: function () { tryDo(function () { f.active = !f.active; }); } }, f.active ? '숨기기' : '다시 쓰기'))));
    if (f.type !== 'select') return box;
    var ul = h('ul', { class: 'choice-list' });
    if (!f.choices.length) ul.appendChild(h('li', { class: 'note' }, '선택지가 없습니다. 아래에서 추가하세요.'));
    f.choices.forEach(function (c, k) {
      var cnt = L.choiceUsage(db.records, f.id, c.id);
      var inp = h('input', { type: 'text', value: c.label, 'aria-label': '선택지 이름' });
      inp.addEventListener('change', function () { if (!tryDo(function () { L.renameChoice(db.catalog, f.id, c.id, inp.value); })) inp.value = c.label; });
      ul.appendChild(h('li', { class: 'choice-row' + (c.active ? '' : ' hidden-item') },
        swatch(colorOf(f, c.id)), inp,
        h('span', { class: 'note' }, cnt + '건' + (c.active ? '' : ' · 숨김')),
        h('span', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-sm', disabled: k === 0, 'aria-label': c.label + ' 위로', onclick: function () { tryDo(function () { L.moveChoice(db.catalog, f.id, c.id, -1); }); } }, '위로'),
          h('button', { type: 'button', class: 'btn btn-sm', disabled: k === f.choices.length - 1, 'aria-label': c.label + ' 아래로', onclick: function () { tryDo(function () { L.moveChoice(db.catalog, f.id, c.id, 1); }); } }, '아래로'),
          h('button', { type: 'button', class: 'btn btn-sm', onclick: function () { tryDo(function () { c.active = !c.active; }); } }, c.active ? '숨기기' : '다시 쓰기'))));
    });
    box.appendChild(ul);
    var ni = h('input', { type: 'text', placeholder: '새 선택지 이름', 'aria-label': f.name + ' 새 선택지' });
    function addIt() { tryDo(function () { L.addChoice(db.catalog, f.id, ni.value); }); }
    ni.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addIt(); } });
    box.appendChild(h('div', { class: 'add-choice' }, ni, h('button', { type: 'button', class: 'btn', onclick: addIt }, '선택지 추가')));
    return box;
  }

  // ── Excel 가져오기 ────────────────────────────────────────
  function startImport(fileList) {
    var file = fileList[0];
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var isCsv = /\.csv$/i.test(file.name);
        var wb = isCsv ? XLSX.read(new TextDecoder('utf-8').decode(new Uint8Array(reader.result)).replace(/^﻿/, ''), { type: 'string' })
          : XLSX.read(new Uint8Array(reader.result), { type: 'array' });
        var sheets = wb.SheetNames.map(function (n) {
          var aoa = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: true });
          return { name: n, aoa: aoa, headerRow: L.guessHeaderRow(aoa) };
        }).filter(function (s) { return s.aoa.length; });
        if (!sheets.length) { toast('읽을 수 있는 시트가 없습니다', true); return; }
        imp = { fileName: file.name, sheets: sheets, sheet: 0, mode: 'append', decisions: {} };
        remapImport();
        location.hash = '#/import';
        render();
      } catch (e) { toast('파일을 읽지 못했습니다: ' + e.message, true); }
    };
    reader.readAsArrayBuffer(file);
  }
  function importTable() { var s = imp.sheets[imp.sheet]; return L.aoaToRows(s.aoa, s.headerRow); }
  function remapImport() { imp.mapping = L.autoMap(importTable().headers, db.catalog, db.mapping); imp.decisions = {}; }
  function renderImport(main) {
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, 'Excel 가져오기 — 열 맞추기'),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn', href: '#/records', onclick: function () { imp = null; } }, '취소'))));
    var t = importTable();

    var c1 = h('section', { class: 'card' }, h('h2', null, '1. 시트와 머리행'),
      h('p', { class: 'note' }, imp.fileName + ' — 머리행(열 이름이 적힌 줄)을 자동으로 찾았습니다. 다르면 줄 번호를 고치세요.'));
    var sh = select('sheet', imp.sheets.map(function (s, i) { return [i, s.name + ' (' + s.aoa.length + '줄)']; }), imp.sheet);
    sh.addEventListener('change', function () { imp.sheet = +sh.value; remapImport(); render(); });
    var s = imp.sheets[imp.sheet];
    var hr = h('input', { type: 'number', min: '1', max: String(s.aoa.length), value: String(s.headerRow + 1), name: 'header_row' });
    hr.addEventListener('change', function () { var n = parseInt(hr.value, 10); if (n >= 1 && n <= s.aoa.length) { s.headerRow = n - 1; remapImport(); } render(); });
    c1.appendChild(h('div', { class: 'filters' }, field('시트', sh), field('머리행 줄 번호', hr), h('p', { class: 'note' }, '데이터 ' + t.rows.length + '줄' + (t.skipped ? ' (빈 줄 ' + t.skipped + '개 건너뜀)' : ''))));
    main.appendChild(c1);

    // 2. 열 → 항목
    var c2 = h('section', { class: 'card' }, h('h2', null, '2. 열을 항목에 연결'),
      h('p', { class: 'note' }, '내 파일의 열마다 어느 항목인지 고릅니다. 카탈로그에 없는 옵션 열은 「새 옵션 항목으로 추가」를 고르면 열 이름으로 항목이 생기고 값이 선택지가 됩니다. 쓰지 않을 열은 「가져오지 않음」으로 둡니다.'));
    var used = {};
    Object.keys(imp.mapping).forEach(function (hd) { if (imp.mapping[hd] && imp.mapping[hd].indexOf('new:') !== 0) used[imp.mapping[hd]] = hd; });
    var grid = h('div', { class: 'map-grid' });
    t.headers.forEach(function (hd) {
      var opts = [['', '가져오지 않음']];
      [['base', '기본 정보'], ['option', '옵션']].forEach(function (g) {
        L.fieldsOf(db.catalog, g[0], true).forEach(function (f) {
          var taken = used[f.id] && used[f.id] !== hd;
          if (!taken) opts.push([f.id, g[1] + ' · ' + f.name + (f.active ? '' : ' (숨김)')]);
        });
      });
      opts.push([L.NEW_OPTION, '새 옵션 항목으로 추가'], [L.NEW_BASE, '새 기본 정보 항목으로 추가(선택 목록)']);
      var sel = select('map_' + hd, opts, imp.mapping[hd] || '');
      sel.addEventListener('change', function () { imp.mapping[hd] = sel.value; imp.decisions = {}; render(); });
      var ex = t.rows.slice(0, 3).map(function (r) { return String(r[hd]); }).filter(Boolean).join(', ');
      grid.appendChild(field(hd, sel, ex ? '예: ' + ex : '(값 없음)'));
    });
    c2.appendChild(grid);
    main.appendChild(c2);

    // 3. 카탈로그에 없는 값
    var plan = L.planImport(db.catalog, t.headers, t.rows, imp.mapping);
    var c3 = h('section', { class: 'card' }, h('h2', null, '3. 카탈로그에 없는 값'));
    var uk = Object.keys(plan.unknown);
    if (!uk.length) c3.appendChild(h('p', null, '모든 값이 카탈로그 선택지와 맞습니다. 대소문자·띄어쓰기만 다른 값은 자동으로 같은 선택지로 봅니다.'));
    else {
      c3.appendChild(h('p', { class: 'note' }, '값마다 「새 선택지로 추가」하거나, 같은 뜻의 기존 선택지에 연결하거나, 비워 둘 수 있습니다. 대소문자·띄어쓰기만 다른 값은 이미 자동으로 연결했습니다.'));
      uk.forEach(function (fid) {
        var f = L.getField(plan.catalog, fid);
        var isNew = plan.created.indexOf(fid) >= 0;
        var box = h('div', { class: 'unknown-block' }, h('h3', null, f.name + (isNew ? ' (새 항목)' : '')));
        plan.unknown[fid].forEach(function (u) {
          var cur = (imp.decisions[fid] || {})[u.key] || L.NEW_CHOICE;
          var opts = [[L.NEW_CHOICE, '새 선택지로 추가'], [L.SKIP_VALUE, '비워 둠(미입력)']];
          f.choices.forEach(function (c) { opts.push([c.id, '→ ' + c.label]); });
          var sel = select('dec_' + fid + '_' + u.key, opts, cur, { 'aria-label': f.name + ' 값 ' + u.raw + ' 처리' });
          sel.addEventListener('change', function () { (imp.decisions[fid] = imp.decisions[fid] || {})[u.key] = sel.value; });
          box.appendChild(h('div', { class: 'dict-row' }, h('div', { class: 'spell' }, h('strong', null, u.raw), ' ', h('span', { class: 'note' }, u.count + '건')), sel, h('span')));
        });
        c3.appendChild(box);
      });
    }
    main.appendChild(c3);

    // 4. 확정
    var mappedCount = Object.keys(plan.mapping).length;
    var c4 = h('section', { class: 'card' }, h('h2', null, '4. 불러오기'));
    if (!mappedCount) c4.appendChild(h('div', { class: 'alert error' }, '연결된 열이 없습니다. 2번에서 열을 항목에 연결하세요.'));
    else if (!Object.keys(plan.mapping).some(function (hd) { return plan.mapping[hd] === 'f_customer'; }) && F('f_customer') && F('f_customer').required)
      c4.appendChild(h('div', { class: 'alert warn' }, '「고객사」 열이 연결되지 않았습니다. 불러온 뒤 레코드마다 고객사를 적어야 합니다.'));
    var mode = select('mode', [['append', '지금 내역 뒤에 추가'], ['replace', '지금 내역을 지우고 바꾸기']], imp.mode);
    mode.addEventListener('change', function () { imp.mode = mode.value; });
    c4.appendChild(h('div', { class: 'form-grid' }, field('불러오는 방식', mode,
      db.records.length ? '지금 ' + db.records.length + '건' + (db._sample ? '(예시 데이터 — 불러오면 예시 데이터와 예시 선택지는 지워집니다)' : '') + '이 있습니다' : null)));
    c4.appendChild(h('div', { class: 'btn-row', style: 'margin-top:16px' },
      h('button', { type: 'button', class: 'btn btn-primary', disabled: !mappedCount || !t.rows.length, onclick: function () {
        var wasSample = db._sample;
        var p = L.planImport(wasSample ? L.defaultCatalog() : db.catalog, t.headers, t.rows, imp.mapping);
        var res = L.applyImport(p, imp.decisions);
        db.catalog = res.catalog;
        db.mapping = Object.assign({}, db.mapping || {}, p.mapping);
        addRecords(res.records, imp.mode === 'replace' || wasSample);
        delete db._sample;
        save();
        imp = null;
        location.hash = '#/records';
        var nb = L.ruleViolations(db.catalog, db.records).length;
        toast(res.records.length + '건을 불러왔습니다' + (res.addedFields ? ' · 새 항목 ' + res.addedFields + '개' : '') + (res.addedChoices ? ' · 새 선택지 ' + res.addedChoices + '개' : '') + (res.badNumbers ? ' · 숫자로 못 읽은 값 ' + res.badNumbers + '개는 비워 둠' : '') + (nb ? ' · 적용 조건에 맞지 않는 값 ' + nb + '개(목록에서 확인)' : ''));
      } }, t.rows.length + '건 불러오기')));
    main.appendChild(c4);
  }

  // ── 사용 빈도 ─────────────────────────────────────────────
  function analysisFilterCard(list) {
    var card = h('section', { class: 'card' }, h('h2', null, '대상 거르기'));
    card.appendChild(filterControls(anal, render));
    var n = Object.keys(anal.filters).length;
    card.appendChild(h('div', { class: 'list-meta' }, h('span', null, '대상 ' + list.length + '건' + (n ? ' (전체 ' + db.records.length + '건 중)' : '')),
      n ? h('button', { type: 'button', class: 'btn', onclick: function () { anal.filters = {}; render(); } }, '거르기 풀기') : null));
    return card;
  }
  function renderStats(main) {
    if (!db.records.length) { emptyNotice(main, '옵션 사용 빈도'); return; }
    var list = L.filterRecords(db.catalog, db.records, '', anal.filters);
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, '옵션 사용 빈도'),
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn', onclick: function () {
        var aoa = [['옵션 항목', '선택지', '건수', '비율(%)']];
        L.fieldsOf(db.catalog, 'option').forEach(function (f) {
          var st = L.choiceStats(db.catalog, list, f.id);
          st.items.forEach(function (it) { aoa.push([f.name, it.label, it.count, it.pct]); });
          if (st.empty.count) aoa.push([f.name, L.EMPTY_LABEL, st.empty.count, st.empty.pct]);
          if (st.na.count) aoa.push([f.name, L.NA_LABEL, st.na.count, st.na.pct]);
        });
        writeXlsx('옵션사용빈도' + tag() + '_' + today() + '.xlsx', { '사용 빈도': aoa, '거르기 조건': filterSheet() });
      } }, 'Excel 내보내기'))));
    main.appendChild(analysisFilterCard(list));
    var grid = h('div', { class: 'stat-grid' });
    L.fieldsOf(db.catalog, 'option').forEach(function (f) {
      var st = L.choiceStats(db.catalog, list, f.id);
      var card = h('section', { class: 'card stat-card', 'data-option': f.id }, h('h2', null, f.name));
      if (!st.items.length && !st.empty.count && !st.na.count) { card.appendChild(h('p', { class: 'note' }, '대상 레코드가 없습니다.')); grid.appendChild(card); return; }
      var bars = h('div', { class: 'bars', role: 'img', 'aria-label': f.name + ' 선택지별 사용 비율 막대' });
      var rows = st.items.map(function (it) { return { id: it.id, label: it.label + (it.active ? '' : ' (숨김)'), count: it.count, pct: it.pct }; });
      if (st.empty.count) rows.push({ id: '', label: L.EMPTY_LABEL, count: st.empty.count, pct: st.empty.pct });
      if (st.na.count) rows.push({ id: L.NA_ID, label: L.NA_LABEL, count: st.na.count, pct: st.na.pct });
      rows.forEach(function (r) {
        var tip = r.label + ': ' + r.count + '건 (' + fmt(r.pct) + '%)';
        bars.appendChild(h('div', { class: 'bar-row', title: tip },
          h('span', { class: 'name' }, r.label),
          h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: 'width:' + r.pct + '%;background:' + colorOf(f, r.id) })),
          h('span', { class: 'num' }, r.count + '건 · ' + fmt(r.pct) + '%')));
      });
      card.appendChild(bars);
      if (!st.items.some(function (x) { return x.count; })) card.appendChild(h('p', { class: 'note' }, '이 항목은 아직 입력된 선택지가 없습니다.'));
      grid.appendChild(card);
    });
    main.appendChild(grid);
    main.appendChild(h('p', { class: 'note' }, '비율의 분모는 대상 레코드 전체(미입력·해당 없음 포함)입니다. 「(해당 없음)」은 적용 조건상 그 옵션을 쓰지 않는 레코드입니다(예: 발전기의 Parking Brake). 막대에 마우스를 올리면 건수와 비율이 보입니다.'));
  }
  function filterSheet() {
    var aoa = [['항목', '조건']];
    Object.keys(anal.filters).forEach(function (k) {
      var f = F(k); if (!f) return;
      var v = anal.filters[k];
      aoa.push([f.name, f.type === 'select' && v !== L.EMPTY_LABEL ? L.displayValue(f, v) : v]);
    });
    if (aoa.length === 1) aoa.push(['(없음)', '전체 레코드']);
    return aoa;
  }

  // ── 기준별 비교 ──────────────────────────────────────────
  function renderPivot(main) {
    if (!db.records.length) { emptyNotice(main, '기준별 비교'); return; }
    var axes = L.fieldsOf(db.catalog, 'base').filter(function (f) { return f.type !== 'number'; });
    var opts = L.fieldsOf(db.catalog, 'option');
    if (!axes.length || !opts.length) { main.appendChild(h('p', null, '기준(기본 정보)과 옵션 항목이 하나 이상 있어야 합니다.')); return; }
    if (!F(anal.axis) || axes.indexOf(F(anal.axis)) < 0) anal.axis = axes[0].id;
    if (!F(anal.option) || opts.indexOf(F(anal.option)) < 0) anal.option = opts[0].id;
    var list = L.filterRecords(db.catalog, db.records, '', anal.filters);
    var axis = F(anal.axis), opt = F(anal.option);
    var p = L.pivot(db.catalog, list, axis.id, opt.id);
    var optIds = opts.map(function (f) { return f.id; });
    var tops = L.topByAxis(db.catalog, list, axis.id, optIds);

    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, '기준별 비교'),
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn', onclick: function () {
        var sheets = {};
        sheets[axis.name + '별 최다 옵션'] = L.topSheet(db.catalog, tops, axis.name, optIds);
        opts.forEach(function (o) { sheets[(axis.name + ' x ' + o.name)] = L.pivotSheet(L.pivot(db.catalog, list, axis.id, o.id), axis.name, o.name); });
        sheets['거르기 조건'] = filterSheet();
        writeXlsx(axis.name + '별_옵션비교' + tag() + '_' + today() + '.xlsx', sheets);
      } }, 'Excel 내보내기(모든 옵션)'))));

    var ctl = h('section', { class: 'card' }, h('h2', null, '비교 기준'));
    ctl.appendChild(h('div', { class: 'axis-tabs', role: 'group', 'aria-label': '비교 기준' }, axes.map(function (f) {
      return h('button', { type: 'button', 'aria-pressed': f.id === axis.id ? 'true' : 'false', onclick: function () { anal.axis = f.id; render(); } }, f.name + '별');
    })));
    ctl.appendChild(h('h3', { class: 'form-sec' }, '대상 거르기'));
    ctl.appendChild(filterControls(anal, render));
    ctl.appendChild(h('div', { class: 'list-meta' }, h('span', null, '대상 ' + list.length + '건'),
      Object.keys(anal.filters).length ? h('button', { type: 'button', class: 'btn', onclick: function () { anal.filters = {}; render(); } }, '거르기 풀기') : null));
    main.appendChild(ctl);

    // 한눈에: 기준값별 최다 선택지
    var c1 = h('section', { class: 'card' }, h('h2', null, axis.name + '별로 가장 많이 쓰는 선택지'),
      h('p', { class: 'note' }, '칸마다 그 ' + axis.name + '에서 가장 많이 고른 선택지와 비율입니다. 미입력·해당 없음은 빼고 셉니다. 건수가 같으면 함께 적습니다.'));
    var tb = h('tbody');
    tops.forEach(function (r) {
      tb.appendChild(h('tr', null, h('th', { scope: 'row' }, r.label), h('td', { class: 'num' }, r.total),
        optIds.map(function (id) { var t = r.tops[id]; return h('td', null, t ? [h('strong', null, t.label), ' ', h('span', { class: 'note' }, fmt(t.pct) + '%')] : h('span', { class: 'muted' }, '—')); })));
    });
    c1.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list top-table' },
      h('thead', null, h('tr', null, h('th', null, axis.name), h('th', { class: 'num' }, '건수'), opts.map(function (f) { return h('th', null, f.name); }))), tb)));
    main.appendChild(c1);

    // 옵션 하나 자세히: 100% 누적 막대 + 피벗 표
    var c2 = h('section', { class: 'card', 'data-pivot': opt.id }, h('h2', null, axis.name + ' × ' + opt.name));
    c2.appendChild(h('div', { class: 'axis-tabs', role: 'group', 'aria-label': '옵션 항목' }, opts.map(function (f) {
      return h('button', { type: 'button', 'aria-pressed': f.id === opt.id ? 'true' : 'false', onclick: function () { anal.option = f.id; render(); } }, f.name);
    })));
    c2.appendChild(h('div', { class: 'legend' }, p.cols.map(function (c) { return h('span', null, swatch(colorOf(opt, c.id)), c.label); })));
    var chart = h('div', { class: 'stacks', role: 'img', 'aria-label': axis.name + '별 ' + opt.name + ' 선택지 비율 누적 막대' });
    p.rows.concat(p.rows.length > 1 ? [p.total] : []).forEach(function (r) {
      var bar = h('div', { class: 'stack' });
      r.cells.forEach(function (c, i) {
        if (!c.count) return;
        var col = p.cols[i];
        var tip = r.label + ' · ' + col.label + ': ' + c.count + '건 (' + fmt(c.pct) + '%)';
        bar.appendChild(h('span', { class: 'seg', title: tip, style: 'width:' + c.pct + '%;background:' + colorOf(opt, col.id) },
          c.pct >= 12 ? h('span', { class: 'seg-label' }, Math.round(c.pct) + '%') : null));
      });
      chart.appendChild(h('div', { class: 'stack-row' + (r.key === '*' ? ' total' : '') },
        h('span', { class: 'name' }, r.label, h('small', null, ' ' + r.total + '건')), bar));
    });
    c2.appendChild(chart);
    var ptb = h('tbody');
    p.rows.concat([p.total]).forEach(function (r) {
      ptb.appendChild(h('tr', { class: r.key === '*' ? 'total' : '' }, h('th', { scope: 'row' }, r.label), h('td', { class: 'num' }, r.total),
        r.cells.map(function (c) { return h('td', { class: 'num' }, c.count ? c.count + ' (' + fmt(c.pct) + '%)' : h('span', { class: 'muted' }, '0')); }),
        h('td', null, r.top ? r.top.label : '—')));
    });
    c2.appendChild(h('div', { class: 'table-wrap', style: 'margin-top:16px' }, h('table', { class: 'list pivot-table' },
      h('thead', null, h('tr', null, h('th', null, axis.name), h('th', { class: 'num' }, '건수'),
        p.cols.map(function (c) { return h('th', { class: 'num' }, c.label); }), h('th', null, '최다'))), ptb)));
    c2.appendChild(h('p', { class: 'note' }, '비율은 행(' + axis.name + ') 안에서의 비율입니다. 막대에 마우스를 올리면 건수가 보입니다.'));
    main.appendChild(c2);
  }

  // ── 백업·복원 ─────────────────────────────────────────────
  function renderData(main) {
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, '백업·복원')));
    var fields = db.catalog.fields.length, opts = L.fieldsOf(db.catalog, 'option', true).length;
    main.appendChild(h('section', { class: 'card' },
      h('p', null, '데이터는 이 브라우저 저장소에만 있습니다. 브라우저 데이터를 지우거나 다른 PC로 옮기면 사라지므로, 작업을 마칠 때 백업 파일을 저장해 두세요.'),
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('div', { class: 'k' }, '옵션 내역'), h('div', { class: 'v' }, fmt(db.records.length), h('small', null, '건'))),
        h('div', { class: 'kpi' }, h('div', { class: 'k' }, '항목(옵션)'), h('div', { class: 'v' }, fields, h('small', null, '개 (' + opts + ')'))),
        h('div', { class: 'kpi' }, h('div', { class: 'k' }, '저장 상태'), h('div', { class: 'v v-sm' }, S.available() ? '브라우저 저장' : '메모리(닫으면 사라짐)'))),
      h('h2', null, '백업 파일(JSON)'),
      h('p', { class: 'note' }, '카탈로그(항목·선택지·숨김 상태)와 옵션 내역을 그대로 담습니다. 복원하면 지금 데이터를 모두 바꿉니다.'),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          download('인터페이스옵션_백업' + tag() + '_' + today() + '.json', new Blob([JSON.stringify(L.makeBackup(db), null, 1)], { type: 'application/json' }));
        } }, '백업 파일 저장'),
        (function () {
          var inp = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': '백업 파일 고르기', onchange: function () {
            var file = inp.files[0]; inp.value = '';
            if (!file) return;
            file.text().then(function (text) {
              var nd;
              try { nd = L.parseBackup(text); } catch (e) { toast('이 도구의 백업 파일이 아닙니다', true); return; }
              confirmDialog('백업에서 복원', '지금 데이터(' + db.records.length + '건)를 백업 파일의 ' + nd.records.length + '건과 카탈로그로 바꿉니다.', '복원', function () {
                db = nd; save(); view = { q: '', filters: {}, page: 0, onlyBad: false }; anal.filters = {}; render(); toast(nd.records.length + '건을 복원했습니다');
              });
            });
          } });
          return h('label', { class: 'btn file-btn' }, '백업에서 복원', inp);
        })()),
      h('h2', { style: 'margin-top:24px' }, 'Excel'),
      h('p', { class: 'note' }, 'Excel 내보내기에는 옵션 내역·카탈로그·적용 조건·고객사/Emission regulation/Machine type별 최다 옵션 시트가 들어갑니다. 내보낸 파일은 「Excel 가져오기」로 다시 불러올 수 있습니다(숨김 상태는 백업 파일로만 옮겨집니다).'),
      h('div', { class: 'btn-row' }, db.records.length ? h('button', { type: 'button', class: 'btn', onclick: exportAll }, 'Excel 내보내기') : null, importButton()),
      h('h2', { style: 'margin-top:24px' }, '처음으로'),
      h('div', { class: 'btn-row' }, sampleButton(false),
        h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
          confirmDialog('모두 지우기', '옵션 내역과 카탈로그를 모두 지우고 처음 카탈로그(2026-09-29 구체화 항목과 적용 조건)로 돌아갑니다. 되돌릴 수 없습니다.', '모두 지우기', function () {
            db = L.emptyDb(); S.clearDb(); save(); view = { q: '', filters: {}, page: 0, onlyBad: false }; anal.filters = {}; render(); toast('모두 지웠습니다');
          });
        } }, '모두 지우기'))));
  }
  render();
})();
