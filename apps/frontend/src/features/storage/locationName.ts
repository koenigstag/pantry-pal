import type { PantryLocation } from '@pantry-pal/shared';

import { messages } from '../../i18n/messages';

/**
 * A location as the user sees it. Names are what the household typed, in
 * whatever language that was — except the fallback's, which nobody can rename,
 * so it speaks the page's language instead.
 */
export function locationName(location: Pick<PantryLocation, 'name' | 'isFallback'>): string {
  return location.isFallback ? messages.storage.fallbackLocation : location.name;
}
