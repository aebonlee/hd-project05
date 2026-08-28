/**
 * app.js — 화면 로직 (뷰 전환, 각 기능 렌더링)
 * 데이터 접근은 전부 Store(js/store.js), 순수 계산은 Logic(js/logic.js) 사용.
 */
(function () {
  'use strict';

  var L = window.Logic;
  var S = window.Store;

  /* ================= 공통 유틸 ================= */

  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function userName(id) {
    var u = S.get('users', id);
    return u ? u.name : '(알 수 없음)';
  }

  var MEMBER_COLORS = ['#2f6fb7', '#1e8e5a', '#b7791f', '#7048ad', '#c0392b', '#0f7f8b'];
  function memberColor(memberId) {
    var users = S.list('users');
    var idx = users.findIndex(function (u) { return u.id === memberId; });
    return MEMBER_COLORS[(idx >= 0 ? idx : 0) % MEMBER_COLORS.length];
  }

  /* ================= 로그인(데모: 사용자 선택) ================= */

  function initUserSelect() {
    var sel = $('#userSelect');
    sel.innerHTML = '';
    S.list('users').forEach(function (u) {
      sel.appendChild(el('option', { value: u.id, text: u.name + (u.role === '책임자' ? ' (책임자)' : '') }));
    });
    var cur = S.currentUser();
    if (!cur) { S.setCurrentUser(S.list('users')[0].id); cur = S.currentUser(); }
    sel.value = cur.id;
    updateRoleBadge();
    sel.addEventListener('change', function () {
      S.setCurrentUser(sel.value);
      updateRoleBadge();
      renderWeekly();
      renderFxView();
      toast(userName(sel.value) + ' 계정으로 전환했습니다.');
    });
  }

  function updateRoleBadge() {
    var u = S.currentUser();
    $('#userRole').textContent = u ? u.role : '';
    var wf = $('#wfAuthor');
    if (wf && u) wf.value = u.name;
  }

  /* ================= 네비게이션 ================= */

  var VIEWS = ['weekly', 'receivable', 'trips', 'meetings', 'fx', 'sales', 'dealers', 'prices'];

  function currentView() {
    var h = (location.hash || '#/weekly').replace('#/', '');
    return VIEWS.indexOf(h) >= 0 ? h : 'weekly';
  }

  function showView(name) {
    VIEWS.forEach(function (v) {
      var sec = $('#view-' + v);
      if (sec) sec.hidden = v !== name;
    });
    $all('.nav-item').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-view') === name);
    });
    $('#sideNav').classList.remove('open');
    // 뷰별 렌더
    if (name === 'weekly') renderWeekly();
    if (name === 'receivable') renderReceivable();
    if (name === 'trips') { renderCalendar(); renderTripList(); }
    if (name === 'meetings') renderMeetings();
    if (name === 'fx') renderFxView();
    if (name === 'sales') { renderSales(); renderSapCharts(); }
    if (name === 'dealers') renderDealers();
    if (name === 'prices') renderPrices();
  }

  /* ================= B-1 주간업무 ================= */

  var weeklyEditingId = null;
  var weeklyMonthFilter = ''; // '' = 전체, 'YYYY-MM' = 그 달만 (월별 탭)

  function initWeekly() {
    $('#wfWeek').value = L.weekLabel(new Date());
    $('#notifyWeek').value = L.weekLabel(new Date());
    initNotifyMini();

    $('#weeklyForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var user = S.currentUser();
      var rec = weeklyEditingId ? S.get('weeklyReports', weeklyEditingId) : null;
      if (weeklyEditingId && rec && !L.canEdit(user, rec)) {
        toast('본인 작성분만 수정할 수 있습니다. (책임자는 전체 수정 가능)');
        return;
      }
      var record = {
        id: weeklyEditingId || undefined,
        week: $('#wfWeek').value,
        authorId: rec ? rec.authorId : user.id,
        region: $('#wfRegion').value,
        tasks: $('#wfTasks').value.trim(),
        sales: Number($('#wfSales').value) || 0,
        issues: $('#wfIssues').value.trim(),
        nextPlan: $('#wfNext').value.trim(),
        createdAt: rec ? rec.createdAt : todayStr()
      };
      S.save('weeklyReports', record);
      toast(weeklyEditingId ? '주간업무를 수정했습니다.' : '주간업무를 저장했습니다.');
      cancelWeeklyEdit();
      renderWeekly();
    });

    $('#wfCancelBtn').addEventListener('click', cancelWeeklyEdit);
    $('#weeklyFilterWeek').addEventListener('change', renderWeeklyTable);
    $('#weeklyFilterAuthor').addEventListener('change', renderWeeklyTable);

    // 알림 발송
    $('#recipientAddBtn').addEventListener('click', addRecipient);
    $('#recipientInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addRecipient(); }
    });
    $('#notifySendBtn').addEventListener('click', sendNotification);
  }

  function cancelWeeklyEdit() {
    weeklyEditingId = null;
    $('#weeklyForm').reset();
    $('#wfWeek').value = L.weekLabel(new Date());
    $('#wfAuthor').value = S.currentUser() ? S.currentUser().name : '';
    $('#weeklyFormTitle').textContent = '주간업무 작성';
    $('#wfSubmitBtn').textContent = '저장';
    $('#wfCancelBtn').hidden = true;
  }

  function startWeeklyEdit(rec) {
    weeklyEditingId = rec.id;
    $('#wfWeek').value = rec.week;
    $('#wfRegion').value = rec.region;
    $('#wfTasks').value = rec.tasks;
    $('#wfSales').value = rec.sales;
    $('#wfIssues').value = rec.issues || '';
    $('#wfNext').value = rec.nextPlan;
    $('#wfAuthor').value = userName(rec.authorId);
    $('#weeklyFormTitle').textContent = '주간업무 수정';
    $('#wfSubmitBtn').textContent = '수정 저장';
    $('#wfCancelBtn').hidden = false;
    $('#weeklyForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderWeekly() {
    updateRoleBadge();
    // 필터 옵션 갱신
    var reports = S.list('weeklyReports');
    var weeks = Array.from(new Set(reports.map(function (r) { return r.week; }))).sort().reverse();
    var fw = $('#weeklyFilterWeek'), fa = $('#weeklyFilterAuthor');
    var fwVal = fw.value, faVal = fa.value;
    fw.innerHTML = '<option value="">전체 주차</option>';
    weeks.forEach(function (w) { fw.appendChild(el('option', { value: w, text: w })); });
    fa.innerHTML = '<option value="">전체 작성자</option>';
    S.list('users').forEach(function (u) { fa.appendChild(el('option', { value: u.id, text: u.name })); });
    fw.value = fwVal; fa.value = faVal;
    renderWeeklyMonthTabs(reports);
    renderWeeklyTable();
    renderRecipients();
    renderNotifyLog();
  }

  /** 월별 탭 — 그 달의 주간업무만 모아 본다 (슬라이드1) */
  function renderWeeklyMonthTabs(reports) {
    var box = $('#weeklyMonthTabs');
    if (!box) return;
    var months = Array.from(new Set(reports.map(function (r) { return L.weekToMonth(r.week); }).filter(Boolean))).sort().reverse();
    if (weeklyMonthFilter && months.indexOf(weeklyMonthFilter) === -1) weeklyMonthFilter = '';
    box.innerHTML = '';
    box.appendChild(el('button', {
      class: 'month-tab' + (weeklyMonthFilter === '' ? ' active' : ''), text: '전체',
      onclick: function () { weeklyMonthFilter = ''; renderWeeklyMonthTabs(S.list('weeklyReports')); renderWeeklyTable(); }
    }));
    months.forEach(function (m) {
      box.appendChild(el('button', {
        class: 'month-tab' + (weeklyMonthFilter === m ? ' active' : ''), text: m,
        onclick: function () { weeklyMonthFilter = m; renderWeeklyMonthTabs(S.list('weeklyReports')); renderWeeklyTable(); }
      }));
    });
  }

  function renderWeeklyTable() {
    var user = S.currentUser();
    var fw = $('#weeklyFilterWeek').value, fa = $('#weeklyFilterAuthor').value;
    var list = S.list('weeklyReports')
      .filter(function (r) { return (!fw || r.week === fw) && (!fa || r.authorId === fa) && (!weeklyMonthFilter || L.weekToMonth(r.week) === weeklyMonthFilter); })
      .sort(function (a, b) { return a.week < b.week ? 1 : a.week > b.week ? -1 : a.region.localeCompare(b.region); });
    var tbody = $('#weeklyTable tbody');
    tbody.innerHTML = '';
    list.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', { text: r.week }));
      tr.appendChild(el('td', { text: r.region }));
      var authorTd = el('td', { text: userName(r.authorId) });
      if (user && r.authorId === user.id) authorTd.appendChild(el('span', { class: 'badge-mine', text: '내 작성' }));
      tr.appendChild(authorTd);
      tr.appendChild(el('td', { class: 'wrap-cell', text: r.tasks }));
      tr.appendChild(el('td', { class: 'num', text: L.fmt(r.sales) }));
      tr.appendChild(el('td', { class: 'wrap-cell', text: r.issues || '-' }));
      tr.appendChild(el('td', { class: 'wrap-cell', text: r.nextPlan }));
      var actions = el('td');
      if (L.canEdit(user, r)) {
        var box = el('div', { class: 'row-actions' });
        box.appendChild(el('button', { class: 'link-btn', text: '수정', onclick: function () { startWeeklyEdit(r); } }));
        box.appendChild(el('button', {
          class: 'link-btn danger', text: '삭제',
          onclick: function () {
            if (confirm(r.week + ' ' + r.region + ' 주간업무를 삭제할까요?')) {
              S.remove('weeklyReports', r.id);
              renderWeekly();
              toast('삭제했습니다.');
            }
          }
        }));
        actions.appendChild(box);
      }
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    if (!list.length) {
      tbody.appendChild(el('tr', {}, [el('td', { colspan: '8', text: '조건에 맞는 주간업무가 없습니다.' })]));
    }
  }

  /* ------- 알림 발송 (수신자/로그/mailto) ------- */

  function getRecipients() { return S.list('notifyRecipients'); }

  function renderRecipients() {
    var ul = $('#recipientList');
    ul.innerHTML = '';
    getRecipients().forEach(function (email, idx) {
      var li = el('li', { text: email });
      li.appendChild(el('button', {
        'aria-label': email + ' 삭제', text: '✕',
        onclick: function () {
          var list = getRecipients();
          list.splice(idx, 1);
          S.replaceAll('notifyRecipients', list);
          renderRecipients();
        }
      }));
      ul.appendChild(li);
    });
  }

  function addRecipient() {
    var input = $('#recipientInput');
    var email = input.value.trim();
    if (!L.isEmail(email)) { toast('올바른 이메일 주소를 입력하세요.'); return; }
    var list = getRecipients();
    if (list.indexOf(email) >= 0) { toast('이미 등록된 수신자입니다.'); return; }
    list.push(email);
    S.replaceAll('notifyRecipients', list);
    input.value = '';
    renderRecipients();
    toast('수신자를 추가했습니다.');
  }

  function buildNotifyMail(week) {
    var reports = S.list('weeklyReports').filter(function (r) { return r.week === week; });
    var subject = '[해외영업팀] ' + week + ' 주간업무 공지';
    var lines = ['해외영업팀 ' + week + ' 주간업무 공지입니다.', ''];
    reports.forEach(function (r) {
      lines.push('■ ' + r.region + ' (' + userName(r.authorId) + ')');
      lines.push('- 주요 업무: ' + r.tasks);
      lines.push('- 주간 매출: ' + L.fmt(r.sales) + ' (USD 천불)');
      if (r.issues) lines.push('- 이슈: ' + r.issues);
      lines.push('- 다음주 계획: ' + r.nextPlan);
      lines.push('');
    });
    lines.push('※ 자세한 내용은 팀 업무 포털에서 확인해 주세요.');
    return { subject: subject, body: lines.join('\n'), count: reports.length };
  }

  function sendNotification() {
    var week = $('#notifyWeek').value;
    if (!week) { toast('발송할 주차를 선택하세요.'); return; }
    var recipients = getRecipients();
    if (!recipients.length) { toast('수신자를 1명 이상 등록하세요.'); return; }
    var mail = buildNotifyMail(week);
    if (!mail.count) { toast(week + ' 주차에 작성된 주간업무가 없습니다.'); return; }
    var user = S.currentUser();
    var log = {
      week: week,
      sentAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      sentBy: user ? user.name : '-',
      recipients: recipients.slice(),
      mailto: L.buildMailto(recipients, mail.subject, mail.body)
    };
    S.save('notifyLog', log);
    renderNotifyLog();
    toast(recipients.length + '명에게 알림 발송 처리했습니다. 메일 초안이 열립니다.');
    // 메일 초안(mailto) 열기 — 실제 자동 발송은 어댑터(README의 Apps Script MailApp) 연동으로 대체
    var a = el('a', { href: log.mailto });
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /** 사이드바 미니 알림 위젯 — "매주 월요일 14시 클릭 한 번" 요청(슬라이드1)을
   *  실제 예약 발송(백엔드 없음)이 아니라, 다음 발송 시각을 보여주고 원클릭으로
   *  이번 주차 알림을 보내는 형태로 구현했다. */
  function nextMonday14() {
    var now = new Date();
    var d = new Date(now);
    var day = d.getDay(); // 0=일 ... 1=월
    var diff = (8 - day) % 7; // 다음 월요일까지 일수 (오늘이 월요일이면 7일 뒤 다음주)
    if (day === 1 && now.getHours() < 14) diff = 0; // 오늘이 월요일이고 아직 14시 전이면 오늘
    d.setDate(now.getDate() + diff);
    d.setHours(14, 0, 0, 0);
    return d;
  }

  function initNotifyMini() {
    var when = nextMonday14();
    var label = (when.getMonth() + 1) + '/' + when.getDate() + '(월) 14:00';
    var el2 = $('#notifyMiniWhen');
    if (el2) el2.textContent = label;
    var btn = $('#notifyMiniBtn');
    if (btn) btn.addEventListener('click', function () {
      $('#notifyWeek').value = L.weekLabel(new Date());
      sendNotification();
    });
  }

  function renderNotifyLog() {
    var tbody = $('#notifyLogTable tbody');
    tbody.innerHTML = '';
    var logs = S.list('notifyLog').slice().reverse();
    logs.forEach(function (g) {
      var tr = el('tr');
      tr.appendChild(el('td', { text: g.sentAt }));
      tr.appendChild(el('td', { text: g.week }));
      tr.appendChild(el('td', { text: g.sentBy }));
      tr.appendChild(el('td', { class: 'num', text: String(g.recipients.length) }));
      var td = el('td');
      td.appendChild(el('a', { class: 'link-btn', href: g.mailto, text: '메일 초안 열기' }));
      tr.appendChild(td);
      tbody.appendChild(tr);
    });
    if (!logs.length) tbody.appendChild(el('tr', {}, [el('td', { colspan: '5', text: '발송 이력이 없습니다.' })]));
  }

  /* ================= B-2 경과채권 바로가기 ================= */

  function isWebUrl(path) { return /^https?:\/\//i.test(path); }

  function initReceivable() {
    $('#rlAddBtn').addEventListener('click', function () {
      $('#rlFormCard').hidden = false;
      $('#rlFormTitle').textContent = '링크 등록';
      $('#rlId').value = '';
      $('#rlForm').reset();
      $('#rlTarget').focus();
    });
    $('#rlCancelBtn').addEventListener('click', function () { $('#rlFormCard').hidden = true; });
    $('#rlForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var record = {
        id: $('#rlId').value || undefined,
        target: $('#rlTarget').value.trim(),
        fileName: $('#rlFileName').value.trim(),
        path: $('#rlPath').value.trim(),
        updatedAt: todayStr()
      };
      S.save('receivableLinks', record);
      $('#rlFormCard').hidden = true;
      renderReceivable();
      toast('링크를 저장했습니다.');
    });
    $('#receivableUpload').addEventListener('change', handleReceivableUpload);
  }

  /* ---- 경과채권 엑셀 업로드 (슬라이드2) ---- */

  var RECEIVABLE_HEADER_MAP = {
    'dealer code': 'dealerCode', 'dealer_code': 'dealerCode', 'dealercode': 'dealerCode',
    'dealer name': 'dealerName', 'dealer_name': 'dealerName', 'dealername': 'dealerName',
    'od': 'od', '담당자': 'manager', 'manager': 'manager'
  };

  function handleReceivableUpload(e) {
    var file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    var status = $('#receivableUploadStatus');
    status.textContent = '"' + file.name + '" 읽는 중…';
    var reader = new FileReader();
    reader.onload = function (ev) {
      try {
        var wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var raw = XLSX.utils.sheet_to_json(ws, { defval: '', header: 1 });
        if (!raw.length) { status.textContent = '업로드 실패 — 빈 파일입니다.'; return; }
        var headerRow = raw[0].map(function (h) { return String(h).trim().toLowerCase(); });
        var known = headerRow.some(function (h) { return RECEIVABLE_HEADER_MAP[h]; });
        var rows = [];
        for (var i = 1; i < raw.length; i++) {
          var line = raw[i];
          if (!line || !line.length || line.every(function (c) { return c === ''; })) continue;
          var rec = {};
          if (known) {
            headerRow.forEach(function (h, idx) {
              var key = RECEIVABLE_HEADER_MAP[h];
              if (key) rec[key] = line[idx];
            });
          } else {
            // 헤더가 다르면 열 순서(Dealer code, Dealer Name, OD, 담당자)로 인식
            rec = { dealerCode: line[0], dealerName: line[1], od: line[2], manager: line[3] };
          }
          if (!String(rec.dealerCode || '').trim()) continue;
          var existing = S.list('receivableRows').find(function (r) { return r.dealerCode === String(rec.dealerCode).trim(); });
          rows.push({
            id: existing ? existing.id : undefined,
            dealerCode: String(rec.dealerCode).trim(),
            dealerName: String(rec.dealerName || '').trim(),
            od: rec.od,
            manager: String(rec.manager || '').trim(),
            delayReason: existing ? existing.delayReason : '',
            resolution: existing ? existing.resolution : '',
            uploadedAt: todayStr()
          });
        }
        if (!rows.length) { status.textContent = '업로드 실패 — 유효한 행이 없습니다. 열 이름(Dealer code, Dealer Name, OD, 담당자)을 확인하세요.'; return; }
        rows.forEach(function (r) { S.save('receivableRows', r); });
        status.textContent = rows.length + '건 반영했습니다. (' + todayStr() + ')';
        renderReceivableRows();
      } catch (err) {
        status.textContent = '엑셀을 읽는 중 오류가 발생했습니다: ' + err.message;
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function renderReceivableRows() {
    var tbody = $('#receivableRowsTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    var assigneeNames = (window.ASSIGNEES || []).map(function (a) { return a.name; });
    S.list('receivableRows').forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', { text: r.dealerCode }));
      tr.appendChild(el('td', { class: 'wrap-cell', text: r.dealerName }));
      tr.appendChild(el('td', { class: 'num', text: String(r.od) }));

      var managerTd = el('td');
      var managerSel = el('select');
      managerSel.appendChild(el('option', { value: '', text: '(미지정)' }));
      assigneeNames.forEach(function (n) { managerSel.appendChild(el('option', { value: n, text: n })); });
      managerSel.value = assigneeNames.indexOf(r.manager) >= 0 ? r.manager : '';
      managerSel.addEventListener('change', function () {
        r.manager = managerSel.value;
        S.save('receivableRows', r);
      });
      managerTd.appendChild(managerSel);
      tr.appendChild(managerTd);

      var reasonTd = el('td');
      var reasonInput = el('input', { type: 'text', value: r.delayReason || '', placeholder: '지연 사유' });
      reasonInput.addEventListener('change', function () { r.delayReason = reasonInput.value; S.save('receivableRows', r); });
      reasonTd.appendChild(reasonInput);
      tr.appendChild(reasonTd);

      var resTd = el('td');
      var resInput = el('input', { type: 'text', value: r.resolution || '', placeholder: '해결 방법' });
      resInput.addEventListener('change', function () { r.resolution = resInput.value; S.save('receivableRows', r); });
      resTd.appendChild(resInput);
      tr.appendChild(resTd);

      var act = el('td');
      act.appendChild(el('button', {
        class: 'link-btn danger', text: '삭제',
        onclick: function () {
          if (confirm(r.dealerCode + ' 행을 삭제할까요?')) { S.remove('receivableRows', r.id); renderReceivableRows(); }
        }
      }));
      tr.appendChild(act);
      tbody.appendChild(tr);
    });
    if (!S.list('receivableRows').length) {
      tbody.appendChild(el('tr', {}, [el('td', { colspan: '7', text: '업로드된 경과채권이 없습니다.' })]));
    }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast('경로를 복사했습니다. 탐색기 주소창에 붙여넣으세요.');
      }, function () { fallbackCopy(text); });
    } else fallbackCopy(text);
  }

  function fallbackCopy(text) {
    var ta = el('textarea', { text: text });
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('경로를 복사했습니다.'); }
    catch (e) { prompt('아래 경로를 직접 복사하세요.', text); }
    ta.remove();
  }

  function renderReceivable() {
    renderReceivableRows();
    var tbody = $('#rlTable tbody');
    tbody.innerHTML = '';
    S.list('receivableLinks').forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', { text: r.target }));
      tr.appendChild(el('td', { class: 'wrap-cell', text: r.fileName }));
      tr.appendChild(el('td', { class: 'wrap-cell', text: r.path }));
      tr.appendChild(el('td', { text: r.updatedAt }));
      var act = el('td');
      if (isWebUrl(r.path)) {
        act.appendChild(el('a', { class: 'btn btn-primary btn-sm', href: r.path, target: '_blank', rel: 'noopener', text: '새 탭 열기' }));
      } else {
        act.appendChild(el('button', { class: 'btn btn-ghost btn-sm', text: '경로 복사', onclick: function () { copyText(r.path); } }));
      }
      tr.appendChild(act);
      var manage = el('td');
      var box = el('div', { class: 'row-actions' });
      box.appendChild(el('button', {
        class: 'link-btn', text: '수정',
        onclick: function () {
          $('#rlFormCard').hidden = false;
          $('#rlFormTitle').textContent = '링크 수정';
          $('#rlId').value = r.id;
          $('#rlTarget').value = r.target;
          $('#rlFileName').value = r.fileName;
          $('#rlPath').value = r.path;
          $('#rlFormCard').scrollIntoView({ behavior: 'smooth' });
        }
      }));
      box.appendChild(el('button', {
        class: 'link-btn danger', text: '삭제',
        onclick: function () {
          if (confirm('"' + r.fileName + '" 링크를 삭제할까요?')) {
            S.remove('receivableLinks', r.id);
            renderReceivable();
            toast('삭제했습니다.');
          }
        }
      }));
      manage.appendChild(box);
      tr.appendChild(manage);
      tbody.appendChild(tr);
    });
  }

  /* ================= B-5 출장 + B-6 회의 캘린더 ================= */

  var calYear, calMonth; // 0-based month
  var tripEditingId = null;

  function initCalendar() {
    var now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
    $('#calPrevBtn').addEventListener('click', function () { shiftCal(-1); });
    $('#calNextBtn').addEventListener('click', function () { shiftCal(1); });
    $('#calTodayBtn').addEventListener('click', function () {
      var n = new Date(); calYear = n.getFullYear(); calMonth = n.getMonth(); renderCalendar();
    });

    var sel = $('#tfMember');
    sel.innerHTML = '';
    S.list('users').forEach(function (u) { sel.appendChild(el('option', { value: u.id, text: u.name })); });

    $('#tripForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var start = $('#tfStart').value, end = $('#tfEnd').value;
      if (end < start) { toast('종료일이 시작일보다 빠릅니다.'); return; }
      S.save('trips', {
        id: tripEditingId || undefined,
        memberId: $('#tfMember').value,
        countryCity: $('#tfCity').value.trim(),
        startDate: start,
        endDate: end,
        purpose: $('#tfPurpose').value.trim(),
        dealers: $('#tfDealers').value.trim()
      });
      toast(tripEditingId ? '출장 일정을 수정했습니다.' : '출장 일정을 등록했습니다.');
      cancelTripEdit();
      renderCalendar();
      renderTripList();
    });
    $('#tfCancelBtn').addEventListener('click', cancelTripEdit);
  }

  function cancelTripEdit() {
    tripEditingId = null;
    $('#tripForm').reset();
    $('#tripFormTitle').textContent = '출장 등록';
    $('#tfCancelBtn').hidden = true;
  }

  function shiftCal(n) {
    calMonth += n;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function dstr(y, m, d) { return y + '-' + pad2(m + 1) + '-' + pad2(d); }

  function renderCalendar() {
    $('#calTitle').textContent = calYear + '년 ' + (calMonth + 1) + '월';
    var cal = $('#calendar');
    cal.innerHTML = '';
    ['일', '월', '화', '수', '목', '금', '토'].forEach(function (d) {
      cal.appendChild(el('div', { class: 'cal-dow', text: d }));
    });

    var first = new Date(calYear, calMonth, 1);
    var startOffset = first.getDay(); // 일요일 시작
    var daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    var prevDays = new Date(calYear, calMonth, 0).getDate();
    var today = todayStr();

    var trips = S.list('trips');
    var meetings = S.list('meetings');

    var totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
    for (var i = 0; i < totalCells; i++) {
      var dayNum, y = calYear, m = calMonth, other = false;
      if (i < startOffset) { dayNum = prevDays - startOffset + 1 + i; m = calMonth - 1; other = true; }
      else if (i >= startOffset + daysInMonth) { dayNum = i - startOffset - daysInMonth + 1; m = calMonth + 1; other = true; }
      else dayNum = i - startOffset + 1;
      if (m < 0) { m = 11; y--; }
      if (m > 11) { m = 0; y++; }
      var ds = dstr(y, m, dayNum);

      var cell = el('div', { class: 'cal-cell' + (other ? ' other' : '') + (ds === today ? ' today' : '') + (i % 7 === 0 ? ' sun' : '') });
      cell.appendChild(el('div', { class: 'cal-date', text: String(dayNum) }));

      if (!other) {
        trips.forEach(function (t) {
          if (t.startDate <= ds && ds <= t.endDate) {
            var isStart = t.startDate === ds || dayNum === 1;
            cell.appendChild(el('span', {
              class: 'cal-evt',
              style: 'background:' + memberColor(t.memberId),
              title: userName(t.memberId) + ' · ' + t.countryCity + ' (' + t.startDate + '~' + t.endDate + ') ' + t.purpose,
              text: isStart ? userName(t.memberId) + ' ' + t.countryCity : userName(t.memberId)
            }));
          }
        });
        meetings.forEach(function (mt) {
          if (mt.datetime.slice(0, 10) === ds) {
            cell.appendChild(el('span', {
              class: 'cal-evt meeting',
              title: '팀회의 ' + mt.datetime.slice(11, 16) + ' · ' + mt.agenda,
              text: '회의 ' + mt.datetime.slice(11, 16)
            }));
          }
        });
      }
      cal.appendChild(cell);
    }

    // 범례
    var legend = $('#calLegend');
    legend.innerHTML = '';
    S.list('users').forEach(function (u) {
      var item = el('span');
      item.appendChild(el('span', { class: 'dot', style: 'background:' + memberColor(u.id) }));
      item.appendChild(document.createTextNode(u.name));
      legend.appendChild(item);
    });
    var mItem = el('span');
    mItem.appendChild(el('span', { class: 'dot', style: 'background:#f0f3f8;border:1px dashed #1f3a5f' }));
    mItem.appendChild(document.createTextNode('팀회의'));
    legend.appendChild(mItem);
  }

  function renderTripList() {
    var tbody = $('#tripTable tbody');
    tbody.innerHTML = '';
    S.list('trips')
      .slice()
      .sort(function (a, b) { return a.startDate < b.startDate ? -1 : 1; })
      .forEach(function (t) {
        var tr = el('tr');
        var nameTd = el('td');
        nameTd.appendChild(el('span', { class: 'dot', style: 'display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:5px;background:' + memberColor(t.memberId) }));
        nameTd.appendChild(document.createTextNode(userName(t.memberId)));
        tr.appendChild(nameTd);
        tr.appendChild(el('td', { text: t.countryCity }));
        tr.appendChild(el('td', { text: t.startDate + ' ~ ' + t.endDate }));
        tr.appendChild(el('td', { class: 'wrap-cell', text: t.purpose }));
        tr.appendChild(el('td', { text: t.dealers || '-' }));
        var act = el('td');
        var box = el('div', { class: 'row-actions' });
        box.appendChild(el('button', {
          class: 'link-btn', text: '수정',
          onclick: function () {
            tripEditingId = t.id;
            $('#tfMember').value = t.memberId;
            $('#tfCity').value = t.countryCity;
            $('#tfStart').value = t.startDate;
            $('#tfEnd').value = t.endDate;
            $('#tfPurpose').value = t.purpose;
            $('#tfDealers').value = t.dealers || '';
            $('#tripFormTitle').textContent = '출장 수정';
            $('#tfCancelBtn').hidden = false;
            $('#tripForm').scrollIntoView({ behavior: 'smooth' });
          }
        }));
        box.appendChild(el('button', {
          class: 'link-btn danger', text: '삭제',
          onclick: function () {
            if (confirm(userName(t.memberId) + ' ' + t.countryCity + ' 출장을 삭제할까요?')) {
              S.remove('trips', t.id);
              renderCalendar();
              renderTripList();
              toast('삭제했습니다.');
            }
          }
        }));
        act.appendChild(box);
        tr.appendChild(act);
        tbody.appendChild(tr);
      });
  }

  /* ================= B-6 팀회의 ================= */

  var meetingEditingId = null;
  var meetingRecognition = null; // Web Speech API 인스턴스 (지원 브라우저에서만)

  function initMeetings() {
    $('#meetingForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var rec = meetingEditingId ? S.get('meetings', meetingEditingId) : null;
      S.save('meetings', {
        id: meetingEditingId || undefined,
        datetime: $('#mfWhen').value,
        place: $('#mfPlace').value.trim(),
        agenda: $('#mfAgenda').value.trim(),
        attendees: $('#mfAttendees').value.trim(),
        notes: rec ? rec.notes : ''
      });
      toast(meetingEditingId ? '회의를 수정했습니다.' : '회의를 등록했습니다.');
      cancelMeetingEdit();
      renderMeetings();
    });
    $('#mfCancelBtn').addEventListener('click', cancelMeetingEdit);

    // 참석자 자동완성 목록(담당자 명단)
    var dl = $('#assigneeList');
    if (dl) (window.ASSIGNEES || []).forEach(function (a) { dl.appendChild(el('option', { value: a.name })); });

    // 클릭으로 알림발송 — 편집 중인 회의, 없으면 가장 가까운 다가오는 회의를 대상으로
    $('#meetingNotifyBtn').addEventListener('click', function () {
      var target = meetingEditingId ? S.get('meetings', meetingEditingId) : nearestUpcomingMeeting();
      if (!target) { toast('알림 보낼 회의가 없습니다. 먼저 회의를 등록하세요.'); return; }
      var recipients = String(target.attendees || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (!recipients.length) { toast('참석자가 비어 있습니다.'); return; }
      var subject = '[해외영업팀] 팀회의 안내 — ' + target.datetime.replace('T', ' ');
      var body = '일시: ' + target.datetime.replace('T', ' ') + '\n장소/링크: ' + target.place +
        '\n안건: ' + target.agenda + '\n참석자: ' + target.attendees;
      var mailto = L.buildMailto(recipients, subject, body);
      var a = el('a', { href: mailto });
      document.body.appendChild(a); a.click(); a.remove();
      toast('회의 알림 메일 초안을 열었습니다. (참석자 ' + recipients.length + '명)');
    });

    // 회의 노트란
    $('#meetingNoteSelect').addEventListener('change', loadMeetingNote);
    $('#meetingNoteSaveBtn').addEventListener('click', function () {
      var id = $('#meetingNoteSelect').value;
      if (!id) { toast('노트를 남길 회의를 먼저 선택하세요.'); return; }
      var mt = S.get('meetings', id);
      if (!mt) return;
      mt.notes = $('#meetingNoteText').value;
      S.save('meetings', mt);
      toast('노트를 저장했습니다.');
    });

    // 마이크 녹음 → 텍스트 전사 (Web Speech API, 브라우저 내장 — 오프라인/구형 브라우저 미지원)
    var SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    var micBtn = $('#meetingMicBtn');
    if (!SpeechRecognitionCtor) {
      micBtn.disabled = true;
      micBtn.title = '이 브라우저는 음성인식을 지원하지 않습니다 (Chrome/Edge 권장)';
    } else {
      micBtn.addEventListener('click', function () {
        if (meetingRecognition) { meetingRecognition.stop(); return; }
        meetingRecognition = new SpeechRecognitionCtor();
        meetingRecognition.lang = 'ko-KR';
        meetingRecognition.continuous = true;
        meetingRecognition.interimResults = false;
        meetingRecognition.onresult = function (ev) {
          var chunk = '';
          for (var i = ev.resultIndex; i < ev.results.length; i++) chunk += ev.results[i][0].transcript;
          var ta = $('#meetingNoteText');
          ta.value = (ta.value ? ta.value + '\n' : '') + chunk;
        };
        meetingRecognition.onend = function () {
          meetingRecognition = null;
          micBtn.textContent = '🎤 녹음 시작';
        };
        meetingRecognition.onerror = function () {
          toast('음성인식 중 오류가 발생했습니다.');
          meetingRecognition = null;
          micBtn.textContent = '🎤 녹음 시작';
        };
        meetingRecognition.start();
        micBtn.textContent = '⏹ 녹음 중지';
      });
    }
  }

  function nearestUpcomingMeeting() {
    var now = new Date();
    var nowStr = todayStr() + 'T' + pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    var upcoming = S.list('meetings').filter(function (mt) { return mt.datetime >= nowStr; })
      .sort(function (a, b) { return a.datetime < b.datetime ? -1 : 1; });
    return upcoming[0] || null;
  }

  function loadMeetingNote() {
    var id = $('#meetingNoteSelect').value;
    var mt = id ? S.get('meetings', id) : null;
    $('#meetingNoteText').value = mt ? (mt.notes || '') : '';
  }

  function cancelMeetingEdit() {
    meetingEditingId = null;
    $('#meetingForm').reset();
    $('#mtFormTitle').textContent = '회의 등록';
    $('#mfCancelBtn').hidden = true;
  }

  function meetingItem(mt, isPast) {
    var li = el('li');
    var when = mt.datetime.replace('T', ' ');
    li.appendChild(el('div', { class: 'mt-when', text: when + (isPast ? ' (종료)' : '') }));
    li.appendChild(el('div', { text: mt.agenda }));
    li.appendChild(el('div', { class: 'mt-meta', text: '장소: ' + mt.place + ' · 참석: ' + mt.attendees }));
    var box = el('div', { class: 'row-actions' });
    box.appendChild(el('button', {
      class: 'link-btn', text: '수정',
      onclick: function () {
        meetingEditingId = mt.id;
        $('#mfWhen').value = mt.datetime;
        $('#mfPlace').value = mt.place;
        $('#mfAgenda').value = mt.agenda;
        $('#mfAttendees').value = mt.attendees;
        $('#mtFormTitle').textContent = '회의 수정';
        $('#mfCancelBtn').hidden = false;
        $('#meetingForm').scrollIntoView({ behavior: 'smooth' });
      }
    }));
    box.appendChild(el('button', {
      class: 'link-btn danger', text: '삭제',
      onclick: function () {
        if (confirm('회의(' + when + ')를 삭제할까요?')) {
          S.remove('meetings', mt.id);
          renderMeetings();
          toast('삭제했습니다.');
        }
      }
    }));
    li.appendChild(box);
    return li;
  }

  function renderMeetings() {
    var now = new Date();
    var nowStr = todayStr() + 'T' + pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    var list = S.list('meetings').slice().sort(function (a, b) { return a.datetime < b.datetime ? -1 : 1; });
    var past = $('#pastMeetings');
    past.innerHTML = '';
    list.slice().reverse().forEach(function (mt) {
      if (mt.datetime < nowStr) past.appendChild(meetingItem(mt, true));
    });
    if (!past.children.length) past.appendChild(el('li', { text: '지난 회의가 없습니다.' }));

    // 회의 노트란 — 전체 회의(최신순) 선택 목록
    var sel = $('#meetingNoteSelect');
    var prev = sel.value;
    sel.innerHTML = '<option value="">회의를 선택하세요</option>';
    list.slice().reverse().forEach(function (mt) {
      sel.appendChild(el('option', { value: mt.id, text: mt.datetime.replace('T', ' ') + ' · ' + mt.agenda }));
    });
    if (prev && list.some(function (m) { return m.id === prev; })) sel.value = prev;
    loadMeetingNote();
  }

  /* ================= B-4 환율 ================= */

  function currentMonthStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  function initFx() {
    $('#fxMonth').value = currentMonthStr();
    $('#fxForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var month = $('#fxMonth').value;
      if (!L.validateMonth(month)) { toast('기준월 형식이 잘못되었습니다. (YYYY-MM)'); return; }
      var check = L.validateRate($('#fxRate').value);
      if (!check.ok) { toast(check.error); return; }
      var currency = $('#fxCurrency').value;
      var category = $('#fxCategory') ? $('#fxCategory').value : '기준통화';
      var user = S.currentUser();
      var existing = S.list('exchangeRates').find(function (r) { return r.month === month && r.currency === currency; });
      S.save('exchangeRates', {
        id: existing ? existing.id : undefined,
        month: month,
        currency: currency,
        category: category,
        rate: check.value,
        inputBy: user ? user.name : '-',
        inputAt: todayStr()
      });
      $('#fxRate').value = '';
      renderFxView();
      toast(month + ' ' + currency + ' 환율을 ' + (existing ? '수정' : '등록') + '했습니다.');
    });
  }

  function renderFxView() {
    var month = $('#fxMonth').value || currentMonthStr();
    $('#fxCurrentTitle').textContent = month + ' 고시 환율';
    var rates = S.list('exchangeRates');

    var tbody = $('#fxCurrentTable tbody');
    tbody.innerHTML = '';
    var cur = rates.filter(function (r) { return r.month === month; })
      .sort(function (a, b) { return a.currency.localeCompare(b.currency); });
    cur.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', { text: r.currency }));
      tr.appendChild(el('td', { text: r.category || '기준통화' }));
      tr.appendChild(el('td', { class: 'num', text: L.fmt(r.rate) }));
      tr.appendChild(el('td', { text: r.inputBy }));
      tr.appendChild(el('td', { text: r.inputAt }));
      tbody.appendChild(tr);
    });
    if (!cur.length) tbody.appendChild(el('tr', {}, [el('td', { colspan: '5', text: month + ' 입력된 환율이 없습니다.' })]));

    // 최근 12개월 매트릭스 (행=월, 열=통화)
    var months = Array.from(new Set(rates.map(function (r) { return r.month; }))).sort().slice(-12);
    var currencies = Array.from(new Set(rates.map(function (r) { return r.currency; }))).sort();
    var map = {};
    rates.forEach(function (r) { map[r.month + '|' + r.currency] = r.rate; });

    var thead = $('#fxHistoryTable thead');
    thead.innerHTML = '';
    var hr = el('tr', {}, [el('th', { text: '기준월' })]);
    currencies.forEach(function (c) { hr.appendChild(el('th', { class: 'num', text: c })); });
    thead.appendChild(hr);

    var hbody = $('#fxHistoryTable tbody');
    hbody.innerHTML = '';
    months.slice().reverse().forEach(function (m) {
      var tr = el('tr', {}, [el('td', { text: m })]);
      currencies.forEach(function (c) {
        tr.appendChild(el('td', { class: 'num', text: map[m + '|' + c] !== undefined ? L.fmt(map[m + '|' + c]) : '-' }));
      });
      hbody.appendChild(tr);
    });
  }

  /* ================= B-3 지역별 매출 추이 ================= */

  var salesChart = null;
  var salesMode = 'week';   // 'week' | 'month'
  var salesType = 'line';   // 'line' | 'bar'
  var salesRegionOn = {};   // region -> bool

  var REGION_COLORS = { '유럽법인': '#2f6fb7', '미주법인': '#1e8e5a', '아시아법인': '#b7791f', '직수출': '#7048ad' };

  function initSales() {
    $('#salesWeekBtn').addEventListener('click', function () { salesMode = 'week'; syncSeg(); renderSales(); });
    $('#salesMonthBtn').addEventListener('click', function () { salesMode = 'month'; syncSeg(); renderSales(); });
    $('#salesLineBtn').addEventListener('click', function () { salesType = 'line'; syncSeg(); renderSales(); });
    $('#salesBarBtn').addEventListener('click', function () { salesType = 'bar'; syncSeg(); renderSales(); });
    $('#sapUpload').addEventListener('change', handleSapUpload);
  }

  /* ---- SAP 매출 업로드 — 법인/직수출 분리 (슬라이드6) ---- */

  var SAP_HEADER_MAP = { '국가': 'country', '구분': 'kind', '기준월': 'month', '매출': 'sales' };
  var sapCorpChart = null, sapExportChart = null;

  function handleSapUpload(e) {
    var file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    var status = $('#sapUploadStatus');
    status.textContent = '"' + file.name + '" 읽는 중…';
    var reader = new FileReader();
    reader.onload = function (ev) {
      try {
        var wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
        var rows = [], errors = [];
        raw.forEach(function (r, i) {
          var mapped = {};
          Object.keys(r).forEach(function (k) {
            var key = SAP_HEADER_MAP[String(k).trim()];
            if (key) mapped[key] = r[k];
          });
          if (!mapped.country && !mapped.month) return;
          var check = L.validateSapRow(mapped);
          if (check.ok) rows.push(check.row);
          else errors.push((i + 2) + '행: ' + check.error);
        });
        if (!rows.length) {
          status.textContent = '업로드 실패 — 유효한 행이 없습니다. ' + (errors[0] || '열 이름(국가/구분/기준월/매출)을 확인하세요.');
          return;
        }
        var existing = S.list('sapSales');
        rows.forEach(function (r) {
          var dup = existing.find(function (x) { return x.country === r.country && x.kind === r.kind && x.month === r.month; });
          S.save('sapSales', { id: dup ? dup.id : undefined, country: r.country, kind: r.kind, month: r.month, sales: r.sales });
        });
        status.textContent = rows.length + '건 반영' + (errors.length ? ' (' + errors.length + '건 오류 건너뜀)' : '') + '.';
        renderSapCharts();
      } catch (err) {
        status.textContent = '엑셀을 읽는 중 오류가 발생했습니다: ' + err.message;
      }
    };
    reader.readAsArrayBuffer(file);
  }

  var SAP_REGION_COLORS = { '아시아': '#b7791f', '중동': '#7048ad', '아프리카': '#c0392b', 'CIS': '#2f6fb7', '대양주': '#1e8e5a', '중남미': '#d17a22', 'CNHI': '#555', '기타': '#999' };

  function renderSapCharts() {
    var corpCanvas = $('#sapCorpChart'), exportCanvas = $('#sapExportChart');
    if (!corpCanvas || !exportCanvas) return;
    var agg = L.aggregateSapSales(S.list('sapSales'));

    if (sapCorpChart) sapCorpChart.destroy();
    sapCorpChart = new Chart(corpCanvas.getContext('2d'), {
      type: 'bar',
      data: { labels: agg.labels, datasets: [{ label: '법인 매출', data: agg.corp, backgroundColor: '#2f6fb7' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });

    var regions = Object.keys(agg.exportSeries);
    if (sapExportChart) sapExportChart.destroy();
    sapExportChart = new Chart(exportCanvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: agg.labels,
        datasets: regions.map(function (r) {
          var c = SAP_REGION_COLORS[r] || '#999';
          return { label: r, data: agg.exportSeries[r], borderColor: c, backgroundColor: c, tension: 0.25, borderWidth: 2, pointRadius: 3 };
        })
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } }
    });
  }

  function syncSeg() {
    $('#salesWeekBtn').classList.toggle('active', salesMode === 'week');
    $('#salesMonthBtn').classList.toggle('active', salesMode === 'month');
    $('#salesLineBtn').classList.toggle('active', salesType === 'line');
    $('#salesBarBtn').classList.toggle('active', salesType === 'bar');
  }

  function allRegions() {
    return Array.from(new Set(S.list('weeklyReports').map(function (r) { return r.region; }))).sort();
  }

  function renderSales() {
    var regions = allRegions();
    regions.forEach(function (r) { if (!(r in salesRegionOn)) salesRegionOn[r] = true; });

    // 지역 필터 칩
    var filterBox = $('#salesRegionFilter');
    filterBox.innerHTML = '';
    regions.forEach(function (r) {
      filterBox.appendChild(el('button', {
        class: 'chip' + (salesRegionOn[r] ? ' on' : ''), text: r,
        onclick: function () { salesRegionOn[r] = !salesRegionOn[r]; renderSales(); }
      }));
    });

    var active = regions.filter(function (r) { return salesRegionOn[r]; });
    var agg = L.aggregateSales(S.list('weeklyReports'), salesMode, active);

    var datasets = Object.keys(agg.series).map(function (region) {
      var color = REGION_COLORS[region] || '#666';
      return {
        label: region,
        data: agg.series[region],
        borderColor: color,
        backgroundColor: salesType === 'bar' ? color : color + '33',
        fill: false,
        tension: 0.25,
        borderWidth: 2,
        pointRadius: 3
      };
    });

    if (salesChart) salesChart.destroy();
    var ctx = $('#salesChart').getContext('2d');
    salesChart = new Chart(ctx, {
      type: salesType,
      data: { labels: agg.labels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom' },
          title: { display: true, text: (salesMode === 'week' ? '주간' : '월간') + ' 매출 추이 (USD 천불)' }
        },
        scales: { y: { beginAtZero: true } }
      }
    });

    // 집계 표
    var thead = $('#salesTable thead');
    var tbody = $('#salesTable tbody');
    thead.innerHTML = ''; tbody.innerHTML = '';
    var hr = el('tr', {}, [el('th', { text: salesMode === 'week' ? '주차' : '월' })]);
    Object.keys(agg.series).forEach(function (r) { hr.appendChild(el('th', { class: 'num', text: r })); });
    hr.appendChild(el('th', { class: 'num', text: '합계' }));
    thead.appendChild(hr);
    agg.labels.forEach(function (label, i) {
      var tr = el('tr', {}, [el('td', { text: label })]);
      var sum = 0;
      Object.keys(agg.series).forEach(function (r) {
        var v = agg.series[r][i];
        sum += v;
        tr.appendChild(el('td', { class: 'num', text: L.fmt(v) }));
      });
      tr.appendChild(el('td', { class: 'num', html: '<b>' + L.fmt(sum) + '</b>' }));
      tbody.appendChild(tr);
    });
  }

  /* ================= A. 딜러 대시보드 ================= */

  var dealerChart = null;

  function initDealers() {
    var sel = $('#dealerSelect');
    sel.addEventListener('change', renderDealerDetail);
    $('#dealerUpload').addEventListener('change', handleDealerUpload);
    $('#exportOfflineBtn').addEventListener('click', exportOfflineHtml);
  }

  function renderDealers() {
    var sel = $('#dealerSelect');
    var prev = sel.value;
    sel.innerHTML = '';
    S.list('dealers').forEach(function (d) {
      sel.appendChild(el('option', { value: d.code, text: d.code + ' · ' + d.name + ' (' + d.country + ')' }));
    });
    var hasPrev = S.list('dealers').some(function (d) { return d.code === prev; });
    if (prev && hasPrev) sel.value = prev;
    else if (S.list('dealers').length) sel.value = S.list('dealers')[0].code;
    renderDealerDetail();
  }

  function renderDealerDetail() {
    var code = $('#dealerSelect').value;
    var dealer = S.list('dealers').find(function (d) { return d.code === code; });
    var cards = $('#dealerCards');
    cards.innerHTML = '';
    if (!dealer) { $('#dealerTerms').textContent = ''; return; }

    var history = L.dealerHistory(S.list('dealerMetrics'), code).slice(-12);
    var latest = history[history.length - 1];

    function kpi(label, value, sub, warn) {
      var box = el('div', { class: 'kpi' + (warn ? ' warn' : '') });
      box.appendChild(el('div', { class: 'kpi-label', text: label }));
      box.appendChild(el('div', { class: 'kpi-value', text: value }));
      if (sub) box.appendChild(el('div', { class: 'kpi-sub', text: sub }));
      return box;
    }

    if (latest) {
      var overdueRatio = latest.receivable ? Math.round(latest.overdue / latest.receivable * 100) : 0;
      cards.appendChild(kpi('당월 매출 (USD 천불)', L.fmt(latest.sales), latest.month + ' 기준'));
      cards.appendChild(kpi('재고 (대)', L.fmt(latest.inventory), latest.month + ' 기준'));
      cards.appendChild(kpi('채권잔액 (USD 천불)', L.fmt(latest.receivable), latest.month + ' 기준'));
      cards.appendChild(kpi('경과채권 (USD 천불)', L.fmt(latest.overdue), '채권 대비 ' + overdueRatio + '%', overdueRatio >= 15));
      $('#dealerTerms').innerHTML = '<b>계약조건</b> · ' + (latest.terms || '-') +
        ' &nbsp;|&nbsp; <b>담당</b> ' + (dealer.manager || '-') + ' · <b>통화</b> ' + (dealer.currency || '-');
    } else {
      cards.appendChild(el('div', { class: 'hint', text: '이 딜러의 실적 데이터가 없습니다. 엑셀 업로드로 추가하세요.' }));
      $('#dealerTerms').textContent = '';
    }

    // 12개월 추이 차트
    if (dealerChart) dealerChart.destroy();
    var ctx = $('#dealerChart').getContext('2d');
    dealerChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: history.map(function (m) { return m.month; }),
        datasets: [
          { type: 'bar', label: '매출', data: history.map(function (m) { return m.sales; }), backgroundColor: '#2f6fb7', order: 2 },
          { type: 'line', label: '경과채권', data: history.map(function (m) { return m.overdue; }), borderColor: '#c0392b', backgroundColor: '#c0392b', tension: 0.25, order: 1 },
          { type: 'line', label: '채권잔액', data: history.map(function (m) { return m.receivable; }), borderColor: '#b7791f', backgroundColor: '#b7791f', borderDash: [5, 4], tension: 0.25, order: 1 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom' },
          title: { display: true, text: dealer.name + ' — 12개월 추이 (USD 천불)' }
        },
        scales: { y: { beginAtZero: true } }
      }
    });
  }

  /* ------- 엑셀 업로드 ------- */

  var XLSX_HEADER_MAP = {
    '딜러코드': 'dealerCode', '딜러명': 'dealerName', '국가': 'country', '기준월': 'month',
    '매출': 'sales', '재고': 'inventory', '채권잔액': 'receivable', '경과채권': 'overdue', '계약조건': 'terms'
  };

  function handleDealerUpload(e) {
    var file = e.target.files[0];
    if (!file) return;
    var status = $('#uploadStatus');
    status.textContent = '"' + file.name + '" 읽는 중…';
    var reader = new FileReader();
    reader.onload = function (ev) {
      try {
        var wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
        var ws = wb.Sheets['딜러실적'] || wb.Sheets[wb.SheetNames[0]];
        var raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
        var rows = [], errors = [];
        raw.forEach(function (r, i) {
          var mapped = {};
          Object.keys(r).forEach(function (k) {
            var key = XLSX_HEADER_MAP[String(k).trim()];
            if (key) mapped[key] = r[k];
          });
          if (!mapped.dealerCode && !mapped.month) return; // 빈 행 무시
          var check = L.validateMetricRow(mapped);
          if (check.ok) rows.push(check.row);
          else errors.push((i + 2) + '행: ' + check.error);
        });
        if (!rows.length) {
          status.textContent = '업로드 실패 — 유효한 행이 없습니다. ' + (errors[0] || '양식(딜러실적 시트)을 확인하세요.');
          return;
        }
        // 실적 병합
        var merged = L.mergeMetrics(S.list('dealerMetrics'), rows.map(function (r) {
          return {
            dealerCode: r.dealerCode, month: r.month, sales: r.sales, inventory: r.inventory,
            receivable: r.receivable, overdue: r.overdue, terms: r.terms || ''
          };
        }));
        S.replaceAll('dealerMetrics', merged.list);
        // 신규 딜러 자동 등록
        var dealers = S.list('dealers');
        var known = {};
        dealers.forEach(function (d) { known[d.code] = true; });
        var newDealers = 0;
        rows.forEach(function (r) {
          if (!known[r.dealerCode]) {
            dealers.push({ code: r.dealerCode, name: r.dealerName || r.dealerCode, country: r.country || '-', region: '-', currency: '-', manager: '-' });
            known[r.dealerCode] = true;
            newDealers++;
          }
        });
        if (newDealers) S.replaceAll('dealers', dealers);
        status.textContent = '업로드 완료 — 추가 ' + merged.added + '행, 갱신 ' + merged.updated + '행' +
          (newDealers ? ', 신규 딜러 ' + newDealers + '개' : '') +
          (errors.length ? ' / 오류 ' + errors.length + '행: ' + errors.slice(0, 3).join(' · ') : '');
        renderDealers();
        toast('딜러 실적을 반영했습니다.');
      } catch (err) {
        status.textContent = '업로드 실패: ' + err.message;
      }
      e.target.value = '';
    };
    reader.readAsArrayBuffer(file);
  }

  /* ------- 오프라인용 HTML 내보내기 ------- */

  function exportOfflineHtml() {
    var btn = $('#exportOfflineBtn');
    btn.disabled = true;
    btn.textContent = '생성 중…';
    fetch('lib/chart.umd.min.js')
      .then(function (res) {
        if (!res.ok) throw new Error('lib/chart.umd.min.js 로드 실패');
        return res.text();
      })
      .then(function (chartLib) {
        var data = {
          generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
          dealers: S.list('dealers'),
          metrics: S.list('dealerMetrics'),
          rates: S.list('exchangeRates')
        };
        var html = buildOfflineHtml(chartLib, data);
        var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = el('a', { href: url, download: '딜러대시보드_오프라인_' + todayStr() + '.html' });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
        toast('오프라인용 HTML을 내려받았습니다. 인터넷 없이 열 수 있습니다.');
      })
      .catch(function (err) { toast('내보내기 실패: ' + err.message); })
      .then(function () { btn.disabled = false; btn.textContent = '오프라인용 HTML 내보내기'; });
  }

  function buildOfflineHtml(chartLib, data) {
    var json = JSON.stringify(data).replace(/<\//g, '<\\/');
    var lib = chartLib.replace(/<\/script/gi, '<\\/script');
    return [
      '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '<title>딜러 대시보드 (오프라인)</title>',
      '<style>',
      'body{font-family:"Malgun Gothic","맑은 고딕",sans-serif;background:#f4f6f9;color:#22303f;margin:0;padding:14px;font-size:15px}',
      'h1{font-size:19px;color:#1f3a5f}h1 small{font-size:12px;color:#6b7684;font-weight:400}',
      '.card{background:#fff;border:1px solid #dfe4ec;border-radius:10px;padding:14px;margin-bottom:14px;box-shadow:0 1px 3px rgba(20,35,60,.08)}',
      'select{border:1px solid #dfe4ec;border-radius:7px;padding:8px 10px;font-size:15px;width:100%;max-width:420px}',
      '.kpis{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin:12px 0}',
      '@media(min-width:800px){.kpis{grid-template-columns:repeat(4,1fr)}}',
      '.kpi{border:1px solid #dfe4ec;border-radius:8px;padding:10px 12px;background:#f9fafc}',
      '.kpi .l{font-size:12px;color:#6b7684}.kpi .v{font-size:20px;font-weight:800;color:#1f3a5f}',
      '.kpi.warn .v{color:#c0392b}.kpi .s{font-size:11.5px;color:#6b7684}',
      '.terms{border:1px dashed #dfe4ec;border-radius:8px;background:#fbfcfe;padding:9px 12px;font-size:13.5px}',
      '.chart{position:relative;height:320px;margin-top:12px}',
      '.tbl{border-collapse:collapse;width:100%;font-size:12.5px;margin-top:8px}',
      '.tbl th,.tbl td{border-bottom:1px solid #dfe4ec;padding:6px 8px;text-align:right;white-space:nowrap}',
      '.tbl th{background:#f0f3f8;color:#1f3a5f}.tbl th:first-child,.tbl td:first-child{text-align:left}',
      '.wrap{overflow-x:auto}',
      '</style></head><body>',
      '<h1>딜러 미팅 대시보드 <small>오프라인 스냅샷 · 생성 ' + data.generatedAt + '</small></h1>',
      '<div class="card"><label>딜러 선택<br><select id="sel"></select></label>',
      '<div class="kpis" id="kpis"></div><div class="terms" id="terms"></div>',
      '<div class="chart"><canvas id="chart"></canvas></div></div>',
      '<div class="card"><b>12개월 상세</b><div class="wrap"><table class="tbl" id="tbl"></table></div></div>',
      '<script>' + lib + '</' + 'script>',
      '<script>',
      'var DATA=' + json + ';',
      'var fmt=function(n){return n===null||n===undefined||isNaN(Number(n))?"-":Number(n).toLocaleString("ko-KR")};',
      'var chart=null;',
      'var sel=document.getElementById("sel");',
      'DATA.dealers.forEach(function(d){var o=document.createElement("option");o.value=d.code;o.textContent=d.code+" · "+d.name+" ("+d.country+")";sel.appendChild(o)});',
      'function hist(code){return DATA.metrics.filter(function(m){return m.dealerCode===code}).sort(function(a,b){return a.month<b.month?-1:1}).slice(-12)}',
      'function render(){',
      ' var code=sel.value;var d=DATA.dealers.filter(function(x){return x.code===code})[0];var h=hist(code);var t=h[h.length-1];',
      ' var k=document.getElementById("kpis");k.innerHTML="";',
      ' function kpi(l,v,s,w){k.innerHTML+="<div class=\\"kpi"+(w?" warn":"")+"\\"><div class=l>"+l+"</div><div class=v>"+v+"</div><div class=s>"+(s||"")+"</div></div>"}',
      ' if(t){var ratio=t.receivable?Math.round(t.overdue/t.receivable*100):0;',
      '  kpi("당월 매출 (USD 천불)",fmt(t.sales),t.month+" 기준");kpi("재고 (대)",fmt(t.inventory),t.month+" 기준");',
      '  kpi("채권잔액 (USD 천불)",fmt(t.receivable),t.month+" 기준");kpi("경과채권 (USD 천불)",fmt(t.overdue),"채권 대비 "+ratio+"%",ratio>=15);',
      '  document.getElementById("terms").innerHTML="<b>계약조건</b> · "+(t.terms||"-")+" | <b>담당</b> "+(d.manager||"-")+" · <b>통화</b> "+(d.currency||"-");}',
      ' if(chart)chart.destroy();',
      ' chart=new Chart(document.getElementById("chart"),{type:"bar",data:{labels:h.map(function(m){return m.month}),datasets:[',
      '  {type:"bar",label:"매출",data:h.map(function(m){return m.sales}),backgroundColor:"#2f6fb7",order:2},',
      '  {type:"line",label:"경과채권",data:h.map(function(m){return m.overdue}),borderColor:"#c0392b",backgroundColor:"#c0392b",tension:.25,order:1},',
      '  {type:"line",label:"채권잔액",data:h.map(function(m){return m.receivable}),borderColor:"#b7791f",backgroundColor:"#b7791f",borderDash:[5,4],tension:.25,order:1}]},',
      '  options:{responsive:true,maintainAspectRatio:false,interaction:{mode:"index",intersect:false},plugins:{legend:{position:"bottom"},title:{display:true,text:(d?d.name:code)+" — 12개월 추이 (USD 천불)"}},scales:{y:{beginAtZero:true}}}});',
      ' var tbl=document.getElementById("tbl");',
      ' tbl.innerHTML="<tr><th>기준월</th><th>매출</th><th>재고</th><th>채권잔액</th><th>경과채권</th></tr>"+h.map(function(m){return "<tr><td>"+m.month+"</td><td>"+fmt(m.sales)+"</td><td>"+fmt(m.inventory)+"</td><td>"+fmt(m.receivable)+"</td><td>"+fmt(m.overdue)+"</td></tr>"}).join("");',
      '}',
      'sel.addEventListener("change",render);render();',
      '</' + 'script></body></html>'
    ].join('\n');
  }

  /* ================= 초기화 ================= */

  function init() {
    S.seedIfEmpty(window.SEED_DATA);
    initUserSelect();

    $('#menuToggle').addEventListener('click', function () {
      $('#sideNav').classList.toggle('open');
    });
    document.addEventListener('click', function (e) {
      var nav = $('#sideNav');
      if (nav.classList.contains('open') && !nav.contains(e.target) && e.target.id !== 'menuToggle') {
        nav.classList.remove('open');
      }
    });
    $('#resetSeedBtn').addEventListener('click', function () {
      if (confirm('모든 데이터를 데모 시드로 초기화할까요? 입력한 데이터가 사라집니다.')) {
        S.resetToSeed(window.SEED_DATA);
        initUserSelect();
        showView(currentView());
        toast('데모 데이터를 초기화했습니다.');
      }
    });

    // 전체 데이터 백업(JSON 내보내기/가져오기) — 팀원 간 파일 공유·PC 이동용
    $('#exportJsonBtn').addEventListener('click', function () {
      var json = JSON.stringify(S.exportAll(), null, 2);
      var blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = el('a', { href: url, download: '해외영업포털_백업_' + todayStr() + '.json' });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      toast('전체 데이터를 JSON 파일로 내려받았습니다.');
    });
    $('#importJsonBtn').addEventListener('click', function () { $('#importJsonFile').click(); });
    $('#importJsonFile').addEventListener('change', function (e) {
      var file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var data;
        try { data = JSON.parse(reader.result); }
        catch (err) { toast('JSON 파일을 읽을 수 없습니다.'); return; }
        var v = S.validateBackup(data);
        if (!v.ok) { toast('가져오기 실패: ' + v.error); return; }
        var when = data.exportedAt ? data.exportedAt.slice(0, 16).replace('T', ' ') : '?';
        if (!confirm('백업 파일(' + when + ' 내보냄)로 현재 데이터를 전부 교체할까요?')) return;
        var r = S.importAll(data);
        if (!r.ok) { toast('가져오기 실패: ' + r.error); return; }
        initUserSelect();
        showView(currentView());
        toast('백업 데이터를 가져왔습니다.');
      };
      reader.readAsText(file, 'utf-8');
    });

    initWeekly();
    initReceivable();
    initCalendar();
    initMeetings();
    initFx();
    initSales();
    initDealers();
    initPrices();

    window.addEventListener('hashchange', function () { showView(currentView()); });
    showView(currentView());
  }

  /* ================= 오일·브레이커 가격 (슬라이드7) ================= */

  var priceCategory = 'oil'; // 'oil' | 'breaker'
  var PRICE_HEADER_MAP = { '품목': 'itemName', '단가': 'unitPrice', '통화': 'currency', '비고': 'note' };

  function initPrices() {
    $('#priceOilBtn').addEventListener('click', function () { priceCategory = 'oil'; syncPriceSeg(); renderPrices(); });
    $('#priceBreakerBtn').addEventListener('click', function () { priceCategory = 'breaker'; syncPriceSeg(); renderPrices(); });
    $('#priceUpload').addEventListener('change', handlePriceUpload);
    $('#priceTeamsSaveBtn').addEventListener('click', function () {
      var links = S.list('teamsLinks')[0] || { id: undefined, oil: '', breaker: '' };
      links[priceCategory] = $('#priceTeamsLink').value.trim();
      S.save('teamsLinks', links);
      renderPrices();
      toast('팀즈 폴더 링크를 저장했습니다.');
    });
  }

  function syncPriceSeg() {
    $('#priceOilBtn').classList.toggle('active', priceCategory === 'oil');
    $('#priceBreakerBtn').classList.toggle('active', priceCategory === 'breaker');
    $('#priceListTitle').textContent = (priceCategory === 'oil' ? '오일' : '브레이커') + ' 가격 목록';
  }

  function handlePriceUpload(e) {
    var file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    var status = $('#priceUploadStatus');
    status.textContent = '"' + file.name + '" 읽는 중…';
    var reader = new FileReader();
    reader.onload = function (ev) {
      try {
        var wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
        var rows = [];
        raw.forEach(function (r) {
          var mapped = { category: priceCategory };
          Object.keys(r).forEach(function (k) {
            var key = PRICE_HEADER_MAP[String(k).trim()];
            if (key) mapped[key] = r[k];
          });
          if (!String(mapped.itemName || '').trim()) return;
          mapped.unitPrice = Number(mapped.unitPrice) || 0;
          mapped.currency = mapped.currency || 'USD';
          mapped.updatedAt = todayStr();
          rows.push(mapped);
        });
        if (!rows.length) { status.textContent = '업로드 실패 — 유효한 행이 없습니다. 열 이름(품목/단가/통화/비고)을 확인하세요.'; return; }
        var existing = S.list('priceItems').filter(function (p) { return p.category === priceCategory; });
        rows.forEach(function (r) {
          var dup = existing.find(function (x) { return x.itemName === r.itemName; });
          S.save('priceItems', { id: dup ? dup.id : undefined, category: r.category, itemName: r.itemName, unitPrice: r.unitPrice, currency: r.currency, note: r.note || '', updatedAt: r.updatedAt });
        });
        status.textContent = rows.length + '건 반영했습니다.';
        renderPrices();
      } catch (err) {
        status.textContent = '엑셀을 읽는 중 오류가 발생했습니다: ' + err.message;
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function renderPrices() {
    syncPriceSeg();
    var links = S.list('teamsLinks')[0] || {};
    $('#priceTeamsLink').value = links[priceCategory] || '';
    var openBtn = $('#priceTeamsOpenBtn');
    if (links[priceCategory]) { openBtn.href = links[priceCategory]; openBtn.classList.remove('disabled'); openBtn.removeAttribute('aria-disabled'); }
    else { openBtn.href = '#'; openBtn.classList.add('disabled'); openBtn.setAttribute('aria-disabled', 'true'); }

    var tbody = $('#priceTable tbody');
    tbody.innerHTML = '';
    var items = S.list('priceItems').filter(function (p) { return p.category === priceCategory; });
    items.forEach(function (p) {
      var tr = el('tr');
      tr.appendChild(el('td', { text: p.itemName }));
      tr.appendChild(el('td', { class: 'num', text: L.fmt(p.unitPrice) }));
      tr.appendChild(el('td', { text: p.currency }));
      tr.appendChild(el('td', { class: 'wrap-cell', text: p.note || '' }));
      tr.appendChild(el('td', { text: p.updatedAt }));
      tr.appendChild(el('td', {}, [el('button', {
        class: 'link-btn danger', text: '삭제',
        onclick: function () { if (confirm(p.itemName + ' 항목을 삭제할까요?')) { S.remove('priceItems', p.id); renderPrices(); } }
      })]));
      tbody.appendChild(tr);
    });
    if (!items.length) tbody.appendChild(el('tr', {}, [el('td', { colspan: '6', text: '업로드된 가격이 없습니다.' })]));
  }

  /**
   * 시작 — 저장 위치를 먼저 정하고 화면을 띄운다.
   *
   * 서버에 연결되면 Store 의 어댑터를 팀 공용으로 갈아 끼운다.
   * 화면 코드(init 아래 전부)는 어디에 저장되는지 모른 채 그대로 돈다.
   * 연결이 안 되면 지금까지처럼 이 브라우저에 저장한다.
   */
  function boot() {
    if (window.HDDoc) {
      HDDoc.onNotify(function (msg, isError) { toast(msg, isError); });
    }

    if (window.HDDoc && HDDoc.available() && window.SupabaseDocAdapter) {
      // 서버에 아직 문서가 없으면 지금 이 브라우저에 있는 것을 씨앗으로 올린다.
      var seed = {};
      S.collections().forEach(function (c) { seed[c] = S.list(c); });

      HDDoc.boot({
        id: 'hd-portal',
        initial: seed,
        onReady: function (doc) {
          S.use(window.SupabaseDocAdapter(doc));
          init();
        },
        onFallback: function () {
          // 연결 실패 — 브라우저 저장 그대로. 배너에 이유가 뜬다.
          init();
        }
      });
      return;
    }

    if (window.HDDoc) HDDoc.banner('demo');
    init();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
