import { formatNumber, plural, type PluralForms } from '../format';
import type { Messages } from '../messages';

/*
 * French. Every key of the English catalog, checked by `satisfies Messages`.
 * Plurals take `one` (0, 1 and fractions below 2) and `other`, as
 * `Intl.PluralRules('fr')` picks them.
 *
 * French typography: a no-break space before `:` (\u00A0) and a narrow no-break
 * space before `?` and `!` (\u202F); typed names are quoted « like this ».
 */

const q = (text: string): string => `«\u00A0${text}\u00A0»`;

function expiryDescription(days: number): string {
  if (days < 0) {
    return plural(-days, { one: 'Périmé depuis # jour', other: 'Périmé depuis # jours' });
  }
  if (days === 0) return 'Périme aujourd’hui';
  return plural(days, { one: 'Périme dans # jour', other: 'Périme dans # jours' });
}

const COUNT_NOUNS = new Map<string, PluralForms>([
  ['pcs', { one: 'pièce', other: 'pièces' }],
  ['bag', { one: 'sachet', other: 'sachets' }],
  ['blister', { one: 'plaquette', other: 'plaquettes' }],
  ['bottle', { one: 'bouteille', other: 'bouteilles' }],
  ['box', { one: 'boîte', other: 'boîtes' }],
  ['can', { one: 'conserve', other: 'conserves' }],
  ['jar', { one: 'bocal', other: 'bocaux' }],
  ['pack', { one: 'paquet', other: 'paquets' }],
  ['pill', { one: 'comprimé', other: 'comprimés' }],
  ['tube', { one: 'tube', other: 'tubes' }],
]);

const CATEGORY_NAMES = new Map<string, string>([
  ['produce', 'Fruits et légumes'],
  ['dairy', 'Produits laitiers'],
  ['meat', 'Viande'],
  ['fish', 'Poisson'],
  ['grains', 'Céréales et féculents'],
  ['canned', 'Conserves'],
  ['frozen', 'Surgelés'],
  ['spices', 'Épices'],
  ['beverages', 'Boissons'],
  ['medicine', 'Médicaments'],
  ['personal-care', 'Hygiène'],
  ['cleaning', 'Entretien'],
  ['other', 'Autre'],
]);

const articles = (count: number, before: string, after = ''): string =>
  plural(count, { one: `${before}# article${after}`, other: `${before}# articles${after}` });

export const fr = {
  app: {
    name: 'Pantry Pal',
  },

  nav: {
    label: 'Menu principal',
    storage: 'Réserves',
    shopping: 'Courses',
    planner: 'Planning',
    profile: 'Profil',
  },

  common: {
    cancel: 'Annuler',
    back: 'Retour',
    close: 'Fermer',
    retry: 'Réessayer',
    loading: 'Chargement…',
    comingSoon: 'Bientôt disponible',
  },

  connection: {
    idle: 'Non connecté',
    connecting: 'Connexion…',
    online: 'En direct',
    offline: 'Hors ligne',
  },

  household: {
    defaultName: 'Maison',
  },

  errors: {
    loadFailed: 'Impossible de charger vos réserves.',
    quantityNotSaved:
      'Impossible d’enregistrer la nouvelle quantité\u00A0: la quantité enregistrée est de nouveau affichée.',
    deleteFailed: (count: number) => articles(count, 'Impossible de supprimer ', '.'),
    moveFailed: (count: number) => articles(count, 'Impossible de déplacer ', '.'),
    refreshFailed: 'Impossible d’actualiser\u00A0: les dernières données reçues sont affichées.',
  },

  pending: {
    shoppingLists: 'Les listes de courses arrivent bientôt.',
  },

  categories: {
    name: (code: string, label: string): string => CATEGORY_NAMES.get(code) ?? label,
  },

  storage: {
    title: 'Réserves',
    locations: 'Emplacements',
    search: 'Rechercher des articles',
    searchPlaceholder: 'Rechercher des articles',
    clearSearch: 'Effacer la recherche',
    closeSearch: 'Fermer la recherche',
    moreActions: 'Plus d’actions',
    addItem: 'Ajouter un article',
    selectAll: 'Tout sélectionner',
    editLocations: 'Modifier les emplacements',
    refresh: 'Actualiser',
    itemCount: (count: number) => articles(count, ''),
    matchCount: (count: number) => plural(count, { one: '# résultat', other: '# résultats' }),
    emptyLocation: (location: string) => `Rien dans ${q(location)} pour l’instant.`,
    noMatches: (query: string, location: string) =>
      `Rien dans ${q(location)} ne correspond à ${q(query)}.`,
    noLocations: 'Ce foyer n’a pas encore d’emplacement.',
    fallbackLocation: 'Autre',
  },

  sort: {
    menu: 'Trier par',
    current: (field: string) => `Tri\u00A0: ${field}`,
    fields: {
      name: 'Nom',
      expiry: 'Date de péremption',
      quantity: 'Quantité',
      size: 'Taille',
      added: 'Ajouts récents',
    },
    ascending: 'Ordre croissant',
    descending: 'Ordre décroissant',
  },

  selection: {
    toolbar: 'Articles sélectionnés',
    count: (count: number) => plural(count, { one: '# sélectionné', other: '# sélectionnés' }),
    clear: 'Effacer la sélection',
    delete: 'Supprimer la sélection',
    addToShoppingList: 'Ajouter la sélection à une liste de courses',
    move: 'Déplacer la sélection vers un autre emplacement',
  },

  item: {
    select: (name: string) => `Sélectionner ${q(name)}`,
    expiryBadge: (days: number) => `${formatNumber(days)}\u00A0j`,
    expiryDescription,
    amount: (quantity: number, unit: string) => `${formatNumber(quantity)}\u00A0${unit}`,
    amountWithSize: (quantity: number, unit: string, size: number, sizeUnit: string) =>
      `${formatNumber(quantity)}\u00A0${unit} ×\u00A0${formatNumber(size)}\u00A0${sizeUnit}`,
    sizeWithCount: (quantity: number, size: number, sizeUnit: string) =>
      `${formatNumber(quantity)} ×\u00A0${formatNumber(size)}\u00A0${sizeUnit}`,
    quantity: (name: string) => `Quantité de ${q(name)}`,
    increase: (name: string) => `Augmenter la quantité de ${q(name)}`,
    decrease: (name: string) => `Diminuer la quantité de ${q(name)}`,
    remove: (name: string) => `Retirer ${q(name)}`,
  },

  removeSheet: {
    title: (name: string) => `Retirer ${q(name)}\u202F?`,
    usedIt: 'Déjà utilisé\u00A0: l’ajouter à la liste de courses',
    justDelete: 'Simplement le supprimer',
  },

  deleteSheet: {
    title: (count: number) => articles(count, 'Supprimer ', '\u202F?'),
    confirm: 'Supprimer',
  },

  moveSheet: {
    title: (count: number) => articles(count, 'Déplacer ', ' vers'),
  },

  locationEditor: {
    title: 'Modifier les emplacements',
    name: 'Nom de l’emplacement',
    newPlaceholder: 'Nom du nouvel emplacement',
    unnamed: 'Nouvel emplacement',
    add: 'Ajouter un emplacement',
    limitReached: (max: number) => `Un foyer peut avoir jusqu’à ${formatNumber(max)} emplacements.`,
    remove: (name: string) => `Supprimer ${q(name)}`,
    restore: (name: string) => `Conserver ${q(name)}`,
    deletedOnSave: 'Supprimé à l’enregistrement.',
    moveItemsTo: (count: number) =>
      plural(count, {
        one: 'Supprimé à l’enregistrement. Déplacer son article vers',
        other: 'Supprimé à l’enregistrement. Déplacer ses # articles vers',
      }),
    nowhereToMove: (count: number) =>
      plural(count, {
        one: 'Son article a besoin d’un autre emplacement enregistré.',
        other: 'Ses # articles ont besoin d’un autre emplacement enregistré.',
      }),
    nameRequired: 'Saisissez un nom.',
    nameTaken: 'Un autre emplacement porte déjà ce nom.',
    fallbackHint:
      'Ne peut être ni renommé ni supprimé\u00A0: les articles des emplacements supprimés arrivent ici.',
    save: 'Enregistrer',
    saving: 'Enregistrement…',
    saveFailed: 'Impossible d’enregistrer les emplacements.',
    changedElsewhere:
      'Quelqu’un d’autre a modifié les emplacements pendant votre modification. Ses changements figurent maintenant dans la liste\u00A0: vérifiez-la et enregistrez à nouveau.',
    reorder: (name: string) => `Réorganiser ${q(name)}`,
    sortable: 'déplaçable',
    dragInstructions:
      'Pour réorganiser un emplacement, appuyez sur Espace ou Entrée sur sa poignée, déplacez-le avec les flèches haut et bas, puis appuyez de nouveau sur Espace ou Entrée pour le déposer. Appuyez sur Échap pour annuler.',
    pickedUp: (name: string, position: number, total: number) =>
      `${q(name)} saisi, en position ${formatNumber(position)} sur ${formatNumber(total)}.`,
    movedTo: (name: string, position: number, total: number) =>
      `${q(name)} déplacé en position ${formatNumber(position)} sur ${formatNumber(total)}.`,
    dropped: (name: string, position: number, total: number) =>
      `${q(name)} déposé en position ${formatNumber(position)} sur ${formatNumber(total)}.`,
    dropCancelled: (name: string) => `Réorganisation annulée. ${q(name)} est revenu à sa place.`,
  },

  addItem: {
    title: 'Ajouter un article',
    submit: 'Ajouter',
    submitting: 'Ajout…',
  },

  units: {
    countNoun: (code: string, count: number, label: string): string => {
      const forms = COUNT_NOUNS.get(code);
      return forms === undefined ? label : plural(count, forms);
    },
    symbol: (_code: string, label: string): string => label,
    kinds: {
      mass: 'Poids',
      volume: 'Volume',
      count: 'Nombre',
    },
  },

  itemForm: {
    name: 'Nom',
    namePlaceholder: 'Lait entier',
    location: 'Emplacement',
    category: 'Catégorie',
    edible: 'Comestible',
    quantity: 'Quantité',
    howMany: 'Combien',
    decreaseQuantity: 'Diminuer la quantité',
    increaseQuantity: 'Augmenter la quantité',
    unit: 'Unité',
    sizeValue: 'Contenu de chacun',
    sizeHint: 'Facultatif\u00A0: ce que contient un exemplaire, par exemple 400 g.',
    sizeUnit: 'Unité du contenu',
    noSizeUnit: 'Aucune unité',
    expires: 'Date de péremption',
    clearExpires: 'Effacer la date de péremption',
    opened: 'Ouvert le',
    openedToday: 'Aujourd’hui',
    clearOpened: 'Effacer la date d’ouverture',
    periodAfterOpening: 'À consommer dans les (jours après ouverture)',
    notes: 'Notes',
    conflict: (fields: string) =>
      `Quelqu’un d’autre a modifié ${fields} pendant votre modification. L’enregistrement conserve vos valeurs.`,
  },

  fieldErrors: {
    generic: 'Vérifiez cette valeur.',
    name: 'Saisissez un nom.',
    locationId: 'Choisissez un emplacement.',
    category: 'Choisissez une catégorie.',
    quantity: (min: number, max: number) =>
      `Saisissez un nombre entier de ${formatNumber(min)} à ${formatNumber(max)}.`,
    unit: 'Choisissez une unité.',
    sizeValue: (max: number, decimals: number) =>
      `Saisissez un nombre supérieur à 0, jusqu’à ${formatNumber(max)}, avec au plus ${formatNumber(decimals)} décimales.`,
    sizeUnit: 'Choisissez une unité.',
    sizeUnitRequired: 'Choisissez une unité pour le contenu.',
    sizeValueRequired: 'Saisissez le contenu ou effacez son unité.',
    date: 'Saisissez une date valide.',
    openedInFuture: 'La date d’ouverture ne peut pas être dans le futur.',
    periodAfterOpeningDays: (max: number) =>
      `Saisissez un nombre entier de jours de 1 à ${formatNumber(max)}.`,
    notes: (max: number) => `Les notes sont limitées à ${formatNumber(max)} caractères.`,
  },

  itemDetails: {
    edit: 'Modifier',
    editTitle: 'Modifier l’article',
    save: 'Enregistrer',
    saving: 'Enregistrement…',
    details: 'Détails',
    quantity: 'Quantité',
    expiry: 'Péremption',
    noExpiry: 'Pas de date de péremption',
    printedDate: 'Date imprimée',
    opened: 'Ouvert le',
    notOpened: 'Pas encore ouvert',
    useWithin: 'À consommer dans les',
    useWithinDays: (days: number) =>
      plural(days, { one: '# jour après ouverture', other: '# jours après ouverture' }),
    notSet: 'Non renseigné',
    openedSooner: 'L’ouverture a avancé la péremption par rapport à la date imprimée.',
    markOpened: 'Marquer comme ouvert aujourd’hui',
    notes: 'Notes',
    added: 'Ajouté le',
    updated: 'Modifié le',
    remove: 'Retirer l’article',
  },

  discardSheet: {
    title: 'Abandonner vos modifications\u202F?',
    discard: 'Abandonner',
    keepEditing: 'Continuer la modification',
  },

  profile: {
    title: 'Profil',
    email: 'E-mail',
    household: 'Foyer',
    language: 'Langue',
    languageHint: 'La page se recharge dans la langue choisie.',
    languageFailed: 'Impossible de changer la langue.',
  },

  details: {
    title: 'Informations',
    name: 'Nom',
    nameHint: 'Visible par les personnes avec qui vous partagez un foyer.',
    birthDate: 'Date de naissance',
    birthDateHint: 'Personne d’autre ne la voit.',
    clearBirthDate: 'Effacer la date de naissance',
    units: 'Unités',
    unitSystems: {
      metric: { name: 'Métrique', examples: 'g, kg, ml, l' },
      imperial: { name: 'Impérial', examples: 'oz, lb, fl oz, cup' },
    },
    householdName: 'Nom du foyer',
    save: 'Enregistrer les modifications',
    saving: 'Enregistrement…',
    saved: 'Informations enregistrées.',
    fieldErrors: {
      displayName: (max: number) =>
        `Saisissez un nom de ${formatNumber(max)} caractères au maximum.`,
      birthDate: (fromYear: string) =>
        `Saisissez une date comprise entre ${fromYear} et aujourd’hui.`,
      householdName: (max: number) =>
        `Saisissez un nom de ${formatNumber(max)} caractères au maximum.`,
    },
  },

  auth: {
    signInTitle: 'Connexion',
    signUpTitle: 'Créer un compte',
    step: (current: number, total: number) =>
      `Étape ${formatNumber(current)} sur ${formatNumber(total)}`,
    email: 'E-mail',
    password: 'Mot de passe',
    passwordHint: (min: number) =>
      plural(min, { one: 'Au moins # caractère.', other: 'Au moins # caractères.' }),
    continueWithGoogle: 'Continuer avec Google',
    continueWithEmail: 'Continuer avec l’e-mail',
    otherMethods: 'Autres moyens de connexion',
    otherSignUpMethods: 'Autres moyens d’inscription',
    continue: 'Continuer',
    changeEmail: 'Modifier l’e-mail',
    signIn: 'Se connecter',
    signingIn: 'Connexion…',
    signUp: 'Créer le compte',
    signingUp: 'Création du compte…',
    noAccount: 'Pas encore de compte ?',
    toSignUp: 'Créez-en un',
    haveAccount: 'Vous avez déjà un compte ?',
    toSignIn: 'Connectez-vous',
    signOut: 'Se déconnecter',
    signingOut: 'Déconnexion…',
    invalidCredentials: 'E-mail ou mot de passe incorrect.',
    emailTaken: 'Un compte existe déjà avec cet e-mail.',
    tooManyAttempts: 'Trop de tentatives. Attendez une minute, puis réessayez.',
    offline: 'Impossible de joindre le serveur. Vérifiez votre connexion, puis réessayez.',
    failed: 'Une erreur s’est produite. Réessayez.',
    sessionEnded: 'Votre session a pris fin. Reconnectez-vous pour continuer.',
    fieldErrors: {
      email: 'Saisissez une adresse e-mail.',
      passwordRequired: 'Saisissez votre mot de passe.',
      password: (min: number, max: number) =>
        `Utilisez de ${formatNumber(min)} à ${formatNumber(max)} caractères.`,
    },
    dev: {
      hint: 'Connecte n’importe quelle adresse e-mail sans mot de passe, tant que le backend tourne avec DEV_AUTH=true.',
      submit: 'Se connecter sans mot de passe',
      unavailable: 'Le backend ne tourne pas avec DEV_AUTH=true.',
    },
  },

  welcome: {
    title: (app: string) => `Bienvenue dans ${app}`,
    intro:
      'Quelques questions facultatives. Vous pourrez modifier vos réponses plus tard dans votre profil.',
    storageSpaces: 'Emplacements',
    storageSpacesHint: (fallback: string) =>
      `Décochez ceux dont vous n’avez pas besoin. ${q(fallback)} reste toujours et reçoit le contenu d’un emplacement supprimé.`,
    finish: 'Terminer',
    finishing: 'Enregistrement…',
    skip: 'Passer',
  },

  changePassword: {
    title: 'Mot de passe',
    current: 'Mot de passe actuel',
    next: 'Nouveau mot de passe',
    submit: 'Changer le mot de passe',
    saving: 'Modification…',
    changed: 'Mot de passe modifié. Vos autres appareils ont été déconnectés.',
    incorrect: 'Le mot de passe actuel est incorrect.',
    sameAsCurrent: 'Choisissez un mot de passe différent de l’actuel.',
    currentRequired: 'Saisissez votre mot de passe actuel.',
  },

  shopping: {
    title: 'Courses',
    description: 'Les listes de courses arrivent bientôt.',
  },

  planner: {
    title: 'Planning',
    description: 'La planification des repas arrive bientôt.',
  },
} satisfies Messages;
