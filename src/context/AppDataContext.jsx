import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { TOPICS, USERS, CURRENT_USER_ID, getUser } from '../data/mockData';
import { METRICS } from '../data/metrics';
import { supabase } from '../lib/supabase';

/**
 * Application state.
 * Campaigns are read from Supabase (`campaigns` table, read-only for now).
 * Measurements are read from / inserted into Supabase (`measurements` table).
 * Everything else (topics, posts, joins, point comments, flags, photos)
 * still lives in memory over the mock dataset for the session only.
 */
const CAMPAIGN_COLUMNS =
  'id, slug, metric, icon, title_he, title_en, title_ru, desc_he, desc_en, desc_ru, status, region, difficulty, equipment, protocol_url, center_lat, center_lng, zoom, sort_order';

/** DB row (snake_case) → the Observation (campaign) shape the UI uses (see mockData.js). */
function campaignFromRow(row) {
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
  };
}

const MEASUREMENT_COLUMNS =
  'id, observation_id, user_id, place_label, lat, lng, value, measured_at, instrument, conditions, notes, verification, photo_seed';

/** DB row (snake_case) → the Measurement shape the UI uses (see mockData.js). */
function fromRow(row) {
  return {
    id: row.id,
    observationId: row.observation_id,
    userId: row.user_id,
    placeLabel: row.place_label,
    lat: row.lat,
    lng: row.lng,
    value: row.value,
    timestamp: row.measured_at,
    instrument: row.instrument,
    conditions: row.conditions,
    notes: row.notes,
    verification: row.verification,
    photoSeed: row.photo_seed,
    comments: [],
  };
}

const AppDataContext = createContext(null);

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

  const currentUser = getUser(CURRENT_USER_ID);

  useEffect(() => {
    let alive = true;
    setCampaignsLoading(true);
    setCampaignsError(false);
    (async () => {
      try {
        if (!supabase) throw new Error('Supabase is not configured');
        const { data, error } = await supabase
          .from('campaigns')
          .select(CAMPAIGN_COLUMNS)
          .order('sort_order', { ascending: true })
          .order('id', { ascending: true });
        if (error) throw error;
        if (!alive) return;
        // Metrics still live in code: skip campaigns whose metric the UI can't render.
        const known = data.filter((row) => {
          if (METRICS[row.metric]) return true;
          console.warn(`[campaigns] skipping "${row.id}": unknown metric "${row.metric}"`);
          return false;
        });
        setCampaigns(known.map(campaignFromRow));
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

  /** Look up a loaded campaign by id or slug (null while loading / if missing). */
  const getObservation = useCallback(
    (idOrSlug) => campaigns.find((o) => o.id === idOrSlug || o.slug === idOrSlug) || null,
    [campaigns],
  );

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
                  photoDataUri: old.photoDataUri,
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

  /** Insert into Supabase; resolves with the saved record, throws on failure. */
  const addMeasurement = useCallback(async (draft) => {
    if (!supabase) throw new Error('Supabase is not configured');
    const { data, error } = await supabase
      .from('measurements')
      .insert({
        observation_id: draft.observationId,
        user_id: CURRENT_USER_ID,
        place_label: draft.placeLabel || draft.conditions || '—',
        lat: draft.lat,
        lng: draft.lng,
        value: Number(draft.value),
        measured_at: draft.timestamp,
        instrument: draft.instrument,
        conditions: draft.conditions,
        notes: draft.notes || '',
      })
      .select(MEASUREMENT_COLUMNS)
      .single();
    if (error) throw error;
    // Photos are not stored in the database yet — keep them in memory only.
    const record = { ...fromRow(data), photoDataUri: draft.photoDataUri || null };
    setMeasurements((prev) => [record, ...prev]);
    return record;
  }, []);

  const addComment = useCallback((measurementId, body) => {
    setMeasurements((prev) =>
      prev.map((m) =>
        m.id === measurementId
          ? {
              ...m,
              comments: [
                ...m.comments,
                {
                  id: `c-${measurementId}-${m.comments.length + 1}`,
                  authorId: CURRENT_USER_ID,
                  createdAt: new Date().toISOString(),
                  body,
                },
              ],
            }
          : m,
      ),
    );
  }, []);

  const flagMeasurement = useCallback((measurementId, reason) => {
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
                  authorId: CURRENT_USER_ID,
                  createdAt: new Date().toISOString(),
                  body: reason,
                  isFlag: true,
                },
              ],
            }
          : m,
      ),
    );
  }, []);

  const addTopic = useCallback(({ observationId, title, body, category }) => {
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
        authorId: CURRENT_USER_ID,
        createdAt: now,
        tags: [],
        posts: [
          {
            id: `${id}-p1`,
            authorId: CURRENT_USER_ID,
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
  }, []);

  const addPost = useCallback((topicId, { body, images = [], quotedPostId = null }) => {
    setTopics((prev) =>
      prev.map((t) =>
        t.id === topicId
          ? {
              ...t,
              posts: [
                ...t.posts,
                {
                  id: `p-${topicId}-${t.posts.length + 1}`,
                  authorId: CURRENT_USER_ID,
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
  }, []);

  const toggleReaction = useCallback((topicId, postId, emoji) => {
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
  }, []);

  const toggleJoin = useCallback((observationId) => {
    setJoined((prev) => {
      const next = new Set(prev);
      if (next.has(observationId)) next.delete(observationId);
      else next.add(observationId);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      users: USERS,
      currentUser,
      campaigns,
      campaignsLoading,
      campaignsError,
      reloadCampaigns,
      measurements,
      measurementsLoading,
      measurementsError,
      reloadMeasurements,
      topics,
      joined,
      isJoined: (id) => joined.has(id),
      measurementsFor: (obsId) => measurements.filter((m) => m.observationId === obsId),
      topicsFor: (obsId) => topics.filter((t) => t.observationId === obsId),
      getTopic: (id) => topics.find((t) => t.id === id) || null,
      getMeasurement: (id) => measurements.find((m) => m.id === id) || null,
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
      campaigns,
      campaignsLoading,
      campaignsError,
      reloadCampaigns,
      getObservation,
      measurements,
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
