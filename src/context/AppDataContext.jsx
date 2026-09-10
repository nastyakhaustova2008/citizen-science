import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  MEASUREMENTS,
  TOPICS,
  USERS,
  CURRENT_USER_ID,
  getUser,
  getObservation,
} from '../data/mockData';

/**
 * In-memory application state layered over the mock dataset.
 * New measurements / posts / joins live here for the session only —
 * nothing is persisted, there is no backend.
 */
const AppDataContext = createContext(null);

export function AppDataProvider({ children }) {
  const [measurements, setMeasurements] = useState(MEASUREMENTS);
  const [topics, setTopics] = useState(TOPICS);
  const [joined, setJoined] = useState(() => new Set(['obs-schoolyard-heat', 'obs-dark-skies']));

  const currentUser = getUser(CURRENT_USER_ID);

  const addMeasurement = useCallback((draft) => {
    const id = `m-new-${Date.now()}`;
    const record = {
      id,
      observationId: draft.observationId,
      userId: CURRENT_USER_ID,
      placeLabel: draft.placeLabel || draft.conditions || '—',
      lat: draft.lat,
      lng: draft.lng,
      value: Number(draft.value),
      timestamp: draft.timestamp,
      instrument: draft.instrument,
      conditions: draft.conditions,
      notes: draft.notes || '',
      verification: 'pending',
      photoSeed: draft.photoDataUri ? null : null,
      photoDataUri: draft.photoDataUri || null,
      comments: [],
    };
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
      measurements,
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
      measurements,
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
