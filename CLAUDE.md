# CLAUDE.md — מִצְפֶּה (Field)

## О проекте

Школьная сеть гражданской науки. Ученики делают измерения по единому протоколу (температура, влажность, яркость неба, PM2.5) и отмечают их на общей карте. Mobile-first. Язык по умолчанию — иврит (RTL).

## Текущий статус

* Бэкенд — Supabase, таблицы `campaigns`, `campaign_fields`, `campaign_field_options`, `measurements`.
  * Кампании: `AppDataContext` читает их из базы (только чтение) вместе с полями формы и переводит строки в прежний формат Observation (`titleHe/En/Ru`, `center: [lat, lng]` и т. д.) + `fields`, `primaryField`, `formVersion`, `scale`. Искать кампанию — через `getObservation(idOrSlug)` из `useAppData()`, не из mockData. Состояния: `campaignsLoading`, `campaignsError`, `reloadCampaigns`; `refreshCampaigns()` — перечитать без состояния загрузки (открытые формы не теряют ввод).
  * `campaigns.metric` теперь необязателен: это только ключ пресета цветов в `metrics.js` (цвета, диапазон шкалы, «правдоподобный» диапазон, шаг гистограммы) и фильтр тем на главной. Единица, знаки и подпись значения берутся из основного поля. Неизвестный/пустой `metric` → цвета по умолчанию, кампания не пропускается.
  * Измерения: `AppDataContext` читает их из базы и сохраняет новые; состояния: `measurementsLoading`, `measurementsError`, `reloadMeasurements`. Значения — `m.values` (`field_values` в базе, ключи = ключи полей), `m.formVersion`. `m.value` — вычисляемое значение основного поля (null, если нет) для карты, графиков, статистики.
  * Форма измерения строится из полей кампании («движок форм», шаг 3) — см. раздел «Поля кампаний (движок форм)».
  * Страницы, где есть кампании (главная, кампания, добавление, протокол, профиль), показывают loading/error, пока кампании не загрузились.
* Всё остальное пока захардкожено в `src/data/mockData.js`: пользователи, форум (темы/посты/реакции), бейджи, «присоединиться к кампании».
* `OBSERVATIONS` в mockData остался **только** для генерации оставшихся моков; UI его не импортирует. Кампании менять в базе, не там.
* Ещё на моках (читают `MEASUREMENTS` из mockData, а не из базы): лента активности и счётчик школ на главной, `participantsCount`, график вклада в профиле. Счётчик активных кампаний на главной считается из базы.
* Только в памяти, теряется при перезагрузке: комментарии к точкам, пометки «проблема» (flag), фото, загруженные учениками (`m.photos[ключ поля]`; в базе у поля-фото хранится только `true` — «фото приложено»; Storage — после логина), новые темы/посты форума.
* Авторизации нет: текущий пользователь зашит как `CURRENT_USER_ID = 'u-noa'`.
* Доступ — **временные** RLS-политики, заменить на шаге 4 (логин и роли):
  * `measurements`: все читают и добавляют, изменять/удалять нельзя. Каждое добавление проверяется триггером по текущим определениям полей (не только в UI).
  * `campaigns`, `campaign_fields`, `campaign_field_options`: все только читают; добавлять/изменять — только из SQL Editor.
* Внешний ключ `measurements.observation_id → campaigns.id` (`on delete restrict`): нельзя добавить измерение к несуществующей кампании и удалить кампанию, у которой есть измерения.
* `src/hooks/useMockLoad.js` (имитация загрузки, setTimeout ~550 мс) сейчас нигде не используется — оставлен для будущих мок-экранов.
* Деплой: GitHub → Vercel. (В репо также лежит `netlify.toml` — остаток, не используется.)

## Стек

* Vite 5 + React 18, JavaScript (JSX), без TypeScript
* Бэкенд: Supabase (@supabase/supabase-js) — таблицы `campaigns`, `campaign_fields`, `campaign_field_options`, `measurements`
* react-router-dom 6 (HashRouter)
* Tailwind CSS 3
* Карта: leaflet + react-leaflet + react-leaflet-cluster, тайлы OpenStreetMap
* Графики: recharts
* Иконки: lucide-react
* Линтеров и тестов нет

## Команды

* `npm install` — зависимости (Node 18+)
* `npm run dev` — dev-сервер, http://localhost:5173
* `npm run build` — сборка в `dist/`
* `npm run preview` — просмотр сборки

## Переменные окружения

* `VITE_SUPABASE_URL` — URL проекта Supabase
* `VITE_SUPABASE_ANON_KEY` — publishable (anon) ключ Supabase
* В Vercel заданы для всех окружений. Локально — файл `.env.local` в корне (в `.gitignore`, не коммитить). После изменения перезапустить `npm run dev`.
* Если переменных нет, `supabase` = `null` и измерения показывают состояние ошибки.
* Имена не менять. Серверные ключи (service_role/secret) во фронтенд не класть.

## Структура

```
src/
├── main.jsx          — вход: HashRouter → I18nProvider → ThemeProvider → AppDataProvider
├── App.jsx           — каркас (Header/Footer) и маршруты
├── index.css         — глобальные стили, слои Tailwind, RTL-правки
├── leaflet-setup.js  — пути к иконкам маркеров Leaflet под Vite
├── i18n/             — strings.js (строки he/en/ru, LOCALES), index.jsx (I18nProvider, t(), useI18n/useT)
├── data/             — mockData.js (моки: пользователи, форум, бейджи; копия кампаний для генерации моков),
│                       metrics.js (4 пресета цветовых шкал; campaigns.metric → пресет)
├── context/          — AppDataContext.jsx (кампании с полями и измерения из Supabase + остальное в памяти), ThemeContext.jsx (тема)
├── hooks/            — useMockLoad.js (имитация loading/error/retry, сейчас не используется)
├── lib/              — supabase.js (клиент), fields.js (движок форм: поля, валидация, формат, шкала),
│                       format.js, stats.js, export.js (CSV/JSON/GeoJSON), media.js (SVG-заглушки)
├── pages/            — Home, Observation (вкладки Карта·Данные·Графики·Обсуждение),
│                       AddMeasurement, Profile, Protocol, NotFound
└── components/
    ├── Header, Footer, primitives (skeleton, empty/error, Avatar), Tabs, FilterBar,
    │   ObservationCard, ObsIcon, Counter, ActivityFeed, ContributionGraph, MiniMap, Markdown
    ├── map/          — ObservationMap (Leaflet + кластеры), Legend, PointPanel, TimeSlider
    ├── data/         — DataTable (+ экспорт), StatsSummary
    ├── charts/       — ObservationCharts (Recharts)
    ├── discussion/   — форум: реакции, цитаты, «спросить эксперта»
    └── wizard/       — AddMeasurementWizard (место → значения из полей → фото/проверка), FieldInput (поле любого типа), LocationPicker
```

```
supabase/
├── migrations/       — SQL-схема: 001_measurements.sql (таблица, индекс, временные RLS-политики),
│                       002_campaigns.sql (таблица кампаний, временная RLS — только чтение),
│                       003_measurements_campaign_fk.sql (FK измерения → кампании; запускать после seed 002),
│                       004_form_engine.sql (поля кампаний, field_values, триггеры правил и проверки),
│                       005_drop_legacy_measurement_columns.sql (удаляет value/instrument/conditions/notes)
└── seed/             — демо-данные: 001_measurements_seed.sql (38 мок-измерений),
                        002_campaigns_seed.sql (12 кампаний, те же id),
                        003_water_quality_example.sql (пример лабораторной на движке форм); повторный запуск безопасен
```

SQL запускается вручную в Supabase SQL Editor, по номерам: 001 migration → 001 seed → 002 migration → 002 seed → 003 migration → 004 migration → (003 seed) → 005 migration. Seed 001 пишет в колонку `value` и работает только до 005. Seed-файлы только вставляют данные, схему не меняют. Supabase CLI не используется. Новые изменения схемы — новым файлом `00N_*.sql`, старые миграции не редактировать.

Порядок выкладки миграций, несовместимых со старым кодом (как 004/005): миграция → проверка на preview (Vercel) → merge → дождаться деплоя production → миграция, ломающая старый код (005). Между 004 и деплоем нового кода production **не может добавлять измерения**.

Конфиги в корне: vite.config.js (base './', порт 5173), tailwind.config.js (палитра «forest», шрифты, тёмная тема).

## Где что менять

* Данные и форматы записей → `src/data/mockData.js` (форматы описаны в комментарии в начале файла)
* Схема кампаний → новая миграция + `CAMPAIGN_COLUMNS`/`campaignFromRow()` в `AppDataContext.jsx` (языки — отдельные колонки `title_he/en/ru`, `desc_he/en/ru`; `center_lat/center_lng` ↔ `center`; `metric` — ключ из `metrics.js`)
* Схема измерений в базе → новая миграция в `supabase/migrations/` + `MEASUREMENT_COLUMNS`/`fromRow()` в `AppDataContext.jsx` (колонки snake_case, в UI camelCase; `measured_at` ↔ `timestamp`, `field_values` ↔ `values`)
* Поля формы кампании → строки в `campaign_fields` / `campaign_field_options` (SQL Editor; позже — админка). Код менять не нужно.
* Новый тип поля → CHECK в новой миграции + ветка в `measurements_validate_values()` (SQL) + `inputToValue`/`validateValue`/`formatFieldValue`/`exportFieldValue` в `src/lib/fields.js` + `FieldInput.jsx`. Проверки в SQL и в `fields.js` должны совпадать (те же коды ошибок).
* Новый пресет цветов → `src/data/metrics.js` (кампании ссылаются на него по ключу в `campaigns.metric`, необязательно)
* Логика чтения/добавления/изменения данных → `src/context/AppDataContext.jsx`
* Новая страница → `src/pages/` + маршрут в `App.jsx`
* Компоненты одной фичи → своя папка в `src/components/` (как map/, wizard/)
* Общие UI-элементы → `components/primitives.jsx`, не дублировать
* Утилиты без UI → `src/lib/`

## Поля кампаний (движок форм)

* Место (`lat`, `lng`, `place_label`), дата/время (`measured_at`), автор, статус — встроенные колонки `measurements`, не поля.
* Всё остальное — поля: `campaign_fields` (PK `campaign_id, key`) и варианты `campaign_field_options` (PK `campaign_id, field_key, key`). Подписи и подсказки — `label_he/en/ru`, `help_he/en/ru`.
* Типы: `number` (`unit`, `min_value`, `max_value`, `decimals` — обязательно), `choice`, `multi_choice` (варианты), `text` (`text_long`: короткий ≤200 / длинный ≤2000), `boolean`, `datetime` (ISO-строка), `photo` (пока `true`).
* Основное поле (`is_primary`): одно числовое неархивное поле на кампанию — цвета карты, легенда, графики, статистика. Нет основного поля → кампания работает, но без цветов и графиков.
* Значения измерения — `measurements.field_values` (jsonb `{ключ поля: значение}`), выбор хранится ключом варианта, мультивыбор — массивом ключей. Пустые значения не хранятся.
* Правила изменений (проверяются триггерами в базе, не обходить):
  * Ключи полей и вариантов никогда не меняются. Тип и единица поля тоже — нужно другое → новое поле.
  * Подписи, подсказки, порядок, обязательность, min/max/decimals, основное поле — можно менять.
  * Поле/вариант не удаляют, а архивируют (`archived = true`): в форме не показывается, старые данные видны в панели точки, таблице и экспорте (с пометкой). Удаление разрешено, только пока у кампании нет ни одного измерения.
  * Варианты можно добавлять и архивировать, удалять нельзя.
  * Любое изменение полей/вариантов увеличивает `campaigns.form_version` (один раз за транзакцию); уменьшить нельзя. Новая кампания, созданная вместе с полями в одной транзакции, начинает с версии 1.
  * Ключи: `^[a-z][a-z0-9_]{0,39}$`, не оканчиваются на `_unit`, не совпадают со встроенными колонками экспорта (`id`, `date`, `lat`, `place`, …).
* Проверка при добавлении (триггер `measurements_validate_values`): значения сверяются с **текущими** определениями (неизвестные/архивные ключи, обязательность, тип, min/max, знаки, длина, варианты). Если всё верно — измерение сохраняется с текущим `form_version` (даже если форма была открыта на старой версии). Если нет — ошибка `invalid_values`, в `details` JSON `{ключ: код}`. Мастер тогда перечитывает кампанию (`refreshCampaigns`), сохраняет ввод ученика и подсвечивает поля.
* Экспорт: колонки полей называются ключами полей, у чисел есть `<ключ>_unit`, выбор — ключи вариантов, мультивыбор через `;`.

## Правила i18n

* Любая новая UI-строка добавляется во все три языка (he, en, ru) в `strings.js`.
* Фоллбэк: текущий язык → иврит → сам ключ (+ предупреждение в dev).
* Названия кампаний, тем и метрик — в данных, поля `titleHe/En/Ru`, `labelHe/En/Ru`. Выводить через `observationTitle()`, `topicTitle()`, `metricLabel()`.

## Правила RTL

* Только логические классы Tailwind: `start-*`, `end-*`, `ms-*`, `me-*`, `ps-*`, `pe-*`. Не использовать `left-*`/`right-*`/`ml-*`/`mr-*`.
* Числа, координаты, единицы — оборачивать в `dir="ltr"`.
* Направление брать из контекста i18n (`dir`, `isRTL`), не хардкодить.

## localStorage

Используется только для `mitzpe.locale` и `mitzpe.theme`. Данные туда не класть.

## Как работать с задачами

* Для изменений больше одного файла — сначала план, код после подтверждения.
* Трогать только файлы, относящиеся к задаче. Не рефакторить попутно.
* Не добавлять TypeScript, новые UI-библиотеки или менять стек без согласования.
* Сохранять дизайн: градиент «небо → песок», frosted glass панели, squircle-иконки. Цвета брать из существующей темы в `tailwind.config.js` (палитра называется «forest»), новые цвета не хардкодить.
* Пользователи — школьники (несовершеннолетние): не добавлять сбор лишних личных данных.

## Направление развития (черновик, уточнить)

1. ~~Подключить бэкенд (Supabase) и перенести туда измерения.~~ Сделано.
2. ~~Перенести кампании/лабораторные из кода в базу.~~ Сделано (таблица `campaigns`; форум, участники, пользователи — ещё в моках).
3. ~~Строить форму измерения динамически из описания лабораторной.~~ Сделано (таблицы `campaign_fields` / `campaign_field_options`, `measurements.field_values`).
4. Логин и роли: student / admin.
5. Админка для создания лабораторных без изменения кода (правила изменения полей уже в базе — см. «Поля кампаний»).
