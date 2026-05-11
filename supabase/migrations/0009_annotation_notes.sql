-- Observații / notițe pe adnotări (export, documentare)
alter table public.annotations
  add column if not exists notes text;

comment on column public.annotations.notes is 'Observatii libere; export CSV / alte programe';
