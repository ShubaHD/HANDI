-- Stil adnotări: culoare săgeată, mărime/culoare text (JSON extensibil)
alter table public.annotations
  add column if not exists style jsonb not null default '{}'::jsonb;

comment on column public.annotations.style is 'JSON: arrowColor, textSizePx, textColor, etc.';
