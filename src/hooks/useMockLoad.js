import { useCallback, useEffect, useState } from 'react';

/**
 * Simulate an async data fetch so every screen exercises its
 * loading / error / empty states.
 *
 * @param {Array}  deps        re-run the "fetch" when these change
 * @param {object} opts
 * @param {number} opts.delay  simulated latency in ms
 * @param {boolean} opts.shouldFail  force the error branch (demo toggle)
 */
export function useMockLoad(deps = [], { delay = 550, shouldFail = false } = {}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    const id = setTimeout(() => {
      if (!alive) return;
      setLoading(false);
      setError(shouldFail);
    }, delay);
    return () => {
      alive = false;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  return { loading, error, retry };
}
