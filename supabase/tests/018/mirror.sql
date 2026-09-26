-- 018 mirror test, SQL side: for every string in strings.json, what the database decides
-- (place name, short text field, long text field, and the cleaned forms). run.sh saves this as
-- JSON and mirror.js compares it with src/lib/fields.js.
select json_agg(json_build_array(s,
  private.measurement_text_error(private.measurement_clean(s, true), 120, public.comment_domains()),
  private.measurement_text_error(private.measurement_clean(s, false), 200, public.comment_domains()),
  private.measurement_text_error(private.measurement_clean(s, false), 2000, public.comment_domains()),
  private.measurement_clean(s, true),
  private.measurement_clean(s, false)) order by o)
from jsonb_array_elements_text(:'strings'::jsonb) with ordinality x(s, o);
