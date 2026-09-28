/*
 * 엔진 인터페이스 옵션 통합 관리·분석 도구 — 순수 로직 모듈 (화면·저장소와 무관)
 * 브라우저에서는 window.OPLogic, Node(테스트)에서는 module.exports 로 씁니다.
 * ES module 이 아닌 이유: index.html 을 로컬 파일(file://)로 열었을 때
 * 브라우저가 module 스크립트를 막기 때문입니다.
 *
 * 데이터 구조
 *   catalog.fields[] = { id, name, kind: 'base'|'option', type: 'text'|'select'|'number',
 *                        required, active, choices: [{ id, label, active }] }
 *   records[]        = { id, v: { 필드id: 값 } }  — select 는 선택지 id, text 는 글자, number 는 숫자
 *   선택지를 id 로 저장하므로 선택지 이름을 고치면 기존 레코드에도 그대로 반영됩니다.
 */
(function (root) {
  'use strict';

  var NEW_CHOICE = '__new__';   // 가져오기: 새 선택지로 추가
  var SKIP_VALUE = '__skip__';  // 가져오기: 값을 비워 둠(미입력)
  var NEW_OPTION = 'new:option'; // 열 매핑: 이 열을 새 옵션 항목으로 추가
  var NEW_BASE = 'new:base';     // 열 매핑: 이 열을 새 기본 정보 항목으로 추가
  var EMPTY_LABEL = '(미입력)';

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function str(v) { return v == null ? '' : String(v).trim(); }
  // 비교용 정규화 — 대소문자·공백·밑줄·하이픈·점 차이는 같은 것으로 봅니다
  function norm(s) { return str(s).toLowerCase().replace(/[\s_\-.·/]+/g, ''); }

  function newId(prefix, taken) {
    var n = 1;
    while (taken[prefix + n]) n++;
    return prefix + n;
  }
  function takenIds(catalog) {
    var t = {};
    catalog.fields.forEach(function (f) { t[f.id] = true; f.choices.forEach(function (c) { t[c.id] = true; }); });
    return t;
  }

  // ── 초기 카탈로그 ───────────────────────────────────────────
  // 항목 이름은 제출 원문 그대로입니다. 선택지는 원문에 나온 것(check engine lamp: CAN type / HW type,
  // 장비 유형: 굴삭기·지게차·발전기, 지역: 한국·유럽·미국)만 넣었고, 나머지는 담당자가 채웁니다.
  function defaultCatalog() {
    function ch(prefix, labels) { return labels.map(function (l, i) { return { id: prefix + (i + 1), label: l, active: true }; }); }
    return {
      fields: [
        { id: 'f_customer', name: '고객사', kind: 'base', type: 'text', required: true, active: true, choices: [] },
        { id: 'f_suffix', name: 'engine suffix', kind: 'base', type: 'text', required: false, active: true, choices: [] },
        { id: 'f_equip', name: '장비 유형', kind: 'base', type: 'select', required: false, active: true, choices: ch('c_equip', ['굴삭기', '지게차', '발전기']) },
        { id: 'f_region', name: '지역', kind: 'base', type: 'select', required: false, active: true, choices: ch('c_region', ['한국', '유럽', '미국']) },
        { id: 'f_power', name: '출력', kind: 'base', type: 'number', required: false, active: true, choices: [] },
        { id: 'f_ats', name: 'ATS type', kind: 'option', type: 'select', required: false, active: true, choices: [] },
        { id: 'f_cansa', name: 'CAN SA', kind: 'option', type: 'select', required: false, active: true, choices: [] },
        { id: 'f_pedal', name: 'Pedal type', kind: 'option', type: 'select', required: false, active: true, choices: [] },
        { id: 'f_starter', name: 'starter control type', kind: 'option', type: 'select', required: false, active: true, choices: [] },
        { id: 'f_cel', name: 'check engine lamp', kind: 'option', type: 'select', required: false, active: true, choices: ch('c_cel', ['CAN type', 'HW type']) }
      ]
    };
  }
  function emptyDb() { return { catalog: defaultCatalog(), records: [], seq: 0 }; }

  // ── 카탈로그 조회·편집 ─────────────────────────────────────
  function getField(catalog, id) {
    for (var i = 0; i < catalog.fields.length; i++) if (catalog.fields[i].id === id) return catalog.fields[i];
    return null;
  }
  function fieldsOf(catalog, kind, includeHidden) {
    return catalog.fields.filter(function (f) { return (!kind || f.kind === kind) && (includeHidden || f.active); });
  }
  function getChoice(field, id) {
    for (var i = 0; i < field.choices.length; i++) if (field.choices[i].id === id) return field.choices[i];
    return null;
  }
  function findChoiceByLabel(field, raw) {
    var k = norm(raw);
    if (!k) return null;
    for (var i = 0; i < field.choices.length; i++) if (norm(field.choices[i].label) === k) return field.choices[i];
    return null;
  }
  function addField(catalog, spec) {
    var name = str(spec.name);
    if (!name) throw new Error('name_required');
    if (catalog.fields.some(function (f) { return norm(f.name) === norm(name); })) throw new Error('name_duplicate');
    var kind = spec.kind === 'base' ? 'base' : 'option';
    var type = kind === 'option' ? 'select' : (['text', 'select', 'number'].indexOf(spec.type) >= 0 ? spec.type : 'text');
    var f = { id: newId('f', takenIds(catalog)), name: name, kind: kind, type: type, required: false, active: true, choices: [] };
    catalog.fields.push(f);
    return f;
  }
  function renameField(catalog, id, name) {
    name = str(name);
    if (!name) throw new Error('name_required');
    if (catalog.fields.some(function (f) { return f.id !== id && norm(f.name) === norm(name); })) throw new Error('name_duplicate');
    getField(catalog, id).name = name;
  }
  // 같은 종류(기본 정보/옵션) 안에서 한 칸 위(-1)·아래(+1)로
  function moveField(catalog, id, dir) {
    var f = getField(catalog, id);
    var same = catalog.fields.filter(function (x) { return x.kind === f.kind; });
    var i = same.indexOf(f), j = i + dir;
    if (j < 0 || j >= same.length) return false;
    var a = catalog.fields.indexOf(f), b = catalog.fields.indexOf(same[j]);
    catalog.fields[a] = same[j]; catalog.fields[b] = f;
    return true;
  }
  function addChoice(catalog, fieldId, label) {
    var f = getField(catalog, fieldId);
    label = str(label);
    if (!label) throw new Error('label_required');
    if (findChoiceByLabel(f, label)) throw new Error('label_duplicate');
    var c = { id: newId('c', takenIds(catalog)), label: label, active: true };
    f.choices.push(c);
    return c;
  }
  function renameChoice(catalog, fieldId, choiceId, label) {
    var f = getField(catalog, fieldId);
    label = str(label);
    if (!label) throw new Error('label_required');
    var dup = findChoiceByLabel(f, label);
    if (dup && dup.id !== choiceId) throw new Error('label_duplicate');
    getChoice(f, choiceId).label = label;
  }
  function moveChoice(catalog, fieldId, choiceId, dir) {
    var list = getField(catalog, fieldId).choices;
    var i = -1;
    list.forEach(function (c, k) { if (c.id === choiceId) i = k; });
    var j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return false;
    var t = list[i]; list[i] = list[j]; list[j] = t;
    return true;
  }
  // 몇 건의 레코드가 이 선택지를 쓰는지 — 숨김 전에 보여 줍니다
  function choiceUsage(records, fieldId, choiceId) {
    return records.filter(function (r) { return r.v && r.v[fieldId] === choiceId; }).length;
  }

  // ── 값 ──────────────────────────────────────────────────────
  // "75", "75 kW", "1,200" → 숫자. 읽을 수 없으면 NaN, 빈 값이면 null
  function parseNumber(raw) {
    if (typeof raw === 'number') return isFinite(raw) ? raw : NaN;
    var s = str(raw).replace(/,/g, '');
    if (!s) return null;
    var m = s.match(/^[-+]?\d+(\.\d+)?/);
    if (!m) return NaN;
    var rest = s.slice(m[0].length).trim();
    if (rest && !/^[a-zA-Z%]+$/.test(rest)) return NaN;
    return parseFloat(m[0]);
  }
  function displayValue(field, value) {
    if (value == null || value === '') return '';
    if (field.type === 'select') { var c = getChoice(field, value); return c ? c.label : ''; }
    if (field.type === 'number') return typeof value === 'number' ? String(value) : str(value);
    return str(value);
  }
  function validateRecord(catalog, v) {
    var errors = [];
    catalog.fields.forEach(function (f) {
      if (!f.active) return;
      var x = v[f.id];
      var empty = x == null || str(x) === '';
      if (f.required && empty) errors.push({ fieldId: f.id, code: 'required' });
      if (!empty && f.type === 'number' && typeof x !== 'number' && isNaN(parseNumber(x))) errors.push({ fieldId: f.id, code: 'not_number' });
      if (!empty && f.type === 'select' && !getChoice(f, x)) errors.push({ fieldId: f.id, code: 'unknown_choice' });
    });
    return errors;
  }
  // 입력 양식 값(글자) → 저장 값
  function cleanRecord(catalog, v) {
    var out = {};
    catalog.fields.forEach(function (f) {
      var x = v[f.id];
      if (x == null || str(x) === '') return;
      if (f.type === 'number') { var n = parseNumber(x); if (typeof n === 'number' && !isNaN(n)) out[f.id] = n; }
      else if (f.type === 'select') out[f.id] = x;
      else out[f.id] = str(x);
    });
    return out;
  }

  // ── 거르기 ──────────────────────────────────────────────────
  // filters: { 필드id: 값 } — select 는 선택지 id, text 는 정확히 같은 값(정규화 비교). '' 는 조건 없음
  // q: 모든 항목의 표시값에서 찾는 글자
  function filterRecords(catalog, records, q, filters) {
    var qq = str(q).toLowerCase();
    var fk = Object.keys(filters || {}).filter(function (k) { return filters[k] !== '' && filters[k] != null; });
    return records.filter(function (r) {
      for (var i = 0; i < fk.length; i++) {
        var f = getField(catalog, fk[i]);
        if (!f) continue;
        var want = filters[fk[i]], have = r.v[fk[i]];
        if (want === EMPTY_LABEL) { if (have != null && have !== '') return false; continue; }
        if (f.type === 'select') { if (have !== want) return false; }
        else if (norm(have) !== norm(want)) return false;
      }
      if (!qq) return true;
      return catalog.fields.some(function (f) { return displayValue(f, r.v[f.id]).toLowerCase().indexOf(qq) >= 0; });
    });
  }
  // text 항목의 값 목록(거르기·기준 선택용) — 정규화로 묶고 처음 나온 표기로 보여 줍니다
  function distinctValues(records, fieldId) {
    var map = {}, order = [];
    records.forEach(function (r) {
      var s = str(r.v[fieldId]);
      if (!s) return;
      var k = norm(s);
      if (!map[k]) { map[k] = { value: s, count: 0 }; order.push(k); }
      map[k].count++;
    });
    return order.map(function (k) { return map[k]; }).sort(function (a, b) { return a.value < b.value ? -1 : a.value > b.value ? 1 : 0; });
  }

  // ── 분석 ────────────────────────────────────────────────────
  function pct(n, d) { return d ? Math.round(n / d * 1000) / 10 : 0; }

  // 옵션 항목 하나의 선택지별 건수·비율. 비율의 분모는 전체 레코드 수(미입력 포함)
  function choiceStats(catalog, records, fieldId) {
    var f = getField(catalog, fieldId);
    var counts = {}, empty = 0;
    records.forEach(function (r) {
      var x = r.v[fieldId];
      if (x == null || x === '' || !getChoice(f, x)) empty++;
      else counts[x] = (counts[x] || 0) + 1;
    });
    var total = records.length;
    var items = f.choices.map(function (c, i) { return { id: c.id, label: c.label, active: c.active, count: counts[c.id] || 0, order: i }; })
      .filter(function (c) { return c.active || c.count; });
    items.sort(function (a, b) { return b.count - a.count || a.order - b.order; });
    items.forEach(function (c) { c.pct = pct(c.count, total); delete c.order; });
    return { total: total, items: items, empty: { count: empty, pct: pct(empty, total) } };
  }

  // 기준(고객사·지역·장비 유형 등 기본 정보 항목) 값으로 레코드를 묶습니다
  function groupBy(catalog, records, axisId) {
    var f = getField(catalog, axisId);
    var groups = {}, order = [];
    records.forEach(function (r) {
      var x = r.v[axisId], key, label;
      if (f.type === 'select') { var c = getChoice(f, x); key = c ? c.id : ''; label = c ? c.label : EMPTY_LABEL; }
      else { var s = f.type === 'number' ? displayValue(f, x) : str(x); key = norm(s); label = s || EMPTY_LABEL; }
      if (!groups[key]) { groups[key] = { key: key, label: label, records: [] }; order.push(key); }
      groups[key].records.push(r);
    });
    var list = order.map(function (k) { return groups[k]; });
    // 건수 많은 순, 같으면 이름순, 미입력은 맨 뒤
    list.sort(function (a, b) {
      if (!a.key !== !b.key) return a.key ? -1 : 1;
      return b.records.length - a.records.length || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
    });
    return list;
  }

  // 기준 × 옵션 선택지 피벗. 칸 = 건수와 그 기준값 안에서의 비율
  function pivot(catalog, records, axisId, optionId) {
    var opt = getField(catalog, optionId);
    var used = {}, anyEmpty = false;
    records.forEach(function (r) { var x = r.v[optionId]; if (x && getChoice(opt, x)) used[x] = true; else anyEmpty = true; });
    var cols = opt.choices.filter(function (c) { return c.active || used[c.id]; }).map(function (c) { return { id: c.id, label: c.label }; });
    if (anyEmpty) cols.push({ id: '', label: EMPTY_LABEL });
    function row(key, label, recs) {
      var cnt = {};
      recs.forEach(function (r) { var x = r.v[optionId]; var k = x && getChoice(opt, x) ? x : ''; cnt[k] = (cnt[k] || 0) + 1; });
      var cells = cols.map(function (c) { var n = cnt[c.id] || 0; return { count: n, pct: pct(n, recs.length) }; });
      return { key: key, label: label, total: recs.length, cells: cells, top: topOf(cols, cells) };
    }
    var rows = groupBy(catalog, records, axisId).map(function (g) { return row(g.key, g.label, g.records); });
    return { cols: cols, rows: rows, total: row('*', '전체', records) };
  }
  // 가장 많이 쓴 선택지(미입력 제외). 같은 건수면 ' / ' 로 함께 표시
  function topOf(cols, cells) {
    var best = 0;
    cells.forEach(function (c, i) { if (cols[i].id && c.count > best) best = c.count; });
    if (!best) return null;
    var labels = [], p = 0;
    cells.forEach(function (c, i) { if (cols[i].id && c.count === best) { labels.push(cols[i].label); p = c.pct; } });
    return { label: labels.join(' / '), count: best, pct: p };
  }
  // 기준값별로 옵션 항목마다 가장 많이 쓴 선택지 — 「많이 사용하는 옵션」 한눈에 보기
  function topByAxis(catalog, records, axisId, optionIds) {
    return groupBy(catalog, records, axisId).map(function (g) {
      var tops = {};
      optionIds.forEach(function (oid) {
        var p = pivot(catalog, g.records, axisId, oid);
        tops[oid] = p.total.top;
      });
      return { key: g.key, label: g.label, total: g.records.length, tops: tops };
    });
  }

  // ── 엑셀 가져오기 ──────────────────────────────────────────
  // 흔한 영문·약칭 열 이름 (가정 — 실제 파일을 받으면 보정)
  var ALIASES = {
    f_customer: ['고객사', '고객', 'customer', 'client', '고객사명'],
    f_suffix: ['engine suffix', 'suffix', '엔진 suffix', '엔진서픽스'],
    f_equip: ['장비 유형', '장비유형', '장비', '장비 타입', 'equipment', 'equipment type', 'machine type', 'application'],
    f_region: ['지역', 'region', 'area', 'market'],
    f_power: ['출력', 'power', 'rated power', 'output', 'kw']
  };
  // 머리행(열 이름) → 필드 id. 이미 쓴 연결(saved)이 있으면 먼저 씁니다
  function autoMap(headers, catalog, saved) {
    var out = {}, used = {};
    headers.forEach(function (h) {
      var k = norm(h);
      var pick = '';
      if (saved && saved[h] && getField(catalog, saved[h]) && !used[saved[h]]) pick = saved[h];
      if (!pick) catalog.fields.forEach(function (f) {
        if (pick || used[f.id]) return;
        var names = [f.name].concat(ALIASES[f.id] || []);
        if (names.some(function (n) { return norm(n) === k; })) pick = f.id;
      });
      if (pick) used[pick] = true;
      out[h] = pick;
    });
    return out;
  }
  // 첫 머리행 찾기: 위에서 20줄 안에서 글자 칸이 가장 많은 줄
  function guessHeaderRow(aoa) {
    var best = 0, bestN = -1;
    for (var i = 0; i < Math.min(20, aoa.length); i++) {
      var n = (aoa[i] || []).filter(function (c) { return typeof c === 'string' && c.trim(); }).length;
      if (n > bestN) { bestN = n; best = i; }
    }
    return best;
  }
  // 표(2차원 배열) + 머리행 번호 → 머리 목록과 행 객체
  function aoaToRows(aoa, headerRow) {
    var head = (aoa[headerRow] || []).map(function (c, i) { return str(c) || ('열' + (i + 1)); });
    var seen = {};
    head = head.map(function (h) { if (seen[h]) { seen[h]++; return h + ' (' + seen[h] + ')'; } seen[h] = 1; return h; });
    var rows = [], skipped = 0;
    aoa.slice(headerRow + 1).forEach(function (line) {
      line = line || [];
      if (!line.some(function (c) { return str(c) !== ''; })) { skipped++; return; }
      var o = {};
      head.forEach(function (h, i) { o[h] = line[i] == null ? '' : line[i]; });
      rows.push(o);
    });
    return { headers: head, rows: rows, skipped: skipped };
  }
  // 가져오기 계획: 새 항목 만들기 → 선택형 항목에서 카탈로그에 없는 값 모으기
  // mapping: { 머리: 필드id | 'new:option' | 'new:base' | '' }
  function planImport(catalog, headers, rows, mapping) {
    var cat = clone(catalog);
    var resolved = {}, created = [];
    headers.forEach(function (h) {
      var m = mapping[h];
      if (!m) return;
      if (m === NEW_OPTION || m === NEW_BASE) {
        var exist = null;
        cat.fields.forEach(function (f) { if (norm(f.name) === norm(h)) exist = f; });
        var f = exist || addField(cat, { name: h, kind: m === NEW_OPTION ? 'option' : 'base', type: 'select' });
        if (!exist) created.push(f.id);
        resolved[h] = f.id;
      } else if (getField(cat, m)) resolved[h] = m;
    });
    var unknown = {};
    Object.keys(resolved).forEach(function (h) {
      var f = getField(cat, resolved[h]);
      if (f.type !== 'select') return;
      var seen = {};
      rows.forEach(function (r) {
        var raw = str(r[h]);
        if (!raw || findChoiceByLabel(f, raw)) return;
        var k = norm(raw);
        if (!seen[k]) { seen[k] = { raw: raw, key: k, count: 0 }; (unknown[f.id] = unknown[f.id] || []).push(seen[k]); }
        seen[k].count++;
      });
    });
    return { catalog: cat, mapping: resolved, unknown: unknown, created: created, headers: headers, rows: rows };
  }
  // decisions: { 필드id: { 정규화값: 선택지id | '__new__' | '__skip__' } } — 없으면 '__new__'
  function applyImport(plan, decisions) {
    var cat = clone(plan.catalog);
    decisions = decisions || {};
    var addedChoices = 0, badNumbers = 0, records = [];
    var hs = Object.keys(plan.mapping);
    plan.rows.forEach(function (r) {
      var v = {};
      hs.forEach(function (h) {
        var f = getField(cat, plan.mapping[h]);
        var raw = r[h];
        if (str(raw) === '') return;
        if (f.type === 'number') {
          var n = parseNumber(raw);
          if (typeof n === 'number' && !isNaN(n)) v[f.id] = n; else badNumbers++;
        } else if (f.type === 'select') {
          var c = findChoiceByLabel(f, raw);
          if (!c) {
            var d = (decisions[f.id] || {})[norm(raw)] || NEW_CHOICE;
            if (d === SKIP_VALUE) return;
            if (d === NEW_CHOICE) { c = addChoice(cat, f.id, str(raw)); addedChoices++; }
            else c = getChoice(f, d);
            // 연결하려던 선택지가 없으면(카탈로그가 바뀐 경우) 새 선택지로
            if (!c) { c = addChoice(cat, f.id, str(raw)); addedChoices++; }
          }
          if (c) v[f.id] = c.id;
        } else v[f.id] = str(raw);
      });
      records.push({ v: v });
    });
    return { catalog: cat, records: records, addedChoices: addedChoices, addedFields: plan.created.length, badNumbers: badNumbers };
  }

  // ── 엑셀 내보내기·백업 ─────────────────────────────────────
  function recordsSheet(catalog, records) {
    var fs = catalog.fields.filter(function (f) { return f.active || records.some(function (r) { return r.v[f.id] != null && r.v[f.id] !== ''; }); });
    var aoa = [fs.map(function (f) { return f.name; })];
    records.forEach(function (r) {
      aoa.push(fs.map(function (f) { var x = r.v[f.id]; return f.type === 'number' && typeof x === 'number' ? x : displayValue(f, x); }));
    });
    return aoa;
  }
  function catalogSheet(catalog) {
    var aoa = [['구분', '항목', '입력 형식', '항목 상태', '선택지', '선택지 상태']];
    catalog.fields.forEach(function (f) {
      var kind = f.kind === 'base' ? '기본 정보' : '옵션';
      var type = { text: '글자', select: '선택', number: '숫자' }[f.type];
      var st = f.active ? '사용' : '숨김';
      if (!f.choices.length) aoa.push([kind, f.name, type, st, '', '']);
      f.choices.forEach(function (c) { aoa.push([kind, f.name, type, st, c.label, c.active ? '사용' : '숨김']); });
    });
    return aoa;
  }
  function pivotSheet(p, axisName, optionName) {
    var head = [axisName + ' \\ ' + optionName, '건수'];
    p.cols.forEach(function (c) { head.push(c.label + ' 건수', c.label + ' 비율(%)'); });
    head.push('가장 많이 쓴 선택지');
    var aoa = [head];
    p.rows.concat([p.total]).forEach(function (r) {
      var line = [r.label, r.total];
      r.cells.forEach(function (c) { line.push(c.count, c.pct); });
      line.push(r.top ? r.top.label : '');
      aoa.push(line);
    });
    return aoa;
  }
  function topSheet(catalog, rows, axisName, optionIds) {
    var head = [axisName, '건수'];
    optionIds.forEach(function (id) { head.push(getField(catalog, id).name); });
    var aoa = [head];
    rows.forEach(function (r) {
      var line = [r.label, r.total];
      optionIds.forEach(function (id) { var t = r.tops[id]; line.push(t ? t.label + ' (' + t.pct + '%)' : ''); });
      aoa.push(line);
    });
    return aoa;
  }
  function makeBackup(db, now) {
    return { app: 'data09-19', version: 1, savedAt: (now || new Date()).toISOString(), sample: !!db._sample, catalog: db.catalog, records: db.records, mapping: db.mapping || {} };
  }
  function parseBackup(text) {
    var p;
    try { p = JSON.parse(text); } catch (e) { throw new Error('not_json'); }
    if (!p || p.app !== 'data09-19' || !p.catalog || !Array.isArray(p.catalog.fields) || !Array.isArray(p.records)) throw new Error('not_backup');
    p.catalog.fields.forEach(function (f) {
      if (!f.id || !f.name || !Array.isArray(f.choices)) throw new Error('bad_field');
    });
    var db = { catalog: p.catalog, records: [], seq: 0, mapping: p.mapping || {} };
    p.records.forEach(function (r) { db.seq++; db.records.push({ id: 'r' + db.seq, v: r && r.v && typeof r.v === 'object' ? r.v : {} }); });
    if (p.sample) db._sample = true;
    return db;
  }

  var api = {
    NEW_CHOICE: NEW_CHOICE, SKIP_VALUE: SKIP_VALUE, NEW_OPTION: NEW_OPTION, NEW_BASE: NEW_BASE, EMPTY_LABEL: EMPTY_LABEL,
    clone: clone, norm: norm, defaultCatalog: defaultCatalog, emptyDb: emptyDb,
    getField: getField, fieldsOf: fieldsOf, getChoice: getChoice, findChoiceByLabel: findChoiceByLabel,
    addField: addField, renameField: renameField, moveField: moveField,
    addChoice: addChoice, renameChoice: renameChoice, moveChoice: moveChoice, choiceUsage: choiceUsage,
    parseNumber: parseNumber, displayValue: displayValue, validateRecord: validateRecord, cleanRecord: cleanRecord,
    filterRecords: filterRecords, distinctValues: distinctValues,
    choiceStats: choiceStats, groupBy: groupBy, pivot: pivot, topByAxis: topByAxis,
    autoMap: autoMap, guessHeaderRow: guessHeaderRow, aoaToRows: aoaToRows, planImport: planImport, applyImport: applyImport,
    recordsSheet: recordsSheet, catalogSheet: catalogSheet, pivotSheet: pivotSheet, topSheet: topSheet,
    makeBackup: makeBackup, parseBackup: parseBackup
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OPLogic = api;
})(typeof window !== 'undefined' ? window : this);
