-- =====================================================================
-- Homebase: estrutura do banco de dados (Supabase)
-- Como usar: no Supabase, abra "SQL Editor", cole este arquivo inteiro
-- e clique em "Run". Pode rodar de novo sem problema.
-- =====================================================================

-- ---------- Pessoas: cada login fica ligado a uma das seis pessoas ----------
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  person     text not null unique check (person in ('liliane','ricardo','isa','marina','gabi','frieda')),
  created_at timestamptz not null default now()
);

create or replace function public.my_person() returns text
language sql stable security definer set search_path = public as $$
  select person from public.profiles where user_id = auth.uid()
$$;

-- Liliane e Isa são as admins.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_person() in ('liliane','isa'), false)
$$;

-- Quais pessoas já têm login (para a tela de entrada saber se é o primeiro acesso).
create or replace function public.claimed_people() returns setof text
language sql stable security definer set search_path = public as $$
  select person from public.profiles
$$;

-- No primeiro acesso, liga o login à pessoa escolhida (se ela ainda estiver livre).
create or replace function public.claim_person(p text) returns text
language plpgsql security definer set search_path = public as $$
declare cur text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select person into cur from public.profiles where user_id = auth.uid();
  if cur is not null then return cur; end if;
  insert into public.profiles (user_id, person) values (auth.uid(), p);
  return p;
end $$;

revoke all on function public.claim_person(text) from public, anon;
grant execute on function public.claim_person(text) to authenticated;
grant execute on function public.claimed_people() to anon, authenticated;
grant execute on function public.my_person() to authenticated;
grant execute on function public.is_admin() to authenticated;

alter table public.profiles enable row level security;
drop policy if exists "ver o próprio perfil" on public.profiles;
create policy "ver o próprio perfil" on public.profiles for select to authenticated using (user_id = auth.uid());

-- ---------- Compromissos ----------
create table if not exists public.events (
  id         text primary key,
  owner      text not null check (owner in ('liliane','ricardo','isa','marina','gabi','frieda','familia')),
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

-- Quem criou é sempre quem está logado; "Só para mim" fica sempre com quem marcou.
create or replace function public.events_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.by_person := public.my_person();
  else new.by_person := old.by_person; new.created_at := old.created_at; end if;
  if new.private then new.by_person := public.my_person(); new.owner := public.my_person(); end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists events_stamp on public.events;
create trigger events_stamp before insert or update on public.events for each row execute function public.events_stamp();

alter table public.events enable row level security;
drop policy if exists "ver compromissos" on public.events;
drop policy if exists "criar compromissos" on public.events;
drop policy if exists "mudar compromissos" on public.events;
drop policy if exists "apagar compromissos" on public.events;
-- Privado: só quem marcou vê. Os outros: admins veem tudo; cada um vê o seu e os da família.
create policy "ver compromissos" on public.events for select to authenticated using (
  case when private then by_person = public.my_person()
       else public.is_admin() or owner = public.my_person() or owner = 'familia' end);
-- Cada um marca no seu horário; admins marcam para qualquer um e para a família.
create policy "criar compromissos" on public.events for insert to authenticated with check (
  public.my_person() is not null and
  case when private then by_person = public.my_person() and owner = public.my_person()
       else public.is_admin() or owner = public.my_person() end);
create policy "mudar compromissos" on public.events for update to authenticated
  using (case when private then by_person = public.my_person() else public.is_admin() or owner = public.my_person() end)
  with check (case when private then by_person = public.my_person() and owner = public.my_person()
                   else public.is_admin() or owner = public.my_person() end);
create policy "apagar compromissos" on public.events for delete to authenticated using (
  case when private then by_person = public.my_person() else public.is_admin() or owner = public.my_person() end);

-- ---------- Aniversários ----------
create table if not exists public.birthdays (
  id          text primary key,
  name        text not null,
  md          text not null check (md ~ '^\d{2}-\d{2}$'),
  year        int,
  by_person   text not null,
  vis         text not null check (vis in ('eu','familia','alguns')),
  with_people text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create or replace function public.birthdays_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.by_person := public.my_person();
  else new.by_person := old.by_person; new.created_at := old.created_at; end if;
  if new.vis <> 'alguns' then new.with_people := '{}'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists birthdays_stamp on public.birthdays;
create trigger birthdays_stamp before insert or update on public.birthdays for each row execute function public.birthdays_stamp();

alter table public.birthdays enable row level security;
drop policy if exists "ver aniversários" on public.birthdays;
drop policy if exists "criar aniversários" on public.birthdays;
drop policy if exists "mudar aniversários" on public.birthdays;
drop policy if exists "apagar aniversários" on public.birthdays;
-- Família toda: todos veem. Individual: só quem criou (e as pessoas escolhidas).
create policy "ver aniversários" on public.birthdays for select to authenticated using (
  vis = 'familia' or by_person = public.my_person()
  or (vis = 'alguns' and public.my_person() = any(with_people)));
create policy "criar aniversários" on public.birthdays for insert to authenticated with check (
  public.my_person() is not null and by_person = public.my_person());
create policy "mudar aniversários" on public.birthdays for update to authenticated
  using (by_person = public.my_person() or (public.is_admin() and vis = 'familia'))
  with check (by_person = public.my_person() or (public.is_admin() and vis = 'familia'));
create policy "apagar aniversários" on public.birthdays for delete to authenticated using (
  by_person = public.my_person() or (public.is_admin() and vis = 'familia'));

-- ---------- Listas compartilhadas: Supermercado e Farmácia ----------
create table if not exists public.list_items (
  id         text primary key,
  list       text not null check (list in ('mercado','farmacia')),
  text       text not null,
  by_person  text not null,
  done       boolean not null default false,
  created_at timestamptz not null default now()
);
create or replace function public.list_items_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.by_person := public.my_person(); new.created_at := now();
  else new.by_person := old.by_person; new.created_at := old.created_at; end if;
  return new;
end $$;
drop trigger if exists list_items_stamp on public.list_items;
create trigger list_items_stamp before insert or update on public.list_items for each row execute function public.list_items_stamp();

alter table public.list_items enable row level security;
drop policy if exists "família usa as listas" on public.list_items;
create policy "família usa as listas" on public.list_items for all to authenticated
  using (public.my_person() is not null) with check (public.my_person() is not null);

-- ---------- Tarefas pessoais (só a própria pessoa vê) ----------
create table if not exists public.todos (
  id         text primary key,
  person     text not null,
  text       text not null,
  done       boolean not null default false,
  created_at timestamptz not null default now()
);
create or replace function public.todos_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.person := public.my_person(); new.created_at := now();
  else new.person := old.person; new.created_at := old.created_at; end if;
  return new;
end $$;
drop trigger if exists todos_stamp on public.todos;
create trigger todos_stamp before insert or update on public.todos for each row execute function public.todos_stamp();

alter table public.todos enable row level security;
drop policy if exists "minhas tarefas" on public.todos;
create policy "minhas tarefas" on public.todos for all to authenticated
  using (person = public.my_person()) with check (person = public.my_person());

-- ---------- Configurações da família (ícone do app) ----------
create table if not exists public.settings (
  key   text primary key,
  value jsonb
);
insert into public.settings (key, value) values ('app_icon', '1') on conflict (key) do nothing;
alter table public.settings enable row level security;
drop policy if exists "família vê configurações" on public.settings;
drop policy if exists "admins mudam configurações" on public.settings;
create policy "família vê configurações" on public.settings for select to authenticated using (public.my_person() is not null);
create policy "admins mudam configurações" on public.settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- Aparelhos que recebem notificações ----------
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  person     text not null,
  p256dh     text not null,
  auth       text not null,
  tz         text not null default 'America/Sao_Paulo',
  lang       text not null default 'pt',
  updated_at timestamptz not null default now()
);
create or replace function public.push_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.user_id := auth.uid(); new.person := public.my_person(); new.updated_at := now();
  return new;
end $$;
drop trigger if exists push_stamp on public.push_subscriptions;
create trigger push_stamp before insert or update on public.push_subscriptions for each row execute function public.push_stamp();

alter table public.push_subscriptions enable row level security;
drop policy if exists "meus aparelhos" on public.push_subscriptions;
create policy "meus aparelhos" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and person is not null);

-- Lembretes já enviados (para não mandar o mesmo duas vezes). Só o servidor usa.
create table if not exists public.reminders_sent (
  event_id text not null,
  occ_date date not null,
  person   text not null,
  sent_at  timestamptz not null default now(),
  primary key (event_id, occ_date, person)
);
alter table public.reminders_sent enable row level security;

-- ---------- Permissões de acesso pela internet ----------
revoke all on public.profiles, public.events, public.birthdays, public.list_items, public.todos,
              public.settings, public.push_subscriptions, public.reminders_sent from anon;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.events, public.birthdays, public.list_items,
      public.todos, public.push_subscriptions to authenticated;
grant select, update on public.settings to authenticated;
revoke all on public.reminders_sent from authenticated;
grant all on all tables in schema public to service_role;

-- ---------- Sincronização ao vivo entre aparelhos ----------
do $$
declare tname text;
begin
  foreach tname in array array['events','birthdays','list_items','todos','settings'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = tname) then
      execute format('alter publication supabase_realtime add table public.%I', tname);
    end if;
  end loop;
end $$;
