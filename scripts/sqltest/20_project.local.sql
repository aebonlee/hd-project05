-- 로컬 검증 전용 — hd-project05 (운영 실행 금지)
do $guard$
begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin','authenticator'))
     or exists (select 1 from pg_namespace where nspname='graphql') then
    raise exception '이 파일은 로컬 검증 전용입니다.';
  end if;
end;
$guard$;

do $t$ begin raise notice '[프로젝트] 채권 제약 · 환율 환산 · 작성자 권한'; end $t$;

do $t$
declare v_r boolean;
begin
  insert into public.dealer (code, name, country, region, currency) values
    ('D-1','알파딜러','미국','북미','USD'),
    ('D-2','베타딜러','독일','유럽','EUR')
  on conflict (code) do nothing;

  insert into public.dealer_metrics (dealer_code, period, sales, receivable, overdue)
  values ('D-1','2026-08', 1000, 500, 100) on conflict (dealer_code, period) do update set sales=excluded.sales;
  insert into public.dealer_metrics (dealer_code, period, sales, receivable, overdue)
  values ('D-2','2026-08', 800, 400, 0)   on conflict (dealer_code, period) do nothing;

  -- 엑셀에서 열을 잘못 맞추면 실제로 이렇게 들어온다
  v_r := false;
  begin
    insert into public.dealer_metrics (dealer_code, period, sales, receivable, overdue)
    values ('D-1','2026-07', 100, 50, 999);
  exception when check_violation then v_r := true;
  end;
  perform public._assert(v_r, '경과채권이 채권잔액보다 크면 check 제약이 막는다');

  perform public._assert_eq(
    (select overdue_rate from public.dealer_dashboard where code='D-1' and period='2026-08'),
    20.0::numeric, '경과채권 비율 = 100/500 = 20%');

  -- 환율이 없으면 원화 환산은 null 이어야 한다 (0 으로 채우면 실적이 0 으로 보인다)
  perform public._assert(
    (select sales_krw from public.dealer_dashboard where code='D-1' and period='2026-08') is null,
    '환율이 없으면 원화 환산은 null (0 이 아니다)');
  perform public._assert_eq(
    (select count(*) from public.missing_fx where period='2026-08'), 2::bigint,
    '환율 누락이 별도 뷰로 드러난다');

  insert into public.fx_rate (period, currency, rate) values ('2026-08','USD', 1350)
  on conflict (period, currency) do update set rate = excluded.rate;
  perform public._assert_eq(
    (select sales_krw from public.dealer_dashboard where code='D-1' and period='2026-08'),
    1350000::numeric, '환율을 넣으면 원화 환산이 채워진다');

  perform public._assert_eq(
    (select overdue_rate from public.region_summary where period='2026-08' and region='북미'),
    20.0::numeric, '지역 요약에도 경과채권 비율이 잡힌다');

  v_r := false;
  begin
    insert into public.fx_rate (period, currency, rate) values ('2026-08','USD', 1400);
  exception when unique_violation then v_r := true;
  end;
  perform public._assert(v_r, '같은 달·통화 환율 중복은 UNIQUE 가 막는다');

  v_r := false;
  begin
    insert into public.fx_rate (period, currency, rate) values ('2026-08','JPY', -1);
  exception when check_violation then v_r := true;
  end;
  perform public._assert(v_r, '음수 환율은 check 제약이 막는다');

  v_r := false;
  begin
    insert into public.trip (member_name, start_date, end_date)
    values ('홍길동','2026-09-10','2026-09-01');
  exception when check_violation then v_r := true;
  end;
  perform public._assert(v_r, '종료일이 시작일보다 앞서면 check 제약이 막는다');

  v_r := false;
  begin
    insert into public.weekly_report (week, summary) values ('2026-W99','x');
  exception when check_violation then v_r := true;
  end;
  perform public._assert(v_r, '없는 주차 표기는 check 제약이 막는다');
end $t$;

-- 작성자 본인만 고칠 수 있는가 (정책 식에 auth.uid() 비교가 들어 있는가)
do $t$
declare v_bad text;
begin
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname in ('weekly_report','trip','meeting')
     and not exists (
       select 1 from pg_policy p
        where p.polrelid=c.oid and p.polcmd='w'
          and pg_get_expr(p.polqual, p.polrelid) like '%uid()%');
  perform public._assert(v_bad is null,
    '팀원이 쓰는 표의 수정 정책에 작성자 조건이 있다' || coalesce(' (누락: '||v_bad||')',''));
end $t$;

do $t$
declare v_cnt int;
begin
  -- 딜러 실적은 책임자만 고칠 수 있어야 한다
  select count(*) into v_cnt from pg_policy p join pg_class c on c.oid=p.polrelid
   where c.relname='dealer_metrics' and p.polcmd='w'
     and pg_get_expr(p.polqual, p.polrelid) like '%is_admin%';
  perform public._assert(v_cnt > 0, '딜러 실적 수정은 책임자만 가능하다');
end $t$;

delete from public.fx_rate where period='2026-08';
delete from public.dealer where code in ('D-1','D-2');

do $t$ begin raise notice ''; raise notice '전부 통과했습니다.'; end $t$;
