-- HANDI - Storage buckets pentru poze si overlay raster
-- Ruleaza dupa 0001_init.sql

-- =========================================================
-- 1. Bucket pentru poze atasate punctelor
-- =========================================================
insert into storage.buckets (id, name, public)
values ('point-photos', 'point-photos', true)
on conflict (id) do nothing;

-- =========================================================
-- 2. Bucket pentru raster overlays (termal/LIDAR/ortofoto)
-- =========================================================
insert into storage.buckets (id, name, public)
values ('raster-overlays', 'raster-overlays', true)
on conflict (id) do nothing;

-- =========================================================
-- 2b. Bucket pentru planuri pesteri (DXF)
-- =========================================================
insert into storage.buckets (id, name, public)
values ('cave-plans', 'cave-plans', true)
on conflict (id) do nothing;

-- =========================================================
-- 3. Policy pentru point-photos: orice membru autentificat poate citi,
--    insera/sterge pozele pentru punctele lui
-- =========================================================

-- Public read (pozele sunt in bucket public, acces dirijat prin RLS pe metadata).
-- In Supabase Storage RLS se aplica la storage.objects.

drop policy if exists "point_photos_read" on storage.objects;
create policy "point_photos_read" on storage.objects
  for select to public using (bucket_id = 'point-photos');

drop policy if exists "point_photos_insert_authenticated" on storage.objects;
create policy "point_photos_insert_authenticated" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'point-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "point_photos_delete_owner" on storage.objects;
create policy "point_photos_delete_owner" on storage.objects
  for delete to authenticated
  using (bucket_id = 'point-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Convenient: store path = {auth.uid()}/{point_id}/{filename}
-- => primul folder = uid; doar el poate insera/sterge.

-- =========================================================
-- 4. Policy pentru raster-overlays
-- =========================================================
drop policy if exists "raster_read" on storage.objects;
create policy "raster_read" on storage.objects
  for select to authenticated using (bucket_id = 'raster-overlays');

drop policy if exists "raster_insert_authenticated" on storage.objects;
create policy "raster_insert_authenticated" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'raster-overlays' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "raster_delete_owner" on storage.objects;
create policy "raster_delete_owner" on storage.objects
  for delete to authenticated
  using (bucket_id = 'raster-overlays' and (storage.foldername(name))[1] = auth.uid()::text);

-- =========================================================
-- 5. Policy pentru cave-plans (DXF)
-- =========================================================
drop policy if exists "cave_plans_read" on storage.objects;
create policy "cave_plans_read" on storage.objects
  for select to authenticated using (bucket_id = 'cave-plans');

drop policy if exists "cave_plans_insert_authenticated" on storage.objects;
create policy "cave_plans_insert_authenticated" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'cave-plans' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "cave_plans_delete_owner" on storage.objects;
create policy "cave_plans_delete_owner" on storage.objects
  for delete to authenticated
  using (bucket_id = 'cave-plans' and (storage.foldername(name))[1] = auth.uid()::text);
