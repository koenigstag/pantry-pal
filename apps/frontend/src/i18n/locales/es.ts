import { formatNumber, plural, type PluralForms } from '../format';
import type { Messages } from '../messages';

/*
 * Spanish, as written in Spain (`es-ES`). Every key of the English catalog,
 * checked by `satisfies Messages`. Plurals take `one` (1) and `other`, as
 * `Intl.PluralRules('es')` picks them; `many` (round millions) falls back to
 * `other`.
 *
 * Instructions use the familiar imperative ("Introduce un nombre."), and typed
 * names are quoted «like this».
 */

function expiryDescription(days: number): string {
  if (days < 0) {
    return plural(-days, { one: 'Caducó hace # día', other: 'Caducó hace # días' });
  }
  if (days === 0) return 'Caduca hoy';
  return plural(days, { one: 'Caduca en # día', other: 'Caduca en # días' });
}

const COUNT_NOUNS = new Map<string, PluralForms>([
  ['pcs', { one: 'ud.', other: 'uds.' }],
  ['bag', { one: 'bolsa', other: 'bolsas' }],
  ['blister', { one: 'blíster', other: 'blísteres' }],
  ['bottle', { one: 'botella', other: 'botellas' }],
  ['box', { one: 'caja', other: 'cajas' }],
  ['can', { one: 'lata', other: 'latas' }],
  ['jar', { one: 'tarro', other: 'tarros' }],
  ['pack', { one: 'paquete', other: 'paquetes' }],
  ['pill', { one: 'pastilla', other: 'pastillas' }],
  ['tube', { one: 'tubo', other: 'tubos' }],
]);

const CATEGORY_NAMES = new Map<string, string>([
  ['produce', 'Frutas y verduras'],
  ['dairy', 'Lácteos'],
  ['meat', 'Carne'],
  ['fish', 'Pescado'],
  ['grains', 'Cereales y harinas'],
  ['canned', 'Conservas'],
  ['frozen', 'Congelados'],
  ['spices', 'Especias'],
  ['beverages', 'Bebidas'],
  ['medicine', 'Medicamentos'],
  ['personal-care', 'Higiene personal'],
  ['cleaning', 'Limpieza'],
  ['other', 'Otros'],
]);

const articles = (count: number, before: string, after = ''): string =>
  plural(count, { one: `${before}# artículo${after}`, other: `${before}# artículos${after}` });

export const es = {
  app: {
    name: 'Pantry Pal',
  },

  nav: {
    label: 'Menú principal',
    storage: 'Despensa',
    shopping: 'Compras',
    planner: 'Planificador',
    profile: 'Perfil',
  },

  common: {
    cancel: 'Cancelar',
    back: 'Atrás',
    close: 'Cerrar',
    retry: 'Reintentar',
    loading: 'Cargando…',
    comingSoon: 'Próximamente',
  },

  connection: {
    idle: 'No conectado',
    connecting: 'Conectando…',
    online: 'En directo',
    offline: 'Sin conexión',
  },

  household: {
    defaultName: 'Casa',
  },

  errors: {
    loadFailed: 'No se ha podido cargar la despensa.',
    quantityNotSaved:
      'No se ha podido guardar la nueva cantidad, así que se vuelve a mostrar la guardada.',
    deleteFailed: (count: number) =>
      plural(count, {
        one: 'No se ha podido eliminar # artículo.',
        other: 'No se han podido eliminar # artículos.',
      }),
    moveFailed: (count: number) =>
      plural(count, {
        one: 'No se ha podido mover # artículo.',
        other: 'No se han podido mover # artículos.',
      }),
    refreshFailed: 'No se ha podido actualizar, así que se muestran los últimos datos recibidos.',
  },

  pending: {
    shoppingLists: 'Las listas de la compra llegarán pronto.',
  },

  categories: {
    name: (code: string, label: string): string => CATEGORY_NAMES.get(code) ?? label,
  },

  storage: {
    title: 'Despensa',
    locations: 'Lugares de almacenamiento',
    search: 'Buscar artículos',
    searchPlaceholder: 'Buscar artículos',
    clearSearch: 'Borrar búsqueda',
    closeSearch: 'Cerrar búsqueda',
    moreActions: 'Más acciones',
    addItem: 'Añadir artículo',
    selectAll: 'Seleccionar todo',
    editLocations: 'Editar lugares de almacenamiento',
    refresh: 'Actualizar',
    itemCount: (count: number) => articles(count, ''),
    matchCount: (count: number) =>
      plural(count, { one: '# coincidencia', other: '# coincidencias' }),
    emptyLocation: (location: string) => `Todavía no hay nada en «${location}».`,
    noMatches: (query: string, location: string) =>
      `Nada en «${location}» coincide con «${query}».`,
    noLocations: 'Este hogar todavía no tiene lugares de almacenamiento.',
    fallbackLocation: 'Otros',
  },

  sort: {
    menu: 'Ordenar por',
    current: (field: string) => `Orden: ${field}`,
    fields: {
      name: 'Nombre',
      expiry: 'Caducidad',
      quantity: 'Cantidad',
      size: 'Tamaño',
      added: 'Añadidos recientemente',
    },
    ascending: 'Orden ascendente',
    descending: 'Orden descendente',
  },

  selection: {
    toolbar: 'Artículos seleccionados',
    count: (count: number) => plural(count, { one: '# seleccionado', other: '# seleccionados' }),
    clear: 'Borrar la selección',
    delete: 'Eliminar la selección',
    addToShoppingList: 'Añadir la selección a una lista de la compra',
    move: 'Mover la selección a otro lugar',
  },

  item: {
    select: (name: string) => `Seleccionar «${name}»`,
    expiryBadge: (days: number) => `${formatNumber(days)}\u00A0d`,
    expiryDescription,
    amount: (quantity: number, unit: string) => `${formatNumber(quantity)}\u00A0${unit}`,
    amountWithSize: (quantity: number, unit: string, size: number, sizeUnit: string) =>
      `${formatNumber(quantity)}\u00A0${unit} ×\u00A0${formatNumber(size)}\u00A0${sizeUnit}`,
    sizeWithCount: (quantity: number, size: number, sizeUnit: string) =>
      `${formatNumber(quantity)} ×\u00A0${formatNumber(size)}\u00A0${sizeUnit}`,
    quantity: (name: string) => `Cantidad de «${name}»`,
    increase: (name: string) => `Aumentar la cantidad de «${name}»`,
    decrease: (name: string) => `Reducir la cantidad de «${name}»`,
    remove: (name: string) => `Quitar «${name}»`,
  },

  removeSheet: {
    title: (name: string) => `¿Quitar «${name}»?`,
    usedIt: 'Ya lo he usado; añadirlo a la lista de la compra',
    justDelete: 'Solo quiero eliminarlo',
  },

  deleteSheet: {
    title: (count: number) => articles(count, '¿Eliminar ', '?'),
    confirm: 'Eliminar',
  },

  moveSheet: {
    title: (count: number) => articles(count, 'Mover ', ' a'),
  },

  locationEditor: {
    title: 'Editar lugares de almacenamiento',
    name: 'Nombre del lugar',
    newPlaceholder: 'Nombre del lugar nuevo',
    unnamed: 'Lugar nuevo',
    add: 'Añadir lugar',
    limitReached: (max: number) =>
      `Un hogar puede tener hasta ${formatNumber(max)} lugares de almacenamiento.`,
    remove: (name: string) => `Eliminar «${name}»`,
    restore: (name: string) => `Conservar «${name}»`,
    deletedOnSave: 'Se eliminará al guardar.',
    moveItemsTo: (count: number) =>
      plural(count, {
        one: 'Se eliminará al guardar. Mover su artículo a',
        other: 'Se eliminará al guardar. Mover sus # artículos a',
      }),
    nowhereToMove: (count: number) =>
      plural(count, {
        one: 'Su artículo necesita otro lugar guardado al que moverse.',
        other: 'Sus # artículos necesitan otro lugar guardado al que moverse.',
      }),
    nameRequired: 'Introduce un nombre.',
    nameTaken: 'Ya hay otro lugar con este nombre.',
    fallbackHint:
      'No se puede renombrar ni eliminar: aquí van los artículos de los lugares eliminados.',
    save: 'Guardar',
    saving: 'Guardando…',
    saveFailed: 'No se han podido guardar los lugares de almacenamiento.',
    changedElsewhere:
      'Otra persona ha cambiado los lugares mientras editabas. Sus cambios ya están en la lista: revísala y vuelve a guardar.',
    reorder: (name: string) => `Reordenar «${name}»`,
    sortable: 'reordenable',
    dragInstructions:
      'Para reordenar un lugar, pulsa Espacio o Intro en su asa, muévelo con las flechas arriba y abajo y vuelve a pulsar Espacio o Intro para soltarlo. Pulsa Escape para cancelar.',
    pickedUp: (name: string, position: number, total: number) =>
      `«${name}» seleccionado, en la posición ${formatNumber(position)} de ${formatNumber(total)}.`,
    movedTo: (name: string, position: number, total: number) =>
      `«${name}» movido a la posición ${formatNumber(position)} de ${formatNumber(total)}.`,
    dropped: (name: string, position: number, total: number) =>
      `«${name}» soltado en la posición ${formatNumber(position)} de ${formatNumber(total)}.`,
    dropCancelled: (name: string) => `Reordenación cancelada. «${name}» ha vuelto a su sitio.`,
  },

  addItem: {
    title: 'Añadir artículo',
    submit: 'Añadir',
    submitting: 'Añadiendo…',
  },

  units: {
    countNoun: (code: string, count: number, label: string): string => {
      const forms = COUNT_NOUNS.get(code);
      return forms === undefined ? label : plural(count, forms);
    },
    symbol: (_code: string, label: string): string => label,
    kinds: {
      mass: 'Peso',
      volume: 'Volumen',
      count: 'Cantidad',
    },
  },

  itemForm: {
    name: 'Nombre',
    namePlaceholder: 'Leche entera',
    location: 'Lugar',
    category: 'Categoría',
    edible: 'Comestible',
    quantity: 'Cantidad',
    howMany: 'Cuántos',
    decreaseQuantity: 'Reducir la cantidad',
    increaseQuantity: 'Aumentar la cantidad',
    unit: 'Unidad',
    sizeValue: 'Contenido de cada uno',
    sizeHint: 'Opcional: lo que contiene cada uno, por ejemplo 400 g.',
    sizeUnit: 'Unidad del contenido',
    noSizeUnit: 'Sin unidad',
    expires: 'Fecha de caducidad',
    clearExpires: 'Borrar la fecha de caducidad',
    opened: 'Abierto el',
    openedToday: 'Hoy',
    clearOpened: 'Borrar la fecha de apertura',
    periodAfterOpening: 'Consumir en (días tras abrirlo)',
    notes: 'Notas',
    conflict: (fields: string) =>
      `Otra persona ha cambiado ${fields} mientras editabas. Al guardar se conservarán tus valores.`,
  },

  fieldErrors: {
    generic: 'Revisa este valor.',
    name: 'Introduce un nombre.',
    locationId: 'Elige un lugar.',
    category: 'Elige una categoría.',
    quantity: (min: number, max: number) =>
      `Introduce un número entero de ${formatNumber(min)} a ${formatNumber(max)}.`,
    unit: 'Elige una unidad.',
    sizeValue: (max: number, decimals: number) =>
      `Introduce un número mayor que 0, hasta ${formatNumber(max)}, con ${formatNumber(decimals)} decimales como máximo.`,
    sizeUnit: 'Elige una unidad.',
    sizeUnitRequired: 'Elige una unidad para el contenido.',
    sizeValueRequired: 'Introduce el contenido o borra su unidad.',
    date: 'Introduce una fecha válida.',
    openedInFuture: 'La fecha de apertura no puede ser futura.',
    periodAfterOpeningDays: (max: number) =>
      `Introduce un número entero de días de 1 a ${formatNumber(max)}.`,
    notes: (max: number) => `Las notas pueden tener ${formatNumber(max)} caracteres como máximo.`,
  },

  itemDetails: {
    edit: 'Editar',
    editTitle: 'Editar artículo',
    save: 'Guardar',
    saving: 'Guardando…',
    details: 'Detalles',
    quantity: 'Cantidad',
    expiry: 'Caducidad',
    noExpiry: 'Sin fecha de caducidad',
    printedDate: 'Fecha impresa',
    opened: 'Abierto',
    notOpened: 'Aún no abierto',
    useWithin: 'Consumir en',
    useWithinDays: (days: number) =>
      plural(days, { one: '# día tras abrirlo', other: '# días tras abrirlo' }),
    notSet: 'Sin definir',
    openedSooner: 'Abrirlo ha adelantado la caducidad respecto a la fecha impresa.',
    markOpened: 'Marcar como abierto hoy',
    notes: 'Notas',
    added: 'Añadido',
    updated: 'Última actualización',
    remove: 'Quitar artículo',
  },

  discardSheet: {
    title: '¿Descartar los cambios?',
    discard: 'Descartar',
    keepEditing: 'Seguir editando',
  },

  profile: {
    title: 'Perfil',
    name: 'Nombre',
    email: 'Correo electrónico',
    household: 'Hogar',
    language: 'Idioma',
    languageHint: 'La página se volverá a cargar en el idioma elegido.',
    languageFailed: 'No se ha podido cambiar el idioma.',
  },

  auth: {
    signInTitle: 'Iniciar sesión',
    signUpTitle: 'Crear una cuenta',
    email: 'Correo electrónico',
    password: 'Contraseña',
    displayName: 'Nombre',
    displayNameHint: 'Opcional. Lo ven las personas con las que compartes un hogar.',
    passwordHint: (min: number) =>
      plural(min, { one: 'Al menos # carácter.', other: 'Al menos # caracteres.' }),
    signIn: 'Iniciar sesión',
    signingIn: 'Iniciando sesión…',
    signUp: 'Crear cuenta',
    signingUp: 'Creando cuenta…',
    noAccount: '¿Aún no tienes cuenta?',
    toSignUp: 'Crea una',
    haveAccount: '¿Ya tienes cuenta?',
    toSignIn: 'Inicia sesión',
    signOut: 'Cerrar sesión',
    signingOut: 'Cerrando sesión…',
    invalidCredentials: 'El correo electrónico o la contraseña no son correctos.',
    emailTaken: 'Ya existe una cuenta con este correo electrónico.',
    tooManyAttempts: 'Demasiados intentos. Espera un minuto y vuelve a intentarlo.',
    offline:
      'No se ha podido conectar con el servidor. Comprueba la conexión y vuelve a intentarlo.',
    failed: 'Algo ha salido mal. Vuelve a intentarlo.',
    sessionEnded: 'Tu sesión ha terminado. Vuelve a iniciar sesión para continuar.',
    fieldErrors: {
      email: 'Introduce una dirección de correo electrónico.',
      passwordRequired: 'Introduce tu contraseña.',
      password: (min: number, max: number) =>
        `Usa entre ${formatNumber(min)} y ${formatNumber(max)} caracteres.`,
      displayName: (max: number) =>
        `El nombre puede tener ${formatNumber(max)} caracteres como máximo.`,
    },
    dev: {
      title: 'Desarrollo',
      hint: 'Inicia sesión con cualquier correo electrónico, sin contraseña, mientras el backend se ejecute con DEV_AUTH=true.',
      submit: 'Iniciar sesión sin contraseña',
      unavailable: 'El backend no se está ejecutando con DEV_AUTH=true.',
    },
  },

  changePassword: {
    title: 'Contraseña',
    current: 'Contraseña actual',
    next: 'Nueva contraseña',
    submit: 'Cambiar contraseña',
    saving: 'Cambiando…',
    changed: 'Contraseña cambiada. Se ha cerrado la sesión en tus otros dispositivos.',
    incorrect: 'La contraseña actual no es correcta.',
    sameAsCurrent: 'Elige una contraseña distinta de la actual.',
    currentRequired: 'Introduce tu contraseña actual.',
  },

  shopping: {
    title: 'Compras',
    description: 'Las listas de la compra llegarán pronto.',
  },

  planner: {
    title: 'Planificador',
    description: 'La planificación de comidas llegará pronto.',
  },
} satisfies Messages;
