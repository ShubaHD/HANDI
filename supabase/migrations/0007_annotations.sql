-- HANDI - Adnotari (simboluri geologice / text / sageti)

create table if not exists public.annotations (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('symbol', 'text', 'arrow')),
  symbol text,
  text text,
  lat double precision,
  lon double precision,
  geom geography(Geometry, 4326) not null,
  bearing_deg double precision,
  visibility public.visibility not null default 'club',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (kind in ('symbol', 'text') and lat is not null and lon is not null)
    or (kind = 'arrow' and lat is null and lon is null)
  )
);

create index if not exists annotations_geom_idx on public.annotations using gist (geom);
create index if not exists annotations_owner_idx on public.annotations (owner_id);
create index if not exists annotations_kind_idx on public.annotations (kind);
create index if not exists annotations_visibility_idx on public.annotations (visibility);

-- GeoJSON for PostgREST
alter table public.annotations
  add column if not exists geom_json jsonb generated always as (
    st_asgeojson(geom)::jsonb
  ) stored;

-- updated_at trigger
drop trigger if exists annotations_touch_updated on public.annotations;
create trigger annotations_touch_updated before update on public.annotations
  for each row execute function public.touch_updated_at();

-- RLS
alter table public.annotations enable row level security;

drop policy if exists "annotations_select" on public.annotations;
create policy "annotations_select" on public.annotations
  for select to authenticated using (
    visibility = 'club' or owner_id = auth.uid()
  );

drop policy if exists "annotations_insert_own" on public.annotations;
create policy "annotations_insert_own" on public.annotations
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists "annotations_update_own" on public.annotations;
create policy "annotations_update_own" on public.annotations
  for update to authenticated using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "annotations_delete_own" on public.annotations;
create policy "annotations_delete_own" on public.annotations
  for delete to authenticated using (owner_id = auth.uid());

