-- ============================================================================
-- data09-19 — 엔진 인터페이스 옵션 통합 관리·분석 도구 (옵션 카탈로그 × 고객사·장비 레코드)
-- Supabase(PostgreSQL) 스키마 + RLS
--
--  무엇인가 : 지금 브라우저 localStorage('data09-19.db')에만 두는
--             옵션 카탈로그(항목·선택지)·레코드·열 연결을 DB 로 옮길 때 쓸 테이블과 보안 정책입니다.
--             기획서 5장 「변경 이력 — 카탈로그·레코드 수정 시 언제 무엇이 바뀌었는지 기록」을
--             트리거로 자동 기록합니다(change_log).
--  실행 위치 : 수강생 본인 Supabase 프로젝트의 SQL Editor 에서 실행
--  재실행    : 안전합니다 (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS 선행)
--
--  본인 프로젝트에 올리는 것을 전제로 하므로 테이블 이름에 접두사를 붙이지 않았습니다.
--  회사 공용 URL·키는 어디에도 들어 있지 않습니다.
--
--  테이블 (6개)
--    catalog_field   — 옵션 카탈로그의 항목 (고객사·engine suffix·Machine type … / ATS type·CAN1(J1939) baudrate …)
--    catalog_choice  — 항목별 선택지 (예: check engine lamp → CAN type / HW type)
--    catalog_rule    — 적용 조건: 「옵션 X 는 항목 Y 가 이 선택지일 때만 쓴다」 (2026-09-29 추가)
--    option_record   — 고객사×장비 1건 (항목 id → 값)
--    column_mapping  — 엑셀 열 이름 ↔ 카탈로그 항목 연결 (다음 가져오기에 재사용)
--    change_log      — 카탈로그·레코드 변경 기록 — 기록성, 수정·삭제 불가 (트리거가 자동 기록)
--
--  고객사 정보는 보안 대상입니다(기획서 3장). 모든 행은 만든 사람만 봅니다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 테이블
-- ----------------------------------------------------------------------------

-- 항목 (catalog.fields[] = { id, name, kind, type, required, active, choices })
--   id → field_key ('f_customer', 'f1' …). 레코드의 v 가 이 키로 값을 가리킨다.
--   삭제 대신 active=false(숨김)로 과거 기록을 보존한다(기획서 5장).
create table if not exists public.catalog_field (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  field_key   text not null check (field_key ~ '^f[a-z0-9_]*$'),
  name        text not null check (length(btrim(name)) > 0),
  kind        text not null check (kind in ('base', 'option')),         -- 기본 정보 / 옵션
  type        text not null check (type in ('text', 'select', 'number')),
  required    boolean not null default false,
  active      boolean not null default true,
  sort_order  int not null default 0,                                   -- 배열 순서(moveField)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- 도구 규칙: 옵션 항목은 언제나 선택 목록이다(addField)
  constraint catalog_field_option_is_select check (kind = 'base' or type = 'select'),
  -- ⚠ upsert 시 onConflict: 'owner_id,field_key'
  constraint catalog_field_owner_key unique (owner_id, field_key)
);
-- 도구 규칙: 대소문자·공백·밑줄·하이픈·점·가운뎃점·빗금만 다른 이름은 같은 항목이다(name_duplicate)
create unique index if not exists catalog_field_name_norm_key
  on public.catalog_field (owner_id, (regexp_replace(lower(btrim(name)), '[\s_\-.·/]+', '', 'g')));

-- 선택지 (field.choices[] = { id, label, active })
--   id → choice_key ('c_equip1', 'c3' …). 레코드는 선택지를 id 로 저장하므로
--   이름(label)을 고쳐도 기존 레코드에 그대로 반영된다.
create table if not exists public.catalog_choice (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  field_id    bigint not null references public.catalog_field(id) on delete cascade,
  choice_key  text not null check (choice_key ~ '^c[a-z0-9_]*$'),
  label       text not null check (length(btrim(label)) > 0),
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- 도구는 항목·선택지 id 를 한 이름 공간에서 겹치지 않게 만든다(takenIds)
  -- ⚠ upsert 시 onConflict: 'owner_id,choice_key'
  constraint catalog_choice_owner_key unique (owner_id, choice_key)
);
-- 도구 규칙: 한 항목 안에서 표기만 다른 선택지는 같은 선택지다(label_duplicate)
create unique index if not exists catalog_choice_label_norm_key
  on public.catalog_choice (field_id, (regexp_replace(lower(btrim(label)), '[\s_\-.·/]+', '', 'g')));

-- 적용 조건 (catalog.rules[] = { id, target, when, in: [선택지 id…] }) — 2026-09-29 추가
--   항목·선택지는 도구의 키(field_key·choice_key)로 가리킨다. 도구 규칙(addRule)과 같은 제약을 건다.
create table if not exists public.catalog_rule (
  id           bigint generated always as identity primary key,
  owner_id     uuid not null default auth.uid(),
  rule_key     text not null check (rule_key ~ '^rule[0-9]+$'),         -- 'rule1', 'rule2' …
  target_key   text not null check (target_key ~ '^f[a-z0-9_]*$'),      -- 옵션 항목
  when_key     text not null check (when_key ~ '^f[a-z0-9_]*$'),        -- 선택 목록 항목
  choice_keys  text[] not null check (cardinality(choice_keys) > 0),     -- 이 선택지일 때만 씀
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint catalog_rule_not_self check (target_key <> when_key),       -- rule_self
  -- ⚠ upsert 시 onConflict: 'owner_id,rule_key'
  constraint catalog_rule_owner_key unique (owner_id, rule_key),
  constraint catalog_rule_pair_key unique (owner_id, target_key, when_key) -- rule_duplicate
);

-- 레코드 (records[] = { id, v: { 필드id: 값 } }) — select 는 선택지 id, text 는 글자, number 는 숫자
--   항목이 담당자 손으로 늘어나므로 값은 jsonb 한 칸에 둔다(열을 고정하면 항목을 늘릴 때마다 DDL 이 필요하다).
create table if not exists public.option_record (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  record_key  text not null check (record_key ~ '^r[0-9]+$'),           -- 'r1', 'r2' …
  v           jsonb not null default '{}'::jsonb check (jsonb_typeof(v) = 'object'),
  is_sample   boolean not null default false,                         -- _sample
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- 기본 필수 항목(고객사)이 비어 있으면 받지 않는다 — 도구의 validateRecord 'required'
  constraint option_record_customer check (length(btrim(coalesce(v->>'f_customer', ''))) > 0),
  -- ⚠ upsert 시 onConflict: 'owner_id,record_key'
  constraint option_record_owner_key unique (owner_id, record_key)
);
create index if not exists option_record_customer_idx on public.option_record (owner_id, (v->>'f_customer'));

-- 열 연결 (db.mapping = { 엑셀 열 이름: 항목 id }) — 사용자당 한 행
create table if not exists public.column_mapping (
  owner_id    uuid primary key default auth.uid(),
  mapping     jsonb not null default '{}'::jsonb check (jsonb_typeof(mapping) = 'object'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 변경 기록 — 기록성이라 UPDATE/DELETE 정책이 없다.
-- 원래 행을 지워도 기록은 남아야 하므로 외래 키를 걸지 않는다.
create table if not exists public.change_log (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  table_name  text not null,                  -- 허용 값은 아래 change_log_table_name 제약
  row_key     text not null,                  -- field_key / choice_key / record_key
  op          text not null check (op in ('insert', 'update', 'delete')),
  before      jsonb,
  after       jsonb,
  changed_at  timestamptz not null default now()
);
create index if not exists change_log_idx on public.change_log (owner_id, changed_at desc);
-- 기록 대상 표 목록 — catalog_rule 이 늘어 제약을 다시 건다(재실행 안전).
-- 첫 판이 표 정의 안에 둔 이름 없는 check(change_log_table_name_check)도 함께 지운다.
alter table public.change_log drop constraint if exists change_log_table_name_check;
alter table public.change_log drop constraint if exists change_log_table_name;
alter table public.change_log add constraint change_log_table_name
  check (table_name in ('catalog_field', 'catalog_choice', 'catalog_rule', 'option_record'));

-- ----------------------------------------------------------------------------
-- 2. 함수 — search_path 고정
-- ----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

-- 카탈로그·레코드가 바뀔 때마다 변경 기록을 남긴다.
-- SECURITY DEFINER 가 아니다 — 호출한 사용자 권한으로 넣으므로 change_log 의 RLS 를 그대로 탄다.
create or replace function public.log_change()
returns trigger language plpgsql set search_path = public as $fn$
declare
  v_row  jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_key  text  := coalesce(v_row->>'field_key', v_row->>'choice_key', v_row->>'rule_key', v_row->>'record_key');
begin
  insert into public.change_log (owner_id, table_name, row_key, op, before, after)
  values ((v_row->>'owner_id')::uuid, tg_table_name, v_key, lower(tg_op),
          case when tg_op = 'INSERT' then null else to_jsonb(old) end,
          case when tg_op = 'DELETE' then null else to_jsonb(new) end);
  return case when tg_op = 'DELETE' then old else new end;
end;
$fn$;

do $trg$
declare t text;
begin
  foreach t in array array['catalog_field', 'catalog_choice', 'catalog_rule', 'option_record', 'column_mapping']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_updated_at', t);
  end loop;
  foreach t in array array['catalog_field', 'catalog_choice', 'catalog_rule', 'option_record']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_change', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.log_change()',
                   t || '_change', t);
  end loop;
end;
$trg$;

-- ----------------------------------------------------------------------------
-- 3. RLS — 행은 만든 사람(owner_id)만 보고 고친다. 비로그인(anon)은 아무것도 못 한다.
-- ----------------------------------------------------------------------------

alter table public.catalog_field  enable row level security;
alter table public.catalog_choice enable row level security;
alter table public.catalog_rule   enable row level security;
alter table public.option_record  enable row level security;
alter table public.column_mapping enable row level security;
alter table public.change_log     enable row level security;

do $rls$
declare t text;
begin
  foreach t in array array['catalog_field', 'catalog_rule', 'option_record', 'column_mapping']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = auth.uid())',
                   t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = auth.uid())',
                   t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())',
                   t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (owner_id = auth.uid())',
                   t || '_delete', t);
  end loop;
end;
$rls$;

-- 선택지 : 본인 행이면서, 붙는 항목도 본인 것이고 선택 목록(type='select')이어야 한다
drop policy if exists catalog_choice_select on public.catalog_choice;
drop policy if exists catalog_choice_insert on public.catalog_choice;
drop policy if exists catalog_choice_update on public.catalog_choice;
drop policy if exists catalog_choice_delete on public.catalog_choice;
create policy catalog_choice_select on public.catalog_choice for select to authenticated
  using (owner_id = auth.uid());
create policy catalog_choice_insert on public.catalog_choice for insert to authenticated
  with check (owner_id = auth.uid()
              and exists (select 1 from public.catalog_field f
                           where f.id = field_id and f.owner_id = auth.uid() and f.type = 'select'));
create policy catalog_choice_update on public.catalog_choice for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid()
              and exists (select 1 from public.catalog_field f
                           where f.id = field_id and f.owner_id = auth.uid() and f.type = 'select'));
create policy catalog_choice_delete on public.catalog_choice for delete to authenticated
  using (owner_id = auth.uid());

-- 변경 기록 : 읽기·추가만. 수정·삭제 정책을 두지 않아 사후 조작을 막는다.
drop policy if exists change_log_select on public.change_log;
drop policy if exists change_log_insert on public.change_log;
create policy change_log_select on public.change_log for select to authenticated
  using (owner_id = auth.uid());
create policy change_log_insert on public.change_log for insert to authenticated
  with check (owner_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 4. 함수 실행 권한
--
--  GRANT 만으로는 제한되지 않는다. 권한이 두 겹으로 미리 붙는다.
--    ① PostgreSQL 이 함수 생성 시 PUBLIC 에 EXECUTE 기본 부여
--    ② Supabase 가 신규 함수마다 anon·authenticated·service_role 에 자동 부여
--  그래서 PUBLIC 과 anon 을 둘 다 끊고 authenticated 에만 다시 준다.
--  (이 스키마에는 RLS 정책 식에서 쓰는 함수가 없으므로 anon 예외도 없다)
-- ----------------------------------------------------------------------------

revoke all on function public.set_updated_at() from public, anon;
revoke all on function public.log_change()     from public, anon;
-- 둘 다 트리거 전용 함수. 트리거 발화 시 호출자 EXECUTE 를 검사할 경우를 대비해 남긴다.
-- 직접 호출하면 "can only be called as trigger" 로 죽으므로 무해하다.
grant execute on function public.set_updated_at() to authenticated;
grant execute on function public.log_change()     to authenticated;

-- ----------------------------------------------------------------------------
-- 끝.
-- ----------------------------------------------------------------------------
