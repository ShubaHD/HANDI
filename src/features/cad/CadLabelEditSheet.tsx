import { useEffect, useState } from 'react';

interface Props {
  open: boolean;
  cadLayerName: string;
  initialText: string;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (text: string) => void;
}

export function CadLabelEditSheet({
  open,
  cadLayerName,
  initialText,
  saving,
  error,
  onClose,
  onSave,
}: Props) {
  const [text, setText] = useState(initialText);

  useEffect(() => {
    if (open) setText(initialText);
  }, [open, initialText]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex flex-col justify-end sm:justify-center sm:items-center pointer-events-auto">
      <button
        type="button"
        className="absolute inset-0 bg-black/50 sm:bg-black/40"
        aria-label="Închide"
        onClick={() => !saving && onClose()}
      />
      <div className="relative w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-slate-600 bg-slate-950 shadow-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] max-h-[85vh] flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
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
        <label className="block text-xs uppercase text-slate-400">Text</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="w-full min-h-[120px] px-3 py-3 rounded-xl bg-slate-900 border border-slate-600 text-base text-white focus:outline-none focus:border-brand-500 touch-manipulation"
        />
        {error && <div className="text-sm text-red-300">{error}</div>}
        <div className="flex gap-2 pt-1">
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
            onClick={() => onSave(text.trim())}
            className="flex-1 py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-medium text-base touch-manipulation disabled:opacity-50"
          >
            {saving ? 'Salvez…' : 'Salvează'}
          </button>
        </div>
      </div>
    </div>
  );
}
