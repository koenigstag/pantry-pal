import { observer } from 'mobx-react-lite';
import type { ReactElement } from 'react';

import { AddItemForm } from './components/AddItemForm';
import { ConnectionBadge } from './components/ConnectionBadge';
import { PantryList } from './components/PantryList';
import { usePantryStore } from './stores/StoreContext';

export const App = observer(function App(): ReactElement {
  const pantry = usePantryStore();

  return (
    <main className="app">
      <header className="app__header">
        <div>
          <h1>Pantry Pal</h1>
          <p className="app__subtitle">
            {pantry.all.length} items · {pantry.expiringSoon.length} expiring soon ·{' '}
            {pantry.expiredCount} expired
          </p>
        </div>
        <div className="app__actions">
          <ConnectionBadge />
          <button
            className="button button--ghost"
            type="button"
            onClick={() => pantry.requestSync()}
            disabled={!pantry.isOnline}
          >
            Sync
          </button>
        </div>
      </header>

      {pantry.error !== null && (
        <p className="alert" role="alert">
          {pantry.error}
        </p>
      )}

      <section className="card">
        <AddItemForm />
      </section>

      <section className="card">
        <PantryList />
      </section>

      <footer className="app__footer">
        Open a second tab — changes broadcast over the socket to every client.
      </footer>
    </main>
  );
});
