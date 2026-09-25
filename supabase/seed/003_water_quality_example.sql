-- 003_water_quality_example.sql
-- Example lab for testing the form engine (roadmap step 3): stream water quality.
-- Fields: water temperature (primary number), pH (number), clarity (choice),
-- pollution signs (multi choice), smell (boolean), notes (long text), photo.
-- Run in the Supabase SQL Editor AFTER migrations/004_form_engine.sql.
-- Safe to re-run: existing rows are skipped. Starts at form_version 1.
--
-- metric is null: there is no colour preset for this lab, so the map uses the default
-- palette over the primary field's min–max (0–40 °C).

insert into public.campaigns
  (id, slug, metric, icon, title_he, title_en, title_ru, desc_he, desc_en, desc_ru,
   status, region, difficulty, equipment, protocol_url, center_lat, center_lng, zoom, sort_order)
values
  ('obs-stream-water', 'stream-water', null, 'Droplets',
   'איכות מים בנחל', 'Stream water quality', 'Качество воды в ручье',
   'טמפרטורה, חומציות וצלילות של מי הנחלים ליד בית הספר.',
   'Temperature, pH and clarity of streams near the school.',
   'Температура, кислотность и прозрачность воды в ручьях у школы.',
   'collecting', 'center', 'medium',
   array['מדחום מים', 'ערכת pH', 'צנצנת שקופה']::text[],
   '#/protocol/stream-water', 32.10, 34.85, 9, 13)
on conflict (id) do nothing;

insert into public.campaign_fields
  (campaign_id, key, type, label_he, label_en, label_ru, help_he, help_en, help_ru,
   required, sort_order, is_primary, unit, min_value, max_value, decimals, text_long)
values
  ('obs-stream-water', 'water_temp', 'number',
   'טמפרטורת מים', 'Water temperature', 'Температура воды',
   'מדדו 10 ס״מ מתחת לפני המים, אחרי דקה של התייצבות.',
   'Measure 10 cm below the surface after one minute to settle.',
   'Измеряйте на глубине 10 см, подождав минуту.',
   true, 1, true, '°C', 0, 40, 1, false),
  ('obs-stream-water', 'ph', 'number',
   'חומציות (pH)', 'pH', 'Кислотность (pH)',
   'השוו את צבע הרצועה לסקלה שעל האריזה.',
   'Compare the strip colour with the scale on the box.',
   'Сравните цвет полоски со шкалой на упаковке.',
   true, 2, false, null, 0, 14, 1, false),
  ('obs-stream-water', 'clarity', 'choice',
   'צלילות', 'Clarity', 'Прозрачность',
   'מלאו צנצנת שקופה והסתכלו עליה מול דף לבן.',
   'Fill a clear jar and look at it against white paper.',
   'Наберите воду в прозрачную банку и посмотрите на фоне белого листа.',
   true, 3, false, null, null, null, null, false),
  ('obs-stream-water', 'pollution', 'multi_choice',
   'סימני זיהום', 'Signs of pollution', 'Признаки загрязнения',
   'סמנו את כל מה שרואים. אם אין — השאירו ריק.',
   'Tick everything you see. None? Leave it empty.',
   'Отметьте всё, что видите. Ничего нет — оставьте пустым.',
   false, 4, false, null, null, null, null, false),
  ('obs-stream-water', 'smell', 'boolean',
   'יש ריח חריג?', 'Unusual smell?', 'Есть необычный запах?',
   '', '', '',
   true, 5, false, null, null, null, null, false),
  ('obs-stream-water', 'notes', 'text',
   'הערות', 'Notes', 'Заметки',
   'זרימה, צמחייה, בעלי חיים — כל מה שחשוב.',
   'Flow, plants, animals — anything that matters.',
   'Течение, растения, животные — всё важное.',
   false, 6, false, null, null, null, null, true),
  ('obs-stream-water', 'photo', 'photo',
   'תמונת המים', 'Water photo', 'Фото воды',
   'צלמו את הצנצנת מול דף לבן.',
   'Photograph the jar against white paper.',
   'Сфотографируйте банку на фоне белого листа.',
   false, 7, false, null, null, null, null, false)
on conflict do nothing;

insert into public.campaign_field_options
  (campaign_id, field_key, key, label_he, label_en, label_ru, sort_order)
values
  ('obs-stream-water', 'clarity',   'clear',    'צלול',       'Clear',           'Прозрачная',       1),
  ('obs-stream-water', 'clarity',   'cloudy',   'עכור מעט',   'Slightly cloudy', 'Слегка мутная',    2),
  ('obs-stream-water', 'clarity',   'murky',    'עכור מאוד',  'Murky',           'Мутная',           3),
  ('obs-stream-water', 'pollution', 'foam',     'קצף',        'Foam',            'Пена',             1),
  ('obs-stream-water', 'pollution', 'oil',      'כתמי שמן',   'Oil sheen',       'Масляная плёнка',  2),
  ('obs-stream-water', 'pollution', 'litter',   'פסולת',      'Litter',          'Мусор',            3),
  ('obs-stream-water', 'pollution', 'algae',    'אצות',       'Algae bloom',     'Цветение водорослей', 4)
on conflict do nothing;

-- ---------------------------------------------------------------------------------------
-- Try the rules (run one at a time in the SQL Editor; each should fail or behave as noted):
--
-- Key never changes → ERROR "field key ... cannot change":
--   update public.campaign_fields set key = 'temp' where campaign_id = 'obs-stream-water' and key = 'water_temp';
--
-- Type / unit never change → ERROR:
--   update public.campaign_fields set type = 'text' where campaign_id = 'obs-stream-water' and key = 'ph';
--   update public.campaign_fields set unit = '°F' where campaign_id = 'obs-stream-water' and key = 'water_temp';
--
-- Labels / required / order change freely → OK, form_version goes up by 1:
--   update public.campaign_fields set label_en = 'Water temp', required = false
--   where campaign_id = 'obs-stream-water' and key = 'water_temp';
--   select form_version from public.campaigns where id = 'obs-stream-water';
--
-- "Delete" a field = archive it → hidden in the form, old data still shown and exported:
--   update public.campaign_fields set archived = true where campaign_id = 'obs-stream-water' and key = 'smell';
--
-- Add an option / archive an option → OK. Deleting an option once the lab has data → ERROR:
--   insert into public.campaign_field_options (campaign_id, field_key, key, label_he, label_en, label_ru, sort_order)
--   values ('obs-stream-water', 'clarity', 'green', 'ירקרק', 'Greenish', 'Зеленоватая', 4);
--   delete from public.campaign_field_options where campaign_id = 'obs-stream-water' and field_key = 'clarity' and key = 'green';
--
-- Direct API inserts are validated too (as the anon role, like the browser):
--   set local role anon;   -- run together with the insert below, in one query
--   insert into public.measurements (observation_id, user_id, lat, lng, measured_at, field_values)
--   values ('obs-stream-water', 'u-noa', 32.1, 34.85, now(),
--           '{"water_temp": 21.5, "ph": 15, "clarity": "green", "smell": false}');
--   → ERROR invalid_values, DETAIL {"ph": "max", "clarity": "option"}
