import { useEffect, useState } from 'react';
import { useAppConfirm } from '@/components/ConfirmProvider';
import { POINT_TYPES, type PointOfInterest } from '@/lib/types';
import { fetchPhotosForPoint, uploadPhotos, deletePhoto, type PhotoRecord } from './photos';
import { safeDeletePoint } from '@/lib/db/safeApi';
import { appleMapsDirectionsUrl, googleMapsDirectionsUrl } from './navigationUrls';

interface Props {
  point: PointOfInterest;
  onClose: () => void;
  onChanged: () => void;
}

export function PointDetail({ point, onClose, onChanged }: Props) {
  const ask = useAppConfirm();
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = POINT_TYPES.find((t) => t.value === point.type);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    fetchPhotosForPoint(point.id)
      .then((p) => {
        if (!cancel) setPhotos(p);
      })
      .catch((e) => {
        if (!cancel) setError(e instanceof Error ? e.message : 'Eroare poze');
      })
      .finally(() => !cancel && setLoading(false));
    return () => {
      cancel = true;
    };
  }, [point.id]);

  const onUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const newOnes = await uploadPhotos(point.id, Array.from(files));
      setPhotos((p) => [...p, ...newOnes]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload esuat');
    } finally {
      setUploading(false);
    }
  };

  const onDeletePhoto = async (id: string, path: string) => {
    if (!(await ask('Stergi poza?'))) return;
    try {
      await deletePhoto(id, path);
      setPhotos((p) => p.filter((x) => x.id !== id));
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Stergere esuata');
    }
  };

  const onDeletePoint = async () => {
    if (!(await ask('Stergi acest punct si toate pozele lui?'))) return;
    try {
      const r = await safeDeletePoint(point.id);
      if (r.ok === 'queued') alert('Stergere pusa in coada offline.');
      onChanged();
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Stergere esuata');
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-4 w-full max-w-md max-h-[90vh] overflow-y-auto">
      <div className="flex items-start gap-3 mb-3">
        <div
          className="w-10 h-10 rounded-full border-2 border-white flex-shrink-0 flex items-center justify-center text-white text-xs font-bold"
          style={{ backgroundColor: meta?.color ?? '#475569' }}
        >
          {meta?.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold truncate">{point.name}</h2>
          <div className="text-xs text-slate-400">
            {meta?.label}
            {point.visibility === 'private' && <span className="ml-2 text-amber-400">[privat]</span>}
          </div>
        </div>
        <button
          onClick={onClose}
          className="px-2 py-1 text-sm rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700"
        >
          Inchide
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs mb-3">
        <div className="px-3 py-2 bg-slate-800 rounded-lg">
          <div className="text-slate-400">Lat / Lon</div>
          <div className="font-mono text-slate-200">
            {point.lat.toFixed(5)}, {point.lon.toFixed(5)}
          </div>
        </div>
        <div className="px-3 py-2 bg-slate-800 rounded-lg">
          <div className="text-slate-400">Altitudine</div>
          <div className="font-mono text-slate-200">
            {point.elevation_m != null ? `${Math.round(point.elevation_m)} m` : '-'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
        <a
          href={googleMapsDirectionsUrl(point.lat, point.lon)}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
        >
          Navighează spre (Google Maps)
        </a>
        <a
          href={appleMapsDirectionsUrl(point.lat, point.lon)}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center py-2.5 rounded-lg bg-slate-800 border border-slate-600 hover:bg-slate-700 text-slate-100 text-sm font-medium"
        >
          Deschide în Apple Maps
        </a>
      </div>

      {point.description && (
        <div className="mb-3 px-3 py-2 bg-slate-800/60 rounded-lg text-sm text-slate-200 whitespace-pre-wrap">
          {point.description}
        </div>
      )}

      <div className="mb-2">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs uppercase text-slate-400">Foto ({photos.length})</span>
          <label className="text-xs px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 cursor-pointer">
            {uploading ? 'Se incarca...' : '+ adauga'}
            <input
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              hidden
              onChange={(e) => onUpload(e.target.files)}
            />
          </label>
        </div>
        {loading ? (
          <div className="text-xs text-slate-500 py-3 text-center">Se incarca...</div>
        ) : photos.length === 0 ? (
          <div className="text-xs text-slate-500 py-3 text-center">Nicio poza inca.</div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {photos.map((ph) => (
              <div key={ph.id} className="relative group">
                <a href={ph.url} target="_blank" rel="noreferrer">
                  <img
                    src={ph.url}
                    alt=""
                    className="w-full h-20 object-cover rounded-lg border border-slate-700"
                    loading="lazy"
                  />
                </a>
                <button
                  onClick={() => onDeletePhoto(ph.id, ph.storage_path)}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-slate-900/80 text-white text-xs opacity-0 group-hover:opacity-100 transition"
                  title="Sterge"
                >
                  X
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="my-2 text-xs text-red-300 bg-red-900/40 border border-red-700 rounded p-2">
          {error}
        </div>
      )}

      <button
        onClick={onDeletePoint}
        className="w-full mt-3 py-2 rounded-lg bg-red-900/40 text-red-300 border border-red-800 hover:bg-red-900/60 text-sm"
      >
        Sterge punctul
      </button>
    </div>
  );
}
