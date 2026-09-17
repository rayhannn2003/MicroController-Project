import type { Sample } from '@sylvan/shared';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useRef } from 'react';
import { queryKeys, useLatestSample } from './queries';

/**
 * Called whenever a new sample is known to exist. Refreshes every sample-dependent query.
 * Phase 3: call this from the WebSocket `sample.created` handler (optionally after
 * `queryClient.setQueryData(queryKeys.latest(), sample)`), and polling can be turned off.
 */
export async function handleNewSample(queryClient: QueryClient, sample: Sample) {
  queryClient.setQueryData(queryKeys.sample(sample.id), sample);
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.samples() }),
    queryClient.invalidateQueries({ queryKey: [...queryKeys.all, 'stats'] }),
  ]);
}

/**
 * Watches the newest sample and reports uploads that arrive while the app is open.
 * The first result only sets the baseline, so opening the app never shows a toast.
 */
export function useNewSampleWatcher(onNewSample: (sample: Sample) => void) {
  const queryClient = useQueryClient();
  const latest = useLatestSample();
  const lastSeenId = useRef<number | null | undefined>(undefined);
  const notify = useEffectEvent(onNewSample);

  const sample = latest.data;
  useEffect(() => {
    if (sample === undefined) return;
    const previous = lastSeenId.current;
    lastSeenId.current = sample?.id ?? null;
    if (previous === undefined || !sample) return;
    if (previous === null || sample.id > previous) {
      void handleNewSample(queryClient, sample);
      notify(sample);
    }
  }, [sample, queryClient]);

  return latest;
}
