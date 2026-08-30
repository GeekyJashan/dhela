-- Search the fields carried over from a distributor's old software.
--
-- Those fields are deliberately left out of the catalogue query, so the
-- browser cannot search what it never loaded. This returns just the ids that
-- match, and the screen widens its filter to include them — the payload stays
-- a list of uuids rather than every product's blob.
--
-- SECURITY INVOKER (the default, stated here because it is the point): the
-- caller's own row-level security applies, so this can only ever return ids
-- from the caller's organization. A definer function here would be a way to
-- read every distributor's catalogue.

create or replace function products_matching_extra(_q text)
returns table (id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select p.id
    from products p
   where p.extra <> '{}'::jsonb
     and position(lower(_q) in lower(p.extra::text)) > 0
$$;

revoke execute on function products_matching_extra(text) from public, anon;
grant execute on function products_matching_extra(text) to authenticated;
