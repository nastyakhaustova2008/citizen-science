/**
 * Mock dataset for the school citizen-science frontend.
 * Everything here is fabricated demo data — no backend.
 *
 * Shapes:
 *   User          { id, displayName, school, class, role, region, city, avatarSeed, joinedAt }
 *   Observation   { id, slug, metric, titleHe/En/Ru, descHe/En/Ru, icon, status,
 *                   region, difficulty, equipment[], protocolUrl, center:[lat,lng], zoom }
 *   Measurement   { id, observationId, userId, lat, lng, value, timestamp,
 *                   instrument, conditions, notes, verification, photoSeed|null, comments[] }
 *   Topic         { id, observationId, category, titleHe/En/Ru, authorId, createdAt,
 *                   tags[], posts[] }
 *   Post          { id, authorId, createdAt, body, images[], reactions{}, quotedPostId|null,
 *                   verifiedExpert }
 */

import { METRICS } from './metrics';

/* ------------------------------------------------------------------ *
 * Seeded RNG so counts / values are stable between reloads.
 * ------------------------------------------------------------------ */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260906);
const between = (min, max) => min + rand() * (max - min);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const round = (n, d = 1) => Number(n.toFixed(d));

const NOW = new Date('2026-09-06T09:30:00+03:00');
const DAY = 86400000;
const isoDaysAgo = (days, hour = 8, minute = 0) => {
  const d = new Date(NOW.getTime() - days * DAY);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

/* ------------------------------------------------------------------ *
 * Users — 6 (5 school participants + 1 science mentor / expert)
 * ------------------------------------------------------------------ */
export const USERS = [
  {
    id: 'u-noa',
    displayName: 'נועה ל.',
    school: 'תיכון עמל כפר סבא',
    class: 'כיתת מדעים י״א',
    role: 'student',
    region: 'center',
    city: 'כפר סבא',
    avatarSeed: 'noa-amal',
    joinedAt: '2026-02-11',
  },
  {
    id: 'u-yonatan',
    displayName: 'יונתן ק.',
    school: 'אורט רחובות',
    class: 'מגמת מדעי הסביבה',
    role: 'student',
    region: 'lowlands',
    city: 'רחובות',
    avatarSeed: 'yonatan-ort',
    joinedAt: '2026-02-19',
  },
  {
    id: 'u-maya',
    displayName: 'מאיה ד.',
    school: 'תיכון הראל מבשרת',
    class: 'י״ב פיזיקה',
    role: 'student',
    region: 'jerusalem',
    city: 'מבשרת ציון',
    avatarSeed: 'maya-harel',
    joinedAt: '2026-03-03',
  },
  {
    id: 'u-omer',
    displayName: 'עומר ב.',
    school: 'עירוני ד׳ חיפה',
    class: 'י״א כימיה',
    role: 'student',
    region: 'haifa',
    city: 'חיפה',
    avatarSeed: 'omer-dalet',
    joinedAt: '2026-03-17',
  },
  {
    id: 'u-tal',
    displayName: 'טל נ.',
    school: 'תיכון שק״ד שדרות',
    class: 'י״א מדעים',
    role: 'teacher',
    region: 'south',
    city: 'שדרות',
    avatarSeed: 'tal-shaked',
    joinedAt: '2026-01-28',
  },
  {
    id: 'u-ron',
    displayName: 'ד״ר רון א.',
    school: 'אוניברסיטת תל אביב',
    class: 'בית הספר לפיזיקה',
    role: 'mentor',
    region: 'center',
    city: 'תל אביב',
    avatarSeed: 'ron-mentor',
    joinedAt: '2026-01-10',
  },
];

export const CURRENT_USER_ID = 'u-noa';
export const getUser = (id) => USERS.find((u) => u.id === id) || null;
export const EXPERT_IDS = USERS.filter((u) => u.role === 'mentor').map((u) => u.id);

/* City anchors for scattering points */
const CITY_ANCHOR = {
  'כפר סבא': [32.176, 34.907],
  רחובות: [31.894, 34.811],
  'מבשרת ציון': [31.799, 35.146],
  חיפה: [32.794, 34.989],
  שדרות: [31.524, 34.596],
  'תל אביב': [32.08, 34.78],
  'באר שבע': [31.252, 34.791],
  'מצפה רמון': [30.61, 34.8],
};

/* ------------------------------------------------------------------ *
 * Observations — 12 measurement campaigns
 * ------------------------------------------------------------------ */
export const OBSERVATIONS = [
  {
    id: 'obs-schoolyard-heat',
    slug: 'schoolyard-heat',
    metric: 'temperature',
    icon: 'Thermometer',
    titleHe: 'חום בחצר בית הספר',
    titleEn: 'Schoolyard heat',
    titleRu: 'Жара на школьном дворе',
    descHe: 'מיפוי הבדלי טמפרטורה בין פינות מוצללות לחשופות בחצר.',
    descEn: 'Mapping temperature gaps between shaded and exposed corners of the yard.',
    descRu: 'Картирование разницы температур между тенистыми и открытыми углами двора.',
    status: 'collecting',
    region: 'center',
    difficulty: 'easy',
    equipment: ['תרמומטר דיגיטלי', 'טלפון עם GPS'],
    protocolUrl: '#/protocol/schoolyard-heat',
    center: [32.09, 34.85],
    zoom: 8,
  },
  {
    id: 'obs-urban-heat-island',
    slug: 'urban-heat-island',
    metric: 'temperature',
    icon: 'Building2',
    titleHe: 'איי חום עירוניים',
    titleEn: 'Urban heat islands',
    titleRu: 'Городские острова тепла',
    descHe: 'השוואת טמפרטורה בין מרכזי ערים לשכונות ירוקות בשעות אחר הצהריים.',
    descEn: 'Comparing afternoon temperature between city centres and green neighbourhoods.',
    descRu: 'Сравнение дневной температуры между центром города и зелёными районами.',
    status: 'collecting',
    region: 'center',
    difficulty: 'medium',
    equipment: ['תרמומטר דיגיטלי', 'מדחום אינפרא-אדום', 'טלפון עם GPS'],
    protocolUrl: '#/protocol/urban-heat-island',
    center: [32.1, 34.83],
    zoom: 8,
  },
  {
    id: 'obs-asphalt-vs-grass',
    slug: 'asphalt-vs-grass',
    metric: 'temperature',
    icon: 'SunMedium',
    titleHe: 'אספלט מול דשא',
    titleEn: 'Asphalt vs grass',
    titleRu: 'Асфальт против травы',
    descHe: 'מדידת טמפרטורת פני שטח על אספלט, בטון ודשא באותה שעה.',
    descEn: 'Surface temperature over asphalt, concrete and grass at the same hour.',
    descRu: 'Температура поверхности асфальта, бетона и травы в один и тот же час.',
    status: 'collecting',
    region: 'lowlands',
    difficulty: 'easy',
    equipment: ['מדחום אינפרא-אדום'],
    protocolUrl: '#/protocol/asphalt-vs-grass',
    center: [31.9, 34.8],
    zoom: 9,
  },
  {
    id: 'obs-morning-baseline',
    slug: 'morning-baseline',
    metric: 'temperature',
    icon: 'Sunrise',
    titleHe: 'קו בסיס — טמפרטורת בוקר',
    titleEn: 'Morning temperature baseline',
    titleRu: 'Базовая утренняя температура',
    descHe: 'סדרת מדידות ב-07:00 לאורך האביב לבניית קו בסיס אזורי.',
    descEn: 'A 07:00 series through spring to build a regional baseline.',
    descRu: 'Серия измерений в 07:00 всю весну для региональной базовой линии.',
    status: 'completed',
    region: 'north',
    difficulty: 'easy',
    equipment: ['תרמומטר דיגיטלי'],
    protocolUrl: '#/protocol/morning-baseline',
    center: [32.8, 35.1],
    zoom: 9,
  },
  {
    id: 'obs-humidity-from-air',
    slug: 'humidity-from-air',
    metric: 'humidity',
    icon: 'Droplets',
    titleHe: 'לחות מהאוויר',
    titleEn: 'Humidity from air',
    titleRu: 'Влага из воздуха',
    descHe: 'חישוב לחות אבסולוטית מטמפרטורה ולחות יחסית, ומיפוי מפרץ מול פנים הארץ.',
    descEn: 'Absolute humidity from temperature and RH, coast vs inland.',
    descRu: 'Абсолютная влажность из температуры и ОВ, побережье против внутренних районов.',
    status: 'collecting',
    region: 'haifa',
    difficulty: 'medium',
    equipment: ['מד לחות (היגרומטר)', 'תרמומטר דיגיטלי'],
    protocolUrl: '#/protocol/humidity-from-air',
    center: [32.5, 34.95],
    zoom: 8,
  },
  {
    id: 'obs-galilee-humidity',
    slug: 'galilee-humidity',
    metric: 'humidity',
    icon: 'CloudDrizzle',
    titleHe: 'לחות בגליל',
    titleEn: 'Galilee humidity',
    titleRu: 'Влажность в Галилее',
    descHe: 'מדידות לחות בעמקים ובפסגות הגליל בעונת המעבר.',
    descEn: 'Humidity in Galilee valleys and ridgelines during the transition season.',
    descRu: 'Влажность в долинах и на хребтах Галилеи в межсезонье.',
    status: 'completed',
    region: 'north',
    difficulty: 'medium',
    equipment: ['מד לחות (היגרומטר)'],
    protocolUrl: '#/protocol/galilee-humidity',
    center: [32.95, 35.3],
    zoom: 9,
  },
  {
    id: 'obs-dark-skies',
    slug: 'dark-skies',
    metric: 'skyBrightness',
    icon: 'Moon',
    titleHe: 'שמיים כהים',
    titleEn: 'Dark skies',
    titleRu: 'Тёмное небо',
    descHe: 'מדידת בהירות שמיים בלילה עם חיישן SQM כדי למפות זיהום אור.',
    descEn: 'Night sky brightness with an SQM sensor to map light pollution.',
    descRu: 'Яркость ночного неба датчиком SQM для картирования светового загрязнения.',
    status: 'collecting',
    region: 'center',
    difficulty: 'hard',
    equipment: ['חיישן SQM', 'טלפון עם GPS', 'שעון'],
    protocolUrl: '#/protocol/dark-skies',
    center: [32.0, 34.9],
    zoom: 8,
  },
  {
    id: 'obs-negev-sky',
    slug: 'negev-sky',
    metric: 'skyBrightness',
    icon: 'Stars',
    titleHe: 'בהירות שמיים בנגב',
    titleEn: 'Negev sky brightness',
    titleRu: 'Яркость неба в Негеве',
    descHe: 'סדרת מדידות מהמצפה ומהיישובים סביב מכתש רמון.',
    descEn: 'A series from the observatory and towns around Makhtesh Ramon.',
    descRu: 'Серия от обсерватории и посёлков вокруг кратера Рамон.',
    status: 'collecting',
    region: 'south',
    difficulty: 'hard',
    equipment: ['חיישן SQM'],
    protocolUrl: '#/protocol/negev-sky',
    center: [30.7, 34.8],
    zoom: 8,
  },
  {
    id: 'obs-light-pollution-census',
    slug: 'light-pollution-census',
    metric: 'skyBrightness',
    icon: 'Lightbulb',
    titleHe: 'מפקד זיהום אור',
    titleEn: 'Light pollution census',
    titleRu: 'Перепись светового загрязнения',
    descHe: 'מדידה חד-פעמית מתואמת מכל בתי הספר באותו לילה ללא ירח.',
    descEn: 'A single coordinated reading from every school on the same moonless night.',
    descRu: 'Одно согласованное измерение от каждой школы в одну безлунную ночь.',
    status: 'completed',
    region: 'center',
    difficulty: 'medium',
    equipment: ['חיישן SQM'],
    protocolUrl: '#/protocol/light-pollution-census',
    center: [32.2, 34.9],
    zoom: 8,
  },
  {
    id: 'obs-roadside-air',
    slug: 'roadside-air',
    metric: 'airQuality',
    icon: 'Wind',
    titleHe: 'זיהום אוויר ליד כבישים',
    titleEn: 'Roadside air quality',
    titleRu: 'Качество воздуха у дорог',
    descHe: 'מדידת PM2.5 במרחקים שונים מציר תנועה ראשי בשעת עומס.',
    descEn: 'PM2.5 at increasing distance from a main traffic artery at rush hour.',
    descRu: 'PM2.5 на разном удалении от главной магистрали в час пик.',
    status: 'collecting',
    region: 'center',
    difficulty: 'medium',
    equipment: ['מד חלקיקים ניד (PM2.5)', 'טלפון עם GPS'],
    protocolUrl: '#/protocol/roadside-air',
    center: [32.07, 34.8],
    zoom: 9,
  },
  {
    id: 'obs-desert-dust',
    slug: 'desert-dust',
    metric: 'airQuality',
    icon: 'CloudFog',
    titleHe: 'אבק מדברי',
    titleEn: 'Desert dust',
    titleRu: 'Пустынная пыль',
    descHe: 'מעקב אחר אירועי אבק בנגב ובשפלה לפי ריכוזי חלקיקים.',
    descEn: 'Tracking dust events across the Negev and lowlands by particle load.',
    descRu: 'Отслеживание пыльных явлений в Негеве и низменности по концентрации частиц.',
    status: 'collecting',
    region: 'south',
    difficulty: 'easy',
    equipment: ['מד חלקיקים ניד (PM2.5)'],
    protocolUrl: '#/protocol/desert-dust',
    center: [31.3, 34.7],
    zoom: 8,
  },
  {
    id: 'obs-winter-air',
    slug: 'winter-air',
    metric: 'airQuality',
    icon: 'Snowflake',
    titleHe: 'איכות אוויר בחורף',
    titleEn: 'Winter air quality',
    titleRu: 'Качество воздуха зимой',
    descHe: 'מדידות ערב בשכונות מגורים בעונת ההסקה בעצים.',
    descEn: 'Evening readings in residential neighbourhoods during the wood-heating season.',
    descRu: 'Вечерние измерения в жилых районах в сезон печного отопления.',
    status: 'completed',
    region: 'jerusalem',
    difficulty: 'medium',
    equipment: ['מד חלקיקים ניד (PM2.5)'],
    protocolUrl: '#/protocol/winter-air',
    center: [31.78, 35.2],
    zoom: 9,
  },
];

export const getObservation = (idOrSlug) =>
  OBSERVATIONS.find((o) => o.id === idOrSlug || o.slug === idOrSlug) || null;

export function observationTitle(obs, locale) {
  if (!obs) return '';
  if (locale === 'en') return obs.titleEn;
  if (locale === 'ru') return obs.titleRu;
  return obs.titleHe;
}
export function observationDesc(obs, locale) {
  if (!obs) return '';
  if (locale === 'en') return obs.descEn;
  if (locale === 'ru') return obs.descRu;
  return obs.descHe;
}

/* ------------------------------------------------------------------ *
 * Measurements — ~36 points scattered across the campaigns
 * ------------------------------------------------------------------ */
const INSTRUMENTS = {
  temperature: ['תרמומטר דיגיטלי TFA 30.1', 'מדחום אינפרא-אדום UNI-T UT303', 'חיישן DHT22 + Arduino'],
  humidity: ['היגרומטר TFA 30.5', 'חיישן SHT31', 'תחנת מזג אוויר ביתית'],
  skyBrightness: ['Unihedron SQM-L', 'Unihedron SQM-LU', 'חיישן TSL2591 + Raspberry Pi'],
  airQuality: ['PMS7003 נייד', 'Atmotube Pro', 'SDS011 + לוח ESP32'],
};
const CONDITIONS = {
  day: ['שמש מלאה', 'בהיר, רוח קלה', 'מעונן חלקית', 'לאחר גשם', 'שרבי, אובך קל'],
  night: ['שמיים בהירים ללא ירח', 'אובך קל', 'עננות גבוהה דקה', 'לילה צלול, קר'],
};
const NOTES_POOL = [
  '',
  '',
  '',
  'נמדד ליד קיר בטון פונה דרום',
  'הדשא הושקה בבוקר',
  'תנועת כלי רכב כבדה בזמן המדידה',
  'החיישן התייצב אחרי 3 דקות',
  'רוח החליפה כיוון באמצע המדידה',
  'מקור אור רחוב במרחק ~40 מ׳',
];

/** Distance-decayed spatial value gradient so map colours look meaningful. */
function scatter(anchor, spreadKm) {
  const dLat = (between(-spreadKm, spreadKm) / 111);
  const dLng = (between(-spreadKm, spreadKm) / (111 * Math.cos((anchor[0] * Math.PI) / 180)));
  return [round(anchor[0] + dLat, 5), round(anchor[1] + dLng, 5)];
}

function valueFor(metric, seedFrac) {
  const m = METRICS[metric];
  const [lo, hi] = m.plausible;
  const span = hi - lo;
  // centre-weighted with campaign-level offset
  const base = lo + span * (0.25 + 0.5 * seedFrac);
  const jitter = between(-span * 0.12, span * 0.12);
  return round(base + jitter, m.decimals);
}

const VERIFICATIONS = ['verified', 'verified', 'verified', 'pending', 'flagged'];

/* How many points per campaign + which schools contribute */
const CAMPAIGN_PLAN = {
  'obs-schoolyard-heat': { count: 5, cities: ['כפר סבא', 'רחובות', 'תל אביב'], seed: 0.7, night: false },
  'obs-urban-heat-island': { count: 4, cities: ['תל אביב', 'כפר סבא'], seed: 0.8, night: false },
  'obs-asphalt-vs-grass': { count: 3, cities: ['רחובות'], seed: 0.6, night: false },
  'obs-morning-baseline': { count: 3, cities: ['חיפה', 'מבשרת ציון'], seed: 0.3, night: false },
  'obs-humidity-from-air': { count: 4, cities: ['חיפה', 'תל אביב'], seed: 0.65, night: false },
  'obs-galilee-humidity': { count: 2, cities: ['חיפה'], seed: 0.5, night: false },
  'obs-dark-skies': { count: 4, cities: ['כפר סבא', 'תל אביב', 'רחובות'], seed: 0.4, night: true },
  'obs-negev-sky': { count: 3, cities: ['מצפה רמון', 'באר שבע'], seed: 0.85, night: true },
  'obs-light-pollution-census': { count: 2, cities: ['כפר סבא', 'תל אביב'], seed: 0.45, night: true },
  'obs-roadside-air': { count: 4, cities: ['תל אביב', 'רחובות'], seed: 0.6, night: false },
  'obs-desert-dust': { count: 2, cities: ['שדרות', 'באר שבע'], seed: 0.75, night: false },
  'obs-winter-air': { count: 2, cities: ['מבשרת ציון'], seed: 0.55, night: false },
};

const CITY_TO_USER = {
  'כפר סבא': 'u-noa',
  רחובות: 'u-yonatan',
  'מבשרת ציון': 'u-maya',
  חיפה: 'u-omer',
  שדרות: 'u-tal',
  'תל אביב': 'u-noa',
  'באר שבע': 'u-tal',
  'מצפה רמון': 'u-tal',
};

const PLACE_LABELS = [
  'חצר אחורית', 'שער ראשי', 'מגרש ספורט', 'פינת ישיבה מוצללת', 'חניון המורים',
  'גינה קהילתית', 'תחנת אוטובוס', 'גג בית הספר', 'שדרת עצים', 'כיכר מרכזית',
  'שולי כביש ראשי', 'פארק שכונתי', 'מגרש חנייה', 'טיילת', 'מצפה כוכבים',
];

function buildMeasurements() {
  const out = [];
  let n = 1;
  const completedIds = new Set(OBSERVATIONS.filter((o) => o.status === 'completed').map((o) => o.id));

  for (const obs of OBSERVATIONS) {
    const plan = CAMPAIGN_PLAN[obs.id];
    if (!plan) continue;
    const completed = completedIds.has(obs.id);

    for (let i = 0; i < plan.count; i++) {
      const city = plan.cities[i % plan.cities.length];
      const anchor = CITY_ANCHOR[city] || obs.center;
      const [lat, lng] = scatter(anchor, obs.metric === 'skyBrightness' ? 6 : 2.5);
      const userId = CITY_TO_USER[city] || pick(USERS).id;

      const daysAgo = completed
        ? Math.round(between(120, 210)) - i * 7
        : Math.round(between(1, 38)) - i * 2;
      const hour = plan.night ? Math.round(between(20, 23)) : Math.round(between(7, 17));
      const minute = Math.round(between(0, 59));

      const seedFrac = Math.min(1, Math.max(0, plan.seed + between(-0.15, 0.15) + i * 0.03));
      const value = valueFor(obs.metric, seedFrac);
      const verification = completed ? 'verified' : pick(VERIFICATIONS);

      const hasPhoto = rand() > 0.35;
      const comments = [];
      if (rand() > 0.6) {
        comments.push({
          id: `c-${n}-1`,
          authorId: pick(USERS).id,
          createdAt: isoDaysAgo(Math.max(0, daysAgo - 1), 12, 10),
          body: pick([
            'מיקום יפה, תוכלו להוסיף גם מדידה בצד המוצל?',
            'הערך נראה גבוה טיפה — איזה מכשיר השתמשתם?',
            'תודה, זה משלים לנו את הפינה הצפונית של המפה.',
            'האם החיישן היה בשמש ישירה?',
          ]),
        });
      }
      if (verification === 'flagged') {
        comments.push({
          id: `c-${n}-flag`,
          authorId: 'u-ron',
          createdAt: isoDaysAgo(Math.max(0, daysAgo - 2), 9, 40),
          body: 'סימנתי לבדיקה: הערך חורג בכ-2 סטיות תקן מהשכנים. נא לאמת מול המכשיר.',
          verifiedExpert: true,
        });
      }

      out.push({
        id: `m-${String(n).padStart(3, '0')}`,
        observationId: obs.id,
        userId,
        placeLabel: PLACE_LABELS[(n + i) % PLACE_LABELS.length],
        lat,
        lng,
        value,
        timestamp: isoDaysAgo(Math.max(0, daysAgo), hour, minute),
        instrument: pick(INSTRUMENTS[obs.metric]),
        conditions: plan.night ? pick(CONDITIONS.night) : pick(CONDITIONS.day),
        notes: pick(NOTES_POOL),
        verification,
        photoSeed: hasPhoto ? `${obs.slug}-${n}` : null,
        comments,
      });
      n++;
    }
  }
  return out.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

export const MEASUREMENTS = buildMeasurements();

export const measurementsFor = (observationId) =>
  MEASUREMENTS.filter((m) => m.observationId === observationId);

/* ------------------------------------------------------------------ *
 * Derived network-wide counters (Home screen)
 * ------------------------------------------------------------------ */
export const NETWORK_STATS = {
  measurements: MEASUREMENTS.length,
  schools: new Set(USERS.filter((u) => u.role !== 'mentor').map((u) => u.school)).size,
  activeObservations: OBSERVATIONS.filter((o) => o.status === 'collecting').length,
};

/* Participants per observation (unique users) */
export function participantsCount(observationId) {
  return new Set(measurementsFor(observationId).map((m) => m.userId)).size;
}

/* ------------------------------------------------------------------ *
 * Activity feed — most recent measurements, GitHub-style
 * ------------------------------------------------------------------ */
export const ACTIVITY_FEED = MEASUREMENTS.slice(0, 14).map((m) => ({
  id: `act-${m.id}`,
  type: 'measurement',
  userId: m.userId,
  observationId: m.observationId,
  placeLabel: m.placeLabel,
  value: m.value,
  metric: getObservation(m.observationId)?.metric,
  timestamp: m.timestamp,
}));

/* ------------------------------------------------------------------ *
 * Discussion — a handful of topics, some with real threads
 * ------------------------------------------------------------------ */
export const TOPICS = [
  {
    id: 't-shade-timing',
    observationId: 'obs-schoolyard-heat',
    category: 'method',
    titleHe: 'באיזו שעה עדיף למדוד את פינת הצל?',
    titleEn: 'What time of day for the shaded corner?',
    titleRu: 'В какое время суток мерить тенистый угол?',
    authorId: 'u-yonatan',
    createdAt: isoDaysAgo(9, 14, 12),
    tags: ['פרוטוקול', 'שעת מדידה'],
    posts: [
      {
        id: 'p-1',
        authorId: 'u-yonatan',
        createdAt: isoDaysAgo(9, 14, 12),
        body:
          'הפרוטוקול אומר "אחר הצהריים" אבל זה טווח רחב.\n\nאנחנו מודדים ב-14:00 וב-16:00 ומקבלים הפרש של כמעט **3°C** בין השעות. מה אתם עושים?',
        images: [],
        reactions: { '👍': 4, '🤔': 2 },
        quotedPostId: null,
        verifiedExpert: false,
      },
      {
        id: 'p-2',
        authorId: 'u-noa',
        createdAt: isoDaysAgo(9, 15, 3),
        body: 'אנחנו קיבענו 15:00 לכל המדידות. ככה לפחות ההשוואה בין הנקודות עקבית גם אם השעה לא "השיא".',
        images: [],
        reactions: { '👍': 3 },
        quotedPostId: 'p-1',
        verifiedExpert: false,
      },
      {
        id: 'p-3',
        authorId: 'u-ron',
        createdAt: isoDaysAgo(8, 9, 20),
        body:
          'תשובה קצרה: **קבעו שעה אחת ותיצמדו אליה**.\n\nהשיא התרמי בקרקע חשופה הוא בדרך כלל 14:00–15:00 בשעון קיץ. אם המטרה היא הפרש צל/שמש, 15:00 טוב. תעדו את השעה המדויקת בכל מקרה — אפשר לתקן סטטיסטית בדיעבד.',
        images: [],
        reactions: { '👍': 9, '🙏': 4 },
        quotedPostId: null,
        verifiedExpert: true,
      },
    ],
  },
  {
    id: 't-ir-vs-probe',
    observationId: 'obs-schoolyard-heat',
    category: 'data',
    titleHe: 'מדחום אינפרא-אדום נותן ערכים נמוכים מהחיישן',
    titleEn: 'IR thermometer reads lower than the probe',
    titleRu: 'ИК-термометр показывает ниже, чем зонд',
    authorId: 'u-omer',
    createdAt: isoDaysAgo(5, 11, 0),
    tags: ['ציוד', 'כיול'],
    posts: [
      {
        id: 'p-4',
        authorId: 'u-omer',
        createdAt: isoDaysAgo(5, 11, 0),
        body:
          'השווינו את שני המכשירים זה לצד זה על אותה נקודה בדשא:\n\n- חיישן DHT22: 31.4°C\n- מדחום IR: 28.9°C\n\nההפרש עקבי לאורך 6 מדידות. מישהו נתקל בזה?',
        images: ['ir-vs-probe-1'],
        reactions: { '🤔': 5 },
        quotedPostId: null,
        verifiedExpert: false,
      },
      {
        id: 'p-5',
        authorId: 'u-ron',
        createdAt: isoDaysAgo(4, 16, 30),
        body:
          'זה צפוי. מדחום IR מודד **טמפרטורת פני שטח** ותלוי במקדם הפליטה (emissivity). דשא ≈ 0.95, אבל אם המכשיר מכויל ל-1.0 תקבלו קריאה נמוכה.\n\nלמדידת טמפרטורת אוויר השתמשו בחיישן עם הצללה ואוורור. שמרו את ה-IR למשטחים.',
        images: [],
        reactions: { '👍': 7, '🙏': 3 },
        quotedPostId: 'p-4',
        verifiedExpert: true,
      },
    ],
  },
  {
    id: 't-sqm-clouds',
    observationId: 'obs-dark-skies',
    category: 'expert',
    titleHe: 'עננות דקה מעלה או מורידה את קריאת ה-SQM?',
    titleEn: 'Do thin clouds raise or lower the SQM reading?',
    titleRu: 'Тонкие облака повышают или понижают показания SQM?',
    authorId: 'u-maya',
    createdAt: isoDaysAgo(12, 21, 45),
    tags: ['SQM', 'תנאי מדידה'],
    posts: [
      {
        id: 'p-6',
        authorId: 'u-maya',
        createdAt: isoDaysAgo(12, 21, 45),
        body: 'ראינו שבלילה עם עננות גבוהה דקה ה-SQM ירד (שמיים "בהירים" יותר) בערים. זה הגיוני?',
        images: [],
        reactions: { '👍': 2 },
        quotedPostId: null,
        verifiedExpert: false,
      },
      {
        id: 'p-7',
        authorId: 'u-ron',
        createdAt: isoDaysAgo(11, 22, 10),
        body:
          'כן, בעיר עננים **מחזירים** את אור הרחוב כלפי מטה, אז השמיים בהירים יותר וה-SQM יורד.\n\nמחוץ לעיר קורה ההפך — העננים חוסמים את אור הכוכבים והשמיים כהים יותר. לכן הפרוטוקול דורש שמיים נקיים: עננות פוסלת את המדידה.',
        images: [],
        reactions: { '👍': 11, '🙏': 6, '💡': 4 },
        quotedPostId: 'p-6',
        verifiedExpert: true,
      },
    ],
  },
  {
    id: 't-pm-humidity',
    observationId: 'obs-roadside-air',
    category: 'data',
    titleHe: 'קפיצה ב-PM2.5 בלי סיבה נראית לעין',
    titleEn: 'PM2.5 spike with no visible cause',
    titleRu: 'Скачок PM2.5 без видимой причины',
    authorId: 'u-noa',
    createdAt: isoDaysAgo(3, 8, 15),
    tags: ['PM2.5', 'לחות'],
    posts: [
      {
        id: 'p-8',
        authorId: 'u-noa',
        createdAt: isoDaysAgo(3, 8, 15),
        body: 'בבוקר קיבלנו 41 µg/m³ ליד הכביש, אחרי שעה 17. שום פקק, שום עבודות. מה יכול לגרום לזה?',
        images: [],
        reactions: { '🤔': 3 },
        quotedPostId: null,
        verifiedExpert: false,
      },
      {
        id: 'p-9',
        authorId: 'u-tal',
        createdAt: isoDaysAgo(3, 9, 0),
        body: 'הייתה לחות גבוהה בבוקר? חיישנים אופטיים זולים "סופרים" טיפות ערפל כחלקיקים.',
        images: [],
        reactions: { '👍': 5 },
        quotedPostId: 'p-8',
        verifiedExpert: false,
      },
      {
        id: 'p-10',
        authorId: 'u-ron',
        createdAt: isoDaysAgo(2, 10, 30),
        body:
          'כמעט תמיד זו הלחות. מעל ~75% לחות יחסית חיישני PMS/SDS מנפחים את הקריאה.\n\nרשמו את הלחות בכל מדידה, וסננו בדיעבד מדידות מעל 80%. שווה גם למדוד שוב אחרי שהלחות יורדת.',
        images: [],
        reactions: { '👍': 8, '🙏': 2 },
        quotedPostId: 'p-9',
        verifiedExpert: true,
      },
    ],
  },
  {
    id: 't-welcome',
    observationId: 'obs-schoolyard-heat',
    category: 'general',
    titleHe: 'מצטרפים חדשים — הציגו את בית הספר שלכם',
    titleEn: 'New joiners — introduce your school',
    titleRu: 'Новые участники — представьте свою школу',
    authorId: 'u-tal',
    createdAt: isoDaysAgo(30, 10, 0),
    tags: ['היכרות'],
    posts: [
      {
        id: 'p-11',
        authorId: 'u-tal',
        createdAt: isoDaysAgo(30, 10, 0),
        body: 'פתחנו את הקמפיין הראשון. ספרו מאיפה אתם, כמה תלמידים משתתפים ואיזה ציוד יש לכם.',
        images: [],
        reactions: { '👋': 12 },
        quotedPostId: null,
        verifiedExpert: false,
      },
      {
        id: 'p-12',
        authorId: 'u-omer',
        createdAt: isoDaysAgo(28, 13, 20),
        body: 'עירוני ד׳ חיפה, 18 תלמידים ממגמת כימיה. יש לנו 3 חיישני DHT22 ומדחום IR אחד.',
        images: [],
        reactions: { '👍': 6 },
        quotedPostId: null,
        verifiedExpert: false,
      },
      {
        id: 'p-13',
        authorId: 'u-maya',
        createdAt: isoDaysAgo(26, 9, 5),
        body: 'תיכון הראל מבשרת, י״ב פיזיקה. מתחילים מ"שמיים כהים" כי יש לנו SQM מהמעבדה.',
        images: [],
        reactions: { '👍': 5, '🔭': 3 },
        quotedPostId: null,
        verifiedExpert: false,
      },
    ],
  },
  {
    id: 't-export-format',
    observationId: 'obs-humidity-from-air',
    category: 'method',
    titleHe: 'איך אתם מחשבים לחות אבסולוטית מהנתונים?',
    titleEn: 'How do you compute absolute humidity from the readings?',
    titleRu: 'Как вы считаете абсолютную влажность из показаний?',
    authorId: 'u-omer',
    createdAt: isoDaysAgo(7, 12, 40),
    tags: ['חישוב', 'נוסחה'],
    posts: [
      {
        id: 'p-14',
        authorId: 'u-omer',
        createdAt: isoDaysAgo(7, 12, 40),
        body:
          'המכשיר נותן טמפרטורה ולחות יחסית. הפרוטוקול מבקש לחות אבסולוטית ב-g/m³. אנחנו משתמשים בקירוב:\n\n`AH ≈ 6.112 · e^(17.67·T/(T+243.5)) · RH · 2.1674 / (273.15+T)`\n\nמישהו בודק את זה מול טבלה?',
        images: [],
        reactions: { '👍': 4, '💡': 2 },
        quotedPostId: null,
        verifiedExpert: false,
      },
      {
        id: 'p-15',
        authorId: 'u-ron',
        createdAt: isoDaysAgo(6, 14, 15),
        body: 'הנוסחה טובה (שגיאה < 0.1 g/m³ בטווח 0–40°C). הוסיפו אותה כעמודה מחושבת בגיליון והכניסו רק T ו-RH הגולמיים לטופס.',
        images: [],
        reactions: { '👍': 6, '🙏': 3 },
        quotedPostId: 'p-14',
        verifiedExpert: true,
      },
    ],
  },
];

export const topicsFor = (observationId) => TOPICS.filter((t) => t.observationId === observationId);

export function topicTitle(topic, locale) {
  if (!topic) return '';
  if (locale === 'en') return topic.titleEn;
  if (locale === 'ru') return topic.titleRu;
  return topic.titleHe;
}

export function lastPostAt(topic) {
  return topic.posts.reduce(
    (latest, p) => (new Date(p.createdAt) > new Date(latest) ? p.createdAt : latest),
    topic.posts[0]?.createdAt,
  );
}

/* ------------------------------------------------------------------ *
 * Badges per user (restrained — no in-your-face gamification)
 * ------------------------------------------------------------------ */
export const USER_BADGES = {
  'u-noa': ['firstMeasurement', 'tenMeasurements', 'threeCampaigns', 'consistent'],
  'u-yonatan': ['firstMeasurement', 'tenMeasurements', 'earlyBird'],
  'u-maya': ['firstMeasurement', 'threeCampaigns'],
  'u-omer': ['firstMeasurement', 'tenMeasurements', 'peerReview'],
  'u-tal': ['firstMeasurement', 'tenMeasurements', 'threeCampaigns', 'consistent', 'earlyBird'],
  'u-ron': ['peerReview'],
};

export function measurementsByUser(userId) {
  return MEASUREMENTS.filter((m) => m.userId === userId);
}

/** Monthly contribution counts for the contribution graph. */
export function monthlyContributions(userId, months = 12) {
  const buckets = [];
  const start = new Date(NOW.getFullYear(), NOW.getMonth() - (months - 1), 1);
  for (let i = 0; i < months; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    buckets.push({ year: d.getFullYear(), month: d.getMonth(), count: 0 });
  }
  for (const m of measurementsByUser(userId)) {
    const d = new Date(m.timestamp);
    const bucket = buckets.find((b) => b.year === d.getFullYear() && b.month === d.getMonth());
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

export const REFERENCE_DATE = NOW;
