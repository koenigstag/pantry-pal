import type { PantryItem } from '@pantry-pal/shared';
import { FolderInput, ListPlus, Trash } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { ReactElement } from 'react';

import { messages } from '../../i18n/messages';
import { usePantryStore, useQuantities } from '../../stores/StoreContext';
import { Dialog } from '../../ui/Dialog';
import { SheetButton } from '../../ui/SheetButton';
import { locationName } from './locationName';

function CancelButton({ onClick }: { onClick: () => void }): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring mt-1 h-11 cursor-pointer rounded-xl px-4 font-medium text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
    >
      {messages.common.cancel}
    </button>
  );
}

const noop = (): void => undefined;

interface RemoveItemSheetProps {
  /** The item whose trash button was pressed; `null` keeps the sheet closed. */
  item: PantryItem | null;
  onClose: () => void;
}

/**
 * Asks how the last one of an item left the shelf.
 *
 * "I used it already" will mark the item consumed and put it on a shopping
 * list the user picks; it waits on the shopping-list endpoints. "I just want
 * to delete it" is the backend's delete, which records a correction rather
 * than waste.
 */
export const RemoveItemSheet = observer(function RemoveItemSheet({
  item,
  onClose,
}: RemoveItemSheetProps): ReactElement {
  const pantry = usePantryStore();
  const quantities = useQuantities();

  function deleteItem(): void {
    if (item === null) return;

    quantities.discard(item.id);
    onClose();
    void pantry.deleteItems([item.id]);
  }

  return (
    <Dialog
      variant="sheet"
      open={item !== null}
      onClose={onClose}
      title={item === null ? '' : messages.removeSheet.title(item.name)}
    >
      <div className="flex flex-col gap-2">
        <SheetButton
          icon={ListPlus}
          label={messages.removeSheet.usedIt}
          hint={messages.pending.shoppingLists}
          unavailable
          onClick={noop}
        />
        <SheetButton
          icon={Trash}
          tone="danger"
          label={messages.removeSheet.justDelete}
          onClick={deleteItem}
        />
        <CancelButton onClick={onClose} />
      </div>
    </Dialog>
  );
});

interface ItemsSheetProps {
  /** The selected items; `null` keeps the sheet closed. */
  itemIds: readonly string[] | null;
  onClose: () => void;
  /** Called once the action is under way, to clear the selection. */
  onDone: () => void;
}

export const DeleteItemsSheet = observer(function DeleteItemsSheet({
  itemIds,
  onClose,
  onDone,
}: ItemsSheetProps): ReactElement {
  const pantry = usePantryStore();
  const quantities = useQuantities();

  function confirm(): void {
    if (itemIds === null) return;

    for (const id of itemIds) quantities.discard(id);
    onClose();
    onDone();
    void pantry.deleteItems(itemIds);
  }

  return (
    <Dialog
      variant="sheet"
      open={itemIds !== null}
      onClose={onClose}
      title={messages.deleteSheet.title(itemIds?.length ?? 0)}
    >
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={confirm}
          className="focus-ring flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-danger px-4 font-semibold text-surface transition-opacity hover:opacity-90"
        >
          <Trash aria-hidden="true" className="size-5" />
          {messages.deleteSheet.confirm}
        </button>
        <CancelButton onClick={onClose} />
      </div>
    </Dialog>
  );
});

export const MoveItemsSheet = observer(function MoveItemsSheet({
  itemIds,
  fromLocationId,
  onClose,
  onDone,
}: ItemsSheetProps & { fromLocationId: string }): ReactElement {
  const pantry = usePantryStore();

  function move(locationId: string): void {
    if (itemIds === null) return;

    onClose();
    onDone();
    void pantry.moveItems(itemIds, locationId);
  }

  return (
    <Dialog
      variant="sheet"
      open={itemIds !== null}
      onClose={onClose}
      title={messages.moveSheet.title(itemIds?.length ?? 0)}
    >
      <ul className="flex flex-col gap-2">
        {pantry.locations
          .filter((location) => location.id !== fromLocationId)
          .map((location) => (
            <li key={location.id}>
              <SheetButton
                icon={FolderInput}
                label={locationName(location)}
                onClick={() => move(location.id)}
              />
            </li>
          ))}
      </ul>
      <CancelButton onClick={onClose} />
    </Dialog>
  );
});
