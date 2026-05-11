-- Extinde tipurile CAD pentru subtipuri de etichete (DXF) + compatibilitate cu style JSON (cadLabelLocked, cadLabelMaxZoom).

alter table public.cad_layers drop constraint if exists cad_layers_kind_check;

alter table public.cad_layers add constraint cad_layers_kind_check check (
  kind in (
    'caves',
    'dolines',
    'contours',
    'labels',
    'labels_caves',
    'labels_ridges',
    'labels_places',
    'springs',
    'avens',
    'other'
  )
);
