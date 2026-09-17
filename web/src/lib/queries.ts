import type { SampleListParams, StatsParams } from '@sylvan/shared';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from './api';
import { LIVE_POLL_INTERVAL_MS } from './constants';

/**
 * Query keys. Everything that depends on the set of samples lives under `samples` or `stats`, so
 * a new upload can refresh it all with one invalidation (see live.ts).
 */
export const queryKeys = {
  all: ['sylvan'] as const,
  samples: () => [...queryKeys.all, 'samples'] as const,
  sampleList: (params: SampleListParams) => [...queryKeys.samples(), 'list', params] as const,
  sampleInfinite: (params: Omit<SampleListParams, 'cursor'>) =>
    [...queryKeys.samples(), 'infinite', params] as const,
  sample: (id: number) => [...queryKeys.samples(), 'detail', id] as const,
  neighbors: (id: number) => [...queryKeys.samples(), 'neighbors', id] as const,
  stats: (params: StatsParams) => [...queryKeys.all, 'stats', params] as const,
  latest: () => [...queryKeys.all, 'latest'] as const,
};

/**
 * Polling interval for live data. Phase 3 can return `false` here once a WebSocket connection
 * delivers `sample.created` events (which call `handleNewSample`).
 */
export const livePollInterval = () => LIVE_POLL_INTERVAL_MS;

export function useSamples(params: SampleListParams, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.sampleList(params),
    queryFn: ({ signal }) => api.samples(params, signal),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useInfiniteSamples(params: Omit<SampleListParams, 'cursor'>) {
  return useInfiniteQuery({
    queryKey: queryKeys.sampleInfinite(params),
    queryFn: ({ pageParam, signal }) =>
      api.samples(pageParam ? { ...params, cursor: pageParam } : params, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export function useSample(id: number | null) {
  return useQuery({
    queryKey: queryKeys.sample(id ?? -1),
    queryFn: ({ signal }) => api.sample(id ?? -1, signal),
    enabled: id !== null,
    // Samples never change after upload.
    staleTime: Infinity,
  });
}

export function useNeighbors(id: number | null) {
  return useQuery({
    queryKey: queryKeys.neighbors(id ?? -1),
    queryFn: ({ signal }) => api.neighbors(id ?? -1, signal),
    enabled: id !== null,
  });
}

export function useStats(params: StatsParams) {
  return useQuery({
    queryKey: queryKeys.stats(params),
    queryFn: ({ signal }) => api.stats(params, signal),
    placeholderData: keepPreviousData,
    refetchInterval: livePollInterval,
  });
}

/** The newest sample overall, polled so the app notices new uploads. */
export function useLatestSample() {
  return useQuery({
    queryKey: queryKeys.latest(),
    queryFn: async ({ signal }) => (await api.samples({ limit: 1 }, signal)).items[0] ?? null,
    refetchInterval: livePollInterval,
  });
}
