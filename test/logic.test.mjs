// 실행: node test/logic.test.mjs   (의존성 없음)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../js/logic.js');
const Sample = require('../js/sample-data.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

// 손으로 셀 수 있는 작은 데이터: 5건
// 1 A EU Stage5 Excavator CAN   2 A EU Stage5 Forklift CAN   3 B EU Stage5 Excavator HW
// 4 B NA Tier4f Excavator HW    5 C NA Tier4f (장비 없음) (lamp 없음)
// (지역 → Emission regulation, 장비 유형 → Machine type — 2026-09-29 카탈로그. 한글 약칭은 아래 표로 연결)
function small() {
  const cat = L.defaultCatalog();
  const rec = (cust, region, equip, cel) => ({
    v: Object.assign({ f_customer: cust },
      region ? { f_region: { 한국: 'c_region1', 유럽: 'c_region2', 미국: 'c_region3' }[region] } : {},   // Korea Stage5 / EU Stage5 / NA Tier4f
      equip ? { f_equip: { 굴삭기: 'c_equip1', 지게차: 'c_equip2', 발전기: 'c_equip3' }[equip] } : {},  // Excavator / Forklift / Generator
      cel ? { f_cel: cel === 'CAN' ? 'c_cel1' : 'c_cel2' } : {})
  });
  const records = [rec('A', '유럽', '굴삭기', 'CAN'), rec('A', '유럽', '지게차', 'CAN'), rec('B', '유럽', '굴삭기', 'HW'),
    rec('B', '미국', '굴삭기', 'HW'), rec('C', '미국', '', '')].map((r, i) => ({ id: 'r' + (i + 1), ...r }));
  return { cat, records };
}

console.log('초기 카탈로그');
test('2026-09-29 구체화 카탈로그 — 기본 5 + 옵션 13, 이름·순서 원문 그대로', () => {
  const c = L.defaultCatalog();
  assert.deepEqual(L.fieldsOf(c, 'base').map(f => f.name), ['고객사', 'engine suffix', 'Machine type', 'Emission regulation', '출력']);
  assert.deepEqual(L.fieldsOf(c, 'option').map(f => f.name), ['ATS type', 'CAN1(J1939) baudrate', 'Accelerator type', 'starter control type',
    'check engine lamp', 'Parking Brake', 'SAC lamp', 'Emergency stop', 'Oil pressure lamp', 'Regeneration demand switch',
    'Regeneration inhibit switch', 'WIF', 'Electric feed pump']);
});
test('항목별 선택지 원문 그대로', () => {
  const c = L.defaultCatalog();
  const labels = id => L.getField(c, id).choices.map(x => x.label);
  assert.deepEqual(labels('f_equip'), ['Excavator', 'Forklift', 'Generator', 'Loader', 'TLS']);
  assert.deepEqual(labels('f_region'), ['Korea Stage5', 'EU Stage5', 'NA Tier4f', 'EU Stage3A', 'Unregulated']);
  assert.deepEqual(labels('f_ats'), ['DOC+DPF', 'DOC_SDPF', 'DOC', 'Muffler']);
  assert.deepEqual(labels('f_baud'), ['250kb', '500kb']);
  assert.deepEqual(labels('f_accel'), ['CAN (SMVCU)', 'CAN (EEC2)', 'CAN (TSC1)', 'Hardwire Foot', 'Hardwire Foot and Hand']);
  assert.deepEqual(labels('f_starter'), ['VCU control', 'ECU control']);
  assert.deepEqual(labels('f_pbrake'), ['CAN (CCVS)', 'CAN (SMVCU)', 'Hardwire (Normally open)', 'Hardwire (Normally closed)']);
  ['f_sac', 'f_estop', 'f_regen_dem', 'f_regen_inh'].forEach(id => assert.deepEqual(labels(id), ['CAN', 'Hardwire']));
  ['f_wif', 'f_efp'].forEach(id => assert.deepEqual(labels(id), ['VCU', 'ECU']));
});
test('항목·선택지 id 가 모두 서로 다름', () => {
  const c = L.defaultCatalog();
  const ids = c.fields.flatMap(f => [f.id].concat(f.choices.map(x => x.id)));
  assert.equal(new Set(ids).size, ids.length);
});
test('check engine lamp 선택지는 원문 그대로 CAN type / HW type', () => {
  assert.deepEqual(L.getField(L.defaultCatalog(), 'f_cel').choices.map(c => c.label), ['CAN type', 'HW type']);
});
test('원문에 선택지가 없는 옵션(Oil pressure lamp)은 비어 있음(지어내지 않음)', () => {
  assert.equal(L.getField(L.defaultCatalog(), 'f_oilp').choices.length, 0);
});
test('항목 추가는 여전히 가능 — 14번째 옵션', () => {
  const c = L.defaultCatalog();
  L.addField(c, { name: 'Coolant level lamp', kind: 'option' });
  assert.equal(L.fieldsOf(c, 'option').length, 14);
});

console.log('카탈로그 편집');
test('항목 추가 — 옵션은 선택형, id 겹치지 않음', () => {
  const c = L.defaultCatalog();
  const f = L.addField(c, { name: 'Coolant sensor', kind: 'option', type: 'text' });
  assert.equal(f.type, 'select'); assert.equal(f.kind, 'option');
  assert.equal(c.fields.filter(x => x.id === f.id).length, 1);
});
test('이름이 대소문자·공백만 다르면 중복', () => {
  assert.throws(() => L.addField(L.defaultCatalog(), { name: 'ats  TYPE', kind: 'option' }), /name_duplicate/);
  assert.throws(() => L.addField(L.defaultCatalog(), { name: 'CheckEngine Lamp', kind: 'option' }), /name_duplicate/);
});
test('선택지 추가·중복 거부', () => {
  const c = L.defaultCatalog();
  L.addChoice(c, 'f_oilp', 'Type 1');
  assert.throws(() => L.addChoice(c, 'f_oilp', ' type-1 '), /label_duplicate/);
  assert.throws(() => L.addChoice(c, 'f_cel', 'hw type'), /label_duplicate/);
});
test('선택지 이름을 고치면 레코드 표시도 바뀜(id 저장)', () => {
  const { cat, records } = small();
  L.renameChoice(cat, 'f_cel', 'c_cel1', 'CAN');
  assert.equal(L.displayValue(L.getField(cat, 'f_cel'), records[0].v.f_cel), 'CAN');
});
test('항목 순서 이동은 같은 종류 안에서만', () => {
  const c = L.defaultCatalog();
  assert.equal(L.moveField(c, 'f_ats', -1), false); // 옵션 맨 위
  assert.equal(L.moveField(c, 'f_baud', -1), true);
  assert.deepEqual(L.fieldsOf(c, 'option').slice(0, 2).map(f => f.id), ['f_baud', 'f_ats']);
  assert.equal(c.fields[4].id, 'f_power'); // 기본 정보는 그대로
});
test('선택지 사용 건수', () => {
  const { records } = small();
  assert.equal(L.choiceUsage(records, 'f_cel', 'c_cel2'), 2);
});

console.log('값·검증');
test('숫자 읽기', () => {
  assert.equal(L.parseNumber('75'), 75);
  assert.equal(L.parseNumber(' 1,200 kW'), 1200);
  assert.equal(L.parseNumber('55.5'), 55.5);
  assert.equal(L.parseNumber(''), null);
  assert.ok(Number.isNaN(L.parseNumber('약 70')));
  assert.ok(Number.isNaN(L.parseNumber('70~90')));
});
test('고객사 필수, 숫자 칸 검사', () => {
  const c = L.defaultCatalog();
  assert.deepEqual(L.validateRecord(c, { f_power: 'abc' }), [{ fieldId: 'f_customer', code: 'required' }, { fieldId: 'f_power', code: 'not_number' }]);
  assert.deepEqual(L.validateRecord(c, { f_customer: 'A', f_power: '75 kW', f_cel: 'c_cel1' }), []);
});
test('숨긴 항목은 검사하지 않음', () => {
  const c = L.defaultCatalog();
  L.getField(c, 'f_customer').active = false;
  assert.deepEqual(L.validateRecord(c, {}), []);
});
test('저장 값 정리 — 숫자는 number, 빈 칸 버림', () => {
  assert.deepEqual(L.cleanRecord(L.defaultCatalog(), { f_customer: ' A ', f_power: '75 kW', f_suffix: '', f_cel: 'c_cel2' }),
    { f_customer: 'A', f_power: 75, f_cel: 'c_cel2' });
});

console.log('거르기');
test('지역=유럽 → 3건', () => {
  const { cat, records } = small();
  assert.equal(L.filterRecords(cat, records, '', { f_region: 'c_region2' }).length, 3);
});
test('고객사 글자 조건은 대소문자 무시', () => {
  const { cat, records } = small();
  assert.equal(L.filterRecords(cat, records, '', { f_customer: 'a' }).length, 2);
});
test('검색어는 선택지 이름에서도 찾음', () => {
  const { cat, records } = small();
  assert.equal(L.filterRecords(cat, records, 'hw', {}).length, 2);
});
test('(미입력) 조건', () => {
  const { cat, records } = small();
  assert.deepEqual(L.filterRecords(cat, records, '', { f_equip: L.EMPTY_LABEL }).map(r => r.id), ['r5']);
});

console.log('분석');
test('옵션 빈도·비율 — CAN 2(40%), HW 2(40%), 미입력 1(20%)', () => {
  const { cat, records } = small();
  const s = L.choiceStats(cat, records, 'f_cel');
  assert.equal(s.total, 5);
  assert.deepEqual(s.items.map(i => [i.label, i.count, i.pct]), [['CAN type', 2, 40], ['HW type', 2, 40]]);
  assert.deepEqual(s.empty, { count: 1, pct: 20 });
});
test('빈도는 많은 순', () => {
  const { cat, records } = small();
  records[4].v.f_cel = 'c_cel2';
  assert.deepEqual(L.choiceStats(cat, records, 'f_cel').items.map(i => i.label), ['HW type', 'CAN type']);
});
test('숨긴 선택지라도 쓰인 기록이 있으면 집계에 남음', () => {
  const { cat, records } = small();
  L.getChoice(L.getField(cat, 'f_cel'), 'c_cel1').active = false;
  assert.equal(L.choiceStats(cat, records, 'f_cel').items.find(i => i.id === 'c_cel1').count, 2);
});
test('지역 × check engine lamp 피벗 (손 계산)', () => {
  const { cat, records } = small();
  const p = L.pivot(cat, records, 'f_region', 'f_cel');
  assert.deepEqual(p.cols.map(c => c.label), ['CAN type', 'HW type', '(미입력)']);
  // 유럽 3건: CAN 2(66.7%) HW 1(33.3%) / 미국 2건: HW 1(50%) 미입력 1(50%)
  assert.deepEqual(p.rows.map(r => [r.label, r.total, r.cells.map(c => c.count), r.cells.map(c => c.pct)]),
    [['EU Stage5', 3, [2, 1, 0], [66.7, 33.3, 0]], ['NA Tier4f', 2, [0, 1, 1], [0, 50, 50]]]);
  assert.deepEqual(p.rows[0].top, { label: 'CAN type', count: 2, pct: 66.7 });
  assert.equal(p.rows[1].top.label, 'HW type'); // 미입력은 최다 후보에서 뺌
  assert.deepEqual(p.total.cells.map(c => c.count), [2, 2, 1]);
  assert.equal(p.total.top.label, 'CAN type / HW type'); // 같은 건수는 함께
});
test('장비 유형 기준 — 미입력 묶음은 맨 뒤', () => {
  const { cat, records } = small();
  assert.deepEqual(L.groupBy(cat, records, 'f_equip').map(g => [g.label, g.records.length]), [['Excavator', 3], ['Forklift', 1], ['(미입력)', 1]]);
});
test('고객사(글자) 기준 묶기', () => {
  const { cat, records } = small();
  records[1].v.f_customer = ' a ';
  assert.deepEqual(L.groupBy(cat, records, 'f_customer').map(g => [g.label, g.records.length]), [['A', 2], ['B', 2], ['C', 1]]);
});
test('기준별 최다 선택지', () => {
  const { cat, records } = small();
  const t = L.topByAxis(cat, records, 'f_customer', ['f_cel', 'f_ats']);
  assert.deepEqual(t.map(r => [r.label, r.tops.f_cel && r.tops.f_cel.label, r.tops.f_ats]), [['A', 'CAN type', null], ['B', 'HW type', null], ['C', null, null]]);
});

console.log('적용 조건(규칙)');
test('기본 규칙 3개 — 재생 스위치 2종은 DPF 있는 ATS, Parking Brake 는 발전기 제외', () => {
  const c = L.defaultCatalog();
  assert.deepEqual(L.rulesOf(c).map(r => r.target), ['f_regen_dem', 'f_regen_inh', 'f_pbrake']);
  assert.ok(L.rulesOf(c).every(r => r.in.every(id => L.getChoice(L.getField(c, r.when), id))));
});
test('적용 여부 — 조건 값이 없으면 막지 않음', () => {
  const c = L.defaultCatalog();
  assert.equal(L.isApplicable(c, { f_ats: 'c_ats1' }, 'f_regen_dem'), true);   // DOC+DPF
  assert.equal(L.isApplicable(c, { f_ats: 'c_ats2' }, 'f_regen_dem'), true);   // DOC_SDPF
  assert.equal(L.isApplicable(c, { f_ats: 'c_ats3' }, 'f_regen_dem'), false);  // DOC
  assert.equal(L.isApplicable(c, { f_ats: 'c_ats4' }, 'f_regen_inh'), false);  // Muffler
  assert.equal(L.isApplicable(c, {}, 'f_regen_dem'), true);
  assert.equal(L.isApplicable(c, { f_equip: 'c_equip3' }, 'f_pbrake'), false); // Generator
  assert.equal(L.isApplicable(c, { f_equip: 'c_equip4' }, 'f_pbrake'), true);  // Loader
  assert.equal(L.isApplicable(c, { f_equip: 'c_equip3' }, 'f_cel'), true);     // 규칙 없는 항목
});
test('검증 — 해당 없는 옵션에 값이 있으면 not_applicable', () => {
  const c = L.defaultCatalog();
  assert.deepEqual(L.validateRecord(c, { f_customer: 'A', f_equip: 'c_equip3', f_pbrake: 'c_pbrake1' }), [{ fieldId: 'f_pbrake', code: 'not_applicable' }]);
  assert.deepEqual(L.validateRecord(c, { f_customer: 'A', f_equip: 'c_equip1', f_pbrake: 'c_pbrake1' }), []);
});
test('규칙 추가 — 잘못된 규칙 거부, 같은 target 규칙은 모두 맞아야 함', () => {
  const c = L.defaultCatalog();
  assert.throws(() => L.addRule(c, { target: 'f_wif', when: 'f_wif', in: ['c_wif1'] }), /rule_self/);
  assert.throws(() => L.addRule(c, { target: 'f_power', when: 'f_equip', in: ['c_equip1'] }), /rule_target/);
  assert.throws(() => L.addRule(c, { target: 'f_wif', when: 'f_customer', in: ['x'] }), /rule_when/);
  assert.throws(() => L.addRule(c, { target: 'f_wif', when: 'f_equip', in: ['c_없음'] }), /rule_choices/);
  assert.throws(() => L.addRule(c, { target: 'f_pbrake', when: 'f_equip', in: ['c_equip1'] }), /rule_duplicate/);
  const r = L.addRule(c, { target: 'f_pbrake', when: 'f_region', in: ['c_region1', 'c_region1'] });
  assert.equal(r.id, 'rule4'); assert.deepEqual(r.in, ['c_region1']);
  assert.equal(L.isApplicable(c, { f_equip: 'c_equip1', f_region: 'c_region1' }, 'f_pbrake'), true);
  assert.equal(L.isApplicable(c, { f_equip: 'c_equip1', f_region: 'c_region2' }, 'f_pbrake'), false);
  assert.equal(L.removeRule(c, 'rule4'), true);
  assert.equal(L.isApplicable(c, { f_equip: 'c_equip1', f_region: 'c_region2' }, 'f_pbrake'), true);
});
test('규칙 문장', () => {
  const c = L.defaultCatalog();
  assert.equal(L.ruleText(c, L.getRule(c, 'rule1')), '「Regeneration demand switch」은(는) 「ATS type」이(가) DOC+DPF · DOC_SDPF 일 때만 씁니다');
});
test('집계 — 해당 없음은 미입력과 따로 세고 최다 후보에서 뺌', () => {
  const c = L.defaultCatalog();
  const recs = [
    { id: 'r1', v: { f_customer: 'A', f_equip: 'c_equip1', f_pbrake: 'c_pbrake2' } },
    { id: 'r2', v: { f_customer: 'A', f_equip: 'c_equip1' } },               // 미입력
    { id: 'r3', v: { f_customer: 'B', f_equip: 'c_equip3' } },               // 발전기 → 해당 없음
    { id: 'r4', v: { f_customer: 'B', f_equip: 'c_equip3' } }];
  const s = L.choiceStats(c, recs, 'f_pbrake');
  assert.deepEqual(s.empty, { count: 1, pct: 25 }); assert.deepEqual(s.na, { count: 2, pct: 50 });
  const p = L.pivot(c, recs, 'f_customer', 'f_pbrake');
  assert.deepEqual(p.cols.slice(-2).map(x => x.label), [L.EMPTY_LABEL, L.NA_LABEL]);
  assert.equal(p.rows.find(r => r.label === 'B').top, null);
  assert.equal(p.total.top.label, 'CAN (SMVCU)');
});
test('규칙 위반 찾기 — 값은 지우지 않고 알려 줌', () => {
  const c = L.defaultCatalog();
  const recs = [{ id: 'r1', v: { f_ats: 'c_ats3', f_regen_dem: 'c_regdem1', f_regen_inh: 'c_reginh2' } }, { id: 'r2', v: { f_ats: 'c_ats1', f_regen_dem: 'c_regdem1' } }];
  assert.deepEqual(L.ruleViolations(c, recs), [{ recordId: 'r1', fieldId: 'f_regen_dem', ruleId: 'rule1' }, { recordId: 'r1', fieldId: 'f_regen_inh', ruleId: 'rule2' }]);
  assert.equal(L.choiceStats(c, recs, 'f_regen_dem').items.find(i => i.label === 'CAN').count, 2);
});
test('규칙은 백업에 담기고, 옛 백업(규칙 없음)은 빈 규칙으로 복원', () => {
  const c = L.defaultCatalog();
  const db = L.parseBackup(JSON.stringify(L.makeBackup({ catalog: c, records: [] })));
  assert.equal(L.rulesOf(db.catalog).length, 3);
  const old = L.makeBackup({ catalog: { fields: c.fields }, records: [] });
  assert.deepEqual(L.parseBackup(JSON.stringify(old)).catalog.rules, []);
  assert.equal(L.rulesSheet(c).length, 4);
});

console.log('엑셀 가져오기');
test('열 이름 자동 연결(영문·대소문자)', () => {
  const m = L.autoMap(['Customer', 'engine_suffix', 'REGION', 'Check Engine Lamp', '비고'], L.defaultCatalog());
  assert.deepEqual(m, { Customer: 'f_customer', engine_suffix: 'f_suffix', REGION: 'f_region', 'Check Engine Lamp': 'f_cel', '비고': '' });
});
test('저장해 둔 연결을 먼저 씀', () => {
  const m = L.autoMap(['고객 이름'], L.defaultCatalog(), { '고객 이름': 'f_customer' });
  assert.equal(m['고객 이름'], 'f_customer');
});
test('머리행 찾기 + 빈 줄 건너뜀 + 같은 열 이름 구분', () => {
  const aoa = [['옵션 현황표'], [], ['고객사', '지역', '지역'], ['A', '유럽', 'x'], [], ['B', '미국', '']];
  assert.equal(L.guessHeaderRow(aoa), 2);
  const r = L.aoaToRows(aoa, 2);
  assert.deepEqual(r.headers, ['고객사', '지역', '지역 (2)']);
  assert.equal(r.rows.length, 2); assert.equal(r.skipped, 1);
});
test('카탈로그에 없는 값 모으기 — 표기 흔들림은 기존 선택지로 자동 연결', () => {
  const rows = [{ Lamp: 'can type' }, { Lamp: 'CAN' }, { Lamp: 'CAN' }, { Lamp: 'Relay' }, { Lamp: '' }];
  const plan = L.planImport(L.defaultCatalog(), ['Lamp'], rows, { Lamp: 'f_cel' });
  assert.deepEqual(plan.unknown.f_cel.map(u => [u.raw, u.count]), [['CAN', 2], ['Relay', 1]]);
});
test('가져오기 — 기존 연결 / 새 선택지 / 비움 결정 반영', () => {
  const rows = [{ Lamp: 'can type', P: '80 kW' }, { Lamp: 'CAN', P: '약 70' }, { Lamp: 'Relay', P: '' }, { Lamp: 'Other', P: '120' }];
  const plan = L.planImport(L.defaultCatalog(), ['Lamp', 'P'], rows, { Lamp: 'f_cel', P: 'f_power' });
  const res = L.applyImport(plan, { f_cel: { can: 'c_cel1', other: L.SKIP_VALUE } });
  const lamp = L.getField(res.catalog, 'f_cel');
  assert.deepEqual(res.records.map(r => L.displayValue(lamp, r.v.f_cel)), ['CAN type', 'CAN type', 'Relay', '']);
  assert.deepEqual(res.records.map(r => r.v.f_power), [80, undefined, undefined, 120]);
  assert.equal(res.addedChoices, 1); assert.equal(res.badNumbers, 1);
  assert.equal(L.getField(L.defaultCatalog(), 'f_cel').choices.length, 2); // 원래 카탈로그는 그대로
});
test('연결하려던 선택지가 없어졌으면 새 선택지로(값 잃지 않음)', () => {
  const plan = L.planImport(L.defaultCatalog(), ['Lamp'], [{ Lamp: 'Relay' }], { Lamp: 'f_cel' });
  const res = L.applyImport(plan, { f_cel: { relay: 'c_없는선택지' } });
  assert.equal(L.displayValue(L.getField(res.catalog, 'f_cel'), res.records[0].v.f_cel), 'Relay');
});
test('새 옵션 항목으로 가져오기 — 값이 선택지가 됨', () => {
  const rows = [{ 'Fan type': 'F1' }, { 'Fan type': 'F2' }, { 'Fan type': 'f1' }];
  const plan = L.planImport(L.defaultCatalog(), ['Fan type'], rows, { 'Fan type': L.NEW_OPTION });
  const res = L.applyImport(plan, {});
  const f = res.catalog.fields.find(x => x.name === 'Fan type');
  assert.equal(f.kind, 'option'); assert.equal(res.addedFields, 1);
  assert.deepEqual(f.choices.map(c => c.label), ['F1', 'F2']);
  assert.equal(res.records[0].v[f.id], res.records[2].v[f.id]);
});

console.log('내보내기·백업');
test('옵션 내역 시트 — 머리행은 항목 이름, 값은 선택지 이름', () => {
  const { cat, records } = small();
  const aoa = L.recordsSheet(cat, records);
  assert.equal(aoa[0][0], '고객사'); assert.ok(aoa[0].includes('check engine lamp'));
  assert.equal(aoa[3][aoa[0].indexOf('check engine lamp')], 'HW type');
  assert.equal(aoa.length, 6);
});
test('내보낸 시트를 다시 가져오면 같은 값(왕복)', () => {
  const { cat, records } = small();
  const aoa = L.recordsSheet(cat, records);
  const t = L.aoaToRows(aoa, 0);
  const plan = L.planImport(cat, t.headers, t.rows, L.autoMap(t.headers, cat));
  const res = L.applyImport(plan, {});
  assert.equal(res.addedChoices, 0);
  assert.deepEqual(res.records.map(r => r.v), records.map(r => r.v));
});
test('피벗 시트에 전체 행', () => {
  const { cat, records } = small();
  const aoa = L.pivotSheet(L.pivot(cat, records, 'f_region', 'f_cel'), '지역', 'check engine lamp');
  assert.deepEqual(aoa[aoa.length - 1].slice(0, 4), ['전체', 5, 2, 40]);
});
test('백업 → 복원', () => {
  const { cat, records } = small();
  const b = L.makeBackup({ catalog: cat, records }, new Date('2026-09-28T00:00:00Z'));
  const db = L.parseBackup(JSON.stringify(b));
  assert.equal(db.records.length, 5); assert.equal(db.seq, 5);
  assert.deepEqual(db.records[2].v, records[2].v);
  assert.throws(() => L.parseBackup('{"app":"other"}'), /not_backup/);
  assert.throws(() => L.parseBackup('나쁜 파일'), /not_json/);
});

console.log('예시 데이터');
test('예시 96건, 고객사 8곳 모두 「예시」 이름', () => {
  const db = Sample.sampleDb();
  assert.equal(db.records.length, 96); assert.equal(db._sample, true);
  const names = L.groupBy(db.catalog, db.records, 'f_customer').map(g => g.label);
  assert.equal(names.length, 8); assert.ok(names.every(n => n.startsWith('예시')));
});
test('예시 데이터는 새 카탈로그 그대로 — 선택지를 새로 만들지 않음, 모든 장비 유형·배출 규제 등장', () => {
  const db = Sample.sampleDb();
  assert.deepEqual(db.catalog.fields.map(f => f.choices.length), L.defaultCatalog().fields.map(f => f.choices.length));
  assert.equal(L.groupBy(db.catalog, db.records, 'f_equip').length, 5);
  assert.equal(L.groupBy(db.catalog, db.records, 'f_region').length, 5);
  assert.ok(L.fieldsOf(db.catalog, 'option').every(f => f.id === 'f_oilp' || L.choiceStats(db.catalog, db.records, f.id).items.some(i => i.count)));
});
test('예시 데이터는 적용 조건을 어기지 않음', () => {
  const db = Sample.sampleDb();
  assert.equal(L.ruleViolations(db.catalog, db.records).length, 0);
});
test('예시 데이터 다빈도 — 배출 규제·장비 유형별 치우침이 보임', () => {
  const db = Sample.sampleDb();
  const top = (axis, opt, label) => L.pivot(db.catalog, db.records, axis, opt).rows.find(r => r.label === label).top.label;
  assert.equal(top('f_region', 'f_ats', 'EU Stage5'), 'DOC_SDPF');
  assert.equal(top('f_region', 'f_ats', 'Unregulated'), 'Muffler');
  assert.equal(top('f_region', 'f_cel', 'Unregulated'), 'HW type');
  assert.equal(top('f_region', 'f_baud', 'EU Stage5'), '500kb');
  assert.equal(top('f_equip', 'f_accel', 'Forklift'), 'Hardwire Foot');
  assert.equal(top('f_equip', 'f_starter', 'Generator'), 'ECU control');
  // 발전기의 Parking Brake 는 전부 「해당 없음」 — 최다 후보에서 빠짐
  const gen = L.pivot(db.catalog, db.records, 'f_equip', 'f_pbrake').rows.find(r => r.label === 'Generator');
  assert.equal(gen.top, null);
  assert.equal(gen.cells[gen.cells.length - 1].count, gen.total);
});
test('예시 파일 행은 열 맞추기 시험용 — 영문 열 이름, 표기 흔들림, 추가 열', () => {
  const rows = Sample.fileRows();
  assert.ok('Customer' in rows[0] && 'Emission' in rows[0] && '예시 옵션 X' in rows[0]);
  const m = L.autoMap(Object.keys(rows[0]), L.defaultCatalog());
  assert.equal(m.Emission, 'f_region'); assert.equal(m.Equipment, 'f_equip');
  assert.ok(rows.some(r => r['check engine lamp'] === 'CAN' || r['check engine lamp'] === 'hw type'));
});

console.log('\n' + passed + '개 통과' + (process.exitCode ? ' — 실패 있음' : ''));
