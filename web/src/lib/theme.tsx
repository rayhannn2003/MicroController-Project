import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'sylvan-theme';
const THEME_COLORS: Record<ResolvedTheme, string> = { light: '#f6f4ee', dark: '#0e1511' };

function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function writePreference(preference: ThemePreference) {
  try {
    if (preference === 'system') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the choice lasts this visit.
  }
}

const systemQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [systemDark, setSystemDark] = useState(() => systemQuery().matches);

  useEffect(() => {
    const query = systemQuery();
    const onChange = (event: MediaQueryListEvent) => {
      setSystemDark(event.matches);
    };
    query.addEventListener('change', onChange);
    return () => {
      query.removeEventListener('change', onChange);
    };
  }, []);

  const resolved: ResolvedTheme =
    preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  // Applied during render (idempotent) so children reading CSS tokens see the new theme.
  document.documentElement.classList.toggle('dark', resolved === 'dark');

  useEffect(() => {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', THEME_COLORS[resolved]);
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    writePreference(next);
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}

/** Reads the current theme's chart colors from the CSS tokens. */
export function useThemeColors() {
  const { resolved } = useTheme();
  return useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const read = (name: string) => style.getPropertyValue(name).trim();
    return {
      temperature: read('--temp'),
      humidity: read('--humidity'),
      lux: read('--light'),
      ok: read('--ok'),
      failed: read('--failed'),
      grid: read('--chart-grid'),
      ink: read('--ink'),
      inkMuted: read('--ink-muted'),
      surface: read('--surface'),
      border: read('--border'),
      brand: read('--brand'),
      brandSoft: read('--brand-soft'),
      warnSoft: read('--warn-soft'),
      theme: resolved,
    };
  }, [resolved]);
}
