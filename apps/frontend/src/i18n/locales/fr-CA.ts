import { formatNumber, plural } from '../format';
import type { Messages } from '../messages';
import { fr } from './fr';

/*
 * Canadian French: the French catalog with Quebec usage over it, checked like
 * every other by `satisfies Messages`. Plurals are France's.
 *
 * What differs is vocabulary — l’épicerie, le courriel, le garde-manger — and
 * typography: Quebec keeps the no-break space before `:` but sets `?` and `!`
 * straight after the word. Everything not overridden reads the same in both.
 */

/** Only the names Quebec says differently; the rest are France's. */
const CATEGORY_NAMES = new Map<string, string>([
  ['personal-care', 'Soins personnels'],
  ['cleaning', 'Entretien ménager'],
]);

const q = (text: string): string => `«\u00A0${text}\u00A0»`;

export const frCA = {
  ...fr,

  nav: {
    ...fr.nav,
    storage: 'Garde-manger',
    shopping: 'Épicerie',
    planner: 'Planification',
  },

  errors: {
    ...fr.errors,
    loadFailed: 'Impossible de charger votre garde-manger.',
  },

  categories: {
    name: (code: string, label: string): string =>
      CATEGORY_NAMES.get(code) ?? fr.categories.name(code, label),
  },

  storage: {
    ...fr.storage,
    title: 'Garde-manger',
  },

  selection: {
    ...fr.selection,
    addToShoppingList: 'Ajouter la sélection à une liste d’épicerie',
  },

  removeSheet: {
    ...fr.removeSheet,
    title: (name: string) => `Retirer ${q(name)}?`,
    usedIt: 'Déjà utilisé\u00A0: l’ajouter à la liste d’épicerie',
  },

  itemForm: {
    ...fr.itemForm,
    shoppingList: 'Liste d’épicerie',
  },

  fieldErrors: {
    ...fr.fieldErrors,
    defaultShoppingListId: 'Choisissez une liste d’épicerie.',
  },

  itemDetails: {
    ...fr.itemDetails,
    shopping: 'Épicerie',
    addToList: 'Ajouter à une liste d’épicerie',
  },

  deleteSheet: {
    ...fr.deleteSheet,
    title: (count: number) =>
      plural(count, { one: 'Supprimer # article?', other: 'Supprimer # articles?' }),
  },

  discardSheet: {
    ...fr.discardSheet,
    title: 'Abandonner vos modifications?',
  },

  profile: {
    ...fr.profile,
    email: 'Courriel',
  },

  auth: {
    ...fr.auth,
    email: 'Courriel',
    continueWithEmail: 'Continuer avec le courriel',
    changeEmail: 'Modifier le courriel',
    noAccount: 'Pas encore de compte?',
    haveAccount: 'Vous avez déjà un compte?',
    invalidCredentials: 'Courriel ou mot de passe incorrect.',
    emailTaken: 'Un compte existe déjà avec ce courriel.',
    fieldErrors: {
      ...fr.auth.fieldErrors,
      email: 'Saisissez une adresse courriel.',
    },
    dev: {
      ...fr.auth.dev,
      hint: 'Connecte n’importe quelle adresse courriel sans mot de passe, tant que le backend tourne avec DEV_AUTH=true.',
    },
  },

  shopping: {
    ...fr.shopping,
    title: 'Épicerie',
    lists: 'Listes d’épicerie',
    editLists: 'Modifier les listes d’épicerie',
    defaultListName: 'Ma liste d’épicerie',
    nameTaken: 'Une autre liste d’épicerie porte déjà ce nom.',
    limitReached: (max: number) =>
      `Un foyer peut avoir jusqu’à ${formatNumber(max)} listes d’épicerie.`,
    noLists: 'Aucune liste d’épicerie pour l’instant.',
    createFirst: 'Créer une liste d’épicerie',
    emptyHint:
      'Dans Garde-manger, sélectionnez des articles ou ouvrez-en un, puis ajoutez-le à une liste.',
    markedBought: (count: number) =>
      plural(count, {
        one: '# article est de retour au garde-manger.',
        other: '# articles sont de retour au garde-manger.',
      }),
  },

  shoppingListEditor: {
    ...fr.shoppingListEditor,
    title: 'Modifier les listes d’épicerie',
    name: 'Nom de la liste d’épicerie',
    empty: 'Aucune liste d’épicerie pour l’instant.',
    limitReached: (max: number) =>
      `Un foyer peut avoir jusqu’à ${formatNumber(max)} listes d’épicerie, archivées comprises.`,
    nameTaken: 'Une autre liste d’épicerie porte déjà ce nom.',
    saveFailed: 'Impossible d’enregistrer les listes d’épicerie.',
    changedElsewhere:
      'Quelqu’un d’autre a modifié les listes d’épicerie pendant votre modification. Ses changements figurent maintenant dans la liste\u00A0: vérifiez-la et enregistrez à nouveau.',
  },

  data: {
    ...fr.data,
    exportFailed: 'Impossible d’exporter votre garde-manger.',
  },

  planner: {
    ...fr.planner,
    title: 'Planification',
  },
} satisfies Messages;
