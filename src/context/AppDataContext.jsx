import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { TOPICS, USERS, getUser } from '../data/mockData';
import { METRICS } from '../data/metrics';
import { fieldFromRow, buildScale } from '../lib/fields';
import { supabase } from '../lib/supabase';
import { allCredits, reviewQueue as fetchReviewQueue } from '../lib/labsApi';
import {
  issueMeasurements,
  linkDomains as fetchLinkDomains,
  linkDomainPendingCount,
  reportQueue as fetchCommentReports,
} from '../lib/commentsApi';
import { photoQueue as fetchPhotoQueue } from '../lib/photosApi';
import { avatarPaths as fetchAvatarPaths, avatarQueue as fetchAvatarQueue } from '../lib/avatarsApi';
import { fetchSummary, fromRow, MEASUREMENT_COLUMNS } from '../lib/measurementsApi';
import { fetchAllPaged } from '../lib/paging';
import { useAuth, authorFromProfile, PROFILE_COLUMNS } from './AuthContext';

/**
 * Application state.
 * Campaigns + their field definitions are read from Supabase
 * (`campaigns`, `campaign_fields`, `campaign_field_options`). Admins also receive drafts (RLS);
 * `campaigns` is the published list for the public pages, getObservation() finds drafts too.
 * Labs are written only through the editor RPCs (src/lib/labsApi.js).
 * Measurements are inserted here (`measurements` table; values in `field_values`, jsonb keyed by
 * field key, validated by the database). They are NOT all loaded here (the Data API cuts every
 * response at 1000 rows, audit H5): each screen reads what it needs page by page or aggregated
 * (src/hooks/useMeasurements.js, src/lib/measurementsApi.js). Here: the home page numbers
 * (`summary`, RPC measurement_summary) and `measurementsVersion`, bumped after an insert so
 * open screens re-read.
 * The current user comes from AuthContext (Supabase Auth + profiles); adding measurements
 * requires login and stores the real user id.
 * Authors: real users → profiles (loaded for the ids on screen); seeded demo rows keep mock ids
 * ('u-noa', …) → mock users from mockData, marked kind: 'demo'.
 * Comments on measurements (and "problem" reports = kind 'issue') are in Supabase too (015),
 * read per point by useComments(); here: the flagged mark, the allowed link domains and the
 * admins' counts (reported comments, link domain proposals).
 * Measurement photos are files in Supabase Storage (016): the measurement stores the path, the
 * point panel reads who may see what (photosApi.listPhotos); here: the admins' photo queue.
 * Profile pictures (017): for logged-in users, getAuthor() adds `avatarPath` (only pictures this
 * user may see); here also the admins' picture queue (confirmations, reports).
 * Everything else (topics, posts, joins)
 * still lives in memory over the mock dataset for the session only.
 */
const CAMPAIGN_COLUMNS =
  'id, slug, metric, icon, title_he, title_en, title_ru, desc_he, desc_en, desc_ru, status, region, difficulty, equipment, protocol_url, center_lat, center_lng, zoom, sort_order, form_version, publication, edit_no, equipment_he, equipment_en, equipment_ru, protocol_he, protocol_en, protocol_ru, review_round, submitted_at, published_at, campaign_fields(*, campaign_field_options(*))';

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
    equipmentHe: row.equipment_he || [],
    equipmentEn: row.equipment_en || [],
    equipmentRu: row.equipment_ru || [],
    protocolHe: row.protocol_he || '',
    protocolEn: row.protocol_en || '',
    protocolRu: row.protocol_ru || '',
    protocolUrl: row.protocol_url,
    // draft | in_review | published (step 5). Only admins receive non-published rows (RLS).
    publication: row.publication || 'published',
    editNo: row.edit_no ?? 0,
    reviewRound: row.review_round ?? 0,
    submittedAt: row.submitted_at || null,
    // null on a published lab = published before peer review (step 5b)
    publishedAt: row.published_at || null,
    // Drafts may have no map center yet: the maps get a default view (centerSet = false).
    centerSet: row.center_lat != null && row.center_lng != null,
    center: row.center_lat != null && row.center_lng != null ? [row.center_lat, row.center_lng] : [31.4, 34.9],
    zoom: row.zoom,
    formVersion: row.form_version,
    fields,
    primaryField: fields.find((f) => f.isPrimary && !f.archived) || null,
  };
}

async function fetchCampaigns() {
  if (!supabase) throw new Error('Supabase is not configured');
  // Every lab, page by page (never one unbounded select — src/lib/paging.js).
  const { rows } = await fetchAllPaged((o) =>
    supabase
      .from('campaigns')
      .select(CAMPAIGN_COLUMNS, o)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true }),
  );
  return rows.map((row) => {
    if (row.metric && !METRICS[row.metric]) {
      console.warn(`[campaigns] "${row.id}": unknown metric preset "${row.metric}", using default colours`);
    }
    return campaignFromRow(row);
  });
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

const EMPTY = [];

/**
 * An admin queue (audit M5): { items, loading, error, reload, reset }. A failed load never looks
 * like "nothing waiting": `error` stays set (the screen shows an error + retry) and the last list
 * is kept. Disabled (not an admin) → empty, not loading.
 */
function useQueue(fetcher, enabled, empty) {
  const [state, setState] = useState({ items: empty, loading: enabled, error: false });
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const items = await fetcher();
      if (n === seq.current) setState({ items, loading: false, error: false });
    } catch (err) {
      console.error('[queue] load failed', err);
      if (n === seq.current) setState((s) => ({ ...s, loading: false, error: true }));
    }
  }, [fetcher]);
  const reset = useCallback(() => {
    seq.current += 1;
    setState({ items: empty, loading: false, error: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { ...state, reload, reset };
}

export function AppDataProvider({ children }) {
  const [campaigns, setCampaigns] = useState([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [campaignsError, setCampaignsError] = useState(false);
  const [campaignsNonce, setCampaignsNonce] = useState(0);
  // Home page numbers per lab (measurement_summary, 019) and the "re-read measurements" counter.
  const [summary, setSummary] = useState({ total: 0, labs: {} });
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState(false);
  const [measurementsVersion, setMeasurementsVersion] = useState(0);
  const [topics, setTopics] = useState(TOPICS);
  // "Join" is a demo, hidden by FEATURES.join (src/lib/features.js); nobody starts as joined (audit M7).
  const [joined, setJoined] = useState(() => new Set());

  const { currentUser, session } = useAuth();
  const currentUserId = currentUser?.id ?? null;
  // Profiles (usernames) are for logged-in users only (audit H2, migration 020).
  const loggedIn = Boolean(session);
  // Admins see drafts: re-read campaigns when that changes (login / logout / role granted).
  const seesDrafts = ['admin', 'main_admin', 'owner'].includes(currentUser?.role);

  // Profiles of real users whose ids are on screen: id → author, or null (no such profile).
  // Logged-in users only: logged out, nothing is loaded and getAuthor() knows only demo authors.
  const [authors, setAuthors] = useState({});
  const requestedAuthors = useRef(new Set());
  useEffect(() => {
    if (loggedIn) return;
    requestedAuthors.current = new Set();
    setAuthors({});
  }, [loggedIn]);

  const loadAuthors = useCallback(async (ids) => {
    if (!supabase || !loggedIn) return;
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
  }, [loggedIn]);

  /** Re-read these profiles (after an admin renamed them or changed their role). */
  const refreshAuthors = useCallback(
    (ids) => {
      ids.forEach((id) => requestedAuthors.current.delete(id));
      return loadAuthors(ids);
    },
    [loadAuthors],
  );

  /** Author of a measurement / comment / post: real profile, demo (mock) user, or null (unknown). */
  // Profile pictures of the authors on screen (logged-in users only): id → path | null.
  const [avatarPaths, setAvatarPaths] = useState({});
  const requestedAvatars = useRef(new Set());
  const loadAvatars = useCallback(
    async (ids) => {
      if (!supabase || !currentUserId) return;
      const todo = [...new Set(ids)].filter((id) => UUID_RE.test(id) && !requestedAvatars.current.has(id));
      if (todo.length === 0) return;
      todo.forEach((id) => requestedAvatars.current.add(id));
      for (let i = 0; i < todo.length; i += 200) {
        const chunk = todo.slice(i, i + 200);
        try {
          const paths = await fetchAvatarPaths(chunk);
          setAvatarPaths((prev) => {
            const next = { ...prev };
            for (const id of chunk) next[id] = paths[id] || null;
            return next;
          });
        } catch {
          chunk.forEach((id) => requestedAvatars.current.delete(id));
        }
      }
    },
    [currentUserId],
  );
  /** Re-read these users' pictures (after moderation / confirmation). */
  const refreshAvatars = useCallback(
    (ids) => {
      ids.forEach((id) => requestedAvatars.current.delete(id));
      return loadAvatars(ids);
    },
    [loadAvatars],
  );
  // Login / logout: what may be seen changes — start over, then load the authors already known.
  useEffect(() => {
    requestedAvatars.current = new Set();
    setAvatarPaths({});
    if (currentUserId) loadAvatars(Object.keys(authors));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, loadAvatars]);
  useEffect(() => {
    loadAvatars(Object.keys(authors));
  }, [authors, loadAvatars]);
  const authorsWithAvatars = useMemo(() => {
    const out = {};
    for (const [id, a] of Object.entries(authors)) out[id] = a ? { ...a, avatarPath: avatarPaths[id] || null } : a;
    return out;
  }, [authors, avatarPaths]);

  const getAuthor = useCallback(
    (id) => {
      if (!id) return null;
      if (currentUser && id === currentUser.id) return currentUser;
      if (authorsWithAvatars[id]) return authorsWithAvatars[id];
      const mock = getUser(id);
      return mock ? { ...mock, kind: 'demo' } : null;
    },
    [authorsWithAvatars, currentUser],
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
  }, [campaignsNonce, seesDrafts]);

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

  // Public "by …" line of reviewed labs for the home cards ({campaignId: {fullName, workplace}}).
  const [credits, setCredits] = useState({});
  useEffect(() => {
    let alive = true;
    allCredits()
      .then((map) => alive && setCredits(map))
      .catch(() => {}); // cards simply show no credit line
    return () => {
      alive = false;
    };
  }, [campaignsNonce, campaigns]);

  // Labs waiting for review (admins): the list, and the badge = the ones I can review now.
  const reviewQ = useQueue(fetchReviewQueue, seesDrafts, EMPTY);
  const { items: reviewQueue, reload: reloadReviewQueue, reset: resetReviewQueue } = reviewQ;
  useEffect(() => {
    if (seesDrafts) reloadReviewQueue();
    else resetReviewQueue();
  }, [seesDrafts, reloadReviewQueue, resetReviewQueue]);
  const reviewCount = reviewQueue.filter((r) => r.myState === 'can_review').length;

  // Comments (015). Logged-in users: allowed link domains (null = not loaded: no link is
  // clickable, the form leaves the domain check to the server) + measurements with a "problem" report.
  const [linkDomains, setLinkDomains] = useState(null);
  const reloadLinkDomains = useCallback(async () => {
    try {
      setLinkDomains(await fetchLinkDomains());
    } catch {
      setLinkDomains(null);
    }
  }, []);
  const [issueIds, setIssueIds] = useState(() => new Set());
  const reloadIssues = useCallback(async () => {
    try {
      setIssueIds(new Set(await issueMeasurements()));
    } catch {
      setIssueIds(new Set());
    }
  }, []);
  useEffect(() => {
    if (currentUserId) {
      reloadLinkDomains();
      reloadIssues();
    } else {
      setLinkDomains(null);
      setIssueIds(new Set());
    }
  }, [currentUserId, reloadLinkDomains, reloadIssues]);

  // Admins: reported comments I may moderate; main admins / owner: pending link domain proposals.
  const reportsQ = useQueue(fetchCommentReports, seesDrafts, EMPTY);
  const { items: commentReports, reload: reloadCommentReports, reset: resetCommentReports } = reportsQ;
  // Admins: measurement photos waiting for approval / reported, on labs I moderate (016).
  const photoQ = useQueue(fetchPhotoQueue, seesDrafts, EMPTY);
  const { items: photoQueue, reload: reloadPhotoQueue, reset: resetPhotoQueue } = photoQ;
  const proposalsQ = useQueue(linkDomainPendingCount, seesDrafts, 0);
  const { items: linkProposalCount, reload: reloadLinkProposals, reset: resetLinkProposals } = proposalsQ;
  useEffect(() => {
    if (seesDrafts) {
      reloadCommentReports();
      reloadPhotoQueue();
      reloadLinkProposals();
    } else {
      resetCommentReports();
      resetPhotoQueue();
      resetLinkProposals();
    }
  }, [seesDrafts, currentUserId, reloadCommentReports, reloadPhotoQueue, reloadLinkProposals,
      resetCommentReports, resetPhotoQueue, resetLinkProposals]);
  const commentReportCount = commentReports.length;
  const photoQueueCount = photoQueue.length;
  // Admins: pictures waiting for me (admin photos to confirm; reports for main admins / owner).
  const avatarQ = useQueue(fetchAvatarQueue, seesDrafts, EMPTY);
  const { items: avatarQueue, reload: reloadAvatarQueue, reset: resetAvatarQueue } = avatarQ;
  useEffect(() => {
    if (seesDrafts) reloadAvatarQueue();
    else resetAvatarQueue();
  }, [seesDrafts, currentUserId, reloadAvatarQueue, resetAvatarQueue]);
  const avatarQueueCount = avatarQueue.length;
  // Everything waiting for this admin (header badge).
  const adminTodoCount = reviewCount + commentReportCount + photoQueueCount + avatarQueueCount + linkProposalCount;
  const queueStatus = useMemo(
    () => ({
      review: { loading: reviewQ.loading, error: reviewQ.error },
      commentReports: { loading: reportsQ.loading, error: reportsQ.error },
      photos: { loading: photoQ.loading, error: photoQ.error },
      avatars: { loading: avatarQ.loading, error: avatarQ.error },
      linkProposals: { loading: proposalsQ.loading, error: proposalsQ.error },
    }),
    [reviewQ.loading, reviewQ.error, reportsQ.loading, reportsQ.error, photoQ.loading, photoQ.error,
      avatarQ.loading, avatarQ.error, proposalsQ.loading, proposalsQ.error],
  );

  useEffect(() => {
    let alive = true;
    setSummaryLoading(true);
    setSummaryError(false);
    fetchSummary()
      .then((data) => alive && setSummary(data))
      .catch((err) => {
        if (!alive) return;
        console.error('[measurements] summary failed', err);
        setSummaryError(true);
      })
      .finally(() => alive && setSummaryLoading(false));
    return () => {
      alive = false;
    };
  }, [measurementsVersion]);

  /** Re-read everything measurement-related (home numbers + the open screens' hooks). */
  const reloadMeasurements = useCallback(() => setMeasurementsVersion((n) => n + 1), []);

  /**
   * Insert into Supabase; resolves with the saved record.
   * draft: { id, observationId, lat, lng, placeLabel, timestamp, values } — photo values are
   * Storage paths already uploaded by the wizard; `id` is made once per wizard run (audit L3):
   * if it already exists and is mine, the first try was saved but its answer was lost → success.
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
          ...(draft.id ? { id: draft.id } : {}),
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
      if (error && draft.id) {
        // Already saved by an earlier try of this same measurement (its answer was lost)? The retry
        // then fails — usually 23505 (same id), or earlier in the trigger (photo_taken: its photo is
        // already used; rate_limited). The id is unique per wizard run, so "it exists and is mine"
        // means saved.
        const { data: saved } = await supabase
          .from('measurements')
          .select(MEASUREMENT_COLUMNS)
          .eq('id', draft.id)
          .eq('user_id', currentUserId)
          .maybeSingle();
        if (saved) {
          setMeasurementsVersion((n) => n + 1);
          return fromRow(saved);
        }
      }
      if (error) {
        if (error.message === 'invalid_values') {
          await refreshCampaigns();
          throw new InvalidValuesError(parseFieldErrors(error.details));
        }
        throw error;
      }
      const record = fromRow(data);
      setMeasurementsVersion((n) => n + 1);
      return record;
    },
    [refreshCampaigns, currentUserId],
  );

  // Forum posts are still in memory only; they need a logged-in author.
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

  /**
   * A measurement as the UI sees it: `value` = the campaign's primary field value (map colours,
   * charts, stats; null when missing) and "flagged" when it has a visible "problem" comment.
   */
  const viewMeasurement = useCallback(
    (m) => {
      const key = campaigns.find((c) => c.id === m.observationId)?.primaryField?.key;
      const v = key ? m.values?.[key] : undefined;
      return {
        ...m,
        value: typeof v === 'number' ? v : null,
        verification: issueIds.has(m.id) ? 'flagged' : m.verification,
      };
    },
    [campaigns, issueIds],
  );

  /** Campaigns with their colour scale (min/max of the data when the field has none). */
  const campaignsView = useMemo(
    () =>
      campaigns.map((c) => {
        const l = summary.labs[c.id];
        return { ...c, scale: buildScale(c, l ? [l.min, l.max] : []) };
      }),
    [campaigns, summary],
  );

  /** Published labs only: home page, counters, filters. */
  const publishedView = useMemo(
    () => campaignsView.filter((c) => c.publication === 'published'),
    [campaignsView],
  );

  /** Look up a loaded campaign by id or slug (null while loading / if missing). Drafts too (admins). */
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
      refreshAuthors,
      refreshAvatars,
      campaigns: publishedView,
      allCampaigns: campaignsView,
      credits,
      reviewQueue,
      reviewCount,
      reloadReviewQueue,
      linkDomains,
      reloadLinkDomains,
      reloadIssues,
      commentReports,
      commentReportCount,
      reloadCommentReports,
      photoQueue,
      photoQueueCount,
      reloadPhotoQueue,
      avatarQueue,
      avatarQueueCount,
      reloadAvatarQueue,
      linkProposalCount,
      reloadLinkProposals,
      adminTodoCount,
      queueStatus,
      campaignsLoading,
      campaignsError,
      reloadCampaigns,
      refreshCampaigns,
      summary,
      summaryLoading,
      summaryError,
      labSummary: (id) => summary.labs[id] || { n: 0, participants: 0, min: null, max: null, cells: [], cellsTotal: 0 },
      measurementsVersion,
      reloadMeasurements,
      viewMeasurement,
      issueIds,
      topics,
      joined,
      isJoined: (id) => joined.has(id),
      topicsFor: (obsId) => topics.filter((t) => t.observationId === obsId),
      getTopic: (id) => topics.find((t) => t.id === id) || null,
      getObservation,
      addMeasurement,
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
      refreshAuthors,
      refreshAvatars,
      campaignsView,
      publishedView,
      credits,
      reviewQueue,
      reviewCount,
      reloadReviewQueue,
      linkDomains,
      reloadLinkDomains,
      reloadIssues,
      commentReports,
      commentReportCount,
      reloadCommentReports,
      photoQueue,
      photoQueueCount,
      reloadPhotoQueue,
      avatarQueue,
      avatarQueueCount,
      reloadAvatarQueue,
      linkProposalCount,
      reloadLinkProposals,
      adminTodoCount,
      queueStatus,
      campaignsLoading,
      campaignsError,
      reloadCampaigns,
      refreshCampaigns,
      getObservation,
      summary,
      summaryLoading,
      summaryError,
      measurementsVersion,
      reloadMeasurements,
      viewMeasurement,
      issueIds,
      topics,
      joined,
      addMeasurement,
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
