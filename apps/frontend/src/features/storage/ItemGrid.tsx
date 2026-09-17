import type { PantryItem } from '@pantry-pal/shared';
import type { ReactElement } from 'react';
import type { To } from 'react-router';

import { AddItemCard, ItemCard } from './ItemCard';

interface ItemGridProps {
  items: readonly PantryItem[];
  selectedIds: ReadonlySet<string>;
  detailsLink: (itemId: string) => To;
  onToggleSelected: (itemId: string) => void;
  onRemove: (item: PantryItem) => void;
  /** Given, the grid ends with a plus card that calls it to add an item. */
  onAdd?: () => void;
}

/**
 * Three cards a row on a phone, growing to at most seven.
 *
 * Columns follow the grid's own width (container queries), not the viewport's:
 * on a desktop the sidebar takes part of the screen, and a viewport breakpoint
 * would crowd the cards.
 */
export function ItemGrid({
  items,
  selectedIds,
  detailsLink,
  onToggleSelected,
  onRemove,
  onAdd,
}: ItemGridProps): ReactElement {
  return (
    <div className="@container">
      <ul className="grid grid-cols-3 gap-2 @lg:grid-cols-4 @lg:gap-3 @2xl:grid-cols-5 @4xl:grid-cols-6 @5xl:grid-cols-7">
        {items.map((item) => (
          <li key={item.id}>
            <ItemCard
              item={item}
              selected={selectedIds.has(item.id)}
              detailsLink={detailsLink}
              onToggleSelected={onToggleSelected}
              onRemove={onRemove}
            />
          </li>
        ))}
        {onAdd !== undefined && (
          <li>
            <AddItemCard onAdd={onAdd} />
          </li>
        )}
      </ul>
    </div>
  );
}
