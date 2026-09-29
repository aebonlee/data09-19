-- ============================================================================
-- 로컬 검증 전용 — data09-19 프로젝트별 검증 (운영 실행 금지, 가드 내장)
--
--  사용자 A·B·비로그인(anon) 세 역할로 번갈아 들어가
--  RLS 격리 · 제약 · 변경 기록 트리거 · 기록성 표 · 함수 권한을 실제로 확인한다.
-- ============================================================================
do $guard$
begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin', 'authenticator'))
     or exists (select 1 from pg_namespace where nspname = 'graphql') then
    raise exception '이 파일은 로컬 검증 전용입니다. 운영 데이터베이스에서 실행할 수 없습니다.';
  end if;
end;
$guard$;

-- 보조 함수 — 이름이 _assert 로 시작해 공통 권한 검사에서 제외된다.
create or replace function public._assert_raises(p_sql text, p_state text, p_label text)
returns void language plpgsql set search_path = public as $fn$
declare v_state text;
begin
  begin
    execute p_sql;
  exception when others then
    v_state := sqlstate;
  end;
  if v_state = p_state then raise notice '  OK   %', p_label;
  else raise exception 'FAIL  %  (기대 SQLSTATE %, 실제 %)', p_label, p_state, coalesce(v_state, '성공함');
  end if;
end;
$fn$;

create or replace function public._assert_rows(p_sql text, p_rows int, p_label text)
returns void language plpgsql set search_path = public as $fn$
declare v_n int;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  perform public._assert_eq(v_n, p_rows, p_label);
end;
$fn$;

-- A = 옵션 관리 담당자 / B = 다른 사용자
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b@example.com')
on conflict (id) do nothing;

-- ── 사용자 A ───────────────────────────────────────────────────
set role authenticated;
do $t$ begin perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false); end $t$;

do $t$ begin raise notice '[프로젝트] 사용자 A 입력 · 제약'; end $t$;
do $t$
declare v_cust bigint; v_lamp bigint; v_suffix bigint; v_mt bigint;
begin
  insert into public.catalog_field (field_key, name, kind, type, required, sort_order)
    values ('f_customer', '고객사', 'base', 'text', true, 0) returning id into v_cust;
  insert into public.catalog_field (field_key, name, kind, type, sort_order)
    values ('f_suffix', 'engine suffix', 'base', 'text', 1) returning id into v_suffix;
  insert into public.catalog_field (field_key, name, kind, type, sort_order)
    values ('f_mtype', 'Machine type', 'base', 'select', 2) returning id into v_mt;
  insert into public.catalog_field (field_key, name, kind, type, sort_order)
    values ('f1', 'check engine lamp', 'option', 'select', 3) returning id into v_lamp;
  perform set_config('test.a_lamp', v_lamp::text, false);
  perform set_config('test.a_suffix', v_suffix::text, false);

  insert into public.catalog_choice (field_id, choice_key, label, sort_order) values
    (v_lamp, 'c1', 'CAN type', 0),
    (v_lamp, 'c2', 'HW type', 1),
    (v_mt,   'c_exc', 'Excavator', 0),
    (v_mt,   'c_whl', 'Wheel loader', 1);
  insert into public.catalog_rule (rule_key, target_key, when_key, choice_keys)
    values ('rule1', 'f1', 'f_mtype', array['c_exc']);
  insert into public.option_record (record_key, v, is_sample)
    values ('r1', '{"f_customer": "예시고객", "f_suffix": "A01", "f_mtype": "c_exc", "f1": "c1"}', true);
  insert into public.column_mapping (mapping) values ('{"고객사": "f_customer", "Check Engine Lamp": "f1"}');

  perform public._assert_eq((select owner_id from public.catalog_field where id = v_cust),
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'owner_id 가 auth.uid() 로 자동으로 채워진다');

  -- UNIQUE · upsert
  perform public._assert_raises(
    $q$insert into public.catalog_field (field_key, name, kind, type) values ('f1', '다른 이름', 'option', 'select')$q$,
    '23505', '같은 항목 키(field_key)는 두 번 들어가지 않는다');
  perform public._assert_raises(
    $q$insert into public.catalog_field (field_key, name, kind, type) values ('f9', 'Check_Engine-Lamp', 'option', 'select')$q$,
    '23505', '대소문자·공백·밑줄·하이픈만 다른 항목 이름은 같은 항목이다');
  perform public._assert_raises(format(
    $q$insert into public.catalog_choice (field_id, choice_key, label) values (%s, 'c9', 'can-TYPE')$q$, v_lamp),
    '23505', '한 항목 안에서 표기만 다른 선택지는 같은 선택지다');
  perform public._assert_raises(format(
    $q$insert into public.catalog_choice (field_id, choice_key, label) values (%s, 'c1', '새 선택지')$q$, v_mt),
    '23505', '선택지 키는 한 사용자 안에서 겹치지 않는다');
  insert into public.option_record (record_key, v) values ('r1', '{"f_customer": "고친고객"}')
    on conflict (owner_id, record_key) do update set v = excluded.v;
  perform public._assert_eq((select v->>'f_customer' from public.option_record where record_key = 'r1'),
    '고친고객', 'onConflict (owner_id, record_key) upsert 가 갱신으로 동작한다');
  perform public._assert_raises(
    $q$insert into public.column_mapping (mapping) values ('{}')$q$,
    '23505', '열 연결은 사용자당 한 행이다');
  perform public._assert_raises(
    $q$insert into public.catalog_rule (rule_key, target_key, when_key, choice_keys) values ('rule2', 'f1', 'f_mtype', array['c_whl'])$q$,
    '23505', '같은 (옵션, 조건 항목) 규칙은 두 번 만들 수 없다');

  -- CHECK (도구 규칙)
  perform public._assert_raises(
    $q$insert into public.catalog_field (field_key, name, kind, type) values ('f8', '옵션 글자', 'option', 'text')$q$,
    '23514', '옵션 항목은 선택 목록(select)이어야 한다');
  perform public._assert_raises(
    $q$insert into public.catalog_field (field_key, name, kind, type) values ('x1', '잘못된 키', 'base', 'text')$q$,
    '23514', '항목 키는 f 로 시작해야 한다');
  perform public._assert_raises(
    $q$insert into public.catalog_field (field_key, name, kind, type) values ('f7', '   ', 'base', 'text')$q$,
    '23514', '빈 항목 이름은 받지 않는다');
  perform public._assert_raises(
    $q$insert into public.option_record (record_key, v) values ('r2', '{"f_customer": "  ", "f1": "c1"}')$q$,
    '23514', '고객사가 빈 레코드는 받지 않는다');
  perform public._assert_raises(
    $q$insert into public.option_record (record_key, v) values ('r3', '["배열"]')$q$,
    '23514', '레코드 값은 객체(jsonb object)여야 한다');
  perform public._assert_raises(
    $q$insert into public.catalog_rule (rule_key, target_key, when_key, choice_keys) values ('rule3', 'f1', 'f1', array['c1'])$q$,
    '23514', '항목이 자기 자신을 조건으로 삼을 수 없다');
  perform public._assert_raises(
    $q$insert into public.catalog_rule (rule_key, target_key, when_key, choice_keys) values ('rule4', 'f1', 'f_suffix', array[]::text[])$q$,
    '23514', '적용 조건에는 선택지가 하나 이상 있어야 한다');

  -- 선택지는 본인의 선택 목록 항목에만 붙는다
  perform public._assert_raises(format(
    $q$insert into public.catalog_choice (field_id, choice_key, label) values (%s, 'c7', '글자 항목의 선택지')$q$, v_suffix),
    '42501', '글자(text) 항목에는 선택지를 붙일 수 없다');

  update public.catalog_field set updated_at = '2000-01-01' where id = v_cust;
  perform public._assert((select updated_at > '2001-01-01' from public.catalog_field where id = v_cust),
    '수정하면 updated_at 트리거가 현재 시각으로 바꾼다');
end $t$;

-- ── 변경 기록 트리거 ───────────────────────────────────────────
do $t$ begin raise notice '[프로젝트] 변경 기록(change_log) — 트리거가 실제로 남기는가'; end $t$;
do $t$
declare v_n int;
begin
  perform public._assert_eq(
    (select count(*)::int from public.change_log where table_name = 'catalog_field' and op = 'insert'),
    4, '항목 4개를 만들면 catalog_field insert 기록이 4건 남는다');
  perform public._assert_eq(
    (select count(*)::int from public.change_log where table_name = 'catalog_choice' and op = 'insert'),
    4, '선택지 4개를 만들면 catalog_choice insert 기록이 4건 남는다');
  perform public._assert_eq(
    (select count(*)::int from public.change_log where table_name = 'catalog_rule' and row_key = 'rule1'),
    1, '적용 조건을 만들면 catalog_rule 기록이 남는다(row_key = rule_key)');
  perform public._assert_eq(
    (select count(*)::int from public.change_log where table_name = 'column_mapping'),
    0, '열 연결(column_mapping)은 기록 대상이 아니다');

  -- 레코드 upsert(갱신)는 before/after 를 함께 남긴다
  perform public._assert(
    exists (select 1 from public.change_log
             where table_name = 'option_record' and row_key = 'r1' and op = 'update'
               and before->'v'->>'f_customer' = '예시고객' and after->'v'->>'f_customer' = '고친고객'),
    '레코드 수정은 before(예시고객)·after(고친고객)를 함께 기록한다');

  -- 선택지 이름 변경
  update public.catalog_choice set label = 'CAN 방식' where choice_key = 'c1';
  perform public._assert(
    exists (select 1 from public.change_log
             where table_name = 'catalog_choice' and row_key = 'c1' and op = 'update'
               and before->>'label' = 'CAN type' and after->>'label' = 'CAN 방식'),
    '선택지 이름을 고치면 이전·이후 이름이 기록된다');

  -- 삭제 — 원래 행이 사라져도 기록은 남는다
  delete from public.option_record where record_key = 'r1';
  perform public._assert(
    exists (select 1 from public.change_log
             where table_name = 'option_record' and row_key = 'r1' and op = 'delete'
               and before is not null and after is null),
    '레코드를 지우면 delete 기록(before 만)이 남는다');

  -- 기록의 주인은 행의 주인이다
  perform public._assert(
    (select bool_and(owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid) from public.change_log),
    '변경 기록의 owner_id 는 A 다');

  select count(*) into v_n from public.change_log;
  perform set_config('test.a_log_n', v_n::text, false);
end $t$;

do $t$ begin raise notice '[프로젝트] 기록성 표(change_log)'; end $t$;
do $t$
declare v_n int := current_setting('test.a_log_n')::int;
begin
  perform public._assert_rows($q$update public.change_log set op = 'insert'$q$,
    0, 'change_log 는 본인도 UPDATE 할 수 없다(0행)');
  perform public._assert_rows('delete from public.change_log',
    0, 'change_log 는 본인도 DELETE 할 수 없다(0행)');
  perform public._assert_eq((select count(*)::int from public.change_log), v_n,
    'change_log 기록이 그대로 남아 있다');
  perform public._assert_eq(
    (select count(*)::int from public.change_log where op = 'insert' and table_name = 'option_record' and row_key = 'r1'),
    1, 'change_log 의 op 값도 바뀌지 않았다');
  perform public._assert_raises(
    $q$insert into public.change_log (table_name, row_key, op) values ('column_mapping', 'x', 'insert')$q$,
    '23514', 'change_log 는 기록 대상 4개 표 이름만 받는다');
end $t$;

-- ── 사용자 B ───────────────────────────────────────────────────
do $t$ begin perform set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false); end $t$;

do $t$ begin raise notice '[프로젝트] RLS — B 는 A 의 자료에 손대지 못한다'; end $t$;
do $t$
declare
  t text;
  v_lamp text := current_setting('test.a_lamp');
begin
  foreach t in array array['catalog_field', 'catalog_choice', 'catalog_rule', 'option_record',
                           'column_mapping', 'change_log']
  loop
    perform public._assert_rows(format('select 1 from public.%I', t), 0, 'B 에게 A 의 ' || t || ' 가 안 보인다');
  end loop;
  perform public._assert_rows($q$update public.catalog_field set name = '탈취' where field_key = 'f1'$q$,
    0, 'B 는 A 의 항목을 고칠 수 없다(0행)');
  perform public._assert_rows($q$delete from public.catalog_choice$q$,
    0, 'B 는 A 의 선택지를 지울 수 없다(0행)');
  perform public._assert_rows($q$update public.column_mapping set mapping = '{}'$q$,
    0, 'B 는 A 의 열 연결을 고칠 수 없다(0행)');
  perform public._assert_raises(format(
    $q$insert into public.catalog_choice (field_id, choice_key, label) values (%s, 'c_b', '끼워 넣기')$q$, v_lamp),
    '42501', 'B 는 A 의 항목에 선택지를 끼워 넣을 수 없다');
  perform public._assert_raises(
    $q$insert into public.option_record (owner_id, record_key, v) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'r50', '{"f_customer": "위장"}')$q$,
    '42501', 'B 는 owner_id 를 A 로 위장해 레코드를 넣을 수 없다');
  perform public._assert_raises(
    $q$insert into public.change_log (owner_id, table_name, row_key, op) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'option_record', 'r1', 'delete')$q$,
    '42501', 'B 는 A 의 이름으로 변경 기록을 꾸며 넣을 수 없다');

  -- B 도 같은 키·같은 이름으로 자기 카탈로그를 만들 수 있다(사용자별 이름 공간)
  insert into public.catalog_field (field_key, name, kind, type) values ('f1', 'check engine lamp', 'option', 'select');
  perform public._assert_rows('select 1 from public.catalog_field', 1, 'B 는 자기 항목 1개만 본다');
  perform public._assert_rows('select 1 from public.change_log', 1, 'B 는 자기 변경 기록 1건만 본다');
end $t$;

-- ── 비로그인(anon) ─────────────────────────────────────────────
reset role;
set role anon;
do $t$ begin perform set_config('request.jwt.claim.sub', '', false); end $t$;

do $t$ begin raise notice '[프로젝트] anon 차단'; end $t$;
do $t$
declare t text;
begin
  foreach t in array array['catalog_field', 'catalog_choice', 'catalog_rule', 'option_record',
                           'column_mapping', 'change_log']
  loop
    perform public._assert_rows(format('select 1 from public.%I', t), 0, 'anon 에게 ' || t || ' 가 안 보인다');
  end loop;
  perform public._assert_raises(
    $q$insert into public.catalog_field (owner_id, field_key, name, kind, type) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f99', 'x', 'base', 'text')$q$,
    '42501', 'anon 은 항목을 만들 수 없다');
  perform public._assert_raises(
    $q$insert into public.option_record (owner_id, record_key, v) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'r99', '{"f_customer": "x"}')$q$,
    '42501', 'anon 은 레코드를 넣을 수 없다');
  perform public._assert_raises(
    $q$insert into public.change_log (owner_id, table_name, row_key, op) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'option_record', 'r1', 'insert')$q$,
    '42501', 'anon 은 변경 기록을 쓸 수 없다');
  perform public._assert_rows($q$update public.catalog_field set name = 'x'$q$, 0, 'anon 은 항목을 고칠 수 없다(0행)');
  perform public._assert_rows($q$delete from public.option_record$q$, 0, 'anon 은 레코드를 지울 수 없다(0행)');
  perform public._assert_raises($q$select public.set_updated_at()$q$, '42501', 'anon 은 set_updated_at() 을 실행할 수 없다');
  perform public._assert_raises($q$select public.log_change()$q$,     '42501', 'anon 은 log_change() 를 실행할 수 없다');
end $t$;

reset role;

-- 삭제 연쇄(on delete cascade)도 기록되는가 — A 의 항목을 지우면 딸린 선택지 삭제도 남는다
set role authenticated;
do $t$ begin perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false); end $t$;
do $t$ begin raise notice '[프로젝트] 항목 삭제 → 선택지 연쇄 삭제 기록'; end $t$;
do $t$ begin
  delete from public.catalog_field where field_key = 'f1';
  perform public._assert_rows($q$select 1 from public.catalog_choice where choice_key in ('c1', 'c2')$q$,
    0, '항목을 지우면 딸린 선택지도 지워진다');
  perform public._assert_eq(
    (select count(*)::int from public.change_log where table_name = 'catalog_choice' and op = 'delete'
       and row_key in ('c1', 'c2') and owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
    2, '연쇄로 지워진 선택지 2개도 A 의 변경 기록에 남는다');
end $t$;
reset role;

-- ── 구조 · 함수 ACL ────────────────────────────────────────────
do $t$ begin raise notice '[프로젝트] 재적용 · 정책·트리거 수 · 함수 ACL (proacl)'; end $t$;
do $t$
declare v_bad text;
begin
  perform public._assert_eq(
    (select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'),
    22, '두 번 적용해도 정책이 22개 그대로다');
  perform public._assert_eq(
    (select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not t.tgisinternal and t.tgname like '%\_updated\_at'),
    5, 'updated_at 트리거가 5개다');
  perform public._assert_eq(
    (select string_agg(c.relname, ',' order by c.relname) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not t.tgisinternal and t.tgfoid = 'public.log_change()'::regprocedure),
    'catalog_choice,catalog_field,catalog_rule,option_record', '변경 기록 트리거가 4개 표에 붙어 있다');
  perform public._assert_eq(
    (select count(*)::int from pg_constraint where conname like 'change_log\_table\_name%'),
    1, 'change_log 표 이름 제약이 하나만 있다(재적용해도 겹치지 않는다)');

  -- 이 스키마에는 RLS 정책 식에서 쓰는 판정 함수가 없으므로 anon 예외 함수도 없다
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
         lateral aclexplode(p.proacl) a
   where n.nspname = 'public' and p.proname not like '\_assert%'
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee = 'anon'::regrole);
  perform public._assert(v_bad is null,
    'proacl 에 PUBLIC·anon EXECUTE 가 없다' || coalesce(' (발견: ' || v_bad || ')', ''));
  perform public._assert(
    (select bool_and(proacl is not null) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname not like '\_assert%'),
    '모든 함수의 proacl 이 기본값(NULL=PUBLIC 실행)이 아니다');
  perform public._assert(
    (select bool_and(proconfig @> array['search_path=public'])
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname not like '\_assert%'),
    '모든 함수가 search_path = public 으로 고정돼 있다');
  perform public._assert(
    not exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
                 join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public'
                  and (p.polroles @> array[0::oid] or p.polroles @> array['anon'::regrole::oid])),
    'anon·PUBLIC 에 열린 정책이 없다(판정 함수의 anon EXECUTE 가 필요 없다)');
end $t$;

-- 정리
delete from public.catalog_rule;
delete from public.option_record;
delete from public.column_mapping;
delete from public.catalog_field;
delete from public.change_log;
delete from auth.users where email in ('a@example.com', 'b@example.com');

do $t$ begin raise notice ''; raise notice '전부 통과했습니다.'; end $t$;
