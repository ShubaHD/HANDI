-- Cave plans (import DXF/DWG exported to DXF), georef Stereo70 -> WGS84
-- Requires: 0001_init.sql, 0002_storage.sql, 0003_geojson_columns.sql

do $$ begin
  create type public.cave_plan_kind as enum ('survey_plan', 'geology', 'other');
exception when duplicate_object then null; end $$;

create table if not exists public.cave_plans (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  kind public.cave_plan_kind not null default 'survey_plan',
  description text,
  visibility public.visibility not null default 'club',
  -- DXF file stored in Supabase Storage (bucket: cave-plans)
  source_path text,
  -- geometries in WGS84
  geom geography(MultiLineString, 4326) not null,
  geom_json jsonb generated always as (st_asgeojson(geom)::jsonb) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cave_plans_geom_idx on public.cave_plans using gist (geom);
create index if not exists cave_plans_owner_idx on public.cave_plans (owner_id);

drop trigger if exists cave_plans_touch_updated on public.cave_plans;
create trigger cave_plans_touch_updated before update on public.cave_plans
  for each row execute function public.touch_updated_at();

alter table public.cave_plans enable row level security;

drop policy if exists "cave_plans_select" on public.cave_plans;
create policy "cave_plans_select" on public.cave_plans
  for select to authenticated using (
    visibility = 'club' or owner_id = auth.uid()
  );

drop policy if exists "cave_plans_insert_own" on public.cave_plans;
create policy "cave_plans_insert_own" on public.cave_plans
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists "cave_plans_update_own" on public.cave_plans;
create policy "cave_plans_update_own" on public.cave_plans
  for update to authenticated using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "cave_plans_delete_own" on public.cave_plans;
create policy "cave_plans_delete_own" on public.cave_plans
  for delete to authenticated using (owner_id = auth.uid());

