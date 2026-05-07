-- CAD imports: DXF complet grupat pe layere CAD (Stereo70 -> WGS84 in client)
-- Ruleaza dupa 0001, 0002, 0003, 0004

-- =========================================================
-- 1. Bucket Storage pentru fisiere DXF import complete
-- =========================================================
insert into storage.buckets (id, name, public)
values ('cad-imports', 'cad-imports', true)
on conflict (id) do nothing;

drop policy if exists "cad_imports_read" on storage.objects;
create policy "cad_imports_read" on storage.objects
  for select to authenticated using (bucket_id = 'cad-imports');

drop policy if exists "cad_imports_insert_authenticated" on storage.objects;
create policy "cad_imports_insert_authenticated" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'cad-imports' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "cad_imports_delete_owner" on storage.objects;
create policy "cad_imports_delete_owner" on storage.objects
  for delete to authenticated
  using (bucket_id = 'cad-imports' and (storage.foldername(name))[1] = auth.uid()::text);

-- =========================================================
-- 2. Tabele
-- =========================================================
create table if not exists public.cad_imports (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  source_path text,
  bounds geography(Polygon, 4326) not null,
  bounds_json jsonb generated always as (st_asgeojson(bounds)::jsonb) stored,
  visibility public.visibility not null default 'club',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cad_imports_bounds_idx on public.cad_imports using gist (bounds);
create index if not exists cad_imports_owner_idx on public.cad_imports (owner_id);

create table if not exists public.cad_layers (
  id uuid primary key default uuid_generate_v4(),
  import_id uuid not null references public.cad_imports(id) on delete cascade,
  cad_layer text not null,
  kind text not null check (kind in ('caves', 'dolines', 'contours', 'labels', 'springs', 'avens', 'other')),
  features jsonb not null default '{"type":"FeatureCollection","features":[]}'::jsonb,
  style jsonb not null default '{}'::jsonb,
  visible boolean not null default true,
  feature_count int generated always as (coalesce(jsonb_array_length(features->'features'), 0)) stored,
  created_at timestamptz not null default now(),
  unique (import_id, cad_layer)
);

create index if not exists cad_layers_import_idx on public.cad_layers (import_id);

drop trigger if exists cad_imports_touch_updated on public.cad_imports;
create trigger cad_imports_touch_updated before update on public.cad_imports
  for each row execute function public.touch_updated_at();

-- =========================================================
-- 3. RLS
-- =========================================================
alter table public.cad_imports enable row level security;
alter table public.cad_layers enable row level security;

drop policy if exists "cad_imports_select" on public.cad_imports;
create policy "cad_imports_select" on public.cad_imports
  for select to authenticated using (
    visibility = 'club' or owner_id = auth.uid()
  );

drop policy if exists "cad_imports_insert_own" on public.cad_imports;
create policy "cad_imports_insert_own" on public.cad_imports
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists "cad_imports_update_own" on public.cad_imports;
create policy "cad_imports_update_own" on public.cad_imports
  for update to authenticated using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "cad_imports_delete_own" on public.cad_imports;
create policy "cad_imports_delete_own" on public.cad_imports
  for delete to authenticated using (owner_id = auth.uid());

drop policy if exists "cad_layers_select" on public.cad_layers;
create policy "cad_layers_select" on public.cad_layers
  for select to authenticated using (
    exists (
      select 1 from public.cad_imports i
      where i.id = cad_layers.import_id
        and (i.visibility = 'club' or i.owner_id = auth.uid())
    )
  );

drop policy if exists "cad_layers_insert_own" on public.cad_layers;
create policy "cad_layers_insert_own" on public.cad_layers
  for insert to authenticated with check (
    exists (
      select 1 from public.cad_imports i
      where i.id = import_id and i.owner_id = auth.uid()
    )
  );

drop policy if exists "cad_layers_update_own" on public.cad_layers;
create policy "cad_layers_update_own" on public.cad_layers
  for update to authenticated using (
    exists (
      select 1 from public.cad_imports i
      where i.id = import_id and i.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.cad_imports i
      where i.id = import_id and i.owner_id = auth.uid()
    )
  );

drop policy if exists "cad_layers_delete_own" on public.cad_layers;
create policy "cad_layers_delete_own" on public.cad_layers
  for delete to authenticated using (
    exists (
      select 1 from public.cad_imports i
      where i.id = import_id and i.owner_id = auth.uid()
    )
  );
