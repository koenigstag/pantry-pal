import { observer } from 'mobx-react-lite';
import type { ReactElement } from 'react';

import type { ConnectionState } from '../stores/PantryStore';
import { usePantryStore } from '../stores/StoreContext';

const LABELS: Record<ConnectionState, string> = {
  idle: 'Idle',
  connecting: 'Connecting…',
  online: 'Live',
  offline: 'Offline',
};

export const ConnectionBadge = observer(function ConnectionBadge(): ReactElement {
  const pantry = usePantryStore();

  return (
    <output className={`badge badge--${pantry.connection}`}>
      <span className="badge__dot" aria-hidden="true" />
      {LABELS[pantry.connection]}
    </output>
  );
});
