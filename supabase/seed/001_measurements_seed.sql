-- 001_measurements_seed.sql
-- Demo data: the 38 mock measurements from src/data/mockData.js, so the map isn't empty.
-- Run in the Supabase SQL Editor AFTER migrations/001_measurements.sql.
-- Safe to re-run: existing ids are skipped.
-- Generated from mockData.js with TZ=Asia/Jerusalem (timestamps match what the demo showed).

insert into public.measurements
  (id, observation_id, user_id, place_label, lat, lng, value, measured_at,
   instrument, conditions, notes, verification, photo_seed)
values
  ('m-025', 'obs-dark-skies', 'u-noa', 'טיילת', 32.19618, 34.8878, 19.95, '2026-09-06T17:17:00.000Z', 'Unihedron SQM-LU', 'עננות גבוהה דקה', '', 'verified', null),
  ('m-033', 'obs-roadside-air', 'u-noa', 'גינה קהילתית', 32.06251, 34.80497, 48, '2026-09-05T11:12:00.000Z', 'SDS011 + לוח ESP32', 'בהיר, רוח קלה', 'רוח החליפה כיוון באמצע המדידה', 'pending', 'roadside-air-33'),
  ('m-034', 'obs-roadside-air', 'u-yonatan', 'גג בית הספר', 31.90332, 34.80268, 67, '2026-09-04T08:17:00.000Z', 'Atmotube Pro', 'מעונן חלקית', '', 'pending', 'roadside-air-34'),
  ('m-026', 'obs-negev-sky', 'u-tal', 'פארק שכונתי', 30.6437, 34.74324, 20.74, '2026-08-29T20:07:00.000Z', 'Unihedron SQM-LU', 'שמיים בהירים ללא ירח', 'החיישן התייצב אחרי 3 דקות', 'pending', null),
  ('m-004', 'obs-schoolyard-heat', 'u-noa', 'גג בית הספר', 32.19631, 34.89498, 34.9, '2026-08-29T11:35:00.000Z', 'חיישן DHT22 + Arduino', 'לאחר גשם', 'מקור אור רחוב במרחק ~40 מ׳', 'verified', 'schoolyard-heat-4'),
  ('m-019', 'obs-humidity-from-air', 'u-noa', 'גג בית הספר', 32.10057, 34.76436, 18.8, '2026-08-29T09:15:00.000Z', 'חיישן SHT31', 'שמש מלאה', 'הדשא הושקה בבוקר', 'verified', 'humidity-from-air-19'),
  ('m-002', 'obs-schoolyard-heat', 'u-yonatan', 'פינת ישיבה מוצללת', 31.90238, 34.83629, 39.5, '2026-08-28T14:15:00.000Z', 'חיישן DHT22 + Arduino', 'מעונן חלקית', '', 'verified', null),
  ('m-022', 'obs-dark-skies', 'u-noa', 'גג בית הספר', 32.16337, 34.86933, 18.82, '2026-08-27T18:32:00.000Z', 'Unihedron SQM-L', 'לילה צלול, קר', 'הדשא הושקה בבוקר', 'flagged', 'dark-skies-22'),
  ('m-027', 'obs-negev-sky', 'u-tal', 'טיילת', 31.27672, 34.77682, 19.41, '2026-08-25T20:52:00.000Z', 'Unihedron SQM-LU', 'שמיים בהירים ללא ירח', 'רוח החליפה כיוון באמצע המדידה', 'pending', 'negev-sky-27'),
  ('m-032', 'obs-roadside-air', 'u-yonatan', 'פינת ישיבה מוצללת', 31.89082, 34.82732, 55, '2026-08-25T14:21:00.000Z', 'Atmotube Pro', 'בהיר, רוח קלה', 'רוח החליפה כיוון באמצע המדידה', 'verified', 'roadside-air-32'),
  ('m-031', 'obs-roadside-air', 'u-noa', 'שער ראשי', 32.1002, 34.76804, 55, '2026-08-25T12:15:00.000Z', 'Atmotube Pro', 'שרבי, אובך קל', '', 'verified', 'roadside-air-31'),
  ('m-001', 'obs-schoolyard-heat', 'u-noa', 'שער ראשי', 32.1683, 34.8897, 34.8, '2026-08-22T12:11:00.000Z', 'תרמומטר דיגיטלי TFA 30.1', 'בהיר, רוח קלה', '', 'verified', null),
  ('m-003', 'obs-schoolyard-heat', 'u-noa', 'גינה קהילתית', 32.05769, 34.7793, 33.6, '2026-08-19T05:57:00.000Z', 'תרמומטר דיגיטלי TFA 30.1', 'שרבי, אובך קל', 'הדשא הושקה בבוקר', 'verified', 'schoolyard-heat-3'),
  ('m-035', 'obs-desert-dust', 'u-tal', 'גינה קהילתית', 31.50965, 34.60982, 66, '2026-08-16T13:05:00.000Z', 'PMS7003 נייד', 'מעונן חלקית', 'נמדד ליד קיר בטון פונה דרום', 'verified', 'desert-dust-35'),
  ('m-036', 'obs-desert-dust', 'u-tal', 'גג בית הספר', 31.26871, 34.76988, 48, '2026-08-16T06:17:00.000Z', 'SDS011 + לוח ESP32', 'מעונן חלקית', 'תנועת כלי רכב כבדה בזמן המדידה', 'pending', null),
  ('m-024', 'obs-dark-skies', 'u-yonatan', 'פארק שכונתי', 31.84972, 34.77418, 18.3, '2026-08-15T18:14:00.000Z', 'Unihedron SQM-LU', 'אובך קל', 'מקור אור רחוב במרחק ~40 מ׳', 'flagged', null),
  ('m-006', 'obs-urban-heat-island', 'u-noa', 'תחנת אוטובוס', 32.07887, 34.75613, 34, '2026-08-14T09:51:00.000Z', 'מדחום אינפרא-אדום UNI-T UT303', 'שמש מלאה', 'נמדד ליד קיר בטון פונה דרום', 'verified', null),
  ('m-028', 'obs-negev-sky', 'u-tal', 'חצר אחורית', 30.63993, 34.75536, 20.42, '2026-08-12T17:55:00.000Z', 'Unihedron SQM-LU', 'אובך קל', 'הדשא הושקה בבוקר', 'pending', 'negev-sky-28'),
  ('m-007', 'obs-urban-heat-island', 'u-noa', 'שדרת עצים', 32.17782, 34.92021, 34.9, '2026-08-12T12:55:00.000Z', 'תרמומטר דיגיטלי TFA 30.1', 'בהיר, רוח קלה', 'הדשא הושקה בבוקר', 'verified', null),
  ('m-011', 'obs-asphalt-vs-grass', 'u-yonatan', 'מגרש חנייה', 31.90857, 34.80676, 35.7, '2026-08-12T04:39:00.000Z', 'חיישן DHT22 + Arduino', 'בהיר, רוח קלה', '', 'verified', null),
  ('m-023', 'obs-dark-skies', 'u-noa', 'כיכר מרכזית', 32.12345, 34.79074, 17.78, '2026-08-11T20:24:00.000Z', 'Unihedron SQM-L', 'לילה צלול, קר', '', 'flagged', 'dark-skies-23'),
  ('m-008', 'obs-urban-heat-island', 'u-noa', 'שולי כביש ראשי', 32.08074, 34.78518, 35.9, '2026-08-11T14:24:00.000Z', 'תרמומטר דיגיטלי TFA 30.1', 'שרבי, אובך קל', 'הדשא הושקה בבוקר', 'pending', 'urban-heat-island-8'),
  ('m-017', 'obs-humidity-from-air', 'u-noa', 'פינת ישיבה מוצללת', 32.06948, 34.75574, 18.1, '2026-08-11T13:58:00.000Z', 'תחנת מזג אוויר ביתית', 'לאחר גשם', '', 'pending', null),
  ('m-005', 'obs-schoolyard-heat', 'u-yonatan', 'כיכר מרכזית', 31.89342, 34.79496, 34.8, '2026-08-09T07:11:00.000Z', 'מדחום אינפרא-אדום UNI-T UT303', 'שרבי, אובך קל', 'מקור אור רחוב במרחק ~40 מ׳', 'verified', null),
  ('m-016', 'obs-humidity-from-air', 'u-omer', 'שער ראשי', 32.78054, 35.01466, 12, '2026-08-08T13:39:00.000Z', 'חיישן SHT31', 'שרבי, אובך קל', '', 'verified', 'humidity-from-air-16'),
  ('m-010', 'obs-asphalt-vs-grass', 'u-yonatan', 'שולי כביש ראשי', 31.88234, 34.7942, 35, '2026-08-06T09:34:00.000Z', 'מדחום אינפרא-אדום UNI-T UT303', 'שמש מלאה', '', 'verified', 'asphalt-vs-grass-10'),
  ('m-009', 'obs-urban-heat-island', 'u-noa', 'מגרש חנייה', 32.1903, 34.90467, 34.6, '2026-08-06T06:44:00.000Z', 'תרמומטר דיגיטלי TFA 30.1', 'שרבי, אובך קל', 'מקור אור רחוב במרחק ~40 מ׳', 'pending', 'urban-heat-island-9'),
  ('m-018', 'obs-humidity-from-air', 'u-omer', 'גינה קהילתית', 32.77896, 34.98612, 13.3, '2026-08-05T05:29:00.000Z', 'היגרומטר TFA 30.5', 'בהיר, רוח קלה', 'רוח החליפה כיוון באמצע המדידה', 'verified', 'humidity-from-air-18'),
  ('m-012', 'obs-asphalt-vs-grass', 'u-yonatan', 'מצפה כוכבים', 31.87636, 34.80979, 30.6, '2026-08-04T13:47:00.000Z', 'חיישן DHT22 + Arduino', 'בהיר, רוח קלה', '', 'verified', 'asphalt-vs-grass-12'),
  ('m-013', 'obs-morning-baseline', 'u-omer', 'טיילת', 32.78384, 34.98642, 24.3, '2026-05-08T13:55:00.000Z', 'תרמומטר דיגיטלי TFA 30.1', 'שמש מלאה', 'הדשא הושקה בבוקר', 'verified', null),
  ('m-038', 'obs-winter-air', 'u-maya', 'כיכר מרכזית', 31.78888, 35.15406, 54, '2026-04-23T12:03:00.000Z', 'SDS011 + לוח ESP32', 'שמש מלאה', 'החיישן התייצב אחרי 3 דקות', 'verified', 'winter-air-38'),
  ('m-030', 'obs-light-pollution-census', 'u-noa', 'שער ראשי', 32.08625, 34.74952, 18.03, '2026-04-22T17:46:00.000Z', 'Unihedron SQM-L', 'אובך קל', 'רוח החליפה כיוון באמצע המדידה', 'verified', null),
  ('m-014', 'obs-morning-baseline', 'u-maya', 'חצר אחורית', 31.78035, 35.14762, 25.9, '2026-04-13T05:26:00.000Z', 'חיישן DHT22 + Arduino', 'מעונן חלקית', 'רוח החליפה כיוון באמצע המדידה', 'verified', 'morning-baseline-14'),
  ('m-037', 'obs-winter-air', 'u-maya', 'גג בית הספר', 31.77714, 35.13215, 53, '2026-04-12T09:45:00.000Z', 'Atmotube Pro', 'בהיר, רוח קלה', 'החיישן התייצב אחרי 3 דקות', 'verified', null),
  ('m-020', 'obs-galilee-humidity', 'u-omer', 'גינה קהילתית', 32.81271, 34.98801, 17, '2026-04-05T09:15:00.000Z', 'היגרומטר TFA 30.5', 'מעונן חלקית', 'הדשא הושקה בבוקר', 'verified', null),
  ('m-015', 'obs-morning-baseline', 'u-omer', 'מגרש ספורט', 32.80441, 34.96508, 27.2, '2026-04-01T12:24:00.000Z', 'תרמומטר דיגיטלי TFA 30.1', 'שרבי, אובך קל', 'תנועת כלי רכב כבדה בזמן המדידה', 'verified', null),
  ('m-021', 'obs-galilee-humidity', 'u-omer', 'גג בית הספר', 32.7742, 34.99413, 13.6, '2026-02-24T08:01:00.000Z', 'חיישן SHT31', 'שמש מלאה', 'רוח החליפה כיוון באמצע המדידה', 'verified', 'galilee-humidity-21'),
  ('m-029', 'obs-light-pollution-census', 'u-noa', 'מצפה כוכבים', 32.16898, 34.85769, 19.54, '2026-02-11T18:21:00.000Z', 'Unihedron SQM-LU', 'שמיים בהירים ללא ירח', '', 'verified', null)
on conflict (id) do nothing;
