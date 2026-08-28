# Parts Sales Dashboard 추가 (최율아 AM영업팀 수정요청)

## 한 일
- 최율아 님(AM영업팀)이 메일로 보낸 수정 요청(HD-PROJECT05_수정요청_내용.pptx) + 목표 화면 레퍼런스(DealerDashboard.html)를 반영.
- 레퍼런스 HTML이 이미 완성된 단일 파일 도구였으므로, 로직은 그대로 두고 리포 표준에 맞게 통합:
  - `parts-sales-dashboard.html` 신규 페이지로 추가 (기존 "딜러 미팅 대시보드"와는 별개 — 부품 매출/Oil·Attachment·VM 실적용).
  - SheetJS CDN(cdnjs) → 리포 동봉 `lib/xlsx.full.min.js`로 교체 (폐쇄망 대응 방침, CLAUDE.md §5.3).
  - Google Fonts(Nunito) CDN 제거 → Pretendard 시스템 폰트 스택으로 교체 ("글꼴은 바깥에서 받아오지 않는다" 방침).
  - `<meta name="robots" content="noindex, nofollow">` + 파비콘 추가, 포털로 돌아가는 back-link 추가.
  - `index.html` 사이드바에 "Parts Sales 대시보드" 메뉴 추가 + 기존 딜러 미팅 대시보드 뷰에 안내 링크 추가.
- 기능(엑셀 업로드 B3:Y17 · 지역별/딜러별 KPI · CANELLA Genuine Oil 경고 · Alerts)은 정본(DealerDashboard.html) 그대로 이식 — 이미 14개 딜러 행 범위(B4:B17)로 설계돼 있어 별도 로직 변경 불필요.

## 확인
- `node test/logic.test.js` 30개 통과 (기존 데이터 모델·로직 미변경 확인).
- 새 페이지 인라인 스크립트 `node --check`로 문법 검증 통과.
- `tests/server.test.js`(SQL 하네스)는 로컬 PG 환경변수 필요 — 이번 변경이 DB/logic을 안 건드려 재실행 생략.

## 확신 못 하고 넘어간 부분
- pptx 첨부(HD-PROJECT05_수정요청_내용.pptx)는 이진 포맷이라 이번 세션에서 텍스트 추출을 시도하지 못했다 — 실제 반영 근거는 DealerDashboard.html(발신자가 "글자 설명엔 한계가 있다"며 보낸 목표 화면 그대로)로 삼았다. pptx에 별도 지시가 있었다면 놓쳤을 수 있다.
- 스크린샷상 Regional 뷰가 12개 딜러 로고 → 14개 딜러 로고로 늘어난 것으로 보였는데, 실제로는 데이터 upload 전이라 로고 개수가 아니라 "업로드된 딜러 수"에 달려 있다(코드상 하드코딩된 로고 목록은 처음부터 14개 전부 정의돼 있었음). 즉 기능 결함이 아니라 두 이메일 캡처 시점의 업로드 데이터 차이였다.
