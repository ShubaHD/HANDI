-- Adnotare desen manual (creion): LineString în geom, fără lat/lon punct.

alter table public.annotations drop constraint if exists annotations_kind_check;
alter table public.annotations drop constraint if exists annotations_check;

alter table public.annotations add constraint annotations_kind_check check (kind in ('symbol', 'text', 'arrow', 'sketch'));

alter table public.annotations add constraint annotations_check check (
  (kind in ('symbol', 'text') and lat is not null and lon is not null)
  or (kind in ('arrow', 'sketch') and lat is null and lon is null)
);
