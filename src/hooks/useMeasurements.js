import { useEffect, useMemo, useState } from 'react';
import { useAppData } from '../context/AppDataContext';
import {
  fetchLabPage,
  fetchLabPoints,
  fetchLabStats,
  fetchMeasurement,
  fetchUserPoints,
} from '../lib/measurementsApi';

/**
 * Measurement reads for one screen (audit H5 — see src/lib/paging.js). Each hook reloads when
 * its inputs change and after a new measurement was added (`measurementsVersion`).
 * → { data, loading, error, reload }. While reloading, the previous data stays (no flicker).
 */
function useLoad(load, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: false });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    let alive = true;
    setState((s) => ({ data: s.data, loading: true, error: false }));
    load(ctrl.signal).then(
      (data) => alive && setState({ data, loading: false, error: false }),
      (err) => {
        if (!alive) return;
        console.error('[measurements] load failed', err);
        setState({ data: null, loading: false, error: true });
      },
    );
    return () => {
      alive = false;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  return useMemo(() => ({ ...state, reload: () => setNonce((n) => n + 1) }), [state]);
}

/** Map points of a lab (lean rows, up to MAP_CAP): data = { points, total, capped }. */
export function useLabPoints(campaign) {
  const { measurementsVersion, issueIds } = useAppData();
  const res = useLoad((signal) => fetchLabPoints(campaign, { signal }), [campaign.id, campaign.primaryField?.key, measurementsVersion]);
  // A visible "problem" comment marks the point as flagged (logged-in users).
  const data = useMemo(
    () =>
      res.data && {
        ...res.data,
        points: res.data.points.map((p) => (issueIds.has(p.id) ? { ...p, verification: 'flagged' } : p)),
      },
    [res.data, issueIds],
  );
  return { ...res, data };
}

// Stats are shared by the Data and Charts tabs: keep the last few results (per lab, step, version).
const statsCache = new Map();

/** measurement_lab_stats of a lab (complete, aggregated on the server): data = see fetchLabStats. */
export function useLabStats(campaign) {
  const { measurementsVersion } = useAppData();
  const step = campaign.scale?.histogramStep || 1;
  return useLoad(() => {
    const key = `${campaign.id}|${step}|${measurementsVersion}`;
    if (!statsCache.has(key)) {
      const p = fetchLabStats(campaign.id, step);
      p.catch(() => statsCache.delete(key));
      statsCache.set(key, p);
      if (statsCache.size > 20) statsCache.delete(statsCache.keys().next().value);
    }
    return statsCache.get(key);
  }, [campaign.id, step, measurementsVersion]);
}

/** One page of the data table: data = { rows, total }. `state` must be memoised by the caller. */
export function useLabPage(campaign, state, page) {
  const { measurementsVersion, viewMeasurement } = useAppData();
  const res = useLoad((signal) => fetchLabPage(campaign, state, page, { signal }), [campaign.id, state, page, measurementsVersion]);
  const data = useMemo(
    () => res.data && { ...res.data, rows: res.data.rows.map(viewMeasurement) },
    [res.data, viewMeasurement],
  );
  return { ...res, data };
}

/** The full row of one measurement (point panel): data = Measurement | null. */
export function useMeasurement(id) {
  const { measurementsVersion, viewMeasurement } = useAppData();
  const res = useLoad(() => (id ? fetchMeasurement(id) : Promise.resolve(null)), [id, measurementsVersion]);
  const data = useMemo(() => (res.data ? viewMeasurement(res.data) : null), [res.data, viewMeasurement]);
  return { ...res, data };
}

/** One user's measurements (up to PROFILE_CAP): data = { rows, total, capped }. */
export function useUserPoints(userId) {
  const { measurementsVersion, viewMeasurement } = useAppData();
  const res = useLoad((signal) => fetchUserPoints(userId, { signal }), [userId, measurementsVersion]);
  const data = useMemo(
    () => res.data && { ...res.data, rows: res.data.rows.map(viewMeasurement) },
    [res.data, viewMeasurement],
  );
  return { ...res, data };
}
