import { EllipsisVertical, Search, WifiOff, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react';

import { messages } from '../../i18n/messages';
import { usePantryStore } from '../../stores/StoreContext';
import { IconButton } from '../../ui/IconButton';
import { Menu, type MenuItem } from '../../ui/Menu';

interface StorageHeaderProps {
  query: string;
  onQueryChange: (query: string) => void;
  isSearchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  menuItems: readonly MenuItem[];
  /** The location tabs, which sit inside the header band. */
  children: ReactNode;
}

/** On the accent band on a phone, like a native app bar; plain on wider screens. */
const HEADER_BUTTON =
  'hover:bg-on-accent/15 md:text-ink-muted md:hover:bg-sunken md:hover:text-ink';

export const StorageHeader = observer(function StorageHeader({
  query,
  onQueryChange,
  isSearchOpen,
  onSearchOpenChange,
  menuItems,
  children,
}: StorageHeaderProps): ReactElement {
  const pantry = usePantryStore();
  const searchId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isSearchOpen) inputRef.current?.focus();
  }, [isSearchOpen]);

  function closeSearch(): void {
    onQueryChange('');
    onSearchOpenChange(false);
  }

  return (
    <header className="bg-accent text-on-accent md:bg-transparent md:text-ink">
      <div className="flex items-center gap-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 md:px-8 md:pt-8">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          {messages.storage.title}
        </h1>

        {pantry.connection === 'offline' && (
          <span className="flex items-center gap-1 rounded-full bg-current/15 px-2 py-0.5 text-xs font-medium">
            <WifiOff aria-hidden="true" className="size-3.5" />
            {messages.connection.offline}
          </span>
        )}

        <div className="ms-auto flex items-center gap-1">
          <IconButton
            icon={isSearchOpen ? X : Search}
            label={isSearchOpen ? messages.storage.closeSearch : messages.storage.search}
            aria-expanded={isSearchOpen}
            aria-controls={isSearchOpen ? searchId : undefined}
            onClick={() => (isSearchOpen ? closeSearch() : onSearchOpenChange(true))}
            className={HEADER_BUTTON}
          />
          <Menu
            label={messages.storage.moreActions}
            items={menuItems}
            renderTrigger={(trigger) => (
              <IconButton
                {...trigger}
                icon={EllipsisVertical}
                label={messages.storage.moreActions}
                className={HEADER_BUTTON}
              />
            )}
          />
        </div>
      </div>

      {isSearchOpen && (
        <search id={searchId} className="relative mx-4 mb-3 block md:mx-8">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
          />
          <input
            ref={inputRef}
            type="text"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              if (query === '') closeSearch();
              else onQueryChange('');
            }}
            aria-label={messages.storage.search}
            placeholder={messages.storage.searchPlaceholder}
            className="h-10 w-full rounded-full border border-line bg-surface ps-9 pe-10 text-sm text-ink placeholder:text-ink-muted focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none focus-visible:ring-inset"
          />
          {query !== '' && (
            <IconButton
              icon={X}
              label={messages.storage.clearSearch}
              size="sm"
              onClick={() => {
                onQueryChange('');
                inputRef.current?.focus();
              }}
              className="absolute end-1 top-1/2 -translate-y-1/2 text-ink-muted hover:bg-sunken hover:text-ink"
            />
          )}
        </search>
      )}

      {children}
    </header>
  );
});
