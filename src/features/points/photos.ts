import { supabase } from '@/lib/supabase';

const BUCKET = 'point-photos';

export interface PhotoRecord {
  id: string;
  point_id: string;
  storage_path: string;
  taken_at: string | null;
  created_at: string;
  url: string;
}

export async function uploadPhotos(pointId: string, files: File[]): Promise<PhotoRecord[]> {
  const { data: u } = await supabase.auth.getUser();
  const userId = u.user?.id;
  if (!userId) throw new Error('Trebuie sa fii autentificat');

  const inserted: PhotoRecord[] = [];
  for (const file of files) {
    const dotIdx = file.name.lastIndexOf('.');
    const ext = (dotIdx >= 0 ? file.name.slice(dotIdx + 1) : 'jpg').toLowerCase();
    const path = `${userId}/${pointId}/${crypto.randomUUID()}.${ext}`;

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'image/jpeg',
    });
    if (upErr) throw upErr;

    const { data: row, error: insErr } = await supabase
      .from('photos')
      .insert({
        point_id: pointId,
        storage_path: path,
        taken_at: file.lastModified ? new Date(file.lastModified).toISOString() : null,
      })
      .select()
      .single();
    if (insErr) throw insErr;

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    inserted.push({ ...(row as Omit<PhotoRecord, 'url'>), url: pub.publicUrl });
  }
  return inserted;
}

export async function fetchPhotosForPoint(pointId: string): Promise<PhotoRecord[]> {
  const { data, error } = await supabase
    .from('photos')
    .select('id, point_id, storage_path, taken_at, created_at')
    .eq('point_id', pointId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(r.storage_path);
    return { ...r, url: pub.publicUrl } as PhotoRecord;
  });
}

export async function deletePhoto(photoId: string, storagePath: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([storagePath]);
  const { error } = await supabase.from('photos').delete().eq('id', photoId);
  if (error) throw error;
}
