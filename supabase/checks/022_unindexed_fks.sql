-- 022_unindexed_fks.sql — READ-ONLY. Foreign keys (schemas public / private) whose leading
-- column has no index. Before 022 the Performance Advisor listed 11; after 022 this returns no rows.
-- Run in the Supabase SQL Editor any time.
select c.conrelid::regclass as tbl, a.attname as col, c.conname
from pg_constraint c
join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
where c.contype = 'f' and c.connamespace in ('public'::regnamespace, 'private'::regnamespace)
  and not exists (select 1 from pg_index i where i.indrelid = c.conrelid
                  and (i.indkey::int2[])[0:array_length(c.conkey,1)-1] = c.conkey)
order by 1, 2;
