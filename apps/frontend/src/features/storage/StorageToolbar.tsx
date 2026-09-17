import { ArrowDown, ArrowUp, ChevronDown, FolderInput, ListPlus, Trash, X } from 'lucide-react';
import type { ReactElement } from 'react';

import { messages } from '../../i18n/messages';
import { IconButton } from '../../ui/IconButton';
import { Menu } from '../../ui/Menu';
import { SORT_FIELDS, type SortDirection, type SortField } from './itemOrder';

interface SortControlProps {
  sort: SortField;
  direction: SortDirection;
  onSortChange: (field: SortField) => void;
  onToggleDirection: () => void;
}

/** "Sort by Name ↑": the field is a menu, the arrow flips the order. */
export function SortControl({
  sort,
  direction,
  onSortChange,
  onToggleDirection,
}: SortControlProps): ReactElement {
  return (
    <div className="ms-auto flex items-center">
      <Menu
        label={messages.sort.menu}
        items={SORT_FIELDS.map((field) => ({
          key: field,
          label: messages.sort.fields[field],
          checked: field === sort,
          onSelect: () => onSortChange(field),
        }))}
        renderTrigger={(trigger) => (
          <button
            {...trigger}
            type="button"
            className="focus-ring flex h-9 cursor-pointer items-center gap-1 rounded-full ps-3 pe-2 text-sm text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
          >
            {messages.sort.current(messages.sort.fields[sort])}
            <ChevronDown aria-hidden="true" className="size-4" />
          </button>
        )}
      />
      <IconButton
        icon={direction === 'asc' ? ArrowUp : ArrowDown}
        label={direction === 'asc' ? messages.sort.ascending : messages.sort.descending}
        onClick={onToggleDirection}
        className="text-ink-muted hover:bg-sunken hover:text-ink"
      />
    </div>
  );
}

interface SelectionBarProps {
  count: number;
  canMove: boolean;
  onClear: () => void;
  onDelete: () => void;
  onAddToShoppingList: () => void;
  onMove: () => void;
}

/** Replaces the sort row while anything is selected, so the list below does not shift. */
export function SelectionBar({
  count,
  canMove,
  onClear,
  onDelete,
  onAddToShoppingList,
  onMove,
}: SelectionBarProps): ReactElement {
  const button = 'text-ink hover:bg-surface/70';

  return (
    <fieldset
      aria-label={messages.selection.toolbar}
      className="flex w-full min-w-0 items-center gap-1 rounded-full bg-accent-soft py-0.5 ps-0.5 pe-1"
    >
      <IconButton icon={X} label={messages.selection.clear} onClick={onClear} className={button} />
      <p aria-live="polite" className="text-sm font-semibold">
        {messages.selection.count(count)}
      </p>

      <div className="ms-auto flex items-center gap-1">
        <IconButton
          icon={Trash}
          label={messages.selection.delete}
          onClick={onDelete}
          className={`${button} hover:text-danger`}
        />
        <IconButton
          icon={ListPlus}
          label={messages.selection.addToShoppingList}
          onClick={onAddToShoppingList}
          className={button}
        />
        <IconButton
          icon={FolderInput}
          label={messages.selection.move}
          disabled={!canMove}
          onClick={onMove}
          className={button}
        />
      </div>
    </fieldset>
  );
}
