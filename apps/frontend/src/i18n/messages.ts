import type { PantryCategory, UnitKind } from '@pantry-pal/shared';

import { formatNumber, plural, type PluralForms } from './format';

function expiryDescription(days: number): string {
  if (days < 0) return plural(-days, { one: 'Expired # day ago', other: 'Expired # days ago' });
  if (days === 0) return 'Expires today';
  return plural(days, { one: 'Expires in # day', other: 'Expires in # days' });
}

/**
 * The nouns of the seeded count units, by unit code. A `Map`, not an object: the
 * codes come from the API, and `constructor` must not find `Object.prototype`.
 */
const COUNT_NOUNS = new Map<string, PluralForms>([
  ['pcs', { one: 'pc', other: 'pcs' }],
  ['bag', { one: 'bag', other: 'bags' }],
  ['blister', { one: 'blister', other: 'blisters' }],
  ['bottle', { one: 'bottle', other: 'bottles' }],
  ['box', { one: 'box', other: 'boxes' }],
  ['can', { one: 'can', other: 'cans' }],
  ['jar', { one: 'jar', other: 'jars' }],
  ['pack', { one: 'pack', other: 'packs' }],
  ['pill', { one: 'pill', other: 'pills' }],
  ['tube', { one: 'tube', other: 'tubes' }],
]);

/**
 * Every user-facing string, in one place.
 *
 * The app is English-only for now but will be localized, so copy never lives in
 * components. Anything that carries a value is a function here, built with
 * `plural` and `formatNumber` instead of concatenation at the call site, so
 * adopting an i18n library means reimplementing this module rather than
 * hunting through JSX.
 *
 * `plural` substitutes `#` in the form it picks, so user data (a location or
 * item name) is interpolated only outside plural forms: a name containing `#`
 * would otherwise be rewritten.
 */
export const messages = {
  app: {
    name: 'Pantry Pal',
  },

  nav: {
    label: 'Main',
    storage: 'Storage',
    shopping: 'Shopping',
    planner: 'Planner',
    profile: 'Profile',
  },

  common: {
    cancel: 'Cancel',
    back: 'Back',
    close: 'Close',
    retry: 'Try again',
    loading: 'Loading…',
    comingSoon: 'Coming soon',
  },

  connection: {
    idle: 'Not connected',
    connecting: 'Connecting…',
    online: 'Live',
    offline: 'Offline',
  },

  household: {
    /** Stored as the name of a user's first household, created on their first visit. */
    defaultName: 'Home',
  },

  errors: {
    loadFailed: 'Couldn’t load your pantry.',
    quantityNotSaved: 'Couldn’t save the new quantity, so the saved one is shown again.',
    deleteFailed: (count: number) =>
      plural(count, { one: 'Couldn’t delete # item.', other: 'Couldn’t delete # items.' }),
    moveFailed: (count: number) =>
      plural(count, { one: 'Couldn’t move # item.', other: 'Couldn’t move # items.' }),
    refreshFailed: 'Couldn’t refresh, so the last data received is shown.',
  },

  /** Features whose backend endpoints are specified but not built yet. */
  pending: {
    shoppingLists: 'Shopping lists are coming soon.',
  },

  categories: {
    produce: 'Produce',
    dairy: 'Dairy',
    meat: 'Meat',
    grains: 'Grains',
    canned: 'Canned',
    frozen: 'Frozen',
    spices: 'Spices',
    beverages: 'Beverages',
    medicine: 'Medicine',
    'personal-care': 'Personal care',
    cleaning: 'Cleaning',
    other: 'Other',
  } satisfies Record<PantryCategory, string>,

  storage: {
    title: 'Storage',
    locations: 'Storage spaces',
    search: 'Search items',
    searchPlaceholder: 'Search items',
    clearSearch: 'Clear search',
    closeSearch: 'Close search',
    moreActions: 'More actions',
    addItem: 'Add item',
    selectAll: 'Select all',
    editLocations: 'Edit storage spaces',
    refresh: 'Refresh',
    itemCount: (count: number) => plural(count, { one: '# item', other: '# items' }),
    matchCount: (count: number) => plural(count, { one: '# match', other: '# matches' }),
    emptyLocation: (location: string) => `Nothing in ${location} yet.`,
    noMatches: (query: string, location: string) => `Nothing in ${location} matches “${query}”.`,
    noLocations: 'This household has no storage spaces yet.',
  },

  sort: {
    menu: 'Sort by',
    current: (field: string) => `Sort by ${field}`,
    fields: {
      name: 'Name',
      expiry: 'Expiry',
      quantity: 'Quantity',
      size: 'Size',
    },
    ascending: 'Ascending order',
    descending: 'Descending order',
  },

  selection: {
    toolbar: 'Selected items',
    count: (count: number) => plural(count, { one: '# selected', other: '# selected' }),
    clear: 'Clear selection',
    delete: 'Delete selected',
    addToShoppingList: 'Add selected to a shopping list',
    move: 'Move selected to another storage space',
  },

  item: {
    select: (name: string) => `Select ${name}`,
    /** The badge's short form: `5d`. */
    expiryBadge: (days: number) => `${formatNumber(days)}d`,
    expiryDescription,
    /*
     * Amounts. Non-breaking spaces keep a number with its unit and `×` with the
     * size, so a narrow card can wrap one only before the `×`.
     */
    /** `6 cans`, `5 pcs`: how many, with nothing known about what is in each. */
    amount: (quantity: number, unit: string) => `${formatNumber(quantity)}\u00A0${unit}`,
    /** `2 cans × 400 g`: how many, and what is in each. */
    amountWithSize: (quantity: number, unit: string, size: number, sizeUnit: string) =>
      `${formatNumber(quantity)}\u00A0${unit} ×\u00A0${formatNumber(size)}\u00A0${sizeUnit}`,
    /** `2 × 150 g`: plain pieces, which need no noun beside a size. */
    sizeWithCount: (quantity: number, size: number, sizeUnit: string) =>
      `${formatNumber(quantity)} ×\u00A0${formatNumber(size)}\u00A0${sizeUnit}`,
    quantity: (name: string) => `Quantity of ${name}`,
    increase: (name: string) => `Add one ${name}`,
    decrease: (name: string) => `Remove one ${name}`,
    remove: (name: string) => `Remove ${name}`,
  },

  removeSheet: {
    title: (name: string) => `Remove ${name}?`,
    usedIt: 'I used it already; add it to shop list',
    justDelete: 'I just want to delete it',
  },

  deleteSheet: {
    title: (count: number) => plural(count, { one: 'Delete # item?', other: 'Delete # items?' }),
    confirm: 'Delete',
  },

  moveSheet: {
    title: (count: number) => plural(count, { one: 'Move # item to', other: 'Move # items to' }),
  },

  /** Locations are "storage spaces" to users; code, routes and the API say "location". */
  locationEditor: {
    title: 'Edit storage spaces',
    name: 'Storage space name',
    newPlaceholder: 'New storage space name',
    /** Stands in for a new row's name until one is typed. */
    unnamed: 'New storage space',
    add: 'Add storage space',
    limitReached: (max: number) =>
      `A household can have up to ${formatNumber(max)} storage spaces.`,
    remove: (name: string) => `Delete ${name}`,
    restore: (name: string) => `Keep ${name}`,
    deletedOnSave: 'Deleted when you save.',
    moveItemsTo: (count: number) =>
      plural(count, {
        one: 'Deleted when you save. Move its # item to',
        other: 'Deleted when you save. Move its # items to',
      }),
    nowhereToMove: (count: number) =>
      plural(count, {
        one: 'Its # item needs another saved storage space to move to.',
        other: 'Its # items need another saved storage space to move to.',
      }),
    nameRequired: 'Enter a name.',
    nameTaken: 'Another storage space already has this name.',
    /** Under the fallback location ("Other"), whose name is read-only and which has no delete button. */
    fallbackHint: 'Can’t be renamed or deleted: items from deleted storage spaces move here.',
    save: 'Save',
    saving: 'Saving…',
    saveFailed: 'Couldn’t save the storage spaces.',
    changedElsewhere:
      'Someone else changed the storage spaces while you were editing. Their changes are in the list now: check it and save again.',
    reorder: (name: string) => `Reorder ${name}`,
    /** Announced as the handle's role, in place of "button". */
    sortable: 'sortable',
    dragInstructions:
      'To reorder a storage space, press Space or Enter on its handle, move it with the up and down arrow keys, then press Space or Enter again to drop it. Press Escape to cancel.',
    pickedUp: (name: string, position: number, total: number) =>
      `Picked up ${name}, at position ${formatNumber(position)} of ${formatNumber(total)}.`,
    movedTo: (name: string, position: number, total: number) =>
      `${name} moved to position ${formatNumber(position)} of ${formatNumber(total)}.`,
    dropped: (name: string, position: number, total: number) =>
      `${name} dropped at position ${formatNumber(position)} of ${formatNumber(total)}.`,
    dropCancelled: (name: string) => `Reordering cancelled. ${name} is back where it was.`,
  },

  addItem: {
    title: 'Add item',
    /** In the header bar, beside the "Add item" title. */
    submit: 'Add',
    submitting: 'Adding…',
  },

  /** Field labels shared by the add and edit forms. */
  units: {
    /**
     * A count unit as it reads after `count`: `bottles` after 2, `bottle` after 1.
     * `label` is the API's, shown for a code this catalog lacks — one an admin
     * added — until the catalog learns its noun.
     */
    countNoun: (code: string, count: number, label: string): string => {
      const forms = COUNT_NOUNS.get(code);
      return forms === undefined ? label : plural(count, forms);
    },
    /** Group labels in the size unit picker. */
    kinds: {
      mass: 'Weight',
      volume: 'Volume',
      count: 'Count',
    } satisfies Record<UnitKind, string>,
  },

  itemForm: {
    name: 'Name',
    namePlaceholder: 'Whole milk',
    location: 'Storage space',
    category: 'Category',
    quantity: 'Quantity',
    howMany: 'How many',
    decreaseQuantity: 'Decrease quantity',
    increaseQuantity: 'Increase quantity',
    unit: 'Unit',
    sizeValue: 'Each contains',
    sizeHint: 'Optional: what one holds, like 400 g.',
    /** The accessible name of the unit picker beside "Each contains". */
    sizeUnit: 'Unit of what each contains',
    noSizeUnit: 'No unit',
    expires: 'Expiry date',
    clearExpires: 'Clear expiry date',
    opened: 'Opened on',
    openedToday: 'Today',
    clearOpened: 'Clear opened date',
    periodAfterOpening: 'Use within (days after opening)',
    notes: 'Notes',
    /** `fields` is a formatted list of the labels above. */
    conflict: (fields: string) =>
      `Someone else changed ${fields} while you were editing. Saving keeps your values.`,
  },

  /**
   * One message per field, stating what it accepts, whichever of its rules the
   * value broke: the shared DTOs' own class-validator English is neither
   * friendly nor translatable.
   */
  fieldErrors: {
    generic: 'Check this value.',
    name: 'Enter a name.',
    locationId: 'Choose a storage space.',
    category: 'Choose a category.',
    quantity: (min: number, max: number) =>
      `Enter a whole number from ${formatNumber(min)} to ${formatNumber(max)}.`,
    unit: 'Choose a unit.',
    sizeValue: (max: number, decimals: number) =>
      `Enter a number above 0, up to ${formatNumber(max)}, with at most ${formatNumber(decimals)} decimals.`,
    sizeUnit: 'Choose a unit.',
    sizeUnitRequired: 'Choose a unit for the size.',
    sizeValueRequired: 'Enter the size, or clear its unit.',
    date: 'Enter a valid date.',
    openedInFuture: 'The opened date can’t be in the future.',
    periodAfterOpeningDays: (max: number) =>
      `Enter a whole number of days from 1 to ${formatNumber(max)}.`,
    notes: (max: number) => `Keep notes to ${formatNumber(max)} characters.`,
  },

  itemDetails: {
    edit: 'Edit',
    editTitle: 'Edit item',
    save: 'Save',
    saving: 'Saving…',
    details: 'Details',
    quantity: 'Quantity',
    expiry: 'Expiry',
    noExpiry: 'No expiry date',
    printedDate: 'Printed date',
    opened: 'Opened',
    notOpened: 'Not opened yet',
    useWithin: 'Use within',
    useWithinDays: (days: number) =>
      plural(days, { one: '# day after opening', other: '# days after opening' }),
    notSet: 'Not set',
    openedSooner: 'Opening it brought the expiry forward from the printed date.',
    markOpened: 'Mark as opened today',
    notes: 'Notes',
    added: 'Added',
    updated: 'Last updated',
    remove: 'Remove item',
  },

  discardSheet: {
    title: 'Discard your changes?',
    discard: 'Discard',
    keepEditing: 'Keep editing',
  },

  profile: {
    title: 'Profile',
    name: 'Name',
    email: 'Email',
    household: 'Household',
    devIdentity: 'Development sign-in: the identity comes from VITE_DEV_USER_EMAIL.',
  },

  shopping: {
    title: 'Shopping',
    description: 'Shopping lists are coming soon.',
  },

  planner: {
    title: 'Planner',
    description: 'Meal planning is coming soon.',
  },
};
