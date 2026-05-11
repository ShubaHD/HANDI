-- Culoare opțională pe marcaj (hex); null = culoare implicită după tip
alter table public.points
  add column if not exists marker_color text;

comment on column public.points.marker_color is 'Hex #rrggbb pentru cerc pe hartă; gol = paleta implicită după tip';
