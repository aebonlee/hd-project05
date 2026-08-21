/**
 * logic.js 순수 로직 테스트
 * 실행: node test/logic.test.js
 */
'use strict';
const assert = require('assert');
const L = require('../js/logic.js');

let count = 0;
function ok(name, fn) {
  fn();
  count++;
  console.log('  ✓ ' + name);
}

console.log('[주차 계산]');
ok('2026-01-01은 2026-W01', () => {
  assert.strictEqual(L.weekLabel('2026-01-01'), '2026-W01');
});
ok('2026-08-21은 2026-W34', () => {
  assert.strictEqual(L.weekLabel('2026-08-21'), '2026-W34');
});
ok('연말 경계: 2025-12-29는 2026-W01(ISO)', () => {
  assert.strictEqual(L.weekLabel('2025-12-29'), '2026-W01');
});
ok('연초 경계: 2027-01-01은 2026-W53(ISO)', () => {
  assert.strictEqual(L.weekLabel('2027-01-01'), '2026-W53');
});
ok('weekToMonday: 2026-W34 → 2026-08-17(월)', () => {
  const m = L.weekToMonday('2026-W34');
  assert.strictEqual(m.toISOString().slice(0, 10), '2026-08-17');
});
ok('weekToMonth: 목요일 기준 월 귀속 (2026-W01 → 2026-01)', () => {
  assert.strictEqual(L.weekToMonth('2026-W01'), '2026-01');
});
ok('weekToMonth: 잘못된 라벨은 null', () => {
  assert.strictEqual(L.weekToMonth('abc'), null);
});

console.log('[매출 집계]');
const reports = [
  { week: '2026-W33', region: '유럽법인', sales: 100 },
  { week: '2026-W33', region: '유럽법인', sales: 50 },
  { week: '2026-W34', region: '유럽법인', sales: 200 },
  { week: '2026-W34', region: '직수출', sales: 70 },
];
ok('주간 집계: 같은 주 같은 지역 합산', () => {
  const r = L.aggregateSales(reports, 'week');
  assert.deepStrictEqual(r.labels, ['2026-W33', '2026-W34']);
  assert.deepStrictEqual(r.series['유럽법인'], [150, 200]);
  assert.deepStrictEqual(r.series['직수출'], [0, 70]);
});
ok('월간 집계: W33·W34 모두 2026-08 귀속', () => {
  const r = L.aggregateSales(reports, 'month');
  assert.deepStrictEqual(r.labels, ['2026-08']);
  assert.deepStrictEqual(r.series['유럽법인'], [350]);
});
ok('지역 필터 적용', () => {
  const r = L.aggregateSales(reports, 'week', ['직수출']);
  assert.deepStrictEqual(Object.keys(r.series), ['직수출']);
  assert.deepStrictEqual(r.labels, ['2026-W34']);
});
ok('빈 입력은 빈 결과', () => {
  const r = L.aggregateSales([], 'week');
  assert.deepStrictEqual(r.labels, []);
  assert.deepStrictEqual(r.series, {});
});

console.log('[환율 검증]');
ok('정상 값(콤마 포함) 허용', () => {
  const r = L.validateRate('1,385.50');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value, 1385.5);
});
ok('0 이하 거부', () => {
  assert.strictEqual(L.validateRate('0').ok, false);
  assert.strictEqual(L.validateRate('-5').ok, false);
});
ok('숫자 아님 거부', () => {
  assert.strictEqual(L.validateRate('abc').ok, false);
  assert.strictEqual(L.validateRate('').ok, false);
});
ok('과대 값 거부', () => {
  assert.strictEqual(L.validateRate('9999999').ok, false);
});
ok('기준월 형식 검증', () => {
  assert.strictEqual(L.validateMonth('2026-08'), true);
  assert.strictEqual(L.validateMonth('2026-13'), false);
  assert.strictEqual(L.validateMonth('26-08'), false);
});

console.log('[권한 체크]');
const leader = { id: 'u1', role: '책임자' };
const member = { id: 'u2', role: '팀원' };
ok('책임자는 전체 수정 가능', () => {
  assert.strictEqual(L.canEdit(leader, { authorId: 'u9' }), true);
});
ok('팀원은 본인 작성분만 수정', () => {
  assert.strictEqual(L.canEdit(member, { authorId: 'u2' }), true);
  assert.strictEqual(L.canEdit(member, { authorId: 'u3' }), false);
});
ok('로그인 없으면 수정 불가', () => {
  assert.strictEqual(L.canEdit(null, { authorId: 'u2' }), false);
});

console.log('[딜러 실적 병합/검증]');
ok('validateMetricRow: 정상 행', () => {
  const r = L.validateMetricRow({ dealerCode: 'dl01', month: '2026-08', sales: '100', inventory: 5, receivable: 10, overdue: 0 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.row.dealerCode, 'DL01');
  assert.strictEqual(r.row.sales, 100);
});
ok('validateMetricRow: 기준월 오류', () => {
  assert.strictEqual(L.validateMetricRow({ dealerCode: 'DL01', month: '08월', sales: 1, inventory: 1, receivable: 1, overdue: 1 }).ok, false);
});
ok('validateMetricRow: 음수 거부', () => {
  assert.strictEqual(L.validateMetricRow({ dealerCode: 'DL01', month: '2026-08', sales: -1, inventory: 1, receivable: 1, overdue: 1 }).ok, false);
});
ok('mergeMetrics: 중복 키는 덮어쓰기, 신규는 추가', () => {
  const existing = [{ dealerCode: 'DL01', month: '2026-07', sales: 1 }];
  const incoming = [
    { dealerCode: 'DL01', month: '2026-07', sales: 9 },
    { dealerCode: 'DL01', month: '2026-08', sales: 5 },
  ];
  const r = L.mergeMetrics(existing, incoming);
  assert.strictEqual(r.updated, 1);
  assert.strictEqual(r.added, 1);
  assert.strictEqual(r.list.length, 2);
  const jul = r.list.find(m => m.month === '2026-07');
  assert.strictEqual(jul.sales, 9);
});
ok('dealerHistory: 월 오름차순 정렬', () => {
  const h = L.dealerHistory([
    { dealerCode: 'DL01', month: '2026-08' },
    { dealerCode: 'DL02', month: '2026-01' },
    { dealerCode: 'DL01', month: '2026-01' },
  ], 'DL01');
  assert.deepStrictEqual(h.map(m => m.month), ['2026-01', '2026-08']);
});

console.log('[기타]');
ok('rangesOverlap', () => {
  assert.strictEqual(L.rangesOverlap('2026-08-01', '2026-08-05', '2026-08-05', '2026-08-10'), true);
  assert.strictEqual(L.rangesOverlap('2026-08-01', '2026-08-04', '2026-08-05', '2026-08-10'), false);
});
ok('isEmail', () => {
  assert.strictEqual(L.isEmail('a@b.co'), true);
  assert.strictEqual(L.isEmail('a@b'), false);
});
ok('buildMailto 인코딩', () => {
  const link = L.buildMailto(['a@b.co'], '제목 테스트', '본문');
  assert.ok(link.startsWith('mailto:a@b.co?subject='));
  assert.ok(link.includes(encodeURIComponent('제목 테스트')));
});
ok('fmt 천단위 콤마', () => {
  assert.strictEqual(L.fmt(1234567), '1,234,567');
  assert.strictEqual(L.fmt(null), '-');
});

console.log('\n총 ' + count + '개 테스트 통과');
