/**
 * store.js — 데이터 접근 계층 (어댑터 패턴)
 *
 * 화면(app.js)은 반드시 Store를 통해서만 데이터를 읽고 쓴다.
 * 기본 구현은 LocalStorageAdapter(데모용)이며, 실서비스 전환 시
 * 같은 인터페이스(list/save/remove/replaceAll)를 가진 어댑터로 교체하면 된다.
 *
 *   - GoogleSheetsAdapter : Apps Script 웹앱(doGet/doPost)으로 시트 CRUD (README 참고)
 *   - SupabaseAdapter     : supabase-js의 from(컬렉션).select/upsert/delete 매핑
 *
 * 컬렉션 목록:
 *   users, weeklyReports, receivableLinks, exchangeRates,
 *   trips, meetings, dealers, dealerMetrics, notifyRecipients, notifyLog,
 *   receivableRows, sapSales, priceItems, teamsLinks
 */
(function (root) {
  'use strict';

  var PREFIX = 'hdportal:';
  var SEED_FLAG = PREFIX + 'seeded:v1';

  /** 전체 컬렉션 목록 — 백업(내보내기/가져오기)·시트 생성 기준 */
  var COLLECTIONS = [
    'users', 'weeklyReports', 'receivableLinks', 'exchangeRates',
    'trips', 'meetings', 'dealers', 'dealerMetrics', 'notifyRecipients', 'notifyLog',
    'receivableRows', 'sapSales', 'priceItems', 'teamsLinks'
  ];

  /** 백업 파일 형식 버전 (형식이 바뀌면 올린다) */
  var BACKUP_VERSION = 1;

  /* ---------------- LocalStorage 어댑터 (기본) ---------------- */
  var LocalStorageAdapter = {
    name: 'localStorage',

    _read: function (collection) {
      try {
        var raw = localStorage.getItem(PREFIX + collection);
        return raw ? JSON.parse(raw) : [];
      } catch (e) {
        return [];
      }
    },

    _write: function (collection, list) {
      localStorage.setItem(PREFIX + collection, JSON.stringify(list));
    },

    /** 전체 조회 */
    list: function (collection) {
      return this._read(collection);
    },

    /** 저장(신규/수정). record.id가 이미 있으면 교체, 없으면 추가 */
    save: function (collection, record) {
      var list = this._read(collection);
      if (!record.id) record.id = collection.slice(0, 2) + Date.now() + Math.floor(Math.random() * 1000);
      var idx = -1;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === record.id) { idx = i; break; }
      }
      if (idx >= 0) list[idx] = record; else list.push(record);
      this._write(collection, list);
      return record;
    },

    /** 삭제 */
    remove: function (collection, id) {
      var list = this._read(collection).filter(function (r) { return r.id !== id; });
      this._write(collection, list);
    },

    /** 컬렉션 전체 교체 (엑셀 병합 결과 반영 등) */
    replaceAll: function (collection, list) {
      this._write(collection, list);
    }
  };

  /* ---------------- (예시) Google Sheets 어댑터 골격 ----------------
   * Apps Script 웹앱 URL만 넣으면 동일 인터페이스로 동작하도록 만든 골격.
   * 실제 사용법과 Apps Script 코드는 README "실제 연동 가이드" 참고.
   * ------------------------------------------------------------------ */
  function GoogleSheetsAdapter(webAppUrl) {
    return {
      name: 'googleSheets',
      list: function (collection) {
        // fetch(webAppUrl + '?collection=' + collection) → JSON 배열
        throw new Error('README의 Apps Script 배포 후 구현하세요: ' + webAppUrl);
      },
      save: function (collection, record) {
        // fetch(webAppUrl, {method:'POST', body: JSON.stringify({op:'save', collection, record})})
        throw new Error('README 참고');
      },
      remove: function (collection, id) {
        throw new Error('README 참고');
      },
      replaceAll: function (collection, list) {
        throw new Error('README 참고');
      }
    };
  }

  /* ---------------- Store 파사드 ---------------- */
  var adapter = LocalStorageAdapter;

  var Store = {
    /** 어댑터 교체 지점 — Store.use(GoogleSheetsAdapter(url)) */
    use: function (newAdapter) { adapter = newAdapter; },
    adapterName: function () { return adapter.name; },

    list: function (c) { return adapter.list(c); },
    save: function (c, r) { return adapter.save(c, r); },
    remove: function (c, id) { return adapter.remove(c, id); },
    replaceAll: function (c, list) { return adapter.replaceAll(c, list); },

    /** id로 단건 조회 */
    get: function (collection, id) {
      var list = adapter.list(collection);
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    },

    /* ------- 전체 백업 (JSON 내보내기/가져오기 — 팀원 간 파일 공유·PC 이동용) ------- */

    /** 전체 컬렉션 이름 배열 (복사본) */
    collections: function () { return COLLECTIONS.slice(); },

    /** 모든 컬렉션 → 백업 객체 (JSON.stringify 대상) */
    exportAll: function () {
      var out = { app: 'hd-portal', version: BACKUP_VERSION, exportedAt: new Date().toISOString(), collections: {} };
      COLLECTIONS.forEach(function (c) { out.collections[c] = adapter.list(c); });
      return out;
    },

    /** 백업 객체 형식/버전 검증. { ok, error? }
     *  구버전 백업(컬렉션이 늘기 전)도 가져올 수 있도록, 새로 추가된 컬렉션이
     *  파일에 아예 없는 것은 허용한다(가져오기 시 빈 배열로 채움) — 형식이 다른 값(배열이 아닌 것)만 오류로 본다. */
    validateBackup: function (data) {
      if (!data || typeof data !== 'object') return { ok: false, error: '백업 파일 형식이 아닙니다.' };
      if (data.app !== 'hd-portal') return { ok: false, error: '이 포털의 백업 파일이 아닙니다.' };
      if (data.version > BACKUP_VERSION) return { ok: false, error: '지원하지 않는(더 최신) 백업 버전입니다: ' + data.version };
      if (!data.collections || typeof data.collections !== 'object') return { ok: false, error: '컬렉션 데이터가 없습니다.' };
      for (var i = 0; i < COLLECTIONS.length; i++) {
        var v = data.collections[COLLECTIONS[i]];
        if (v !== undefined && !Array.isArray(v)) {
          return { ok: false, error: '컬렉션 형식 오류: ' + COLLECTIONS[i] };
        }
      }
      return { ok: true };
    },

    /** 백업 객체로 모든 컬렉션 교체(복원). { ok, error?, counts? } */
    importAll: function (data) {
      var v = this.validateBackup(data);
      if (!v.ok) return v;
      var counts = {};
      COLLECTIONS.forEach(function (c) {
        var list = data.collections[c] || [];
        adapter.replaceAll(c, list);
        counts[c] = list.length;
      });
      // 복원 후 시드가 덮어쓰지 않도록 시드 플래그 기록 (브라우저 환경에서만)
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SEED_FLAG, 'imported:' + new Date().toISOString());
      }
      return { ok: true, counts: counts };
    },

    /* ------- 로그인(데모: 사용자 선택) ------- */
    currentUser: function () {
      var id = localStorage.getItem(PREFIX + 'currentUserId');
      return id ? this.get('users', id) : null;
    },
    setCurrentUser: function (id) {
      localStorage.setItem(PREFIX + 'currentUserId', id || '');
    },

    /* ------- 시드 주입 ------- */
    seedIfEmpty: function (seed) {
      if (localStorage.getItem(SEED_FLAG)) return false;
      var self = this;
      Object.keys(seed).forEach(function (collection) {
        self.replaceAll(collection, seed[collection]);
      });
      localStorage.setItem(SEED_FLAG, new Date().toISOString());
      return true;
    },

    /** 데모 데이터 초기화(시드 재주입) */
    resetToSeed: function (seed) {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(PREFIX) === 0) keys.push(k);
      }
      keys.forEach(function (k) { localStorage.removeItem(k); });
      return this.seedIfEmpty(seed);
    }
  };

  root.Store = Store;
  root.GoogleSheetsAdapter = GoogleSheetsAdapter;
  // Node 테스트용 (test/logic.test.js에서 백업 왕복 테스트)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Store: Store, GoogleSheetsAdapter: GoogleSheetsAdapter };
  }
})(typeof self !== 'undefined' ? self : this);
