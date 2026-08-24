/**
 * 팀 공용 저장 어댑터 — Store.use() 로 갈아 끼운다.
 *
 * 이 포털의 문제는 하나였다. 주간업무·환율·출장일정을 각자 브라우저에 담으니
 * **서로 보이지 않았다.** README 도 "내보내기 → 메일로 공유 → 각자 가져오기"를 권했는데,
 * 그건 자동화가 아니라 사람이 파일을 나르는 것이다.
 *
 * 여기서는 모든 컬렉션을 문서 하나에 담아 서버에 두고 팀원이 같은 것을 본다.
 * 팀 내부 도구라 서로 다 보는 것이 정상이므로 이 방식이 목적에 맞는다.
 * (사람마다 볼 범위가 달라야 하는 화면이면 이 방식을 쓰면 안 된다 — hd-docsync.js 주석 참조)
 *
 * 기존 LocalStorageAdapter 와 **같은 모양**이라 화면 코드는 바뀐 것을 모른다.
 */
(function (root) {
  'use strict';

  function SupabaseDocAdapter(initialDoc) {
    // 컬렉션을 메모리에 올려 두고 동기 함수로 답한다.
    // 화면 계산이 전부 동기라 이 방식이 코드가 훨씬 단순하다.
    var doc = initialDoc && typeof initialDoc === 'object' ? initialDoc : {};

    function read(c) {
      return Array.isArray(doc[c]) ? doc[c] : [];
    }
    function write(c, list) {
      doc[c] = list;
      // 짧은 시간에 여러 번 고쳐도 마지막 것 한 번만 보낸다.
      root.HDDoc.save(doc);
    }

    return {
      name: 'supabase(팀 공용)',

      list: function (c) { return read(c); },

      save: function (c, record) {
        var list = read(c).slice();
        if (!record.id) {
          record.id = c.slice(0, 2) + Date.now() + Math.floor(Math.random() * 1000);
        }
        var idx = -1;
        for (var i = 0; i < list.length; i++) {
          if (list[i].id === record.id) { idx = i; break; }
        }
        if (idx >= 0) list[idx] = record; else list.push(record);
        write(c, list);
        return record;
      },

      remove: function (c, id) {
        var list = read(c).filter(function (r) { return r.id !== id; });
        write(c, list);
      },

      replaceAll: function (c, list) {
        write(c, Array.isArray(list) ? list.slice() : []);
      },

      /** 백업 가져오기처럼 여러 컬렉션을 한 번에 바꿀 때 — 저장을 한 번만 보낸다 */
      replaceMany: function (map) {
        Object.keys(map || {}).forEach(function (c) {
          doc[c] = Array.isArray(map[c]) ? map[c].slice() : [];
        });
        root.HDDoc.save(doc);
      },

      /** 지금 문서 전체 (씨앗으로 올릴 때 쓴다) */
      _doc: function () { return doc; }
    };
  }

  root.SupabaseDocAdapter = SupabaseDocAdapter;
})(typeof self !== 'undefined' ? self : this);
