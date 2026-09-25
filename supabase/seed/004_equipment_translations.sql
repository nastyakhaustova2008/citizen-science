-- 004_equipment_translations.sql
-- English and Russian equipment lists for the demo labs (002 / 003 seeds), translated item by
-- item from the Hebrew list. Run in the Supabase SQL Editor AFTER migrations/010_lab_editor.sql.
-- Safe to re-run: only labs whose en / ru list is still empty are touched. Labs without a
-- translation keep showing the Hebrew list in en / ru (fallback), and admins can fill it in the editor.

with dict (he, en, ru) as (values
  ('תרמומטר דיגיטלי',        'Digital thermometer',           'Цифровой термометр'),
  ('טלפון עם GPS',           'Phone with GPS',                'Телефон с GPS'),
  ('מדחום אינפרא-אדום',      'Infrared thermometer',          'Инфракрасный термометр'),
  ('מד לחות (היגרומטר)',     'Humidity meter (hygrometer)',   'Измеритель влажности (гигрометр)'),
  ('חיישן SQM',              'SQM sensor',                    'Датчик SQM'),
  ('שעון',                   'Watch',                         'Часы'),
  ('מד חלקיקים ניד (PM2.5)', 'Portable particle meter (PM2.5)', 'Портативный счётчик частиц (PM2.5)'),
  ('מדחום מים',              'Water thermometer',             'Термометр для воды'),
  ('ערכת pH',                'pH test kit',                   'Набор для измерения pH'),
  ('צנצנת שקופה',            'Clear jar',                     'Прозрачная банка')
),
translated as (
  select c.id,
         array(select coalesce(d.en, x) from unnest(c.equipment_he) with ordinality u(x, n)
               left join dict d on d.he = u.x order by u.n) as en,
         array(select coalesce(d.ru, x) from unnest(c.equipment_he) with ordinality u(x, n)
               left join dict d on d.he = u.x order by u.n) as ru
  from public.campaigns c
  where c.equipment_he <> '{}'
    -- only when every item has a translation (otherwise leave it to the editor)
    and not exists (select 1 from unnest(c.equipment_he) x where x not in (select he from dict))
)
update public.campaigns c
set equipment_en = case when c.equipment_en = '{}' then t.en else c.equipment_en end,
    equipment_ru = case when c.equipment_ru = '{}' then t.ru else c.equipment_ru end,
    edit_no = c.edit_no + 1  -- an editor open on this lab reloads instead of overwriting
from translated t
where t.id = c.id and (c.equipment_en = '{}' or c.equipment_ru = '{}');
