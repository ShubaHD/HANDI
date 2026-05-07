-- HANDI - Speo Field: schema initiala
-- Ruleaza in Supabase Studio -> SQL Editor (sau via Supabase CLI)

-- =========================================================
-- 1. Extensii
-- =========================================================
create extension if not exists postgis;
create extension if not exists "uuid-ossp";

-- =========================================================
-- 2. Profile (extinde auth.users)
-- =========================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================
-- 3. Tipuri ENUM
-- =========================================================
do $$ begin
  create type public.visibility as enum ('private', 'club');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.point_type as enum (
    'cave', 'doline', 'spring', 'dig_site', 'aven', 'resurgence', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.zone_priority as enum ('low', 'medium', 'high');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.zone_status as enum ('todo', 'in_progress', 'done', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.track_source as enum ('gpx_import', 'recorded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.raster_kind as enum ('thermal', 'lidar_hillshade', 'orthophoto', 'other');
exception when duplicate_object then null; end $$;

-- =========================================================
-- 4. Puncte de interes
-- =========================================================
create table if not exists public.points (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  type public.point_type not null default 'other',
  lat double precision not null,
  lon double precision not null,
  geom geography(Point, 4326) generated always as (
    st_setsrid(st_makepoint(lon, lat), 4326)::geography
  ) stored,
  elevation_m double precision,
  description text,
  visibility public.visibility not null default 'club',
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists points_geom_idx on public.points using gist (geom);
create index if not exists points_owner_idx on public.points (owner_id);
create index if not exists points_type_idx on public.points (type);

-- =========================================================
-- 5. Zone (poligoane de prospectiune)
-- =========================================================
create table if not exists public.zones (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  geom geography(Polygon, 4326) not null,
  priority public.zone_priority not null default 'medium',
  status public.zone_status not null default 'todo',
  visibility public.visibility not null default 'club',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists zones_geom_idx on public.zones using gist (geom);
create index if not exists zones_owner_idx on public.zones (owner_id);

-- =========================================================
-- 6. Trasee
-- =========================================================
create table if not exists public.tracks (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  geom geography(LineString, 4326) not null,
  source public.track_source not null,
  distance_m double precision,
  elev_gain_m double precision,
  visibility public.visibility not null default 'club',
  recorded_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists tracks_geom_idx on public.tracks using gist (geom);
create index if not exists tracks_owner_idx on public.tracks (owner_id);

-- =========================================================
-- 7. Foto (atasate punctelor)
-- =========================================================
create table if not exists public.photos (
  id uuid primary key default uuid_generate_v4(),
  point_id uuid references public.points(id) on delete cascade,
  storage_path text not null,
  taken_at timestamptz,
  exif_lat double precision,
  exif_lon double precision,
  created_at timestamptz not null default now()
);

create index if not exists photos_point_idx on public.photos (point_id);

-- =========================================================
-- 8. Raster overlays (termal drona / LIDAR / ortofoto)
-- =========================================================
create table if not exists public.raster_overlays (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  kind public.raster_kind not null,
  storage_path text not null,
  bounds geography(Polygon, 4326) not null,
  captured_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  visibility public.visibility not null default 'club',
  created_at timestamptz not null default now()
);

create index if not exists raster_bounds_idx on public.raster_overlays using gist (bounds);
create index if not exists raster_kind_idx on public.raster_overlays (kind);

-- =========================================================
-- 9. Trigger pentru updated_at
-- =========================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists points_touch_updated on public.points;
create trigger points_touch_updated before update on public.points
  for each row execute function public.touch_updated_at();

drop trigger if exists zones_touch_updated on public.zones;
create trigger zones_touch_updated before update on public.zones
  for each row execute function public.touch_updated_at();

-- =========================================================
-- 10. Row Level Security
-- =========================================================
alter table public.profiles enable row level security;
alter table public.points enable row level security;
alter table public.zones enable row level security;
alter table public.tracks enable row level security;
alter table public.photos enable row level security;
alter table public.raster_overlays enable row level security;

-- Profiles: orice membru autentificat vede toate profilurile (e un club mic)
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated" on public.profiles
  for select to authenticated using (true);

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Helper: vizibilitate club sau owner
-- Aplicat tabel cu tabel mai jos. Pattern: vezi ce e 'club' SAU ce e al tau.

-- Points
drop policy if exists "points_select" on public.points;
create policy "points_select" on public.points
  for select to authenticated using (
    visibility = 'club' or owner_id = auth.uid()
  );

drop policy if exists "points_insert_own" on public.points;
create policy "points_insert_own" on public.points
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists "points_update_own" on public.points;
create policy "points_update_own" on public.points
  for update to authenticated using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "points_delete_own" on public.points;
create policy "points_delete_own" on public.points
  for delete to authenticated using (owner_id = auth.uid());

-- Zones
drop policy if exists "zones_select" on public.zones;
create policy "zones_select" on public.zones
  for select to authenticated using (
    visibility = 'club' or owner_id = auth.uid()
  );

drop policy if exists "zones_insert_own" on public.zones;
create policy "zones_insert_own" on public.zones
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists "zones_update_own" on public.zones;
create policy "zones_update_own" on public.zones
  for update to authenticated using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "zones_delete_own" on public.zones;
create policy "zones_delete_own" on public.zones
  for delete to authenticated using (owner_id = auth.uid());

-- Tracks
drop policy if exists "tracks_select" on public.tracks;
create policy "tracks_select" on public.tracks
  for select to authenticated using (
    visibility = 'club' or owner_id = auth.uid()
  );

drop policy if exists "tracks_insert_own" on public.tracks;
create policy "tracks_insert_own" on public.tracks
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists "tracks_update_own" on public.tracks;
create policy "tracks_update_own" on public.tracks
  for update to authenticated using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "tracks_delete_own" on public.tracks;
create policy "tracks_delete_own" on public.tracks
  for delete to authenticated using (owner_id = auth.uid());

-- Photos: legate prin punct
drop policy if exists "photos_select" on public.photos;
create policy "photos_select" on public.photos
  for select to authenticated using (
    exists (
      select 1 from public.points p
      where p.id = photos.point_id
        and (p.visibility = 'club' or p.owner_id = auth.uid())
    )
  );

drop policy if exists "photos_insert_own" on public.photos;
create policy "photos_insert_own" on public.photos
  for insert to authenticated with check (
    exists (
      select 1 from public.points p
      where p.id = point_id and p.owner_id = auth.uid()
    )
  );

drop policy if exists "photos_delete_own" on public.photos;
create policy "photos_delete_own" on public.photos
  for delete to authenticated using (
    exists (
      select 1 from public.points p
      where p.id = photos.point_id and p.owner_id = auth.uid()
    )
  );

-- Raster overlays
drop policy if exists "raster_select" on public.raster_overlays;
create policy "raster_select" on public.raster_overlays
  for select to authenticated using (
    visibility = 'club' or owner_id = auth.uid()
  );

drop policy if exists "raster_insert_own" on public.raster_overlays;
create policy "raster_insert_own" on public.raster_overlays
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists "raster_update_own" on public.raster_overlays;
create policy "raster_update_own" on public.raster_overlays
  for update to authenticated using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "raster_delete_own" on public.raster_overlays;
create policy "raster_delete_own" on public.raster_overlays
  for delete to authenticated using (owner_id = auth.uid());
