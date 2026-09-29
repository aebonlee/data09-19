/*
 * 예시 데이터(가상) — 시연·시험용입니다. 실제 고객사·장비·옵션 내역이 아닙니다.
 * 2026-09-29 구체화된 옵션 카탈로그(항목·선택지 이름)를 쓰되, 고객사명은 「예시고객사 A~H」,
 * engine suffix 는 「EX…」 일련번호, 출력·선택 비율은 모두 지어낸 값입니다.
 * 분석 화면이 차이를 보여 주는지 확인하려고 배출 규제·장비 유형별로 일부러 치우친 선택을 넣었습니다
 *   - ATS type: Stage5·Tier4f → DOC+DPF / DOC_SDPF, EU Stage3A → DOC, Unregulated → Muffler 위주
 *   - CAN1(J1939) baudrate: EU → 500kb 위주, 그 밖 → 250kb 위주
 *   - Accelerator type: Excavator → CAN (SMVCU), Forklift → Hardwire Foot, Loader → Hardwire Foot and Hand,
 *     TLS → CAN (EEC2), Generator → CAN (TSC1) 위주
 *   - starter control type: Generator → ECU control, 그 밖 → VCU control 위주
 *   - check engine lamp: 규제 지역 → CAN type, EU Stage3A·Unregulated → HW type 위주
 *   - Parking Brake: Generator 는 적용 조건상 쓰지 않음(해당 없음), Forklift → Hardwire 위주
 *   - Regeneration 스위치 2종: DPF 가 없는 ATS(DOC·Muffler)는 적용 조건상 쓰지 않음
 *   - Oil pressure lamp: 카탈로그에 선택지가 없어 비워 둠
 * 적용 조건(규칙)을 어기는 값은 만들지 않습니다(테스트로 확인).
 * 같은 결과가 나오도록 난수는 고정 씨앗(seed)으로 만듭니다.
 */
(function (root) {
  'use strict';
  var L = root.OPLogic || (typeof require !== 'undefined' ? require('./logic.js') : null);

  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  var CUSTOMERS = [
    { name: '예시고객사 A', reg: 'Korea Stage5', equips: ['Excavator', 'Forklift'] },
    { name: '예시고객사 B', reg: 'Korea Stage5', equips: ['Generator', 'Loader'] },
    { name: '예시고객사 C', reg: 'EU Stage5', equips: ['Excavator', 'TLS'] },
    { name: '예시고객사 D', reg: 'EU Stage5', equips: ['Forklift', 'Generator'] },
    { name: '예시고객사 E', reg: 'NA Tier4f', equips: ['Generator', 'TLS'] },
    { name: '예시고객사 F', reg: 'NA Tier4f', equips: ['Excavator', 'Loader'] },
    { name: '예시고객사 G', reg: 'EU Stage3A', equips: ['Excavator', 'Generator'] },
    { name: '예시고객사 H', reg: 'Unregulated', equips: ['Forklift', 'Generator'] }
  ];
  var PER_CUSTOMER = 12;

  // 레코드를 이름(라벨) 형태로 만듭니다 — 파일·카탈로그 양쪽에서 씁니다
  function labelRows() {
    var r = rng(19);
    function pick(list, weights) {
      var x = r(), acc = 0;
      for (var i = 0; i < list.length; i++) { acc += weights[i]; if (x < acc) return list[i]; }
      return list[list.length - 1];
    }
    var CAN_HW = ['CAN', 'Hardwire'], VCU_ECU = ['VCU', 'ECU'];
    var rows = [], n = 0;
    CUSTOMERS.forEach(function (c) {
      var regulated = c.reg !== 'EU Stage3A' && c.reg !== 'Unregulated';
      var eu = c.reg.indexOf('EU') === 0;
      for (var k = 0; k < PER_CUSTOMER; k++) {
        n++;
        var equip = c.equips[k % 3 === 2 ? 1 : 0];
        var gen = equip === 'Generator';
        var ats = regulated ? pick(['DOC+DPF', 'DOC_SDPF', 'DOC'], eu ? [0.35, 0.6, 0.05] : [0.7, 0.2, 0.1])
          : c.reg === 'EU Stage3A' ? pick(['DOC', 'DOC+DPF', 'Muffler'], [0.75, 0.15, 0.1]) : pick(['Muffler', 'DOC'], [0.8, 0.2]);
        var dpf = ats === 'DOC+DPF' || ats === 'DOC_SDPF';
        var baud = eu ? pick(['500kb', '250kb'], [0.75, 0.25]) : pick(['250kb', '500kb'], [0.8, 0.2]);
        var accel = {
          Excavator: pick(['CAN (SMVCU)', 'CAN (EEC2)', 'Hardwire Foot'], [0.75, 0.15, 0.1]),
          Forklift: pick(['Hardwire Foot', 'CAN (EEC2)'], [0.7, 0.3]),
          Loader: pick(['Hardwire Foot and Hand', 'CAN (EEC2)'], [0.6, 0.4]),
          TLS: pick(['CAN (EEC2)', 'CAN (SMVCU)'], [0.65, 0.35]),
          Generator: pick(['CAN (TSC1)', 'Hardwire Foot and Hand'], [0.85, 0.15])
        }[equip];
        var starter = gen ? pick(['ECU control', 'VCU control'], [0.8, 0.2]) : pick(['VCU control', 'ECU control'], [0.75, 0.25]);
        var cel = regulated ? pick(['CAN type', 'HW type'], [0.75, 0.25]) : pick(['CAN type', 'HW type'], [0.2, 0.8]);
        var pbrake = gen ? '' : equip === 'Forklift' ? pick(['Hardwire (Normally open)', 'Hardwire (Normally closed)', 'CAN (CCVS)'], [0.45, 0.4, 0.15])
          : equip === 'Excavator' ? pick(['CAN (SMVCU)', 'CAN (CCVS)'], [0.7, 0.3]) : pick(['CAN (CCVS)', 'Hardwire (Normally closed)'], [0.7, 0.3]);
        var sac = regulated ? pick(CAN_HW, [0.7, 0.3]) : pick(CAN_HW, [0.3, 0.7]);
        var estop = gen ? pick(CAN_HW, [0.15, 0.85]) : pick(CAN_HW, [0.55, 0.45]);
        var regDem = dpf ? pick(CAN_HW, [0.65, 0.35]) : '';
        var regInh = dpf ? pick(CAN_HW, [0.55, 0.45]) : '';
        var wif = pick(VCU_ECU, gen ? [0.3, 0.7] : [0.65, 0.35]);
        var efp = pick(VCU_ECU, eu ? [0.35, 0.65] : [0.6, 0.4]);
        var power = gen ? 200 + Math.floor(r() * 10) * 20 : equip === 'Excavator' ? 90 + Math.floor(r() * 8) * 15
          : equip === 'Loader' || equip === 'TLS' ? 75 + Math.floor(r() * 6) * 10 : 40 + Math.floor(r() * 6) * 10;
        rows.push({
          '고객사': c.name, 'engine suffix': 'EX' + String(100 + n), 'Machine type': equip, 'Emission regulation': c.reg, '출력': power,
          'ATS type': ats, 'CAN1(J1939) baudrate': baud, 'Accelerator type': accel, 'starter control type': starter,
          'check engine lamp': cel, 'Parking Brake': pbrake, 'SAC lamp': sac, 'Emergency stop': estop, 'Oil pressure lamp': '',
          'Regeneration demand switch': regDem, 'Regeneration inhibit switch': regInh, 'WIF': wif, 'Electric feed pump': efp
        });
      }
    });
    return rows;
  }

  // 예시 선택지를 따로 더하지 않습니다 — 2026-09-29 카탈로그에 선택지가 모두 들어 있습니다
  function sampleCatalog() { return L.defaultCatalog(); }
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
    var rename = { '고객사': 'Customer', 'engine suffix': 'Engine Suffix', 'Machine type': 'Equipment', 'Emission regulation': 'Emission', '출력': 'Power' };
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
