import {
  CalendarDays,
  CircleUserRound,
  Package,
  ShoppingCart,
  type LucideIcon,
} from 'lucide-react';

import type { messages } from '../../i18n/messages';

export const ROUTES = {
  signIn: '/sign-in',
  signUp: '/sign-up',
  /** Sign-up's last step: the optional onboarding questions. */
  welcome: '/welcome',
  storage: '/storage',
  shopping: '/shopping',
  planner: '/planner',
  profile: '/profile',
} as const;

export interface NavItem {
  path: string;
  /** A key rather than the text, so the label is looked up at render time once localized. */
  labelKey: Exclude<keyof typeof messages.nav, 'label'>;
  icon: LucideIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { path: ROUTES.storage, labelKey: 'storage', icon: Package },
  { path: ROUTES.shopping, labelKey: 'shopping', icon: ShoppingCart },
  { path: ROUTES.planner, labelKey: 'planner', icon: CalendarDays },
  { path: ROUTES.profile, labelKey: 'profile', icon: CircleUserRound },
];
