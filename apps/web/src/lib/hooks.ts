'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from './api';

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Minimal SWR-style client fetch hook. All data fetching is client-side so the
 * app builds and prerenders without the API running.
 */
export function useApi<T>(fn: () => Promise<T>, deps: readonly unknown[], enabled = true): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setLoading(true);
    setError(null);
    fn()
      .then((d) => {
        if (live) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (live) {
          setError(errorMessage(e));
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, [enabled, tick, ...deps]);

  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}
