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
* Аккаунты (шаг 4a) — Supabase Auth + таблица `profiles`, см. раздел «Аккаунты». `AuthContext` (`useAuth()`): сессия, профиль, `currentUser`, вход/регистрация/Google/сброс пароля. `useAppData().currentUser` — тот же пользователь.
* Всё остальное пока захардкожено в `src/data/mockData.js`: демо-пользователи (авторы демо-измерений), форум (темы/посты/реакции), бейджи, «присоединиться к кампании».
* `OBSERVATIONS` в mockData остался **только** для генерации оставшихся моков; UI его не импортирует. Кампании менять в базе, не там.
* Ещё на моках (читают `MEASUREMENTS` из mockData, а не из базы): лента активности и счётчик школ на главной, `participantsCount`, график вклада в профиле. Счётчик активных кампаний на главной считается из базы.
* Только в памяти, теряется при перезагрузке: комментарии к точкам, пометки «проблема» (flag), фото, загруженные учениками (`m.photos[ключ поля]`; в базе у поля-фото хранится только `true` — «фото приложено»; Storage — позже), новые темы/посты форума. Писать их (и реакции) можно только после входа; без входа — `LoginPrompt`.
* Доступ (RLS):
  * `measurements`: все читают. Добавлять — только вошедший пользователь и только от своего имени (`user_id = auth.uid()`, у профиля есть имя), статус `pending`. Изменять/удалять нельзя. Каждое добавление проверяется триггером по текущим определениям полей. До запуска 007 ещё действует TEMPORARY-правило «все добавляют» (для старого кода production).
  * `profiles`: все читают `id, username, role, created_at`; писать напрямую никто не может (только триггер, RPC и SQL Editor).
  * `campaigns`, `campaign_fields`, `campaign_field_options`: все только читают; добавлять/изменять — только из SQL Editor (**временно**, до админки — шаги 4b/5).
* Внешний ключ `measurements.observation_id → campaigns.id` (`on delete restrict`): нельзя добавить измерение к несуществующей кампании и удалить кампанию, у которой есть измерения.
* `src/hooks/useMockLoad.js` (имитация загрузки, setTimeout ~550 мс) сейчас нигде не используется — оставлен для будущих мок-экранов.
* Деплой: GitHub → Vercel. (В репо также лежит `netlify.toml` — остаток, не используется.)

## Стек

* Vite 5 + React 18, JavaScript (JSX), без TypeScript
* Бэкенд: Supabase (@supabase/supabase-js) — таблицы `campaigns`, `campaign_fields`, `campaign_field_options`, `measurements`, `profiles`; Supabase Auth (PKCE); Edge Function `account` (Deno, обычный JS)
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
* Edge Function `account` берёт ключи из стандартных секретов Supabase (`SUPABASE_URL`, `SUPABASE_SECRET_KEYS`); свои секреты (лимиты, `CLIENT_IP_HEADER`) — в Dashboard → Edge Functions → Secrets, см. `supabase/SETUP_AUTH.md`.
* Имена не менять. Серверные ключи (service_role/secret) во фронтенд не класть.

## Структура

```
src/
├── main.jsx          — вход: HashRouter → I18nProvider → ThemeProvider → AuthProvider → AppDataProvider
├── App.jsx           — каркас (Header/Footer) и маршруты
├── index.css         — глобальные стили, слои Tailwind, RTL-правки
├── leaflet-setup.js  — пути к иконкам маркеров Leaflet под Vite
├── i18n/             — strings.js (строки he/en/ru, LOCALES), index.jsx (I18nProvider, t(), useI18n/useT)
├── data/             — mockData.js (моки: пользователи, форум, бейджи; копия кампаний для генерации моков),
│                       metrics.js (4 пресета цветовых шкал; campaigns.metric → пресет)
├── context/          — AuthContext.jsx (сессия, профиль, вход/регистрация/Google/сброс), AppDataContext.jsx (кампании с полями
│                       и измерения из Supabase, авторы `getAuthor()` + остальное в памяти), ThemeContext.jsx (тема)
├── hooks/            — useMockLoad.js (имитация loading/error/retry, сейчас не используется)
├── lib/              — supabase.js (клиент), username.js (правила имён и паролей), fields.js (движок форм: поля, валидация, формат, шкала),
│                       format.js, stats.js, export.js (CSV/JSON/GeoJSON), media.js (SVG-заглушки)
├── pages/            — Home, Observation (вкладки Карта·Данные·Графики·Обсуждение),
│                       AddMeasurement (только после входа), Profile (+ «Аккаунт» у своего), Protocol, NotFound,
│                       auth/ — Login, SignUp, ForgotPassword, Confirm (ссылки из писем), ChooseUsername
└── components/
    ├── Header, Footer, primitives (skeleton, empty/error, Avatar, AuthorName, LoginPrompt), Tabs, FilterBar,
    │   ObservationCard, ObsIcon, Counter, ActivityFeed, ContributionGraph, MiniMap, Markdown
    ├── map/          — ObservationMap (Leaflet + кластеры), Legend, PointPanel, TimeSlider
    ├── data/         — DataTable (+ экспорт), StatsSummary
    ├── charts/       — ObservationCharts (Recharts)
    ├── discussion/   — форум: реакции, цитаты, «спросить эксперта»
    ├── auth/         — AuthUI (карточка, поля, UsernameField, RequireAuth, UsernameGate), AccountSettings
    └── wizard/       — AddMeasurementWizard (место → значения из полей → фото/проверка), FieldInput (поле любого типа), LocationPicker
```

```
supabase/
├── migrations/       — SQL-схема: 001_measurements.sql (таблица, индекс, временные RLS-политики),
│                       002_campaigns.sql (таблица кампаний, временная RLS — только чтение),
│                       003_measurements_campaign_fk.sql (FK измерения → кампании; запускать после seed 002),
│                       004_form_engine.sql (поля кампаний, field_values, триггеры правил и проверки),
│                       005_drop_legacy_measurement_columns.sql (удаляет value/instrument/conditions/notes),
│                       006_profiles_auth.sql (profiles, правила имён, триггеры, RPC, лимиты, правило «добавляет только вошедший»),
│                       007_measurements_auth_only.sql (убирает TEMPORARY «все добавляют»; только после деплоя production)
├── functions/account/ — Edge Function: регистрация, вход по имени, сброс пароля (деплой через Dashboard → Via Editor)
├── SETUP_AUTH.md     — ручные настройки Brevo / Supabase / Google Cloud для аккаунтов, по порядку
└── seed/             — демо-данные: 001_measurements_seed.sql (38 мок-измерений),
                        002_campaigns_seed.sql (12 кампаний, те же id),
                        003_water_quality_example.sql (пример лабораторной на движке форм); повторный запуск безопасен
```

SQL запускается вручную в Supabase SQL Editor, по номерам: 001 migration → 001 seed → 002 migration → 002 seed → 003 migration → 004 migration → (003 seed) → 005 migration → 006 migration → (после деплоя production) 007 migration. Seed 001 пишет в колонку `value` и работает только до 005. Seed-файлы только вставляют данные, схему не меняют. Supabase CLI не используется. Новые изменения схемы — новым файлом `00N_*.sql`, старые миграции не редактировать.

Порядок выкладки миграций, несовместимых со старым кодом (как 004/005, 006/007): миграция → проверка на preview (Vercel) → merge → дождаться деплоя production → миграция, ломающая старый код (005, 007). Между 004 и деплоем нового кода production **не может добавлять измерения**. 006 совместима со старым кодом; 007 — нет (старый код добавляет как anon).

Конфиги в корне: vite.config.js (base './', порт 5173), tailwind.config.js (палитра «forest», шрифты, тёмная тема).

## Где что менять

* Данные и форматы записей → `src/data/mockData.js` (форматы описаны в комментарии в начале файла)
* Схема кампаний → новая миграция + `CAMPAIGN_COLUMNS`/`campaignFromRow()` в `AppDataContext.jsx` (языки — отдельные колонки `title_he/en/ru`, `desc_he/en/ru`; `center_lat/center_lng` ↔ `center`; `metric` — ключ из `metrics.js`)
* Схема измерений в базе → новая миграция в `supabase/migrations/` + `MEASUREMENT_COLUMNS`/`fromRow()` в `AppDataContext.jsx` (колонки snake_case, в UI camelCase; `measured_at` ↔ `timestamp`, `field_values` ↔ `values`)
* Поля формы кампании → строки в `campaign_fields` / `campaign_field_options` (SQL Editor; позже — админка). Код менять не нужно.
* Новый тип поля → CHECK в новой миграции + ветка в `measurements_validate_values()` (SQL) + `inputToValue`/`validateValue`/`formatFieldValue`/`exportFieldValue` в `src/lib/fields.js` + `FieldInput.jsx`. Проверки в SQL и в `fields.js` должны совпадать (те же коды ошибок).
* Правила имён пользователей / паролей → три копии, держать одинаковыми (те же коды ошибок): `public.username_error()` в SQL (новая миграция), `src/lib/username.js`, `supabase/functions/account/index.ts`. Тексты ошибок — `auth.errors.<код>` в `strings.js`.
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

## Аккаунты (шаг 4a)

* Вход по **имени пользователя** + паролю, email необязателен; или через Google. Ручные настройки — `supabase/SETUP_AUTH.md`.
* Supabase Auth входит по email, поэтому регистрация, вход по имени и «забыли пароль» идут через Edge Function `account` (секретный ключ): имя → email ищется только на сервере (`account_lookup`), браузер никогда не получает чужой email и не может узнать, есть ли он у пользователя. Ответ «забыли пароль» всегда одинаковый, письмо отправляется в фоне.
* Без email у аккаунта внутренний адрес `<uuid>@noemail.mitzpe.invalid` (подтверждён, писем не получает). `isPlaceholderEmail()` — никогда его не показывать. Настоящий email (при регистрации или в профиле) добавляется через `updateUser({ email })` → письмо с подтверждением; до подтверждения он не используется. Поэтому «Secure email change» в Supabase выключен.
* Письма (сброс, смена email) — шаблоны с `token_hash`: `{{ .RedirectTo }}#/auth/confirm?token_hash=…&type=recovery|email_change|email` → `ConfirmPage` вызывает `verifyOtp` по кнопке. Google — PKCE: возвращается на `…/?code=…#/путь`, `AuthContext` убирает `?code` из адреса.
* `profiles`: `id` (= auth user id), `username` (null, пока пользователь Google не выбрал; выбирается один раз — `set_my_username`), `username_key` (без учёта регистра, уникален), `role` (`student` | `admin` | `main_admin` | `owner`), `role_granted_by`, `role_granted_at`, `created_at`. Профиль создаёт триггер на `auth.users` (имя — из `user_metadata.mitzpe_username`, его ставит только функция). Пользователь не может менять свою роль: у `anon`/`authenticated` нет прав на запись, триггер `profiles_guard` запрещает менять поля ролей из API, `owner` — только из SQL Editor и только один.
* Имя: после NFC, trim и схлопывания пробелов 3–24 символа — буквы иврита/латиницы/кириллицы, цифры, пробел, точка; начинается с буквы/цифры; точка только после буквы/цифры; хотя бы одна буква; латиницу и кириллицу не смешивать; не из списка зарезервированных. Пароль — 8–72 байта.
* Лимиты в функции (`private.rate_limit_hits`, IP хранятся только как HMAC): регистрации на IP и общий лимит в час, неудачные входы на имя, сбросы на IP и на имя. IP клиента берётся из заголовка платформы (не из левой части `X-Forwarded-For`) и передаётся в Supabase Auth как `Sb-Forwarded-For`; проверка на подделку — `SETUP_AUTH.md` → 8a.
* Авторы: `getAuthor(userId)` из `useAppData()` → реальный профиль (UUID, подгружается `loadAuthors`), демо-пользователь из mockData для старых измерений (`u-noa` …, `kind: 'demo'`, показывается с меткой «демо») или `null` («неизвестный участник»). Школу у реальных пользователей не собираем (фильтр/график «моя школа» у них скрыт).
* Шаг 4b: логика ролей (кто кого назначает, каскадный отзыв по `role_granted_by`) и админка — функциями `security definer`; поля для этого уже есть.

## Правила i18n

* Любая новая UI-строка добавляется во все три языка (he, en, ru) в `strings.js`.
* Фоллбэк: текущий язык → иврит → сам ключ (+ предупреждение в dev).
* Названия кампаний, тем и метрик — в данных, поля `titleHe/En/Ru`, `labelHe/En/Ru`. Выводить через `observationTitle()`, `topicTitle()`, `metricLabel()`.

## Правила RTL

* Только логические классы Tailwind: `start-*`, `end-*`, `ms-*`, `me-*`, `ps-*`, `pe-*`. Не использовать `left-*`/`right-*`/`ml-*`/`mr-*`.
* Числа, координаты, единицы — оборачивать в `dir="ltr"`.
* Направление брать из контекста i18n (`dir`, `isRTL`), не хардкодить.

## localStorage

Используется только для `mitzpe.locale` и `mitzpe.theme`, плюс сессия Supabase Auth (`sb-*`, её пишет supabase-js). Данные туда не класть.

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
4. Логин и роли. ~~4a: аккаунты (имя + пароль, email необязателен, Google), `profiles`.~~ Сделано. 4b: роли owner / main_admin / admin, назначение и отзыв, список пользователей.
5. Админка для создания лабораторных без изменения кода (правила изменения полей уже в базе — см. «Поля кампаний»).
