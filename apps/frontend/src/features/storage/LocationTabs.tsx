import type { PantryLocation } from '@pantry-pal/shared';
import { Plus } from 'lucide-react';
import { useEffect, useRef, type ReactElement } from 'react';
import { NavLink, type Path } from 'react-router';

import { formatNumber } from '../../i18n/format';
import { messages } from '../../i18n/messages';
import { cn } from '../../ui/cn';
import { IconButton } from '../../ui/IconButton';
import { locationName } from './locationName';

interface LocationTabsProps {
  locations: readonly PantryLocation[];
  activeLocationId: string;
  link: (locationId: string) => Partial<Path>;
  /** Present while searching: how many matches each location holds. */
  matchCounts: ReadonlyMap<string, number> | null;
  /** Opens the locations editor, where locations are added too. */
  onEditLocations: () => void;
}

/**
 * The household's locations, in their stored order, as links.
 *
 * Links rather than ARIA tabs: each location is its own URL, so this is
 * navigation (`aria-current="page"` comes from `NavLink`), and the back button
 * walks through the locations visited.
 */
export function LocationTabs({
  locations,
  activeLocationId,
  link,
  matchCounts,
  onEditLocations,
}: LocationTabsProps): ReactElement {
  const listRef = useRef<HTMLUListElement>(null);

  // With many locations the row scrolls; keep the active one in view.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-location-id="${CSS.escape(activeLocationId)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeLocationId]);

  return (
    <nav
      aria-label={messages.storage.locations}
      className="flex items-center gap-2 px-4 pb-3 md:px-8"
    >
      <ul ref={listRef} className="scrollbar-none flex min-w-0 flex-1 gap-2 overflow-x-auto p-1">
        {locations.map((location) => {
          const count = matchCounts?.get(location.id) ?? 0;

          return (
            <li key={location.id} data-location-id={location.id} className="shrink-0">
              <NavLink
                to={link(location.id)}
                className={({ isActive }) =>
                  cn(
                    'focus-ring flex h-9 items-center gap-2 rounded-full px-4 text-sm whitespace-nowrap transition-colors',
                    isActive
                      ? 'font-semibold ring-2 ring-on-accent ring-inset md:bg-accent md:text-on-accent md:ring-0'
                      : 'text-on-accent/85 hover:bg-on-accent/10 md:text-ink-muted md:hover:bg-sunken md:hover:text-ink',
                  )
                }
              >
                {locationName(location)}
                {matchCounts !== null && (
                  <>
                    <span
                      aria-hidden="true"
                      className="rounded-full bg-current/15 px-1.5 text-xs tabular-nums"
                    >
                      {formatNumber(count)}
                    </span>
                    <span className="sr-only">{messages.storage.matchCount(count)}</span>
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>

      <IconButton
        icon={Plus}
        label={messages.storage.editLocations}
        onClick={onEditLocations}
        className="border border-on-accent/40 hover:bg-on-accent/10 md:border-line md:text-ink-muted md:hover:bg-sunken"
      />
    </nav>
  );
}
