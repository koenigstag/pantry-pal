/*
 * Calendar dates where the user is. A carton expires on a day, and "today" is
 * the user's, not the server's: past midnight in Kyiv it is still yesterday in UTC.
 */

/** Today in a time zone, `YYYY-MM-DD`: Canadian English writes dates that way. */
const dateIn = (timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

/** Today's date where the user is; in UTC if their time zone is not one. */
export function todayIn(timeZone: string): string {
  try {
    return dateIn(timeZone);
  } catch {
    return dateIn('UTC');
  }
}
