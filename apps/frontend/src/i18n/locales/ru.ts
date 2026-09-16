import { formatNumber, plural, type PluralForms } from '../format';
import type { Messages } from '../messages';

/*
 * Russian. Every key of the English catalog, checked by `satisfies Messages`.
 * Plurals take `one` (1, 21), `few` (2–4, 22–24), `many` (0, 5–20) and `other`
 * (fractions), as `Intl.PluralRules('ru')` picks them.
 *
 * Names the household typed are quoted «like this», so a sentence never has to
 * decline a word it did not write.
 */

function expiryDescription(days: number): string {
  if (days < 0) {
    return plural(-days, {
      one: 'Просрочено # день назад',
      few: 'Просрочено # дня назад',
      many: 'Просрочено # дней назад',
      other: 'Просрочено # дня назад',
    });
  }
  if (days === 0) return 'Истекает сегодня';
  return plural(days, {
    one: 'Истекает через # день',
    few: 'Истекает через # дня',
    many: 'Истекает через # дней',
    other: 'Истекает через # дня',
  });
}

const COUNT_NOUNS = new Map<string, PluralForms>([
  ['pcs', { other: 'шт.' }],
  ['bag', { one: 'пакет', few: 'пакета', many: 'пакетов', other: 'пакета' }],
  ['blister', { one: 'блистер', few: 'блистера', many: 'блистеров', other: 'блистера' }],
  ['bottle', { one: 'бутылка', few: 'бутылки', many: 'бутылок', other: 'бутылки' }],
  ['box', { one: 'коробка', few: 'коробки', many: 'коробок', other: 'коробки' }],
  ['can', { one: 'жестянка', few: 'жестянки', many: 'жестянок', other: 'жестянки' }],
  ['jar', { one: 'банка', few: 'банки', many: 'банок', other: 'банки' }],
  ['pack', { one: 'упаковка', few: 'упаковки', many: 'упаковок', other: 'упаковки' }],
  ['pill', { one: 'таблетка', few: 'таблетки', many: 'таблеток', other: 'таблетки' }],
  ['tube', { one: 'тюбик', few: 'тюбика', many: 'тюбиков', other: 'тюбика' }],
]);

/** Metric symbols only: imperial units keep their conventional English abbreviations. */
const UNIT_SYMBOLS = new Map<string, string>([
  ['g', 'г'],
  ['kg', 'кг'],
  ['ml', 'мл'],
  ['l', 'л'],
]);

const CATEGORY_NAMES = new Map<string, string>([
  ['produce', 'Овощи и фрукты'],
  ['dairy', 'Молочные продукты'],
  ['meat', 'Мясо'],
  ['fish', 'Рыба'],
  ['grains', 'Крупы и мучное'],
  ['canned', 'Консервы'],
  ['frozen', 'Замороженное'],
  ['spices', 'Специи'],
  ['beverages', 'Напитки'],
  ['medicine', 'Лекарства'],
  ['personal-care', 'Личная гигиена'],
  ['cleaning', 'Бытовая химия'],
  ['other', 'Другое'],
]);

const items = (count: number, before: string, after = ''): string =>
  plural(count, {
    one: `${before}# предмет${after}`,
    few: `${before}# предмета${after}`,
    many: `${before}# предметов${after}`,
    other: `${before}# предмета${after}`,
  });

export const ru = {
  app: {
    name: 'Pantry Pal',
  },

  nav: {
    label: 'Главное меню',
    storage: 'Хранение',
    shopping: 'Покупки',
    planner: 'Планировщик',
    profile: 'Профиль',
  },

  common: {
    cancel: 'Отмена',
    back: 'Назад',
    close: 'Закрыть',
    retry: 'Повторить',
    loading: 'Загрузка…',
    comingSoon: 'Скоро',
  },

  connection: {
    idle: 'Нет подключения',
    connecting: 'Подключение…',
    online: 'Онлайн',
    offline: 'Офлайн',
  },

  household: {
    defaultName: 'Дом',
  },

  errors: {
    loadFailed: 'Не удалось загрузить ваши запасы.',
    quantityNotSaved: 'Не удалось сохранить новое количество, поэтому показано сохранённое.',
    deleteFailed: (count: number) => items(count, 'Не удалось удалить ', '.'),
    moveFailed: (count: number) => items(count, 'Не удалось переместить ', '.'),
    refreshFailed: 'Не удалось обновить, поэтому показаны последние полученные данные.',
  },

  pending: {
    shoppingLists: 'Списки покупок скоро появятся.',
  },

  categories: {
    name: (code: string, label: string): string => CATEGORY_NAMES.get(code) ?? label,
  },

  storage: {
    title: 'Хранение',
    locations: 'Места хранения',
    search: 'Поиск предметов',
    searchPlaceholder: 'Поиск предметов',
    clearSearch: 'Очистить поиск',
    closeSearch: 'Закрыть поиск',
    moreActions: 'Другие действия',
    addItem: 'Добавить предмет',
    selectAll: 'Выбрать все',
    editLocations: 'Редактировать места хранения',
    refresh: 'Обновить',
    itemCount: (count: number) => items(count, ''),
    matchCount: (count: number) =>
      plural(count, {
        one: '# совпадение',
        few: '# совпадения',
        many: '# совпадений',
        other: '# совпадения',
      }),
    emptyLocation: (location: string) => `Место хранения «${location}» пока пустое.`,
    noMatches: (query: string, location: string) =>
      `В месте хранения «${location}» нет совпадений с «${query}».`,
    noLocations: 'В этом домохозяйстве ещё нет мест хранения.',
    fallbackLocation: 'Другое',
  },

  sort: {
    menu: 'Сортировка',
    current: (field: string) => `Сортировка: ${field}`,
    fields: {
      name: 'Название',
      expiry: 'Срок годности',
      quantity: 'Количество',
      size: 'Размер',
      added: 'Недавно добавленные',
    },
    ascending: 'По возрастанию',
    descending: 'По убыванию',
  },

  selection: {
    toolbar: 'Выбранные предметы',
    count: (count: number) => plural(count, { other: 'Выбрано: #' }),
    clear: 'Снять выделение',
    delete: 'Удалить выбранные',
    addToShoppingList: 'Добавить выбранные в список покупок',
    move: 'Переместить выбранные в другое место хранения',
  },

  item: {
    select: (name: string) => `Выбрать «${name}»`,
    expiryBadge: (days: number) => `${formatNumber(days)} д`,
    expiryDescription,
    amount: (quantity: number, unit: string) => `${formatNumber(quantity)} ${unit}`,
    amountWithSize: (quantity: number, unit: string, size: number, sizeUnit: string) =>
      `${formatNumber(quantity)} ${unit} × ${formatNumber(size)} ${sizeUnit}`,
    sizeWithCount: (quantity: number, size: number, sizeUnit: string) =>
      `${formatNumber(quantity)} × ${formatNumber(size)} ${sizeUnit}`,
    quantity: (name: string) => `Количество: «${name}»`,
    increase: (name: string) => `Увеличить количество: «${name}»`,
    decrease: (name: string) => `Уменьшить количество: «${name}»`,
    remove: (name: string) => `Убрать «${name}»`,
  },

  removeSheet: {
    title: (name: string) => `Убрать «${name}»?`,
    usedIt: 'Уже использовано — добавить в список покупок',
    justDelete: 'Просто удалить',
  },

  deleteSheet: {
    title: (count: number) => items(count, 'Удалить ', '?'),
    confirm: 'Удалить',
  },

  moveSheet: {
    title: (count: number) => items(count, 'Куда переместить ', '?'),
  },

  locationEditor: {
    title: 'Редактировать места хранения',
    name: 'Название места хранения',
    newPlaceholder: 'Название нового места',
    unnamed: 'Новое место хранения',
    add: 'Добавить место хранения',
    limitReached: (max: number) =>
      `В домохозяйстве может быть до ${formatNumber(max)} мест хранения.`,
    remove: (name: string) => `Удалить «${name}»`,
    restore: (name: string) => `Оставить «${name}»`,
    deletedOnSave: 'Будет удалено при сохранении.',
    moveItemsTo: (count: number) =>
      items(count, 'Будет удалено при сохранении. Куда переместить ', ':'),
    nowhereToMove: (count: number) =>
      items(count, 'Нужно другое сохранённое место хранения, куда переместить ', '.'),
    nameRequired: 'Введите название.',
    nameTaken: 'Другое место хранения уже называется так.',
    fallbackHint:
      'Нельзя переименовать или удалить: сюда перемещаются предметы из удалённых мест хранения.',
    save: 'Сохранить',
    saving: 'Сохранение…',
    saveFailed: 'Не удалось сохранить места хранения.',
    changedElsewhere:
      'Кто-то другой изменил места хранения, пока вы редактировали. Их изменения уже в списке: проверьте его и сохраните снова.',
    reorder: (name: string) => `Изменить порядок: «${name}»`,
    sortable: 'можно переместить',
    dragInstructions:
      'Чтобы изменить порядок, нажмите Пробел или Enter на ручке, переместите строку клавишами со стрелками вверх и вниз, а затем снова нажмите Пробел или Enter. Esc отменяет перемещение.',
    pickedUp: (name: string, position: number, total: number) =>
      `Взято «${name}», позиция ${formatNumber(position)} из ${formatNumber(total)}.`,
    movedTo: (name: string, position: number, total: number) =>
      `«${name}» теперь на позиции ${formatNumber(position)} из ${formatNumber(total)}.`,
    dropped: (name: string, position: number, total: number) =>
      `«${name}» оставлено на позиции ${formatNumber(position)} из ${formatNumber(total)}.`,
    dropCancelled: (name: string) => `Перемещение отменено. «${name}» возвращено на место.`,
  },

  addItem: {
    title: 'Добавить предмет',
    submit: 'Добавить',
    submitting: 'Добавление…',
  },

  units: {
    countNoun: (code: string, count: number, label: string): string => {
      const forms = COUNT_NOUNS.get(code);
      return forms === undefined ? label : plural(count, forms);
    },
    symbol: (code: string, label: string): string => UNIT_SYMBOLS.get(code) ?? label,
    kinds: {
      mass: 'Вес',
      volume: 'Объём',
      count: 'Количество',
    },
  },

  itemForm: {
    name: 'Название',
    namePlaceholder: 'Молоко',
    location: 'Место хранения',
    category: 'Категория',
    edible: 'Съедобное',
    quantity: 'Количество',
    howMany: 'Сколько',
    decreaseQuantity: 'Уменьшить количество',
    increaseQuantity: 'Увеличить количество',
    unit: 'Единица',
    sizeValue: 'В одной единице',
    sizeHint: 'Необязательно: сколько вмещает одна единица, например 400 г.',
    sizeUnit: 'Единица содержимого',
    noSizeUnit: 'Без единицы',
    expires: 'Годен до',
    clearExpires: 'Очистить срок годности',
    opened: 'Вскрыто',
    openedToday: 'Сегодня',
    clearOpened: 'Очистить дату вскрытия',
    periodAfterOpening: 'Использовать в течение (дней после вскрытия)',
    notes: 'Заметки',
    conflict: (fields: string) =>
      `Кто-то другой изменил поля (${fields}), пока вы редактировали. При сохранении останутся ваши значения.`,
  },

  fieldErrors: {
    generic: 'Проверьте это значение.',
    name: 'Введите название.',
    locationId: 'Выберите место хранения.',
    category: 'Выберите категорию.',
    quantity: (min: number, max: number) =>
      `Введите целое число от ${formatNumber(min)} до ${formatNumber(max)}.`,
    unit: 'Выберите единицу.',
    sizeValue: (max: number, decimals: number) =>
      `Введите число больше 0 и не больше ${formatNumber(max)}, не более ${formatNumber(decimals)} знаков после запятой.`,
    sizeUnit: 'Выберите единицу.',
    sizeUnitRequired: 'Выберите единицу содержимого.',
    sizeValueRequired: 'Введите содержимое или очистите его единицу.',
    date: 'Введите корректную дату.',
    openedInFuture: 'Дата вскрытия не может быть в будущем.',
    periodAfterOpeningDays: (max: number) =>
      `Введите целое число дней от 1 до ${formatNumber(max)}.`,
    notes: (max: number) => `Заметки могут содержать до ${formatNumber(max)} символов.`,
  },

  itemDetails: {
    edit: 'Изменить',
    editTitle: 'Редактирование',
    save: 'Сохранить',
    saving: 'Сохранение…',
    details: 'Подробности',
    quantity: 'Количество',
    expiry: 'Срок годности',
    noExpiry: 'Без срока годности',
    printedDate: 'Дата на упаковке',
    opened: 'Вскрыто',
    notOpened: 'Ещё не вскрыто',
    useWithin: 'Использовать в течение',
    useWithinDays: (days: number) =>
      plural(days, {
        one: '# день после вскрытия',
        few: '# дня после вскрытия',
        many: '# дней после вскрытия',
        other: '# дня после вскрытия',
      }),
    notSet: 'Не указано',
    openedSooner: 'После вскрытия срок годности наступает раньше даты на упаковке.',
    markOpened: 'Отметить вскрытым сегодня',
    notes: 'Заметки',
    added: 'Добавлено',
    updated: 'Обновлено',
    remove: 'Убрать предмет',
  },

  discardSheet: {
    title: 'Отменить изменения?',
    discard: 'Не сохранять',
    keepEditing: 'Продолжить редактирование',
  },

  profile: {
    title: 'Профиль',
    name: 'Имя',
    email: 'Эл. почта',
    household: 'Домохозяйство',
    language: 'Язык',
    languageHint: 'Страница перезагрузится на выбранном языке.',
    languageFailed: 'Не удалось сменить язык.',
    devIdentity: 'Вход для разработки: пользователя задаёт VITE_DEV_USER_EMAIL.',
  },

  shopping: {
    title: 'Покупки',
    description: 'Списки покупок скоро появятся.',
  },

  planner: {
    title: 'Планировщик',
    description: 'Планирование меню скоро появится.',
  },
} satisfies Messages;
