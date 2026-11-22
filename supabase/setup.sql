-- =====================================================================
-- Homebase: estrutura do banco de dados (Supabase) — versão com várias famílias
-- Como usar: no Supabase, abra "SQL Editor", cole este arquivo inteiro
-- e clique em "Run". Pode rodar de novo sem problema.
-- =====================================================================
begin;

-- ---------- Famílias ----------
create table if not exists public.families (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) between 1 and 60),
  code         text not null check (length(trim(code)) between 6 and 40),
  owner_member text,
  app_icon     int  not null default 1,
  created_at   timestamptz not null default now()
);
create unique index if not exists families_name_code on public.families (lower(trim(name)), upper(trim(code)));

-- ---------- Pessoas de cada família ----------
create table if not exists public.members (
  id         text primary key default gen_random_uuid()::text,
  family_id  uuid not null references public.families(id) on delete cascade,
  user_id    uuid unique references auth.users(id) on delete set null,
  name       text not null check (length(trim(name)) between 1 and 40),
  role       text not null default 'Outro' check (role in ('Mãe','Pai','Filha','Filho','Outro')),
  color      text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  shape      text not null default 'circle' check (shape in ('flower','square','circle','tri','cloud','penta')),
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists members_family on public.members (family_id);

-- Quem é a pessoa logada (id da pessoa) e de qual família ela é.
create or replace function public.my_person() returns text
language sql stable security definer set search_path = public as $$
  select id from public.members where user_id = auth.uid()
$$;
create or replace function public.my_family() returns uuid
language sql stable security definer set search_path = public as $$
  select family_id from public.members where user_id = auth.uid()
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.members where user_id = auth.uid()), false)
$$;
-- Quem criou a família (é quem escolhe os admins e muda o código).
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select f.owner_member = m.id from public.members m join public.families f on f.id = m.family_id
                   where m.user_id = auth.uid()), false)
$$;

-- ---------- Compromissos ----------
create table if not exists public.events (
  id         text primary key,
  family_id  uuid references public.families(id) on delete cascade,
  owner      text not null,
  by_person  text not null,
  title      text not null,
  date       date not null,
  start_time text not null check (start_time ~ '^\d{2}:\d{2}$'),
  end_time   text not null check (end_time ~ '^\d{2}:\d{2}$'),
  repeat     text not null default 'none' check (repeat in ('none','daily','weekly','biweekly','monthly')),
  reminder   int  not null default 30,
  place      text not null default '',
  notes      text not null default '',
  private    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- ---------- Aniversários ----------
create table if not exists public.birthdays (
  id          text primary key,
  family_id   uuid references public.families(id) on delete cascade,
  name        text not null,
  md          text not null check (md ~ '^\d{2}-\d{2}$'),
  year        int,
  by_person   text not null,
  vis         text not null check (vis in ('eu','familia','alguns')),
  with_people text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- ---------- Listas compartilhadas: Supermercado e Farmácia ----------
create table if not exists public.list_items (
  id         text primary key,
  family_id  uuid references public.families(id) on delete cascade,
  list       text not null check (list in ('mercado','farmacia')),
  text       text not null,
  by_person  text not null,
  done       boolean not null default false,
  created_at timestamptz not null default now()
);
-- ---------- Tarefas pessoais ----------
create table if not exists public.todos (
  id         text primary key,
  family_id  uuid references public.families(id) on delete cascade,
  person     text not null,
  text       text not null,
  done       boolean not null default false,
  created_at timestamptz not null default now()
);
-- ---------- Aparelhos que recebem notificações ----------
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  family_id  uuid references public.families(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  person     text not null,
  p256dh     text not null,
  auth       text not null,
  tz         text not null default 'America/Sao_Paulo',
  lang       text not null default 'pt',
  updated_at timestamptz not null default now()
);
-- Lembretes já enviados (para não mandar o mesmo duas vezes). Só o servidor usa.
create table if not exists public.reminders_sent (
  event_id text not null,
  occ_date date not null,
  person   text not null,
  sent_at  timestamptz not null default now(),
  primary key (event_id, occ_date, person)
);

-- Desliga os carimbos antigos antes de mexer nas tabelas (são recriados mais abaixo).
drop trigger if exists events_stamp on public.events;
drop trigger if exists birthdays_stamp on public.birthdays;
drop trigger if exists list_items_stamp on public.list_items;
drop trigger if exists todos_stamp on public.todos;
drop trigger if exists push_stamp on public.push_subscriptions;

-- Versão antiga: acrescenta a família em cada tabela e tira as regras das seis pessoas fixas.
do $$
declare tname text;
begin
  foreach tname in array array['events','birthdays','list_items','todos','push_subscriptions'] loop
    execute format('alter table public.%I add column if not exists family_id uuid references public.families(id) on delete cascade', tname);
    -- Dados da versão antiga, sem família, não aparecem para ninguém: são apagados.
    execute format('delete from public.%I where family_id is null', tname);
    execute format('create index if not exists %I on public.%I (family_id)', tname || '_family', tname);
  end loop;
end $$;
alter table public.events drop constraint if exists events_owner_check;
delete from public.push_subscriptions where family_id is null;

-- Carimbos automáticos: família, quem criou, datas.
create or replace function public.stamp_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.family_id := public.my_family();
  else
    new.family_id := old.family_id;
  end if;
  if tg_table_name in ('events','birthdays','list_items') then
    if tg_op = 'INSERT' then new.by_person := public.my_person(); else new.by_person := old.by_person; end if;
  end if;
  if tg_table_name = 'todos' then
    if tg_op = 'INSERT' then new.person := public.my_person(); else new.person := old.person; end if;
  end if;
  if tg_table_name = 'events' then
    if new.private then new.by_person := public.my_person(); new.owner := public.my_person(); end if;
  end if;
  if tg_table_name = 'birthdays' then
    if new.vis <> 'alguns' then new.with_people := '{}'; end if;
  end if;
  if tg_table_name in ('events','birthdays') then
    if tg_op = 'UPDATE' then new.created_at := old.created_at; end if;
    new.updated_at := now();
  end if;
  if tg_table_name in ('list_items','todos') then
    new.created_at := case when tg_op = 'INSERT' then now() else old.created_at end;
  end if;
  return new;
end $$;
create or replace function public.push_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.user_id := auth.uid(); new.person := public.my_person(); new.family_id := public.my_family(); new.updated_at := now();
  return new;
end $$;

drop function if exists public.events_stamp();
drop function if exists public.birthdays_stamp();
drop function if exists public.list_items_stamp();
drop function if exists public.todos_stamp();
create trigger events_stamp before insert or update on public.events for each row execute function public.stamp_row();
create trigger birthdays_stamp before insert or update on public.birthdays for each row execute function public.stamp_row();
create trigger list_items_stamp before insert or update on public.list_items for each row execute function public.stamp_row();
create trigger todos_stamp before insert or update on public.todos for each row execute function public.stamp_row();
create trigger push_stamp before insert or update on public.push_subscriptions for each row execute function public.push_stamp();

-- ---------- Regras de quem vê e muda o quê (sempre dentro da própria família) ----------
alter table public.families enable row level security;
alter table public.members enable row level security;
alter table public.events enable row level security;
alter table public.birthdays enable row level security;
alter table public.list_items enable row level security;
alter table public.todos enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.reminders_sent enable row level security;

drop policy if exists "ver a própria família" on public.families;
drop policy if exists "admins mudam o ícone" on public.families;
create policy "ver a própria família" on public.families for select to authenticated using (id = public.my_family());
create policy "admins mudam o ícone" on public.families for update to authenticated
  using (id = public.my_family() and public.is_admin()) with check (id = public.my_family());

drop policy if exists "ver as pessoas da família" on public.members;
create policy "ver as pessoas da família" on public.members for select to authenticated using (family_id = public.my_family());

drop policy if exists "ver compromissos" on public.events;
drop policy if exists "criar compromissos" on public.events;
drop policy if exists "mudar compromissos" on public.events;
drop policy if exists "apagar compromissos" on public.events;
-- Privado: só quem marcou vê. Os outros: admins veem tudo; cada um vê o seu e os da família.
create policy "ver compromissos" on public.events for select to authenticated using (
  family_id = public.my_family() and
  case when private then by_person = public.my_person()
       else public.is_admin() or owner = public.my_person() or owner = 'familia' end);
create policy "criar compromissos" on public.events for insert to authenticated with check (
  family_id = public.my_family() and
  case when private then by_person = public.my_person() and owner = public.my_person()
       else (public.is_admin() and (owner = 'familia' or exists (select 1 from public.members m where m.id = owner and m.family_id = public.my_family())))
            or owner = public.my_person() end);
create policy "mudar compromissos" on public.events for update to authenticated
  using (family_id = public.my_family() and case when private then by_person = public.my_person() else public.is_admin() or owner = public.my_person() end)
  with check (family_id = public.my_family() and
    case when private then by_person = public.my_person() and owner = public.my_person()
         else (public.is_admin() and (owner = 'familia' or exists (select 1 from public.members m where m.id = owner and m.family_id = public.my_family())))
              or owner = public.my_person() end);
create policy "apagar compromissos" on public.events for delete to authenticated using (
  family_id = public.my_family() and
  case when private then by_person = public.my_person() else public.is_admin() or owner = public.my_person() end);

drop policy if exists "ver aniversários" on public.birthdays;
drop policy if exists "criar aniversários" on public.birthdays;
drop policy if exists "mudar aniversários" on public.birthdays;
drop policy if exists "apagar aniversários" on public.birthdays;
-- Família toda: todos veem. Individual: só quem criou (e as pessoas escolhidas).
create policy "ver aniversários" on public.birthdays for select to authenticated using (
  family_id = public.my_family() and
  (vis = 'familia' or by_person = public.my_person() or (vis = 'alguns' and public.my_person() = any(with_people))));
create policy "criar aniversários" on public.birthdays for insert to authenticated with check (
  family_id = public.my_family() and by_person = public.my_person());
create policy "mudar aniversários" on public.birthdays for update to authenticated
  using (family_id = public.my_family() and (by_person = public.my_person() or (public.is_admin() and vis = 'familia')))
  with check (family_id = public.my_family() and (by_person = public.my_person() or (public.is_admin() and vis = 'familia')));
create policy "apagar aniversários" on public.birthdays for delete to authenticated using (
  family_id = public.my_family() and (by_person = public.my_person() or (public.is_admin() and vis = 'familia')));

drop policy if exists "família usa as listas" on public.list_items;
create policy "família usa as listas" on public.list_items for all to authenticated
  using (family_id = public.my_family()) with check (family_id = public.my_family());

drop policy if exists "minhas tarefas" on public.todos;
create policy "minhas tarefas" on public.todos for all to authenticated
  using (person = public.my_person()) with check (person = public.my_person());

drop policy if exists "meus aparelhos" on public.push_subscriptions;
create policy "meus aparelhos" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and person is not null);

-- ---------- Criar família, entrar numa família, escolher admins ----------
-- Formas dos bonequinhos, na ordem em que as pessoas entram.
create or replace function public.next_shape(fid uuid) returns text
language sql stable security definer set search_path = public as $$
  select (array['flower','square','circle','tri','cloud','penta'])[(select count(*) from public.members where family_id = fid) % 6 + 1]
$$;

drop function if exists public.create_family(text,text,text,text,text);
-- Cria a família já com todas as pessoas: quem cria + as outras (nome, quem é, cor, se é admin).
create or replace function public.create_family(fname text, fcode text, my_name text, my_role text, my_color text,
                                                my_admin boolean default true, others jsonb default '[]'::jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare fid uuid; mid text; o jsonb; n int := 1;
  shapes text[] := array['flower','square','circle','tri','cloud','penta'];
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then raise exception 'already_member'; end if;
  if length(trim(coalesce(fcode,''))) < 6 then raise exception 'short_code'; end if;
  if exists (select 1 from families where lower(trim(name)) = lower(trim(fname)) and upper(trim(code)) = upper(trim(fcode))) then
    raise exception 'family_exists';
  end if;
  insert into families (name, code) values (trim(fname), trim(fcode)) returning id into fid;
  insert into members (family_id, user_id, name, role, color, shape, is_admin, created_at)
    values (fid, auth.uid(), trim(my_name), my_role, my_color, shapes[1], coalesce(my_admin, true), now()) returning id into mid;
  for o in select * from jsonb_array_elements(coalesce(others, '[]'::jsonb)) loop
    if length(trim(coalesce(o->>'name',''))) > 0 then
      insert into members (family_id, name, role, color, shape, is_admin, created_at)
        values (fid, trim(o->>'name'), coalesce(o->>'role','Outro'), o->>'color', shapes[n % 6 + 1],
                coalesce((o->>'is_admin')::boolean, false), now() + n * interval '1 millisecond');
      n := n + 1;
    end if;
  end loop;
  update families set owner_member = mid where id = fid;
  return mid;
end $$;

-- Quem criou a família pode acrescentar mais pessoas depois.
create or replace function public.add_member(m_name text, m_role text, m_color text, m_admin boolean) returns text
language plpgsql security definer set search_path = public as $$
declare mid text; fid uuid := my_family();
begin
  if not is_owner() then raise exception 'not_owner'; end if;
  insert into members (family_id, name, role, color, shape, is_admin)
    values (fid, trim(m_name), m_role, m_color, next_shape(fid), coalesce(m_admin, false)) returning id into mid;
  return mid;
end $$;

-- Procura a família pelo nome + código e mostra as pessoas que ainda não têm login.
create or replace function public.find_family(fname text, fcode text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f families;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into f from families where lower(trim(name)) = lower(trim(fname)) and upper(trim(code)) = upper(trim(fcode));
  if f.id is null then return null; end if;
  return jsonb_build_object('name', f.name, 'people', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'role', role, 'color', color, 'shape', shape) order by created_at)
    from members where family_id = f.id and user_id is null), '[]'::jsonb));
end $$;

create or replace function public.join_family(fname text, fcode text, claim_id text, my_name text, my_role text, my_color text) returns text
language plpgsql security definer set search_path = public as $$
declare f families; mid text;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then raise exception 'already_member'; end if;
  select * into f from families where lower(trim(name)) = lower(trim(fname)) and upper(trim(code)) = upper(trim(fcode));
  if f.id is null then raise exception 'not_found'; end if;
  if claim_id is not null then
    update members set user_id = auth.uid() where id = claim_id and family_id = f.id and user_id is null returning id into mid;
    if mid is null then raise exception 'taken'; end if;
  else
    insert into members (family_id, user_id, name, role, color, shape)
      values (f.id, auth.uid(), trim(my_name), my_role, my_color, next_shape(f.id)) returning id into mid;
  end if;
  return mid;
end $$;

-- Só quem criou a família escolhe os admins.
create or replace function public.set_admin(member_id text, make_admin boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'not_owner'; end if;
  update members set is_admin = make_admin where id = member_id and family_id = my_family();
end $$;

-- Só quem criou a família muda o código.
create or replace function public.set_family_code(new_code text) returns void
language plpgsql security definer set search_path = public as $$
declare fid uuid := my_family();
begin
  if not is_owner() then raise exception 'not_owner'; end if;
  if length(trim(coalesce(new_code,''))) < 6 then raise exception 'short_code'; end if;
  if exists (select 1 from families f where f.id <> fid and upper(trim(f.code)) = upper(trim(new_code))
             and lower(trim(f.name)) = (select lower(trim(name)) from families where id = fid)) then
    raise exception 'family_exists';
  end if;
  update families set code = trim(new_code) where id = fid;
end $$;

-- ---------- Limpeza da versão antiga ----------
drop function if exists public.claim_person(text);
drop function if exists public.claimed_people();
drop table if exists public.profiles;
drop table if exists public.settings;

-- ---------- Permissões de acesso pela internet ----------
revoke all on public.families, public.members, public.events, public.birthdays, public.list_items, public.todos,
              public.push_subscriptions, public.reminders_sent from anon;
revoke all on public.families, public.members from authenticated;
grant select on public.families, public.members to authenticated;
grant update (app_icon) on public.families to authenticated;
grant select, insert, update, delete on public.events, public.birthdays, public.list_items,
      public.todos, public.push_subscriptions to authenticated;
revoke all on public.reminders_sent from authenticated;
grant all on all tables in schema public to service_role;

revoke all on function public.create_family(text,text,text,text,text,boolean,jsonb) from public, anon;
revoke all on function public.add_member(text,text,text,boolean) from public, anon;
revoke all on function public.find_family(text,text) from public, anon;
revoke all on function public.join_family(text,text,text,text,text,text) from public, anon;
revoke all on function public.set_admin(text,boolean) from public, anon;
revoke all on function public.set_family_code(text) from public, anon;
grant execute on function public.create_family(text,text,text,text,text,boolean,jsonb) to authenticated;
grant execute on function public.add_member(text,text,text,boolean) to authenticated;
grant execute on function public.find_family(text,text) to authenticated;
grant execute on function public.join_family(text,text,text,text,text,text) to authenticated;
grant execute on function public.set_admin(text,boolean) to authenticated;
grant execute on function public.set_family_code(text) to authenticated;

-- ---------- Sincronização ao vivo entre aparelhos ----------
do $$
declare tname text;
begin
  foreach tname in array array['events','birthdays','list_items','todos','members','families'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = tname) then
      execute format('alter publication supabase_realtime add table public.%I', tname);
    end if;
  end loop;
end $$;

commit;
