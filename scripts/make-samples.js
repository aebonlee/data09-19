// 예시 파일 만들기: node scripts/make-samples.js
// samples/예시데이터_옵션내역.xlsx · .csv 를 만들고, 만든 xlsx 를 다시 읽어 원본과 같은지 확인합니다.
// 모두 가상 데이터입니다(js/sample-data.js 참고).
'use strict';
const fs = require('fs');
const path = require('path');
const XLSX = require('../vendor/xlsx.full.min.js');
const Sample = require('../js/sample-data.js');

const out = path.join(__dirname, '..', 'samples');
fs.mkdirSync(out, { recursive: true });
const rows = Sample.fileRows();
const headers = Object.keys(rows[0]);
const aoa = [['예시 데이터(가상) — 인터페이스 옵션 내역. 실제 고객사·장비 정보가 아닙니다.'], []]
  .concat([headers], rows.map(r => headers.map(h => r[h])));

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(aoa);
ws['!cols'] = headers.map(() => ({ wch: 18 }));
XLSX.utils.book_append_sheet(wb, ws, '옵션내역');
const xlsxPath = path.join(out, '예시데이터_옵션내역.xlsx');
fs.writeFileSync(xlsxPath, XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));

const esc = v => { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = [headers].concat(rows.map(r => headers.map(h => r[h]))).map(line => line.map(esc).join(',')).join('\r\n');
fs.writeFileSync(path.join(out, '예시데이터_옵션내역.csv'), '﻿' + csv);

// 다시 읽어 확인
const back = XLSX.utils.sheet_to_json(XLSX.read(fs.readFileSync(xlsxPath), { type: 'buffer' }).Sheets['옵션내역'], { header: 1, defval: '' });
const same = JSON.stringify(back.slice(2)) === JSON.stringify(aoa.slice(2));
console.log('행 ' + rows.length + ' · 열 ' + headers.length + ' · 다시 읽기 ' + (same ? '일치' : '불일치'));
if (!same) process.exit(1);
