import type { SampleStatusFilter } from '@sylvan/shared';
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import {
  browserTimezone,
  parseRange,
  parseStatus,
  rangeToApi,
  writeRange,
  writeStatus,
  type RangeState,
} from './range';
import { useNow } from './useNow';

const SHARED_PARAMS = ['range', 'from', 'to', 'status'];

/** Global filters stored in the URL so views can be shared, bookmarked and refreshed. */
export function useFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const range = parseRange(searchParams);
  const status = parseStatus(searchParams);
  const rangeKey = `${range.preset}|${range.from ?? ''}|${range.to ?? ''}`;

  // Recomputed at most once a minute for rolling presets, so query keys stay stable.
  const minute = Math.floor(useNow() / 60_000);
  const apiRange = useMemo(
    () => rangeToApi(range, new Date(minute * 60_000)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rangeKey, minute],
  );

  const setRange = useCallback(
    (next: RangeState) => {
      setSearchParams((current) => writeRange(current, next));
    },
    [setSearchParams],
  );

  const setStatus = useCallback(
    (next: SampleStatusFilter) => {
      setSearchParams((current) => writeStatus(current, next));
    },
    [setSearchParams],
  );

  /** `?range=…&status=…` to append to internal links so filters carry across pages. */
  const linkSearch = useMemo(() => {
    const keep = new URLSearchParams();
    for (const key of SHARED_PARAMS) {
      const value = searchParams.get(key);
      if (value) keep.set(key, value);
    }
    const text = keep.toString();
    return text ? `?${text}` : '';
  }, [searchParams]);

  return {
    range,
    status,
    apiRange,
    timezone: browserTimezone(),
    setRange,
    setStatus,
    linkSearch,
    searchParams,
    setSearchParams,
  };
}
