'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// ── Cache mémoire process-level (survit aux re-renders, resetté au reload) ───
const memCache = new Map<string, { data: any; ts: number }>();

interface UseCacheOptions {
  ttl?:       number;  // Time-to-live en ms (défaut : 5 min)
  storage?:   'memory' | 'session';  // memory = plus rapide, session = survit navigation
  key:        string;
  fetcher:    () => Promise<any>;
  enabled?:   boolean;
}

interface UseCacheResult<T> {
  data:        T | null;
  loading:     boolean;
  error:       string | null;
  refresh:     () => Promise<void>;
  invalidate:  () => void;
}

// ── useCache : hook de cache avec TTL et stockage configurable ───────────────
export function useCache<T = any>({
  ttl     = 5 * 60_000,   // 5 minutes par défaut
  storage = 'memory',
  key,
  fetcher,
  enabled = true,
}: UseCacheOptions): UseCacheResult<T> {

  const [data,    setData]    = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const abortRef              = useRef<AbortController>();

  const getFromCache = useCallback((): T | null => {
    const k = `cache:${key}`;
    if (storage === 'memory') {
      const e = memCache.get(k);
      return e && (Date.now() - e.ts < ttl) ? e.data : null;
    } else {
      try {
        const raw = sessionStorage.getItem(k);
        if (!raw) return null;
        const { data: d, ts } = JSON.parse(raw);
        return (Date.now() - ts < ttl) ? d : null;
      } catch { return null; }
    }
  }, [key, storage, ttl]);

  const setToCache = useCallback((d: any) => {
    const k = `cache:${key}`;
    const entry = { data: d, ts: Date.now() };
    if (storage === 'memory') {
      memCache.set(k, entry);
    } else {
      try { sessionStorage.setItem(k, JSON.stringify(entry)); } catch {}
    }
  }, [key, storage]);

  const invalidate = useCallback(() => {
    const k = `cache:${key}`;
    memCache.delete(k);
    try { sessionStorage.removeItem(k); } catch {}
    setData(null);
  }, [key]);

  const fetch_ = useCallback(async () => {
    if (!enabled) return;

    // Vérifier le cache d'abord
    const cached = getFromCache();
    if (cached !== null) { setData(cached); return; }

    // Annuler la requête précédente
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setError(null);

    try {
      const result = await fetcher();
      setToCache(result);
      setData(result);
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setError(e?.message ?? 'Erreur de chargement');
      }
    } finally {
      setLoading(false);
    }
  }, [enabled, fetcher, getFromCache, setToCache]);

  useEffect(() => {
    fetch_();
    return () => { abortRef.current?.abort(); };
  }, [key]); // Re-fetch si la clé change

  return { data, loading, error, refresh: fetch_, invalidate };
}

// ── invalidateCache — utility pour vider le cache depuis n'importe où ────────
export function invalidateCache(key: string) {
  memCache.delete(`cache:${key}`);
  try { sessionStorage.removeItem(`cache:${key}`); } catch {}
}

// ── prefetch — précharger en arrière-plan ─────────────────────────────────────
export async function prefetch(key: string, fetcher: () => Promise<any>, ttl = 5 * 60_000) {
  const existing = memCache.get(`cache:${key}`);
  if (existing && Date.now() - existing.ts < ttl) return; // déjà frais
  try {
    const data = await fetcher();
    memCache.set(`cache:${key}`, { data, ts: Date.now() });
  } catch {}
}
