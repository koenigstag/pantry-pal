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
    expiryBadge: (days: number) => `${formatNumber(days)}\u00A0д`,
    expiryDescription,
    amount: (quantity: number, unit: string) => `${formatNumber(quantity)}\u00A0${unit}`,
    amountWithSize: (quantity: number, unit: string, size: number, sizeUnit: string) =>
      `${formatNumber(quantity)}\u00A0${unit} ×\u00A0${formatNumber(size)}\u00A0${sizeUnit}`,
    sizeWithCount: (quantity: number, size: number, sizeUnit: string) =>
      `${formatNumber(quantity)} ×\u00A0${formatNumber(size)}\u00A0${sizeUnit}`,
    quantity: (name: string) => `Кількість: «${name}»`,
    increase: (name: string) => `Збільшити кількість: «${name}»`,
    decrease: (name: string) => `Зменшити кількість: «${name}»`,
    remove: (name: string) => `Прибрати «${name}»`,
  },

  removeSheet: {
    title: (name: string) => `Прибрати «${name}»?`,
    usedIt: 'Вже використано — додати до списку покупок',
    usedItOnList: (list: string) => `Вже використано — додати до «${list}»`,
    justDelete: 'Просто видалити',
  },

  addToList: {
    title: (count: number) => items(count, 'Куди додати ', '?'),
    usedUpTitle: (name: string) => `Куди додати «${name}»?`,
    usedUpHint: 'Коли закінчиться наступного разу, його буде додано туди автоматично.',
    alreadyOn: 'Уже в цьому списку',
    someAlreadyOn: (count: number) => plural(count, { other: 'Уже в ньому: #' }),
    newList: 'Новий список',
    added: (count: number, list: string) => `${items(count, 'Додано ')} до «${list}».`,
    nothingAdded: (list: string) => `Уже в «${list}».`,
    usedUpAdded: (name: string, list: string) => `«${name}» — у списку «${list}».`,
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
    shoppingList: 'Список покупок',
    shoppingListHint: 'Коли закінчиться, потрапить у цей список автоматично.',
    noShoppingList: 'Немає',
    archivedList: (name: string) => `«${name}» (в архіві)`,
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
    defaultShoppingListId: 'Виберіть список покупок.',
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
    shopping: 'Покупки',
    defaultList: (list: string) => `Коли закінчиться, потрапить до списку «${list}».`,
    noDefaultList: 'Коли закінчиться, сам не потрапить ні до якого списку.',
    defaultListArchived: (list: string) =>
      `Коли закінчиться, ні до якого списку не потрапить, доки «${list}» в архіві.`,
    onLists: (lists: string) => `Зараз у списках: ${lists}.`,
    addToList: 'Додати до списку покупок',
  },

  discardSheet: {
    title: 'Скасувати зміни?',
    discard: 'Не зберігати',
    keepEditing: 'Продовжити редагування',
  },

  profile: {
    title: 'Профіль',
    email: 'Ел. пошта',
    household: 'Домогосподарство',
    language: 'Мова',
    languageHint: 'Сторінка перезавантажиться обраною мовою.',
    languageFailed: 'Не вдалося змінити мову.',
  },

  details: {
    title: 'Дані',
    name: 'Ім’я',
    nameHint: 'Його бачать люди, з якими ви ділите домогосподарство.',
    birthDate: 'Дата народження',
    birthDateHint: 'Її бачите лише ви.',
    clearBirthDate: 'Очистити дату народження',
    units: 'Одиниці виміру',
    unitSystems: {
      metric: { name: 'Метрична', examples: 'г, кг, мл, л' },
      imperial: { name: 'Імперська', examples: 'oz, lb, fl oz, cup' },
    },
    householdName: 'Назва домогосподарства',
    save: 'Зберегти зміни',
    saving: 'Збереження…',
    saved: 'Дані збережено.',
    fieldErrors: {
      displayName: (max: number) => `Введіть ім’я до ${formatNumber(max)} символів.`,
      birthDate: (fromYear: string) => `Введіть дату від ${fromYear} року до сьогодні.`,
      householdName: (max: number) => `Введіть назву до ${formatNumber(max)} символів.`,
    },
  },

  auth: {
    signInTitle: 'Вхід',
    signUpTitle: 'Створення облікового запису',
    step: (current: number, total: number) =>
      `Крок ${formatNumber(current)} з ${formatNumber(total)}`,
    email: 'Ел. пошта',
    password: 'Пароль',
    passwordHint: (min: number) =>
      plural(min, {
        one: 'Щонайменше # символ.',
        few: 'Щонайменше # символи.',
        many: 'Щонайменше # символів.',
        other: 'Щонайменше # символу.',
      }),
    continueWithGoogle: 'Продовжити з Google',
    continueWithEmail: 'Продовжити з ел. поштою',
    otherMethods: 'Інші способи входу',
    otherSignUpMethods: 'Інші способи реєстрації',
    continue: 'Продовжити',
    changeEmail: 'Змінити ел. пошту',
    signIn: 'Увійти',
    signingIn: 'Вхід…',
    signUp: 'Створити обліковий запис',
    signingUp: 'Створення облікового запису…',
    noAccount: 'Ще немає облікового запису?',
    toSignUp: 'Створіть його',
    haveAccount: 'Уже маєте обліковий запис?',
    toSignIn: 'Увійдіть',
    signOut: 'Вийти',
    signingOut: 'Вихід…',
    invalidCredentials: 'Неправильна ел. пошта або пароль.',
    emailTaken: 'Обліковий запис із цією ел. поштою вже існує.',
    tooManyAttempts: 'Забагато спроб. Зачекайте хвилину й спробуйте знову.',
    offline: 'Не вдалося зв’язатися із сервером. Перевірте з’єднання й спробуйте знову.',
    failed: 'Щось пішло не так. Спробуйте знову.',
    sessionEnded: 'Сеанс завершено. Увійдіть знову, щоб продовжити.',
    fieldErrors: {
      email: 'Введіть адресу ел. пошти.',
      passwordRequired: 'Введіть пароль.',
      password: (min: number, max: number) =>
        `Пароль має містити від ${formatNumber(min)} до ${formatNumber(max)} символів.`,
    },
    dev: {
      hint: 'Вхід під будь-якою ел. поштою без пароля, поки бекенд працює з DEV_AUTH=true.',
      submit: 'Увійти без пароля',
      unavailable: 'Бекенд працює без DEV_AUTH=true.',
    },
  },

  welcome: {
    title: (app: string) => `Вітаємо в ${app}`,
    intro: 'Кілька необов’язкових запитань. Відповіді можна змінити пізніше в профілі.',
    storageSpaces: 'Місця зберігання',
    storageSpacesHint: (fallback: string) =>
      `Зніміть позначки з тих, що не потрібні. «${fallback}» залишається завжди: туди переходять речі з вилученого місця.`,
    finish: 'Готово',
    finishing: 'Збереження…',
    skip: 'Пропустити',
  },

  changePassword: {
    title: 'Пароль',
    current: 'Поточний пароль',
    next: 'Новий пароль',
    submit: 'Змінити пароль',
    saving: 'Зміна…',
    changed: 'Пароль змінено. На інших пристроях виконано вихід.',
    incorrect: 'Поточний пароль неправильний.',
    sameAsCurrent: 'Виберіть пароль, відмінний від поточного.',
    currentRequired: 'Введіть поточний пароль.',
  },

  shopping: {
    title: 'Покупки',
    lists: 'Списки покупок',
    editLists: 'Редагувати списки покупок',
    listName: 'Назва списку',
    defaultListName: 'Мій список покупок',
    create: 'Створити',
    creating: 'Створення…',
    nameRequired: (max: number) => `Введіть назву до ${formatNumber(max)} символів.`,
    nameTaken: 'Список покупок із такою назвою вже є.',
    limitReached: (max: number) =>
      `У домогосподарстві може бути до ${formatNumber(max)} списків покупок.`,
    moreActions: 'Інші дії',
    refresh: 'Оновити',
    share: 'Поділитися списком',
    nothingToShare: 'У цьому списку більше нічого купувати.',
    copied: 'Список скопійовано. Вставте його в повідомлення.',
    shareFailed: 'Не вдалося поділитися списком.',
    shareLine: (name: string, amount: string) => `• ${name} — ${amount}`,
    loadFailed: 'Не вдалося завантажити списки покупок.',
    noLists: 'Списків покупок поки немає.',
    createFirst: 'Створити список покупок',
    emptyList: (list: string) => `У списку «${list}» поки нічого немає.`,
    emptyHint: 'У розділі «Зберігання» виберіть предмети або відкрийте один і додайте до списку.',
    toBuy: (count: number) => plural(count, { other: 'Купити: #' }),
    inCart: 'У кошику',
    left: (count: number) => plural(count, { other: 'залишилося: #' }),
    noneLeft: 'не залишилося',
    increase: (name: string) => `Купити більше: «${name}»`,
    decrease: (name: string) => `Купити менше: «${name}»`,
    remove: (name: string) => `Прибрати «${name}» зі списку`,
    quantity: (name: string) => `Скільки купити: «${name}»`,
    markBought: (count: number) => plural(count, { other: 'Куплено: #' }),
    markingBought: 'Позначаємо…',
    markBoughtHint: 'Куплене повернеться на свої місця зберігання й зникне зі списку.',
    markedBought: (count: number) =>
      plural(count, {
        one: '# предмет знову на місці.',
        few: '# предмети знову на місці.',
        many: '# предметів знову на місці.',
        other: '# предмета знову на місці.',
      }),
    changedElsewhere: 'Хтось змінив цей список. Перевірте його й позначте куплене ще раз.',
  },

  shoppingListEditor: {
    title: 'Редагувати списки покупок',
    name: 'Назва списку покупок',
    newPlaceholder: 'Назва нового списку',
    unnamed: 'Новий список',
    add: 'Додати список',
    empty: 'Списків покупок поки немає.',
    limitReached: (max: number) =>
      `У домогосподарстві може бути до ${formatNumber(max)} списків покупок разом з архівними.`,
    archive: (name: string) => `Архівувати «${name}»`,
    unarchive: (name: string) => `Відновити «${name}»`,
    archivedHeading: 'Архів',
    archivedHint: 'Приховані, і до них нічого не додається, доки їх не відновлять.',
    remove: (name: string) => `Видалити «${name}»`,
    restore: (name: string) => `Залишити «${name}»`,
    deletedOnSave: (count: number) =>
      count === 0
        ? 'Буде видалено після збереження.'
        : plural(count, {
            one: 'Буде видалено після збереження разом із # предметом.',
            other: 'Буде видалено після збереження разом із # предметами.',
          }),
    nameRequired: 'Введіть назву.',
    nameTaken: 'Інший список покупок уже має таку назву.',
    save: 'Зберегти',
    saving: 'Збереження…',
    saveFailed: 'Не вдалося зберегти списки покупок.',
    changedElsewhere:
      'Хтось інший змінив списки покупок, поки ви редагували. Їхні зміни вже в списку: перевірте його та збережіть знову.',
  },

  planner: {
    title: 'Планувальник',
    description: 'Планування меню з’явиться незабаром.',
  },
} satisfies Messages;
