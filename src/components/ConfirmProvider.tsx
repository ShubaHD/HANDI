import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/** Înlocuiește `window.confirm` cu un dialog în-app (mai robust pe desktop / PWA). */
export type AppConfirmFn = (message: string) => Promise<boolean>;

const ConfirmContext = createContext<AppConfirmFn | null>(null);

export function useAppConfirm(): AppConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) {
    throw new Error('useAppConfirm trebuie folosit în interiorul ConfirmProvider');
  }
  return fn;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const resolveRef = useRef<((v: boolean) => void) | null>(null);
  const openRef = useRef(false);

  const ask = useCallback<AppConfirmFn>((msg) => {
    return new Promise<boolean>((resolve) => {
      if (openRef.current) {
        resolve(false);
        return;
      }
      openRef.current = true;
      resolveRef.current = resolve;
      setMessage(msg);
    });
  }, []);

  const finish = useCallback((value: boolean) => {
    openRef.current = false;
    const r = resolveRef.current;
    resolveRef.current = null;
    setMessage(null);
    r?.(value);
  }, []);

  useEffect(() => {
    if (!message) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [message, finish]);

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {message != null && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/75 p-4 pointer-events-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="handi-confirm-msg"
          onClick={() => finish(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-slate-600 bg-slate-900 p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p id="handi-confirm-msg" className="text-sm text-slate-100 whitespace-pre-wrap">
              {message}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                onClick={() => finish(false)}
              >
                Anulează
              </button>
              <button
                type="button"
                className="rounded-lg bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-600"
                onClick={() => finish(true)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
