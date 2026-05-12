import { supabase } from '@/lib/supabase';

const BUCKET = 'cad-label-photos';

export async function uploadCadLabelPhoto(args: {
  cadLayerRowId: string;
  featureFid: string;
  file: File;
}): Promise<{ storagePath: string; publicUrl: string }> {
  const { data: u } = await supabase.auth.getUser();
  const userId = u.user?.id;
  if (!userId) throw new Error('Trebuie să fii autentificat');

  const blob = args.file;
  const dotIdx = blob.name.lastIndexOf('.');
  const ext = (dotIdx >= 0 ? blob.name.slice(dotIdx + 1) : 'jpg').toLowerCase();
  const safeExt = /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'jpg';
  const path = `${userId}/cad-labels/${args.cadLayerRowId}/${args.featureFid}.${safeExt}`;

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, {
    cacheControl: '3600',
    upsert: true,
    contentType: blob.type || 'image/jpeg',
  });
  if (upErr) throw upErr;

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { storagePath: path, publicUrl: pub.publicUrl };
}

export async function deleteCadLabelPhotoStorage(storagePath: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([storagePath]);
}
