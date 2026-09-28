/*
 * 예시 데이터(가상) — 시연·시험용입니다. 실제 고객사·장비·옵션 내역이 아닙니다.
 * 고객사명은 「예시고객사 A~F」, 원문에 선택지가 없는 옵션은 「예시 …」 이름을 붙였습니다.
 * 분석 화면이 차이를 보여 주는지 확인하려고 지역·장비 유형별로 일부러 치우친 선택을 넣었습니다
 *   - check engine lamp: 유럽은 CAN type 위주, 미국은 HW type 위주, 한국은 반반
 *   - Pedal type: 굴삭기 → 예시 Pedal-A, 지게차 → 예시 Pedal-B 위주, 발전기는 대부분 비워 둠
 *   - ATS type: 유럽 → 예시 ATS-A 위주
 * 같은 결과가 나오도록 난수는 고정 씨앗(seed)으로 만듭니다.
 */
(function (root) {
  'use strict';
  var L = root.OPLogic || (typeof require !== 'undefined' ? require('./logic.js') : null);

  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  var CUSTOMERS = [
    { name: '예시고객사 A', region: '한국', equips: ['굴삭기', '지게차'] },
    { name: '예시고객사 B', region: '한국', equips: ['발전기', '굴삭기'] },
    { name: '예시고객사 C', region: '유럽', equips: ['굴삭기', '발전기'] },
    { name: '예시고객사 D', region: '유럽', equips: ['지게차', '굴삭기'] },
    { name: '예시고객사 E', region: '미국', equips: ['발전기', '지게차'] },
    { name: '예시고객사 F', region: '미국', equips: ['굴삭기', '지게차'] }
  ];
  var OPTION_CHOICES = {
    f_ats: ['예시 ATS-A', '예시 ATS-B', '예시 ATS-C'],
    f_cansa: ['예시 SA-1', '예시 SA-2'],
    f_pedal: ['예시 Pedal-A', '예시 Pedal-B', '예시 Pedal-C'],
    f_starter: ['예시 Starter-A', '예시 Starter-B']
  };

  // 레코드를 이름(라벨) 형태로 만듭니다 — 파일·카탈로그 양쪽에서 씁니다
  function labelRows() {
    var r = rng(19);
    function pick(list, weights) {
      var x = r(), acc = 0;
      for (var i = 0; i < list.length; i++) { acc += weights[i]; if (x < acc) return list[i]; }
      return list[list.length - 1];
    }
    var rows = [], n = 0;
    CUSTOMERS.forEach(function (c) {
      for (var k = 0; k < 12; k++) {
        n++;
        var equip = c.equips[k % 3 === 2 ? 1 : 0];
        var cel = c.region === '유럽' ? pick(['CAN type', 'HW type'], [0.85, 0.15])
          : c.region === '미국' ? pick(['CAN type', 'HW type'], [0.2, 0.8]) : pick(['CAN type', 'HW type'], [0.5, 0.5]);
        var pedal = equip === '굴삭기' ? pick(OPTION_CHOICES.f_pedal, [0.8, 0.1, 0.1])
          : equip === '지게차' ? pick(OPTION_CHOICES.f_pedal, [0.1, 0.8, 0.1]) : (r() < 0.8 ? '' : '예시 Pedal-C');
        var ats = c.region === '유럽' ? pick(OPTION_CHOICES.f_ats, [0.75, 0.15, 0.1]) : pick(OPTION_CHOICES.f_ats, [0.3, 0.4, 0.3]);
        var starter = equip === '발전기' ? pick(OPTION_CHOICES.f_starter, [0.2, 0.8]) : pick(OPTION_CHOICES.f_starter, [0.7, 0.3]);
        var cansa = pick(OPTION_CHOICES.f_cansa, [0.6, 0.4]);
        var power = equip === '발전기' ? 200 + Math.floor(r() * 10) * 20 : equip === '굴삭기' ? 90 + Math.floor(r() * 8) * 15 : 40 + Math.floor(r() * 6) * 10;
        rows.push({
          '고객사': c.name, 'engine suffix': 'EX' + String(100 + n), '장비 유형': equip, '지역': c.region, '출력': power,
          'ATS type': ats, 'CAN SA': cansa, 'Pedal type': pedal, 'starter control type': starter, 'check engine lamp': cel
        });
      }
    });
    return rows;
  }

  function sampleCatalog() {
    var cat = L.defaultCatalog();
    Object.keys(OPTION_CHOICES).forEach(function (fid) { OPTION_CHOICES[fid].forEach(function (lab) { L.addChoice(cat, fid, lab); }); });
    return cat;
  }
  // 카탈로그 + 레코드(선택지 id 형태)
  function sampleDb() {
    var cat = sampleCatalog();
    var rows = labelRows();
    var headers = Object.keys(rows[0]);
    var mapping = {};
    headers.forEach(function (h) { cat.fields.forEach(function (f) { if (f.name === h) mapping[h] = f.id; }); });
    var plan = L.planImport(cat, headers, rows, mapping);
    var res = L.applyImport(plan, {});
    var db = { catalog: res.catalog, records: [], seq: 0, mapping: {}, _sample: true };
    res.records.forEach(function (x) { db.seq++; db.records.push({ id: 'r' + db.seq, v: x.v }); });
    return db;
  }

  // 「열 맞추기」를 시험할 예시 파일용 — 열 이름을 영문으로 바꾸고, 표기를 조금 흔들고, 원문에 없는 옵션 열을 하나 더합니다
  function fileRows() {
    var rename = { '고객사': 'Customer', 'engine suffix': 'Engine Suffix', '장비 유형': 'Equipment', '지역': 'Region', '출력': 'Power' };
    return labelRows().map(function (row, i) {
      var o = {};
      Object.keys(row).forEach(function (k) {
        var v = row[k];
        if (k === 'check engine lamp' && i % 9 === 4) v = v === 'CAN type' ? 'CAN' : 'hw type';
        o[rename[k] || k] = v;
      });
      o['예시 옵션 X'] = ['예시 X-1', '예시 X-2'][i % 3 === 0 ? 1 : 0];
      return o;
    });
  }

  var api = { labelRows: labelRows, sampleCatalog: sampleCatalog, sampleDb: sampleDb, fileRows: fileRows };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OPSample = api;
})(typeof window !== 'undefined' ? window : this);
