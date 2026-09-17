import { useEffect, useEffectEvent, useRef } from 'react';

/** Calls `onVisible` when the returned sentinel element scrolls near the viewport. */
export function useInfiniteScroll(onVisible: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  const notify = useEffectEvent(onVisible);

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) notify();
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [enabled]);

  return ref;
}
