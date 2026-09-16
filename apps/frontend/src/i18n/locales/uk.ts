import { formatNumber, plural, type PluralForms } from '../format';
import type { Messages } from '../messages';

/*
 * Ukrainian. Every key of the English catalog, checked by `satisfies Messages`.
 * Plurals take `one` (1, 21), `few` (2–4, 22–24), `many` (0, 5–20) and `other`
 * (fractions), as `Intl.PluralRules('uk')` picks them.
 *
 * Names the household typed are quoted «like this», so a sentence never has to
 * decline a word it did not write.
 */

function expiryDescription(days: number): string {
  if (days < 0) {
    return plural(-days, {
      one: 'Прострочено # день тому',
      few: 'Прострочено # дні тому',
      many: 'Прострочено # днів тому',
      other: 'Прострочено # дня тому',
    });
  }
  if (days === 0) return 'Спливає сьогодні';
  return plural(days, {
    one: 'Спливає через # день',
    few: 'Спливає через # дні',
    many: 'Спливає через # днів',
    other: 'Спливає через # дня',
  });
}

const COUNT_NOUNS = new Map<string, PluralForms>([
  ['pcs', { other: 'шт.' }],
  ['bag', { one: 'пакет', few: 'пакети', many: 'пакетів', other: 'пакета' }],
  ['blister', { one: 'блістер', few: 'блістери', many: 'блістерів', other: 'блістера' }],
  ['bottle', { one: 'пляшка', few: 'пляшки', many: 'пляшок', other: 'пляшки' }],
  ['box', { one: 'коробка', few: 'коробки', many: 'коробок', other: 'коробки' }],
  ['can', { one: 'бляшанка', few: 'бляшанки', many: 'бляшанок', other: 'бляшанки' }],
  ['jar', { one: 'банка', few: 'банки', many: 'банок', other: 'банки' }],
  ['pack', { one: 'упаковка', few: 'упаковки', many: 'упаковок', other: 'упаковки' }],
  ['pill', { one: 'таблетка', few: 'таблетки', many: 'таблеток', other: 'таблетки' }],
  ['tube', { one: 'тюбик', few: 'тюбики', many: 'тюбиків', other: 'тюбика' }],
]);

/** Metric symbols only: imperial units keep their conventional English abbreviations. */
const UNIT_SYMBOLS = new Map<string, string>([
  ['g', 'г'],
  ['kg', 'кг'],
  ['ml', 'мл'],
  ['l', 'л'],
]);

const CATEGORY_NAMES = new Map<string, string>([
  ['produce', 'Овочі та фрукти'],
  ['dairy', 'Молочні продукти'],
  ['meat', 'М’ясо'],
  ['fish', 'Риба'],
  ['grains', 'Крупи та борошняне'],
  ['canned', 'Консерви'],
  ['frozen', 'Заморожене'],
  ['spices', 'Спеції'],
  ['beverages', 'Напої'],
  ['medicine', 'Ліки'],
  ['personal-care', 'Особиста гігієна'],
  ['cleaning', 'Побутова хімія'],
  ['other', 'Інше'],
]);

const items = (count: number, before: string, after = ''): string =>
  plural(count, {
    one: `${before}# предмет${after}`,
    few: `${before}# предмети${after}`,
    many: `${before}# предметів${after}`,
    other: `${before}# предмета${after}`,
  });

export const uk = {
  app: {
    name: 'Pantry Pal',
  },

  nav: {
    label: 'Головне меню',
    storage: 'Зберігання',
    shopping: 'Покупки',
    planner: 'Планувальник',
    profile: 'Профіль',
  },

  common: {
    cancel: 'Скасувати',
    back: 'Назад',
    close: 'Закрити',
    retry: 'Спробувати ще раз',
    loading: 'Завантаження…',
    comingSoon: 'Незабаром',
  },

  connection: {
    idle: 'Не підключено',
    connecting: 'Підключення…',
    online: 'Онлайн',
    offline: 'Офлайн',
  },

  household: {
    defaultName: 'Дім',
  },

  errors: {
    loadFailed: 'Не вдалося завантажити ваші запаси.',
    quantityNotSaved: 'Не вдалося зберегти нову кількість, тому показано збережену.',
    deleteFailed: (count: number) => items(count, 'Не вдалося видалити ', '.'),
    moveFailed: (count: number) => items(count, 'Не вдалося перемістити ', '.'),
    refreshFailed: 'Не вдалося оновити, тому показано останні отримані дані.',
  },

  pending: {
    shoppingLists: 'Списки покупок з’являться незабаром.',
  },

  categories: {
    name: (code: string, label: string): string => CATEGORY_NAMES.get(code) ?? label,
  },

  storage: {
    title: 'Зберігання',
    locations: 'Місця зберігання',
    search: 'Пошук предметів',
    searchPlaceholder: 'Пошук предметів',
    clearSearch: 'Очистити пошук',
    closeSearch: 'Закрити пошук',
    moreActions: 'Інші дії',
    addItem: 'Додати предмет',
    selectAll: 'Вибрати все',
    editLocations: 'Редагувати місця зберігання',
    refresh: 'Оновити',
    itemCount: (count: number) => items(count, ''),
    matchCount: (count: number) =>
      plural(count, { one: '# збіг', few: '# збіги', many: '# збігів', other: '# збігу' }),
    emptyLocation: (location: string) => `Місце зберігання «${location}» поки порожнє.`,
    noMatches: (query: string, location: string) =>
      `У місці зберігання «${location}» немає збігів із «${query}».`,
    noLocations: 'У цьому домогосподарстві ще немає місць зберігання.',
    fallbackLocation: 'Інше',
  },

  sort: {
    menu: 'Сортування',
    current: (field: string) => `Сортування: ${field}`,
    fields: {
      name: 'Назва',
      expiry: 'Термін придатності',
      quantity: 'Кількість',
      size: 'Розмір',
      added: 'Нещодавно додані',
    },
    ascending: 'За зростанням',
    descending: 'За спаданням',
  },

  selection: {
    toolbar: 'Вибрані предмети',
    count: (count: number) => plural(count, { other: 'Вибрано: #' }),
    clear: 'Скасувати вибір',
    delete: 'Видалити вибрані',
    addToShoppingList: 'Додати вибрані до списку покупок',
    move: 'Перемістити вибрані в інше місце зберігання',
  },

  item: {
    select: (name: string) => `Вибрати «${name}»`,
    expiryBadge: (days: number) => `${formatNumber(days)} д`,
    expiryDescription,
    amount: (quantity: number, unit: string) => `${formatNumber(quantity)} ${unit}`,
    amountWithSize: (quantity: number, unit: string, size: number, sizeUnit: string) =>
      `${formatNumber(quantity)} ${unit} × ${formatNumber(size)} ${sizeUnit}`,
    sizeWithCount: (quantity: number, size: number, sizeUnit: string) =>
      `${formatNumber(quantity)} × ${formatNumber(size)} ${sizeUnit}`,
    quantity: (name: string) => `Кількість: «${name}»`,
    increase: (name: string) => `Збільшити кількість: «${name}»`,
    decrease: (name: string) => `Зменшити кількість: «${name}»`,
    remove: (name: string) => `Прибрати «${name}»`,
  },

  removeSheet: {
    title: (name: string) => `Прибрати «${name}»?`,
    usedIt: 'Вже використано — додати до списку покупок',
    justDelete: 'Просто видалити',
  },

  deleteSheet: {
    title: (count: number) => items(count, 'Видалити ', '?'),
    confirm: 'Видалити',
  },

  moveSheet: {
    title: (count: number) => items(count, 'Куди перемістити ', '?'),
  },

  locationEditor: {
    title: 'Редагувати місця зберігання',
    name: 'Назва місця зберігання',
    newPlaceholder: 'Назва нового місця',
    unnamed: 'Нове місце зберігання',
    add: 'Додати місце зберігання',
    limitReached: (max: number) =>
      `У домогосподарстві може бути до ${formatNumber(max)} місць зберігання.`,
    remove: (name: string) => `Видалити «${name}»`,
    restore: (name: string) => `Залишити «${name}»`,
    deletedOnSave: 'Буде видалено після збереження.',
    moveItemsTo: (count: number) =>
      items(count, 'Буде видалено після збереження. Куди перемістити ', ':'),
    nowhereToMove: (count: number) =>
      items(count, 'Потрібне інше збережене місце зберігання, куди перемістити ', '.'),
    nameRequired: 'Введіть назву.',
    nameTaken: 'Інше місце зберігання вже має таку назву.',
    fallbackHint:
      'Не можна перейменувати чи видалити: сюди переміщуються предмети з видалених місць зберігання.',
    save: 'Зберегти',
    saving: 'Збереження…',
    saveFailed: 'Не вдалося зберегти місця зберігання.',
    changedElsewhere:
      'Хтось інший змінив місця зберігання, поки ви редагували. Їхні зміни вже в списку: перевірте його та збережіть знову.',
    reorder: (name: string) => `Змінити порядок: «${name}»`,
    sortable: 'можна перемістити',
    dragInstructions:
      'Щоб змінити порядок, натисніть Пробіл або Enter на ручці, перемістіть рядок клавішами зі стрілками вгору та вниз, а потім знову натисніть Пробіл або Enter. Esc скасовує переміщення.',
    pickedUp: (name: string, position: number, total: number) =>
      `Взято «${name}», позиція ${formatNumber(position)} з ${formatNumber(total)}.`,
    movedTo: (name: string, position: number, total: number) =>
      `«${name}» тепер на позиції ${formatNumber(position)} з ${formatNumber(total)}.`,
    dropped: (name: string, position: number, total: number) =>
      `«${name}» залишено на позиції ${formatNumber(position)} з ${formatNumber(total)}.`,
    dropCancelled: (name: string) => `Переміщення скасовано. «${name}» повернуто на місце.`,
  },

  addItem: {
    title: 'Додати предмет',
    submit: 'Додати',
    submitting: 'Додавання…',
  },

  units: {
    countNoun: (code: string, count: number, label: string): string => {
      const forms = COUNT_NOUNS.get(code);
      return forms === undefined ? label : plural(count, forms);
    },
    symbol: (code: string, label: string): string => UNIT_SYMBOLS.get(code) ?? label,
    kinds: {
      mass: 'Вага',
      volume: 'Об’єм',
      count: 'Кількість',
    },
  },

  itemForm: {
    name: 'Назва',
    namePlaceholder: 'Молоко',
    location: 'Місце зберігання',
    category: 'Категорія',
    edible: 'Їстівне',
    quantity: 'Кількість',
    howMany: 'Скільки',
    decreaseQuantity: 'Зменшити кількість',
    increaseQuantity: 'Збільшити кількість',
    unit: 'Одиниця',
    sizeValue: 'В одній одиниці',
    sizeHint: 'Необов’язково: скільки вміщує одна одиниця, наприклад 400 г.',
    sizeUnit: 'Одиниця вмісту',
    noSizeUnit: 'Без одиниці',
    expires: 'Придатне до',
    clearExpires: 'Очистити дату придатності',
    opened: 'Відкрито',
    openedToday: 'Сьогодні',
    clearOpened: 'Очистити дату відкриття',
    periodAfterOpening: 'Використати протягом (днів після відкриття)',
    notes: 'Нотатки',
    conflict: (fields: string) =>
      `Хтось інший змінив поля (${fields}), поки ви редагували. Під час збереження залишаться ваші значення.`,
  },

  fieldErrors: {
    generic: 'Перевірте це значення.',
    name: 'Введіть назву.',
    locationId: 'Виберіть місце зберігання.',
    category: 'Виберіть категорію.',
    quantity: (min: number, max: number) =>
      `Введіть ціле число від ${formatNumber(min)} до ${formatNumber(max)}.`,
    unit: 'Виберіть одиницю.',
    sizeValue: (max: number, decimals: number) =>
      `Введіть число, більше за 0 і не більше за ${formatNumber(max)}, з не більше ніж ${formatNumber(decimals)} знаками після коми.`,
    sizeUnit: 'Виберіть одиницю.',
    sizeUnitRequired: 'Виберіть одиницю вмісту.',
    sizeValueRequired: 'Введіть вміст або очистьте його одиницю.',
    date: 'Введіть правильну дату.',
    openedInFuture: 'Дата відкриття не може бути в майбутньому.',
    periodAfterOpeningDays: (max: number) =>
      `Введіть ціле число днів від 1 до ${formatNumber(max)}.`,
    notes: (max: number) => `Нотатки можуть містити до ${formatNumber(max)} символів.`,
  },

  itemDetails: {
    edit: 'Редагувати',
    editTitle: 'Редагування',
    save: 'Зберегти',
    saving: 'Збереження…',
    details: 'Деталі',
    quantity: 'Кількість',
    expiry: 'Термін придатності',
    noExpiry: 'Без терміну придатності',
    printedDate: 'Дата на упаковці',
    opened: 'Відкрито',
    notOpened: 'Ще не відкрито',
    useWithin: 'Використати протягом',
    useWithinDays: (days: number) =>
      plural(days, {
        one: '# день після відкриття',
        few: '# дні після відкриття',
        many: '# днів після відкриття',
        other: '# дня після відкриття',
      }),
    notSet: 'Не вказано',
    openedSooner: 'Після відкриття термін придатності настає раніше за дату на упаковці.',
    markOpened: 'Позначити відкритим сьогодні',
    notes: 'Нотатки',
    added: 'Додано',
    updated: 'Оновлено',
    remove: 'Прибрати предмет',
  },

  discardSheet: {
    title: 'Скасувати зміни?',
    discard: 'Не зберігати',
    keepEditing: 'Продовжити редагування',
  },

  profile: {
    title: 'Профіль',
    name: 'Ім’я',
    email: 'Ел. пошта',
    household: 'Домогосподарство',
    language: 'Мова',
    languageHint: 'Сторінка перезавантажиться обраною мовою.',
    languageFailed: 'Не вдалося змінити мову.',
    devIdentity: 'Вхід для розробки: користувача задає VITE_DEV_USER_EMAIL.',
  },

  shopping: {
    title: 'Покупки',
    description: 'Списки покупок з’являться незабаром.',
  },

  planner: {
    title: 'Планувальник',
    description: 'Планування меню з’явиться незабаром.',
  },
} satisfies Messages;
