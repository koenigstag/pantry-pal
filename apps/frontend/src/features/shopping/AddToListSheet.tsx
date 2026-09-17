import {
  ITEM_STATUS,
  MAX_SHOPPING_LIST_NAME_LENGTH,
  MAX_SHOPPING_LISTS_PER_HOUSEHOLD,
  type PantryItem,
  type ShoppingList,
} from '@pantry-pal/shared';
import { ListPlus, Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { messages } from '../../i18n/messages';
import { useNotices, usePantryStore, useQuantities } from '../../stores/StoreContext';
import { Dialog } from '../../ui/Dialog';
import { Field, FIELD_CONTROL } from '../../ui/Field';
import { SheetButton } from '../../ui/SheetButton';
import { CancelButton } from '../storage/ItemSheets';

/** What goes on the list picked: items to add, or one just used up. */
export type ListPick =
  | { kind: 'add'; itemIds: readonly string[] }
  /** Marked consumed, with the list picked becoming its default, in one request. */
  | { kind: 'used-up'; item: PantryItem };

interface AddToListSheetProps {
  /** `null` keeps the sheet closed. */
  pick: ListPick | null;
  onClose: () => void;
  /** Once the items are on a list: clears a selection, say. */
  onDone?: () => void;
}

/**
 * Picks the shopping list items go on, or names a new one — straight away when
 * the household has none yet. Errors show inside the sheet, which covers the
 * page's notices; the outcome is a notice once the sheet has closed.
 */
export function AddToListSheet({ pick, onClose, onDone }: AddToListSheetProps): ReactElement {
  let title = '';
  if (pick?.kind === 'add') title = messages.addToList.title(pick.itemIds.length);
  if (pick?.kind === 'used-up') title = messages.addToList.usedUpTitle(pick.item.name);

  return (
    <Dialog variant="sheet" open={pick !== null} onClose={onClose} title={title}>
      {pick !== null && (
        <ListChoices
          key={pick.kind === 'add' ? pick.itemIds.join() : pick.item.id}
          pick={pick}
          onClose={onClose}
          onDone={onDone}
        />
      )}
    </Dialog>
  );
}

interface ListChoicesProps {
  pick: ListPick;
  onClose: () => void;
  onDone: (() => void) | undefined;
}

const ListChoices = observer(function ListChoices({
  pick,
  onClose,
  onDone,
}: ListChoicesProps): ReactElement {
  const pantry = usePantryStore();
  const quantities = useQuantities();
  const notices = useNotices();
  const nameRef = useRef<HTMLInputElement>(null);

  // Archived lists are frozen, so they are not offered. A household's first list
  // starts from a suggested name.
  const lists = pantry.activeShoppingLists;
  const canCreate = pantry.shoppingLists.length < MAX_SHOPPING_LISTS_PER_HOUSEHOLD;
  const [isNaming, setNaming] = useState(lists.length === 0 && canCreate);
  const [name, setName] = useState(
    pantry.shoppingLists.length === 0 ? messages.shopping.defaultListName : '',
  );
  const [nameError, setNameError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setBusy] = useState(false);

  const itemIds = pick.kind === 'add' ? pick.itemIds : [pick.item.id];

  // Only after "New list" was pressed: with no lists, opening the sheet focuses the name anyway.
  const wasNaming = useRef(isNaming);
  useEffect(() => {
    if (isNaming && !wasNaming.current) nameRef.current?.focus();
    wasNaming.current = isNaming;
  }, [isNaming]);

  function finish(message: string): void {
    onClose();
    onDone?.();
    notices.info(message);
  }

  async function putOn(list: ShoppingList): Promise<void> {
    setBusy(true);
    setError(null);

    if (pick.kind === 'add') {
      const result = await pantry.addToShoppingList(list.id, itemIds);
      setBusy(false);
      if (!result.ok) return setError(result.error);
      return finish(
        result.value > 0
          ? messages.addToList.added(result.value, list.name)
          : messages.addToList.nothingAdded(list.name),
      );
    }

    // A step still waiting to be sent would otherwise land after the item left the shelf.
    quantities.discard(pick.item.id);
    const failure = await pantry.updateItem(pick.item.id, {
      status: ITEM_STATUS.Consumed,
      defaultShoppingListId: list.id,
    });
    setBusy(false);
    if (failure !== null) return setError(failure);
    return finish(messages.addToList.usedUpAdded(pick.item.name, list.name));
  }

  async function createAndPutOn(): Promise<void> {
    const trimmed = name.trim();
    if (trimmed === '' || trimmed.length > MAX_SHOPPING_LIST_NAME_LENGTH) {
      setNameError(messages.shopping.nameRequired(MAX_SHOPPING_LIST_NAME_LENGTH));
      return;
    }

    setBusy(true);
    setNameError(undefined);
    setError(null);
    const result = await pantry.createShoppingList(trimmed);
    if (!result.ok) {
      setBusy(false);
      setNameError(result.error);
      return;
    }
    await putOn(result.value);
  }

  /** Whether the items are on `list` already, as a hint; all of them makes adding pointless. */
  function stateOf(list: ShoppingList): { hint: string | undefined; pointless: boolean } {
    const onIt = new Set(pantry.entriesOn(list.id).map((entry) => entry.itemId));
    const count = itemIds.filter((id) => onIt.has(id)).length;

    if (count === 0) return { hint: undefined, pointless: false };
    // A used-up item still gets the list as its default, so picking it does something.
    if (pick.kind === 'used-up') return { hint: messages.addToList.alreadyOn, pointless: false };
    if (count === itemIds.length) return { hint: messages.addToList.alreadyOn, pointless: true };
    return { hint: messages.addToList.someAlreadyOn(count), pointless: false };
  }

  return (
    <div className="flex flex-col gap-2">
      {pick.kind === 'used-up' && (
        <p className="-mt-1 mb-1 text-sm text-ink-muted">{messages.addToList.usedUpHint}</p>
      )}
      {error !== null && (
        <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {lists.length > 0 && (
        <ul className="flex flex-col gap-2">
          {lists.map((list) => {
            const { hint, pointless } = stateOf(list);
            return (
              <li key={list.id}>
                <SheetButton
                  icon={ListPlus}
                  label={list.name}
                  hint={hint}
                  unavailable={pointless || isBusy}
                  onClick={() => void putOn(list)}
                />
              </li>
            );
          })}
        </ul>
      )}

      {isNaming ? (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void createAndPutOn();
          }}
          className="flex items-start gap-2"
        >
          <Field label={messages.shopping.listName} error={nameError} className="flex-1">
            {(props) => (
              <input
                {...props}
                ref={nameRef}
                maxLength={MAX_SHOPPING_LIST_NAME_LENGTH}
                autoComplete="off"
                enterKeyHint="done"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={FIELD_CONTROL}
              />
            )}
          </Field>
          <button
            type="submit"
            disabled={isBusy}
            className="focus-ring mt-5 h-10 shrink-0 cursor-pointer rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBusy ? messages.shopping.creating : messages.shopping.create}
          </button>
        </form>
      ) : (
        canCreate && (
          <SheetButton
            icon={Plus}
            label={messages.addToList.newList}
            unavailable={isBusy}
            onClick={() => setNaming(true)}
          />
        )
      )}

      <CancelButton onClick={onClose} />
    </div>
  );
});
