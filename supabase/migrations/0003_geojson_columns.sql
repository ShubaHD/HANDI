-- HANDI - Generated columns pentru GeoJSON
-- Faciliteaza citirea geometriilor prin Supabase REST (PostgREST nu serializeaza
-- direct geography in JSON; cu generated jsonb obtinem GeoJSON gata).

alter table public.zones
  add column if not exists geom_json jsonb generated always as (
    st_asgeojson(geom)::jsonb
  ) stored;

alter table public.tracks
  add column if not exists geom_json jsonb generated always as (
    st_asgeojson(geom)::jsonb
  ) stored;

alter table public.raster_overlays
  add column if not exists bounds_json jsonb generated always as (
    st_asgeojson(bounds)::jsonb
  ) stored;
