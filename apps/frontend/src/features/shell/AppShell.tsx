import { observer } from 'mobx-react-lite';
import type { ReactElement } from 'react';
import { NavLink, Outlet } from 'react-router';

import { messages } from '../../i18n/messages';
import type { ConnectionState } from '../../stores/PantryStore';
import { usePantryStore } from '../../stores/StoreContext';
import { cn } from '../../ui/cn';
import { NAV_ITEMS } from './navigation';
import { NoticeRegion } from './NoticeRegion';

/**
 * The frame around every page: a sidebar on wide screens, a bottom tab bar on
 * narrow ones. Only one of the two navs is displayed at a time, so assistive
 * technology never meets both.
 */
export const AppShell = observer(function AppShell(): ReactElement {
  const pantry = usePantryStore();

  return (
    <div className="min-h-dvh md:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-e border-line bg-surface p-4 md:flex">
        <div className="px-3 pt-4">
          <p className="text-lg font-bold tracking-tight">{messages.app.name}</p>
          {pantry.household !== null && (
            <p className="truncate text-sm text-ink-muted">{pantry.household.name}</p>
          )}
        </div>

        <nav aria-label={messages.nav.label} className="mt-8">
          <ul className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  className={({ isActive }) =>
                    cn(
                      'focus-ring flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-accent-soft font-semibold text-accent'
                        : 'text-ink-muted hover:bg-sunken hover:text-ink',
                    )
                  }
                >
                  <item.icon aria-hidden="true" className="size-5" />
                  {messages.nav[item.labelKey]}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <ConnectionStatus state={pantry.connection} />
      </aside>

      <main className="min-w-0 flex-1 pb-tab-bar md:pb-0">
        <Outlet />
      </main>

      {/* Its links and its safe-area padding add up to `--spacing-tab-bar` (index.css). */}
      <nav
        aria-label={messages.nav.label}
        className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="grid grid-cols-4">
          {NAV_ITEMS.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  cn(
                    'focus-ring flex h-tab-bar-links flex-col items-center justify-center gap-1 text-xs font-medium transition-colors',
                    isActive ? 'text-accent' : 'text-ink-muted hover:text-ink',
                  )
                }
              >
                <item.icon aria-hidden="true" className="size-6" />
                {messages.nav[item.labelKey]}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <NoticeRegion />
    </div>
  );
});

const CONNECTION_DOTS: Record<ConnectionState, string> = {
  idle: 'bg-ink-muted',
  connecting: 'bg-warn',
  online: 'bg-success',
  offline: 'bg-danger',
};

function ConnectionStatus({ state }: { state: ConnectionState }): ReactElement {
  return (
    <p className="mt-auto flex items-center gap-2 px-3 text-xs text-ink-muted">
      <span aria-hidden="true" className={cn('size-2 rounded-full', CONNECTION_DOTS[state])} />
      {messages.connection[state]}
    </p>
  );
}
