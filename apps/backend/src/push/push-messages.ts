import { localeLookupOrder } from '@pantry-pal/shared';

/**
 * What notifications say, in each language the app is translated into.
 *
 * A notification is worded on the server, in its recipient's `users.locale`: the
 * service worker that shows it has no catalog, and no time to fetch one. Look-up
 * follows `pickTranslation`: the exact tag, then its language, then English.
 *
 * Lines start with a label — "Added:", "Bought:" — rather than a sentence about
 * the member ("Anna added"), because Russian, Ukrainian and French put the
 * member's gender into that verb, and the server does not know it. The member's
 * name goes in the title instead.
 */
export interface PushMessages {
  /** The morning notification: units whose last day is today. */
  expiry: (items: string) => string;
  /** Another member put these on a list. */
  added: (items: string) => string;
  /** Another member put the shopping away. */
  bought: (items: string) => string;
  /** New members of the household, to those already in it. */
  newMembers: (names: string, count: number) => string;
  /** To someone just added to a household. */
  addedYou: string;
  /** The tail of a list shortened to its first names: "and 3 more". */
  more: (count: number) => string;
  test: { title: string; body: string };
}

const en: PushMessages = {
  expiry: (items) => `Last day today: ${items}`,
  added: (items) => `Added: ${items}`,
  bought: (items) => `Bought: ${items}`,
  newMembers: (names, count) => `${count === 1 ? 'New member' : 'New members'}: ${names}`,
  addedYou: 'You are now a member of this household',
  more: (count) => `${count} more`,
  test: { title: 'Pantry Pal', body: 'Notifications reach this device.' },
};

const uk: PushMessages = {
  expiry: (items) => `Сьогодні останній день: ${items}`,
  added: (items) => `Додано: ${items}`,
  bought: (items) => `Куплено: ${items}`,
  newMembers: (names, count) => `${count === 1 ? 'Новий учасник' : 'Нові учасники'}: ${names}`,
  addedYou: 'Вас додали до цього домогосподарства',
  more: (count) => `ще ${count}`,
  test: { title: 'Pantry Pal', body: 'Сповіщення надходять на цей пристрій.' },
};

const ru: PushMessages = {
  expiry: (items) => `Сегодня последний день: ${items}`,
  added: (items) => `Добавлено: ${items}`,
  bought: (items) => `Куплено: ${items}`,
  newMembers: (names, count) => `${count === 1 ? 'Новый участник' : 'Новые участники'}: ${names}`,
  addedYou: 'Вас добавили в это домохозяйство',
  more: (count) => `ещё ${count}`,
  test: { title: 'Pantry Pal', body: 'Уведомления приходят на это устройство.' },
};

const de: PushMessages = {
  expiry: (items) => `Heute letzter Tag: ${items}`,
  added: (items) => `Hinzugefügt: ${items}`,
  bought: (items) => `Gekauft: ${items}`,
  newMembers: (names, count) => `${count === 1 ? 'Neues Mitglied' : 'Neue Mitglieder'}: ${names}`,
  addedYou: 'Sie sind jetzt Mitglied dieses Haushalts',
  more: (count) => `${count} weitere`,
  test: { title: 'Pantry Pal', body: 'Benachrichtigungen kommen auf diesem Gerät an.' },
};

const fr: PushMessages = {
  expiry: (items) => `Dernier jour aujourd’hui\u00A0: ${items}`,
  added: (items) => `Ajouts\u00A0: ${items}`,
  bought: (items) => `Achats\u00A0: ${items}`,
  newMembers: (names, count) =>
    `${count === 1 ? 'Nouveau membre' : 'Nouveaux membres'}\u00A0: ${names}`,
  addedYou: 'Vous faites maintenant partie de ce foyer',
  more: (count) => (count === 1 ? '1 autre' : `${count} autres`),
  test: { title: 'Pantry Pal', body: 'Les notifications arrivent sur cet appareil.' },
};

const es: PushMessages = {
  expiry: (items) => `Hoy es el último día: ${items}`,
  added: (items) => `Añadido: ${items}`,
  bought: (items) => `Comprado: ${items}`,
  newMembers: (names, count) => `${count === 1 ? 'Nuevo miembro' : 'Nuevos miembros'}: ${names}`,
  addedYou: 'Ahora formas parte de este hogar',
  more: (count) => `${count} más`,
  test: { title: 'Pantry Pal', body: 'Las notificaciones llegan a este dispositivo.' },
};

/** By language: no region words these differently, so `fr-CA` reads `fr`. */
const CATALOGS: Readonly<Record<string, PushMessages>> = { en, uk, ru, de, fr, es };

export function pushMessages(locale: string): PushMessages {
  for (const key of localeLookupOrder(locale)) {
    const catalog = CATALOGS[key];
    if (catalog !== undefined) return catalog;
  }
  return en;
}

/** How many names a notification lists before it says "and N more". */
const MAX_LISTED_NAMES = 4;

/**
 * Names as a sentence lists them in `locale` — "milk, bread and eggs" — the
 * first few only, then "and N more", so the line still fits a lock screen.
 */
export function listNames(names: readonly string[], locale: string): string {
  const shown =
    names.length <= MAX_LISTED_NAMES
      ? names
      : [
          ...names.slice(0, MAX_LISTED_NAMES - 1),
          pushMessages(locale).more(names.length - (MAX_LISTED_NAMES - 1)),
        ];
  return new Intl.ListFormat(locale, { type: 'conjunction' }).format(shown);
}
