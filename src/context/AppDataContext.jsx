import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { TOPICS, USERS, getUser } from '../data/mockData';
import { METRICS } from '../data/metrics';
import { fieldFromRow, buildScale } from '../lib/fields';
import { supabase } from '../lib/supabase';
import { useAuth, authorFromProfile, PROFILE_COLUMNS } from './AuthContext';

/**
 * Application state.
 * Campaigns + their field definitions are read from Supabase
 * (`campaigns`, `campaign_fields`, `campaign_field_options`; read-only for now).
 * Measurements are read from / inserted into Supabase (`measurements` table);
 * their values live in `field_values` (jsonb keyed by field key), validated by the database.
 * The current user comes from AuthContext (Supabase Auth + profiles); adding measurements
 * requires login and stores the real user id.
 * Authors: real users → profiles (loaded for the ids on screen); seeded demo rows keep mock ids
 * ('u-noa', …) → mock users from mockData, marked kind: 'demo'.
 * Everything else (topics, posts, joins, point comments, flags, photos)
 * still lives in memory over the mock dataset for the session only.
 */
const CAMPAIGN_COLUMNS =
  'id, slug, metric, icon, title_he, title_en, title_ru, desc_he, desc_en, desc_ru, status, region, difficulty, equipment, protocol_url, center_lat, center_lng, zoom, sort_order, form_version, campaign_fields(*, campaign_field_options(*))';

/** DB row (snake_case) → the Observation (campaign) shape the UI uses (see mockData.js). */
function campaignFromRow(row) {
  const fields = (row.campaign_fields || [])
    .map(fieldFromRow)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
  return {
    id: row.id,
    slug: row.slug,
    metric: row.metric,
    icon: row.icon,
    titleHe: row.title_he,
    titleEn: row.title_en,
    titleRu: row.title_ru,
    descHe: row.desc_he,
    descEn: row.desc_en,
    descRu: row.desc_ru,
    status: row.status,
    region: row.region,
    difficulty: row.difficulty,
    equipment: row.equipment || [],
    protocolUrl: row.protocol_url,
    center: [row.center_lat, row.center_lng],
    zoom: row.zoom,
    formVersion: row.form_version,
    fields,
    primaryField: fields.find((f) => f.isPrimary && !f.archived) || null,
  };
}

async function fetchCampaigns() {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase
    .from('campaigns')
    .select(CAMPAIGN_COLUMNS)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return data.map((row) => {
    if (row.metric && !METRICS[row.metric]) {
      console.warn(`[campaigns] "${row.id}": unknown metric preset "${row.metric}", using default colours`);
    }
    return campaignFromRow(row);
  });
}

const MEASUREMENT_COLUMNS =
  'id, observation_id, user_id, place_label, lat, lng, measured_at, verification, photo_seed, field_values, form_version';

/** DB row (snake_case) → the Measurement shape the UI uses (see mockData.js). */
function fromRow(row) {
  return {
    id: row.id,
    observationId: row.observation_id,
    userId: row.user_id,
    placeLabel: row.place_label || '',
    lat: row.lat,
    lng: row.lng,
    timestamp: row.measured_at,
    values: row.field_values || {},
    formVersion: row.form_version,
    verification: row.verification,
    photoSeed: row.photo_seed,
    photos: {},
    comments: [],
  };
}

/**
 * Error thrown by addMeasurement when the database rejects the values.
 * `fieldErrors` is {fieldKey: code} (codes as in src/lib/fields.js → validateValue).
 */
export class InvalidValuesError extends Error {
  constructor(fieldErrors) {
    super('invalid_values');
    this.fieldErrors = fieldErrors;
  }
}

function parseFieldErrors(details) {
  try {
    const parsed = JSON.parse(details);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

const AppDataContext = createContext(null);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function AppDataProvider({ children }) {
  const [campaigns, setCampaigns] = useState([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [campaignsError, setCampaignsError] = useState(false);
  const [campaignsNonce, setCampaignsNonce] = useState(0);
  const [measurements, setMeasurements] = useState([]);
  const [measurementsLoading, setMeasurementsLoading] = useState(true);
  const [measurementsError, setMeasurementsError] = useState(false);
  const [measurementsNonce, setMeasurementsNonce] = useState(0);
  const [topics, setTopics] = useState(TOPICS);
  const [joined, setJoined] = useState(() => new Set(['obs-schoolyard-heat', 'obs-dark-skies']));

  const { currentUser } = useAuth();
  const currentUserId = currentUser?.id ?? null;

  // Public profiles of real users whose ids are on screen: id → author, or null (no such profile).
  const [authors, setAuthors] = useState({});
  const requestedAuthors = useRef(new Set());

  const loadAuthors = useCallback(async (ids) => {
    if (!supabase) return;
    const todo = [...new Set(ids)].filter((id) => UUID_RE.test(id) && !requestedAuthors.current.has(id));
    if (todo.length === 0) return;
    todo.forEach((id) => requestedAuthors.current.add(id));
    for (let i = 0; i < todo.length; i += 100) {
      const chunk = todo.slice(i, i + 100);
      const { data, error } = await supabase.from('profiles').select(PROFILE_COLUMNS).in('id', chunk);
      if (error) {
        console.error('[profiles] load failed', error);
        chunk.forEach((id) => requestedAuthors.current.delete(id));
        continue;
      }
      setAuthors((prev) => {
        const next = { ...prev };
        for (const id of chunk) next[id] = null;
        for (const row of data) next[row.id] = authorFromProfile(row);
        return next;
      });
    }
  }, []);

  /** Author of a measurement / comment / post: real profile, demo (mock) user, or null (unknown). */
  const getAuthor = useCallback(
    (id) => {
      if (!id) return null;
      if (currentUser && id === currentUser.id) return currentUser;
      if (authors[id]) return authors[id];
      const mock = getUser(id);
      return mock ? { ...mock, kind: 'demo' } : null;
    },
    [authors, currentUser],
  );

  /** false while a real user's profile is still being looked up. */
  const isAuthorResolved = useCallback(
    (id) => !UUID_RE.test(id || '') || id === currentUserId || id in authors,
    [authors, currentUserId],
  );

  useEffect(() => {
    let alive = true;
    setCampaignsLoading(true);
    setCampaignsError(false);
    (async () => {
      try {
        const list = await fetchCampaigns();
        if (alive) setCampaigns(list);
      } catch (err) {
        if (!alive) return;
        console.error('[campaigns] load failed', err);
        setCampaignsError(true);
      } finally {
        if (alive) setCampaignsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [campaignsNonce]);

  const reloadCampaigns = useCallback(() => setCampaignsNonce((n) => n + 1), []);

  /**
   * Re-read campaigns in the background (no loading state, so open forms keep their input).
   * Used after the database rejected a measurement — the form may have changed.
   */
  const refreshCampaigns = useCallback(async () => {
    try {
      setCampaigns(await fetchCampaigns());
    } catch (err) {
      console.error('[campaigns] refresh failed', err);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    setMeasurementsLoading(true);
    setMeasurementsError(false);
    (async () => {
      try {
        if (!supabase) throw new Error('Supabase is not configured');
        const { data, error } = await supabase
          .from('measurements')
          .select(MEASUREMENT_COLUMNS)
          .order('measured_at', { ascending: false });
        if (error) throw error;
        if (!alive) return;
        // Keep in-memory extras (photos, comments, flags) for rows already on screen.
        setMeasurements((prev) => {
          const local = new Map(prev.map((m) => [m.id, m]));
          return data.map((row) => {
            const m = fromRow(row);
            const old = local.get(m.id);
            return old
              ? {
                  ...m,
                  photos: old.photos,
                  comments: old.comments,
                  verification: old.verification === 'flagged' ? 'flagged' : m.verification,
                }
              : m;
          });
        });
      } catch (err) {
        if (!alive) return;
        console.error('[measurements] load failed', err);
        setMeasurementsError(true);
      } finally {
        if (alive) setMeasurementsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [measurementsNonce]);

  const reloadMeasurements = useCallback(() => setMeasurementsNonce((n) => n + 1), []);

  /**
   * Insert into Supabase; resolves with the saved record.
   * draft: { observationId, lat, lng, placeLabel, timestamp, values, photos }
   * The database validates `values` against the campaign's CURRENT fields and stores the
   * current form_version. If it rejects them, the campaign is re-read and an
   * InvalidValuesError with per-field codes is thrown.
   */
  const addMeasurement = useCallback(
    async (draft) => {
      if (!supabase) throw new Error('Supabase is not configured');
      if (!currentUserId) throw new Error('not_logged_in');
      const { data, error } = await supabase
        .from('measurements')
        .insert({
          observation_id: draft.observationId,
          user_id: currentUserId,
          place_label: draft.placeLabel || null,
          lat: draft.lat,
          lng: draft.lng,
          measured_at: draft.timestamp,
          field_values: draft.values,
        })
        .select(MEASUREMENT_COLUMNS)
        .single();
      if (error) {
        if (error.message === 'invalid_values') {
          await refreshCampaigns();
          throw new InvalidValuesError(parseFieldErrors(error.details));
        }
        throw error;
      }
      // Photos are not stored in the database yet — keep them in memory only.
      const record = { ...fromRow(data), photos: draft.photos || {} };
      setMeasurements((prev) => [record, ...prev]);
      return record;
    },
    [refreshCampaigns, currentUserId],
  );

  // Comments, flags and forum posts are still in memory only; they need a logged-in author.
  const addComment = useCallback((measurementId, body) => {
    if (!currentUserId) return;
    setMeasurements((prev) =>
      prev.map((m) =>
        m.id === measurementId
          ? {
              ...m,
              comments: [
                ...m.comments,
                {
                  id: `c-${measurementId}-${m.comments.length + 1}`,
                  authorId: currentUserId,
                  createdAt: new Date().toISOString(),
                  body,
                },
              ],
            }
          : m,
      ),
    );
  }, [currentUserId]);

  const flagMeasurement = useCallback((measurementId, reason) => {
    if (!currentUserId) return;
    setMeasurements((prev) =>
      prev.map((m) =>
        m.id === measurementId
          ? {
              ...m,
              verification: 'flagged',
              comments: [
                ...m.comments,
                {
                  id: `c-${measurementId}-flag-${Date.now()}`,
                  authorId: currentUserId,
                  createdAt: new Date().toISOString(),
                  body: reason,
                  isFlag: true,
                },
              ],
            }
          : m,
      ),
    );
  }, [currentUserId]);

  const addTopic = useCallback(({ observationId, title, body, category }) => {
    if (!currentUserId) return null;
    const id = `t-new-${Date.now()}`;
    const now = new Date().toISOString();
    setTopics((prev) => [
      {
        id,
        observationId,
        category: category === 'all' ? 'general' : category,
        titleHe: title,
        titleEn: title,
        titleRu: title,
        authorId: currentUserId,
        createdAt: now,
        tags: [],
        posts: [
          {
            id: `${id}-p1`,
            authorId: currentUserId,
            createdAt: now,
            body,
            images: [],
            reactions: {},
            quotedPostId: null,
            verifiedExpert: false,
          },
        ],
      },
      ...prev,
    ]);
    return id;
  }, [currentUserId]);

  const addPost = useCallback((topicId, { body, images = [], quotedPostId = null }) => {
    if (!currentUserId) return;
    setTopics((prev) =>
      prev.map((t) =>
        t.id === topicId
          ? {
              ...t,
              posts: [
                ...t.posts,
                {
                  id: `p-${topicId}-${t.posts.length + 1}`,
                  authorId: currentUserId,
                  createdAt: new Date().toISOString(),
                  body,
                  images,
                  reactions: {},
                  quotedPostId,
                  verifiedExpert: false,
                },
              ],
            }
          : t,
      ),
    );
  }, [currentUserId]);

  const toggleReaction = useCallback((topicId, postId, emoji) => {
    if (!currentUserId) return;
    setTopics((prev) =>
      prev.map((t) =>
        t.id !== topicId
          ? t
          : {
              ...t,
              posts: t.posts.map((p) =>
                p.id !== postId
                  ? p
                  : {
                      ...p,
                      reactions: {
                        ...p.reactions,
                        [emoji]: (p.reactions[emoji] || 0) + 1,
                      },
                    },
              ),
            },
      ),
    );
  }, [currentUserId]);

  const toggleJoin = useCallback((observationId) => {
    setJoined((prev) => {
      const next = new Set(prev);
      if (next.has(observationId)) next.delete(observationId);
      else next.add(observationId);
      return next;
    });
  }, []);

  useEffect(() => {
    loadAuthors(measurements.map((m) => m.userId));
  }, [measurements, loadAuthors]);

  /**
   * Measurements as the UI sees them: `value` = the campaign's primary field value
   * (map colours, charts, stats), null when missing.
   */
  const measurementsView = useMemo(() => {
    const primaryKey = new Map(campaigns.map((c) => [c.id, c.primaryField?.key]));
    return measurements.map((m) => {
      const v = m.values[primaryKey.get(m.observationId)];
      return { ...m, value: typeof v === 'number' ? v : null };
    });
  }, [measurements, campaigns]);

  /** Campaigns with their colour scale (needs the data when the field has no min/max). */
  const campaignsView = useMemo(
    () =>
      campaigns.map((c) => ({
        ...c,
        scale: buildScale(
          c,
          measurementsView.filter((m) => m.observationId === c.id).map((m) => m.value),
        ),
      })),
    [campaigns, measurementsView],
  );

  /** Look up a loaded campaign by id or slug (null while loading / if missing). */
  const getObservation = useCallback(
    (idOrSlug) => campaignsView.find((o) => o.id === idOrSlug || o.slug === idOrSlug) || null,
    [campaignsView],
  );

  const value = useMemo(
    () => ({
      users: USERS,
      currentUser,
      getAuthor,
      isAuthorResolved,
      loadAuthors,
      campaigns: campaignsView,
      campaignsLoading,
      campaignsError,
      reloadCampaigns,
      refreshCampaigns,
      measurements: measurementsView,
      measurementsLoading,
      measurementsError,
      reloadMeasurements,
      topics,
      joined,
      isJoined: (id) => joined.has(id),
      measurementsFor: (obsId) => measurementsView.filter((m) => m.observationId === obsId),
      topicsFor: (obsId) => topics.filter((t) => t.observationId === obsId),
      getTopic: (id) => topics.find((t) => t.id === id) || null,
      getMeasurement: (id) => measurementsView.find((m) => m.id === id) || null,
      getObservation,
      addMeasurement,
      addComment,
      flagMeasurement,
      addTopic,
      addPost,
      toggleReaction,
      toggleJoin,
    }),
    [
      currentUser,
      getAuthor,
      isAuthorResolved,
      loadAuthors,
      campaignsView,
      campaignsLoading,
      campaignsError,
      reloadCampaigns,
      refreshCampaigns,
      getObservation,
      measurementsView,
      measurementsLoading,
      measurementsError,
      reloadMeasurements,
      topics,
      joined,
      addMeasurement,
      addComment,
      flagMeasurement,
      addTopic,
      addPost,
      toggleReaction,
      toggleJoin,
    ],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used within <AppDataProvider>');
  return ctx;
}
