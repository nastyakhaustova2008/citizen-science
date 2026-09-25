# CLAUDE.md — מִצְפֶּה (Field)

## О проекте

Школьная сеть гражданской науки. Ученики делают измерения по единому протоколу (температура, влажность, яркость неба, PM2.5) и отмечают их на общей карте. Mobile-first. Язык по умолчанию — иврит (RTL).

## Текущий статус

* Демо-версия, бэкенда нет. Все данные захардкожены в `src/data/mockData.js`.
* Изменения пользователя живут только в памяти (`AppDataContext`) и теряются при перезагрузке.
* Авторизации нет: текущий пользователь зашит как `CURRENT_USER_ID = 'u-noa'`.
* Загрузка имитируется `useMockLoad` (setTimeout ~550 мс).
* Деплой: GitHub → Vercel. (В репо также лежит `netlify.toml` — остаток, не используется.)

## Стек

* Vite 5 + React 18, JavaScript (JSX), без TypeScript
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

## Структура

```
src/
├── main.jsx          — вход: HashRouter → I18nProvider → ThemeProvider → AppDataProvider
├── App.jsx           — каркас (Header/Footer) и маршруты
├── index.css         — глобальные стили, слои Tailwind, RTL-правки
├── leaflet-setup.js  — пути к иконкам маркеров Leaflet под Vite
├── i18n/             — strings.js (строки he/en/ru, LOCALES), index.jsx (I18nProvider, t(), useI18n/useT)
├── data/             — mockData.js (весь датасет), metrics.js (4 метрики: единицы, диапазоны, цветовые шкалы)
├── context/          — AppDataContext.jsx (данные в памяти), ThemeContext.jsx (тема)
├── hooks/            — useMockLoad.js (имитация loading/error/retry)
├── lib/              — format.js, stats.js, export.js (CSV/JSON/GeoJSON), media.js (SVG-заглушки)
├── pages/            — Home, Observation (вкладки Карта·Данные·Графики·Обсуждение),
│                       AddMeasurement, Profile, Protocol, NotFound
└── components/
    ├── Header, Footer, primitives (skeleton, empty/error, Avatar), Tabs, FilterBar,
    │   ObservationCard, ObsIcon, Counter, ActivityFeed, ContributionGraph, MiniMap, Markdown
    ├── map/          — ObservationMap (Leaflet + кластеры), Legend, PointPanel, TimeSlider
    ├── data/         — DataTable (+ экспорт), StatsSummary
    ├── charts/       — ObservationCharts (Recharts)
    ├── discussion/   — форум: реакции, цитаты, «спросить эксперта»
    └── wizard/       — AddMeasurementWizard (место → значения → фото), LocationPicker
```

Конфиги в корне: vite.config.js (base './', порт 5173), tailwind.config.js (палитра «forest», шрифты, тёмная тема).

## Где что менять

* Данные и форматы записей → `src/data/mockData.js` (форматы описаны в комментарии в начале файла)
* Новая метрика → `src/data/metrics.js`
* Логика добавления/изменения данных → `src/context/AppDataContext.jsx`
* Новая страница → `src/pages/` + маршрут в `App.jsx`
* Компоненты одной фичи → своя папка в `src/components/` (как map/, wizard/)
* Общие UI-элементы → `components/primitives.jsx`, не дублировать
* Утилиты без UI → `src/lib/`

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

1. Подключить бэкенд (кандидат — Supabase) и перенести туда измерения.
2. Перенести кампании/лабораторные из кода в базу.
3. Строить форму измерения динамически из описания лабораторной.
4. Логин и роли: student / admin.
5. Админка для создания лабораторных без изменения кода.
