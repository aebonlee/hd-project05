# 해외영업팀 업무 포털 + 딜러 미팅 대시보드

해외영업팀(14개 딜러 관리)의 반복 업무를 한 화면에서 처리하는 **팀 업무 통합 포털(6개 기능)** 과,
엑셀 업로드만으로 미팅 자료가 만들어지는 **클라이언트 미팅용 딜러 대시보드**입니다.

- 기획: 최율아 (해외영업팀) — 생성형 AI 업무자동화 전문가과정 프로젝트
- 형태: 빌드 과정 없는 단일 페이지 웹앱 (`index.html`) — GitHub Pages 바로 배포 가능
- 데이터: 브라우저 localStorage (데모용) — 데이터 계층(`js/store.js`)이 분리되어 있어 구글 스프레드시트/Supabase로 교체 가능
- 반응형: 출장 중 모바일(390px) 접속 기준으로 설계, 데스크톱은 사이드 내비게이션
- 오프라인: 차트/엑셀 라이브러리를 `lib/`에 로컬 포함(CDN 미사용) + 딜러 대시보드 오프라인 HTML 내보내기

## 실행 방법

정적 파일이므로 아무 웹서버로 열면 됩니다.

```bash
# 로컬 미리보기
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000 접속
```

처음 접속하면 샘플 시드 데이터가 자동 주입됩니다. 좌측 메뉴 하단 **[데모 데이터 초기화]** 로 언제든 시드 상태로 되돌릴 수 있습니다.

## 데모 계정 (사용자 선택 로그인)

상단 우측 드롭다운에서 사용자를 선택하는 방식의 간이 로그인입니다.

| 이름 | 역할 | 권한 |
|---|---|---|
| 최율아 | 책임자 | 모든 주간업무 수정/삭제 |
| 김도현·박서연·이준호·정하늘·오민재 | 팀원 | 본인 작성분만 수정/삭제 |

## 기능별 사용법 (기획자 우선순위 단계 표기)

### 1단계 ① 주간업무 작성 + 자동 알림 (B-1)

- **작성**: 주차(당일 기준 ISO 주차 자동 입력)·지역/법인·주요 업무·주간 매출(USD 천불)·이슈·다음주 계획 입력 후 저장.
- **목록/필터**: 주차·작성자별 필터. 본인 작성분에는 "내 작성" 배지가 붙고, 권한이 있는 행에만 [수정]/[삭제]가 보입니다.
- **알림 발송**: 발송 주차 선택 → [알림 발송].
  - 수신자 목록은 화면에서 추가/삭제(✕)할 수 있으며 저장됩니다.
  - 발송 시 **발송 로그**(일시·주차·발송자·수신자 수)가 기록되고, 해당 주차 주간업무를 정리한 **메일 초안(mailto:)** 이 열립니다.
  - 실제 자동 메일 발송은 아래 "실제 연동 가이드 > Apps Script 메일" 참고 (어댑터로 분리되어 있음).

### 1단계 ② 경과채권 바로가기 (B-2)

- 법인/딜러별 경과채권 파일 위치를 목록으로 관리합니다 (등록/수정/삭제).
- **URL**(`https://…`, 구글드라이브 등) → [새 탭 열기] 버튼.
- **사내 서버 경로**(`\\efam\…` UNC 또는 `file://`) → 브라우저 보안상 직접 열 수 없으므로 [경로 복사] 버튼 → 윈도우 탐색기 주소창에 붙여넣어 이동.

### 2단계 ① 출장 일정 (B-5)

- **월간 캘린더**(순수 JS 직접 구현, 외부 캘린더 라이브러리 없음)에 출장이 팀원별 색상 막대로 표시됩니다.
- 등록 항목: 팀원, 국가/도시, 시작~종료일, 목적, 방문 딜러. 목록 뷰에서 수정/삭제.
- 팀회의 일정도 같은 캘린더에 점선 테두리(회색)로 병기됩니다.

### 2단계 ② 팀회의 일정 (B-6)

- 등록 항목: 일시, 장소/링크, 안건, 참석자.
- **다가오는 회의 / 지난 회의**로 자동 구분 표시, 전 팀원 조회 가능.

### 2단계 ③ 환율 공지 (B-4)

- 기준월·통화(USD/EUR/JPY/CNY/GBP)·환율(KRW) 입력 → **입력자·입력일 자동 기록**.
- 같은 기준월·통화를 다시 입력하면 수정(덮어쓰기)됩니다. 잘못된 값(문자, 0 이하, 과대값)은 검증에서 거부.
- 이번 달 고시 환율 표 + **최근 12개월 변화 표**를 전 팀원이 조회.

### 3단계 ① 지역별 매출 추이 (B-3)

- 주간업무에 입력된 주간 매출이 **지역/법인별로 자동 집계**됩니다 (별도 입력 불필요).
- **주간/월간 전환**(월간은 ISO 주차의 목요일이 속한 달로 귀속), **라인/막대 전환**, 지역 칩 필터.
- 그래프(Chart.js) 아래에 집계 표(지역별 + 합계) 제공.

### 3단계 ② 딜러 미팅 대시보드 (A)

- **딜러 선택**: 14개 딜러 드롭다운 전환.
- **딜러 카드**: 당월 매출·재고·채권잔액·경과채권(채권 대비 비율 15% 이상이면 경고색) + 계약조건/담당/통화.
- **12개월 히스토리 차트**: 매출(막대) + 경과채권·채권잔액(라인).
- **엑셀 업로드**: [엑셀 양식 내려받기] → 작성 → [엑셀 업로드]. 같은 딜러코드+기준월은 덮어쓰기, 새 딜러코드는 자동 등록. 오류 행은 행 번호와 함께 표시.
- **오프라인용 HTML 내보내기**: 현재 딜러 데이터(JSON)와 차트 라이브러리를 **한 파일에 임베드한 self-contained HTML**을 내려받습니다. 인터넷 없는 기내·현지에서도 브라우저로 열어 딜러 전환/차트 조회가 됩니다.

## 딜러 엑셀 업로드 양식 (`templates/딜러실적_양식.xlsx`)

한 행 = 딜러 1개 × 기준월 1개. 샘플이 채워진 예시는 `templates/딜러실적_샘플.xlsx`.

| 컬럼 | 형식 | 설명 |
|---|---|---|
| 딜러코드 | `DL01`~ | 딜러 구분 키 (필수, 대문자 변환됨) |
| 딜러명 | 텍스트 | 새 딜러코드일 때 등록에 사용 |
| 국가 | 텍스트 | 새 딜러코드일 때 등록에 사용 |
| 기준월 | `YYYY-MM` | 예: `2026-08` (필수) |
| 매출 | 숫자 | USD 천불 |
| 재고 | 숫자 | 대수 |
| 채권잔액 | 숫자 | USD 천불 |
| 경과채권 | 숫자 | USD 천불 (연체/미수) |
| 계약조건 | 텍스트 | 예: `T/T 30일, FOB` |

양식/샘플/시드 데이터는 `python3 make_samples.py` 로 재생성할 수 있습니다 (openpyxl 필요).

## 프로젝트 구조

```
index.html          단일 페이지 앱 (7개 뷰: 포털 6기능 + 딜러 대시보드)
css/style.css       모바일 우선 반응형 스타일
js/logic.js         순수 로직(주차 계산·매출 집계·환율 검증·권한·엑셀 행 검증) — Node 테스트 가능
js/store.js         데이터 접근 계층(localStorage 어댑터, 교체 지점)
js/seed.js          샘플 시드 데이터 (make_samples.py 생성)
js/app.js           화면 로직
lib/                Chart.js, SheetJS 로컬 사본 (CDN 미사용 → 오프라인 동작)
templates/          딜러실적 엑셀 양식/샘플
test/logic.test.js  순수 로직 테스트 (node test/logic.test.js)
make_samples.py     시드/엑셀 생성 스크립트
```

## 실제 연동 가이드

### 1) 구글 스프레드시트로 데이터 교체

화면 코드는 전부 `Store.list / save / remove / replaceAll` 인터페이스만 사용하므로, `js/store.js`의 어댑터만 교체하면 됩니다.

1. 스프레드시트에 컬렉션별 시트 생성: `users`, `weeklyReports`, `receivableLinks`, `exchangeRates`, `trips`, `meetings`, `dealers`, `dealerMetrics`, `notifyRecipients`, `notifyLog` (1행 = 헤더).
2. Apps Script(확장 프로그램 > Apps Script)에 웹앱 작성:

```javascript
function doGet(e) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(e.parameter.collection);
  var rows = sheet.getDataRange().getValues();
  var head = rows.shift();
  var list = rows.map(function (r) {
    var o = {}; head.forEach(function (h, i) { o[h] = r[i]; }); return o;
  });
  return ContentService.createTextOutput(JSON.stringify(list))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var body = JSON.parse(e.postData.contents); // {op, collection, record|list|id}
  // op별로 시트 행 추가/수정/삭제 구현
  return ContentService.createTextOutput('ok');
}
```

3. "배포 > 새 배포 > 웹 앱"으로 배포(액세스: 조직 내) 후 URL 확보.
4. `index.html` 초기화 직전에 어댑터 교체:

```javascript
Store.use(GoogleSheetsAdapter('https://script.google.com/macros/s/…/exec'));
```

`GoogleSheetsAdapter` 골격은 `js/store.js`에 포함되어 있습니다. (Supabase의 경우 `from(컬렉션).select/upsert/delete`를 같은 4개 메서드에 매핑하면 됩니다.)

### 2) 주간업무 자동 메일 (Apps Script MailApp)

현재 [알림 발송]은 발송 로그 기록 + mailto 초안까지 수행합니다. 실제 자동 발송은 위 웹앱에 아래 함수를 추가하고, `app.js`의 `sendNotification()`에서 mailto 대신 `fetch(웹앱URL, {method:'POST', …})`를 호출하도록 바꾸면 됩니다.

```javascript
function sendWeeklyMail(recipients, subject, body) {
  MailApp.sendEmail({ to: recipients.join(','), subject: subject, body: body });
}
```

수신자 목록은 포털 화면에서 편집한 값(`notifyRecipients`)이 그대로 전달됩니다.

### 3) Efam 폴더 경로 등록법

- Efam이 **사내 네트워크 드라이브**인 경우: 탐색기에서 대상 폴더 주소를 복사해 `\\efam\해외영업\경과채권\…` 형태(UNC)로 등록 → 포털에서는 [경로 복사]로 사용. (브라우저는 보안상 UNC를 직접 열 수 없습니다.)
- Efam이 **클라우드(구글드라이브 등)** 인 경우: 파일/폴더의 공유 링크(`https://…`)를 등록 → [새 탭 열기]로 즉시 이동.
- 매월 파일이 갱신되면 링크의 파일명만 수정하면 됩니다 (갱신일 자동 기록).

## 배포 (GitHub Pages)

1. GitHub 저장소 → Settings → Pages
2. Source: `Deploy from a branch`, Branch: 배포할 브랜치 / root 선택
3. 저장 후 `https://<계정>.github.io/<저장소>/` 접속

빌드 과정이 없으므로 추가 설정 없이 그대로 동작합니다. (한글 파일명 `templates/딜러실적_양식.xlsx`도 Pages에서 정상 제공됩니다.)

## 테스트

```bash
# 순수 로직 테스트 (주차 계산 / 매출 집계 / 환율 검증 / 권한 / 엑셀 행 검증·병합)
node test/logic.test.js

# 문법 검사
node --check js/logic.js js/store.js js/app.js js/seed.js
```
