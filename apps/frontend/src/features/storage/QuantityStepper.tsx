import type { PantryItem } from '@pantry-pal/shared';
import { Minus, Plus, Trash } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { ReactElement } from 'react';

import { formatNumber } from '../../i18n/format';
import { messages } from '../../i18n/messages';
import { useQuantities } from '../../stores/StoreContext';
import { cn } from '../../ui/cn';
import { IconButton } from '../../ui/IconButton';

interface QuantityStepperProps {
  item: PantryItem;
  /** Pressed on the trash button, which replaces minus once the quantity is 1 or less. */
  onRemove: (item: PantryItem) => void;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Minus (or trash), the quantity, plus. Steps go through `QuantityUpdates`, so
 * the number changes at once and is saved once the taps stop.
 */
export const QuantityStepper = observer(function QuantityStepper({
  item,
  onRemove,
  size = 'sm',
  className,
}: QuantityStepperProps): ReactElement {
  const quantities = useQuantities();
  const quantity = quantities.quantityOf(item);

  return (
    <div className={cn('flex items-center justify-between gap-1', className)}>
      {quantity <= 1 ? (
        <IconButton
          icon={Trash}
          label={messages.item.remove(item.name)}
          size={size}
          onClick={() => onRemove(item)}
          className="text-ink-muted hover:bg-danger-soft hover:text-danger"
        />
      ) : (
        <IconButton
          icon={Minus}
          label={messages.item.decrease(item.name)}
          size={size}
          onClick={() => quantities.step(item, -1)}
          className="text-ink-muted hover:bg-sunken hover:text-ink"
        />
      )}
      <output
        aria-label={messages.item.quantity(item.name)}
        className={cn(
          'min-w-0 truncate text-center font-semibold tabular-nums',
          size === 'md' ? 'text-lg' : 'text-sm',
        )}
      >
        {formatNumber(quantity)}
      </output>
      <IconButton
        icon={Plus}
        label={messages.item.increase(item.name)}
        size={size}
        disabled={!quantities.canStep(item, 1)}
        onClick={() => quantities.step(item, 1)}
        className="text-accent hover:bg-accent-soft"
      />
    </div>
  );
});
