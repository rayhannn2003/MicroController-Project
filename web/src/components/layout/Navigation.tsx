import { NavLink } from 'react-router';
import { useFilters } from '../../lib/useFilters';
import { IconGallery, IconOverview, IconTable } from '../ui/Icons';

export const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: IconOverview, end: true },
  { to: '/gallery', label: 'Gallery', icon: IconGallery, end: false },
  { to: '/data', label: 'Data', icon: IconTable, end: false },
];

export function TopNav() {
  const { linkSearch } = useFilters();
  return (
    <nav aria-label="Main" className="hidden md:block">
      <ul className="flex items-center gap-1">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={{ pathname: item.to, search: linkSearch }}
              end={item.end}
              className={({ isActive }) =>
                `inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-brand-soft text-ink'
                    : 'text-ink-muted hover:bg-surface-muted hover:text-ink'
                }`
              }
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function BottomNav() {
  const { linkSearch } = useFilters();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid grid-cols-3">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={{ pathname: item.to, search: linkSearch }}
              end={item.end}
              className={({ isActive }) =>
                `flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
                  isActive ? 'text-brand' : 'text-ink-muted'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`flex h-7 w-12 items-center justify-center rounded-full ${isActive ? 'bg-brand-soft' : ''}`}
                  >
                    <item.icon size={20} />
                  </span>
                  {item.label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
