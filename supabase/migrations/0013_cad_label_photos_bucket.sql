-- Bucket pentru poze atașate etichetelor CAD (metadata în GeoJSON: handi_photo_*).
insert into storage.buckets (id, name, public)
values ('cad-label-photos', 'cad-label-photos', true)
on conflict (id) do nothing;

drop policy if exists "cad_label_photos_read" on storage.objects;
create policy "cad_label_photos_read" on storage.objects
  for select to public using (bucket_id = 'cad-label-photos');

drop policy if exists "cad_label_photos_insert_authenticated" on storage.objects;
create policy "cad_label_photos_insert_authenticated" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'cad-label-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "cad_label_photos_update_owner" on storage.objects;
create policy "cad_label_photos_update_owner" on storage.objects
  for update to authenticated
  using (bucket_id = 'cad-label-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'cad-label-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "cad_label_photos_delete_owner" on storage.objects;
create policy "cad_label_photos_delete_owner" on storage.objects
  for delete to authenticated
  using (bucket_id = 'cad-label-photos' and (storage.foldername(name))[1] = auth.uid()::text);
