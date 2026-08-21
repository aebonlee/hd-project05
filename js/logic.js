/**
 * logic.js — 순수 로직 모듈 (브라우저/Node 겸용)
 * 주차 계산, 매출 집계, 환율 검증, 권한 체크 등 화면과 무관한 함수만 둔다.
 * Node 테스트: node test/logic.test.js
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.Logic = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- 주차 계산 (ISO 8601) ---------------- */

  /** Date → { year, week } (ISO 주차) */
  function isoWeekOf(dateObj) {
    var d = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()));
    var dayNum = d.getUTCDay() || 7; // 월=1 … 일=7
    d.setUTCDate(d.getUTCDate() + 4 - dayNum); // 해당 주의 목요일
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    var week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    return { year: d.getUTCFullYear(), week: week };
  }

  /** 'YYYY-MM-DD' 또는 Date → 'YYYY-Www' 라벨 */
  function weekLabel(input) {
    var d = input instanceof Date ? input : parseDate(input);
    var iw = isoWeekOf(d);
    return iw.year + '-W' + String(iw.week).padStart(2, '0');
  }

  /** 'YYYY-Www' → 해당 주 월요일 Date */
  function weekToMonday(label) {
    var m = /^(\d{4})-W(\d{2})$/.exec(label);
    if (!m) return null;
    var year = +m[1], week = +m[2];
    var jan4 = new Date(Date.UTC(year, 0, 4));
    var day = jan4.getUTCDay() || 7;
    var monday = new Date(jan4);
    monday.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7);
    return monday;
  }

  /** 'YYYY-Www' → 해당 주(목요일 기준)가 속한 'YYYY-MM' */
  function weekToMonth(label) {
    var monday = weekToMonday(label);
    if (!monday) return null;
    var thu = new Date(monday);
    thu.setUTCDate(monday.getUTCDate() + 3);
    return thu.getUTCFullYear() + '-' + String(thu.getUTCMonth() + 1).padStart(2, '0');
  }

  function parseDate(str) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(str));
    if (!m) return new Date(NaN);
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }

  /** 두 날짜 문자열(YYYY-MM-DD) 구간이 겹치는지 */
  function rangesOverlap(aStart, aEnd, bStart, bEnd) {
    return aStart <= bEnd && bStart <= aEnd;
  }

  /* ---------------- 매출 집계 (B-3) ---------------- */

  /**
   * 주간업무 배열 → { labels: [...], series: { 지역: [숫자...] } }
   * mode: 'week'(주간) | 'month'(월간, ISO 주차의 목요일 기준 월로 귀속)
   * regions: 필터할 지역 배열(없으면 전체)
   */
  function aggregateSales(reports, mode, regions) {
    var useMonth = mode === 'month';
    var labelSet = {};
    var series = {};
    (reports || []).forEach(function (r) {
      if (regions && regions.length && regions.indexOf(r.region) === -1) return;
      var label = useMonth ? weekToMonth(r.week) : r.week;
      if (!label) return;
      labelSet[label] = true;
      if (!series[r.region]) series[r.region] = {};
      series[r.region][label] = (series[r.region][label] || 0) + (Number(r.sales) || 0);
    });
    var labels = Object.keys(labelSet).sort();
    var out = {};
    Object.keys(series).sort().forEach(function (region) {
      out[region] = labels.map(function (l) { return series[region][l] || 0; });
    });
    return { labels: labels, series: out };
  }

  /* ---------------- 환율 검증 (B-4) ---------------- */

  /**
   * 환율 입력 검증. { ok, value?, error? }
   * - 숫자, 0보다 커야 함, 1,000,000 미만(입력 실수 방지)
   */
  function validateRate(input) {
    var v = Number(String(input).replace(/,/g, ''));
    if (String(input).trim() === '' || isNaN(v)) return { ok: false, error: '숫자를 입력하세요.' };
    if (v <= 0) return { ok: false, error: '환율은 0보다 커야 합니다.' };
    if (v >= 1000000) return { ok: false, error: '환율 값이 너무 큽니다. 입력을 확인하세요.' };
    return { ok: true, value: Math.round(v * 100) / 100 };
  }

  /** 'YYYY-MM' 형식 검증 */
  function validateMonth(str) {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(str));
  }

  /* ---------------- 권한 체크 ---------------- */

  /** 책임자는 전체 수정, 팀원은 본인 작성분만 수정 */
  function canEdit(user, record) {
    if (!user) return false;
    if (user.role === '책임자') return true;
    return !!record && record.authorId === user.id;
  }

  /* ---------------- 딜러 지표 헬퍼 ---------------- */

  /** 특정 딜러의 실적을 월 오름차순 정렬해 반환 */
  function dealerHistory(metricsList, dealerCode) {
    return (metricsList || [])
      .filter(function (m) { return m.dealerCode === dealerCode; })
      .sort(function (a, b) { return a.month < b.month ? -1 : a.month > b.month ? 1 : 0; });
  }

  /** 엑셀 업로드 행 검증: 필수 컬럼/숫자 체크. { ok, row?, error? } */
  function validateMetricRow(row) {
    if (!row || !String(row.dealerCode || '').trim()) return { ok: false, error: '딜러코드 누락' };
    if (!validateMonth(row.month)) return { ok: false, error: '기준월 형식 오류(YYYY-MM): ' + row.month };
    var nums = ['sales', 'inventory', 'receivable', 'overdue'];
    for (var i = 0; i < nums.length; i++) {
      var v = Number(row[nums[i]]);
      if (isNaN(v) || v < 0) return { ok: false, error: '숫자 항목 오류(' + nums[i] + '): ' + row[nums[i]] };
      row[nums[i]] = v;
    }
    row.dealerCode = String(row.dealerCode).trim().toUpperCase();
    return { ok: true, row: row };
  }

  /** 기존 실적 목록에 업로드 행 병합(딜러코드+기준월 중복 시 덮어쓰기). 새 배열 반환 */
  function mergeMetrics(existing, incoming) {
    var map = {};
    (existing || []).forEach(function (m) { map[m.dealerCode + '|' + m.month] = m; });
    var added = 0, updated = 0;
    (incoming || []).forEach(function (m) {
      var key = m.dealerCode + '|' + m.month;
      if (map[key]) updated++; else added++;
      map[key] = m;
    });
    var list = Object.keys(map).map(function (k) { return map[k]; });
    return { list: list, added: added, updated: updated };
  }

  /* ---------------- 표시 헬퍼 ---------------- */

  function fmt(n) {
    if (n === null || n === undefined || isNaN(Number(n))) return '-';
    return Number(n).toLocaleString('ko-KR');
  }

  /** mailto: 링크 생성 (주간업무 알림) */
  function buildMailto(recipients, subject, body) {
    return 'mailto:' + (recipients || []).join(',') +
      '?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(body);
  }

  /** 이메일 형식 검증 */
  function isEmail(str) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(str).trim());
  }

  return {
    isoWeekOf: isoWeekOf,
    weekLabel: weekLabel,
    weekToMonday: weekToMonday,
    weekToMonth: weekToMonth,
    parseDate: parseDate,
    rangesOverlap: rangesOverlap,
    aggregateSales: aggregateSales,
    validateRate: validateRate,
    validateMonth: validateMonth,
    canEdit: canEdit,
    dealerHistory: dealerHistory,
    validateMetricRow: validateMetricRow,
    mergeMetrics: mergeMetrics,
    fmt: fmt,
    buildMailto: buildMailto,
    isEmail: isEmail
  };
});
