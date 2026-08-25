-- ============================================================================
-- hd-project05 — 해외영업 딜러 대시보드 + 팀 업무 포털
-- Supabase(Postgres) 운영 스키마 + RLS · 재실행 안전
--
--  이 스키마는 **수강생 본인의 Supabase 프로젝트**에 올리는 것을 전제로 합니다.
--  프로젝트가 본인 것이라 테이블 이름에 접두사를 붙이지 않았습니다.
--  (여러 앱을 한 프로젝트에 몰아 쓸 계획이면 이름 충돌을 먼저 확인하세요.)
--
--  이 프로젝트는 **팀이 함께 쓰는 포털**이라 localStorage 로는 목적을 못 이룹니다.
--  주간업무·환율·출장일정은 서로 보여야 의미가 있습니다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 테이블
-- ----------------------------------------------------------------------------

-- 팀원
create table if not exists public.member (
  user_id    uuid primary key,
  name       text not null,
  email      text,
  role       text not null default '팀원' check (role in ('팀원', '책임자')),
  region     text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.dealer (
  code       text primary key,
  name       text not null,
  country    text,
  region     text,
  manager    text,
  currency   text default 'USD',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists dealer_region_idx on public.dealer (region);

-- 딜러 실적 — 엑셀 업로드 양식과 1:1
create table if not exists public.dealer_metrics (
  id              bigint generated always as identity primary key,
  dealer_code     text not null references public.dealer(code) on delete cascade,
  period          text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  sales           numeric not null default 0,
  inventory       numeric not null default 0,
  receivable      numeric not null default 0,   -- 채권잔액
  overdue         numeric not null default 0,   -- 경과채권
  -- 경과채권이 채권잔액보다 클 수 없다. 엑셀에서 열을 잘못 맞추면 실제로 이렇게 들어온다.
  constraint metrics_overdue_le_receivable check (overdue <= receivable),
  terms_summary   text,
  updated_at      timestamptz not null default now(),
  -- ⚠ 프런트 upsert 는 onConflict 를 이 조합으로 지정할 것.
  constraint metrics_uniq unique (dealer_code, period)
);
create index if not exists metrics_period_idx on public.dealer_metrics (period desc);

create table if not exists public.weekly_report (
  id          bigint generated always as identity primary key,
  week        text not null check (week ~ '^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$'),
  author_id   uuid default auth.uid(),
  author_name text,
  region      text,
  summary     text not null,
  sales_week  numeric,
  issues      text,
  next_plan   text,
  created_at  timestamptz not null default now()
);
create index if not exists weekly_idx on public.weekly_report (week desc);

create table if not exists public.receivable_link (
  id          bigint generated always as identity primary key,
  scope       text not null,                    -- 법인 또는 딜러
  file_name   text not null,
  url         text,
  updated_on  date,
  created_at  timestamptz not null default now()
);

create table if not exists public.fx_rate (
  id         bigint generated always as identity primary key,
  period     text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  currency   text not null,
  rate       numeric not null check (rate > 0),
  entered_by uuid default auth.uid(),
  entered_at timestamptz not null default now(),
  constraint fx_uniq unique (period, currency)
);

create table if not exists public.trip (
  id          bigint generated always as identity primary key,
  member_name text not null,
  country     text,
  city        text,
  start_date  date not null,
  end_date    date not null,
  purpose     text,
  dealers     text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  -- 종료일이 시작일보다 앞설 수 없다. 달력 화면이 조용히 깨지는 원인이 된다.
  constraint trip_dates check (end_date >= start_date)
);
create index if not exists trip_date_idx on public.trip (start_date);

create table if not exists public.meeting (
  id         bigint generated always as identity primary key,
  held_at    timestamptz not null,
  place      text,
  agenda     text not null,
  attendees  text,
  notes      text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists meeting_idx on public.meeting (held_at desc);

create table if not exists public.log (
  id        bigint generated always as identity primary key,
  ran_at    timestamptz not null default now(),
  kind      text not null,
  detail    text,
  processed int not null default 0,
  failed    int not null default 0,
  actor     uuid default auth.uid()
);
create index if not exists log_ran_at_idx on public.log (ran_at desc);

create table if not exists public.admin (
  user_id uuid primary key, email text, created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2. 함수
-- ----------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.admin a where a.user_id = auth.uid()
    union all
    select 1 from public.member m where m.user_id = auth.uid() and m.role = '책임자'
  );
$fn$;

create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.member m where m.user_id = auth.uid() and m.active);
$fn$;

create or replace function public.touch()
returns trigger language plpgsql set search_path = public as $fn$
begin new.updated_at := now(); return new; end;
$fn$;

drop trigger if exists metrics_touch on public.dealer_metrics;
create trigger metrics_touch before update on public.dealer_metrics
  for each row execute function public.touch();

-- ----------------------------------------------------------------------------
-- 3. 뷰
-- ----------------------------------------------------------------------------


-- ⚠ 뷰에는 `with (security_invoker = true)` 를 붙인다.
--   붙이지 않으면 뷰는 **만든 사람(postgres)의 권한**으로 돌아, 뷰를 읽을 수 있는
--   사람이 밑에 깔린 표의 RLS 를 통째로 지나친다. 표만 잠그고 뷰를 안 잠그면 헛일이다.
--   (hd-project03 에서 실제로 남의 업체 실사 결과가 뷰로 그대로 보였다.
--    tests/server.test.js 의 "업체는 보고서 뷰로도 남의 자료를 볼 수 없다" 가 잡는다)
--   security_invoker 는 PostgreSQL 15 부터. Supabase 는 15 이상이다.
create or replace view public.dealer_dashboard with (security_invoker = true) as
select
  d.code, d.name, d.country, d.region, d.currency,
  m.period, m.sales, m.inventory, m.receivable, m.overdue, m.terms_summary,
  -- 경과채권 비율 — 딜러 미팅에서 가장 먼저 보는 값
  case when m.receivable > 0
       then round(m.overdue * 100 / m.receivable, 1) else null end as overdue_rate,
  f.rate as fx_rate,
  case when f.rate is not null then round(m.sales * f.rate) else null end as sales_krw
from public.dealer d
join public.dealer_metrics m on m.dealer_code = d.code
left join public.fx_rate f on f.period = m.period and f.currency = d.currency;

create or replace view public.region_summary with (security_invoker = true) as
select period, coalesce(region, '(미지정)') as region,
       count(*)         as dealers,
       sum(sales)       as sales,
       sum(receivable)  as receivable,
       sum(overdue)     as overdue,
       case when sum(receivable) > 0
            then round(sum(overdue) * 100 / sum(receivable), 1) else null end as overdue_rate
from public.dealer_dashboard
group by period, coalesce(region, '(미지정)');

-- 환율이 없는 딜러·기간 — 원화 환산이 조용히 비는 것을 드러낸다
create or replace view public.missing_fx with (security_invoker = true) as
select distinct m.period, d.currency
from public.dealer_metrics m
join public.dealer d on d.code = m.dealer_code
where not exists (
  select 1 from public.fx_rate f where f.period = m.period and f.currency = d.currency);

-- ----------------------------------------------------------------------------
-- 4. RLS — 팀 내부 도구. 읽기는 팀원, 쓰기는 팀원(본인 글)·수정삭제는 작성자/책임자
-- ----------------------------------------------------------------------------

alter table public.member          enable row level security;
alter table public.dealer          enable row level security;
alter table public.dealer_metrics  enable row level security;
alter table public.weekly_report   enable row level security;
alter table public.receivable_link enable row level security;
alter table public.fx_rate         enable row level security;
alter table public.trip            enable row level security;
alter table public.meeting         enable row level security;
alter table public.log             enable row level security;
alter table public.admin           enable row level security;

-- 마스터성 자료 — 읽기는 팀원, 쓰기는 책임자
do $rls$
declare t text;
begin
  foreach t in array array['dealer','dealer_metrics','receivable_link','fx_rate']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_read',   t);
    execute format('drop policy if exists %I on public.%I', t || '_write',  t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_member())', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_admin())', t || '_write', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_admin())', t || '_delete', t);
  end loop;
end;
$rls$;

-- 팀원이 직접 쓰는 것 — 누구나 읽고 쓰되, 고치고 지우는 것은 작성자와 책임자만.
-- 남의 주간보고를 아무나 고칠 수 있으면 기록으로서 의미가 없다.
do $rls$
declare t text; owner_col text;
begin
  foreach t in array array['weekly_report','trip','meeting']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_read',   t);
    execute format('drop policy if exists %I on public.%I', t || '_write',  t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_member())', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_member())', t || '_write', t);
    -- 소유자 컬럼 이름이 표마다 다르다. 주간보고는 author_id, 나머지는 created_by.
    -- coalesce 로 두 이름을 같이 쓰면 없는 컬럼을 참조해 스키마 적용이 통째로 실패한다.
    owner_col := case when t = 'weekly_report' then 'author_id' else 'created_by' end;
    execute format($f$create policy %I on public.%I for update to authenticated
                       using (public.is_admin() or %I = auth.uid())
                       with check (public.is_admin() or %I = auth.uid())$f$,
                   t || '_update', t, owner_col, owner_col);
    execute format($f$create policy %I on public.%I for delete to authenticated
                       using (public.is_admin() or %I = auth.uid())$f$,
                   t || '_delete', t, owner_col);
  end loop;
end;
$rls$;

drop policy if exists member_read   on public.member;
drop policy if exists member_write  on public.member;
drop policy if exists member_update on public.member;
drop policy if exists member_delete on public.member;
create policy member_read   on public.member for select to authenticated using (public.is_member());
create policy member_write  on public.member for insert to authenticated with check (public.is_admin());
create policy member_update on public.member for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy member_delete on public.member for delete to authenticated using (public.is_admin());

drop policy if exists log_read  on public.log;
drop policy if exists log_write on public.log;
create policy log_read  on public.log for select to authenticated using (public.is_member());
create policy log_write on public.log for insert to authenticated with check (true);

drop policy if exists admin_read on public.admin;
create policy admin_read on public.admin for select to authenticated using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 5. 함수 실행 권한 (§3.7)
-- ----------------------------------------------------------------------------

revoke all on function public.is_admin()  from public, anon;
revoke all on function public.is_member() from public, anon;
revoke all on function public.touch()     from public, anon;

grant execute on function public.is_admin()  to authenticated;
grant execute on function public.is_member() to authenticated;
grant execute on function public.touch()     to authenticated;

-- ----------------------------------------------------------------------------
-- 끝. 팀원 등록:
--   insert into public.member (user_id, name, email, role)
--   select id, '<이름>', email, '책임자' from auth.users where email = '<이메일>'
--   on conflict (user_id) do nothing;
-- ----------------------------------------------------------------------------

-- ===============================================================
-- 팀 공용 문서 (hd-docsync.js 용)
--
--   이 표 하나에 앱의 JSON 문서를 통째로 담아 팀원이 같은 것을 본다.
--   팀 내부 도구 — 어차피 서로 다 보는 화면 — 에만 쓴다.
--   사람마다 볼 범위가 달라야 하는 화면에는 쓸 수 없다(모두가 전부를 받게 된다).
-- ===============================================================

create table if not exists workspace (
  id         text primary key,
  doc        jsonb not null default '{}'::jsonb,
  -- 동시 편집으로 남의 작업이 조용히 사라지지 않게 하는 장치.
  -- 저장할 때 "내가 받아 온 버전"과 같은지 확인하고, 다르면 쓰지 않는다.
  version    bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

alter table workspace enable row level security;

drop policy if exists workspace_read   on workspace;
drop policy if exists workspace_write  on workspace;
drop policy if exists workspace_update on workspace;
drop policy if exists workspace_delete on workspace;

-- 팀 내부 도구라 로그인한 사람은 읽고 쓴다.
-- 더 좁히려면 아래 정책의 using/with check 를 조직 규칙에 맞게 바꾸면 된다.
create policy workspace_read   on workspace for select to authenticated using (true);
create policy workspace_write  on workspace for insert to authenticated with check (true);
create policy workspace_update on workspace for update to authenticated using (true) with check (true);
-- DELETE 정책은 두지 않는다. 팀 자료를 화면에서 통째로 지울 수 있으면 안 된다.
