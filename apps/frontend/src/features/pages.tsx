import { CalendarDays, ShoppingCart } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { ReactElement } from 'react';

import { messages } from '../i18n/messages';
import { usePantryStore } from '../stores/StoreContext';
import { ComingSoonPage } from './shell/ComingSoonPage';
import { PageStatus } from './shell/PageStatus';

export function ShoppingPage(): ReactElement {
  return (
    <ComingSoonPage
      title={messages.shopping.title}
      description={messages.shopping.description}
      icon={ShoppingCart}
    />
  );
}

export function PlannerPage(): ReactElement {
  return (
    <ComingSoonPage
      title={messages.planner.title}
      description={messages.planner.description}
      icon={CalendarDays}
    />
  );
}

export const ProfilePage = observer(function ProfilePage(): ReactElement {
  const pantry = usePantryStore();
  const { user, household } = pantry;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-[max(1.5rem,env(safe-area-inset-top))] md:px-8 md:pt-8">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
        {messages.profile.title}
      </h1>

      {user === null ? (
        <PageStatus title={messages.common.loading} />
      ) : (
        <>
          <dl className="mt-6 divide-y divide-line rounded-xl border border-line bg-surface">
            <ProfileRow term={messages.profile.name} value={user.displayName} />
            <ProfileRow term={messages.profile.email} value={user.email} />
            {household !== null && (
              <ProfileRow term={messages.profile.household} value={household.name} />
            )}
          </dl>
          <p className="mt-4 text-sm text-ink-muted">{messages.profile.devIdentity}</p>
        </>
      )}
    </div>
  );
});

function ProfileRow({ term, value }: { term: string; value: string }): ReactElement {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3">
      <dt className="text-sm text-ink-muted">{term}</dt>
      <dd className="font-medium break-words">{value}</dd>
    </div>
  );
}
