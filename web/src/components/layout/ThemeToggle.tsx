import { useTheme, type ThemePreference } from '../../lib/theme';
import { IconMonitor, IconMoon, IconSun } from '../ui/Icons';

const NEXT: Record<ThemePreference, ThemePreference> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
};
const LABEL: Record<ThemePreference, string> = {
  system: 'System theme',
  light: 'Light theme',
  dark: 'Dark theme',
};

export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const Icon = preference === 'light' ? IconSun : preference === 'dark' ? IconMoon : IconMonitor;
  return (
    <button
      type="button"
      onClick={() => {
        setPreference(NEXT[preference]);
      }}
      className="inline-flex size-11 items-center justify-center rounded-md text-ink hover:bg-surface-muted"
      title={`${LABEL[preference]} (click for ${LABEL[NEXT[preference]].toLowerCase()})`}
    >
      <Icon />
      <span className="sr-only">
        {LABEL[preference]}. Switch to {LABEL[NEXT[preference]].toLowerCase()}
      </span>
    </button>
  );
}
