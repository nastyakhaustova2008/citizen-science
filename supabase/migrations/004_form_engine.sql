-- 004_form_engine.sql
-- Roadmap step 3: measurement forms built from each campaign's field definitions.
-- Run once in the Supabase SQL Editor, AFTER 003_measurements_campaign_fk.sql.
-- Safe to re-run BEFORE 005 (tables/columns "if not exists", inserts skip existing rows,
-- backfill only touches rows that were not converted yet). After 005 it is not needed and
-- fails on purpose (the old `value` column it reads is gone).
--
-- NOT backward compatible: after this, code that inserts only the old `value` column
-- (no field_values) is rejected. See CLAUDE.md for the deploy order (004 → preview → merge → 005).
--
-- What it does:
--   1. campaigns: + form_version; metric becomes optional (it is now only a colour-scale preset).
--   2. New tables campaign_fields and campaign_field_options (+ read-only TEMPORARY RLS).
--   3. Converts the 4 metrics into field definitions for the existing campaigns
--      (primary number field + instrument, conditions, notes, photo).
--   4. measurements: + field_values jsonb, + form_version; copies value/instrument/conditions/notes
--      into field_values. The old columns stay (value becomes nullable) until 005 drops them.
--   5. Triggers that enforce the editing rules and validate every inserted measurement.
--
-- Why tables and not a jsonb column on campaigns: every rule below ("key/type/unit never
-- change", "never delete, archive instead", "one primary field") is a plain constraint or
-- a small row trigger on a table; with jsonb each rule would mean diffing arrays of objects.
-- The admin editor (step 5) will edit fields row by row with per-row RLS.
--
-- Why the column is called field_values and not "values": VALUES is an SQL keyword.

-- =====================================================================
-- 1. campaigns
-- =====================================================================

alter table public.campaigns
  add column if not exists form_version integer not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_form_version_check'
                 and conrelid = 'public.campaigns'::regclass) then
    alter table public.campaigns
      add constraint campaigns_form_version_check check (form_version >= 1);
  end if;
end
$$;

-- metric is now only an optional colour/scale preset key in src/data/metrics.js.
alter table public.campaigns alter column metric drop not null;

-- =====================================================================
-- 2. Field definitions
-- =====================================================================

create table if not exists public.campaign_fields (
  campaign_id  text not null references public.campaigns (id) on update cascade on delete cascade,
  -- Permanent key: measurements store values under it. Never changes (trigger below).
  -- Reserved names are the built-in export columns; "<x>_unit" is reserved for number units.
  key          text not null
               check (key ~ '^[a-z][a-z0-9_]{0,39}$'
                      and key !~ '_unit$'
                      and key not in ('id', 'campaign', 'metric', 'date', 'time', 'timestamp',
                                      'place', 'school', 'lat', 'lng', 'verification',
                                      'form_version', 'value', 'unit', 'user', 'observation_id')),
  type         text not null
               check (type in ('number', 'choice', 'multi_choice', 'text', 'boolean', 'datetime', 'photo')),
  label_he     text not null check (length(trim(label_he)) > 0),
  label_en     text not null check (length(trim(label_en)) > 0),
  label_ru     text not null check (length(trim(label_ru)) > 0),
  help_he      text not null default '',
  help_en      text not null default '',
  help_ru      text not null default '',
  required     boolean not null default false,
  sort_order   integer not null default 0,
  archived     boolean not null default false,  -- "deleted": hidden in the form, old data still shown
  is_primary   boolean not null default false,  -- the number field used for map colours, charts, stats
  -- number only:
  unit         text,                            -- never changes (trigger below)
  min_value    numeric,
  max_value    numeric,
  decimals     smallint,                        -- max digits after the point
  -- text only:
  text_long    boolean not null default false,  -- false: short (≤200 chars), true: long (≤2000)
  created_at   timestamptz not null default now(),
  primary key (campaign_id, key),
  constraint campaign_fields_number_config check (
    case when type = 'number'
      then decimals is not null and decimals between 0 and 6
           and (min_value is null or max_value is null or min_value <= max_value)
      else unit is null and min_value is null and max_value is null and decimals is null
    end),
  constraint campaign_fields_text_config check (type = 'text' or not text_long),
  constraint campaign_fields_primary_check check (not is_primary or (type = 'number' and not archived))
);

-- At most one primary field per campaign.
create unique index if not exists campaign_fields_one_primary_idx
  on public.campaign_fields (campaign_id) where is_primary;

create table if not exists public.campaign_field_options (
  campaign_id  text not null,
  field_key    text not null,
  key          text not null check (key ~ '^[a-z0-9][a-z0-9_]{0,39}$'),  -- permanent
  label_he     text not null check (length(trim(label_he)) > 0),
  label_en     text not null check (length(trim(label_en)) > 0),
  label_ru     text not null check (length(trim(label_ru)) > 0),
  sort_order   integer not null default 0,
  archived     boolean not null default false,  -- hidden in the form, old data still shown
  created_at   timestamptz not null default now(),
  primary key (campaign_id, field_key, key),
  foreign key (campaign_id, field_key)
    references public.campaign_fields (campaign_id, key) on update cascade on delete cascade
);

alter table public.campaign_fields enable row level security;
alter table public.campaign_field_options enable row level security;

-- =====================================================================
-- TEMPORARY ACCESS RULES — no login yet (same as campaigns).
-- Anyone (anon key) may READ field definitions. No INSERT / UPDATE / DELETE:
-- fields are changed only from the SQL Editor until step 4/5.
-- =====================================================================

revoke all on public.campaign_fields, public.campaign_field_options from anon, authenticated;
grant select on public.campaign_fields, public.campaign_field_options to anon, authenticated;

drop policy if exists "TEMPORARY anyone can read campaign fields" on public.campaign_fields;
create policy "TEMPORARY anyone can read campaign fields"
  on public.campaign_fields for select to anon, authenticated using (true);

drop policy if exists "TEMPORARY anyone can read campaign field options" on public.campaign_field_options;
create policy "TEMPORARY anyone can read campaign field options"
  on public.campaign_field_options for select to anon, authenticated using (true);

-- =====================================================================
-- 3. Convert the 4 metrics into field definitions (existing campaigns only)
-- =====================================================================

-- Primary number field, one per metric. Hard limits are wider than the "plausible"
-- range in metrics.js (that one stays a soft "are you sure?" warning in the UI).
insert into public.campaign_fields
  (campaign_id, key, type, label_he, label_en, label_ru, required, sort_order, is_primary,
   unit, min_value, max_value, decimals)
select c.id, p.key, 'number', p.label_he, p.label_en, p.label_ru, true, 1, true,
       p.unit, p.min_value, p.max_value, p.decimals
from public.campaigns c
join (values
  ('temperature',   'temperature',    'טמפרטורה',            'Temperature',           'Температура',              '°C',          -40, 70,   1),
  ('humidity',      'humidity',       'לחות אבסולוטית',      'Absolute humidity',     'Абсолютная влажность',     'g/m³',          0, 60,   1),
  ('skyBrightness', 'sky_brightness', 'בהירות שמיים',        'Sky brightness',        'Яркость неба',             'mag/arcsec²',  10, 25,   2),
  ('airQuality',    'pm25',           'חלקיקים נשימים PM2.5', 'Fine particles PM2.5', 'Взвешенные частицы PM2.5', 'µg/m³',         0, 1000, 0)
) as p(metric, key, label_he, label_en, label_ru, unit, min_value, max_value, decimals)
  on p.metric = c.metric
on conflict do nothing;

-- The fields every existing campaign had in the old fixed wizard.
insert into public.campaign_fields
  (campaign_id, key, type, label_he, label_en, label_ru, help_he, help_en, help_ru,
   required, sort_order, text_long)
select c.id, f.key, f.type, f.label_he, f.label_en, f.label_ru, f.help_he, f.help_en, f.help_ru,
       f.required, f.sort_order, f.text_long
from public.campaigns c
cross join (values
  ('instrument', 'text', 'מכשיר מדידה', 'Instrument', 'Прибор',
   'לדוגמה: תרמומטר דיגיטלי TFA 30.1', 'e.g. TFA 30.1 digital thermometer', 'напр. цифровой термометр TFA 30.1',
   true, 2, false),
  ('conditions', 'text', 'תנאי מזג אוויר', 'Weather conditions', 'Погодные условия',
   'שמש / מעונן / אחרי גשם…', 'sunny / overcast / after rain…', 'солнечно / пасмурно / после дождя…',
   false, 3, false),
  ('notes', 'text', 'הערות', 'Notes', 'Примечания',
   'כל דבר חריג בסביבת המדידה', 'Anything unusual near the measurement site', 'Что-либо необычное рядом с точкой измерения',
   false, 4, true),
  ('photo', 'photo', 'תמונה', 'Photo', 'Фото',
   'צלמו את המכשיר עם הרקע של נקודת המדידה.', 'Photograph the instrument against the site background.', 'Сфотографируйте прибор на фоне точки измерения.',
   false, 5, false)
) as f(key, type, label_he, label_en, label_ru, help_he, help_en, help_ru, required, sort_order, text_long)
where c.metric in ('temperature', 'humidity', 'skyBrightness', 'airQuality')
on conflict do nothing;

-- =====================================================================
-- 4. measurements: field_values + form_version, backfill
-- =====================================================================

alter table public.measurements add column if not exists field_values jsonb not null default '{}'::jsonb;
alter table public.measurements add column if not exists form_version integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'measurements_field_values_object'
                 and conrelid = 'public.measurements'::regclass) then
    alter table public.measurements
      add constraint measurements_field_values_object check (jsonb_typeof(field_values) = 'object');
  end if;
end
$$;

-- The old value column is no longer written by the app; 005 drops it.
alter table public.measurements alter column value drop not null;

-- Copy the old columns into field_values (only rows not converted yet). Empty strings are left out.
update public.measurements m
set field_values = jsonb_strip_nulls(jsonb_build_object(
      f.key,        m.value,
      'instrument', nullif(m.instrument, ''),
      'conditions', nullif(m.conditions, ''),
      'notes',      nullif(m.notes, ''))),
    form_version = 1
from public.campaign_fields f
where f.campaign_id = m.observation_id
  and f.is_primary
  and m.field_values = '{}'::jsonb
  and m.value is not null;

-- Anything left without a version (should be nothing) counts as version 1.
update public.measurements set form_version = 1 where form_version is null;
alter table public.measurements alter column form_version set not null;

-- =====================================================================
-- 5. Triggers
-- =====================================================================

-- ---- form_version: +1 once per transaction per campaign ----------------------------------
-- A transaction-local setting remembers that the campaign was already bumped, so one admin
-- save that touches many fields/options = one new version.
create or replace function public.bump_form_version(p_campaign_id text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  flag text := 'mitzpe.fv_' || md5(p_campaign_id);
begin
  if current_setting(flag, true) = txid_current()::text then
    return;
  end if;
  perform set_config(flag, txid_current()::text, true);
  update public.campaigns set form_version = form_version + 1 where id = p_campaign_id;
end;
$$;

-- A new campaign starts at version 1 even if its fields are inserted in the same transaction.
create or replace function public.campaigns_form_version_on_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('mitzpe.fv_' || md5(new.id), txid_current()::text, true);
  return null;
end;
$$;

drop trigger if exists campaigns_form_version_on_insert on public.campaigns;
create trigger campaigns_form_version_on_insert
  after insert on public.campaigns
  for each row execute function public.campaigns_form_version_on_insert();

-- form_version can only go up.
create or replace function public.campaigns_form_version_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.form_version < old.form_version then
    raise exception 'form_version can only increase (% → %)', old.form_version, new.form_version;
  end if;
  return new;
end;
$$;

drop trigger if exists campaigns_form_version_guard on public.campaigns;
create trigger campaigns_form_version_guard
  before update of form_version on public.campaigns
  for each row execute function public.campaigns_form_version_guard();

-- ---- campaign_fields: editing rules --------------------------------------------------------
create or replace function public.campaign_fields_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.key is distinct from old.key then
      raise exception 'field key "%" cannot change (add a new field instead)', old.key;
    end if;
    if new.type is distinct from old.type then
      raise exception 'type of field "%" cannot change (add a new field instead)', old.key;
    end if;
    if new.unit is distinct from old.unit then
      raise exception 'unit of field "%" cannot change (add a new field instead)', old.key;
    end if;
    -- campaign_id may change only when the campaign itself was renamed (FK cascade).
    if new.campaign_id is distinct from old.campaign_id
       and exists (select 1 from public.campaigns where id = old.campaign_id) then
      raise exception 'field "%" cannot move to another campaign', old.key;
    end if;
    return new;
  end if;

  -- DELETE: archive instead. Allowed only when the campaign is being deleted (cascade)
  -- or has no measurements at all (fixing a draft).
  if exists (select 1 from public.campaigns where id = old.campaign_id)
     and exists (select 1 from public.measurements where observation_id = old.campaign_id) then
    raise exception 'field "%" cannot be deleted: the campaign has measurements. Set archived = true instead.', old.key;
  end if;
  return old;
end;
$$;

drop trigger if exists campaign_fields_guard on public.campaign_fields;
create trigger campaign_fields_guard
  before update or delete on public.campaign_fields
  for each row execute function public.campaign_fields_guard();

-- ---- campaign_field_options: editing rules -------------------------------------------------
create or replace function public.campaign_field_options_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ftype text;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    select type into ftype from public.campaign_fields
    where campaign_id = new.campaign_id and key = new.field_key;
    if ftype is distinct from 'choice' and ftype is distinct from 'multi_choice' then
      raise exception 'options are only allowed on choice / multi_choice fields ("%" is %)', new.field_key, ftype;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.key is distinct from old.key then
      raise exception 'option key "%" cannot change (add a new option instead)', old.key;
    end if;
    if (new.campaign_id, new.field_key) is distinct from (old.campaign_id, old.field_key)
       and exists (select 1 from public.campaigns where id = old.campaign_id) then
      raise exception 'option "%" cannot move to another field', old.key;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if exists (select 1 from public.campaigns where id = old.campaign_id)
       and exists (select 1 from public.measurements where observation_id = old.campaign_id) then
      raise exception 'option "%" cannot be deleted: the campaign has measurements. Set archived = true instead.', old.key;
    end if;
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists campaign_field_options_guard on public.campaign_field_options;
create trigger campaign_field_options_guard
  before insert or update or delete on public.campaign_field_options
  for each row execute function public.campaign_field_options_guard();

-- ---- any change to fields/options → new form_version ---------------------------------------
create or replace function public.campaign_form_changed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.bump_form_version(old.campaign_id);
  elsif tg_op = 'UPDATE' then
    if new is distinct from old then
      perform public.bump_form_version(new.campaign_id);
    end if;
  else
    perform public.bump_form_version(new.campaign_id);
  end if;
  return null;
end;
$$;

drop trigger if exists campaign_fields_form_changed on public.campaign_fields;
create trigger campaign_fields_form_changed
  after insert or update or delete on public.campaign_fields
  for each row execute function public.campaign_form_changed();

drop trigger if exists campaign_field_options_form_changed on public.campaign_field_options;
create trigger campaign_field_options_form_changed
  after insert or update or delete on public.campaign_field_options
  for each row execute function public.campaign_form_changed();

-- ---- measurements: validate field_values against the CURRENT definitions -----------------
-- Runs on every insert (the only write the TEMPORARY policy allows).
-- The row gets the campaign's current form_version (whatever the client sent) —
-- the definitions the values were checked against.
-- On failure: error message "invalid_values", details = JSON {field_key: reason}.
-- Reasons: unknown_field, required, type, min, max, decimals, too_long, option, duplicate.
-- Empty strings / empty arrays / JSON null are treated as "not filled" and removed.
create or replace function public.measurements_validate_values()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cur_version integer;
  errs  jsonb := '{}'::jsonb;
  vals  jsonb;
  f     record;
  v     jsonb;
  k     text;
  s     text;
  n     numeric;
  e     text;
  item  jsonb;
  seen  text[];
  max_len integer;
begin
  select form_version into cur_version from public.campaigns where id = new.observation_id;
  if not found then
    raise exception 'unknown campaign "%"', new.observation_id;
  end if;

  vals := coalesce(new.field_values, '{}'::jsonb);
  if jsonb_typeof(vals) <> 'object' then
    raise exception using message = 'invalid_values', detail = '{"_":"type"}', errcode = '22023';
  end if;
  vals := jsonb_strip_nulls(vals);

  -- Keys must be active (not archived) fields of this campaign.
  for k in select jsonb_object_keys(vals) loop
    if not exists (select 1 from public.campaign_fields
                   where campaign_id = new.observation_id and key = k and not archived) then
      errs := errs || jsonb_build_object(k, 'unknown_field');
    end if;
  end loop;

  for f in
    select * from public.campaign_fields
    where campaign_id = new.observation_id and not archived
  loop
    v := vals -> f.key;
    e := null;

    -- Empty text / empty list = not filled.
    if v is not null
       and ((jsonb_typeof(v) = 'string' and length(trim(v #>> '{}')) = 0)
            or (jsonb_typeof(v) = 'array' and jsonb_array_length(v) = 0)) then
      vals := vals - f.key;
      v := null;
    end if;

    if v is null then
      if f.required then
        errs := errs || jsonb_build_object(f.key, 'required');
      end if;
      continue;
    end if;

    case f.type
      when 'number' then
        if jsonb_typeof(v) <> 'number' then
          e := 'type';
        else
          n := (v #>> '{}')::numeric;
          if f.min_value is not null and n < f.min_value then e := 'min';
          elsif f.max_value is not null and n > f.max_value then e := 'max';
          elsif n <> round(n, f.decimals) then e := 'decimals';
          end if;
        end if;

      when 'text' then
        max_len := case when f.text_long then 2000 else 200 end;
        if jsonb_typeof(v) <> 'string' then
          e := 'type';
        elsif length(v #>> '{}') > max_len then
          e := 'too_long';
        end if;

      when 'boolean' then
        if jsonb_typeof(v) <> 'boolean' then e := 'type'; end if;

      when 'choice' then
        if jsonb_typeof(v) <> 'string' then
          e := 'type';
        elsif not exists (select 1 from public.campaign_field_options o
                          where o.campaign_id = f.campaign_id and o.field_key = f.key
                            and o.key = v #>> '{}' and not o.archived) then
          e := 'option';
        end if;

      when 'multi_choice' then
        if jsonb_typeof(v) <> 'array' then
          e := 'type';
        else
          seen := '{}';
          for item in select * from jsonb_array_elements(v) loop
            if jsonb_typeof(item) <> 'string' then e := 'type'; exit; end if;
            s := item #>> '{}';
            if s = any (seen) then e := 'duplicate'; exit; end if;
            seen := seen || s;
            if not exists (select 1 from public.campaign_field_options o
                           where o.campaign_id = f.campaign_id and o.field_key = f.key
                             and o.key = s and not o.archived) then
              e := 'option'; exit;
            end if;
          end loop;
        end if;

      when 'datetime' then
        if jsonb_typeof(v) <> 'string' then
          e := 'type';
        else
          s := v #>> '{}';
          -- ISO only (rejects words like 'now' that Postgres would also accept).
          if s !~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}' then
            e := 'type';
          else
            begin
              perform s::timestamptz;
            exception when others then
              e := 'type';
            end;
          end if;
        end if;

      when 'photo' then
        -- Photos are not stored yet (no Storage until login): the value only records
        -- that a photo was attached. Later this becomes a Storage path.
        if v <> 'true'::jsonb then e := 'type'; end if;

      else
        e := 'type';
    end case;

    if e is not null then
      errs := errs || jsonb_build_object(f.key, e);
    end if;
  end loop;

  if errs <> '{}'::jsonb then
    raise exception using
      message = 'invalid_values',
      detail  = errs::text,
      hint    = 'field_values do not match the campaign''s current field definitions',
      errcode = '22023';
  end if;

  new.field_values := vals;
  new.form_version := cur_version;
  return new;
end;
$$;

drop trigger if exists measurements_validate_values on public.measurements;
create trigger measurements_validate_values
  before insert on public.measurements
  for each row execute function public.measurements_validate_values();

-- Let the API see the new tables/columns right away.
notify pgrst, 'reload schema';
