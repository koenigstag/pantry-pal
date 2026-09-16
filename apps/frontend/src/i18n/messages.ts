import type { PantryCategory } from '@pantry-pal/shared';

import { formatNumber, plural } from './format';

function expiryDescription(days: number): string {
  if (days < 0) return plural(-days, { one: 'Expired # day ago', other: 'Expired # days ago' });
  if (days === 0) return 'Expires today';
  return plural(days, { one: 'Expires in # day', other: 'Expires in # days' });
}

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
    locations: 'Locations',
    search: 'Search items',
    searchPlaceholder: 'Search items',
    clearSearch: 'Clear search',
    closeSearch: 'Close search',
    moreActions: 'More actions',
    addItem: 'Add item',
    selectAll: 'Select all',
    editLocations: 'Edit locations',
    refresh: 'Refresh',
    itemCount: (count: number) => plural(count, { one: '# item', other: '# items' }),
    matchCount: (count: number) => plural(count, { one: '# match', other: '# matches' }),
    emptyLocation: (location: string) => `Nothing in ${location} yet.`,
    noMatches: (query: string, location: string) => `Nothing in ${location} matches “${query}”.`,
    noLocations: 'This household has no locations yet.',
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
    move: 'Move selected to another location',
  },

  item: {
    select: (name: string) => `Select ${name}`,
    /** The badge's short form: `5d`. */
    expiryBadge: (days: number) => `${formatNumber(days)}d`,
    expiryDescription,
    /** `2 × 400 g`: how many, and what is in each. */
    sizeWithCount: (quantity: number, size: number, unit: string) =>
      `${formatNumber(quantity)} × ${formatNumber(size)} ${unit}`,
    /** `1.5 kg`: loose goods, measured rather than counted. */
    amount: (quantity: number, unit: string) => `${formatNumber(quantity)} ${unit}`,
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

  locationEditor: {
    title: 'Edit locations',
    name: 'Location name',
    newPlaceholder: 'New location name',
    /** Stands in for a new row's name until one is typed. */
    unnamed: 'New location',
    add: 'Add location',
    limitReached: (max: number) => `A household can have up to ${formatNumber(max)} locations.`,
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
        one: 'Its # item needs another saved location to move to.',
        other: 'Its # items need another saved location to move to.',
      }),
    nameRequired: 'Enter a name.',
    nameTaken: 'Another location already has this name.',
    keepOne: 'Keep at least one location.',
    save: 'Save',
    saving: 'Saving…',
    saveFailed: 'Couldn’t save the locations.',
    changedElsewhere:
      'Someone else changed the locations while you were editing. Their changes are in the list now: check it and save again.',
    reorder: (name: string) => `Reorder ${name}`,
    /** Announced as the handle's role, in place of "button". */
    sortable: 'sortable',
    dragInstructions:
      'To reorder a location, press Space or Enter on its handle, move it with the up and down arrow keys, then press Space or Enter again to drop it. Press Escape to cancel.',
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
    submit: 'Add item',
    submitting: 'Adding…',
  },

  /** Field labels shared by the add and edit forms. */
  itemForm: {
    name: 'Name',
    namePlaceholder: 'Whole milk',
    location: 'Location',
    category: 'Category',
    quantity: 'Quantity',
    unit: 'Unit',
    sizeValue: 'Size of one',
    sizeHint: 'What one piece holds, like 400 g.',
    sizeUnit: 'Size unit',
    noSizeUnit: 'None',
    sizeUnitRequired: 'Choose a unit for the size.',
    sizeValueRequired: 'Enter the size, or clear its unit.',
    expires: 'Expiry date',
    opened: 'Opened on',
    periodAfterOpening: 'Use within (days after opening)',
    notes: 'Notes',
  },

  itemDetails: {
    edit: 'Edit',
    editTitle: 'Edit item',
    save: 'Save',
    saving: 'Saving…',
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
