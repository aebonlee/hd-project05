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

create or replace view public.dealer_dashboard as
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

create or replace view public.region_summary as
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
create or replace view public.missing_fx as
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
