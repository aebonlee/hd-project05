/**
 * 서버 모드 통합 테스트 — 실행: scripts/sqltest/run-server-test.sh
 *
 * 이 포털은 **팀이 같은 자료를 보는 것**이 목적이다.
 * 자료 한 뭉치(workspace)를 서버에 두고 팀원이 같은 것을 본다.
 * 여기서 확인할 것은 두 가지다.
 *   ① 한 사람이 저장한 것이 다른 사람에게 보이는가
 *   ② 두 사람이 동시에 고쳤을 때 **한쪽 작업이 조용히 사라지지 않는가**
 * ②가 이 방식의 유일한 위험이고, 버전 검사가 그것을 눈에 보이게 만든다.
 */
"use strict";
const assert = require("assert");
const path = require("path");
const vm = require("vm");
const fs = require("fs");
const { makeClient, query } = require("./fake-supabase.js");

const root = path.join(__dirname, "..");

/** 브라우저 하나를 흉내 낸다 — 각자 자기 HDDoc 과 어댑터를 갖는다 */
function browser() {
  const box = { self: null, window: null, console,
    APP_CONFIG: { USE_SUPABASE: true, SUPABASE_URL: "http://local", SUPABASE_ANON_KEY: "local" },
    supabase: { createClient: makeClient },
    document: null, addEventListener() {}, alert() {},
    // hd-docsync 는 저장을 모아 보내려고 setTimeout 을 쓴다. vm 에는 없으므로 넘겨 준다.
    setTimeout, clearTimeout };
  box.self = box; box.window = box;
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(root, "js/hd-docsync.js"), "utf8"), box);
  vm.runInContext(fs.readFileSync(path.join(root, "js/supabase-adapter.js"), "utf8"), box);
  return box;
}

const boot = (b, initial) => new Promise((res, rej) => {
  b.HDDoc.boot({ id: "portal", initial: initial || {},
    onReady: (doc) => res(doc), onFallback: (e) => rej(e || new Error("데모로 내려갔다")) });
});
const one = (q) => (query(q).data || [])[0];

let passed = 0, failed = 0;
const tests = [];
const test = (n, f) => tests.push({ name: n, fn: f });
const notes = [];

test("아무도 안 올렸으면 지금 브라우저의 자료를 씨앗으로 올린다", async () => {
  const A = browser();
  const doc = await boot(A, { weekly: [{ id: "w1", title: "주간업무" }] });
  assert.deepStrictEqual(Object.keys(doc), ["weekly"]);
  const r = one("select version, doc from public.workspace where id='portal'");
  assert.strictEqual(Number(r.version), 1);
  assert.strictEqual(r.doc.weekly.length, 1, "씨앗이 안 올라갔다");
});

test("다른 팀원이 열면 같은 자료를 본다", async () => {
  const B = browser();
  const doc = await boot(B);
  assert.ok(doc.weekly && doc.weekly.length === 1, "팀원에게 안 보인다");
  assert.strictEqual(doc.weekly[0].title, "주간업무");
});

test("한 사람이 저장하면 서버 버전이 올라간다", async () => {
  const A = browser();
  const doc = await boot(A);
  const S = A.SupabaseDocAdapter(doc);
  S.save("weekly", { id: "w2", title: "환율 정리" });
  await A.HDDoc.flush();
  const r = one("select version, doc from public.workspace where id='portal'");
  assert.strictEqual(Number(r.version), 2, "버전이 안 올라갔다");
  assert.strictEqual(r.doc.weekly.length, 2);
});

test("동시에 고치면 나중 사람의 저장을 막고 알린다 (작업이 조용히 사라지지 않는다)", async () => {
  const A = browser(), B = browser();
  const docA = await boot(A);       // 둘 다 같은 버전을 받아 간다
  const docB = await boot(B);

  let told = null;
  B.HDDoc.onNotify((m) => { told = m; });

  // A 가 먼저 저장 → 서버 버전이 올라간다
  A.SupabaseDocAdapter(docA).save("trip", { id: "t1", title: "인도 출장" });
  await A.HDDoc.flush();

  // B 는 옛 버전을 들고 저장 → 막혀야 한다
  B.SupabaseDocAdapter(docB).save("trip", { id: "t2", title: "브라질 출장" });
  await B.HDDoc.flush();

  assert.ok(told, "막혔는데 아무 말도 안 했다 — 사용자는 저장된 줄 안다");
  assert.ok(/먼저 저장/.test(told), "안내 문구가 이유를 말하지 않는다: " + told);

  const r = one("select doc from public.workspace where id='portal'");
  const trips = r.doc.trip || [];
  assert.strictEqual(trips.length, 1, "덮어써서 A 의 작업이 사라졌다");
  assert.strictEqual(trips[0].title, "인도 출장", "먼저 저장한 쪽이 남아야 한다");
});

test("막힌 뒤 새로고침하면 최신을 받아 이어서 쓸 수 있다", async () => {
  const B = browser();
  const doc = await boot(B);        // 다시 받아 온다
  assert.strictEqual((doc.trip || []).length, 1, "최신을 못 받았다");
  B.SupabaseDocAdapter(doc).save("trip", { id: "t2", title: "브라질 출장" });
  await B.HDDoc.flush();
  const r = one("select doc from public.workspace where id='portal'");
  assert.strictEqual(r.doc.trip.length, 2, "이어서 저장이 안 됐다");
});

test("여러 컬렉션을 한 번에 바꿔도 저장은 한 번만 나간다", async () => {
  const A = browser();
  const doc = await boot(A);
  const before = Number(one("select version from public.workspace where id='portal'").version);
  A.SupabaseDocAdapter(doc).replaceMany({ dealer: [{ id: "d1" }], fx_rate: [{ id: "f1" }] });
  await A.HDDoc.flush();
  const after = Number(one("select version from public.workspace where id='portal'").version);
  assert.strictEqual(after, before + 1, "저장이 여러 번 나갔다 (" + before + "→" + after + ")");
});

(async () => {
  for (const t of tests) {
    try { await t.fn(); passed++; console.log("  ✔ " + t.name); }
    catch (e) { failed++; console.error("  ✘ " + t.name); console.error("    " + (e && e.message)); }
  }
  console.log("\n결과: " + passed + " 통과, " + failed + " 실패");
  if (failed > 0) process.exit(1);
})();
