import type { SupportedLocale, UnitKind } from '@pantry-pal/shared';

import { formatNumber, plural, type PluralForms } from './format';
import { LOCALE } from './locale';
import { de } from './locales/de';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { frCA } from './locales/fr-CA';
import { ru } from './locales/ru';
import { uk } from './locales/uk';

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
 * The names of the seeded categories, by category code — a `Map` for the same
 * reason as `COUNT_NOUNS`. A code an admin added is missing here, and shows the
 * label the API gives it.
 */
const CATEGORY_NAMES = new Map<string, string>([
  ['produce', 'Produce'],
  ['dairy', 'Dairy'],
  ['meat', 'Meat'],
  ['fish', 'Fish'],
  ['grains', 'Grains'],
  ['canned', 'Canned'],
  ['frozen', 'Frozen'],
  ['spices', 'Spices'],
  ['beverages', 'Beverages'],
  ['medicine', 'Medicine'],
  ['personal-care', 'Personal care'],
  ['cleaning', 'Cleaning'],
  ['other', 'Other'],
]);

/**
 * Every user-facing string, in English: the source catalog. `locales/*`
 * translate it, and `Messages` — this object's type — makes a string missing
 * from any of them a type error.
 *
 * Copy never lives in components. Anything that carries a value is a function,
 * built with `plural` and `formatNumber` instead of concatenation at the call
 * site, so every language can order and inflect its own sentence.
 *
 * `plural` substitutes `#` in the form it picks, so user data (a location or
 * item name) is interpolated only outside plural forms: a name containing `#`
 * would otherwise be rewritten.
 */
const en = {
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
    unreachable: 'Couldn’t reach the server. Check your connection, then try again.',
    /** A change made on this device that the server refused later, with its reason. */
    changeRefused: (reason: string) => `A change couldn’t be saved: ${reason}`,
    itemGone: 'This item was deleted meanwhile.',
  },

  categories: {
    /**
     * A category's name. `label` is the API's, shown for a code this catalog
     * lacks — one an admin added — until the catalog learns its name.
     */
    name: (code: string, label: string): string => CATEGORY_NAMES.get(code) ?? label,
  },

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
    noMatches: (query: string, location: string) => `Nothing in ${location} matches “${query}”.`,
    noLocations: 'This household has no storage spaces yet.',
    /** The fallback storage space: nobody can rename it, so its name is translated. */
    fallbackLocation: 'Other',
  },

  sort: {
    menu: 'Sort by',
    current: (field: string) => `Sort by ${field}`,
    fields: {
      name: 'Name',
      expiry: 'Expiry',
      quantity: 'Quantity',
      size: 'Size',
      /** Newest first; the direction arrow reverses it to oldest first. */
      added: 'Last added',
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
    /** The item has no default shopping list: a list is picked next. */
    usedIt: 'I used it already; add it to shop list',
    /** The item goes on its default shopping list by itself. */
    usedItOnList: (list: string) => `I used it already; add it to ${list}`,
    justDelete: 'I just want to delete it',
  },

  /** Picking the shopping list items go on: from a selection, an item's details, or a used-up item. */
  addToList: {
    title: (count: number) => plural(count, { one: 'Add # item to', other: 'Add # items to' }),
    /** An item just used up, whose list is remembered for next time. */
    usedUpTitle: (name: string) => `Add ${name} to`,
    usedUpHint: 'Next time it runs out, it goes there by itself.',
    alreadyOn: 'Already on this list',
    someAlreadyOn: (count: number) =>
      plural(count, { one: '# of them is on it already', other: '# of them are on it already' }),
    newList: 'New list',
    added: (count: number, list: string) =>
      `${plural(count, { one: '# item added', other: '# items added' })} to ${list}.`,
    nothingAdded: (list: string) => `Already on ${list}.`,
    usedUpAdded: (name: string, list: string) => `${name} is on ${list}.`,
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
    /** A mass or volume unit's symbol. English shows the API's label, `fl oz` for `fl_oz_us`. */
    symbol: (_code: string, label: string): string => label,
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
    edible: 'Edible',
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
    shoppingList: 'Shopping list',
    shoppingListHint: 'When it runs out, it goes on this list by itself.',
    noShoppingList: 'None',
    /** The item's default list in the picker, when it is archived. */
    archivedList: (name: string) => `${name} (archived)`,
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
    defaultShoppingListId: 'Choose a shopping list.',
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
    shopping: 'Shopping',
    /** Where the item goes by itself when it runs out. */
    defaultList: (list: string) => `When it runs out, it goes on ${list}.`,
    noDefaultList: 'When it runs out, it goes on no list by itself.',
    defaultListArchived: (list: string) =>
      `When it runs out, it goes on no list while ${list} is archived.`,
    /** `lists` is a formatted list of names. */
    onLists: (lists: string) => `On ${lists} now.`,
    addToList: 'Add to shopping list',
  },

  discardSheet: {
    title: 'Discard your changes?',
    discard: 'Discard',
    keepEditing: 'Keep editing',
  },

  profile: {
    title: 'Profile',
    email: 'Email',
    household: 'Household',
    language: 'Language',
    languageHint: 'The page reloads in the language you pick.',
    languageFailed: 'Couldn’t change the language.',
  },

  /** The account's details: asked when signing up, changed on the Profile page. */
  details: {
    title: 'Details',
    name: 'Name',
    nameHint: 'The people you share a household with see it.',
    birthDate: 'Date of birth',
    birthDateHint: 'Only you can see it.',
    clearBirthDate: 'Clear the date of birth',
    units: 'Units',
    unitSystems: {
      metric: { name: 'Metric', examples: 'g, kg, ml, l' },
      imperial: { name: 'Imperial', examples: 'oz, lb, fl oz, cup' },
    },
    householdName: 'Household name',
    save: 'Save changes',
    saving: 'Saving…',
    saved: 'Details saved.',
    fieldErrors: {
      displayName: (max: number) => `Enter a name of up to ${formatNumber(max)} characters.`,
      /** The year as written, never grouped like a number. */
      birthDate: (fromYear: string) => `Enter a date from ${fromYear} to today.`,
      householdName: (max: number) => `Enter a name of up to ${formatNumber(max)} characters.`,
    },
  },

  auth: {
    signInTitle: 'Sign in',
    signUpTitle: 'Create an account',
    step: (current: number, total: number) =>
      `Step ${formatNumber(current)} of ${formatNumber(total)}`,
    email: 'Email',
    password: 'Password',
    passwordHint: (min: number) =>
      plural(min, { one: 'At least # character.', other: 'At least # characters.' }),
    continueWithGoogle: 'Continue with Google',
    continueWithEmail: 'Continue with email',
    otherMethods: 'Other ways to sign in',
    otherSignUpMethods: 'Other ways to sign up',
    continue: 'Continue',
    changeEmail: 'Change email',
    signIn: 'Sign in',
    signingIn: 'Signing in…',
    signUp: 'Create account',
    signingUp: 'Creating account…',
    noAccount: 'No account yet?',
    toSignUp: 'Create one',
    haveAccount: 'Already have an account?',
    toSignIn: 'Sign in',
    signOut: 'Sign out',
    signingOut: 'Signing out…',
    invalidCredentials: 'Incorrect email or password.',
    emailTaken: 'An account with this email already exists.',
    tooManyAttempts: 'Too many attempts. Wait a minute, then try again.',
    offline: 'Couldn’t reach the server. Check your connection, then try again.',
    failed: 'Something went wrong. Try again.',
    sessionEnded: 'Your session has ended. Sign in again to continue.',
    fieldErrors: {
      email: 'Enter an email address.',
      passwordRequired: 'Enter your password.',
      password: (min: number, max: number) =>
        `Use ${formatNumber(min)} to ${formatNumber(max)} characters.`,
    },
    dev: {
      hint: 'Signs in as any email, without a password, while the backend runs with DEV_AUTH=true.',
      submit: 'Sign in without a password',
      unavailable: 'The backend isn’t running with DEV_AUTH=true.',
    },
  },

  /** Sign-up's last step: optional questions, once the account exists. */
  welcome: {
    title: (app: string) => `Welcome to ${app}`,
    intro: 'A few optional questions. You can change the answers later on your Profile.',
    storageSpaces: 'Storage spaces',
    storageSpacesHint: (fallback: string) =>
      `Untick the ones you don’t need. “${fallback}” always stays: things from a removed space go there.`,
    finish: 'Finish',
    finishing: 'Saving…',
    skip: 'Skip for now',
  },

  changePassword: {
    title: 'Password',
    current: 'Current password',
    next: 'New password',
    submit: 'Change password',
    saving: 'Changing…',
    changed: 'Password changed. Your other devices were signed out.',
    incorrect: 'The current password is incorrect.',
    sameAsCurrent: 'Choose a password different from the current one.',
    currentRequired: 'Enter your current password.',
  },

  shopping: {
    title: 'Shopping',
    lists: 'Shopping lists',
    editLists: 'Edit shopping lists',
    listName: 'List name',
    /**
     * Suggested for a new list when a household has none left. A household starts
     * with one of this name, given by the server in its creator's language
     * (`DEFAULT_SHOPPING_LIST_TRANSLATIONS`), so each catalog matches it.
     */
    defaultListName: 'My shopping list',
    create: 'Create',
    creating: 'Creating…',
    nameRequired: (max: number) => `Enter a name of up to ${formatNumber(max)} characters.`,
    nameTaken: 'Another shopping list already has this name.',
    limitReached: (max: number) =>
      `A household can have up to ${formatNumber(max)} shopping lists.`,
    moreActions: 'More actions',
    refresh: 'Refresh',
    share: 'Share list',
    nothingToShare: 'Nothing left to buy on this list.',
    copied: 'List copied. Paste it into a message.',
    shareFailed: 'Couldn’t share the list.',
    /** A line of the text a list is shared as, under the list's name. */
    shareLine: (name: string, amount: string) => `• ${name} — ${amount}`,
    noLists: 'No shopping lists yet.',
    createFirst: 'Create a shopping list',
    emptyList: (list: string) => `Nothing on ${list} yet.`,
    emptyHint: 'In Storage, select items or open one, then add it to a list.',
    toBuy: (count: number) => plural(count, { one: '# to buy', other: '# to buy' }),
    inCart: 'In the cart',
    /** How many of the item are in storage now. */
    left: (count: number) => plural(count, { one: '# left', other: '# left' }),
    noneLeft: 'none left',
    increase: (name: string) => `Buy one more ${name}`,
    decrease: (name: string) => `Buy one fewer ${name}`,
    remove: (name: string) => `Take ${name} off the list`,
    quantity: (name: string) => `How many ${name} to buy`,
    /** Restocks the ticked items and takes them off the list, as the hint says. */
    markBought: (count: number) => plural(count, { other: 'Bought #' }),
    markingBought: 'Marking as bought…',
    markBoughtHint: 'Bought items go back to their storage spaces and leave the list.',
    /** The notice once the items are marked as bought. */
    markedBought: (count: number) =>
      plural(count, {
        one: '# item is back in storage.',
        other: '# items are back in storage.',
      }),
    changedElsewhere:
      'Someone changed this list meanwhile. Check it, then mark the items as bought again.',
  },

  /** Adding, renaming, archiving and deleting shopping lists, saved together. */
  shoppingListEditor: {
    title: 'Edit shopping lists',
    name: 'Shopping list name',
    newPlaceholder: 'New list name',
    /** Stands in for a new row's name until one is typed. */
    unnamed: 'New list',
    add: 'Add list',
    empty: 'No shopping lists yet.',
    limitReached: (max: number) =>
      `A household can have up to ${formatNumber(max)} shopping lists, archived ones included.`,
    archive: (name: string) => `Archive ${name}`,
    unarchive: (name: string) => `Restore ${name}`,
    archivedHeading: 'Archived',
    archivedHint: 'Hidden, and nothing is added to them until they are restored.',
    remove: (name: string) => `Delete ${name}`,
    /** Undoes a deletion not saved yet. */
    restore: (name: string) => `Keep ${name}`,
    deletedOnSave: (count: number) =>
      count === 0
        ? 'Deleted when you save.'
        : plural(count, {
            one: 'Deleted when you save, with the # item on it.',
            other: 'Deleted when you save, with the # items on it.',
          }),
    nameRequired: 'Enter a name.',
    nameTaken: 'Another shopping list already has this name.',
    save: 'Save',
    saving: 'Saving…',
    saveFailed: 'Couldn’t save the shopping lists.',
    changedElsewhere:
      'Someone else changed the shopping lists while you were editing. Their changes are in the list now: check it and save again.',
  },

  planner: {
    title: 'Planner',
    description: 'Meal planning is coming soon.',
  },
};

/** The shape every catalog has: the English one's. */
export type Messages = typeof en;

const CATALOGS: Readonly<Record<SupportedLocale, Messages>> = {
  'en-GB': en,
  'uk-UA': uk,
  'ru-RU': ru,
  'de-DE': de,
  'fr-FR': fr,
  'fr-CA': frCA,
  'es-ES': es,
};

/** The catalog of the page's language, chosen once per page load (`LOCALE`). */
export const messages: Messages = CATALOGS[LOCALE];
