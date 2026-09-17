import { formatNumber, plural, type PluralForms } from '../format';
import type { Messages } from '../messages';

/*
 * German. Every key of the English catalog, checked by `satisfies Messages`.
 * Plurals take `one` (1) and `other`, as `Intl.PluralRules('de')` picks them.
 *
 * Instructions use the infinitive ("Namen eingeben.") rather than addressing
 * the user, and typed names are quoted „like this“.
 */

function expiryDescription(days: number): string {
  if (days < 0) {
    return plural(-days, { one: 'Seit # Tag abgelaufen', other: 'Seit # Tagen abgelaufen' });
  }
  if (days === 0) return 'Läuft heute ab';
  return plural(days, { one: 'Läuft in # Tag ab', other: 'Läuft in # Tagen ab' });
}

const COUNT_NOUNS = new Map<string, PluralForms>([
  ['pcs', { other: 'Stk.' }],
  ['bag', { other: 'Beutel' }],
  ['blister', { other: 'Blister' }],
  ['bottle', { one: 'Flasche', other: 'Flaschen' }],
  ['box', { one: 'Schachtel', other: 'Schachteln' }],
  ['can', { one: 'Dose', other: 'Dosen' }],
  ['jar', { one: 'Glas', other: 'Gläser' }],
  ['pack', { one: 'Packung', other: 'Packungen' }],
  ['pill', { one: 'Tablette', other: 'Tabletten' }],
  ['tube', { one: 'Tube', other: 'Tuben' }],
]);

const CATEGORY_NAMES = new Map<string, string>([
  ['produce', 'Obst und Gemüse'],
  ['dairy', 'Milchprodukte'],
  ['meat', 'Fleisch'],
  ['fish', 'Fisch'],
  ['grains', 'Getreide und Backwaren'],
  ['canned', 'Konserven'],
  ['frozen', 'Tiefkühlkost'],
  ['spices', 'Gewürze'],
  ['beverages', 'Getränke'],
  ['medicine', 'Medikamente'],
  ['personal-care', 'Körperpflege'],
  ['cleaning', 'Reinigungsmittel'],
  ['other', 'Sonstiges'],
]);

export const de = {
  app: {
    name: 'Pantry Pal',
  },

  nav: {
    label: 'Hauptmenü',
    storage: 'Vorrat',
    shopping: 'Einkauf',
    planner: 'Planer',
    profile: 'Profil',
  },

  common: {
    cancel: 'Abbrechen',
    back: 'Zurück',
    close: 'Schließen',
    retry: 'Erneut versuchen',
    loading: 'Wird geladen…',
    comingSoon: 'Demnächst',
  },

  connection: {
    idle: 'Nicht verbunden',
    connecting: 'Verbindung wird hergestellt…',
    online: 'Live',
    offline: 'Offline',
  },

  household: {
    defaultName: 'Zuhause',
  },

  errors: {
    loadFailed: 'Der Vorrat konnte nicht geladen werden.',
    quantityNotSaved:
      'Die neue Menge konnte nicht gespeichert werden, daher wird wieder die gespeicherte angezeigt.',
    deleteFailed: (count: number) =>
      plural(count, {
        one: '# Artikel konnte nicht gelöscht werden.',
        other: '# Artikel konnten nicht gelöscht werden.',
      }),
    moveFailed: (count: number) =>
      plural(count, {
        one: '# Artikel konnte nicht verschoben werden.',
        other: '# Artikel konnten nicht verschoben werden.',
      }),
    refreshFailed:
      'Aktualisieren fehlgeschlagen, daher werden die zuletzt empfangenen Daten angezeigt.',
  },

  categories: {
    name: (code: string, label: string): string => CATEGORY_NAMES.get(code) ?? label,
  },

  storage: {
    title: 'Vorrat',
    locations: 'Lagerorte',
    search: 'Artikel suchen',
    searchPlaceholder: 'Artikel suchen',
    clearSearch: 'Suche leeren',
    closeSearch: 'Suche schließen',
    moreActions: 'Weitere Aktionen',
    addItem: 'Artikel hinzufügen',
    selectAll: 'Alle auswählen',
    editLocations: 'Lagerorte bearbeiten',
    refresh: 'Aktualisieren',
    itemCount: (count: number) => plural(count, { other: '# Artikel' }),
    matchCount: (count: number) => plural(count, { other: '# Treffer' }),
    emptyLocation: (location: string) => `In „${location}“ ist noch nichts.`,
    noMatches: (query: string, location: string) => `In „${location}“ passt nichts zu „${query}“.`,
    noLocations: 'Dieser Haushalt hat noch keine Lagerorte.',
    fallbackLocation: 'Sonstiges',
  },

  sort: {
    menu: 'Sortieren nach',
    current: (field: string) => `Sortiert nach: ${field}`,
    fields: {
      name: 'Name',
      expiry: 'Ablaufdatum',
      quantity: 'Menge',
      size: 'Größe',
      added: 'Zuletzt hinzugefügt',
    },
    ascending: 'Aufsteigend',
    descending: 'Absteigend',
  },

  selection: {
    toolbar: 'Ausgewählte Artikel',
    count: (count: number) => plural(count, { other: '# ausgewählt' }),
    clear: 'Auswahl aufheben',
    delete: 'Auswahl löschen',
    addToShoppingList: 'Auswahl zu einer Einkaufsliste hinzufügen',
    move: 'Auswahl an einen anderen Lagerort verschieben',
  },

  item: {
    select: (name: string) => `„${name}“ auswählen`,
    expiryBadge: (days: number) => `${formatNumber(days)}\u00A0T`,
    expiryDescription,
    amount: (quantity: number, unit: string) => `${formatNumber(quantity)}\u00A0${unit}`,
    amountWithSize: (quantity: number, unit: string, size: number, sizeUnit: string) =>
      `${formatNumber(quantity)}\u00A0${unit} ×\u00A0${formatNumber(size)}\u00A0${sizeUnit}`,
    sizeWithCount: (quantity: number, size: number, sizeUnit: string) =>
      `${formatNumber(quantity)} ×\u00A0${formatNumber(size)}\u00A0${sizeUnit}`,
    quantity: (name: string) => `Menge von „${name}“`,
    increase: (name: string) => `Menge von „${name}“ erhöhen`,
    decrease: (name: string) => `Menge von „${name}“ verringern`,
    remove: (name: string) => `„${name}“ entfernen`,
  },

  removeSheet: {
    title: (name: string) => `„${name}“ entfernen?`,
    usedIt: 'Schon verbraucht – auf die Einkaufsliste setzen',
    usedItOnList: (list: string) => `Schon verbraucht – auf „${list}“ setzen`,
    justDelete: 'Nur löschen',
  },

  addToList: {
    title: (count: number) => plural(count, { other: '# Artikel setzen auf' }),
    usedUpTitle: (name: string) => `„${name}“ setzen auf`,
    usedUpHint: 'Geht es das nächste Mal aus, landet es von selbst dort.',
    alreadyOn: 'Schon auf dieser Liste',
    someAlreadyOn: (count: number) => plural(count, { other: '# davon schon darauf' }),
    newList: 'Neue Liste',
    added: (count: number, list: string) =>
      `${plural(count, { other: '# Artikel' })} auf „${list}“ gesetzt.`,
    nothingAdded: (list: string) => `Schon auf „${list}“.`,
    usedUpAdded: (name: string, list: string) => `„${name}“ steht auf „${list}“.`,
  },

  deleteSheet: {
    title: (count: number) => plural(count, { other: '# Artikel löschen?' }),
    confirm: 'Löschen',
  },

  moveSheet: {
    title: (count: number) => plural(count, { other: '# Artikel verschieben nach' }),
  },

  locationEditor: {
    title: 'Lagerorte bearbeiten',
    name: 'Name des Lagerorts',
    newPlaceholder: 'Name des neuen Lagerorts',
    unnamed: 'Neuer Lagerort',
    add: 'Lagerort hinzufügen',
    limitReached: (max: number) => `Ein Haushalt kann bis zu ${formatNumber(max)} Lagerorte haben.`,
    remove: (name: string) => `„${name}“ löschen`,
    restore: (name: string) => `„${name}“ behalten`,
    deletedOnSave: 'Wird beim Speichern gelöscht.',
    moveItemsTo: (count: number) =>
      plural(count, { other: 'Wird beim Speichern gelöscht. # Artikel verschieben nach' }),
    nowhereToMove: (count: number) =>
      plural(count, {
        one: '# Artikel braucht einen anderen gespeicherten Lagerort.',
        other: '# Artikel brauchen einen anderen gespeicherten Lagerort.',
      }),
    nameRequired: 'Namen eingeben.',
    nameTaken: 'Ein anderer Lagerort heißt schon so.',
    fallbackHint:
      'Kann nicht umbenannt oder gelöscht werden: Artikel aus gelöschten Lagerorten landen hier.',
    save: 'Speichern',
    saving: 'Wird gespeichert…',
    saveFailed: 'Die Lagerorte konnten nicht gespeichert werden.',
    changedElsewhere:
      'Jemand anderes hat die Lagerorte während der Bearbeitung geändert. Die Änderungen stehen jetzt in der Liste: bitte prüfen und erneut speichern.',
    reorder: (name: string) => `„${name}“ umsortieren`,
    sortable: 'sortierbar',
    dragInstructions:
      'Zum Umsortieren auf dem Griff die Leertaste oder Eingabetaste drücken, mit den Pfeiltasten nach oben oder unten bewegen und zum Ablegen erneut die Leertaste oder Eingabetaste drücken. Escape bricht ab.',
    pickedUp: (name: string, position: number, total: number) =>
      `„${name}“ aufgenommen, Position ${formatNumber(position)} von ${formatNumber(total)}.`,
    movedTo: (name: string, position: number, total: number) =>
      `„${name}“ auf Position ${formatNumber(position)} von ${formatNumber(total)} verschoben.`,
    dropped: (name: string, position: number, total: number) =>
      `„${name}“ auf Position ${formatNumber(position)} von ${formatNumber(total)} abgelegt.`,
    dropCancelled: (name: string) =>
      `Umsortieren abgebrochen. „${name}“ ist wieder an seinem Platz.`,
  },

  addItem: {
    title: 'Artikel hinzufügen',
    submit: 'Hinzufügen',
    submitting: 'Wird hinzugefügt…',
  },

  units: {
    countNoun: (code: string, count: number, label: string): string => {
      const forms = COUNT_NOUNS.get(code);
      return forms === undefined ? label : plural(count, forms);
    },
    symbol: (_code: string, label: string): string => label,
    kinds: {
      mass: 'Gewicht',
      volume: 'Volumen',
      count: 'Anzahl',
    },
  },

  itemForm: {
    name: 'Name',
    namePlaceholder: 'Vollmilch',
    location: 'Lagerort',
    category: 'Kategorie',
    edible: 'Essbar',
    quantity: 'Menge',
    howMany: 'Wie viele',
    decreaseQuantity: 'Menge verringern',
    increaseQuantity: 'Menge erhöhen',
    unit: 'Einheit',
    sizeValue: 'Inhalt pro Stück',
    sizeHint: 'Optional: was eines enthält, z. B. 400 g.',
    sizeUnit: 'Einheit des Inhalts',
    noSizeUnit: 'Keine Einheit',
    expires: 'Ablaufdatum',
    clearExpires: 'Ablaufdatum leeren',
    opened: 'Geöffnet am',
    openedToday: 'Heute',
    clearOpened: 'Öffnungsdatum leeren',
    periodAfterOpening: 'Verbrauchen innerhalb von (Tagen nach dem Öffnen)',
    shoppingList: 'Einkaufsliste',
    shoppingListHint: 'Geht es aus, landet es von selbst auf dieser Liste.',
    noShoppingList: 'Keine',
    archivedList: (name: string) => `„${name}“ (archiviert)`,
    notes: 'Notizen',
    conflict: (fields: string) =>
      `Jemand anderes hat ${fields} während der Bearbeitung geändert. Beim Speichern bleiben die eigenen Werte erhalten.`,
  },

  fieldErrors: {
    generic: 'Diesen Wert prüfen.',
    name: 'Namen eingeben.',
    locationId: 'Lagerort auswählen.',
    category: 'Kategorie auswählen.',
    quantity: (min: number, max: number) =>
      `Eine ganze Zahl von ${formatNumber(min)} bis ${formatNumber(max)} eingeben.`,
    unit: 'Einheit auswählen.',
    sizeValue: (max: number, decimals: number) =>
      `Eine Zahl über 0 bis ${formatNumber(max)} mit höchstens ${formatNumber(decimals)} Nachkommastellen eingeben.`,
    sizeUnit: 'Einheit auswählen.',
    sizeUnitRequired: 'Eine Einheit für den Inhalt auswählen.',
    sizeValueRequired: 'Den Inhalt eingeben oder seine Einheit leeren.',
    date: 'Ein gültiges Datum eingeben.',
    openedInFuture: 'Das Öffnungsdatum darf nicht in der Zukunft liegen.',
    periodAfterOpeningDays: (max: number) =>
      `Eine ganze Zahl von 1 bis ${formatNumber(max)} Tagen eingeben.`,
    notes: (max: number) => `Notizen dürfen höchstens ${formatNumber(max)} Zeichen lang sein.`,
    defaultShoppingListId: 'Einkaufsliste auswählen.',
  },

  itemDetails: {
    edit: 'Bearbeiten',
    editTitle: 'Artikel bearbeiten',
    save: 'Speichern',
    saving: 'Wird gespeichert…',
    details: 'Details',
    quantity: 'Menge',
    expiry: 'Haltbarkeit',
    noExpiry: 'Kein Ablaufdatum',
    printedDate: 'Aufgedrucktes Datum',
    opened: 'Geöffnet',
    notOpened: 'Noch nicht geöffnet',
    useWithin: 'Verbrauchen innerhalb von',
    useWithinDays: (days: number) =>
      plural(days, { one: '# Tag nach dem Öffnen', other: '# Tagen nach dem Öffnen' }),
    notSet: 'Nicht festgelegt',
    openedSooner: 'Durch das Öffnen läuft es früher ab als zum aufgedruckten Datum.',
    markOpened: 'Heute als geöffnet markieren',
    notes: 'Notizen',
    added: 'Hinzugefügt',
    updated: 'Zuletzt geändert',
    remove: 'Artikel entfernen',
    shopping: 'Einkauf',
    defaultList: (list: string) => `Geht es aus, landet es auf „${list}“.`,
    noDefaultList: 'Geht es aus, landet es auf keiner Liste von selbst.',
    defaultListArchived: (list: string) =>
      `Geht es aus, landet es auf keiner Liste, solange „${list}“ archiviert ist.`,
    onLists: (lists: string) => `Steht gerade auf: ${lists}.`,
    addToList: 'Auf die Einkaufsliste',
  },

  discardSheet: {
    title: 'Änderungen verwerfen?',
    discard: 'Verwerfen',
    keepEditing: 'Weiter bearbeiten',
  },

  profile: {
    title: 'Profil',
    email: 'E-Mail',
    household: 'Haushalt',
    language: 'Sprache',
    languageHint: 'Die Seite wird in der gewählten Sprache neu geladen.',
    languageFailed: 'Die Sprache konnte nicht geändert werden.',
  },

  details: {
    title: 'Angaben',
    name: 'Name',
    nameHint: 'Sichtbar für alle, mit denen ein Haushalt geteilt wird.',
    birthDate: 'Geburtsdatum',
    birthDateHint: 'Für niemanden sonst sichtbar.',
    clearBirthDate: 'Geburtsdatum löschen',
    units: 'Einheiten',
    unitSystems: {
      metric: { name: 'Metrisch', examples: 'g, kg, ml, l' },
      imperial: { name: 'Imperial', examples: 'oz, lb, fl oz, cup' },
    },
    householdName: 'Name des Haushalts',
    save: 'Änderungen speichern',
    saving: 'Wird gespeichert…',
    saved: 'Angaben gespeichert.',
    fieldErrors: {
      displayName: (max: number) =>
        `Einen Namen mit höchstens ${formatNumber(max)} Zeichen eingeben.`,
      birthDate: (fromYear: string) => `Ein Datum zwischen ${fromYear} und heute eingeben.`,
      householdName: (max: number) =>
        `Einen Namen mit höchstens ${formatNumber(max)} Zeichen eingeben.`,
    },
  },

  auth: {
    signInTitle: 'Anmelden',
    signUpTitle: 'Konto erstellen',
    step: (current: number, total: number) =>
      `Schritt ${formatNumber(current)} von ${formatNumber(total)}`,
    email: 'E-Mail',
    password: 'Passwort',
    passwordHint: (min: number) =>
      plural(min, { one: 'Mindestens # Zeichen.', other: 'Mindestens # Zeichen.' }),
    continueWithGoogle: 'Weiter mit Google',
    continueWithEmail: 'Weiter mit E-Mail',
    otherMethods: 'Andere Anmeldemöglichkeiten',
    otherSignUpMethods: 'Andere Registrierungsmöglichkeiten',
    continue: 'Weiter',
    changeEmail: 'E-Mail ändern',
    signIn: 'Anmelden',
    signingIn: 'Anmeldung läuft…',
    signUp: 'Konto erstellen',
    signingUp: 'Konto wird erstellt…',
    noAccount: 'Noch kein Konto?',
    toSignUp: 'Konto erstellen',
    haveAccount: 'Schon ein Konto?',
    toSignIn: 'Anmelden',
    signOut: 'Abmelden',
    signingOut: 'Abmeldung läuft…',
    invalidCredentials: 'E-Mail oder Passwort ist falsch.',
    emailTaken: 'Zu dieser E-Mail-Adresse gibt es bereits ein Konto.',
    tooManyAttempts: 'Zu viele Versuche. Eine Minute warten und dann erneut versuchen.',
    offline: 'Der Server ist nicht erreichbar. Verbindung prüfen und dann erneut versuchen.',
    failed: 'Etwas ist schiefgelaufen. Erneut versuchen.',
    sessionEnded: 'Die Sitzung ist beendet. Zum Fortfahren erneut anmelden.',
    fieldErrors: {
      email: 'E-Mail-Adresse eingeben.',
      passwordRequired: 'Passwort eingeben.',
      password: (min: number, max: number) =>
        `${formatNumber(min)} bis ${formatNumber(max)} Zeichen verwenden.`,
    },
    dev: {
      hint: 'Meldet eine beliebige E-Mail-Adresse ohne Passwort an, solange das Backend mit DEV_AUTH=true läuft.',
      submit: 'Ohne Passwort anmelden',
      unavailable: 'Das Backend läuft nicht mit DEV_AUTH=true.',
    },
  },

  welcome: {
    title: (app: string) => `Willkommen bei ${app}`,
    intro: 'Ein paar optionale Fragen. Die Antworten lassen sich später im Profil ändern.',
    storageSpaces: 'Lagerorte',
    storageSpacesHint: (fallback: string) =>
      `Nicht benötigte abwählen. „${fallback}“ bleibt immer: Dorthin kommt alles aus einem entfernten Lagerort.`,
    finish: 'Fertig',
    finishing: 'Wird gespeichert…',
    skip: 'Überspringen',
  },

  changePassword: {
    title: 'Passwort',
    current: 'Aktuelles Passwort',
    next: 'Neues Passwort',
    submit: 'Passwort ändern',
    saving: 'Wird geändert…',
    changed: 'Passwort geändert. Alle anderen Geräte wurden abgemeldet.',
    incorrect: 'Das aktuelle Passwort ist falsch.',
    sameAsCurrent: 'Ein anderes Passwort als das aktuelle wählen.',
    currentRequired: 'Aktuelles Passwort eingeben.',
  },

  shopping: {
    title: 'Einkauf',
    lists: 'Einkaufslisten',
    editLists: 'Einkaufslisten bearbeiten',
    listName: 'Name der Liste',
    defaultListName: 'Meine Einkaufsliste',
    create: 'Erstellen',
    creating: 'Wird erstellt…',
    nameRequired: (max: number) =>
      `Einen Namen mit höchstens ${formatNumber(max)} Zeichen eingeben.`,
    nameTaken: 'Eine andere Einkaufsliste hat schon diesen Namen.',
    limitReached: (max: number) =>
      `Ein Haushalt kann bis zu ${formatNumber(max)} Einkaufslisten haben.`,
    moreActions: 'Weitere Aktionen',
    refresh: 'Aktualisieren',
    share: 'Liste teilen',
    nothingToShare: 'Auf dieser Liste ist nichts mehr zu kaufen.',
    copied: 'Liste kopiert. In eine Nachricht einfügen.',
    shareFailed: 'Die Liste konnte nicht geteilt werden.',
    shareLine: (name: string, amount: string) => `• ${name} – ${amount}`,
    loadFailed: 'Die Einkaufslisten konnten nicht geladen werden.',
    noLists: 'Noch keine Einkaufslisten.',
    createFirst: 'Einkaufsliste erstellen',
    emptyList: (list: string) => `Auf „${list}“ steht noch nichts.`,
    emptyHint: 'Im Vorrat Artikel auswählen oder einen öffnen und auf eine Liste setzen.',
    toBuy: (count: number) => plural(count, { other: '# zu kaufen' }),
    inCart: 'Im Einkaufswagen',
    left: (count: number) => plural(count, { other: 'noch # da' }),
    noneLeft: 'nichts mehr da',
    increase: (name: string) => `Mehr „${name}“ kaufen`,
    decrease: (name: string) => `Weniger „${name}“ kaufen`,
    remove: (name: string) => `„${name}“ von der Liste nehmen`,
    quantity: (name: string) => `Wie viel „${name}“ kaufen`,
    putAway: (count: number) => plural(count, { other: '# Artikel einräumen' }),
    puttingAway: 'Wird eingeräumt…',
    putAwayHint: 'Abgehakte Artikel kommen zurück an ihre Lagerorte.',
    putAwayDone: (count: number) =>
      plural(count, {
        one: '# Artikel ist wieder im Vorrat.',
        other: '# Artikel sind wieder im Vorrat.',
      }),
    changedElsewhere:
      'Jemand hat diese Liste inzwischen geändert. Liste prüfen und dann erneut einräumen.',
  },

  shoppingListEditor: {
    title: 'Einkaufslisten bearbeiten',
    name: 'Name der Einkaufsliste',
    newPlaceholder: 'Name der neuen Liste',
    unnamed: 'Neue Liste',
    add: 'Liste hinzufügen',
    empty: 'Noch keine Einkaufslisten.',
    limitReached: (max: number) =>
      `Ein Haushalt kann bis zu ${formatNumber(max)} Einkaufslisten haben, archivierte mitgezählt.`,
    archive: (name: string) => `„${name}“ archivieren`,
    unarchive: (name: string) => `„${name}“ wiederherstellen`,
    archivedHeading: 'Archiviert',
    archivedHint: 'Ausgeblendet, und bis zur Wiederherstellung kommt nichts darauf.',
    remove: (name: string) => `„${name}“ löschen`,
    restore: (name: string) => `„${name}“ behalten`,
    deletedOnSave: (count: number) =>
      count === 0
        ? 'Wird beim Speichern gelöscht.'
        : plural(count, {
            one: 'Wird beim Speichern mit # Artikel gelöscht.',
            other: 'Wird beim Speichern mit # Artikeln gelöscht.',
          }),
    nameRequired: 'Namen eingeben.',
    nameTaken: 'Eine andere Einkaufsliste heißt schon so.',
    save: 'Speichern',
    saving: 'Wird gespeichert…',
    saveFailed: 'Die Einkaufslisten konnten nicht gespeichert werden.',
    changedElsewhere:
      'Jemand anderes hat die Einkaufslisten während der Bearbeitung geändert. Die Änderungen stehen jetzt in der Liste: bitte prüfen und erneut speichern.',
  },

  planner: {
    title: 'Planer',
    description: 'Die Essensplanung kommt bald.',
  },
} satisfies Messages;
