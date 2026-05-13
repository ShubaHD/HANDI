import { useEffect, useState } from 'react';
import { useOnline } from '@/lib/db/online';
import { pendingCount, processQueue } from '@/lib/db/syncQueue';

interface Props {
  refreshTick: number;
  onSynced: () => void;
}

export function SyncIndicator({ refreshTick, onSynced }: Props) {
  const online = useOnline();
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    pendingCount().then((c) => mounted && setPending(c));
    return () => {
      mounted = false;
    };
  }, [refreshTick]);

  const flush = async () => {
    setBusy(true);
    const { flushed } = await processQueue();
    setBusy(false);
    setPending(await pendingCount());
    if (flushed > 0) onSynced();
  };

  return (
    <div className="flex shrink-0 flex-nowrap items-center gap-1.5 text-[11px] whitespace-nowrap sm:text-xs">
      <span
        className={`inline-block w-2 h-2 rounded-full ${
          online ? 'bg-emerald-400' : 'bg-amber-400'
        }`}
        title={online ? 'Online' : 'Offline'}
      />
      <span className={online ? 'text-emerald-300' : 'text-amber-300'}>
        {online ? 'Online' : 'Offline'}
      </span>
      {pending > 0 && (
        <button
          onClick={flush}
          disabled={busy || !online}
          className="ml-1 px-2 py-0.5 rounded-md border border-amber-700 bg-amber-900/40 text-amber-200 hover:bg-amber-900/70 disabled:opacity-50"
          title="Sincronizeaza acum"
        >
          {busy ? 'Sync...' : `${pending} in coada`}
        </button>
      )}
    </div>
  );
}
