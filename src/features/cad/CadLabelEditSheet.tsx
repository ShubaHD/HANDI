import { useEffect, useRef, useState } from 'react';

export type CadLabelSavePayload = {
  text: string;
  description: string;
  photoFile: File | null;
  removePhoto: boolean;
};

interface Props {
  open: boolean;
  cadLayerName: string;
  initialText: string;
  initialDescription: string;
  initialPhotoUrl: string | null;
  photoUploadAvailable: boolean;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (payload: CadLabelSavePayload) => void;
  /** Șterge punctul / eticheta din stratul CAD (după confirmare în părinte). */
  onDelete?: () => void | Promise<void>;
}

export function CadLabelEditSheet({
  open,
  cadLayerName,
  initialText,
  initialDescription,
  initialPhotoUrl,
  photoUploadAvailable,
  saving,
  error,
  onClose,
  onSave,
  onDelete,
}: Props) {
  const [text, setText] = useState(initialText);
  const [description, setDescription] = useState(initialDescription);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setText(initialText);
    setDescription(initialDescription);
    setPhotoFile(null);
    setRemovePhoto(false);
    setPreviewUrl(null);
  }, [open, initialText, initialDescription]);

  useEffect(() => {
    if (!photoFile) {
      setPreviewUrl(null);
      return;
    }
    const u = URL.createObjectURL(photoFile);
    setPreviewUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [photoFile]);

  if (!open) return null;

  const displayPhoto = removePhoto ? null : previewUrl ?? initialPhotoUrl;

  const submit = () => {
    onSave({
      text: text.trim(),
      description: description.trim(),
      photoFile,
      removePhoto,
    });
  };

  return (
    <div className="fixed inset-0 z-[200] flex flex-col justify-end sm:justify-center sm:items-center pointer-events-auto">
      <button
        type="button"
        className="absolute inset-0 bg-black/50 sm:bg-black/40"
        aria-label="Închide"
        onClick={() => !saving && onClose()}
      />
      <div className="relative w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-slate-600 bg-slate-950 shadow-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] max-h-[88vh] flex flex-col gap-3 overflow-y-auto">
        <div className="flex items-start justify-between gap-2 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-white">Editează eticheta CAD</h2>
            <p className="text-xs text-slate-400 font-mono mt-0.5">{cadLayerName}</p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="shrink-0 px-2 py-1 rounded-lg text-slate-400 hover:bg-slate-800 text-sm"
          >
            ✕
          </button>
        </div>

        <label className="block text-xs uppercase text-slate-400">Text pe hartă</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="w-full min-h-[88px] px-3 py-3 rounded-xl bg-slate-900 border border-slate-600 text-base text-white focus:outline-none focus:border-brand-500 touch-manipulation"
        />

        <label className="block text-xs uppercase text-slate-400">Descriere (teren)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="Observații, acces, echipament…"
          autoComplete="off"
          className="w-full min-h-[100px] px-3 py-3 rounded-xl bg-slate-900 border border-slate-600 text-sm text-white focus:outline-none focus:border-brand-500 touch-manipulation placeholder:text-slate-600"
        />

        <div className="space-y-2">
          <span className="block text-xs uppercase text-slate-400">Poză</span>
          {!photoUploadAvailable && (
            <p className="text-xs text-amber-200/90">Pentru încărcare foto e nevoie de conexiune la Supabase.</p>
          )}
          {displayPhoto && (
            <div className="rounded-xl border border-slate-700 overflow-hidden bg-slate-900 max-h-48 flex justify-center">
              <img src={displayPhoto} alt="" className="max-h-48 w-auto object-contain" />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              disabled={saving || !photoUploadAvailable}
              onChange={(e) => {
                const f = e.target.files?.[0];
                setPhotoFile(f ?? null);
                if (f) setRemovePhoto(false);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={saving || !photoUploadAvailable}
              onClick={() => fileRef.current?.click()}
              className="px-3 py-2 rounded-xl border border-slate-600 text-slate-200 text-sm hover:bg-slate-800 disabled:opacity-50 touch-manipulation"
            >
              {initialPhotoUrl || previewUrl ? 'Schimbă poza' : 'Adaugă poză'}
            </button>
            {(initialPhotoUrl || previewUrl) && !removePhoto && (
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setRemovePhoto(true);
                  setPhotoFile(null);
                }}
                className="px-3 py-2 rounded-xl border border-red-900/60 text-red-300 text-sm hover:bg-red-950/40 disabled:opacity-50 touch-manipulation"
              >
                Elimină poza
              </button>
            )}
            {removePhoto && (
              <button
                type="button"
                disabled={saving}
                onClick={() => setRemovePhoto(false)}
                className="px-3 py-2 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-800 touch-manipulation"
              >
                Anulează eliminarea pozei
              </button>
            )}
          </div>
        </div>

        {error && <div className="text-sm text-red-300">{error}</div>}

        <div className="flex flex-col gap-2 pt-1 shrink-0">
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="flex-1 py-3 rounded-xl border border-slate-600 text-slate-200 hover:bg-slate-800 text-base touch-manipulation"
            >
              Anulează
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={submit}
              className="flex-1 py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-medium text-base touch-manipulation disabled:opacity-50"
            >
              {saving ? 'Salvez…' : 'Salvează'}
            </button>
          </div>
          {onDelete && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void onDelete()}
              className="w-full py-3 rounded-xl border border-red-900/70 text-red-300 hover:bg-red-950/50 text-base touch-manipulation disabled:opacity-50"
            >
              Șterge eticheta de pe hartă
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
