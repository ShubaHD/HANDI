export type HoverTooltipLine = { label?: string; value: string };

export type HoverTooltipData = {
  title: string;
  subtitle?: string;
  lines?: HoverTooltipLine[];
};

export function MapHoverTooltip({
  x,
  y,
  data,
}: {
  x: number;
  y: number;
  data: HoverTooltipData;
}) {
  const lines = (data.lines ?? []).filter((l) => l.value);
  return (
    <div
      className="pointer-events-none absolute z-[999] max-w-xs"
      style={{
        left: x + 12,
        top: y + 12,
      }}
    >
      <div className="rounded-xl border border-slate-700 bg-slate-950/95 backdrop-blur px-3 py-2 shadow-2xl">
        <div className="text-sm font-semibold text-white truncate">{data.title}</div>
        {data.subtitle && <div className="text-[11px] text-slate-400 truncate">{data.subtitle}</div>}
        {lines.length > 0 && (
          <div className="mt-1 space-y-0.5">
            {lines.slice(0, 4).map((l, i) => (
              <div key={i} className="text-[11px] text-slate-300 flex gap-2">
                {l.label ? <span className="text-slate-500 w-16 flex-shrink-0">{l.label}</span> : null}
                <span className="truncate">{l.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function asText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

export function titleFromProps(props: Record<string, unknown>): string {
  if (props.kind === 'sketch') return 'Creion';
  return (
    asText(props.name) ||
    asText(props.title) ||
    asText(props.cad_label) ||
    asText(props.dxfText) ||
    asText(props.text) ||
    asText(props.block) ||
    asText(props.symbol) ||
    asText(props.kind) ||
    '—'
  );
}

export function subtitleFromLayer(layerId: string): string {
  if (layerId.startsWith('cadlay-')) return 'CAD';
  if (layerId.startsWith('raster-overlay-lyr-')) return 'Raster';
  if (layerId.startsWith('poi-')) return 'Punct';
  if (layerId.startsWith('zones-')) return 'Zonă';
  if (layerId.startsWith('tracks-') || layerId.startsWith('live-track-')) return 'Traseu';
  return layerId;
}

