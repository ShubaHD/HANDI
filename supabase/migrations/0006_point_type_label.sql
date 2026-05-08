-- Add point_type enum value for text-only map labels
do $$ begin
  alter type public.point_type add value 'label';
exception
  when duplicate_object then null;
end $$;
